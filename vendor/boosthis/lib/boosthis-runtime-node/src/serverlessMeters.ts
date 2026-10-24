/** Serverless-only readings.
 *
 * A function tells you things a long-running server cannot, and hides things a
 * long-running server shows freely. These readings are the first kind. Each one
 * ABSTAINS — `measurable: 0` plus a reason the server words — when the platform
 * cannot supply it, because a reading rendered as zero when we simply could not
 * see it is the lie this whole task exists to stop.
 *
 * What is measurable, and where:
 *
 *   • cold starts and their cost  — everywhere (this process IS a cold start)
 *   • initialisation time         — everywhere (already carried by startupImport)
 *   • the cost WE add             — everywhere; we time our own flush
 *   • measurements lost to a freeze — everywhere
 *   • time-limit headroom         — only where the host hands the function its
 *     remaining time (AWS Lambda's context, and anything that passes one). No
 *     platform states its limit in the environment, so without a context this
 *     abstains.
 *   • memory headroom             — only where the host states a memory ceiling
 *     (Lambda-backed hosts do; Azure does not).
 */

import { linearScore, ratingFor } from "./healthAxes";
import {
  PLATFORM_UNKNOWN,
  hasPerRunCostReadings,
  isPerRunBilled,
  serverlessHost,
  type PlatformCode,
} from "./serverless";
import {
  availabilityOf,
  capabilitiesFor,
  hostKindFor,
  REASON_NOTHING_TO_COMPARE,
  REASON_PLATFORM_DOES_NOT_EXPOSE,
} from "./serverlessPlatform";
import {
  KIT_CEILING_WARN_PCT,
  KIT_COLD_START_CEILING_MS,
  KIT_PER_RUN_CEILING_MS,
  readKitFootprint,
} from "./kitFootprint";
import { deathCounters } from "./serverlessDeath";
import {
  getSuspendWakeCount,
  SUSPEND_UNIT,
  suspendTouchedInterval,
} from "./suspendSensor";
import { noteUndeliveredRows, type UndeliveredCause } from "./dropReport";
import {
  SETTLE_FAMILIES,
  isSettling,
  markSettled,
  settledFromMs,
  settlingReading,
} from "./settleRule";

/* ─── Why a reading could not be taken ─────────────────────────────────── */

/**
 * The SHARED closed vocabulary every kit already uses to say "this reading
 * cannot be taken here" — the kit sends the code, the server owns the words.
 * Deliberately not a new serverless-only vocabulary: a second numbering would
 * render as a blank "not available here" with no reason, because the server
 * only knows this one.
 *
 * Only one code applies to these readings: neither a time limit nor a memory
 * ceiling is something the app can go and switch on. The platform either states
 * it in the environment (or hands it to the function) or it does not.
 *
 * Imported from the capability table rather than re-declared here — a second
 * copy of a reason code is how one surface starts explaining a silence and
 * another shows a blank.
 */

/* ─── Where a flush ran ────────────────────────────────────────────────── */

/**
 * WHERE the flush happened, relative to the visitor's response. Three places,
 * because two of them are free to the visitor for entirely different reasons
 * and only one of them is evidence about the platform:
 *
 *   - `blocking`        — the response was held open for it. The visitor waited.
 *   - `platform`        — handed to the platform's own after-the-reply
 *                         mechanism (`waitUntil`). The visitor waited for
 *                         nothing AND the platform demonstrably has one.
 *   - `after-response`  — run by us once the response had completed, on a host
 *                         whose process survives the answer. The visitor waited
 *                         for nothing; the platform proved nothing.
 *
 * Collapsing the last two into one boolean is what let a scheduling choice of
 * ours be filed as a platform ability in the host-facts record.
 */
export type FlushPlacement = "blocking" | "platform" | "after-response";

/* ─── State (per instance — an instance is one cold start) ─────────────── */

let invocations = 0;
let addedMsTotal = 0;
let addedMsWorst = 0;
let visitorMsWorst = 0;
let flushesTimed = 0;
let deferredFlushes = 0;
/** Of those, the ones the PLATFORM's own after-the-reply mechanism took. A
 *  flush we simply ran past the response ourselves — on a job runner, or any
 *  per-run-billed process that keeps its processor — is equally free to the
 *  visitor, but it is NOT evidence that the platform offers `waitUntil`, and
 *  the host-facts record must never learn a platform ability from our own
 *  scheduling choice. */
let platformDeferredFlushes = 0;
let blockingFlushes = 0;
/** Gathered and then DISCARDED — these can never arrive. */
let lostRows = 0;
/** Still buffered when an invocation ended. They arrive late if the instance
 *  wakes again, and never if it does not. Not the same thing as lost, and
 *  reported separately so neither is overstated. */
let strandedRows = 0;
let strandedFlushes = 0;
/** Of those, how many are STILL not out. Stranded is cumulative — it answers
 *  "how often does this happen" — and would double-count a row that rode the
 *  next wake, so the delivery score reads this gauge instead: it goes up when a
 *  flush leaves rows behind and back down as they finally arrive. */
let outstandingStranded = 0;
/** Measurements this instance actually got out. The denominator for the
 *  delivery score — without it, "nothing was lost" and "nothing was ever
 *  gathered" would score the same. */
let deliveredRows = 0;

/** Closest a run came to the time limit, as a percentage of the limit used. */
let worstTimeUsedPct: number | null = null;
let worstRemainingMs: number | null = null;
let timeLimitMs: number | null = null;
let timedRuns = 0;

let peakRssMb = 0;

/* ── The start-up rule ───────────────────────────────────────────────────
 * An invocation is SETTLED when it begins once the process has settled
 * (peakRate, 60 s) and is not the instance's first. Start-up work (module
 * loading, the first connection, the first run's cold caches) decides
 * nothing: the memory peak, the time-limit tail, the typical-invocation
 * distributions behind the serverless verdict and the per-run figures the
 * money view prices are taken over settled invocations only
 * (docs/settle-rule-contract.md, docs/settle-rule-decisions.md). */
let settledRuns = 0;
let settledPeakRssMb = 0;
/** Settled timed runs: the share of the time limit used, and what remained. */
const settledTimeRing: Array<{ pct: number; remainingMs: number }> = [];
/** Warm runs a kit-overhead average needs before it is representative. */
const KIT_FOOTPRINT_MIN_WARM_RUNS = 5;

function settledInvocation(beginSeq: number, startedAtMs: number): boolean {
  return beginSeq > 1 && startedAtMs >= settledFromMs("peakRate");
}

/* ─── Start-up, per-run cost and the platform's other limits ───────────── */

/**
 * How far into this process's life the FIRST request arrived.
 *
 * That gap is the cold start, and on a function it is the honest one: nothing
 * before it was serving anybody, and the customer paid for all of it. Read from
 * process uptime rather than timed by us, so it includes the runtime's own boot
 * and the app's imports — the parts a monitoring kit is usually careful not to
 * mention.
 */
let initMs: number | null = null;
/** The first request on this instance always pays for a cold cache, cold
 *  connections and lazily-loaded modules. Kept apart from the warm ones so the
 *  split between "loading" and "working" is a measurement, not an estimate. */
let firstRunMs: number | null = null;
let warmRunTotalMs = 0;
let warmRuns = 0;

/** Wall time and computing time across every run on this instance. Their
 *  DIFFERENCE is the money question: a function is billed while it sits waiting
 *  on somebody else's database, so time that was not computing time is time
 *  bought and not used. */
let runWallTotalMs = 0;
let runCpuTotalMs = 0;
let runsCounted = 0;
let failedRuns = 0;

/** Worst per-run figures for the limits the platform MIGHT cap. Measured
 *  everywhere, compared against a ceiling only where one exists. The `sampled`
 *  flag keeps "no run has been looked at" from rendering as "no calls were
 *  made" — a zero nobody measured is the dishonesty this whole reading is
 *  built to refuse. */
let onwardCallsWorst = 0;
let onwardCallsSampled = false;
let cpuMsWorst = 0;
/** Runs whose processor time could honestly be called their own — every run on
 *  a function, and only the un-overlapped ones on a container. Kept apart from
 *  `runsCounted` so an average is divided by the runs it was actually made of. */
let cpuRunsCounted = 0;

