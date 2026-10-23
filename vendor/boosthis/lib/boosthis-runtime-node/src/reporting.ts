/** Findings adapter + report scheduler.
 *
 * Bridges the Node runtime's local observations (per-route summary + auto
 * budget regressions) to the shared candidate/resolution engine in
 * `candidateRules.ts`, and optionally drains full per-route samples to the
 * server. This is the Node equivalent of the RN detectors that feed
 * `ingestFindings`.
 *
 * Privacy: findings carry a route label in `name`, but `signatureFor` drops it
 * before anything is transmitted. Route labels themselves are already
 * normalized + PII-redacted by the middleware (`/users/42` → `/users/:id`,
 * emails/handles/long tokens → `:id`).
 */

import { doorWordOf, settledSummary, type Sample } from "./samples";
import * as budgets from "./budgets";
import {
  ingestFindings,
  noteRecurringFindings,
  type CrossCuttingFinding,
} from "./candidateRules";
import { readReleaseKey } from "./buildIdentity";
import { transmitLabelHasPII } from "./no-pii";
import { MAX_PART_NAME } from "./routeInventory";
import { collectDetectorFindings } from "./liveDetectors";
import { collectAiFindings } from "./aiCalls";
import { noteRowsDiscarded, noteRowsDelivered } from "./serverlessMeters";
import { resumeDelayMs, uploadPausedUntil } from "./uploadPause";
import type { TelemetrySample } from "./telemetry";
import { uploadsReady, setUploadReadiness, type QueueAnswer } from "./uploadRecovery";

/** Build the current finding set from local perf state:
 *  - every route currently rated needs-work / poor → a `slow-route` finding
 *  - every route whose p95 regressed past its learned baseline → a
 *    `budget-regression` finding
 *  The `name` is used only for local dedupe + a generic hint; it never reaches
 *  a signature or a transmitted payload. */
export function collectFindings(): CrossCuttingFinding[] {
  const out: CrossCuttingFinding[] = [];
  // A slow route is judged from SETTLED requests (start-up rule): one cold
  // first request must not leave a live finding behind for the ring's life.
  const sum = settledSummary();
  for (const [route, r] of Object.entries(sum.byRoute)) {
    if (r.worst_rating === "good") continue;
    const b = budgets.statusFor(route);
    const p95 = b.recent_p95_ms ?? r.max_ms;
    out.push({
      kind: "slow-route",
      name: route,
      p95,
      count: r.count,
      hint: "A route is rated needs-work or poor against the TTI budget.",
    });
  }
  for (const reg of budgets.regressions()) {
    out.push({
      kind: "budget-regression",
      name: reg.route,
      p95: reg.recent_p95_ms ?? 0,
      count: reg.samples_seen,
      hint: "A route's p95 latency regressed past 1.5x its learned baseline.",
    });
  }
  // Live cross-cutting detectors (retry-storm / idle-burn). Same finding shape,
  // so they ride the same candidate + snapshot path as the route findings.
  out.push(...collectDetectorFindings());
  // AI-call findings: no time limit, a retry that ignored the provider's own
  // retry-after, calls run one after another that could have run together, the
  // same prompt sent twice, a prompt cache never hit, and streamed answers
  // whose usage the app never asked for. Each names a rule with a written fix.
  // Empty for an app that calls no AI provider — like every other reading
  // here, absence is the honest answer, never a zero.
  out.push(...collectAiFindings());
  return out;
}

// ── Full-sample sink (optional, full-telemetry mode only) ──────────────
type SampleSubmitter = (samples: readonly TelemetrySample[]) => Promise<QueueAnswer>;

let sampleSubmitter: SampleSubmitter | null = null;
let issuesOnlyMode = false;
let queuePaused = false;
let pending: TelemetrySample[] = [];
const PENDING_CAP = 500;
const SAMPLE_BATCH = 100;

/** Register the full-sample sink (the telemetry client's `transmit`). In
 *  issuesOnly mode no full samples are ever queued or shipped. */
