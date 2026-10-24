/* ─── Boosthis: background-work meter (Node) ───────────────────────────────
 *
 * WHY THIS EXISTS. A large share of what a modern back end does never comes
 * from a browser: queue consumers, scheduled jobs, webhook processors, nightly
 * imports, and the AI work that keeps running after the visitor has left. Every
 * reading this kit shipped until now hung off an INCOMING REQUEST, so a project
 * that does most of its work in the background opened a dashboard that looked
 * empty and read it as healthy. This module gives that work a first-class unit
 * of measurement of its own — a JOB RUN — with no request behind it.
 *
 * A JOB RUN IS NOT A REQUEST, AND FAILS DIFFERENTLY.
 *
 *   • It can WAIT before it starts. A request's clock begins when it arrives; a
 *     job's begins when a worker picks it up, and the queue often knows how
 *     long it sat. That wait is invisible to a duration and is frequently the
 *     whole problem.
 *   • It can be RETRIED. The same logical job runs again, and a project that
 *     retries forever looks busy rather than broken.
 *     A retry is counted, never merged into the first attempt.
 *   • It can NOT HAPPEN AT ALL. A request that never arrives is a visitor who
 *     left; a scheduled run that never happened is a failure with no error, no
 *     log line and no row anywhere. Silence is the symptom, so silence has to
 *     be measured — see {@link expectEvery} and the cadence learner below.
 *   • It can OVERLAP ITSELF. Two copies of the same nightly import running at
 *     once is a class of bug a request never has.
 *
 * PRIVACY — counts, timings and names only. A job NAME is a code-defined label
 * ("sendDigest", "reindexSearch"), and it rides the same route-label guard
 * every other label passes: anything that looks user-derived is dropped before
 * it reaches the sample buffer. A job's PAYLOAD and ARGUMENTS are never read,
 * never hashed, and never uploaded — unlike the repeated-work meter, which
 * needs an argument hash to judge repetition, this meter has no reason to look
 * at one at all.
 *
 * HONEST WHEN BLIND. A queue library this kit cannot attach to must never read
 * as a project with no background work. {@link unattachedJobSystemCount}
 * counts the job systems this process loaded that have no safe funnel to
 * observe, and that count ships beside the reading so the tile can say "cannot
 * tell" instead of "none". A kit that watched nothing at all reports NO axis,
 * which every surface renders as "cannot tell" — never a confident zero.
 *
 * ADDITIVE. This never touches the composite Speed score. Each run is also
 * filed as an ordinary sample under a `job:` label so the existing route table,
 * budgets and per-row surfaces show it beside request work without any of them
 * being rebuilt.
 *
 * LATER WORK — the remaining kits. Node and Python first. Every other runtime
 * simply does not upload the axis, which reads as "cannot tell" rather than as
 * zero jobs.
 */

import { isSettledAt } from "./settleRule";
import { AsyncLocalStorage } from "node:async_hooks";

import { record } from "./samples";
import { rateDuration } from "./thresholds";
import { jobNameHasPII } from "./no-pii";
import { isBoosthisDisabled } from "./runtimeFlags";
import { isKitLocked } from "./killSwitch";
import { isServerlessMode } from "./serverless";
import { beginInvocation, finishInvocation } from "./serverlessLifecycle";
import { reportJobError } from "./crashReporter";
import {
  clearJobRhythmDeclarations,
  declareJobRhythm,
  MAX_JOB_NAME,
  MAX_STORABLE_EVERY_MS,
  MIN_STORABLE_EVERY_MS,
  noteJobNameRefused,
  reportJobRun,
  sayDeclarationOnce,
  sayJobNameRefusedOnce,
  sayRhythmRefusedOnce,
  setJobExpectationHandler,
} from "./jobReporter";
import { JOB_WAIT_MS_THRESHOLDS, type JobWorkStatsLike } from "./meterAxes";
import {
  closeLinkedScope,
  linkedStepSpans,
  openLinkedScope,
  setJobLinkedScopeReader,
  type LinkedScope,
} from "./linkedSteps";
import { enqueueJobRunSteps, rateSpanDuration } from "./spanEmitter";
import { newSpanId } from "./spanScope";
import { newTraceId } from "./trace";
import { MAX_PART_NAME } from "./routeInventory";

/** The label prefix every job run is filed under, so a job row is always
 *  distinguishable from a route row on every surface that lists rows. Mirrors
 *  RN's `screen:` convention. */
export const JOB_PREFIX = "job:";

/** Most distinct job names tracked in full. Past this a run is folded into the
 *  everything-else group so a project that mints a name per item (the very bug
 *  this meter should survive) can never grow memory or flood the view. The
 *  fold is VISIBLE: the count of folded names ships with the reading. */
export const MAX_JOB_NAMES = 20;

/** The everything-else group's label. A real, visible row — never a silent
 *  discard. */
export const JOB_OTHER_NAME = "other";

/** Longest job name kept. A longer one is refused outright rather than
 *  truncated: a truncated label silently merges two different jobs.
 *
 *  THE SAME NUMBER THE REPORTER PUBLISHES, by construction rather than by
 *  coincidence. This was its own literal — 60 — while `MAX_JOB_NAME` (80) was
 *  the exported constant, the wire bound and the server's rule, so a name of
 *  61-80 characters was inside the published limit and refused by the very
 *  call the docs point at: the job ran and never existed here. See
 *  docs/decisions/job-name-length.md. */
const MAX_JOB_NAME_LEN = MAX_JOB_NAME;

/** Distinct folded names counted before the counter stops learning. Bounds
 *  memory on a project minting a name per item. */
const MAX_FOLDED_NAMES = 500;

/** Durations kept for the percentile, newest-wins. */
const DURATION_RING = 500;

/** Consecutive gaps kept per job while learning its cadence. */
const GAP_RING = 12;

/** Gaps needed before this kit will claim it knows how often a job runs. Below
 *  this, a missing run is not claimed at all — an unproven cadence would turn
 *  an irregular job into a permanent false alarm. */
export const CADENCE_MIN_GAPS = 4;

/** How steady those gaps must be before the cadence counts as known. The
 *  spread (max−min) may not exceed this share of the median. A job that runs
 *  "roughly hourly, whenever the import finishes" is deliberately excluded. */
export const CADENCE_MAX_SPREAD = 0.25;

/** A gap this many times the known cadence is a run that did not happen. */
export const MISSED_GAP_FACTOR = 1.5;