/* ── Runs in flight ──────────────────────────────────────────────────────
 *
 * A real function serves ONE run at a time — that is the model, and every
 * platform in the table enforces it. A container billed like a function does
 * not: Cloud Run's default is eighty requests on one instance at once. A single
 * pair of module-level "the run started at" variables cannot describe two runs
 * that overlap — the second start overwrites the first, the first end closes
 * the wrong boundary, and the second end finds nothing left to close. Counts,
 * durations, distributions and the money view all go quietly wrong.
 *
 * So each run carries its own boundary: handed back when it begins, presented
 * again when it ends. Nothing about a run lives in a module variable.
 */
export interface RunMark {
  /** When this particular run began. */
  readonly wallStartMs: number;
  /** Processor time the whole process had used when it began, or null where
   *  the runtime will not say. */
  readonly cpuStartUs: number | null;
  /** Was another run already open when this one began? */
  readonly overlappedAtStart: boolean;
  /** How many runs had begun on this instance when this one did. Read again at
   *  the end: if the number has moved, somebody else's work ran on the same
   *  processor during this run, so this run has no computing time of its own to
   *  claim. Counting rather than keeping a register of open runs is deliberate
   *  — a run that never ends would leak an entry forever. */
  readonly beginSeq: number;
  /** Guard: a run may be closed exactly once, however many host events fire. */
  ended: boolean;
}

/** How many runs are open right now, how many have ever begun, and whether any
 *  two of them ever overlapped on this instance. */
let runsOpen = 0;
let runsBegun = 0;
let runsOverlapped = false;

/* ── What the instance was actually billed for ───────────────────────────
 *
 * The UNION of the time at least one run was open — not the sum of the runs.
 * On a function the two are the same number, because runs never overlap. On a
 * container serving many at once they are wildly different, and the sum is the
 * wrong one: the customer is billed for the instance being busy, not for each
 * request separately. Measuring the union keeps the money view honest in both
 * worlds, and it is the only base the process-wide processor reading can
 * honestly be compared against.
 */
let instanceBusyMs = 0;
let instanceBusyCpuMs = 0;
let busyStartWallMs: number | null = null;
let busyStartCpuUs: number | null = null;

/* ── The part of the bill the HOST took away ─────────────────────────────
 *
 * On a container whose processor freezes between requests, wall-clock time
 * passes inside a billed window while nothing of ours runs. The money view
 * subtracts processor time from billed time and calls the difference
 * "waiting" — which on such a host charges the app for the machine's nap.
 * Our own live server published 86% waiting on exactly that shape, and the
 * verdict read as though the application had chosen to spend its time that
 * way (docs/kit-footprint-suspend-2026-09.md has the sibling case).
 *
 * So each billed window is offered to the SAME suspend sensor every other
 * wall-clock reading consults, and a window the host stopped running us
 * inside banks its unaccounted wall time here instead of into the app's
 * waiting figure. Both numbers are published: the bill is still the bill, and
 * the verdict is about what is left once the nap is taken out.
 *
 * Zero on a host that never suspends — the sensor cannot fire there — so a
 * real function's cost verdict is exactly what it was before this existed.
 */
let napBilledMs = 0;
let napWindows = 0;
/** Billed windows closed so far, so "all of them were naps" can be told from
 *  "some were". A verdict needs something left to judge. */
let billedWindows = 0;

/* ── Distributions ──────────────────────────────────────────────────────
 * A worst case alone cannot answer "is this normal or was that one run
 * unlucky", and on a cliff-edge platform that difference decides whether a
 * customer should act. A small ring of recent readings gives an exact middle
 * and an exact tail without keeping a sample per run forever. */
const DIST_CAP = 128;

function pushSample(ring: number[], v: number): void {
  if (!Number.isFinite(v)) return;
  ring.push(v);
  if (ring.length > DIST_CAP) ring.shift();
}

function percentile(ring: readonly number[], p: number): number | null {
  if (ring.length === 0) return null;
  const sorted = [...ring].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return Math.round(sorted[idx]!);
}

const timeUsedPctRing: number[] = [];
const memUsedPctRing: number[] = [];
const runWallRing: number[] = [];

function cpuUsageUs(): number | null {
  try {
    const u = process.cpuUsage();
    return u.user + u.system;
  } catch {
    return null;
  }
}

/** One invocation began on this instance. The mark it hands back is that run's
 *  own boundary and must be presented again when the run ends. */
export function noteInvocation(): RunMark {
  invocations++;
  try {
    const rssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
    if (rssMb > peakRssMb) peakRssMb = rssMb;
  } catch {
    /* memoryUsage is unavailable on some hosts — the axis abstains */
  }
  try {
    if (initMs === null) initMs = Math.max(0, Math.round(process.uptime() * 1000));
  } catch {
    /* a runtime with no uptime leaves the cold-start split abstaining */
  }
  const now = Date.now();
  const cpuNow = cpuUsageUs();
  const overlappedAtStart = runsOpen > 0;
  if (overlappedAtStart) runsOverlapped = true;
  // The instance goes from idle to busy: this is where the billed window opens.
  if (runsOpen === 0) {
    busyStartWallMs = now;
    busyStartCpuUs = cpuNow;
  }
  runsOpen++;
  runsBegun++;
  if (settledInvocation(runsBegun, now)) {
    try {
      const rssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
      if (rssMb > settledPeakRssMb) settledPeakRssMb = rssMb;
    } catch {
      /* memoryUsage is unavailable on some hosts — the axis abstains */
    }
  }
  return {
    wallStartMs: now,
    cpuStartUs: cpuNow,
    overlappedAtStart,
    beginSeq: runsBegun,
    ended: false,
  };
}

/**
 * One invocation ended. `failed` marks a run that ended in an error — it still
 * cost the same money, which is exactly why failed runs are counted rather than
 * dropped as noise.
 *
 * The computing-time figure is the process's own. On a function that is exactly
 * this run's work, because a function runs one at a time. On a host serving
 * several at once it is not, so an overlapped run keeps no computing time of
 * its own and the money view compares the process's work against the time the
 * INSTANCE was busy instead — the number the customer is actually billed for.
 */
export function noteRunEnd(mark: RunMark | null, failed: boolean): void {
  try {
    if (!mark || mark.ended) return;
    mark.ended = true;
    const endedAt = Date.now();
    const wall = Math.max(0, endedAt - mark.wallStartMs);
    const settledRun = settledInvocation(mark.beginSeq, mark.wallStartMs);
    const cpuNow = cpuUsageUs();
    // Processor time is a PROCESS reading. Attributing it to a run that shared
    // the instance with another would hand one request the work of two, so a
    // run that shared — whether the other one was already running when this
    // began, or arrived while it was working — simply has no computing time of
    // its own. Reported as unknown, never as a number nobody measured.
    const sharedInstance = mark.overlappedAtStart || runsBegun !== mark.beginSeq;
    const cpuMs =
      !sharedInstance && mark.cpuStartUs !== null && cpuNow !== null
        ? Math.max(0, (cpuNow - mark.cpuStartUs) / 1000)
        : null;
    runsOpen = Math.max(0, runsOpen - 1);
    // The instance falls idle: close the billed window. Everything between the
    // first run opening and the last one ending was time the customer paid for
    // once, however many requests shared it.
    if (runsOpen === 0 && busyStartWallMs !== null) {
      const windowWallMs = Math.max(0, endedAt - busyStartWallMs);
      const windowCpuMs =
        busyStartCpuUs !== null && cpuNow !== null
          ? Math.max(0, (cpuNow - busyStartCpuUs) / 1000)
          : null;
      instanceBusyMs += windowWallMs;
      if (windowCpuMs !== null) instanceBusyCpuMs += windowCpuMs;
      billedWindows++;
      // The same question the lag, freeze, floor and footprint readings ask
      // before believing a wall clock: did the host stop running us inside
      // this stretch? Only the unaccounted part is banked — the processor
      // time inside the window was genuinely ours either way.
      if (
        windowCpuMs !== null &&
        suspendTouchedInterval({
          endedAtMs: endedAt,
          wallMs: windowWallMs,
          cpuMs: windowCpuMs,
        })
      ) {
        napWindows++;
        napBilledMs += Math.max(0, windowWallMs - windowCpuMs);
      }
      busyStartWallMs = null;
      busyStartCpuUs = null;
    }

    runsCounted++;
    runWallTotalMs += wall;
    if (settledRun) {
      settledRuns++;
      pushSample(runWallRing, wall);
    }
    if (failed) failedRuns++;
    if (cpuMs !== null) {
      runCpuTotalMs += cpuMs;
      cpuRunsCounted++;
      if (cpuMs > cpuMsWorst) cpuMsWorst = cpuMs;
    }
    if (firstRunMs === null) firstRunMs = wall;
    else {
      warmRunTotalMs += wall;
      warmRuns++;
    }
    const rssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
    if (rssMb > peakRssMb) peakRssMb = rssMb;
    if (settledRun && rssMb > settledPeakRssMb) settledPeakRssMb = rssMb;
    const limit = serverlessHost().memoryLimitMb;
    if (settledRun && limit && limit > 0) {
      pushSample(memUsedPctRing, Math.min(100, Math.round((rssMb / limit) * 100)));
    }
  } catch {
    /* a failure to measure a run is never a failure of the run */
  }
}