export function setSampleSink(opts: {
  submitter: SampleSubmitter;
  issuesOnly: boolean;
}): void {
  sampleSubmitter = opts.submitter;
  issuesOnlyMode = opts.issuesOnly;
  queuePaused = false;
}

/** Flip the queue's issues-only mode at runtime WITHOUT touching the pause
 *  state (which stays owned by disable()/enable()). Used when the server's
 *  dashboard "Full telemetry" consent directive arrives: ON forces full mode
 *  for the session, OFF reverts to the code-configured mode. A paused queue
 *  stays paused either way, so the directive can never override disable(). */
export function setSampleQueueIssuesOnly(issuesOnly: boolean): void {
  issuesOnlyMode = issuesOnly;
  if (issuesOnly) {
    // Reverting to issues-only drops anything queued under the full grant so
    // no full sample ships after the grant is withdrawn.
    pending = [];
  }
}

/** Stop queueing + drop any pending full samples (issue/fix reporting, which is
 *  driven separately, keeps running). Called on `client.disable()`. */
export function pauseSampleQueue(): void {
  queuePaused = true;
  pending = [];
}

/** Resume queueing full samples — no-op in issuesOnly mode. Called on
 *  `client.enable()`. */
export function resumeSampleQueue(): void {
  queuePaused = false;
}

/** Clear the sink entirely (called on `client.forget()`). */
export function clearSampleSink(): void {
  sampleSubmitter = null;
  issuesOnlyMode = false;
  queuePaused = false;
  pending = [];
  coverageRefresh = null;
}

// ── Coverage freshness (always-on) ─────────────────────────────────────
// What this app is BLIND to is not known at start-up: the database client is
// armed at the first request, a job library the app requires lazily is not in
// the module cache until something needs it, and `attach()` may not have run.
// The registration therefore has to be re-sent when that answer changes.
//
// The tick below is the only path that runs after ordinary measured work in
// EVERY mode: issue reporting is always-on for a registered app, while sample
// and snapshot uploads are off in the default issues-only mode. Hanging the
// refresh off an upload would mean a private app discovers a Dramatiq worker
// (or a refused attach) and never says so — the false clean bill of health
// this feature exists to prevent.
let coverageRefresh: (() => void) | null = null;

/** Register the telemetry client's change-only coverage refresh. Bounded and
 *  throttled INSIDE the hook (it re-consents only when the inventory's
 *  fingerprint moved, at most a handful of times per process). */
export function setCoverageRefreshHook(fn: (() => void) | null): void {
  coverageRefresh = fn;
}

/** Sample observer registered on `samples`. Queues the sample for optional
 *  full upload, then schedules a (throttled) report tick. */
export function onSample(s: Sample): void {
  if (!issuesOnlyMode && !queuePaused) {
    // Refuse over-long names and apply the route-label PII filter before
    // queuing — mirrors the RN transmit hardening. Labels containing
    // whitespace, UUIDs, long numeric IDs, emails, JWTs, or phone numbers
    // are silently dropped rather than queued for upload.
    const label = s.name;
    if (
      label.length <= MAX_PART_NAME &&
      transmitLabelHasPII(label) === null
    ) {
      // The door word (routeDoor.ts) is the only metadata this queue adds,
      // and only on a request that earned one.
      const door = doorWordOf(s);
      pending.push({
        routeLabel: label,
        durationMs: s.duration_ms,
        rating: s.rating,
        ...(door !== null ? { metadata: { door } } : {}),
      });
      // Overflow: the oldest sample is dropped to make room. Counted rather
      // than silently forgotten — see the span buffer for the same reasoning.
      if (pending.length > PENDING_CAP) {
        pending.shift();
        noteRowsDiscarded(1, "bufferFull");
      }
    } else {
      noteRowsDiscarded(1, "sendFailed");
    }
  }
  scheduleTick();
}

// ── Throttled tick ─────────────────────────────────────────────────────
let running = false;
let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;
/** When the armed timer fires, so a fuller queue can bring it forward. */
let timerDueAt = 0;
const THROTTLE_MS = 1000;