/** Runs tracked as in-flight at once. Past this the kit stops tracking new
 *  ones for overlap purposes (they are still measured) so a runaway fan-out
 *  cannot grow memory. */
const MAX_ACTIVE_TRACKED = 512;

/** Everything known about one job name. Numbers only — no payload, no
 *  arguments, no error text. */
interface JobTally {
  runs: number;
  failed: number;
  /** Runs that were an attempt after the first. */
  retried: number;
  /** Highest attempt number any run reported. */
  retryWorst: number;
  worstMs: number;
  /** Runs currently in flight under this name. */
  active: number;
  /** Runs that began while another under the same name was still running. */
  overlaps: number;
  /** Wall clock of the last START, used to learn the cadence. */
  lastStartMs: number | null;
  /** Recent gaps between consecutive starts. */
  gaps: number[];
  /**
   * A stated cadence THE SERVER HAS AGREED TO WATCH. Outranks the learned one.
   *
   * Set only from the server's answer to a declaration, never straight from
   * `expectEvery()` — see `requestedEveryMs`. That is what stops this kit
   * counting missed runs against a rhythm the server never received, while the
   * server truthfully reports it cannot judge the same job at all.
   */
  statedEveryMs: number | null;
  /**
   * The WHOLE allowance Boosthis said it would give this job before calling it
   * late: the stored rhythm plus the stored grace, in ms, exactly as answered.
   *
   * Set with `statedEveryMs` and only from the same answer. The kit used to
   * apply its own {@link MISSED_GAP_FACTOR} to a declared rhythm, which is a
   * second opinion about the same job: minutes are the stored unit and grace
   * has a floor, so a one-minute declaration is late to the server after two
   * minutes and "missed" here after ninety seconds. Reading the allowance back
   * is what keeps one job to one answer.
   */
  statedAllowanceMs: number | null;
  /**
   * What `expectEvery()` was told, whether or not it has reached the server.
   *
   * Kept apart from `statedEveryMs` on purpose. A declaration that has not been
   * accepted yet may not be judged against: until Boosthis holds it, nothing
   * will ever raise an alert on it, so a local missed-run count derived from it
   * would be a number nobody acts on, contradicting the server's own read of
   * the same job.
   */
  requestedEveryMs: number | null;
  /** Runs this kit already concluded never happened. */
  missed: number;
  /** What this job's runs looked like over the most recent window, for the
   *  capacity reading. Made at the job's first run. */
  cap: CapacityRing | null;
}

/* ── CAPACITY ──────────────────────────────────────────────────────────────
 *
 * Is work arriving faster than this job's worker finishes it? The kit cannot
 * ask the queue — it makes no call the app did not make — so the answer is
 * read only from what it already sees of the job's own runs, over one window:
 *
 *   • how many runs FINISHED, per minute (a rate it measured);
 *   • whether at least one run was IN FLIGHT for the whole window (the worker
 *     never ran dry);
 *   • whether the queue WAIT rose across the window by more than its own
 *     noise (a trend fitted to the window, judged against its scatter).
 *
 * Only when the last two both hold is "arriving faster than it finishes" true,
 * and even then the kit has not measured an ARRIVAL rate — only the finish
 * rate it is falling behind. The server writes the sentence; the kit sends the
 * three facts, and nothing at all before it has watched a whole window.
 */

/** One slice of the capacity window. */
interface CapacityBucket {
  /** Which slice of time this is (epoch ms / bucket length). A slot whose
   *  index is not the one asked for holds an older slice and reads as empty. */
  idx: number;
  finishes: number;
  /** Time at least one run of the job was in flight, inside this slice. */
  busyMs: number;
  /** Settled runs with a readable wait that STARTED inside this slice. */
  waitCount: number;
  waitSumMs: number;
}

interface CapacityRing {
  buckets: CapacityBucket[];
  /** When the job was first seen. A window that starts before this was not
   *  watched whole, and reads as nothing. */
  firstSeenMs: number;
  /** In-flight time from here to now is not yet credited to a bucket; null
   *  while nothing of the job is in flight. */
  busyFromMs: number | null;
}

/** The window, cut into equal slices: five minutes in five-second steps. Long
 *  enough that one slow item or one burst cannot pass for a backlog, short
 *  enough that a backlog building now is said now. Injectable for tests. */
let capacityBucketMs = 5_000;
let capacityBuckets = 60;

/** Share of the window at least one run must have been in flight for the
 *  worker to count as busy throughout. Not 100%: picking up the next item
 *  takes a moment even when the queue is full. */
export const CAPACITY_BUSY_SHARE = 0.95;

/** Slices holding a settled wait before a trend is fitted at all. */
export const CAPACITY_MIN_WAIT_BUCKETS = 6;

/** How many standard errors of its own scatter the fitted rise must clear. */
export const CAPACITY_GROWTH_T = 2;

function capSlot(ring: CapacityRing, idx: number): CapacityBucket {
  const len = capacityBuckets + 1;
  const at = ((idx % len) + len) % len;
  let slot = ring.buckets[at];
  if (!slot || slot.idx !== idx) {
    slot = { idx, finishes: 0, busyMs: 0, waitCount: 0, waitSumMs: 0 };
    ring.buckets[at] = slot;
  }
  return slot;
}

function capRing(tally: JobTally, now: number): CapacityRing {
  if (!tally.cap) tally.cap = { buckets: [], firstSeenMs: now, busyFromMs: null };
  return tally.cap;
}

/** Credit in-flight time up to `now` to the slices it spans. Only the newest
 *  window's worth can ever be read, so anything older is skipped outright. */
function capAccrue(ring: CapacityRing, now: number): void {
  const from = ring.busyFromMs;
  if (from === null || now <= from) return;
  let t = Math.max(from, now - capacityBucketMs * (capacityBuckets + 1));
  while (t < now) {
    const idx = Math.floor(t / capacityBucketMs);
    const end = Math.min(now, (idx + 1) * capacityBucketMs);
    capSlot(ring, idx).busyMs += end - t;
    t = end;
  }
  ring.busyFromMs = now;
}

/** The least-squares rise of a series across its own span, and how many
 *  standard errors of its scatter the slope clears. Null below the floor. */