/** How many onward calls one run made. Measured on every platform; turned into
 *  headroom only where the platform actually caps them. */
export function noteRunLimits(onwardCalls: number): void {
  if (!Number.isFinite(onwardCalls)) return;
  onwardCallsSampled = true;
  if (onwardCalls > onwardCallsWorst) onwardCallsWorst = Math.round(onwardCalls);
}

/** How long our own end-of-invocation flush took, and whether the visitor
 *  waited for it. Billed time is the cost in money; visitor time is the cost in
 *  their page load. Both are measured on every flush and published — the whole
 *  point of a stated ceiling is that it is checked against something. */
export function noteFlushCost(ms: number, placement: FlushPlacement): void {
  const v = Math.max(0, Math.round(ms));
  addedMsTotal += v;
  flushesTimed++;
  if (v > addedMsWorst) addedMsWorst = v;
  if (placement === "blocking") {
    blockingFlushes++;
    if (v > visitorMsWorst) visitorMsWorst = v;
  } else {
    // Both remaining placements cost the visitor nothing: the response is
    // already on its way out. Only one of them says anything about the
    // PLATFORM.
    deferredFlushes++;
    if (placement === "platform") platformDeferredFlushes++;
  }
  warnIfOverStatedDelay();
}

/* ─── The delay the kit says it adds, and what happens when it doesn't ──── */

/**
 * WHAT THE KIT SAYS ITS SENDING COSTS A REQUEST, in milliseconds of average
 * added delay.
 *
 * A published ceiling with nothing checking it is a sentence, not a promise —
 * which is how our own server came to add 329 ms to the average request
 * without anything anywhere objecting. This is the figure the kit is held to,
 * beside `KIT_PER_RUN_CEILING_MS`, which covers the separate question of what
 * the INSTRUMENTATION costs. Fifty milliseconds is one small upload: the flush
 * is a handful of batched rows, and anything an order of magnitude past that
 * is the kit doing something other than sending them.
 */
export const FLUSH_ADDED_MS_CEILING = 50;

/** Judged only once there are enough flushes for an average to mean anything.
 *  One cold start on a slow network is not a breach of a ceiling. */
const FLUSH_CEILING_MIN_SAMPLES = 20;

let warnedOverStatedDelay = false;

/**
 * Say so, once, when the kit is costing more than it published.
 *
 * Through the same channel as every other problem the kit reports — one
 * ungated line on stderr, naming the figure, the ceiling and what to do — for
 * the same reason: this exists for the developer who does not yet suspect the
 * kit. Buried in an axis they would have to know to expand, it is not a
 * promise anyone is held to.
 */
function warnIfOverStatedDelay(): void {
  if (warnedOverStatedDelay) return;
  if (flushesTimed < FLUSH_CEILING_MIN_SAMPLES) return;
  const avg = Math.round(addedMsTotal / flushesTimed);
  if (avg <= FLUSH_ADDED_MS_CEILING) return;
  warnedOverStatedDelay = true;
  try {
    console.warn(
      `[boosthis] Boosthis is adding ${avg}ms to the average request, ` +
        `past the ${FLUSH_ADDED_MS_CEILING}ms it publishes. ` +
        `Uploads are taking far longer than one small batch should — check ` +
        `this app's network path to Boosthis.`,
    );
  } catch {
    // A broken console must never take the host down.
  }
}

/** Measurements DISCARDED — gathered, then thrown away. These can never
 *  arrive, so they are the honest "lost" number.
 *
 *  The cause travels with them. A row evicted to make room for a newer one and
 *  a row given up on after being held too long are two different failures with
 *  two different answers, and a developer who is only shown a total cannot act
 *  on either. Both are also reported through the kit's own problem channel
 *  (`dropReport`), so a loss is something a developer is TOLD rather than a
 *  field inside an axis they must know to expand. */
export function noteRowsDiscarded(
  rows: number,
  cause: UndeliveredCause = "bufferFull",
): void {
  if (rows <= 0) return;
  lostRows += rows;
  // A discarded row is no longer waiting: it has ended, badly. Taking it off
  // the outstanding gauge keeps the two numbers from claiming the same row
  // twice — once as lost and once as still-to-come.
  if (outstandingStranded > 0) {
    outstandingStranded = Math.max(0, outstandingStranded - rows);
  }
  try {
    noteUndeliveredRows(cause, rows);
  } catch {
    /* telling someone about a lost row may never break the path that lost it */
  }
}

/** Measurements that reached us. */
export function noteRowsDelivered(rows: number): void {
  if (rows <= 0) return;
  deliveredRows += rows;
  // An arrival clears the backlog first: these are the rows a previous
  // invocation left behind, finally getting out on a later wake.
  if (outstandingStranded > 0) {
    outstandingStranded = Math.max(0, outstandingStranded - rows);
  }
}

/**
 * Measurements still buffered when the invocation ended. They ride the next
 * wake if there is one.
 *
 * TAKES THE GAUGE, NOT A DELTA. The caller reads how many rows are held RIGHT
 * NOW; it has no way to know which of them were already counted. Adding that
 * reading to a running total counted the same undelivered row once per flush,
 * so a single stuck batch of 100 read as thousands of stranded measurements
 * after an hour of flushes — a number that described our flush frequency, not
 * the size of the hole. Only the rise above what was already outstanding is
 * new, so `strandedRows` answers "how many distinct measurements have ever
 * been left behind" and the gauge answers "how many are still waiting".
 */
export function noteStranded(rowsHeldNow: number): void {
  if (rowsHeldNow <= 0) return;
  const newlyStranded = Math.max(0, rowsHeldNow - outstandingStranded);
  strandedRows += newlyStranded;
  strandedFlushes++;
  outstandingStranded = rowsHeldNow;
}

/** How many gathered measurements are STILL held, right now. Read by the
 *  lifecycle so a backlog that never drains can be given an ending rather than
 *  being held for the life of the instance. */
export function outstandingStrandedRows(): number {
  return outstandingStranded;
}

/** Remaining time reported by the host at the END of an invocation, against the
 *  function's configured limit. Only a host that hands the function a context
 *  can supply this. */
export function noteTimeRemaining(remainingMs: number, limitMs: number): void {
  if (!Number.isFinite(remainingMs) || !Number.isFinite(limitMs)) return;
  if (limitMs <= 0) return;
  const remaining = Math.max(0, Math.round(remainingMs));
  const usedPct = Math.min(
    100,
    Math.max(0, Math.round(((limitMs - remaining) / limitMs) * 100)),
  );
  // The instance's first timed run, and any run before the process settled,
  // is start-up: it keeps its count but decides no share.
  const settledTimed = timedRuns > 0 && Date.now() >= settledFromMs("latencyTail");
  timedRuns++;
  timeLimitMs = Math.round(limitMs);
  if (settledTimed) {
    pushSample(timeUsedPctRing, usedPct);
    settledTimeRing.push({ pct: usedPct, remainingMs: remaining });
    if (settledTimeRing.length > DIST_CAP) settledTimeRing.shift();
  }
  if (worstTimeUsedPct === null || usedPct > worstTimeUsedPct) {
    worstTimeUsedPct = usedPct;
    worstRemainingMs = remaining;
  }
}