// ── Pacing the sample uploads ──────────────────────────────────────────
//
// Every finished request or job is a sample, and the queue used to upload on
// a one-second timer, straight back-to-back while it stayed busy. A worker
// finishing a few jobs a second therefore sent 60–90 sample uploads a minute
// — over its install's allowance of 60 for EVERY kind of upload together —
// and the job-run report and panel snapshot sent later in each minute were
// refused. So the queue is paced by how busy it is:
//   • quiet (no sample upload for SAMPLE_QUIET_MS) — the quick one second, so
//     a quiet app's first readings still arrive at once;
//   • busy, part of a batch waiting — up to SAMPLE_PARTIAL_GAP_MS after the
//     last sample upload, the same 15 seconds every other kit waits;
//   • busy, a full batch waiting — SAMPLE_FULL_GAP_MS after the last one, at
//     most 15 uploads a minute;
//   • backing up (SAMPLE_BACKLOG rows, the queue nearing its cap) — the quick
//     one second again: spending allowance beats losing samples, and no app
//     delivers fewer samples than it did before.
// `reportNow()` ignores these paces: a shutdown or a test flushes at once.
//
// One thing outranks every pace, the backlog's and `reportNow()` included: a
// wait Boosthis asked for (uploadPause.ts). The backlog's quick second used to
// retry a refused batch every second for as long as the refusals lasted,
// spending each new minute's allowance on uploads that were refused again.
// While a pause holds the samples, the queue keeps every row it has room for
// (PENDING_CAP still bounds it) and the next tick runs once the pause is over.

/** No sample upload for this long and the queue counts as quiet. */
const SAMPLE_QUIET_MS = 15_000;
/** The longest part of a batch waits after the previous sample upload. */
const SAMPLE_PARTIAL_GAP_MS = 15_000;
/** The shortest gap before a full batch follows the previous one. */
const SAMPLE_FULL_GAP_MS = 4_000;
/** Rows waiting at which the queue drains at the quick pace again. */
const SAMPLE_BACKLOG = 3 * SAMPLE_BATCH;
/** When the last sample upload was attempted (0 = never). */
let lastSampleUploadAt = 0;

/** How long until the next tick should run, from how busy the queue is. */
function nextTickDelayMs(now: number): number {
  const resume = resumeDelayMs("samples", now);
  if (resume > 0) return Math.max(THROTTLE_MS, resume);
  const since = now - lastSampleUploadAt;
  if (
    lastSampleUploadAt === 0 ||
    since >= SAMPLE_QUIET_MS ||
    pending.length >= SAMPLE_BACKLOG
  )
    return THROTTLE_MS;
  const gap =
    pending.length >= SAMPLE_BATCH ? SAMPLE_FULL_GAP_MS : SAMPLE_PARTIAL_GAP_MS;
  return Math.max(THROTTLE_MS, gap - since);
}

/** Serverless: the 1s tick is switched OFF. A timer scheduled during a function
 *  invocation either never fires (the invocation is frozen the moment it
 *  answers) or, worse, fires mid-invocation and starts an upload that is frozen
 *  half-sent — draining the queue without delivering it. The per-invocation
 *  flush replaces it entirely. */
let autoTick = true;