function fittedRise(
  xs: readonly number[],
  ys: readonly number[],
): { riseMs: number; t: number } | null {
  const n = xs.length;
  if (n < CAPACITY_MIN_WAIT_BUCKETS || ys.length !== n) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    sxx += dx * dx;
    sxy += dx * (ys[i] - my);
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const r = ys[i] - (my + slope * (xs[i] - mx));
    sse += r * r;
  }
  const se = Math.sqrt(sse / (n - 2) / sxx);
  const t = se > 0 ? slope / se : slope > 0 ? Number.POSITIVE_INFINITY : 0;
  return { riseMs: slope * (xs[n - 1] - xs[0]), t };
}

/** One job's capacity facts over the newest complete window, or null when the
 *  job has not been watched for a whole one. The finishes are a raw COUNT
 *  with the window they were counted over: turning them into a per-minute
 *  rate is the axis's job (meterAxes.ts), through the earned-rate helper,
 *  never a division done here. */
interface CapacityRead {
  finishes: number;
  windowMs: number;
  busy: boolean;
  growing: boolean;
  riseMs: number;
  meanWaitMs: number | null;
}

function capacityOf(tally: JobTally, now: number): CapacityRead | null {
  const ring = tally.cap;
  if (!ring) return null;
  capAccrue(ring, now);
  const len = capacityBuckets + 1;
  // The slice `now` falls in is still filling; the window is the complete
  // slices before it.
  const endIdx = Math.floor(now / capacityBucketMs);
  const firstIdx = endIdx - capacityBuckets;
  if (ring.firstSeenMs > firstIdx * capacityBucketMs) return null;
  let finishes = 0;
  let busyMs = 0;
  let waitCount = 0;
  let waitSum = 0;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let idx = firstIdx; idx < endIdx; idx++) {
    const slot = ring.buckets[((idx % len) + len) % len];
    if (!slot || slot.idx !== idx) continue;
    finishes += slot.finishes;
    busyMs += slot.busyMs;
    if (slot.waitCount > 0) {
      waitCount += slot.waitCount;
      waitSum += slot.waitSumMs;
      xs.push(idx - firstIdx);
      ys.push(slot.waitSumMs / slot.waitCount);
    }
  }
  const windowMs = capacityBuckets * capacityBucketMs;
  const rise = fittedRise(xs, ys);
  return {
    finishes,
    windowMs,
    busy: busyMs >= CAPACITY_BUSY_SHARE * windowMs,
    // A rise smaller than the wait the meter already calls good could not
    // move the score, so it is not a backlog worth a sentence either.
    growing:
      rise !== null &&
      rise.riseMs > JOB_WAIT_MS_THRESHOLDS.good &&
      rise.t > CAPACITY_GROWTH_T,
    riseMs: rise?.riseMs ?? 0,
    meanWaitMs: waitCount > 0 ? waitSum / waitCount : null,
  };
}

/** Which job's reading speaks for the process: one that is falling behind
 *  (the steepest, if several), else the one whose runs waited longest. */
function capacityOutranks(a: CapacityRead, b: CapacityRead | null): boolean {
  if (b === null) return true;
  const aBehind = a.busy && a.growing;
  const bBehind = b.busy && b.growing;
  if (aBehind !== bBehind) return aBehind;
  if (aBehind) return a.riseMs > b.riseMs;
  const aw = a.meanWaitMs ?? -1;
  const bw = b.meanWaitMs ?? -1;
  if (aw !== bw) return aw > bw;
  // Every job's window is the same length, so the count orders as the rate.
  return a.finishes > b.finishes;
}

function emptyTally(): JobTally {
  return {
    runs: 0,
    failed: 0,
    retried: 0,
    retryWorst: 1,
    worstMs: 0,
    active: 0,
    overlaps: 0,
    lastStartMs: null,
    gaps: [],
    statedEveryMs: null,
    statedAllowanceMs: null,
    requestedEveryMs: null,
    missed: 0,
    cap: null,
  };
}

const tallies = new Map<string, JobTally>();
/** Distinct names folded into the everything-else group. Bounded. */
const foldedNames = new Set<string>();
/** Durations of every run, for the percentile. */
let durations: number[] = [];
/** Queue waits, for the wait percentile. Only runs whose system reported one. */
let waits: number[] = [];
/** Runs whose queue told us how long they waited. */
let waitRuns = 0;
/** Runs that arrived as a platform invocation (a hosted job service), so the
 *  serverless lifecycle — not a long-lived worker loop — governed the flush. */
let hostedRuns = 0;
/** Job systems this kit attached to on its own. */
const attachedSystems = new Set<string>();
/** Job systems this process loaded that this kit has no safe funnel for. */
const unattachedSystems = new Set<string>();
/** Runs the developer marked by hand rather than an adapter finding them. */
let manualRuns = 0;

/** A job name is a label written by hand beside a schedule. Refuse anything
 *  built out of a VALUE, over-long, or empty — a refused name is not measured
 *  rather than measured under a guess.
 *
 *  Spaces are fine: "queue drain" and "Send Weekly Report" are names, not
 *  interpolated route labels. That was the bug — `routeLabelHasPII` blocks
 *  every space, so an ordinary job simply never existed on any surface. See
 *  `jobNameHasPII` and docs/job-name-screening.md. */
function cleanName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_JOB_NAME_LEN) return null;
  if (jobNameHasPII(trimmed) !== null) return null;
  return trimmed;
}

/** The tally a run should be filed under: its own, or the everything-else
 *  group once the name cap is reached. */
function tallyFor(name: string): { key: string; tally: JobTally } {
  const existing = tallies.get(name);
  if (existing) return { key: name, tally: existing };
  if (tallies.size >= MAX_JOB_NAMES) {
    if (foldedNames.size < MAX_FOLDED_NAMES) foldedNames.add(name);
    let other = tallies.get(JOB_OTHER_NAME);
    if (!other) {
      other = emptyTally();
      tallies.set(JOB_OTHER_NAME, other);
    }
    return { key: JOB_OTHER_NAME, tally: other };
  }
  const fresh = emptyTally();
  tallies.set(name, fresh);
  return { key: name, tally: fresh };
}