export function serverlessCounters(): {
  invocations: number;
  addedMsWorst: number;
  addedMsAvg: number;
  visitorMsWorst: number;
  deferredFlushes: number;
  blockingFlushes: number;
  lostRows: number;
  strandedRows: number;
} {
  return {
    invocations,
    addedMsWorst,
    addedMsAvg: flushesTimed > 0 ? Math.round(addedMsTotal / flushesTimed) : 0,
    visitorMsWorst,
    deferredFlushes,
    blockingFlushes,
    lostRows,
    strandedRows,
  };
}

/* ─── What this run observed about the PLATFORM ────────────────────────── */

/**
 * The handful of facts about the hosting platform this instance actually
 * observed while doing its job.
 *
 * Not a new measurement and not a new axis: every number below is already
 * tracked above for some other reason, and this only re-reads them as answers
 * to "what does this platform allow?". They ride the snapshot the kit already
 * sends so the server can keep its record of each platform current, and can
 * tell a customer WHEN a "cannot be measured here" answer was last true.
 *
 * Two rules decide every line here.
 *
 * **A key we omit is not a "no".** Where the kit cannot tell "the platform does
 * not offer this" apart from "this instance never asked", the key is left out
 * entirely. Reporting our own deafness as a platform finding is the one way
 * this could make the record worse than the document it replaces, and several
 * of these facts are only ever knowable in the positive direction — which is
 * fine, because the failure that matters is a platform quietly GAINING an
 * ability we recorded as absent.
 *
 * **Nothing here is about the app.** No addresses, no names, no counts of the
 * customer's traffic — six numbers about the platform, identical for every
 * install on it. The platform's own name is not here either: the install
 * declared where it runs when it registered, and the server reads it from
 * there.
 */
export function hostFactObservations(): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    const host = serverlessHost();
    // Only a recognised function host has a platform record to speak to. On an
    // unrecognised one we would be reporting facts about nothing.
    if (host.platform === PLATFORM_UNKNOWN) return out;

    // A countdown, and the limit read off it. Only a host that hands the
    // function a live clock ever gets here, so this is a positive observation:
    // absent means "no run on this instance was given one", which is not the
    // same as "the platform offers none".
    if (timedRuns > 0) {
      out.liveCountdown = 1;
      if (timeLimitMs !== null) out.timeLimitReadable = 1;
    }

    // The memory allowance is the one fact the kit ALWAYS looks for — the host
    // detector reads it at startup on every platform — so a nought here is a
    // real finding rather than a gap.
    out.memoryLimitReadable = host.memoryLimitMb === null ? 0 : 1;
    if (host.memoryLimitMb !== null && host.memoryLimitMb > 0) {
      out.memoryCeilingMb = Math.round(host.memoryLimitMb);
    }

    // A processor clock that MOVES. A run whose clock could not be read at all
    // (every run shared the instance) says nothing; a run that read it and got
    // zero after real work says the method is a refusal wearing a working
    // method's clothes, which is exactly what Supabase's does.
    if (cpuRunsCounted > 0) {
      out.cpuClockReadable = cpuMsWorst > 0 ? 1 : 0;
    }

    // Work handed to the platform's after-the-reply mechanism, which we know
    // RAN because the counter below is incremented by the flush completing.
    // A helper that exists and silently discards the promise never reaches it.
    //
    // Counted from the PLATFORM placement alone. A flush we chose to run after
    // the response on a container that stays alive is equally free to the
    // visitor, but it says nothing whatsoever about what the platform offers —
    // and this record is read as a statement about the platform.
    if (platformDeferredFlushes > 0) out.afterResponseWork = 1;
  } catch {
    /* a fact we cannot read is a fact we do not report */
  }
  return out;
}

/* ─── The axes ─────────────────────────────────────────────────────────── */

type Axis = Record<string, number | string | null>;

/** Delivery score: of everything this instance gathered, how much got out.
 *  100 means nothing was lost to a freeze.
 *
 *  "Not out" is BOTH kinds of not-out: rows discarded (which can never arrive)
 *  and rows still stranded past a freeze (which arrive only if this instance
 *  wakes again, and never if it does not). Scoring only the discarded ones let
 *  an instance strand everything it gathered and still report a perfect 100 —
 *  a quiet gap reading as a healthy one, which is the exact failure this whole
 *  reading exists to make visible. The two numbers stay reported separately
 *  beside the score, so neither is overstated as the other. */
function deliveryScore(delivered: number, lost: number): number {
  const total = delivered + lost;
  if (total <= 0) return 100;
  const lostPct = (lost / total) * 100;
  // 0% lost scores 100; 10% lost or worse scores 0. Losing one measurement in
  // ten is not a blemish on a product whose whole promise is "we measured it".
  return linearScore(lostPct, 0, 10);
}

/**
 * The section anchor: which platform, how many invocations this instance served,
 * what we cost, and what was lost. Present ONLY where a run is billed by the
 * run — a real function, or a container billed per request-second whose
 * processor freezes when it answers. An ordinary long-running server omits it
 * entirely (honest absence, never a zero).
 *
 * Gated on the WIDER question, deliberately: this axis is the anchor every
 * surface keys the whole cost verdict off, so gating it more narrowly than the
 * readings beneath it would leave a frozen container measuring itself and
 * appearing nowhere.
 */
/**
 * WHICH KIND of host every reading in this family is looking at.
 *
 * Read from the shared capability table by every axis here, without exception,
 * so a tile that scores and a tile that abstains are demonstrably answering
 * about the same host. Before this, the cost reading gated on "is this billed
 * by the run?" and its five neighbours gated on the table, and the page showed
 * a red function-cost verdict beside five tiles saying there was nothing to
 * compare — six answers about one machine.
 *
 * A number. The server owns every word.
 */
function hostKindNow(): number {
  return hostKindFor(serverlessHost().platform);
}

export function readServerlessAxis(): Axis | null {
  const host = serverlessHost();
  if (!hasPerRunCostReadings()) return null;
  // The verdict is the application's (docs/settle-rule-decisions.md): how close
  // a typical SETTLED invocation runs to the platform's time and memory limits
  // — the p95 share of each, on the same bands as timeoutHeadroom and
  // functionMemory, the nearer limit deciding. Never the kit's own delivery
  // (those figures ride as numbers beside it, and `deliveryScore` still states
  // them for the record) and never the start-up peak. A function whose
  // platform states neither limit is not graded here.
  const minRuns = SETTLE_FAMILIES.peakRate.minSamples;
  const timeP95 = timeUsedPctRing.length >= minRuns ? percentile(timeUsedPctRing, 95) : null;
  const memP95 = memUsedPctRing.length >= minRuns ? percentile(memUsedPctRing, 95) : null;
  const scores: number[] = [];
  if (timeP95 !== null) scores.push(linearScore(timeP95, 40, 90));
  if (memP95 !== null) scores.push(linearScore(memP95, 60, 95));
  const knowsALimit = timeLimitMs !== null || (host.memoryLimitMb ?? 0) > 0;
  const score = scores.length > 0 ? Math.min(...scores) : null;
  const reading: Axis = {
    score,
    // A platform that states neither limit leaves nothing to measure against:
    // that is a fact about the HOST ("not available here", like
    // timeoutHeadroom without a context), never a per-axis decision not to
    // grade, so it is not the never-scored word.
    rating: score !== null ? ratingFor(score) : "pending",
    // Closed numeric vocabulary — the server owns the platform's name.
    // Named platformCode, not platform: the snapshot already has a top-level
    // `platform` string ("node"/"web"/…) and two different meanings under one
    // name is how a sanitizer starts enforcing the wrong type.
    platformCode: host.platform as PlatformCode as number,
    // A real function, or a container billed like one whose processor freezes
    // when it answers? Both are billed by the run and both are measured here,
    // but they are not the same thing to a reader: one has hard per-run
    // ceilings, the other has a bill and no cliffs. Stated by the kit because
    // the kit is the only thing that knows which host it woke up on.
    isServerless: host.serverless ? 1 : 0,
    hostKind: hostKindNow(),
    // One process = one cold start, by definition. The server sums these across
    // instances to get the project's cold-start count for the day.
    coldStarts: 1,
    invocations,
    // Billed cost (what the customer pays their platform for our work) and
    // visitor cost (what a page load actually waited for). They differ exactly
    // where the platform lets us work after the response has been sent.
    addedMsWorst,
    addedMsAvg: flushesTimed > 0 ? Math.round(addedMsTotal / flushesTimed) : 0,
    visitorMsWorst,
    deferredFlushes,
    blockingFlushes,
    lostRows,
    strandedRows,
    strandedFlushes,
    measurable: knowsALimit ? 1 : 0,
    ...(knowsALimit ? {} : { reasonCode: REASON_PLATFORM_DOES_NOT_EXPOSE }),
  };
  if (score !== null) return markSettled(reading);
  return knowsALimit && isSettling("peakRate") ? settlingReading(reading) : reading;
}