export function setAutoTickEnabled(on: boolean): void {
  autoTick = on;
  if (!on && timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** How many samples are waiting to be sent. Read at the end of an invocation so
 *  anything left behind can be counted rather than quietly disappearing. */
export function pendingSampleCount(): number {
  return pending.length;
}

/**
 * Give up on everything still queued, and say how many rows went.
 *
 * Only called when the lifecycle has decided a backlog is never going to
 * leave — see `BACKLOG_MAX_HOLD_MS`. The rows are counted as lost with a cause
 * and reported through the kit's problem channel by the caller; this end of it
 * only empties the queue, because a buffer still full of undeliverable rows is
 * a buffer the NEXT measurements cannot use.
 */
export function discardPendingSamples(): number {
  const n = pending.length;
  pending.length = 0;
  return n;
}

function scheduleTick(): void {
  if (!autoTick) return;
  const now = Date.now();
  const delay = nextTickDelayMs(now);
  const pausedUntil = uploadPausedUntil("samples", now);
  if (timer) {
    // Already armed. Brought forward only when the queue has grown into an
    // earlier pace (a full batch, a backlog); otherwise it simply waits. A
    // pause brings nothing forward: a timer already set for after it keeps
    // its moment, so the resume is not drawn earlier by every new sample.
    if (
      now + delay >= timerDueAt ||
      (pausedUntil !== null && timerDueAt >= pausedUntil)
    ) {
      dirty = true;
      return;
    }
    clearTimeout(timer);
    timer = null;
  }
  timerDueAt = now + delay;
  timer = setTimeout(() => {
    timer = null;
    void runTick();
  }, delay);
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }
}

async function runTick(ending = false): Promise<void> {
  if (running) {
    dirty = true;
    return;
  }
  running = true;
  try {
    dirty = false;
    await tickOnce(ending);
  } catch {
    // One failed findings pass must not end the paced queue's timer chain.
  } finally {
    running = false;
  }
  // Whatever is still queued, or arrived meanwhile, waits for the next PACED
  // tick — never an immediate back-to-back upload, which is how a busy queue
  // used to spend a whole minute's allowance in its first seconds.
  if (pending.length > 0 || dirty) {
    dirty = false;
    scheduleTick();
  }
}

async function tickOnce(ending = false): Promise<void> {
  // Issue + fix reporting — always-on for a registered app.
  const findings = collectFindings();
  try {
    await ingestFindings(findings, ending);
  } catch {
    // best-effort
  }
  // What this app KEEPS doing. The AI findings above are recomputed from
  // scratch every process, so without this they arrive as new on every
  // deploy. Remembering them costs no new collection — the readings are
  // already taken — and only counts ever leave. Runs with no findings still
  // come through here: a tick that sees nothing is how a pattern that STOPPED
  // becomes knowable.
  try {
    await noteRecurringFindings(findings, { releaseKey: readReleaseKey() });
  } catch {
    // best-effort — bookkeeping never disturbs the host
  }
  // Coverage freshness — also always-on, because a surface we cannot watch is
  // a fact about this app whether or not the developer shares samples.
  try {
    coverageRefresh?.();
  } catch {
    // best-effort — a coverage update never disturbs the host
  }
  // Optional full-sample drain (full-telemetry mode only). Not while Boosthis
  // has asked this app to wait: the batch stays queued for the tick after the
  // pause, which scheduleTick arms because the queue is not empty.
  if (
    sampleSubmitter &&
    !issuesOnlyMode &&
    !queuePaused &&
    pending.length > 0 &&
    uploadPausedUntil("samples") === null &&
    uploadsReady(ending)
  ) {
    const batch = pending.slice(0, SAMPLE_BATCH);
    lastSampleUploadAt = Date.now();
    try {
      const answer = await sampleSubmitter(batch);
      const accepted = typeof answer === "number" ? answer : answer.accepted;
      if (accepted > 0) {
        pending.splice(0, accepted);
        noteRowsDelivered(accepted);
      }
      if (typeof answer !== "number" && answer.undelivered === "refused") {
        pending.splice(0, batch.length - accepted);
        noteRowsDiscarded(batch.length - accepted, "sendFailed");
      }
    } catch {
      // best-effort — keep the batch for the next tick
    }
  }
}

/** Force a synchronous report now (drains the pending timer first). Useful for
 *  graceful shutdown and for deterministic tests. */
export async function reportNow(ending = false): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await runTick(ending);
}

/** Test helper — reset all scheduler + queue state. */
export function _resetReportingForTests(): void {
  setUploadReadiness(null);
  autoTick = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  running = false;
  dirty = false;
  timerDueAt = 0;
  lastSampleUploadAt = 0;
  pending = [];
  sampleSubmitter = null;
  issuesOnlyMode = false;
  queuePaused = false;
  coverageRefresh = null;
}