/** What the caller (or an adapter) knows about this run beyond its name. */
export interface JobRunOptions {
  /**
   * Epoch ms the job became READY to run: after any delay it was deliberately
   * given, at the slot its repeat schedule set, or once a retry's backoff ran
   * out. Queue wait is counted from here — the single number a duration can
   * never show — so time the app ASKED a job to wait is never read as a queue
   * falling behind. Leave it out when the system does not say: a run with no
   * readable ready time reports no wait at all, never a guessed one, and a
   * ready time still in the future reports none either.
   */
  readyAtMs?: number;
  /**
   * The older name for {@link readyAtMs}, read exactly the same way and only
   * when `readyAtMs` is absent. It means the moment the job could first have
   * started, NOT the moment it was created: a job created with a delay was not
   * waiting in a queue for that delay.
   */
  queuedAtMs?: number;
  /** 1-based attempt number. 2 or more means this is a retry. */
  attempt?: number;
  /** Which job system found this run — an adapter's own tag, or absent when a
   *  developer marked it by hand. Never uploaded; it only decides whether the
   *  kit reports "attached on its own" or "marked by hand". */
  system?: string;
}

/** A run in flight. `done()` and `failed()` are both safe to call more than
 *  once; only the first decides the outcome. */
export interface JobRun {
  /** The run finished normally. */
  done(): void;
  /** The run threw. The error is reported the same way a crash inside a
   *  request is, and the run is counted as a failure rather than a slow
   *  success. */
  failed(error?: unknown): void;
}

const NOOP_RUN: JobRun = { done() {}, failed() {} };

/** How many runs are tracked as in flight right now, across all names. */
function activeTotal(): number {
  let n = 0;
  for (const t of tallies.values()) n += t.active;
  return n;
}

/** Fold a fresh start into the cadence learner and conclude any run that
 *  should have happened in between and did not. */
function noteStart(tally: JobTally, now: number): void {
  if (tally.lastStartMs !== null) {
    const gap = now - tally.lastStartMs;
    if (gap > 0) {
      const cadence = cadenceOf(tally);
      const allowance = missedAfterMs(tally);
      if (cadence !== null && allowance !== null && gap > allowance) {
        // Round rather than floor: a gap of 1.6 intervals is one run that did
        // not happen, and flooring would call it none.
        const skipped = Math.round(gap / cadence) - 1;
        if (skipped > 0) tally.missed += skipped;
      }
      tally.gaps.push(gap);
      if (tally.gaps.length > GAP_RING) tally.gaps.shift();
    }
  }
  tally.lastStartMs = now;
}

/**
 * How often this job runs, in ms, or null when this kit will not claim to
 * know.
 *
 * A cadence the developer STATED always wins — they know, and a learner cannot
 * out-argue that. Otherwise the gaps must be both plentiful ({@link
 * CADENCE_MIN_GAPS}) and steady ({@link CADENCE_MAX_SPREAD}); a job that runs
 * whenever work shows up has no cadence and must never grow a missing-run
 * count, because every quiet hour would read as a failure.
 */
export function cadenceOf(tally: {
  statedEveryMs: number | null;
  gaps: readonly number[];
}): number | null {
  if (tally.statedEveryMs !== null && tally.statedEveryMs > 0) {
    return tally.statedEveryMs;
  }
  const gaps = tally.gaps;
  if (gaps.length < CADENCE_MIN_GAPS) return null;
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  if (median <= 0) return null;
  const spread = sorted[sorted.length - 1] - sorted[0];
  if (spread / median > CADENCE_MAX_SPREAD) return null;
  return median;
}

/**
 * How long this job may be silent before a run counts as one that never
 * happened — in ms, or null when nothing here can say.
 *
 * For a DECLARED rhythm this is the server's own allowance, read back out of
 * its answer, never recomputed here: the same job may not be late over there
 * and missed over here. The stored unit is whole minutes and the grace has a
 * floor, so applying {@link MISSED_GAP_FACTOR} to the rhythm instead is not a
 * rounding difference, it is a second verdict — a one-minute declaration is
 * late to Boosthis after two minutes.
 *
 * For a LEARNED cadence the factor is all there is: nobody else knows about
 * that rhythm, so there is no other answer to disagree with.
 */
export function missedAfterMs(tally: {
  statedEveryMs: number | null;
  statedAllowanceMs: number | null;
  gaps: readonly number[];
}): number | null {
  const cadence = cadenceOf(tally);
  if (cadence === null) return null;
  if (tally.statedEveryMs !== null && tally.statedEveryMs > 0) {
    // A server old enough to store the rhythm but not to say what allowance it
    // gave it: fall back to the factor, which is what that server judges by.
    return tally.statedAllowanceMs !== null && tally.statedAllowanceMs > 0
      ? tally.statedAllowanceMs
      : cadence * MISSED_GAP_FACTOR;
  }
  return cadence * MISSED_GAP_FACTOR;
}

/**
 * Tell Boosthis how often a recurring job is SUPPOSED to run.
 *
 * Optional. Without it the kit learns the cadence from runs it sees, which
 * needs several steady gaps first — so a job that is supposed to run nightly
 * and has never run at all can only be reported as missing if the developer
 * said so. Stating it here, ONCE BOOSTHIS CONFIRMS IT, makes the very first
 * missed run visible. Until that answer arrives the job is not watched, and
 * every way this call can fail to produce one is printed on stderr, once, in
 * the developer's own words — see the causes in `expectEvery` below.
 *
 * THE UNIT. This takes milliseconds; Boosthis stores a rhythm in whole
 * MINUTES, from 1 minute to 45 days. A finer rhythm is watched at one minute
 * and the kit says so at the call; a longer one is recorded as a declaration
 * that could not be kept. `docs/decisions/sub-minute-job-rhythms.md` says why.
 *
 * THE OTHER DOORS. The same rhythm can be typed on the project's page in the
 * Boosthis dashboard — useful for whoever holds the schedule but not the
 * commit access, and the only place a watch can be switched off. Between the
 * two, the LAST deliberate statement is the one in force: restating the same
 * rhythm at every restart writes nothing, so a correction typed on the page
 * stands until the number on this line itself changes — and a watch the owner
 * switched off is never turned back on from code, however often this call
 * runs. `docs/decisions/kit-declared-job-rhythm-precedence.md` says why.
 *
 * WHERE THE DECLARATION GOES. It is SENT — queued now, delivered on the next
 * job upload, and remembered by Boosthis so a restart does not have to say it
 * again. It has to be: only the server raises alerts, and only the server sees
 * the job when this process is the thing that has stopped. For a long time
 * this call wrote the number into the map below and went no further, so the
 * kit counted missed runs against a rhythm Boosthis had never been told, while
 * Boosthis truthfully reported that nobody had declared one for that job.
 *
 * The kit does NOT start judging against the number on this line. It judges
 * against the rhythm Boosthis confirms — normally within a flush, and if the
 * declaration cannot be delivered the kit says so on stderr rather than
 * quietly acting as though the job were watched.
 *
 * Never starts, schedules or triggers anything: it only says what to expect.
 */