/** How close runs came to the function's time limit. */
export function readTimeoutHeadroomAxis(): Axis | null {
  if (!hasPerRunCostReadings()) return null;
  // No context, no limit. Every platform here keeps the function's time limit
  // to itself unless it hands the handler a context object, so this abstains
  // rather than inventing a ceiling to measure against.
  if (timeLimitMs === null || worstTimeUsedPct === null) {
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      reasonCode: REASON_PLATFORM_DOES_NOT_EXPOSE,
      hostKind: hostKindNow(),
      runs: timedRuns,
    };
  }
  // The start-up rule (latencyTail): the tail of the SETTLED timed runs — the
  // instance's first run and anything before the process settled decide
  // nothing — on 20 of them at least; below 100 the tail is the slowest.
  if (settledTimeRing.length < SETTLE_FAMILIES.latencyTail.minSamples) {
    const pending: Axis = {
      score: null,
      rating: "pending",
      measurable: 1,
      hostKind: hostKindNow(),
      limitMs: timeLimitMs,
      runs: timedRuns,
    };
    return isSettling("latencyTail") ? settlingReading(pending) : pending;
  }
  const sorted = [...settledTimeRing].sort((a, b) => a.pct - b.pct);
  const tailAt =
    sorted.length < 100
      ? sorted.length - 1
      : Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1);
  const tail = sorted[tailAt]!;
  // 40% of the limit used or less is comfortable; 90% or more is a run that is
  // about to be killed mid-measurement.
  const score = linearScore(tail.pct, 40, 90);
  return markSettled({
    score,
    rating: ratingFor(score),
    measurable: 1,
    hostKind: hostKindNow(),
    usedPct: tail.pct,
    remainingMs: tail.remainingMs,
    limitMs: timeLimitMs,
    runs: timedRuns,
    // The shape of the runs, not just the unluckiest one. A project whose
    // MIDDLE run sits at 70% of its limit is in a different situation from one
    // whose worst run touched 70% once, and only a distribution tells them
    // apart. Absent until there is something to describe.
    p50UsedPct: percentile(timeUsedPctRing, 50),
    p95UsedPct: percentile(timeUsedPctRing, 95),
  });
}

/** Memory headroom against the function's configured ceiling. */
export function readFunctionMemoryAxis(): Axis | null {
  const host = serverlessHost();
  if (!hasPerRunCostReadings()) return null;
  const limit = host.memoryLimitMb;
  // Two different silences, told apart. No stated ceiling is a permanent
  // "not available here"; a ceiling with nothing measured yet is warming up,
  // and must NEVER be dressed as unavailable — the reading is coming.
  if (limit === null || limit <= 0) {
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      reasonCode: REASON_PLATFORM_DOES_NOT_EXPOSE,
      hostKind: hostKindNow(),
    };
  }
  // The start-up rule (peakRate): the peak over SETTLED invocations, on two of
  // them at least. What the boot held before the process settled — and gave
  // back — decides nothing.
  if (settledRuns < SETTLE_FAMILIES.peakRate.minSamples || settledPeakRssMb <= 0) {
    const pending: Axis = {
      score: null,
      rating: "pending",
      measurable: 1,
      hostKind: hostKindNow(),
      limitMb: limit,
    };
    return isSettling("peakRate") ? settlingReading(pending) : pending;
  }
  const usedPct = Math.min(100, Math.round((settledPeakRssMb / limit) * 100));
  // Under 60% of the ceiling is comfortable; 95% is one allocation from a kill.
  const score = linearScore(usedPct, 60, 95);
  return markSettled({
    score,
    rating: ratingFor(score),
    measurable: 1,
    hostKind: hostKindNow(),
    usedMb: settledPeakRssMb,
    limitMb: limit,
    usedPct,
    p50UsedPct: percentile(memUsedPctRing, 50),
    p95UsedPct: percentile(memUsedPctRing, 95),
    // Runs that came close enough to the ceiling that the kit spent their last
    // moments saying so. Warnings, not kills — a run can touch the line and
    // still answer. Zero here is a real zero: the watch was armed.
    nearKills: deathCounters().memoryNearKills,
  });
}

/* ─── Start-up: what a cold start costs ─────────────────────────────────── */

/**
 * How often a run pays for a cold start, what the cold start added, the split
 * between loading and working, and how many requests this instance served
 * before it was recycled.
 *
 * One process is one cold start, so an INSTANCE cannot report a rate — it
 * reports its own numbers and the server divides cold starts by runs across
 * every instance of the project. What the instance can answer alone is the
 * expensive half: how much of its life went to getting ready rather than
 * serving.
 */
export function readColdStartCostAxis(): Axis | null {
  if (!isPerRunBilled()) return null;
  // Nothing has been served yet: warming up, not unavailable. The reading is
  // coming, and dressing it as "not available here" would be a lie that never
  // corrects itself.
  if (initMs === null || firstRunMs === null) {
    return {
      score: null,
      rating: "pending",
      measurable: 1,
      hostKind: hostKindNow(),
      runsServed: invocations,
    };
  }
  // Judged only once initialization can amortize (start-up rule): the process
  // has settled and served a full peakRate span past it, with warm runs to
  // compare against. Before that the share is the boot itself, not its cost.
  const amortizeFromMs =
    settledFromMs("peakRate") + SETTLE_FAMILIES.peakRate.minSpanSec * 1000;
  if (warmRuns < SETTLE_FAMILIES.peakRate.minSamples || Date.now() < amortizeFromMs) {
    return {
      score: null,
      rating: "pending",
      measurable: 1,
      hostKind: hostKindNow(),
      runsServed: invocations,
    };
  }
  const warmAvg = warmRuns > 0 ? Math.round(warmRunTotalMs / warmRuns) : null;
  // What the first request paid that a later one did not. Only knowable once a
  // warm run exists to compare against — before that it is not zero, it is
  // unknown, and it is omitted rather than guessed.
  const coldPenaltyMs =
    warmAvg === null ? null : Math.max(0, Math.round(firstRunMs - warmAvg));
  const totalLifeMs = initMs + firstRunMs + warmRunTotalMs;
  const setupSharePct =
    totalLifeMs > 0 ? Math.round((initMs / totalLifeMs) * 100) : 0;
  // Under 15% of an instance's life spent getting ready is unremarkable; at
  // 60% the customer is mostly paying to boot. Scored on the SHARE rather than
  // the raw milliseconds: a 400ms cold start amortised over ten thousand
  // requests is not a problem, and the same 400ms per request is.
  const score = linearScore(setupSharePct, 15, 60);
  return markSettled({
    score,
    rating: ratingFor(score),
    measurable: 1,
    hostKind: hostKindNow(),
    coldStarts: 1,
    runsServed: invocations,
    initMs,
    firstRunMs: Math.round(firstRunMs),
    warmRunAvgMs: warmAvg,
    coldPenaltyMs,
    setupSharePct,
  });
}

/* ─── Computing-time headroom ───────────────────────────────────────────── */

/**
 * How close a run comes to the platform's limit on COMPUTING time — thinking
 * time, as distinct from the wall-clock time a run spends waiting.
 *
 * On every platform this kit runs on today, the honest answer is that there is
 * no such limit: they cap how long a run may take, not how hard it may think.
 * So this abstains — and abstains with the RIGHT reason. "The platform will not
 * tell us" and "the platform sets no such limit" are different facts and a
 * customer deserves the one that is true, because only the first one is
 * something that might change.
 *
 * The computing time itself is measured regardless, and reported beside the
 * abstention: knowing a run burned 40ms of processor out of 900ms of wall clock
 * is useful even where nothing is capping it.
 */