export function expectEvery(name: string, intervalMs: number): void {
  try {
    const shown = shownJobName(name);
    if (isBoosthisDisabled()) {
      sayDeclarationOnce(
        "disabled",
        `[boosthis] Boosthis is switched off in this process, so the rhythm declared for ${shown} was not sent and that job is NOT being watched. ` +
          `Nothing here is broken — unset BOOSTHIS_DISABLED and the declaration travels with the next upload.`,
      );
      return;
    }
    const clean = cleanName(name);
    if (clean === null) {
      sayDeclarationOnce(
        "name",
        `[boosthis] Boosthis did not take the rhythm declared for ${shown}, so that job is NOT being watched: ${whyNameRefused(name)}`,
      );
      return;
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      sayDeclarationOnce(
        "interval",
        `[boosthis] Boosthis did not take the rhythm declared for ${shown}, so that job is NOT being watched: expectEvery() wants how often the job runs in MILLISECONDS, above zero, and was given ${String(intervalMs)}.`,
      );
      return;
    }
    const { tally, key } = tallyFor(clean);
    if (key !== clean) {
      // Past the name cap this job's runs are folded into the everything-else
      // group, so there is no row of its own for a rhythm to be judged
      // against — and declaring one under the fold's name would watch a group
      // of unrelated jobs instead. Refused, out loud, rather than retargeted
      // in silence.
      sayDeclarationOnce(
        "folded",
        `[boosthis] Boosthis is already tracking ${MAX_JOB_NAMES} job names in this app, so ${shown} is folded into "${JOB_OTHER_NAME}" and is NOT being watched. ` +
          `Its runs are still counted, inside that group. Report fewer distinct job names — a name built from a value (an id, a tenant, a date) is the usual cause.`,
      );
      return;
    }
    tally.requestedEveryMs = intervalMs;
    if (intervalMs < MIN_STORABLE_EVERY_MS) {
      // Not refused — CHANGED. Boosthis keeps a rhythm in whole minutes, so a
      // sub-minute declaration is watched at one minute. Said here because
      // this is the moment the developer's own number stops being the number
      // in force; the answer that carries the real one back arrives a flush
      // later, into a handler nobody is reading.
      sayDeclarationOnce(
        "sub_minute",
        `[boosthis] Boosthis stores a job's rhythm in whole minutes, so the ${intervalMs}ms declared for ${shown} will be kept as every 1 minute — the shortest rhythm it can keep — plus the lateness Boosthis allows on top. ` +
          `Nothing is refused for being short: once Boosthis takes this declaration the job is watched against one minute rather than against the interval stated here, and if it cannot be taken the kit says that on a line of its own.`,
      );
    } else if (intervalMs > MAX_STORABLE_EVERY_MS) {
      // The one cause BOTH halves can see, so it shares the server refusal's
      // ledger key rather than getting one of its own: the developer hears it
      // here, at the call, and the `rhythm` refusal arriving a flush later
      // does not say the same thing a second time.
      sayRhythmRefusedOnce(
        `[boosthis] The rhythm declared for ${shown} is longer than the 45 days Boosthis can store, so it will be recorded as a declaration that could not be kept and that job will NOT be watched. ` +
          `Declare a rhythm between 1 minute and 45 days.`,
      );
    }
    declareJobRhythm(key, intervalMs);
  } catch {
    /* a meter must never break the host */
  }
}

/** The job name as it may be echoed back to this process's OWN console — the
 *  developer cannot fix a call the kit will not name. Bounded, and never sent
 *  anywhere: a name refused by the label guard is exactly the one that must
 *  not travel. */
function shownJobName(name: unknown): string {
  if (typeof name !== "string") return `a job name of type ${typeof name}`;
  const trimmed = name.trim();
  if (trimmed.length === 0) return "an empty job name";
  const short =
    trimmed.length > MAX_JOB_NAME_LEN
      ? `${trimmed.slice(0, MAX_JOB_NAME_LEN)}…`
      : trimmed;
  return `"${short}"`;
}

/** A REFUSED job name, described but never echoed.
 *
 *  `shownJobName` above is for a name that PASSED the screen, where echoing it
 *  is how a developer finds the call. This is the other case, and it cannot
 *  use it: the names this describes are precisely the ones a VALUE rule
 *  matched, so printing one copies an email address, a token or a customer id
 *  into the host's log in order to say that it must not travel. Production
 *  stderr is collected and shipped like any other destination.
 *
 *  What is left is still enough to find the call: the RULE that fired (from
 *  {@link whyNameRefused}) and the length, which is bounded and cannot be read
 *  back into the name. */
function refusedJobNameShape(name: unknown): string {
  if (typeof name !== "string") return `a job name of type ${typeof name}`;
  const trimmed = name.trim();
  if (trimmed.length === 0) return "an empty job name";
  return `a background job whose name is ${trimmed.length} characters`;
}

/** The ledger key for a name refusal — the RULE, never the name. One line per
 *  rule per process, so an app reporting a thousand runs of one badly-named
 *  job prints one line, and an app with a thousand bad names still prints one
 *  line per rule rather than a thousand. */
function nameRefusalCause(name: unknown): string {
  if (typeof name !== "string") return "type";
  const trimmed = name.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.length > MAX_JOB_NAME_LEN) return "length";
  return jobNameHasPII(trimmed) ?? "value";
}

/** Why `cleanName` turned a declaration away, in the developer's terms and
 *  naming the thing they can change. Never "invalid name". */
function whyNameRefused(name: unknown): string {
  if (typeof name !== "string") {
    return `Boosthis wants the job's name as a string and was given ${typeof name}.`;
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) return "the name was empty.";
  if (trimmed.length > MAX_JOB_NAME_LEN) {
    return (
      `the name is ${trimmed.length} characters and a job name here must be ${MAX_JOB_NAME_LEN} or fewer. ` +
      `It is refused rather than shortened, because two names cut to the same ${MAX_JOB_NAME_LEN} characters would be filed as one job.`
    );
  }
  // The RULE, named. "Did not pass the guard" told a developer nothing they
  // could act on, and it was also misleading: spaces are allowed in a job
  // name, so the rule that fired is always one about a VALUE.
  const rule = jobNameHasPII(trimmed);
  return (
    `the name matched ${rule ?? "a value rule"}, so it reads as something built out of a value rather than a label. ` +
    "Spaces are fine — \"queue drain\" is a name. An email address, a token, an IP address, a phone number, a UUID or a run of six or more digits is not: " +
    "name the job the way nightly-billing is written."
  );
}

/**
 * Take Boosthis's answer to a declaration.
 *
 * The ONE place `statedEveryMs` is ever set. The rhythm in force may not be
 * the rhythm asked for — minutes are the stored unit, and an owner's setting
 * on the project page outranks the code — so the kit adopts what came back,
 * which is by construction the same number the server judges the job by.
 */
function takeExpectationOutcome(outcome: {
  job: string;
  stored: boolean;
  everyMinutes?: number;
  graceMinutes?: number;
}): void {
  try {
    const tally = tallies.get(outcome.job);
    if (!tally) return;
    if (
      outcome.stored === true &&
      typeof outcome.everyMinutes === "number" &&
      Number.isFinite(outcome.everyMinutes) &&
      outcome.everyMinutes > 0
    ) {
      tally.statedEveryMs = outcome.everyMinutes * 60_000;
      // The allowance travels with the rhythm, because the kit judges a missed
      // run by it. A server that stored the rhythm without saying what it will
      // allow leaves this null, and `missedAfterMs` says what happens then.
      tally.statedAllowanceMs =
        typeof outcome.graceMinutes === "number" &&
        Number.isFinite(outcome.graceMinutes) &&
        outcome.graceMinutes >= 0
          ? (outcome.everyMinutes + outcome.graceMinutes) * 60_000
          : null;
      return;
    }
    // Refused. Nothing is watching this job, so nothing here may act as though
    // something were: fall back to whatever the learner can prove on its own.
    tally.statedEveryMs = null;
    tally.statedAllowanceMs = null;
  } catch {
    /* a meter must never break the host */
  }
}
setJobExpectationHandler(takeExpectationOutcome);

/**
 * Whether the code running right now is already inside a measured run.
 *
 * A project can be in both situations at once: the kit attached to its queue
 * library by itself, AND the developer marked their handlers by hand — because
 * they followed the instructions for a project the kit could not attach to,
 * or because they added the marks before upgrading, or because half their
 * queues are in one situation and half in the other. Counting both would
 * silently double every number that project sees, which is a worse failure
 * than measuring nothing: an empty dashboard at least looks empty.
 *
 * So the OUTER measurement wins and anything nested inside it is handed
 * straight through. The outer one is already timing exactly the same work.
 */
interface MeasuredJobMark {
  /** The run's LINKED STEPS scope (linkedSteps.ts): the database and
   *  outside-service calls this run makes, linked to the run's own step.
   *  Null when the caller handed no run, or the kit is switched off. */
  linked: LinkedScope | null;
}

const insideMeasuredJob = new AsyncLocalStorage<MeasuredJobMark>();

/** Each run's linked-step scope, keyed by the run's own handle so it is
 *  collected with it. */
const linkedByRun = new WeakMap<JobRun, LinkedScope>();

// A call made inside a measured run is linked to THAT run, ahead of any
// request it happens to sit inside (linkedSteps.currentLinkedScope).
setJobLinkedScopeReader(() => insideMeasuredJob.getStore()?.linked ?? null);

/** Run the host's own job function, with everything it does marked as already
 *  being measured. Used by the adapters, which measure the run themselves.
 *  `run` is the measurement it belongs to: the database and outside-service
 *  calls the function makes are linked to that run's own step. A run that is
 *  not measured here (nested inside another, so handed through) has no scope
 *  of its own and keeps the outer run's. */
export function runInsideMeasuredJob<T>(fn: () => T, run?: JobRun | null): T {
  try {
    const own = run ? linkedByRun.get(run) : undefined;
    const linked = own ?? insideMeasuredJob.getStore()?.linked ?? null;
    return insideMeasuredJob.run({ linked }, fn);
  } catch (err) {
    // Never swallow: the host's own failure is the caller's to handle.
    throw err;
  }
}

/** At most one job run's linked steps per job name per minute. A job that
 *  runs every second would otherwise send sixty runs a minute, each a copy of
 *  the same lines; one a minute keeps every line on the map measured and
 *  current, and costs a busy queue almost nothing. */
const JOB_STEPS_MIN_GAP_MS = 60_000;
/** Bounded like every other per-name table here. */
const MAX_JOB_STEP_NAMES = 256;
const lastJobStepsAt = new Map<string, number>();

/**
 * Send one finished run's own step (kind `job`, labelled with the grouped job
 * name exactly as the row table already files it) and the linked steps made
 * inside it, as one group. Only when the run made at least one linked call,
 * and at most once a minute per job name. Never throws.
 */
function sendJobRunSteps(
  key: string,
  linked: LinkedScope | null,
  durationMs: number,
  failedRun: boolean,
): void {
  try {
    const folds = closeLinkedScope(linked);
    if (folds.length === 0) return;
    const label = `${JOB_PREFIX}${key}`;
    if (label.length > MAX_PART_NAME) return;
    const now = Date.now();
    const last = lastJobStepsAt.get(key);
    if (last !== undefined && now - last < JOB_STEPS_MIN_GAP_MS) return;
    const traceId = newTraceId();
    const spanId = newSpanId();
    const sent = enqueueJobRunSteps(
      {
        traceId,
        layer: "node",
        routeLabel: label,
        durationMs,
        startOffsetMs: 0,
        rating: failedRun ? "poor" : rateSpanDuration(durationMs),
        spanId,
        kind: "job",
        outcome: failedRun ? "error" : "ok",
      },
      linkedStepSpans(folds, { traceId, layer: "node", parentSpanId: spanId, baseOffsetMs: 0 }),
    );
    if (!sent) return;
    if (!lastJobStepsAt.has(key) && lastJobStepsAt.size >= MAX_JOB_STEP_NAMES) {
      lastJobStepsAt.clear();
    }
    lastJobStepsAt.set(key, now);
  } catch {
    /* a job's lines are never worth disturbing the job for */
  }
}

/**
 * Mark the start of one job run by hand. The single obvious way to measure a
 * job the kit could not attach to on its own.
 *
 * Returns a handle whose `done()` / `failed()` closes the run. Both are safe
 * to call twice and neither ever throws, so a `finally` block can call one
 * without a guard of its own.
 *
 * A handle marks a span the kit cannot see the end of, so it cannot establish
 * the "already measured" scope the way {@link trackJob} does: a mark nested
 * inside a handle-marked job is only suppressed if it sits inside an adapter's
 * or a `trackJob`'s scope. Nesting one handle inside another therefore records
 * both. `trackJob` is the form to reach for when a job may contain other
 * marked work.
 */