export function readFunctionCpuAxis(): Axis | null {
  if (!isPerRunBilled()) return null;
  const host = serverlessHost();
  const avail = availabilityOf(host.platform, "cpuTimeHeadroom");
  // Measured whether or not anything is capping it: knowing a run burned 40ms
  // of processor across 900ms of wall clock is useful even where no ceiling
  // exists to compare it against. Nulls, not zeros, before the first run.
  // Divided by the runs it was made of, not by every run: on a host that serves
  // several at once, only the runs that had the instance to themselves have
  // processor time of their own. Where none did, this is null — the instance's
  // total work is still reported by the money view, which compares it against
  // busy time rather than pretending to split it per request.
  const measured: Axis =
    cpuRunsCounted > 0
      ? {
          cpuMsAvg: Math.round(runCpuTotalMs / cpuRunsCounted),
          cpuMsWorst: Math.round(cpuMsWorst),
          runs: cpuRunsCounted,
        }
      : { cpuMsAvg: null, cpuMsWorst: null, runs: 0 };
  if (!avail.measurable) {
    return {
      score: null,
      // Not a wait. This platform cannot be asked the question, so no score is
      // coming on this install however long anyone leaves it running — which
      // is exactly what the paragraph above promises the customer will read.
      // `measurable: 0` and the reason code still ride along, so a server that
      // does not know this label reads the state exactly as it always has.
      rating: "not-available",
      measurable: 0,
      reasonCode: avail.reasonCode ?? REASON_PLATFORM_DOES_NOT_EXPOSE,
      hostKind: hostKindNow(),
      ...measured,
    };
  }
  // Reached only on a platform that both caps computing time and states the
  // cap. None does today; the branch exists so the day one does, the reading
  // appears rather than needing to be invented under deadline.
  return {
    score: null,
    rating: "pending",
    measurable: 1,
    hostKind: hostKindNow(),
    ...measured,
  };
}

/* ─── The platform's other limits ───────────────────────────────────────── */

/**
 * Onward calls and simultaneous connections, each as a distance from that
 * platform's own limit.
 *
 * Both are real cliffs on isolate runtimes and neither is capped on the
 * platforms this kit runs on — so here the axis reports what it measured and
 * abstains on the headroom, naming which of the two silences applies. It is
 * deliberately not folded into the computing-time axis: a customer reading
 * "not available here" deserves to know WHICH limit is unknowable, and one
 * merged tile hides that.
 */
export function readFunctionLimitsAxis(): Axis | null {
  if (!isPerRunBilled()) return null;
  const host = serverlessHost();
  const caps = capabilitiesFor(host.platform);
  const onward = availabilityOf(host.platform, "onwardCallHeadroom");
  const conns = availabilityOf(host.platform, "openConnectionHeadroom");
  const measured: Axis = {
    // Null, not zero, until a run has actually been looked at.
    onwardCallsWorst: onwardCallsSampled ? onwardCallsWorst : null,
    // Never measured on this runtime. The one platform that caps simultaneous
    // connections is an isolate runtime this kit does not run on, and counting
    // sockets process-wide would answer a different question from the one the
    // cap asks. Null says so; a zero would have claimed we looked.
    openConnectionsWorst: null,
  };
  if (!onward.measurable && !conns.measurable) {
    return {
      score: null,
      // Neither limit can be read here, so this is a "not available" and not a
      // "not yet" — see the note on the computing-time axis above.
      rating: "not-available",
      measurable: 0,
      // Both silences are the same kind here or the tile could not speak with
      // one voice; where they ever differ, the harsher one (a limit exists and
      // is hidden) wins, because that is the one a customer can be surprised by.
      reasonCode:
        onward.reasonCode === REASON_PLATFORM_DOES_NOT_EXPOSE ||
        conns.reasonCode === REASON_PLATFORM_DOES_NOT_EXPOSE
          ? REASON_PLATFORM_DOES_NOT_EXPOSE
          : REASON_NOTHING_TO_COMPARE,
      hostKind: hostKindNow(),
      ...measured,
    };
  }
  return {
    score: null,
    rating: "pending",
    measurable: 1,
    hostKind: hostKindNow(),
    ...measured,
    openConnectionLimit: caps.openConnectionLimit,
    openConnectionsUsedPct: null,
  };
}

/* ─── The money view ────────────────────────────────────────────────────── */

/**
 * The time this instance was busy, and the processor time it burned while it
 * was — the two numbers the whole money view rests on.
 *
 * Both are UNIONS across runs rather than sums, which is what makes them
 * correct on a host that serves several requests at once and identical to the
 * sums on one that does not. A window that is open right now (the snapshot is
 * being taken mid-request) contributes the part that has already happened, so a
 * long-running request cannot hide its own cost by never finishing.
 */
function billedWindow(): { billedMs: number; computeMs: number } {
  let billedMs = instanceBusyMs;
  let computeMs = instanceBusyCpuMs;
  if (busyStartWallMs !== null) {
    billedMs += Math.max(0, Date.now() - busyStartWallMs);
    const cpuNow = cpuUsageUs();
    if (busyStartCpuUs !== null && cpuNow !== null) {
      computeMs += Math.max(0, (cpuNow - busyStartCpuUs) / 1000);
    }
  }
  return { billedMs, computeMs };
}

/**
 * What the runs cost, and how much of that was bought and not used.
 *
 * The kit ships FACTS, never money: billed milliseconds, the memory the
 * platform granted, how many runs, how many failed, and how much of the billed
 * time was not computing time. Turning that into a currency needs a price, and
 * a price is a thing that changes without telling us — so it lives on the
 * server, dated, and abstains for platforms whose pricing we cannot state
 * honestly.
 *
 * `gbMs` is the unit function platforms actually bill in: milliseconds
 * multiplied by the memory granted. Sending it computed rather than sending the
 * pieces means the server never has to guess which memory size applied to which
 * run on an instance that was resized mid-month.
 */