export function beginJob(name: string, opts: JobRunOptions = {}): JobRun {
  try {
    if (isBoosthisDisabled() || isKitLocked()) return NOOP_RUN;
    // Already being measured by whoever called us — see above.
    if (insideMeasuredJob.getStore() !== undefined) return NOOP_RUN;
    const clean = cleanName(name);
    if (clean === null) {
      // Said, once per cause. This is the drop that made a job invisible:
      // measured nowhere, on no surface, with no counter and no line — so
      // the owner could not tell a job that never ran from one whose name
      // was turned away here.
      noteJobNameRefused(typeof name === "string" ? name : String(name));
      sayJobNameRefusedOnce(
        nameRefusalCause(name),
        `[boosthis] Boosthis is not measuring ${refusedJobNameShape(name)}: ${whyNameRefused(name)} ` +
          `The name itself is not printed: it is exactly the string the rule says must not travel, and your logs are somewhere it would travel to. ` +
          `Its runs are not counted and it will not appear anywhere — it is not late, and it is not "never reported"; it does not exist.`,
      );
      return NOOP_RUN;
    }

    const now = Date.now();
    const started = performance.now();
    const { key, tally } = tallyFor(clean);

    noteStart(tally, now);
    // The start-up rule (startupEvent): a job run once at boot is ordinary
    // until it repeats. A run that STARTED before the process settled is
    // counted apart and never folded into a graded figure — its failure, its
    // queue wait, its overlap with another boot run.
    const settledRun = isSettledAt("startupEvent", now);
    if (!settledRun) settlingRunCount += 1;
    if (tally.active > 0 && settledRun) tally.overlaps += 1;
    const tracked = activeTotal() < MAX_ACTIVE_TRACKED;
    if (tracked) tally.active += 1;
    // Capacity: credit the in-flight time so far, then mark the job busy from
    // here if nothing of it was in flight a moment ago.
    const ring = capRing(tally, now);
    capAccrue(ring, now);
    if (tracked && ring.busyFromMs === null) ring.busyFromMs = now;

    if (typeof opts.system === "string" && opts.system.length > 0) {
      attachedSystems.add(opts.system);
    } else {
      manualRuns += 1;
    }

    const attempt =
      typeof opts.attempt === "number" && Number.isFinite(opts.attempt)
        ? Math.max(1, Math.floor(opts.attempt))
        : 1;

    // Wait is counted from when the job became READY, never from when it was
    // created. `readyAtMs` decides on its own whenever it was passed at all —
    // even unreadably — so a caller that tried to say "ready at" and could not
    // never falls back to a creation time that would count a planned delay.
    const readyAt =
      opts.readyAtMs !== undefined ? opts.readyAtMs : opts.queuedAtMs;
    /** This run's wait, when it has one that may be graded. */
    let runWaitMs: number | undefined;
    if (typeof readyAt === "number" && Number.isFinite(readyAt)) {
      const waited = now - readyAt;
      // A negative wait is a ready time still ahead of this process's clock —
      // a clock disagreement between the enqueuing process and this one, or a
      // job taken early — not a job that waited less than nothing. No wait is
      // recorded rather than a nonsense number.
      if (waited >= 0 && settledRun) {
        runWaitMs = waited;
        waits.push(waited);
        if (waits.length > DURATION_RING) waits.shift();
        waitRuns += 1;
        const slot = capSlot(ring, Math.floor(now / capacityBucketMs));
        slot.waitCount += 1;
        slot.waitSumMs += waited;
      }
    }

    // A job that arrived as a platform invocation is the serverless lifecycle
    // problem again, not a second one: the same arming the request path uses,
    // so the run's measurements are flushed before the platform freezes the
    // process. Nothing here duplicates that path — it calls it.
    const hosted = isServerlessMode();
    if (hosted) {
      hostedRuns += 1;
      beginInvocation();
    }

    // The run's linked-step scope. Only a run measured AROUND its function —
    // by an adapter, or by `trackJob` — can collect anything into it: a bare
    // handle marks a run the kit cannot see inside, so it sends no lines.
    const linked = openLinkedScope(started);

    let closed = false;
    const close = (failedRun: boolean, error?: unknown): void => {
      try {
        if (closed) return;
        closed = true;
        const dur = performance.now() - started;

        if (tracked && tally.active > 0) tally.active -= 1;
        // Capacity: the in-flight time up to this finish, the finish itself,
        // and the job going idle if this was the last of it in flight.
        const endedAt = Date.now();
        capAccrue(ring, endedAt);
        if (tracked && tally.active === 0) ring.busyFromMs = null;
        capSlot(ring, Math.floor(endedAt / capacityBucketMs)).finishes += 1;
        if (settledRun) tally.runs += 1;
        if (attempt > 1 && settledRun) {
          tally.retried += 1;
          if (attempt > tally.retryWorst) tally.retryWorst = attempt;
        }
        if (dur > tally.worstMs) tally.worstMs = dur;
        if (failedRun && settledRun) tally.failed += 1;

        durations.push(dur);
        if (durations.length > DURATION_RING) durations.shift();

        // Filed as an ordinary sample so the existing row table, budgets and
        // every per-row surface show the job beside request work. A failed run
        // is rated `poor` whatever its duration: a fast crash is not a fast
        // success, and letting the duration decide would hide it.
        record(
          `${JOB_PREFIX}${key}`,
          dur,
          failedRun ? "poor" : rateDuration(dur),
        );

        // A job that crashes is reported exactly as clearly as a crash inside
        // a request — same fingerprint, same redaction, same batch.
        if (failedRun && error !== undefined) reportJobError(error);

        // The same finished run is also filed through the run reporter, so a
        // job measured here lands in the project's per-day job history and is
        // judged against a stated rhythm exactly like a run an app reports by
        // hand. Only the grouped name, the outcome, the duration and — for a
        // settled run whose ready time was readable — the wait travel.
        reportJobRun({
          job: key,
          durationMs: dur,
          ok: !failedRun,
          ...(runWaitMs !== undefined ? { waitMs: runWaitMs } : {}),
        });

        // The run's lines to its database and outside services, for the
        // project map (linkedSteps.ts). Rides the span upload and its gates.
        sendJobRunSteps(key, linked, dur, failedRun);

        if (hosted) void finishInvocation();
      } catch {
        /* closing a measurement must never break the host's job */
      }
    };

    const handle: JobRun = {
      done: () => close(false),
      failed: (error?: unknown) => close(true, error),
    };
    if (linked) linkedByRun.set(handle, linked);
    return handle;
  } catch {
    return NOOP_RUN;
  }
}