export function readFunctionCostAxis(): Axis | null {
  if (!isPerRunBilled()) return null;
  const host = serverlessHost();
  const kind = hostKindFor(host.platform);
  // Asked of the TABLE, like every other reading in this family — not of the
  // billing flag alone. This reading used to gate only on "is this billed by
  // the run?", which handed a function-cost verdict to hosts the table
  // classifies as something else and put a red tile beside five that said
  // there was nothing to compare (docs/kit-footprint-suspend-2026-09.md).
  const avail = availabilityOf(host.platform, "perRunCost");
  if (!avail.measurable) {
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      reasonCode: avail.reasonCode ?? REASON_NOTHING_TO_COMPARE,
      hostKind: kind,
      runs: runsCounted,
    };
  }
  if (runsCounted === 0) {
    return {
      score: null,
      rating: "pending",
      measurable: 1,
      hostKind: kind,
      runs: 0,
    };
  }
  const grantedMb = host.memoryLimitMb;
  // Billed time is the time the INSTANCE was busy, not the sum of the requests.
  // On a function those are the same number by construction (runs never
  // overlap). On a container serving eighty at once, summing the requests would
  // bill the customer eighty times for one second of one machine — a cost
  // reading that is wrong in the direction that frightens people.
  const { billedMs, computeMs } = billedWindow();
  const gbMs =
    grantedMb && grantedMb > 0 ? Math.round(billedMs * (grantedMb / 1024)) : null;
  // Time bought and not spent computing. On a function this is the whole
  // argument: a slow database query is not a delay, it is an invoice.
  const waitingMs = Math.max(0, Math.round(billedMs - computeMs));
  const waitingPct = billedMs > 0 ? Math.round((waitingMs / billedMs) * 100) : 0;
  // TIME THE APP SPENT, TOLD APART FROM TIME THE HOST TOOK AWAY.
  //
  // The waiting figure above is bought-and-not-computing, which on a container
  // whose processor freezes between requests is mostly the machine asleep. Ours
  // published 86% and was rated as though the application had chosen it.
  // `napBilledMs` is the part of that inside billed windows the suspend sensor
  // WITNESSED the host stopping us in, so what is left is the app's own wait.
  const napMs = Math.min(waitingMs, Math.round(napBilledMs));
  const judgedBilledMs = Math.max(0, billedMs - napMs);
  const appWaitingMs = Math.max(0, waitingMs - napMs);
  const appWaitingPct =
    judgedBilledMs > 0 ? Math.round((appWaitingMs / judgedBilledMs) * 100) : 0;
  // Nothing survived the discount: every billed window on this instance was one
  // the host napped through, so there is no app behaviour left to judge. An
  // abstention, not a zero and not a good score — the bill is still published.
  const nothingLeftToJudge = napWindows > 0 && judgedBilledMs <= 0;
  // 30% of billed time spent waiting is ordinary for anything that talks to a
  // database; 85% means the customer is renting a processor to hold a socket.
  // Judged on the app's own waiting, so the case this reading exists to catch —
  // a function holding a socket open while the meter runs — still scores
  // exactly as it did: on a host that never suspends, napMs is 0 by
  // construction and this is the old number.
  // NOT GRADED (docs/settle-rule-decisions.md: functionCost is a wrong
  // quantity). The waiting share is not cost — a function that waits on its
  // database is doing its job — and a cost has no band without the owner's
  // budget, which no kit is told. The money figures ride (the per-run p50/p95
  // over settled invocations only, so one cold run is never projected) and
  // the server prices them; nothing here carries a grade word.
  const score = null;
  return markSettled({
    score,
    // Every window on this instance happening to be a nap is a condition of
    // the instance: the warming word, and the reason says why nothing was left.
    rating: nothingLeftToJudge ? "pending" : "not-scored",
    measurable: nothingLeftToJudge ? 0 : 1,
    ...(nothingLeftToJudge ? { reasonCode: REASON_NOTHING_TO_COMPARE } : {}),
    // WHICH KIND of host this verdict is about. A function's bill and a frozen
    // container's bill are not the same claim — one has hard per-run ceilings,
    // the other has a bill and no cliffs — and a score with no host named is
    // how this tile came to read as a function verdict on a container.
    hostKind: kind,
    runs: runsCounted,
    failedRuns,
    billedMs: Math.round(billedMs),
    computeMs: Math.round(computeMs),
    waitingMs,
    waitingPct,
    // The split. `napMs` is time inside billed windows the host was witnessed
    // stopping us in; `appWaitingPct` is what is left, and is the number the
    // verdict is about. Both are zero on a host that never suspends, where the
    // two percentages are the same figure and nothing on the tile changes.
    napMs,
    napWindows,
    billedWindows,
    appWaitingMs,
    appWaitingPct,
    // Did this instance ever serve two runs at once? It changes what every
    // number above MEANS — billed time is the instance's, not one request's —
    // and the server says so in words rather than leaving a reader to assume
    // a per-request figure. A real function is always 0 here.
    concurrentRuns: runsOverlapped ? 1 : 0,
    // The sum of the runs, kept beside the billed figure rather than instead of
    // it: on an overlapping host the gap between the two IS the saving the
    // customer gets from serving several at once, and hiding one of them turns
    // an explainable difference into an argument about whose number is wrong.
    runWallSumMs: Math.round(runWallTotalMs),
    grantedMb: grantedMb ?? null,
    gbMs,
    // The startup phase, kept beside the request figures rather than folded
    // into them. It happens ONCE per instance, not once per run, and on a
    // platform that bills it (Lambda has billed the init phase since 1 Aug
    // 2025) leaving it out understates the bill by a whole cold start per
    // instance. Attribution stays clean: `billedMs` above is request time,
    // this is startup time, and the server adds them before pricing.
    initMs,
    initGbMs:
      initMs !== null && grantedMb && grantedMb > 0
        ? Math.round(initMs * (grantedMb / 1024))
        : null,
    p50RunMs: percentile(runWallRing, 50),
    p95RunMs: percentile(runWallRing, 95),
    // The always-on look-alike, told apart from a real function. Shape says
    // the host freezes between requests; the witness count says we have
    // actually SEEN it happen. A customer paying to keep the processor awake
    // is shaped like this and never freezes, so the claim rides the witness.
    frozenHost: host.frozenBetweenRequests ? 1 : 0,
    freezeWitnessed: host.frozenBetweenRequests ? getSuspendWakeCount() : 0,
    // How long this instance has been alive, so the server can turn the totals
    // above into a rate and a rate into a monthly figure. Sent rather than
    // inferred: a snapshot's timestamps say when it was UPLOADED, and an
    // instance that sat frozen for an hour between two requests would look
    // like an hour of billed time to anyone measuring from outside.
    instanceAgeMs: Math.max(0, Math.round(process.uptime() * 1000)),
  });
}

/* ─── What the platform refused or killed ───────────────────────────────── */

/**
 * Runs that ended because the platform stopped them, and runs it refused
 * before the code ran at all.
 *
 * Three things here, and they are not the same thing.
 *
 * A WARNING is a run that came within the reporting slice of being stopped —
 * readable only where the platform hands the run a live countdown, and the
 * whole point of the reading: a run that vanishes explains nothing, and a run
 * that says "I am about to be stopped and I am waiting on the network"
 * explains everything. Plenty of warned runs finish anyway, so a warning is
 * counted as a warning.
 *
 * A DEATH is a warned run that never came back — the next run on this instance
 * began while the warned one had never closed its own books. That is evidence,
 * not a prediction, and it is the only thing allowed to raise a kill count.
 * A warning still open when the instance goes quiet is neither, and is sent as
 * unconfirmed so no surface can round it up into a death.
 *
 * REFUSALS we cannot see at all. No platform tells the running code what it
 * throttled or rejected before start-up, and we do not build a collector to sit
 * beside the platform and read its records. So that half is sent as null —
 * absent, not zero — with the reason, and with a flag saying whether the
 * platform publishes them in its own records so the surface can tell a
 * customer where to look instead of implying nothing happened.
 */
export function readFunctionKillsAxis(): Axis | null {
  if (!isPerRunBilled()) return null;
  const host = serverlessHost();
  const avail = availabilityOf(host.platform, "imminentKillWarning");
  const caps = capabilitiesFor(host.platform);
  const d = deathCounters();
  // Never a number. The count is unknown here on every platform we support, so
  // it travels as an absence with a reason attached; a surface that finds no
  // count says "not visible from inside", never "none".
  const refusals = {
    refusalsKnown: null,
    refusalsReasonCode: REASON_PLATFORM_DOES_NOT_EXPOSE,
    // Read straight off the capability table: where the platform keeps these
    // in its own invocation records, the honest answer is "your platform knows,
    // we do not", which is a different sentence from "nobody can know".
    refusalsPublishedByPlatform: caps.publishedAfterTheRun ? 1 : 0,
  };
  if (!avail.measurable) {
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      reasonCode: avail.reasonCode ?? REASON_PLATFORM_DOES_NOT_EXPOSE,
      hostKind: hostKindNow(),
      ...refusals,
    };
  }
  const deaths = d.timeDeaths + d.memoryDeaths;
  const pct = runsCounted > 0 ? (deaths / runsCounted) * 100 : 0;
  // Any death at all is worth flagging; one run in twenty dying is a broken
  // service. Scored on the RATE so a busy instance is not punished for the
  // same absolute count as a quiet one. Warnings do not enter the score: a run
  // that got to the edge and came back is what the headroom readings are for.
  const score = linearScore(pct, 0, 5);
  return {
    score,
    rating: ratingFor(score),
    measurable: 1,
    hostKind: hostKindNow(),
    runs: runsCounted,
    timeNearKills: d.timeNearKills,
    memoryNearKills: d.memoryNearKills,
    warnedSurvived: d.warnedSurvived,
    warnedUnconfirmed: d.warnedUnconfirmed,
    timeDeaths: d.timeDeaths,
    memoryDeaths: d.memoryDeaths,
    // The class of thing warned runs were blocked on. A code, never a name — a
    // hostname is the customer's data and never leaves their process.
    worstWaitingOn: d.worstWaitingOn ?? null,
    ...refusals,
  };
}

/* ─── What we cost ──────────────────────────────────────────────────────── */

/**
 * Boosthis measuring Boosthis.
 *
 * Ungated by plan on purpose. Every other reading here is about the customer's
 * money and rides the plan that pays for it; this one is about OUR cost to
 * them, and a vendor that puts its own honesty behind a paywall has not been
 * honest. It shows on every plan, on every function host, whether or not they
 * bought anything else.
 */