/**
 * Measure one job run around a function. The convenience wrapper over
 * {@link beginJob} — it re-throws whatever the job threw, unchanged, after
 * recording the failure.
 */
export async function trackJob<T>(
  name: string,
  fn: () => Promise<T> | T,
  opts: JobRunOptions = {},
): Promise<T> {
  const run = beginJob(name, opts);
  try {
    // Everything the job does is now inside a measured run, so a nested mark
    // — another `trackJob`, or an adapter that attaches to a queue this job
    // pushes work onto — is handed through instead of counted a second time.
    const out = await runInsideMeasuredJob(() => fn(), run);
    run.done();
    return out;
  } catch (error) {
    run.failed(error);
    throw error;
  }
}

/** An adapter attached itself to a job system and will report its runs. */
export function noteJobSystemAttached(system: string): void {
  try {
    if (typeof system === "string" && system.length > 0) {
      attachedSystems.add(system);
      unattachedSystems.delete(system);
    }
  } catch {
    /* never throws */
  }
}

/** This process loaded a job system this kit has no safe funnel for. The count
 *  ships beside the reading so a blind spot can never render as "no jobs". */
export function noteJobSystemUnattached(system: string): void {
  try {
    if (
      typeof system === "string" &&
      system.length > 0 &&
      !attachedSystems.has(system)
    ) {
      unattachedSystems.add(system);
    }
  } catch {
    /* never throws */
  }
}

/** How many job systems this app uses that this kit cannot watch. */
export function unattachedJobSystemCount(): number {
  return unattachedSystems.size;
}

/** How many job systems this kit attached to on its own. */
export function attachedJobSystemCount(): number {
  return attachedSystems.size;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return Math.round(sorted[idx]);
}

/**
 * The label-free aggregate the axis scores.
 *
 * `now` is injectable so a caller (and the tests) can judge a missing run
 * without waiting for wall clock. Missing runs are counted BOTH from gaps
 * already seen and from the silence since the last run — a job that simply
 * stopped never produces another gap, so counting only the first would make
 * the worst case the one this meter cannot see.
 */
let settlingRunCount = 0;

/** Runs that started before the process settled: counted apart, never graded
 *  (the start-up rule). */
export function jobWorkSettlingRuns(): number {
  return settlingRunCount;
}

export function getJobWorkStats(now: number = Date.now()): JobWorkStatsLike {
  let runs = 0;
  let failed = 0;
  let retried = 0;
  let retryWorst = 1;
  let overlaps = 0;
  let worstMs = 0;
  let missed = 0;
  let recurring = 0;

  let capacity: CapacityRead | null = null;
  for (const [name, tally] of tallies) {
    // The everything-else group is many jobs' runs pooled, so it has no one
    // worker whose capacity it could describe.
    if (name !== JOB_OTHER_NAME) {
      const read = capacityOf(tally, now);
      if (read !== null && capacityOutranks(read, capacity)) capacity = read;
    }
    runs += tally.runs;
    failed += tally.failed;
    retried += tally.retried;
    if (tally.retryWorst > retryWorst) retryWorst = tally.retryWorst;
    overlaps += tally.overlaps;
    if (tally.worstMs > worstMs) worstMs = tally.worstMs;
    missed += tally.missed;

    const cadence = cadenceOf(tally);
    if (cadence !== null) {
      recurring += 1;
      // The silence since the last run. This is the half that matters most: a
      // job that stopped for good files no further gap, so without this a
      // permanently dead schedule would read as a job with nothing to report.
      if (tally.lastStartMs !== null && tally.active === 0) {
        const quiet = now - tally.lastStartMs;
        const allowance = missedAfterMs(tally) ?? cadence * MISSED_GAP_FACTOR;
        if (quiet > allowance) {
          const skipped = Math.round(quiet / cadence) - 1;
          if (skipped > 0) missed += skipped;
        }
      }
    }
  }

  return {
    runs,
    jobNames: tallies.size,
    otherNames: foldedNames.size,
    failed,
    retried,
    retryWorst,
    overlaps,
    worstMs: Math.round(worstMs),
    p95Ms: percentile(durations, 95),
    waitRuns,
    waitP95Ms: waitRuns > 0 ? percentile(waits, 95) : null,
    missed,
    recurring,
    hostedRuns,
    manualRuns,
    attachedSystems: attachedSystems.size,
    unattachedSystems: unattachedSystems.size,
    ...(capacity !== null
      ? {
          capFinishes: capacity.finishes,
          capWindowMs: capacity.windowMs,
          capBusy: capacity.busy ? (1 as const) : (0 as const),
          capWaitGrowing: capacity.growing ? (1 as const) : (0 as const),
        }
      : {}),
  };
}

/** Wipe every reading (wired into `forget()` so nothing Boosthis-shaped keeps
 *  counting after erasure). Idempotent. Never throws. */
export function clearJobWork(): void {
  settlingRunCount = 0;
  tallies.clear();
  foldedNames.clear();
  durations = [];
  waits = [];
  waitRuns = 0;
  hostedRuns = 0;
  manualRuns = 0;
  attachedSystems.clear();
  unattachedSystems.clear();
  lastJobStepsAt.clear();
  // Declarations go with the tallies they belong to. Leaving them queued would
  // have the kit re-assert a rhythm for a job it no longer remembers.
  clearJobRhythmDeclarations();
}

/** @internal test seam. */
export const _jobWorkInternals = {
  tallies,
  cleanName,
  percentile,
  JOB_STEPS_MIN_GAP_MS,
  fittedRise,
  /** Shrink (or restore) the capacity window, so a rig can watch a whole one
   *  in seconds. Every job's capacity record starts again. */
  setCapacityWindow(bucketMs: number, buckets: number): void {
    capacityBucketMs = Math.max(1, Math.floor(bucketMs));
    capacityBuckets = Math.max(2, Math.floor(buckets));
    for (const t of tallies.values()) t.cap = null;
  },
};