export function readKitFootprintAxis(): Axis | null {
  if (!isPerRunBilled()) return null;
  const host = serverlessHost();
  const kind = hostKindFor(host.platform);
  // Through the same table as the rest of the family, so this tile names the
  // host it judged rather than implying a function wherever it appears.
  const avail = availabilityOf(host.platform, "kitCost");
  if (!avail.measurable) {
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      reasonCode: avail.reasonCode ?? REASON_NOTHING_TO_COMPARE,
      hostKind: kind,
    };
  }
  const f = readKitFootprint();
  // The kit has not finished loading itself — nothing to report yet, and a
  // zero would read as "we cost nothing", which is the claim this whole axis
  // exists to stop anyone (including us) from making.
  // Rated only once a representative warm-run average exists (start-up
  // rule): before that the cold overhead stands alone and one cold figure
  // decides the grade.
  if (
    f.coldAddMs <= 0 ||
    f.runAddAvgMs === null ||
    // runsMeasured counts the warm-up run, which is charged to the cold start.
    f.runsMeasured - 1 < KIT_FOOTPRINT_MIN_WARM_RUNS
  ) {
    return {
      score: null,
      rating: "pending",
      measurable: 1,
      hostKind: kind,
    };
  }
  // THE GRADE IS THE COST THAT REPEATS (the start-up rule). The cold overhead
  // is paid once per instance: it rides as its own figure against its own
  // ceiling (`coldAddMs`, `coldCeilingMs`, `overCeiling`, `ceilingUsePct`),
  // and a breach of it is still stated, but a one-off no longer decides the
  // word for the life of the instance. The per-run average excludes the
  // warm-up run, which is already counted in the cold-start figure.
  const runPct = Math.round((f.runAddAvgMs / KIT_PER_RUN_CEILING_MS) * 100);
  // Scored against OUR OWN stated ceiling, not against a comfortable curve:
  // half the ceiling scores well, the ceiling itself scores zero. A ceiling
  // that still scores green when you are sitting on it is not a ceiling.
  //
  // THE SCORE IS A DISTANCE, NOT A BREACH, and every surface that renders it
  // is now told so. Ours read 0/"poor" beside `overCeiling: 0` and every
  // figure inside its stated limit, because 39.99 of 40 ms is 99.975% of the
  // way there — which is the band working exactly as intended and the tile
  // reading as a contradiction. The band stays; `ceilingUsePct` and
  // `nearCeiling` travel with it so the words can say which question was
  // answered.
  const score = linearScore(runPct, 50, 100);
  return markSettled({
    score,
    rating: ratingFor(score),
    measurable: 1,
    hostKind: kind,
    coldAddMs: f.coldAddMs,
    moduleEvalMs: f.moduleEvalMs,
    setupMs: f.setupMs,
    // Published as its own line inside the cold-start figure, so a reader can
    // see which part of what we cost was paid once and which part repeats.
    firstRunMs: f.firstRunMs,
    runAddAvgMs: f.runAddAvgMs,
    runAddWorstMs: f.runAddWorstMs,
    runsMeasured: f.runsMeasured,
    // How often the worst case happens. `runAddWorstMs` on our own server read
    // 97.46 ms against a 5 ms per-run ceiling — nineteen times over — with an
    // average of 3.81 ms, and a worst with no frequency beside it cannot be
    // told from a cost we pay all the time. This is the number that says which
    // it is, and it is why the ceiling stays stated against the average.
    runsOverRunCeiling: f.runsOverRunCeiling,
    coldCeilingMs: KIT_COLD_START_CEILING_MS,
    runCeilingMs: KIT_PER_RUN_CEILING_MS,
    overCeiling: f.overCeiling ? 1 : 0,
    // How much of the nearest ceiling this reading uses, the cold-start one
    // included, so a surface can say "99.9% of the way to our stated ceiling"
    // instead of printing a zero beside "0 over ceiling". The score is the
    // per-run share alone (the start-up rule): this figure is the warning
    // about a number we publish, not the grade.
    ceilingUsePct: f.ceilingUsePct,
    // Approaching, and not yet over. The state that had no name, and the whole
    // of the warning a maintainer gets before we breach a number we publish.
    nearCeiling: f.nearCeiling ? 1 : 0,
    ceilingWarnPct: KIT_CEILING_WARN_PCT,
    // How many times the kit gave up its own optional work to stay under the
    // ceiling. Published because a ceiling held by quietly doing less is only
    // honest when the doing-less is visible.
    reducedSteps: f.reducedSteps,
    // Runs the HOST suspended in the middle of, thrown away rather than charged
    // to us. Published beside the cost, exactly the way event-loop lag, worst
    // freeze, latency floor and CPU throttling publish theirs, so a reader can
    // tell a discounted reading from an untouched one — and so the server can
    // put the discount into words rather than quietly showing a smaller number.
    // Omitted entirely when nothing was discounted, which is every reading on
    // a host that never suspends.
    ...(f.suspendDiscounts > 0
      ? {
          suspendDiscounts: f.suspendDiscounts,
          // One discount here is one whole measured RUN thrown away, which is
          // not the same thing as the latency floor's dropped sample or the
          // freeze histogram's thrown-away record — the three counts are
          // comparable only once each says what it is counting.
          suspendUnit: SUSPEND_UNIT.RUNS,
          suspendWorstMs: f.suspendWorstMs,
        }
      : {}),
  });
}

/** Every serverless axis, keyed for the snapshot payload. Empty wherever a run
 *  is not billed by the run, so an ordinary long-running server's payload is
 *  byte-identical to before. */
export function readServerlessMeters(): Record<string, Axis> {
  // Assembled as `axes.<key> =`, the shape every other Node axis uses. Not a
  // style choice: the cross-kit catalogue guard reads the kit's attach sites
  // straight out of this source, and an axis attached in a shape it cannot see
  // reads exactly like an axis the kit never attaches at all.
  const axes: Record<string, Axis> = {};
  const s = readServerlessAxis();
  if (s) axes.serverless = s;
  const t = readTimeoutHeadroomAxis();
  if (t) axes.timeoutHeadroom = t;
  const m = readFunctionMemoryAxis();
  if (m) axes.functionMemory = m;
  // 2026-08 serverless limits-and-cost batch. Every one of these also appears
  // on the always-on look-alikes (a container billed per request-second whose
  // processor freezes when it answers), which is why they ask isPerRunBilled()
  // rather than the serverless flag.
  const cs = readColdStartCostAxis();
  if (cs) axes.coldStartCost = cs;
  const cpu = readFunctionCpuAxis();
  if (cpu) axes.functionCpu = cpu;
  const lim = readFunctionLimitsAxis();
  if (lim) axes.functionLimits = lim;
  const cost = readFunctionCostAxis();
  if (cost) axes.functionCost = cost;
  const kills = readFunctionKillsAxis();
  if (kills) axes.functionKills = kills;
  const foot = readKitFootprintAxis();
  if (foot) axes.kitFootprint = foot;
  return axes;
}

/** Test seam. */
export function _resetServerlessMetersForTests(): void {
  invocations = 0;
  addedMsTotal = 0;
  addedMsWorst = 0;
  visitorMsWorst = 0;
  flushesTimed = 0;
  warnedOverStatedDelay = false;
  deferredFlushes = 0;
  platformDeferredFlushes = 0;
  blockingFlushes = 0;
  lostRows = 0;
  strandedRows = 0;
  strandedFlushes = 0;
  outstandingStranded = 0;
  deliveredRows = 0;
  worstTimeUsedPct = null;
  worstRemainingMs = null;
  timeLimitMs = null;
  timedRuns = 0;
  peakRssMb = 0;
  initMs = null;
  firstRunMs = null;
  warmRunTotalMs = 0;
  warmRuns = 0;
  runWallTotalMs = 0;
  runCpuTotalMs = 0;
  runsCounted = 0;
  failedRuns = 0;
  onwardCallsWorst = 0;
  onwardCallsSampled = false;
  cpuMsWorst = 0;
  cpuRunsCounted = 0;
  runsOpen = 0;
  runsBegun = 0;
  runsOverlapped = false;
  napBilledMs = 0;
  napWindows = 0;
  billedWindows = 0;
  instanceBusyMs = 0;
  instanceBusyCpuMs = 0;
  busyStartWallMs = null;
  busyStartCpuUs = null;
  timeUsedPctRing.length = 0;
  memUsedPctRing.length = 0;
  runWallRing.length = 0;
  settledRuns = 0;
  settledPeakRssMb = 0;
  settledTimeRing.length = 0;
}
