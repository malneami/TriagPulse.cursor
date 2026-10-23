/* ─── Boosthis: extra Node meter collectors (2026-08 batch) ──────────────
 *
 * Four more honest, display-only meters. Same doctrine as runtimeVitals.ts:
 * ADDITIVE axes that never feed the Speed score, counts/durations only (never
 * a route, URL, host, or user value), bounded memory, honest omission while
 * warming up or when the signal is environment-dependent, and every collector
 * guest-safe (never throws into the host, no-op under the kill-switch).
 *
 *   • Handle churn — sockets/timers created at a furious rate burn CPU
 *     without ever looking like a leak (handleLeak only sees NET growth).
 *     Counted via a minimal async_hooks init hook filtered to handle-shaped
 *     resource types; per-minute rate over a rolling window.
 *   • Promise-rejection pressure — rejections handled LATE (the silent class:
 *     'rejectionHandled' is a fully passive listener) plus unhandled-rejection
 *     process warnings ('warning' listeners never suppress Node's own
 *     printing). We NEVER add an 'unhandledRejection' listener — that would
 *     suppress the host's default crash behavior (see crashReporter.ts).
 *   • Slow-client backpressure — the share of responses whose socket write
 *     buffer filled at least once (the response emitted 'drain'). Separates
 *     "our server is slow" from "their client is slow".
 *   • Worker imbalance — with several cluster workers, is one carrying
 *     everything? Workers piggyback a tiny numeric count message on the
 *     request boundary (no background timer); the PRIMARY's kit aggregates
 *     shares. Environment-dependent: no cluster → the axis is honestly absent
 *     forever (never a warming tile).
 */

/* Node built-ins are reached through STATIC imports, never `require`. This kit
 * ships as ESM (`"type": "module"`, copied to the customer as-is), and in ESM
 * there is no `require` — so a lazy CommonJS load of a `node:` built-in inside
 * one of the defensive try/catch blocks below threw on the customer's very
 * first call and left the meter behind it silently reporting nothing, forever.
 * See __tests__/esmBuiltinAccess.test.ts, the guard that keeps it that way. */
import { createHook } from "node:async_hooks";
import cluster from "node:cluster";
import { url as inspectorUrl } from "node:inspector";

import { isBoosthisDisabled } from "./runtimeFlags";
import { getHeldOpenStats } from "./heldOpen";
import { createHash, randomBytes } from "node:crypto";
import { EMAIL_RE } from "./no-pii";
import { linearScore, ratingFor } from "./healthAxes";
import { SCORE_THRESHOLDS, type Rating, type NoScoreRating } from "./thresholds";
import { REASON_NOTHING_TO_COMPARE, REASON_PLATFORM_DOES_NOT_EXPOSE } from "./axisReasons";
import {
  SETTLE_FAMILIES,
  isSettling,
  markSettled,
  settledFromMs,
  settlingReading,
  spanJudgeable,
} from "./settleRule";
import {
  MIN_RATE_WINDOW_MIN,
  MIN_RATE_WINDOW_MS,
  earnedPerHour,
  overWords,
  windowMinOf,
  windowPhrase,
} from "./rateHonesty";
import {
  startLiveConnections,
  readLiveConnections,
  clearLiveConnections,
} from "./liveConnections";
import {
  startProcessMeters,
  readProcessMeters,
  clearProcessMeters,
  sampleProcessMeters,
} from "./processMeters";
import { clearHostResourceMeters, readHostResourceMeters } from "./hostResourceMeters";
import {
  clearRuntimeSafetyMeters,
  readTimerHealth,
  readUnhandledErrors,
  startRuntimeSafetyMeters,
} from "./runtimeSafetyMeters";

/** Wire shape (mirrors runtimeVitals VitalAxis). The index signature admits
 *  `null` so an axis can emit an EXPLICIT null field for cross-runtime wire
 *  parity (loadDeflection.strainAtInFlight mirrors Python's `None` / Go's
 *  `nil` / Java's `null` — the key is always present, never omitted). */
export interface ExtraAxis {
  /**
   * Null ONLY for an axis that genuinely cannot measure in this environment
   * (it uploads `measurable: 0` and rating "pending" instead of being omitted,
   * so its tile reads an honest reason rather than "warming up" forever — see
   * .agents/memory/boosthis-cant-know-axes.md). Every axis that CAN measure
   * still scores.
   */
  score: number | null;
  rating: Rating | NoScoreRating;
  caption?: string;
  [k: string]: number | string | null | undefined;
}

const r0 = (n: number): number => Math.round(n);
const r1 = (n: number): number => Math.round(n * 10) / 10;

let started = false;
let startedAt = 0;

/* ── Handle churn ────────────────────────────────────────────────────────
 * async_hooks init hook counting creations of handle-shaped resources only.
 * The callback is a single Set lookup — deliberately the cheapest possible
 * body, because enabling any init hook also turns on V8 promise tracking. */
/** Handle creations per minute over the rolling window. <=300/min is normal
 *  churn (100); >=3000/min is a create/destroy storm (0). */
const CHURN_GOOD_PER_MIN = 300;
const CHURN_POOR_PER_MIN = 3_000;
/** Rolling window (ms) + warm-up before a rate is meaningful. */
const CHURN_WINDOW_MS = 5 * 60_000;
const MIN_CHURN_ELAPSED_MS = 60_000;
/** One count bucket per this many ms (bounded ring covers the window). */
const CHURN_BUCKET_MS = 10_000;
const CHURN_BUCKET_CAP = Math.ceil(CHURN_WINDOW_MS / CHURN_BUCKET_MS) + 1;

/** libuv-handle-shaped async resource types (never PROMISE and friends). */
const HANDLE_TYPES = new Set([
  "TCPWRAP", "TCPSERVERWRAP", "PIPEWRAP", "PIPESERVERWRAP", "UDPWRAP",
  "TTYWRAP", "Timeout", "Immediate", "FSEVENTWRAP", "SIGNALWRAP",
  "PROCESSWRAP", "ZLIB", "HTTPCLIENTREQUEST", "HTTPINCOMINGMESSAGE",
]);

interface ChurnBucket { t: number; count: number }
const churnBuckets: ChurnBucket[] = [];
let churnHook: { disable(): unknown } | null = null;

function bumpChurn(now: number): void {
  const bucketT = Math.floor(now / CHURN_BUCKET_MS) * CHURN_BUCKET_MS;
  const last = churnBuckets[churnBuckets.length - 1];
  if (last && last.t === bucketT) {
    last.count++;
    return;
  }
  churnBuckets.push({ t: bucketT, count: 1 });
  if (churnBuckets.length > CHURN_BUCKET_CAP) churnBuckets.shift();
}

function startHandleChurn(): void {
  if (churnHook) return;
  try {
    const hook = createHook({
      init(_id: number, type: string) {
        // Cheapest possible body: one Set lookup, then a bucket bump. Guarded —
        // an init hook throw would surface inside host async setup paths.
        try {
          if (HANDLE_TYPES.has(type)) bumpChurn(Date.now());
        } catch {
          /* never throw from an init hook */
        }
      },
    });
    hook.enable();
    churnHook = hook;
  } catch {
    churnHook = null;
  }
}

/** Handle-churn axis, or null while warming / when async_hooks is missing. */
export function readHandleChurn(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started || !churnHook) return null;
  try {
    const now = Date.now();
    // The start-up rule (peakRate): the handles a process creates while it
    // loads modules and fills its pools are booting, not churn. Only buckets
    // that opened after the settle point count, over the settled part of the
    // window, and the rate waits for five settled minutes.
    if (isSettling("peakRate", now)) return settlingReading({ score: null });
    const from = Math.max(now - CHURN_WINDOW_MS, settledFromMs("peakRate"), startedAt);
    const windowMs = now - from;
    if (!spanJudgeable(windowMs, "peakRate")) return null;
    let created = 0;
    for (const b of churnBuckets) if (b.t >= from) created += b.count;
    const createdPerMin = r1(created / Math.max(windowMs / 60_000, 1 / 60));
    const score = linearScore(createdPerMin, CHURN_GOOD_PER_MIN, CHURN_POOR_PER_MIN);
    return markSettled({
      score,
      rating: ratingFor(score),
      createdPerMin,
      sampleCount: created,
      windowMin: windowMinOf(windowMs),
      caption: `${createdPerMin} handles created/min`,
    });
  } catch {
    return null;
  }
}

/* ── Promise-rejection pressure ──────────────────────────────────────────
 * PASSIVE listeners only: 'rejectionHandled' (late-handled — pure signal, no
 * behavior change) and 'warning' (Node prints warnings regardless of
 * listeners). NEVER 'unhandledRejection' — a listener there would suppress
 * the host's default crash-on-unhandled behavior. */
/** Rejections per hour. 0-1/h is quiet (100); >=30/h is a codebase leaking
 *  rejections (0). */
const REJECT_RATE_GOOD = 1;
const REJECT_RATE_POOR = 30;
/** Observe at least this long before claiming a clean bill (a rejection
 *  surfaces immediately regardless — parity with crashFree). */
const REJECT_MIN_WINDOW_MIN = MIN_RATE_WINDOW_MIN;

let lateHandledCount = 0;
let unhandledWarningCount = 0;
let rejectionHandledListener: ((p: unknown) => void) | null = null;
/** Stray rejections seen while the process was settling (start-up rule,
 *  peakRate): a module that rejects once while it loads is booting. */
let rejectionSettlingCount = 0;

function noteStrayRejection(kind: "late" | "unhandled"): void {
  if (isSettling("peakRate")) {
    rejectionSettlingCount++;
    return;
  }
  if (kind === "late") lateHandledCount++;
  else unhandledWarningCount++;
}
let warningListener: ((w: unknown) => void) | null = null;

function startRejectionPressure(): void {
  if (rejectionHandledListener) return;
  try {
    rejectionHandledListener = () => {
      noteStrayRejection("late");
    };
    process.on("rejectionHandled", rejectionHandledListener);
    warningListener = (w: unknown) => {
      try {
        const name = String((w as { name?: unknown })?.name ?? "");
        if (name.startsWith("UnhandledPromiseRejection")) noteStrayRejection("unhandled");
      } catch {
        /* passive — never throw */
      }
    };
    process.on("warning", warningListener as (w: Error) => void);
  } catch {
    rejectionHandledListener = null;
    warningListener = null;
  }
}

/** Rejection-pressure axis, or null while the observation window is too short
 *  (a rejection shows immediately regardless — parity with crashFree). */
export function readRejectionPressure(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started || !rejectionHandledListener) return null;
  try {
    const now = Date.now();
    if (isSettling("peakRate", now)) {
      return rejectionSettlingCount > 0 ? settlingReading({ score: null }) : null;
    }
    // The rate is taken over the settled time only (start-up rule).
    const windowMs = now - Math.max(startedAt, settledFromMs("peakRate"));
    const windowMin = windowMinOf(windowMs);
    const total = lateHandledCount + unhandledWarningCount;
    const perHour = earnedPerHour(total, windowMs);
    if (perHour === null) {
      if (total === 0) return null;
      return {
        score: null,
        rating: "pending",
        lateHandled: lateHandledCount,
        unhandled: unhandledWarningCount,
        perHour: null,
        windowMin,
        settleRule: 1,
        caption: `${total} stray rejection${total === 1 ? "" : "s"} \u00b7 ${windowPhrase(windowMin, "observed so far")}`,
      };
    }
    const score = linearScore(perHour, REJECT_RATE_GOOD, REJECT_RATE_POOR);
    return markSettled({
      score,
      rating: ratingFor(score),
      lateHandled: lateHandledCount,
      unhandled: unhandledWarningCount,
      perHour,
      windowMin,
      caption:
        total === 0
          ? `no stray rejections \u00b7 ${windowPhrase(windowMin)}`
          : `${total} stray rejection${total === 1 ? "" : "s"} \u00b7 ${perHour}/hour over ${overWords(windowMin)}`,
    });
  } catch {
    return null;
  }
}

/** Plain unseen-rejection reading. This deliberately shares the unhandled
 * counter and observation clock with rejectionPressure: `count` is always the
 * latter's `unhandled` side, never the late-handled + unhandled total. */
export function readPromiseRejections(): ExtraAxis {
  const windowMs = Math.max(0, Date.now() - startedAt);
  const perHour = earnedPerHour(unhandledWarningCount, windowMs);
  if (perHour === null) {
    return {
      score: null,
      rating: "pending",
      count: unhandledWarningCount === 0 ? null : unhandledWarningCount,
      windowMin: windowMinOf(windowMs),
      perHour: null,
    };
  }
  const score = linearScore(perHour, 0, 5);
  return {
    score,
    rating: ratingFor(score),
    count: unhandledWarningCount,
    windowMin: windowMinOf(windowMs),
    perHour,
  };
}

/* ── Slow-client backpressure ────────────────────────────────────────────
 * Fed from the middleware: each finished response reports whether its write
 * buffer filled at least once (the response emitted 'drain'). */
/** Share of responses that hit backpressure. <=1% is healthy (100); >=20%
 *  means many receivers can't keep up (0). */
const BP_PCT_GOOD = 1;
const BP_PCT_POOR = 20;
const MIN_BP_RESPONSES = 50;

let bpTotal = 0;
let bpBackpressured = 0;
/** The shared decision (backpressure): a write buffer HELD above its mark is
 *  the fault, not one that filled for a moment. A response counts only when it
 *  waited on a full buffer AND took at least this long; a fast response whose
 *  buffer filled once was flow control working. */
const BP_HELD_FLOOR_MS = 100;
const BP_BUCKET_MS = 60_000;
const BP_WINDOW_MS = 10 * 60_000;
interface BpBucket { t: number; total: number; held: number }
const bpBuckets: BpBucket[] = [];
/** Responses that began while the process was settling (start-up rule,
 *  peakRate): the first flush of a cold process is ordinary. */
let bpSettling = 0;

function addBpBucket(now: number, total: number, held: number): void {
  const t = Math.floor(now / BP_BUCKET_MS) * BP_BUCKET_MS;
  const last = bpBuckets[bpBuckets.length - 1];
  if (last && last.t === t) {
    last.total += total;
    last.held += held;
  } else {
    bpBuckets.push({ t, total, held });
    if (bpBuckets.length > BP_WINDOW_MS / BP_BUCKET_MS + 1) bpBuckets.shift();
  }
}

/** Record one finished response. Called from the middleware finalize. */
export function noteResponseBackpressure(sawBackpressure: boolean, durationMs = 0): void {
  if (isBoosthisDisabled() || !started) return;
  const now = Date.now();
  const dur = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  if (now - dur < settledFromMs("peakRate")) {
    bpSettling++;
  } else {
    const held = sawBackpressure && dur >= BP_HELD_FLOOR_MS ? 1 : 0;
    bpTotal++;
    bpBackpressured += held;
    addBpBucket(now, 1, held);
  }
  try {
    sampleProcessMeters();
  } catch {
    /* never let meter wiring disturb the host response */
  }
}

/** Backpressure axis, or null until enough responses are observed. */
export function readBackpressure(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    const now = Date.now();
    if (isSettling("peakRate", now)) return bpSettling > 0 ? settlingReading({ score: null }) : null;
    // The share over the settled part of the last ten minutes, once that part
    // spans five minutes (start-up rule, peakRate).
    const from = Math.max(now - BP_WINDOW_MS, settledFromMs("peakRate"), startedAt);
    if (!spanJudgeable(now - from, "peakRate")) return null;
    let total = 0;
    let held = 0;
    for (const b of bpBuckets) {
      if (b.t + BP_BUCKET_MS <= from) continue;
      total += b.total;
      held += b.held;
    }
    if (total < MIN_BP_RESPONSES) return null;
    const backpressuredPct = r1((100 * held) / total);
    const score = linearScore(backpressuredPct, BP_PCT_GOOD, BP_PCT_POOR);
    return markSettled({
      score,
      rating: ratingFor(score),
      backpressuredPct,
      backpressuredCount: held,
      total,
      caption: `${backpressuredPct}% of responses waited ${BP_HELD_FLOOR_MS} ms or more on a full write buffer`,
    });
  } catch {
    return null;
  }
}

/* ── Worker imbalance (cluster) ──────────────────────────────────────────
 * Workers piggyback `{ __boosthis: "reqCount", n }` on the request boundary
 * (throttled, no background timer). The PRIMARY's kit — if the host loads the
 * kit before forking — aggregates per-worker counts over a rolling window and
 * scores the busiest worker's share vs the ideal 1/n. No cluster, one worker,
 * or kit-not-in-primary → the axis is honestly absent forever. */
/** Busiest worker's share vs ideal (maxShare / (1/n)). <=1.5x ideal is
 *  balanced (100); >=3x means one worker is carrying everything (0). */
const IMBALANCE_GOOD_RATIO = 1.5;
const IMBALANCE_POOR_RATIO = 3;
/** Minimum aggregated requests + workers before a verdict is honest. */
const MIN_IMBALANCE_REQUESTS = 50;
const MIN_IMBALANCE_WORKERS = 2;
/** Worker-side send throttle (ms) — piggybacked on request boundaries only. */
const WORKER_SEND_THROTTLE_MS = 15_000;
/** Rolling aggregation window on the primary (ms). */
const IMBALANCE_WINDOW_MS = 10 * 60_000;

const WORKER_MSG_KEY = "__boosthis";
const WORKER_MSG_KIND = "reqCount";

// Worker side.
let workerPendingCount = 0;
let workerLastSentAt = 0;

// Primary side: per-worker-id ring of timestamped counts.
interface WorkerCount { t: number; n: number }
const workerCounts = new Map<number, WorkerCount[]>();
/** When each LIVE worker was first seen (its 'online' event, or its first
 *  count). A worker that exits is forgotten: the shared decision counts live
 *  workers only, as work per minute of each worker's own life. */
const workerBornAt = new Map<number, number>();
let clusterListener: ((worker: unknown, msg: unknown) => void) | null = null;
let clusterOnlineListener: ((worker: unknown) => void) | null = null;
let clusterExitListener: ((worker: unknown) => void) | null = null;

function workerIdOf(worker: unknown): number | null {
  const id = (worker as { id?: unknown } | null)?.id;
  return typeof id === "number" ? id : null;
}

function noteWorkerOnline(id: number, at: number): void {
  if (!workerBornAt.has(id)) workerBornAt.set(id, at);
  if (!workerCounts.has(id)) workerCounts.set(id, []);
}

function noteWorkerExit(id: number): void {
  workerBornAt.delete(id);
  workerCounts.delete(id);
}

function noteWorkerBatch(id: number, n: number, at: number): void {
  if (!workerBornAt.has(id)) workerBornAt.set(id, at);
  let ring = workerCounts.get(id);
  if (!ring) {
    ring = [];
    workerCounts.set(id, ring);
  }
  ring.push({ t: at, n: Math.min(n, 1_000_000) });
  if (ring.length > 512) ring.shift();
}
let isClusterPrimary = false;
let isClusterWorker = false;

function startWorkerBalance(): void {
  try {
    isClusterPrimary = cluster.isPrimary === true;
    isClusterWorker = cluster.isWorker === true;
    if (isClusterPrimary && !clusterListener) {
      clusterListener = (worker: unknown, msg: unknown) => {
        try {
          const m = msg as Record<string, unknown> | null;
          if (!m || m[WORKER_MSG_KEY] !== WORKER_MSG_KIND) return;
          const n = m.n;
          if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return;
          const id = workerIdOf(worker);
          if (id === null) return;
          noteWorkerBatch(id, n, Date.now());
        } catch {
          /* passive — never throw into cluster message handling */
        }
      };
      cluster.on("message", clusterListener);
      clusterOnlineListener = (worker: unknown) => {
        try {
          const id = workerIdOf(worker);
          if (id !== null) noteWorkerOnline(id, Date.now());
        } catch {
          /* never let meter wiring disturb the host */
        }
      };
      clusterExitListener = (worker: unknown) => {
        try {
          const id = workerIdOf(worker);
          if (id !== null) noteWorkerExit(id);
        } catch {
          /* never let meter wiring disturb the host */
        }
      };
      cluster.on("online", clusterOnlineListener);
      cluster.on("exit", clusterExitListener);
    }
  } catch {
    /* best-effort — a host that refuses the listener leaves the axis absent */
  }
}

/** Worker-side: called on each finished request; throttled numeric-only IPC. */
export function noteWorkerRequest(): void {
  if (isBoosthisDisabled() || !started || !isClusterWorker) return;
  try {
    workerPendingCount++;
    const now = Date.now();
    if (now - workerLastSentAt < WORKER_SEND_THROTTLE_MS) return;
    if (typeof process.send !== "function") return;
    const n = workerPendingCount;
    workerPendingCount = 0;
    workerLastSentAt = now;
    process.send({ [WORKER_MSG_KEY]: WORKER_MSG_KIND, n });
  } catch {
    /* best-effort — IPC failure must never disturb the host */
  }
}

/** Worker-imbalance axis (primary only), or null when there's no cluster, too
 *  few workers/requests, or this process is a worker. */
export function readWorkerImbalance(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started || !isClusterPrimary) return null;
  try {
    const now = Date.now();
    // The start-up rule (peakRate) and the shared decision: the first worker
    // takes the boot traffic alone, so only settled windows count; each live
    // worker is judged as requests per minute of its OWN settled life, and a
    // worker still settling is skipped.
    if (isSettling("peakRate", now)) return workerCounts.size > 0 ? settlingReading({ score: null }) : null;
    const settleMs = SETTLE_FAMILIES.peakRate.settleSec * 1000;
    const windowStart = Math.max(now - IMBALANCE_WINDOW_MS, settledFromMs("peakRate"), startedAt);
    if (!spanJudgeable(now - windowStart, "peakRate")) return null;
    const rates: number[] = [];
    let total = 0;
    for (const [id, ring] of workerCounts) {
      const born = workerBornAt.get(id) ?? windowStart;
      const from = Math.max(windowStart, born + settleMs);
      const lifeMs = now - from;
      if (lifeMs < settleMs) continue;
      let sum = 0;
      for (const c of ring) if (c.t >= from) sum += c.n;
      rates.push(sum / (lifeMs / 60_000));
      total += sum;
    }
    if (rates.length < MIN_IMBALANCE_WORKERS) return null;
    if (total < MIN_IMBALANCE_REQUESTS) return null;
    const rateSum = rates.reduce((a, b) => a + b, 0);
    if (rateSum <= 0) return null;
    const maxShare = Math.max(...rates) / rateSum;
    const ratio = maxShare * rates.length;
    const score = linearScore(ratio, IMBALANCE_GOOD_RATIO, IMBALANCE_POOR_RATIO);
    const maxSharePct = r1(100 * maxShare);
    return markSettled({
      score,
      rating: ratingFor(score),
      workers: rates.length,
      maxSharePct,
      total,
      caption: `busiest of ${rates.length} workers took ${maxSharePct}% of requests per minute of life`,
    });
  } catch {
    return null;
  }
}

/* ── Load deflection (concurrency) ───────────────────────────────────────
 * Deflection Rate + Factor of Safety: does the app "bend" under concurrent
 * load? At the START of each request we note how many requests are in flight;
 * on completion we file the duration into a fixed bucket chosen by that
 * in-flight count. Comparing the p75 duration of a low-concurrency bucket to a
 * high-concurrency bucket shows how much latency degrades as load rises.
 *
 * HONEST CLAIM — this is a CORRELATION, not causation. The requests in the
 * quiet and busy buckets are NOT the same routes, so a higher ratio is an
 * OBSERVED "busy vs quiet" latency difference, not proof that concurrency
 * itself caused the slowdown (a busy period may also happen to hit heavier
 * endpoints). Captions say "measured"/"observed busy vs quiet" and never claim
 * concurrency CAUSED the change.
 *
 * OVERHEAD CEILING: exactly one integer increment on start and one decrement
 * on end (Node is single-threaded — the ++/-- are atomic without a lock), plus
 * a fixed-size bucket array. Durations are pushed into a bounded per-bucket
 * ring; no other per-request allocation. Counts + durations only — NEVER a
 * route, URL, host, or any customer value.
 *
 * COUNTER SAFETY: the in-flight counter must NEVER leak. Every start that is
 * counted returns a token; the matching end decrements UNCONDITIONALLY (the
 * decrement sits outside any enabled/started check and outside the recording
 * try), so a kill-switch flip, an early return, or an exception between start
 * and end can never strand a count. */
/** Score curve: 100 at ratio<=1.2, 0 at ratio>=4.0, linear between. */
const DEFLECTION_SCORE_GOOD_RATIO = 1.2;
const DEFLECTION_SCORE_POOR_RATIO = 4.0;
/** RATING bands come from the RATIO directly (NOT from the score via
 *  ratingFor) — parity with Python/Go/Java: ratio<=1.5 good, >=3.0 poor, else
 *  needs-work. These are the "bending" thresholds a developer reasons about. */
const DEFLECTION_RATIO_GOOD = 1.5;
const DEFLECTION_RATIO_POOR = 3.0;
/** Honesty gate: a single-threaded trickle of traffic cannot deflect. */
const DEFLECTION_MIN_SAMPLES = 20;
const DEFLECTION_MIN_BUCKET_SAMPLES = 20;
/** The shared decision (loadDeflection): an app still answering within this
 *  at its busiest (bucket p75) is not bending under load, whatever the ratio
 *  to its quietest moments. The ratio rides. Same floor as the Python kit. */
const DEFLECTION_BUSY_FLOOR_MS = 100;
/** Requests that began while the process was settling (start-up rule,
 *  latencyTail): they paid the cold path and never enter a bucket. */
let deflectionSettling = 0;
const DEFLECTION_MIN_PEAK = 2;
/** Bounded ring per bucket so a long session stays memory-bounded. */
const DEFLECTION_BUCKET_CAP = 512;
/** Loaded-sample floor before a least-squares slope is honest (samples with
 *  in-flight-at-start >= 2). Below this, deflectionMsPerReq stays null. */
const DEFLECTION_MIN_LOADED = 10;
/** Clamp a single request duration before it feeds the solo/slope
 *  accumulators — the p75 bucket rings keep the RAW duration. */
const DEFLECTION_MAX_MS = 120_000;
/** The runtime's EXISTING poor latency budget — `SCORE_THRESHOLDS.tti.poor`
 *  (the same bar rateDuration already calls "poor"), reused verbatim so
 *  strainAtInFlight is defined against an existing budget, not a second
 *  invented number. */
const DEFLECTION_POOR_LATENCY_MS = SCORE_THRESHOLDS.tti.poor;

/** Fixed in-flight buckets. `floor` is the smallest in-flight count that maps
 *  to the bucket (used for strainAtInFlight); `max` is inclusive (Infinity for
 *  the open-ended top bucket). Order low→high. */
const DEFLECTION_BUCKETS: ReadonlyArray<{ floor: number; max: number }> = [
  { floor: 1, max: 1 },
  { floor: 2, max: 2 },
  { floor: 3, max: 4 },
  { floor: 5, max: 8 },
  { floor: 9, max: 16 },
  { floor: 17, max: Infinity },
];

/** in-flight count right now (single-threaded ++/-- — no lock needed). */
let deflectionInFlight = 0;
/** Highest simultaneous in-flight count ever seen. */
let deflectionPeak = 0;
/** Running sum of in-flight-at-start over RECORDED samples (for meanInFlight;
 *  divided by deflectionSamples, per the cross-runtime contract). Accumulated
 *  only when a sample is actually filed, never on a start whose end was
 *  dropped. */
let deflectionInFlightSum = 0;
/** Total completed requests counted (the meanInFlight denominator + samples). */
let deflectionSamples = 0;
/** Per-bucket bounded ring of completed-request durations (ms). */
const deflectionDurations: number[][] = DEFLECTION_BUCKETS.map(() => []);
/** Merged Load-Headroom accumulators (folded in from the old
 *  requestConcurrency axis). All fed with the CLAMPED duration; the bucket
 *  rings above keep the RAW duration. O(1) — scalar accumulators only. */
/** Recorded samples with in-flight-at-start == 1 (solo). */
let deflectionSoloCount = 0;
/** Sum of CLAMPED durations of solo samples (soloMeanMs numerator). */
let deflectionSoloTotalMs = 0;
/** Recorded samples with in-flight-at-start >= 2 (loaded). */
let deflectionLoadedCount = 0;
/** Least-squares accumulators over ALL recorded samples: x = in-flight-at-
 *  start, y = CLAMPED duration. slope = (n*sumXY - sumX*sumY)/(n*sumX2 - sumX^2). */
let deflectionSumX = 0;
let deflectionSumY = 0;
let deflectionSumXY = 0;
let deflectionSumX2 = 0;

function deflectionBucketIndex(inFlight: number): number {
  for (let i = 0; i < DEFLECTION_BUCKETS.length; i++) {
    if (inFlight <= DEFLECTION_BUCKETS[i].max) return i;
  }
  return DEFLECTION_BUCKETS.length - 1;
}

/** Sentinel returned by a start that did NOT count (disabled / not started):
 *  the matching end then does nothing. Any positive value is the in-flight
 *  count observed at start AND a promise that the counter was incremented, so
 *  the end MUST decrement. */
const DEFLECTION_NOT_COUNTED = 0;

/** Called at request START (reuse the kit's existing request boundary — no
 *  second hook). Returns the in-flight count observed at start (a positive
 *  token) when the counter was incremented, or DEFLECTION_NOT_COUNTED (0) when
 *  we did not count (disabled / not started). The enabled/started check lives
 *  ONLY here at the increment — never between increment and decrement — so the
 *  counter can never leak. */
export function noteDeflectionStart(): number {
  if (isBoosthisDisabled() || !started) return DEFLECTION_NOT_COUNTED;
  deflectionInFlight++;
  if (deflectionInFlight > deflectionPeak) deflectionPeak = deflectionInFlight;
  // peak tracked here; the in-flight-at-start SUM is accumulated at end, only
  // for samples actually recorded (contract: mean over recorded samples).
  return deflectionInFlight;
}

/** Called at request COMPLETION with the token returned by the matching start
 *  and the request duration. The in-flight DECREMENT is UNCONDITIONAL for any
 *  counted start (token > 0) — it runs before, and independent of, any
 *  enabled/started/validity check and outside the recording try — so a
 *  kill-switch flip, early return, or exception can never strand a count. The
 *  sample is only filed when the start counted and the inputs are valid. */
export function noteDeflectionEnd(
  startInFlight: number,
  durationMs: number,
  heldOpen = false,
): void {
  // A start that did not count contributes nothing and must NOT decrement.
  if (startInFlight === DEFLECTION_NOT_COUNTED) return;
  // GUARANTEED-EXIT decrement: pairs with the increment on EVERY exit path.
  // Runs first, unconditionally, so nothing below can leave the counter high.
  if (deflectionInFlight > 0) deflectionInFlight--;
  try {
    // Now that the counter is balanced, decide whether to record the sample.
    if (isBoosthisDisabled() || !started) return;
    // A held-open stream really did occupy the server, so it counted towards
    // in-flight above (and the decrement already ran). Its DURATION is the
    // client's patience rather than the app's speed, so it never becomes a
    // latency sample here. Counted + published by heldOpen.ts.
    if (heldOpen) return;
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    if (!Number.isFinite(startInFlight) || startInFlight < 1) return;
    if (Date.now() - durationMs < settledFromMs("latencyTail")) {
      deflectionSettling++;
      return;
    }
    const ring = deflectionDurations[deflectionBucketIndex(startInFlight)];
    ring.push(durationMs);
    if (ring.length > DEFLECTION_BUCKET_CAP) ring.shift();
    // meanInFlight numerator: sum in-flight-at-start over RECORDED samples.
    deflectionInFlightSum += startInFlight;
    deflectionSamples++;
    // Merged Load-Headroom accumulators: the CLAMPED duration feeds ONLY these
    // (soloTotal + least-squares); the bucket ring above kept the RAW value.
    const y = Math.min(DEFLECTION_MAX_MS, Math.max(0, durationMs));
    const x = startInFlight;
    if (x === 1) {
      deflectionSoloCount++;
      deflectionSoloTotalMs += y;
    } else if (x >= 2) {
      deflectionLoadedCount++;
    }
    deflectionSumX += x;
    deflectionSumY += y;
    deflectionSumXY += x * y;
    deflectionSumX2 += x * x;
  } catch {
    /* recording must never disturb the host; the decrement already ran */
  }
}

function deflectionP75(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(s.length - 1, Math.ceil(0.75 * s.length) - 1));
  return s[idx];
}

/** Load-deflection axis, or null while gated (a single-threaded trickle of
 *  traffic cannot deflect — reporting one would be a fabricated number). */
export function readLoadDeflection(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    if (isSettling("latencyTail")) {
      return deflectionSettling > 0 || deflectionSamples > 0 ? settlingReading({ score: null }) : null;
    }
    if (deflectionSamples < DEFLECTION_MIN_SAMPLES) return null;
    if (deflectionPeak < DEFLECTION_MIN_PEAK) return null;
    // Lowest and highest buckets that each have >= MIN_BUCKET_SAMPLES samples.
    let lowIdx = -1;
    let highIdx = -1;
    for (let i = 0; i < DEFLECTION_BUCKETS.length; i++) {
      if (deflectionDurations[i].length >= DEFLECTION_MIN_BUCKET_SAMPLES) {
        if (lowIdx < 0) lowIdx = i;
        highIdx = i;
      }
    }
    // Need two DISTINCT buckets each meeting the sample floor.
    if (lowIdx < 0 || highIdx < 0 || lowIdx === highIdx) return null;
    const lowMs = r0(deflectionP75(deflectionDurations[lowIdx]));
    const highMs = r0(deflectionP75(deflectionDurations[highIdx]));
    // Cannot form an honest ratio against a zero floor (parity with Python).
    if (lowMs <= 0) return null;
    const ratio = Math.round((highMs / lowMs) * 100) / 100;
    let score = linearScore(
      ratio,
      DEFLECTION_SCORE_GOOD_RATIO,
      DEFLECTION_SCORE_POOR_RATIO,
    );
    // RATING from the RATIO bands DIRECTLY (not ratingFor(score)) — parity
    // with Python/Go/Java: those "bending" thresholds are what a developer
    // reasons about.
    let rating: Rating;
    if (ratio <= DEFLECTION_RATIO_GOOD) rating = "good";
    else if (ratio >= DEFLECTION_RATIO_POOR) rating = "poor";
    else rating = "needs-work";
    if (highMs <= DEFLECTION_BUSY_FLOOR_MS) {
      score = 100;
      rating = "good";
    }
    // strainAtInFlight: smallest observed bucket floor (>=5 samples) whose p75
    // STRICTLY exceeded the runtime's existing poor latency budget, else null.
    // The key is ALWAYS present (null when none) — never omitted — for wire
    // parity with Python (None) / Go (nil) / Java (null).
    let strainAtInFlight: number | null = null;
    for (let i = 0; i < DEFLECTION_BUCKETS.length; i++) {
      if (deflectionDurations[i].length < DEFLECTION_MIN_BUCKET_SAMPLES) continue;
      if (deflectionP75(deflectionDurations[i]) > DEFLECTION_POOR_LATENCY_MS) {
        strainAtInFlight = DEFLECTION_BUCKETS[i].floor;
        break;
      }
    }
    // meanInFlight = (sum of in-flight-at-start over recorded samples) /
    // samples, one decimal (cross-runtime contract).
    const meanInFlight =
      deflectionSamples > 0 ? r1(deflectionInFlightSum / deflectionSamples) : 0;
    // Merged Load-Headroom fields (folded in from requestConcurrency). Both are
    // ALWAYS present, JSON null when unmeasured, NEVER 0-filled — wire parity
    // with Python (None) / Go (nil) / Java (null).
    // soloMeanMs: integer-rounded mean of CLAMPED durations of solo samples
    // (in-flight-at-start == 1); null when there are none.
    const soloMeanMs =
      deflectionSoloCount > 0
        ? r0(deflectionSoloTotalMs / deflectionSoloCount)
        : null;
    // deflectionMsPerReq: least-squares slope of CLAMPED duration on in-flight-
    // at-start over ALL recorded samples, round(max(0, slope)). Null unless
    // loadedCount >= 10 AND soloCount > 0, and null when the denominator
    // n*sumX2 - sumX^2 <= 0 (degenerate — all x identical).
    let deflectionMsPerReq: number | null = null;
    if (deflectionLoadedCount >= DEFLECTION_MIN_LOADED && deflectionSoloCount > 0) {
      const n = deflectionSamples;
      const denom = n * deflectionSumX2 - deflectionSumX * deflectionSumX;
      if (denom > 0) {
        const slope =
          (n * deflectionSumXY - deflectionSumX * deflectionSumY) / denom;
        deflectionMsPerReq = r0(Math.max(0, slope));
      }
    }
    // The 11 contract keys — NO caption (Go dropped it; Python/Java never had
    // it; the server rebuilds captions and the ingest sanitizer strips them
    // anyway) — plus the held-open record, attached ONLY when a stream was
    // actually excluded (docs/held-open-calls.md).
    const axis: ExtraAxis = markSettled({
      score,
      rating,
      peakInFlight: deflectionPeak,
      meanInFlight,
      lowMs,
      highMs,
      ratio,
      strainAtInFlight,
      samples: deflectionSamples,
      soloMeanMs,
      deflectionMsPerReq,
    });
    const held = getHeldOpenStats();
    if (held.heldOpenExcluded > 0) {
      axis.heldOpenExcluded = held.heldOpenExcluded;
      axis.heldOpenWorstMs = held.heldOpenWorstMs;
    }
    return axis;
  } catch {
    return null;
  }
}

/* ── Swallowed errors (near-miss rate) ───────────────────────────────────
 * Errors the HOST app LOGGED at error level but did NOT crash on — a near
 * miss. Ported EXACTLY from the Python kit (extra_meters.py: _note_log_record,
 * _read_swallowed_errors, registration). Same wire shape, same rounding, same
 * caption sentence pattern.
 *
 * HOST HOOK: the honest Node signal is `console.error`. We CHAIN it — call the
 * host's original FIRST, count one TIMESTAMP, then return exactly what the
 * original returned. We never add/remove a log handler, never change
 * formatting or output. We EXCLUDE Boosthis's own logging (a re-entrancy flag)
 * so we never count ourselves. We do NOT touch uncaughtException /
 * unhandledRejection — those are crashes, not near misses, and the crash
 * reporter owns them. */
/** Bands copied from Python: 1/hour = good, 60/hour = poor. */
const SWALLOWED_GOOD_PER_HOUR = 1;
const SWALLOWED_POOR_PER_HOUR = 60;
/** A 5-minute minimum window before the axis reports at all (too early for a
 *  clean bill to be honest). */
const SWALLOWED_MIN_WINDOW_MS = MIN_RATE_WINDOW_MS;
/** Trailing window capped at 60 minutes. */
const SWALLOWED_WINDOW_MS = 60 * 60_000;
/** Ring of at most 400 timestamps — TIMESTAMPS ONLY, never the message, args,
 *  or stack. */
const SWALLOWED_RING_CAP = 400;

/** Ring of error-log timestamps (ms). Nothing else is ever stored. */
const swallowedTs: number[] = [];
/** True once we've chained console.error. */
let swallowedArmed = false;
/** The host's original console.error, restored on teardown. */
let origConsoleError: ((...args: unknown[]) => void) | null = null;
/** Our chained wrapper (identity-checked before we unhook). */
let ourConsoleError: ((...args: unknown[]) => void) | null = null;
/** Re-entrancy guard: set while OUR OWN code is inside console.error so we
 *  never count Boosthis's own logging. */
let swallowedInOurLog = false;

/** Count one host error-log. Records ONLY a timestamp. Never throws into the
 *  host's logging call. */
/** The shared decision (swallowedErrors): a swallowed error is a CAUGHT
 *  exception the app logged and carried on from — an Error handed to
 *  console.error, or text carrying a stack. A plain error LINE is the app
 *  reporting a condition it chose to report, and never counts. */
const SWALLOWED_STACK_FRAME_RE = /\n\s+at\s/;
const SWALLOWED_ARG_SCAN_MAX = 8;
const SWALLOWED_TEXT_SCAN_MAX = 4096;
/** Caught exceptions logged while the process was settling (start-up rule,
 *  startupEvent): an import or config probe that fails once is booting. */
let swallowedSettling = 0;

function argsCarryException(args: readonly unknown[]): boolean {
  const n = Math.min(args.length, SWALLOWED_ARG_SCAN_MAX);
  for (let i = 0; i < n; i++) {
    const a = args[i];
    if (a instanceof Error) return true;
    if (a !== null && typeof a === "object") {
      if (Object.prototype.toString.call(a) === "[object Error]") return true;
    } else if (
      typeof a === "string" &&
      SWALLOWED_STACK_FRAME_RE.test(a.slice(0, SWALLOWED_TEXT_SCAN_MAX))
    ) {
      return true;
    }
  }
  return false;
}

function noteSwallowedError(args: readonly unknown[]): void {
  try {
    if (isBoosthisDisabled() || !started) return;
    if (swallowedInOurLog) return; // never count ourselves
    if (!argsCarryException(args)) return;
    if (isSettling("startupEvent")) {
      swallowedSettling++;
      return;
    }
    swallowedTs.push(Date.now());
    if (swallowedTs.length > SWALLOWED_RING_CAP) {
      swallowedTs.splice(0, swallowedTs.length - SWALLOWED_RING_CAP);
    }
  } catch {
    /* monitor-only — never disturb the host's logging */
  }
}

/** Chain `console.error`: call the host's original FIRST, observe (count a
 *  timestamp), then return exactly what the host expected. We never replace
 *  behaviour — a chained wrapper leaves the host's output untouched. */
function startSwallowedErrors(): void {
  if (swallowedArmed) return;
  try {
    const orig = console.error?.bind(console) as
      | ((...args: unknown[]) => void)
      | undefined;
    if (typeof orig !== "function") return;
    origConsoleError = orig;
    const wrapper = function boosthisConsoleError(...args: unknown[]): void {
      // Host FIRST — return exactly what it returns (console.error returns
      // void, but we forward the call result verbatim regardless).
      const result = (orig as (...a: unknown[]) => unknown)(...args);
      noteSwallowedError(args);
      // leakWatch (2026-08): piggyback the SAME wrapper (never a second
      // console.error hook). Reuses the swallowedInOurLog re-entrancy flag so
      // the kit's own logging is never scanned/counted. Categories from log
      // output: secret, pii (see spec). Bounded, self-guarded, monitor-only.
      noteLeakFromLog(args);
      return result as void;
    };
    ourConsoleError = wrapper;
    (console as { error: (...a: unknown[]) => void }).error = wrapper;
    swallowedArmed = true;
  } catch {
    origConsoleError = null;
    ourConsoleError = null;
    swallowedArmed = false;
  }
}

/** Put the host's console.error back. If another library chained ON TOP of
 *  ours we leave the chain alone — unhooking would drop THEIR wrapper too.
 *  Ours is already inert in that case, because `started` is false. */
function restoreSwallowedErrors(): void {
  try {
    if (
      ourConsoleError &&
      origConsoleError &&
      (console as { error?: unknown }).error === ourConsoleError
    ) {
      (console as { error: (...a: unknown[]) => void }).error = origConsoleError;
    }
  } catch {
    /* best-effort */
  }
  origConsoleError = null;
  ourConsoleError = null;
  swallowedArmed = false;
}

/** Swallowed-errors axis, or null until the minimum window elapses (too early
 *  for a clean bill to be honest). Wire shape identical to Python. */
export function readSwallowedErrors(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started || !swallowedArmed) return null;
  try {
    const now = Date.now();
    if (isSettling("startupEvent", now)) {
      return swallowedSettling > 0 ? settlingReading({ score: null }) : null;
    }
    // Counted over the settled part of the last hour (start-up rule).
    const from = Math.max(now - SWALLOWED_WINDOW_MS, startedAt, settledFromMs("startupEvent"));
    const windowMs = now - from;
    if (windowMs < SWALLOWED_MIN_WINDOW_MS) return null;
    let count = 0;
    for (const t of swallowedTs) if (t >= from) count++;
    const perHour = earnedPerHour(count, windowMs) ?? 0;
    const score = linearScore(perHour, SWALLOWED_GOOD_PER_HOUR, SWALLOWED_POOR_PER_HOUR);
    return markSettled({
      score,
      rating: ratingFor(score),
      count,
      perHour,
      windowMin: windowMinOf(windowMs),
      caption:
        count === 0
          ? `no logged errors \u00b7 ${r0(windowMs / 60_000)} min watched`
          : `${count} error${count !== 1 ? "s" : ""} logged, app survived`,
    });
  } catch {
    return null;
  }
}

/* ── Leak Watch (customer-app leakage) ───────────────────────────────────
 * Detects the CUSTOMER's app leaking stack traces, secrets/keys, or personal
 * details to its OWN users — via error-level log/console output (hook 1,
 * piggybacked on the swallowedErrors console.error chain above) and via error
 * response bodies (hook 2, piggybacked on the middleware; fed here). Runtime
 * evidence only. NEVER feeds the Speed score — additive/display-only, exactly
 * like swallowedErrors.
 *
 * ABSOLUTE PRIVACY RULE (a mistake here is itself a breach): the matched text,
 * the matched value, the log line, the response body, and the route/path NAME
 * are NEVER stored beyond the local classification scope, never logged, never
 * put in any field, caption, or error. Counters, timestamps, category, and the
 * coarse route CLASS (one of a closed 4-value set) only. Each observation is
 * classified into EXACTLY ONE category — priority secret > pii > stack — so the
 * per-category split always sums to the total count.
 *
 * Gates mirror swallowedErrors: 5-min minimum window before reporting; 60-min
 * trailing window; bounded ring of {timestamp, category} events (cap 200); the
 * axis is omitted (absent) while warming. score = 100 when count === 0, else
 * max(0, 70 - round(perHour * 10)) — any observed leak is at best needs-work. */
const LEAK_MIN_WINDOW_MS = MIN_RATE_WINDOW_MS;
const LEAK_WINDOW_MS = 60 * 60_000;
const LEAK_RING_CAP = 200;
/** First N chars scanned from log output (per spec). */
const LEAK_LOG_SCAN_MAX = 4096;
/** First N bytes of an error response body buffered + scanned (per spec). */
const LEAK_BODY_SCAN_MAX = 8192;

/** Leak categories — EXACTLY one per observation, priority secret > pii > stack. */
type LeakCategory = "secret" | "pii" | "stack";

/** Surface kinds — the KIND of place a detection was seen. Closed set. */
const LEAK_SURFACE_LOG = 1; // the app's own log/console output
const LEAK_STACK_RE = /\bat .{1,200}\(.{1,200}:\d+:\d+\)/;
const LEAK_ERROR_AT_RE = /Error:[\s\S]{0,200}\n\s{4}at /;
// secret: JWT, bearer, AWS access key id, PEM private key, api-key/secret/token=…
const LEAK_JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const LEAK_BEARER_RE = /bearer\s+(\S{8,})/gi;
const LEAK_AKIA_RE = /AKIA[0-9A-Z]{16}/;
const LEAK_PEM_RE = /-----BEGIN [\s\S]{0,64}PRIVATE KEY/;
const LEAK_KV_SECRET_RE =
  /(?:api[_-]?key|secret|token)["']?\s*[:=]\s*["']?([A-Za-z0-9_\-]{16,})/gi;

/* ── Placeholders are not credentials ─────────────────────────────────────
 *
 * A value written in a placeholder form is, by construction, the ABSENCE of a
 * credential: it is what a message prints where a credential would go. The two
 * shapes that read a free-form value — bearer and the named api-key/secret/
 * token value — are the only ones that can meet one, because the other three
 * match a fixed alphabet a placeholder cannot satisfy.
 *
 * This narrowing was written after our own site's Leak Watch reported 50
 * secret-class detections an hour, every one of them the string
 * "Authorization: Bearer <project-key>" inside our own 403 body telling a
 * caller HOW to send its key. Counting an instruction as a leak makes the tile
 * unactionable for us and for every customer who documents an auth header in
 * an error reply, which is the ordinary thing to do.
 *
 * The set is deliberately small and closed: bracketed forms, template
 * expressions, redaction runs, and the handful of ALL-CAPS stand-in words. It
 * is NOT a general "looks unimportant" filter — anything outside it is still a
 * detection. Widening it would hide real leaks, so a future change here needs
 * the same kind of evidence this one has. See docs/leak-detection-vocabulary.md.
 *
 * The pattern anchors at the START of the value and then allows only
 * NON-VALUE characters to the end, because the value a shape captures runs to
 * the next space and so drags whatever punctuation the surrounding sentence or
 * JSON encoding put there ("Bearer <project-key>)\"}"). A real credential can
 * still follow a bracketed form — "<x>realkey123456" is not a placeholder,
 * because the tail is made of value characters.
 *
 * The word forms are matched CASE-SENSITIVELY in caps, which is how a document
 * writes a stand-in. Lower-case "mytoken…" or "sample…" is a plausible real
 * credential prefix and stays a detection.
 */
const LEAK_PLACEHOLDER_VALUE_RE =
  /^(?:<[^>]*>|\{\{[^}]*\}\}|\$\{[^}]*\}|\*{3,}|[xX]{3,}|\.{3,}|\u2026|(?:YOUR|EXAMPLE|SAMPLE|PLACEHOLDER|REPLACE|INSERT)[A-Z0-9_-]*)[^A-Za-z0-9_-]*$/;
/** Classify a bounded text slice into EXACTLY ONE category (priority
 *  secret > pii > stack), or null if nothing matched. The input slice lives
 *  ONLY on the caller's stack and is discarded immediately after — this
 *  function returns a category enum and a numeric shape code ONLY, never any
 *  matched substring. Shapes are tested in a fixed order, so the reported
 *  shape is deterministically the FIRST one that matched. */
function classifyLeak(text: string): LeakClass | null {
  try {
    if (LEAK_JWT_RE.test(text)) return { cat: "secret", shape: LEAK_SHAPE_JWT };
    // A placeholder value ends neither the shape nor the classification: the
    // scan walks the shape's LATER matches for a real value, and only then
    // falls through to the remaining shapes.
    if (hasRealValue(LEAK_BEARER_RE, text)) {
      return { cat: "secret", shape: LEAK_SHAPE_BEARER };
    }
    if (LEAK_AKIA_RE.test(text)) {
      return { cat: "secret", shape: LEAK_SHAPE_AWS_KEY_ID };
    }
    if (LEAK_PEM_RE.test(text)) {
      return { cat: "secret", shape: LEAK_SHAPE_PRIVATE_KEY };
    }
    if (hasRealValue(LEAK_KV_SECRET_RE, text)) {
      return { cat: "secret", shape: LEAK_SHAPE_NAMED_VALUE };
    }
    if (EMAIL_RE.test(text)) return { cat: "pii", shape: LEAK_SHAPE_EMAIL };
    if (LEAK_STACK_RE.test(text) || LEAK_ERROR_AT_RE.test(text)) {
      return { cat: "stack", shape: LEAK_SHAPE_STACK_FRAME };
    }
    return null;
  } catch {
    return null;
  }
}

interface LeakEvent {
  t: number;
  cat: LeakCategory;
  /** Closed surface-kind code (LEAK_SURFACE_*). */
  surf: LeakSurface;
  /** Closed shape code (LEAK_SHAPE_*). */
  shape: number;
}
/** Bounded ring of {timestamp, category, surface code, shape code} — every
 *  member is a number or a closed enum. NOTHING else is ever stored. */
const leakEvents: LeakEvent[] = [];
/** Bounded set of DISTINCT coarse route classes observed in the window. Only
 *  the COUNT (0-4) ever leaves the process; the class strings are a CLOSED,
 *  in-kit constant set — never a route/path name. */
const leakRouteClasses = new Set<string>();

/** Record one classified leak observation. Timestamp, category, surface code
 *  and shape code only. Never throws into the host. */
function recordLeak(
  klass: LeakClass,
  surf: LeakSurface,
  routeClass?: string,
): void {
  try {
    if (isBoosthisDisabled() || !started) return;
    leakEvents.push({
      t: Date.now(),
      cat: klass.cat,
      surf,
      shape: klass.shape,
    });
    if (leakEvents.length > LEAK_RING_CAP) {
      leakEvents.splice(0, leakEvents.length - LEAK_RING_CAP);
    }
    if (routeClass) leakRouteClasses.add(routeClass);
  } catch {
    /* never raise into the host */
  }
}

/** Hook 1 — log/console output. Called from the SAME console.error wrapper as
 *  swallowedErrors, guarded by the SAME swallowedInOurLog re-entrancy flag so
 *  the kit's own logging is never scanned. Categories: secret, pii (a stack
 *  trace logged at error level is already the swallowedErrors signal; per spec
 *  the log path here contributes secret/pii). Stringifies args to a BOUNDED
 *  slice that lives only on this stack and is dropped on return. */
function noteLeakFromLog(args: unknown[]): void {
  try {
    if (isBoosthisDisabled() || !started) return;
    if (swallowedInOurLog) return; // never scan/count our own logging
    // Bounded stringify: cap the joined length at the scan max so a huge log
    // line never costs more than a fixed slice of work.
    let text = "";
    for (const a of args) {
      if (text.length >= LEAK_LOG_SCAN_MAX) break;
      text += (typeof a === "string" ? a : safeStringify(a)) + " ";
    }
    text = text.slice(0, LEAK_LOG_SCAN_MAX);
    // Log path classifies secret > pii only (stack from logs is the
    // swallowedErrors near-miss signal). Reuse classifyLeak but ignore a bare
    // stack match here so the two meters stay distinct.
    const klass = classifyLeak(text);
    if (klass && (klass.cat === "secret" || klass.cat === "pii")) {
      recordLeak(klass, LEAK_SURFACE_LOG);
    }
    // text goes out of scope here — never stored.
  } catch {
    /* monitor-only — never disturb the host's logging call */
  }
}

/** Bounded, throw-safe stringify for log args (objects → a short JSON-ish
 *  form). The result is scanned then dropped; never stored. */
function safeStringify(v: unknown): string {
  try {
    if (v == null) return String(v);
    if (typeof v === "object") {
      if (v instanceof Error) {
        // Error → message + stack (bounded) so a logged Error's stack frames
        // are visible to classifyLeak's stack patterns.
        return `${v.name}: ${v.message}\n${v.stack ?? ""}`.slice(
          0,
          LEAK_LOG_SCAN_MAX,
        );
      }
      return JSON.stringify(v).slice(0, LEAK_LOG_SCAN_MAX);
    }
    return String(v);
  } catch {
    return "";
  }
}

/** Coarse route class from a request path — the CLOSED set {api, page, asset,
 *  other}. Computed in-kit; only the DISTINCT-class COUNT ever crosses the
 *  wire. `path` and `accept` are read here and NOT retained. */
const LEAK_ASSET_EXT_RE =
  /\.(?:js|mjs|cjs|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|json|txt|xml|pdf|mp4|webm|wasm)$/i;
export function leakRouteClass(path: string, accept?: string): string {
  try {
    const p = (path || "").split("?")[0];
    const acceptsJson =
      typeof accept === "string" && accept.toLowerCase().includes("json");
    if (p.startsWith("/api/") || p === "/api" || acceptsJson) return "api";
    if (LEAK_ASSET_EXT_RE.test(p)) return "asset";
    if (p) return "page";
    return "other";
  } catch {
    return "other";
  }
}

/** One encoder for the whole kit — created once, and only if the runtime has
 *  one. See `utf8BytePrefix` for what happens where it does not. */
const LEAK_TEXT_ENCODER: InstanceType<typeof TextEncoder> | null =
  typeof TextEncoder === "function" ? new TextEncoder() : null;

/**
 * The first `maxBytes` UTF-8 bytes of `text`, without ENCODING — or
 * allocating — more of it than that.
 *
 * The bound this kit publishes on every leak-watch read is in BYTES, and a
 * JavaScript string is counted in UTF-16 units: 8,192 characters of
 * three-byte text is 24 KB, three times the bound we print. Cutting at
 * `maxBytes` CHARACTERS and then encoding that slice is NOT enough, because
 * the encode is itself the read: it walks and copies up to three bytes per
 * character, so a character cut at the bound still put 24 KB of somebody's
 * error page through this process before a single byte was trimmed off it.
 *
 * So the destination is allocated FIRST, at the bound, and the encoder fills
 * it and stops. `encodeInto` writes whole characters only and never more than
 * the destination holds, so the read STOPS at the bound instead of being
 * trimmed back to it: nothing larger than `maxBytes` is ever walked or copied,
 * and no character is left half-written.
 *
 * Where the runtime has no `TextEncoder` (none we ship on, but this must never
 * throw in a host we have not met), the fallback cuts to `maxBytes / 3`
 * characters — three UTF-8 bytes is the most a single UTF-16 unit can encode
 * to, so that slice cannot exceed the bound either. It reads LESS than we
 * allow ourselves, never more.
 */
export function utf8BytePrefix(text: string, maxBytes: number): string {
  if (maxBytes <= 0 || text === "") return "";
  if (LEAK_TEXT_ENCODER === null) {
    const units = Math.floor(maxBytes / 3);
    return text.length > units ? text.slice(0, units) : text;
  }
  // A UTF-16 unit encodes to at most three UTF-8 bytes (a four-byte character
  // is a surrogate PAIR, so two units), which makes this a ceiling on what
  // `text` can produce — it keeps a short chunk from allocating the whole
  // bound, and never under-allocates.
  const room = Math.min(maxBytes, text.length * 3);
  const out = new Uint8Array(room);
  const written = LEAK_TEXT_ENCODER.encodeInto(text, out).written ?? 0;
  if (written === 0) return "";
  return Buffer.from(out.buffer, out.byteOffset, written).toString("utf8");
}

/** Hook 2 — error response body. Called from the middleware ONCE per finished
 *  response, with a BOUNDED (<=8192-byte) slice of the body captured ONLY when
 *  statusCode >= 400 and the content-type is text/html, text/plain,
 *  application/json, or absent. The middleware discards its buffer immediately
 *  after this returns. Categories: stack, secret, pii (full classifyLeak).
 *  `body` lives only on the caller's + this stack and is never stored. */
export function noteLeakFromResponse(
  body: string,
  routeClass: string,
): void {
  try {
    if (isBoosthisDisabled() || !started) return;
    const text = utf8BytePrefix(body, LEAK_BODY_SCAN_MAX);
    const klass = classifyLeak(text);
    if (klass) recordLeak(klass, LEAK_SURFACE_REPLY, routeClass);
    // text/body out of scope here — never stored.
  } catch {
    /* monitor-only — never disturb the host response */
  }
}

/** Words for the surface split — counts and closed vocabulary only. The
 *  DASHBOARD's wording is written server-side from the same numbers; this copy
 *  exists for the kit's own in-app panel, which never sees the server. */
function leakSurfacePhrase(fromLogCount: number, fromReplyCount: number): string {
  if (fromReplyCount === 0) return "all in your app's log output";
  if (fromLogCount === 0) return "all in error replies your app sent";
  return `${fromReplyCount} in error replies your app sent, ${fromLogCount} in log output`;
}
/** Leak-watch axis, or null until the 5-minute minimum window elapses (parity
 *  with swallowedErrors — a clean bill is only honest after observation). Wire
 *  shape mirrors the cross-runtime contract; contains counts, timestamps-derived
 *  rates, the distinct route-CLASS count, and rating/caption strings ONLY. */
export function readLeakWatch(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started || !swallowedArmed) return null;
  try {
    const now = Date.now();
    const windowMs = Math.min(now - startedAt, LEAK_WINDOW_MS);
    if (windowMs < LEAK_MIN_WINDOW_MS) return null;
    const cutoff = now - windowMs;
    let count = 0;
    let stackCount = 0;
    let secretCount = 0;
    let piiCount = 0;
    let fromLogCount = 0;
    let fromReplyCount = 0;
    let shapeMask = 0;
    for (const e of leakEvents) {
      if (e.t < cutoff) continue;
      count++;
      if (e.cat === "secret") secretCount++;
      else if (e.cat === "pii") piiCount++;
      else stackCount++;
      if (e.surf === LEAK_SURFACE_REPLY) fromReplyCount++;
      else fromLogCount++;
      shapeMask |= e.shape;
    }
    // The earned-rate contract (rateHonesty.ts) — the gate above already holds
    // the reading until the window earns the projection, so this cannot be null.
    const perHour = earnedPerHour(count, windowMs) ?? 0;
    // Any observed leak is at best "needs-work": 100 when clean, else the
    // rate-penalized needs-work-capped curve.
    const routeClassCount = leakRouteClasses.size;
    // Caption: counts + category WORDS only — never content. Absence-of-
    // evidence wording when clean (never "you are protected").
    let caption: string;
    if (count === 0) {
      caption = "no leaks observed in this window";
    } else {
      const parts: string[] = [];
      if (secretCount > 0) parts.push(`${secretCount} secret-like`);
      if (piiCount > 0) parts.push(`${piiCount} personal-detail`);
      if (stackCount > 0) parts.push(`${stackCount} stack trace`);
      caption =
        `${count} possible leak${count === 1 ? "" : "s"} observed (${parts.join(", ")})` +
        ` \u00b7 ${leakSurfacePhrase(fromLogCount, fromReplyCount)}` +
        ` \u00b7 ${leakShapePhrase(shapeMask)}`;
    }
    return markSettled({
      // The shared decision (leakWatch): a text SHAPE in a body or a log is a
      // suspicion, not an established disclosure (a public support address
      // matches the e-mail shape), so the counts ride and nothing is graded.
      score: null,
      rating: "not-scored" as const,
      count,
      perHour,
      windowMin: windowMinOf(windowMs),
      stackCount,
      secretCount,
      piiCount,
      routeClassCount,
      fromLogCount,
      fromReplyCount,
      shapeMask,
      caption,
    });
  } catch {
    return null;
  }
}

/* ── Lifecycle + assembly ────────────────────────────────────────────────*/

/** Start every extra collector. Idempotent, no-op under the kill-switch,
 *  never throws. Called from `enableTelemetry`. */
export function startExtraMeters(): void {
  if (isBoosthisDisabled() || started) return;
  started = true;
  startedAt = Date.now();
  try {
    startHandleChurn();
  } catch {
    /* best-effort */
  }
  try {
    startRejectionPressure();
  } catch {
    /* best-effort */
  }
  try {
    startRuntimeSafetyMeters();
  } catch {
    /* best-effort */
  }
  try {
    startWorkerBalance();
  } catch {
    /* best-effort */
  }
  try {
    // Near-miss rate: chain console.error (host FIRST, count a timestamp,
    // return verbatim). No new hook for loadDeflection — it rides the request
    // boundary the middleware already times.
    startSwallowedErrors();
  } catch {
    /* best-effort */
  }
  try {
    // 2026-08 batch 2: process/OS accounting, V8 space, event-loop histogram
    // and diagnostics-channel collectors (see processMeters.ts).
    startProcessMeters();
  } catch {
    /* best-effort */
  }
  try {
    // Realtime: watch the server's own `upgrade` event so a WebSocket is seen
    // whichever library speaks the protocol on it, and under BOTH wiring
    // answers (middleware and attach()).
    startLiveConnections();
  } catch {
    /* best-effort */
  }
}

/* ── Cookie Exposure (safe-flag exposure on cookies we actually set) ──
 * Counts cookies leaving this process WITHOUT their safe flags, observed on the
 * real outgoing Set-Cookie header — after the framework, any proxy and any CDN
 * have had their say, which is exactly where reading config lies. Reports
 * EXPOSURE, never safety: a clean tile means "no unsafe flag observed on the
 * responses we watched", never "your cookies are safe".
 *
 * ABSOLUTE PRIVACY RULE (a mistake here is itself a breach): the cookie NAME,
 * the cookie VALUE, the header text and the route/path name are NEVER stored
 * beyond the local parsing scope below — never logged, never placed in any
 * field, caption or error. Counters only, exactly like leakWatch.
 *
 * Additive/display-only: never feeds the Speed score. */

/** Longest single Set-Cookie value browsers reliably keep (bytes). */
const COOKIE_MAX_BYTES = 4096;
/** Set-Cookie values inspected per response (bounded work on the hot path). */
const COOKIE_PER_RESPONSE_MAX = 20;
/** Characters of the ATTRIBUTE tail (everything after the first ';') that are
 *  ever examined. A real attribute list is far shorter; this is what keeps a
 *  huge cookie value from costing unbounded work inside the response path. */
const COOKIE_ATTR_SCAN_MAX = 2048;
/** Attribute segments examined per cookie. */
const COOKIE_ATTR_SEGMENT_MAX = 20;
/** Counter saturation ceiling — counts stop climbing rather than overflow. */
const COOKIE_COUNT_MAX = 1_000_000_000;

let cookieSetCount = 0;
let cookieResponses = 0;
let cookieNoSecure = 0;
let cookieNoHttpOnly = 0;
let cookieNoSameSite = 0;
let cookieNoneWithoutSecure = 0;
let cookieOversize = 0;

const bumpCookie = (n: number): number =>
  n >= COOKIE_COUNT_MAX ? COOKIE_COUNT_MAX : n + 1;

/** Classify ONE Set-Cookie value. The value string lives only on this stack.
 *
 *  Attributes are matched as whole SEGMENTS, never as substrings: a cookie
 *  NAMED "insecure_id", or one whose VALUE contains the text "httponly", must
 *  still count as missing that flag. A substring match would report a clean
 *  cookie configuration that is not clean, which is the one mistake this meter
 *  must never make. The name=value part (everything before the first ';') is
 *  therefore never inspected for attributes at all.
 *
 *  The parse is byte-identical in the Node, Python, Go and Java kits. */
/** The shared decision (cookieExposure): HttpOnly matters on a cookie that
 *  IS a credential (a session, an auth or refresh token, a remember-me). A
 *  CSRF token, a theme or a consent flag is meant to be read by the page's own
 *  script, so a missing HttpOnly there is not exposure. The name is classified
 *  on this stack and dropped: never kept, never counted by name, never sent.
 *  The word lists are this kit's own; a name that cannot be read counts. */
const COOKIE_NEVER_CREDENTIAL = ["csrf", "xsrf"];
const COOKIE_CREDENTIAL_PARTS = [
  "session", "sessid", "token", "jwt", "login", "remember", "refresh", "credential",
];
const COOKIE_CREDENTIAL_WORDS = new Set(["sid", "sess", "auth", "authorization"]);
const COOKIE_NAME_SCAN_MAX = 1024;

function cookieIsCredential(raw: string): boolean {
  try {
    // The name ends at the first "=" or ";" (a name can hold neither) and the
    // walk stops there, so the value is never searched, copied or matched. A
    // name longer than the bound is unreadable, and counts.
    const limit = Math.min(raw.length, COOKIE_NAME_SCAN_MAX + 1);
    let end = -1;
    for (let i = 0; i < limit; i++) {
      const c = raw.charCodeAt(i);
      if (c === 61 || c === 59) {
        end = i;
        break;
      }
    }
    if (end < 0) {
      if (raw.length > COOKIE_NAME_SCAN_MAX) return true;
      end = raw.length;
    }
    const name = raw.slice(0, end).trim().toLowerCase();
    if (name === "") return true;
    if (COOKIE_NEVER_CREDENTIAL.some((w) => name.includes(w))) return false;
    if (COOKIE_CREDENTIAL_PARTS.some((p) => name.includes(p))) return true;
    for (const word of name.split(/[^a-z0-9]+/)) {
      if (COOKIE_CREDENTIAL_WORDS.has(word)) return true;
      if (word.startsWith("auth") && !word.startsWith("author")) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function noteOneCookie(raw: string): void {
  cookieSetCount = bumpCookie(cookieSetCount);

  let hasSecure = false;
  let hasHttpOnly = false;
  let sameSite: string | null = null;
  const firstSemi = raw.indexOf(";");
  if (firstSemi >= 0) {
    // Attribute tail only, capped — the cookie value itself is skipped whole.
    const tail = raw.slice(firstSemi + 1, firstSemi + 1 + COOKIE_ATTR_SCAN_MAX);
    const segments = tail.split(";");
    const limit = Math.min(segments.length, COOKIE_ATTR_SEGMENT_MAX);
    for (let i = 0; i < limit; i++) {
      // Short segments only — the whole header value is never lowercased.
      const seg = segments[i];
      const eq = seg.indexOf("=");
      // Browsers tolerate whitespace around the '=' ("SameSite = Lax"), so the
      // name and the value are trimmed independently. Calling that missing
      // would be a FALSE exposure finding, which is as harmful as a false
      // clean one.
      const name = (eq >= 0 ? seg.slice(0, eq) : seg).trim().toLowerCase();
      if (name === "secure") hasSecure = true;
      else if (name === "httponly") hasHttpOnly = true;
      else if (name === "samesite" && eq >= 0) {
        sameSite = seg.slice(eq + 1).trim().toLowerCase();
      }
      // A bare "samesite" with no '=' is malformed and browsers ignore it, so
      // it deliberately does NOT count as present.
    }
  }

  if (!hasSecure) cookieNoSecure = bumpCookie(cookieNoSecure);
  if (!hasHttpOnly && cookieIsCredential(raw)) {
    cookieNoHttpOnly = bumpCookie(cookieNoHttpOnly);
  }
  if (sameSite === null) cookieNoSameSite = bumpCookie(cookieNoSameSite);
  // SameSite=None without Secure: browsers reject the cookie outright, so the
  // app silently loses the session it thinks it set.
  if (sameSite === "none" && !hasSecure) {
    cookieNoneWithoutSecure = bumpCookie(cookieNoneWithoutSecure);
  }
  // Oversize is UTF-8 BYTES, matching the other three kits. A value longer
  // than the limit in CHARACTERS is oversize by definition (UTF-8 never uses
  // fewer bytes than characters), so the byte length is only measured for
  // short values — a huge header never costs an encode on the response path.
  if (
    raw.length > COOKIE_MAX_BYTES ||
    Buffer.byteLength(raw, "utf8") > COOKIE_MAX_BYTES
  ) {
    cookieOversize = bumpCookie(cookieOversize);
  }
}

/** Fed by the middleware ONCE per finished response with the outgoing
 *  Set-Cookie header (string, array, or absent). Nothing is retained. */
export function noteCookiesFromResponse(
  header: string | number | string[] | undefined | null,
): void {
  try {
    if (isBoosthisDisabled() || !started) return;
    if (header === undefined || header === null) return;
    const list = Array.isArray(header) ? header : [String(header)];
    let seen = 0;
    for (const entry of list) {
      if (seen >= COOKIE_PER_RESPONSE_MAX) break;
      if (typeof entry !== "string" || entry === "") continue;
      seen++;
      noteOneCookie(entry);
    }
    if (seen > 0) cookieResponses = bumpCookie(cookieResponses);
  } catch {
    /* monitor-only — never disturb the host response */
  }
}

/** Cookie-exposure axis, or null when this app has not been observed setting a
 *  cookie yet (honest absence — never a green tile for an app with no cookies).
 *  Wire shape is identical in the Node, Python, Go and Java kits. */
/* ── Access Pressure (break-in pressure + traffic surge) ──────────────────
 * The first status-shaped signal on the wire: counts of the app's OWN answers
 * — rejected (401/403/429), not-found (404), server-error (5xx) — plus the
 * peak per-minute rejection burst, the peak per-minute request rate against
 * the session's own median (the surge ratio), and an anonymous estimate of
 * how many distinct clients the rejections came from.
 *
 * ABSOLUTE PRIVACY RULE: no URL, no route, no client address, no header, no
 * user identity ever leaves the app. The client address is hashed with a
 * random per-day salt into ONE of 63 bit positions inside the local scope
 * below (the same windowed-OR-sketch design as issue reach) and is retained
 * NOWHERE — only the sketch's popcount ever crosses the wire.
 *
 * Banding keys on the SHAPE of traffic — share of rejections, burst against
 * the session's own quiet baseline — never raw counts, because a login page
 * always has failed logins and a public API always has 404s. Where there is
 * no baseline yet the axis is honestly absent (a warming tile), never a
 * guess. Additive/display-only: never feeds the Speed score.
 *
 * Wire shape (byte-identical semantics in the Node, Python, Go, Java kits):
 * { score, rating, unauth, forbidden, limited, notFound, serverError, total,
 *   burstPeak60s, surgeRatio, reachEstimate, caption } */

/** Length of one rate bucket (the "60-second window" of the design). */
const AP_BUCKET_MS = 60_000;
/** Completed minute buckets kept for the baseline median (4 hours). */
const AP_MAX_MINUTES = 240;
/** Responses required before the shape of traffic is worth rating. */
const AP_MIN_TOTAL_FOR_RATING = 50;
/** Completed minutes required before the session has a baseline. */
const AP_MIN_BASELINE_MINUTES = 10;
/** A "surge" below this many requests in its peak minute is noise, not a
 *  surge — a quiet dev app getting 20 hits must never band on ratio alone. */
const AP_SURGE_MIN_PEAK = 30;
/** Requests per quiet minute the session must actually HAVE before a ratio
 *  taken against it is a ratio at all.
 *
 *  The divisor below is `Math.max(median, 1)`, and on an app that is idle most
 *  of the time the median minute IS zero — so the "ratio" became the peak
 *  minute's raw count wearing a multiplier sign. Our own live server published
 *  `surgeRatio: 17.4` that way and banded poor on it, which is the count 95
 *  divided by a baseline nobody measured. Below this floor the session has no
 *  quiet baseline to be a multiple of, so the ratio travels as null (absent,
 *  never a fabricated number) and the surge half of the band stands down. The
 *  rejection-share half is unaffected: it needs no baseline. */
const AP_SURGE_MIN_MEDIAN = 5;
/** Surge-ratio bands (peak minute vs session median minute). */
const AP_SURGE_WARN = 3;
const AP_SURGE_POOR = 8;
/** Break-in-pressure share bands (share of ALL responses that were refusals
 *  the app's own routing did not choose — see `noteAccessOutcome`). */
const AP_SHARE_WARN = 0.2;
const AP_SHARE_POOR = 0.5;
/** Ratio ceiling so a zero-median session cannot print absurd numbers. */
const AP_SURGE_CAP = 999;
/** Counter saturation ceiling — counts stop climbing rather than overflow. */
const AP_COUNT_MAX = 1_000_000_000;

const bumpAp = (n: number): number => (n >= AP_COUNT_MAX ? AP_COUNT_MAX : n + 1);

let apTotal = 0;
let apUnauth = 0;
let apForbidden = 0;
let apLimited = 0;
let apNotFound = 0;
let apServerError = 0;
/** 403/404 answered BY a route this app serves — the app's own protocol
 *  vocabulary, counted apart from break-in pressure (see below). */
let apProtocolAnswers = 0;
/** Responses where the host gave the kit no way to tell whether its own
 *  routing chose the answer. Published so a reader can see how much of the
 *  split was guesswork rather than measurement. */
let apUnattributed = 0;
let apBucketStart = 0;
let apCurReq = 0;
let apCurRej = 0;
/** Completed per-minute request counts (baseline median source). */
let apReqMinutes: number[] = [];
/** Session-running peaks including the still-open minute. */
let apPeakReq = 0;
/** Responses seen while the process was settling (start-up rule). */
let apSettling = 0;
let apPeakRej = 0;
/** 63-bit OR sketch of clients that received a rejection (popcount only ever
 *  leaves; the max bit is 1n<<62n so a signed 64-bit consumer never sees an
 *  overflow — same contract as the issue-reach sketch). */
let apSketch = 0n;
let apSaltDay = "";
let apSalt = "";
/** Clock indirection — tests pin it for deterministic bucket rollover. */
let apNow: () => number = Date.now;

/** Per-UTC-day random salt for the client-address hash. Never derived from
 *  anything, never persisted, never uploaded — rotating it daily means the
 *  sketch counts device-DAYS, exactly like the issue-reach design. */
function apDailySalt(): string {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== apSaltDay || apSalt === "") {
    apSaltDay = day;
    apSalt = randomBytes(16).toString("hex");
  }
  return apSalt;
}

/** Roll the open minute bucket forward to `now`, filing completed minutes
 *  (including empty ones — a quiet minute IS the baseline) into the ring. */
function apRollBuckets(now: number): void {
  if (apBucketStart === 0) {
    apBucketStart = now;
    return;
  }
  let gap = Math.floor((now - apBucketStart) / AP_BUCKET_MS);
  if (gap <= 0) return;
  // File the minute that just closed, then any fully-empty minutes between.
  apReqMinutes.push(apCurReq);
  apCurReq = 0;
  apCurRej = 0;
  const zeros = Math.min(gap - 1, AP_MAX_MINUTES);
  for (let i = 0; i < zeros; i++) apReqMinutes.push(0);
  if (apReqMinutes.length > AP_MAX_MINUTES) {
    apReqMinutes = apReqMinutes.slice(apReqMinutes.length - AP_MAX_MINUTES);
  }
  apBucketStart += gap * AP_BUCKET_MS;
}

/** Fed by the middleware ONCE per finished response with the final status, the
 *  transport-level peer address, and whether the app's OWN routing chose the
 *  handler that answered. The address is used ONLY inside this call's stack to
 *  flip one anonymous sketch bit — it is never stored, never logged, never
 *  placed in any field or caption.
 *
 *  `routeMatched` is the whole difference between a break-in signal and a
 *  count of an app talking to itself. It is `true` when the request reached a
 *  route this app registered (Express fills `req.route`), `false` when the
 *  router had nothing for that path, and `null`/omitted where the host gives
 *  the kit no route table to ask — a bare `http.createServer` handler, for
 *  instance.
 *
 *  A 404 or 403 FROM a registered route is the app's own protocol vocabulary:
 *  "no such entitlement", "not registered yet", "you may not have this one".
 *  Our own API answers those hundreds of times an hour to our own kits, and
 *  counting them as break-in pressure put a score of 0 and the worst available
 *  verdict on an API doing exactly what it was built to do. A security-shaped
 *  meter that fires on a product's own normal traffic teaches a developer to
 *  ignore it, so those answers are counted apart, published, and kept out of
 *  the band.
 *
 *  What still counts as pressure, and why each one is something to act on:
 *    · 401 — a credential was demanded. Always, matched route or not.
 *    · 429 — the app refused for rate. Always.
 *    · 404 with no matched route — the caller asked for a path this app does
 *      not serve. That is the scanner signal.
 *    · 403 with no matched route — a gate refused before routing.
 *
 *  Known limit, stated rather than papered over: an app that answers bad
 *  credentials with 403 from its own matched login route lands in the protocol
 *  column here. 401 is the correct status for that case and is always counted,
 *  and the volume half (429, and the surge reading) still sees the attempt. */
export function noteAccessOutcome(
  status: unknown,
  clientAddr?: string | null,
  routeMatched?: boolean | null,
): void {
  try {
    if (isBoosthisDisabled() || !started) return;
    if (typeof status !== "number" || !Number.isFinite(status)) return;
    if (status < 100 || status > 599) return;
    const now = apNow();
    // The start-up rule (peakRate): the traffic that waited for a cold process
    // lands at once, so the first minute is booting, not pressure. Nothing
    // from it enters the counts, the minute ring or the peak.
    if (now < settledFromMs("peakRate")) {
      apSettling = bumpAp(apSettling);
      return;
    }
    apRollBuckets(now);
    apTotal = bumpAp(apTotal);
    apCurReq++;
    if (apCurReq > apPeakReq) apPeakReq = apCurReq;
    // Three states, never two: matched, did-not-match, and cannot-tell. The
    // last one is counted as pressure exactly as it was before this split
    // existed (a host with no route table gives us nothing better), but it is
    // also published, so a reader can see how much of the verdict rests on a
    // distinction the kit could not actually draw here.
    const chosenByApp = routeMatched === true;
    const cannotTell = routeMatched !== true && routeMatched !== false;
    let rejection = false;
    if (status === 401) {
      apUnauth = bumpAp(apUnauth);
      rejection = true;
    } else if (status === 403) {
      apForbidden = bumpAp(apForbidden);
      rejection = !chosenByApp;
    } else if (status === 429) {
      apLimited = bumpAp(apLimited);
      rejection = true;
    } else if (status === 404) {
      apNotFound = bumpAp(apNotFound);
      rejection = !chosenByApp;
    } else if (status >= 500) {
      apServerError = bumpAp(apServerError);
    }
    if ((status === 403 || status === 404) && chosenByApp) {
      apProtocolAnswers = bumpAp(apProtocolAnswers);
    }
    if (rejection && cannotTell && (status === 403 || status === 404)) {
      apUnattributed = bumpAp(apUnattributed);
    }
    if (!rejection) return;
    apCurRej++;
    if (apCurRej > apPeakRej) apPeakRej = apCurRej;
    if (typeof clientAddr === "string" && clientAddr !== "") {
      // sha256(salt + address) → one of 63 bit positions. The digest's first
      // 32-bit big-endian word mod 63 mirrors the issue-reach sketch exactly.
      const digest = createHash("sha256")
        .update(apDailySalt() + clientAddr)
        .digest();
      const pos = digest.readUInt32BE(0) % 63;
      apSketch |= 1n << BigInt(pos);
    }
  } catch {
    /* monitor-only — never disturb the host response */
  }
}

/** Median of the completed minute buckets (zeros included — quiet is real). */
function apMedianRate(): number {
  const sorted = [...apReqMinutes].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/** Popcount of the 63-bit reach sketch. */
function apReachEstimate(): number {
  let v = apSketch;
  let count = 0;
  while (v > 0n) {
    if (v & 1n) count++;
    v >>= 1n;
  }
  return count;
}

/** Access-pressure axis, or null while the session has no baseline yet —
 *  a rating with nothing to compare against would be a guess, and a red tile
 *  on a healthy busy app is worse than no tile. Wire shape identical in the
 *  Node, Python, Go and Java kits. */
export function readAccessPressure(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    if (isSettling("peakRate", apNow())) {
      return apSettling > 0 ? settlingReading({ score: null }) : null;
    }
    if (apTotal <= 0) return null;
    // Buckets roll on the WRITE path (every finished response) — never here,
    // so a read clock can't file phantom quiet minutes into the baseline.
    if (apTotal < AP_MIN_TOTAL_FOR_RATING) return null;
    if (apReqMinutes.length < AP_MIN_BASELINE_MINUTES) return null;
    // Break-in pressure ONLY: refusals the app's own routing did not choose.
    // A 403/404 that came back out of a registered route is the app answering
    // a question it publishes an answer to, and it is counted separately.
    const rejections =
      apUnauth + apLimited + apForbidden + apNotFound - apProtocolAnswers;
    const rejShare = Math.max(0, rejections) / apTotal;
    const median = apMedianRate();
    // A ratio needs something to be a ratio OF. Below the floor the session
    // has no quiet baseline, so the number is withheld rather than invented,
    // and the surge half of the band cannot fire.
    const haveBaseline = median >= AP_SURGE_MIN_MEDIAN;
    const surgeRatio = haveBaseline
      ? r1(Math.min(AP_SURGE_CAP, apPeakReq / median))
      : null;
    // Banding on SHAPE only: share of unchosen refusals, and the peak minute
    // against the session's own median — never raw counts. The surge bands
    // apply only once the peak minute carries real volume AND there is a
    // measured baseline underneath it.
    const surging = apPeakReq >= AP_SURGE_MIN_PEAK && surgeRatio !== null;
    const rating: Rating =
      rejShare >= AP_SHARE_POOR || (surging && surgeRatio! >= AP_SURGE_POOR)
        ? "poor"
        : rejShare >= AP_SHARE_WARN || (surging && surgeRatio! >= AP_SURGE_WARN)
          ? "needs-work"
          : "good";
    const surgePenalty = surging
      ? Math.min(1, Math.max(0, surgeRatio! - 1) / (AP_SURGE_POOR - 1))
      : 0;
    const score = Math.max(
      0,
      Math.min(
        100,
        r0(100 - 70 * Math.min(1, rejShare / AP_SHARE_POOR) - 30 * surgePenalty),
      ),
    );
    // Caption: counts, shares and ratios only — never an address, route,
    // header or user identity.
    const reach = apReachEstimate();
    const parts: string[] = [];
    if (rejections > 0) {
      parts.push(
        `${rejections} of ${apTotal} responses were refusals this app's own routing did not choose (${r0(rejShare * 100)}%)`,
      );
      if (apPeakRej > 0) parts.push(`peak ${apPeakRej} rejections/min`);
      if (reach > 0) {
        parts.push(
          reach >= 10
            ? "\u224810+ sources"
            : reach >= 2
              ? "\u22482\u20139 sources"
              : "\u22481 source",
        );
      }
    }
    // Named, not hidden. These are the app's own 403/404 answers and they are
    // the reason this tile is no longer red on an API whose vocabulary
    // includes "no such thing yet".
    if (apProtocolAnswers > 0) {
      parts.push(
        `${apProtocolAnswers} more were answers from routes this app serves \u2014 not counted as pressure`,
      );
    }
    if (apUnattributed > 0) {
      parts.push(
        `${apUnattributed} could not be attributed to a route on this host and are counted as pressure`,
      );
    }
    if (surging && surgeRatio! >= AP_SURGE_WARN) {
      parts.push(`traffic peaked at ${surgeRatio}\u00d7 the quiet baseline`);
    } else if (!haveBaseline && apPeakReq >= AP_SURGE_MIN_PEAK) {
      parts.push(
        `busiest minute ${apPeakReq} requests, with no quiet baseline to be a multiple of \u2014 no surge verdict`,
      );
    }
    const caption =
      parts.length === 0
        ? `no rejection pressure across ${apTotal} responses`
        : parts.join(", ");
    return markSettled({
      score,
      rating,
      unauth: apUnauth,
      forbidden: apForbidden,
      limited: apLimited,
      notFound: apNotFound,
      serverError: apServerError,
      // Of the forbidden + not-found counts above, how many came back out of a
      // route this app registered. Subtracted from the band, published so the
      // two numbers on the tile add up in the open.
      protocolAnswers: apProtocolAnswers,
      // Refusals on a host that gave the kit no route table to ask. Counted as
      // pressure (nothing better is available) and said out loud.
      unattributedRefusals: apUnattributed,
      // What the band actually divided: the refusals left after the app's own
      // answers came out. Named so no reader has to do the subtraction.
      breakInRefusals: Math.max(0, rejections),
      total: apTotal,
      burstPeak60s: apPeakRej,
      // Null, never a fabricated multiple, when the session has no quiet
      // minute to compare the peak against.
      surgeRatio,
      baselineRate: r1(median),
      reachEstimate: reach,
      caption,
    });
  } catch {
    return null;
  }
}

/** Drop every access-pressure counter (wired into clearExtraMeters). */
function resetAccessPressure(): void {
  apTotal = 0;
  apSettling = 0;
  apUnauth = 0;
  apForbidden = 0;
  apLimited = 0;
  apNotFound = 0;
  apServerError = 0;
  apProtocolAnswers = 0;
  apUnattributed = 0;
  apBucketStart = 0;
  apCurReq = 0;
  apCurRej = 0;
  apReqMinutes = [];
  apPeakReq = 0;
  apPeakRej = 0;
  apSketch = 0n;
  apSaltDay = "";
  apSalt = "";
}

/** Test seam — deterministic bucket rollover without waiting a minute. */
export function _rollAccessBucketsForTests(now: number): void {
  apRollBuckets(now);
}
/** Test seam — set the bucket clock origin. */
export function _setAccessBucketStartForTests(ts: number): void {
  apBucketStart = ts;
}
/** Test seam — pin the collector's clock (pass null to restore Date.now). */
export function _setAccessClockForTests(fn: (() => number) | null): void {
  apNow = fn ?? Date.now;
}
/** Test seam — drop all access-pressure state. */
export function _resetAccessPressureForTests(): void {
  resetAccessPressure();
  apNow = Date.now;
}

/* ── Refusal Honesty (credentialed callers challenged again) ───────────────
 *
 * OBSERVATION, NOT A VERDICT. This axis counts refusals and reports what shape
 * they had; it never scores or rates them, and it must not start doing so.
 *
 * Why: at this boundary the kit can see that a request carried an
 * authorization header and that the refusal carried a challenge — it CANNOT
 * see whether the credential was understood. A 401 with a challenge is the
 * correct answer to an expired, revoked or mistyped credential, so a score
 * built on these counts would fault an app for behaving correctly. The counts
 * are still worth reporting (they are the only view anyone has of who is being
 * turned away), so they ship with `score: null`, `rating: "not-scored"` and a
 * caption that says in words that this is an observation.
 *
 * The rating is the point. "pending" is the word for a score that has not been
 * earned YET, and this one never will be — a reader with full source access
 * once filed a correct ten-minute observation as a defect ("counted everything
 * correctly but remained pending") because that was the only word we gave him.
 * "not-scored" says permanently, by design, and the server writes the sentence.
 */
export const REFUSAL_MIN_WINDOW_MS = 10 * 60 * 1000;
let refusalStartedAt = 0;
let refusalRefusals = 0;
let refusalChallenged = 0;
let refusalCredentialed = 0;
let refusalCredChallenged = 0;
let refusalMeasurable = 1;
let refusalNow: () => number = Date.now;

/** Presence-only finished-response feed. Header values never enter this API. */
export function noteRefusalHonesty(
  status: unknown,
  authorizationPresent: boolean,
  challengePresent: boolean,
  measurable = true,
): void {
  try {
    if (isBoosthisDisabled() || !started) return;
    const now = refusalNow();
    if (refusalStartedAt === 0) refusalStartedAt = now;
    if (!measurable) {
      refusalMeasurable = 0;
      refusalRefusals = refusalChallenged = refusalCredentialed = refusalCredChallenged = 0;
      return;
    }
    if (refusalMeasurable === 0) return;
    if (status !== 401 && status !== 403) return;
    refusalRefusals = bumpAp(refusalRefusals);
    if (challengePresent) refusalChallenged = bumpAp(refusalChallenged);
    if (authorizationPresent) refusalCredentialed = bumpAp(refusalCredentialed);
    if (status === 401 && challengePresent && authorizationPresent) {
      refusalCredChallenged = bumpAp(refusalCredChallenged);
    }
  } catch {
    /* monitor-only — never disturb the host response */
  }
}

export function readRefusalHonesty(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started || refusalStartedAt === 0) return null;
  try {
    const elapsed = Math.max(0, refusalNow() - refusalStartedAt);
    if (elapsed < REFUSAL_MIN_WINDOW_MS) return null;
    const windowMin = windowMinOf(elapsed);
    if (refusalMeasurable === 0) {
      return {
        score: null,
        // Not the same silence as the branch below. This host cannot take the
        // reading at all; that one takes it and declines to grade it. Both
        // used to say "pending", so the two were indistinguishable from the
        // rating alone even inside this one axis. `measurable: 0` still rides
        // along, so a server that does not know this label reads the state
        // exactly as it always has.
        rating: "not-available",
        refusals: 0,
        challenged: 0,
        credentialed: 0,
        credentialedChallenged: 0,
        sharePct: 0,
        windowMin,
        measurable: 0,
        caption: "not measurable \u2014 this host does not expose response headers",
      };
    }
    const sharePct =
      refusalRefusals === 0
        ? 0
        : Math.round((refusalCredChallenged / refusalRefusals) * 100);
    return {
      // No score and no rating, deliberately: see the note above the counters.
      // Header PRESENCE cannot tell a wrongly-refused caller from a correctly
      // refused one, so this axis reports what it saw and stops there.
      score: null,
      // Permanently unscored, said in the rating itself rather than left for a
      // reader to infer from a null score. The counts are real and keep
      // rendering (measurable stays 1) — only the VERDICT is absent, and it is
      // absent for good.
      rating: "not-scored",
      refusals: refusalRefusals,
      challenged: refusalChallenged,
      credentialed: refusalCredentialed,
      credentialedChallenged: refusalCredChallenged,
      sharePct,
      windowMin,
      measurable: 1,
      // WHY there is no verdict, from the shared closed vocabulary, for a
      // server too old to know the "not-scored" rating: header presence cannot
      // tell a wrongly-refused caller from a correctly refused one, so this
      // axis reports what it saw and stops. Kept alongside the rating, never
      // replaced by it — dropping it would make this reading render as a bare
      // "warming up" on every server that has not been updated.
      reasonCode: REASON_NOTHING_TO_COMPARE,
      caption:
        refusalRefusals === 0
          ? `no refusals observed \u00b7 ${windowPhrase(windowMin)}`
          : `${refusalCredChallenged} of ${refusalRefusals} refusals challenged a caller who had already sent a credential (${sharePct}%) \u2014 an observation, not a fault`,
    };
  } catch {
    return null;
  }
}

function resetRefusalHonesty(): void {
  refusalStartedAt = 0;
  refusalRefusals = 0;
  refusalChallenged = 0;
  refusalCredentialed = 0;
  refusalCredChallenged = 0;
  refusalMeasurable = 1;
}

export function _setRefusalClockForTests(fn: (() => number) | null): void {
  refusalNow = fn ?? Date.now;
}

export function _resetRefusalHonestyForTests(): void {
  resetRefusalHonesty();
  refusalNow = Date.now;
}

/** Cookie-exposure axis, or null when this app has not been observed setting a
 *  cookie yet (honest absence — never a green tile for an app with no cookies).
 *  Wire shape is identical in the Node, Python, Go and Java kits. */

export function readCookieExposure(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    if (cookieSetCount <= 0) return null;
    const unsafeShare =
      (cookieNoSecure + cookieNoneWithoutSecure) / cookieSetCount;
    const weakShare =
      (cookieNoHttpOnly + cookieNoSameSite + cookieOversize) /
      (cookieSetCount * 3);
    const score = Math.max(
      0,
      Math.min(100, r0(100 - 70 * unsafeShare - 30 * weakShare)),
    );
    const rating: Rating =
      cookieNoSecure > 0 || cookieNoneWithoutSecure > 0
        ? "poor"
        : cookieNoHttpOnly > 0 || cookieNoSameSite > 0 || cookieOversize > 0
          ? "needs-work"
          : "good";
    // Caption: counts and flag NAMES only — never a cookie name or value.
    const missing: string[] = [];
    if (cookieNoSecure > 0) missing.push(`${cookieNoSecure} without Secure`);
    if (cookieNoneWithoutSecure > 0) {
      missing.push(`${cookieNoneWithoutSecure} SameSite=None without Secure`);
    }
    if (cookieNoHttpOnly > 0) {
      missing.push(`${cookieNoHttpOnly} session or auth cookie${cookieNoHttpOnly === 1 ? "" : "s"} without HttpOnly`);
    }
    if (cookieNoSameSite > 0) {
      missing.push(`${cookieNoSameSite} without SameSite`);
    }
    if (cookieOversize > 0) missing.push(`${cookieOversize} over 4 KB`);
    const caption =
      missing.length === 0
        ? `no unsafe flags on ${cookieSetCount} cookie${cookieSetCount === 1 ? "" : "s"} we watched`
        : `${missing.join(", ")} of ${cookieSetCount} cookie${cookieSetCount === 1 ? "" : "s"} set`;
    return {
      score,
      rating,
      setCount: cookieSetCount,
      responses: cookieResponses,
      noSecure: cookieNoSecure,
      noHttpOnly: cookieNoHttpOnly,
      noSameSite: cookieNoSameSite,
      noneWithoutSecure: cookieNoneWithoutSecure,
      oversize: cookieOversize,
      caption,
    };
  } catch {
    return null;
  }
}

/** Drop every cookie-exposure counter (wired into clearExtraMeters). */
function resetCookieExposure(): void {
  cookieSetCount = 0;
  cookieResponses = 0;
  cookieNoSecure = 0;
  cookieNoHttpOnly = 0;
  cookieNoSameSite = 0;
  cookieNoneWithoutSecure = 0;
  cookieOversize = 0;
}

/* ── Cross-Origin Exposure (the cross-origin headers as actually served) ───
 *
 * The other half of "transport protections as actually served". The cookie
 * reading above reads the Set-Cookie header after the framework and any proxy
 * in the process had their say; this reads the cross-origin answer on the SAME
 * finished responses: Access-Control-Allow-Origin and
 * Access-Control-Allow-Credentials, against the request's own Origin.
 *
 * Three shapes are counted, and nothing else:
 *   - anyOrigin            the answer was `*` (any site may read it);
 *   - reflected            the answer was the very Origin the request carried;
 *   - wildcardCredentials  `*` AND `Access-Control-Allow-Credentials: true`,
 *                          a pairing browsers refuse on any request that sends
 *                          credentials.
 *
 * OBSERVATION, NEVER A VERDICT, and never scored. A correct allowlist echoes
 * an allowed origin back in exactly the same header, byte for byte, as an app
 * that echoes every origin — nothing in one response tells the two apart. So
 * `reflected` is the shape of the answer, not a fault, and this axis ships
 * `score: null` and `rating: "not-scored"` for good, like refusalHonesty.
 *
 * ABSOLUTE PRIVACY RULE: the Origin, both header values, the host and the
 * route are compared on the stack of classifyCorsAnswer() and dropped. Only
 * the four booleans it returns leave it, and only counts leave the process.
 *
 * The rule is the same in every server kit: the FIRST value of each header,
 * trimmed; the Origin compared case-insensitively ("null" is an origin like
 * any other); `true` for credentials compared case-insensitively. */

/** What one response's cross-origin answer looked like. Four booleans — the
 *  only thing that ever leaves the comparison. */
export interface CorsAnswerShape {
  originSent: boolean;
  anyOrigin: boolean;
  reflected: boolean;
  wildcardCredentials: boolean;
}

/** Characters of a header value ever looked at. A real origin is far shorter;
 *  past this the value cannot be an origin we compare, and the hot path never
 *  pays for a huge one. */
const CORS_VALUE_SCAN_MAX = 512;

function firstHeaderValue(v: unknown): string {
  const first = Array.isArray(v) ? v[0] : v;
  if (typeof first === "number" && Number.isFinite(first)) return String(first);
  if (typeof first !== "string") return "";
  return first.length > CORS_VALUE_SCAN_MAX ? "" : first.trim();
}

/** Decide one response's shape. Every argument lives only on this stack. */
export function classifyCorsAnswer(
  requestOrigin: unknown,
  allowOrigin: unknown,
  allowCredentials: unknown,
): CorsAnswerShape {
  const origin = firstHeaderValue(requestOrigin);
  const acao = firstHeaderValue(allowOrigin);
  const acac = firstHeaderValue(allowCredentials).toLowerCase();
  const anyOrigin = acao === "*";
  return {
    originSent: origin !== "",
    anyOrigin,
    reflected:
      origin !== "" && acao !== "" && !anyOrigin &&
      acao.toLowerCase() === origin.toLowerCase(),
    wildcardCredentials: anyOrigin && acac === "true",
  };
}

let corsStartedAt = 0;
let corsResponses = 0;
let corsOriginRequests = 0;
let corsAnyOrigin = 0;
let corsReflected = 0;
let corsWildcardCredentials = 0;
let corsMeasurable = 1;
let corsNow: () => number = Date.now;

/** Fed ONCE per finished response with the shape decided above, or with
 *  `null` when this host gave no way to read the response's headers. */
export function noteCorsAnswer(shape: CorsAnswerShape | null): void {
  try {
    if (isBoosthisDisabled() || !started) return;
    if (corsStartedAt === 0) corsStartedAt = corsNow();
    if (shape === null) {
      // Nothing about the answer could be read, so nothing is counted — and a
      // host that never lets us read one says so instead of warming for ever.
      if (corsResponses === 0) corsMeasurable = 0;
      return;
    }
    corsMeasurable = 1;
    corsResponses = bumpCookie(corsResponses);
    if (shape.originSent) corsOriginRequests = bumpCookie(corsOriginRequests);
    if (shape.anyOrigin) corsAnyOrigin = bumpCookie(corsAnyOrigin);
    if (shape.reflected) corsReflected = bumpCookie(corsReflected);
    if (shape.wildcardCredentials) {
      corsWildcardCredentials = bumpCookie(corsWildcardCredentials);
    }
  } catch {
    /* monitor-only — never disturb the host response */
  }
}

/** Cross-origin exposure axis, or null before a single finished response has
 *  been looked at (the expected tile warms until then). */
export function readCorsExposure(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started || corsStartedAt === 0) return null;
  try {
    const windowMs = Math.max(0, corsNow() - corsStartedAt);
    if (corsResponses === 0) {
      if (corsMeasurable !== 0) return null;
      return {
        score: null,
        rating: "not-available",
        responses: 0,
        windowMs,
        measurable: 0,
        reasonCode: REASON_PLATFORM_DOES_NOT_EXPOSE,
        caption: "not measurable \u2014 this host does not expose response headers",
      };
    }
    const parts: string[] = [];
    if (corsAnyOrigin > 0) parts.push(`${corsAnyOrigin} answered any origin`);
    if (corsReflected > 0) {
      parts.push(`${corsReflected} echoed back the origin that asked (an allowlist does this too)`);
    }
    if (corsWildcardCredentials > 0) {
      parts.push(`${corsWildcardCredentials} paired a wildcard with credentials`);
    }
    const watched = `${corsResponses} response${corsResponses === 1 ? "" : "s"}`;
    return {
      // Never scored, by design: see the note above classifyCorsAnswer.
      score: null,
      rating: "not-scored",
      responses: corsResponses,
      originRequests: corsOriginRequests,
      anyOrigin: corsAnyOrigin,
      reflected: corsReflected,
      wildcardCredentials: corsWildcardCredentials,
      windowMs,
      measurable: 1,
      reasonCode: REASON_NOTHING_TO_COMPARE,
      caption:
        parts.length === 0
          ? `none of the ${watched} watched answered any origin, echoed the origin that asked, or paired a wildcard with credentials \u00b7 ${windowPhrase(windowMinOf(windowMs))}`
          : `${parts.join(", ")} \u2014 of ${watched} watched`,
    };
  } catch {
    return null;
  }
}

/** Drop every cross-origin counter (wired into clearExtraMeters). */
function resetCorsExposure(): void {
  corsStartedAt = 0;
  corsResponses = 0;
  corsOriginRequests = 0;
  corsAnyOrigin = 0;
  corsReflected = 0;
  corsWildcardCredentials = 0;
  corsMeasurable = 1;
}

/** The LAUNCH-STATE dev-posture checks — read once and frozen for the life of
 *  the process, because each one is fixed when the process starts.
 *
 *  `profilingOpen` is deliberately NOT here: an inspector can be opened on a
 *  running process at any time (SIGUSR1, `inspector.open()`), and detached
 *  again, so it is re-read on every snapshot instead. See `readProfilingOpen`.
 *
 *  `sourceMaps` is deliberately NOT here either: that flag means "a .map file
 *  is being SERVED", which a Node process cannot see. Node reads the
 *  stack-trace setting instead, under its own name. */
interface DevPostureSnapshot {
  debugFlag?: number;
  verboseErrors?: number;
  sourceMapTraces?: number;
}

/** Assemble every currently-available extra axis (warming/env-absent axes
 *  omitted — the server renders expected ones as pending). Pure read. */
export function readExtraMeters(): Record<string, ExtraAxis> {
  const axes: Record<string, ExtraAxis> = {};
  const hc = readHandleChurn();
  if (hc) axes.handleChurn = hc;
  const rp = readRejectionPressure();
  if (rp) axes.rejectionPressure = rp;
  if (started) {
    // promiseRejections is the plain unseen subset: its count is exactly the
    // rejectionPressure.unhandled count above, while rejectionPressure.perHour
    // intentionally also includes the late-handled side.
    axes.promiseRejections = readPromiseRejections();
    axes.unhandledErrors = readUnhandledErrors();
    axes.timerHealth = readTimerHealth();
  }
  const bp = readBackpressure();
  if (bp) axes.backpressure = bp;
  const wi = readWorkerImbalance();
  if (wi) axes.workerImbalance = wi;
  const ld = readLoadDeflection();
  if (ld) axes.loadDeflection = ld;
  const se = readSwallowedErrors();
  if (se) axes.swallowedErrors = se;
  const lw = readLeakWatch();
  if (lw) axes.leakWatch = lw;
  const ce = readCookieExposure();
  if (ce) axes.cookieExposure = ce;
  const co = readCorsExposure();
  if (co) axes.corsExposure = co;
  const ap = readAccessPressure();
  if (ap) axes.accessPressure = ap;
  const rh = readRefusalHonesty();
  if (rh) axes.refusalHonesty = rh;
  const dp = readDevPosture();
  if (dp) axes.devPosture = dp;
  // Realtime: OMITTED entirely for a process that holds no long-lived
  // connection. A row of zeros would claim we had looked at a chat feature the
  // app does not have.
  const lc = readLiveConnections();
  if (lc) axes.liveConnections = lc;
  // 2026-08 batch 2 (processMeters.ts): warming/env-absent axes omitted.
  Object.assign(axes, readProcessMeters());
  if (started) {
    const host = readHostResourceMeters();
    if (host.diskPressure) axes.diskPressure = host.diskPressure;
    if (host.storageLatency) axes.storageLatency = host.storageLatency;
    if (host.storageFailures) axes.storageFailures = host.storageFailures;
    if (host.ioPressure) axes.ioPressure = host.ioPressure;
    if (host.pageFaults) axes.pageFaults = host.pageFaults;
    if (host.descriptorMix) axes.descriptorMix = host.descriptorMix;
    if (host.systemLoad) axes.systemLoad = host.systemLoad;
  }
  return axes;
}

/** Tear down listeners/hooks and drop all state (wired into
 *  `telemetry.forget()`). Idempotent. Never throws. */
export function clearExtraMeters(): void {
  started = false;
  startedAt = 0;
  clearHostResourceMeters();
  clearRuntimeSafetyMeters();
  resetCookieExposure();
  resetCorsExposure();
  resetAccessPressure();
  resetRefusalHonesty();
  resetDevPosture();
  try {
    clearProcessMeters();
  } catch {
    /* best-effort */
  }
  try {
    if (churnHook) churnHook.disable();
  } catch {
    /* best-effort */
  }
  churnHook = null;
  churnBuckets.length = 0;
  try {
    if (rejectionHandledListener) {
      process.removeListener(
        "rejectionHandled",
        rejectionHandledListener as (p: Promise<unknown>) => void,
      );
    }
    if (warningListener) {
      process.removeListener("warning", warningListener as (w: Error) => void);
    }
  } catch {
    /* best-effort */
  }
  rejectionHandledListener = null;
  warningListener = null;
  lateHandledCount = 0;
  unhandledWarningCount = 0;
  rejectionSettlingCount = 0;
  bpTotal = 0;
  bpBackpressured = 0;
  bpBuckets.length = 0;
  bpSettling = 0;
  try {
    if (clusterListener) cluster.removeListener("message", clusterListener);
  } catch {
    /* best-effort */
  }
  clusterListener = null;
  try {
    if (clusterOnlineListener) cluster.removeListener("online", clusterOnlineListener);
    if (clusterExitListener) cluster.removeListener("exit", clusterExitListener);
  } catch {
    /* never let meter wiring disturb the host */
  }
  clusterOnlineListener = null;
  clusterExitListener = null;
  workerCounts.clear();
  workerBornAt.clear();
  workerPendingCount = 0;
  workerLastSentAt = 0;
  isClusterPrimary = false;
  isClusterWorker = false;
  // Load deflection: drop counters + bucket rings.
  deflectionInFlight = 0;
  deflectionPeak = 0;
  deflectionInFlightSum = 0;
  deflectionSamples = 0;
  deflectionSoloCount = 0;
  deflectionSoloTotalMs = 0;
  deflectionLoadedCount = 0;
  deflectionSumX = 0;
  deflectionSumY = 0;
  deflectionSumXY = 0;
  deflectionSumX2 = 0;
  for (const ring of deflectionDurations) ring.length = 0;
  // Swallowed errors: put the host's console.error back and wipe timestamps.
  try {
    restoreSwallowedErrors();
  } catch {
    /* best-effort */
  }
  swallowedTs.length = 0;
  swallowedSettling = 0;
  swallowedInOurLog = false;
  deflectionSettling = 0;
  // Leak Watch: drop the bounded event ring + distinct route-class set.
  leakEvents.length = 0;
  leakRouteClasses.clear();
  // Realtime: unpatch the upgrade event, stop the byte sampler, forget every
  // tracked connection — nothing Boosthis-shaped keeps watching after erasure.
  try {
    clearLiveConnections();
  } catch {
    /* best-effort */
  }
}

/** @internal test hooks. */
export const _extraMetersInternals = {
  CHURN_GOOD_PER_MIN,
  CHURN_POOR_PER_MIN,
  MIN_CHURN_ELAPSED_MS,
  REJECT_RATE_GOOD,
  REJECT_RATE_POOR,
  REJECT_MIN_WINDOW_MIN,
  BP_PCT_GOOD,
  BP_PCT_POOR,
  MIN_BP_RESPONSES,
  IMBALANCE_GOOD_RATIO,
  IMBALANCE_POOR_RATIO,
  MIN_IMBALANCE_REQUESTS,
  MIN_IMBALANCE_WORKERS,
  DEFLECTION_SCORE_GOOD_RATIO,
  DEFLECTION_SCORE_POOR_RATIO,
  DEFLECTION_RATIO_GOOD,
  DEFLECTION_RATIO_POOR,
  DEFLECTION_MIN_SAMPLES,
  DEFLECTION_MIN_BUCKET_SAMPLES,
  DEFLECTION_MIN_PEAK,
  DEFLECTION_MIN_LOADED,
  DEFLECTION_MAX_MS,
  DEFLECTION_POOR_LATENCY_MS,
  SWALLOWED_GOOD_PER_HOUR,
  SWALLOWED_POOR_PER_HOUR,
  SWALLOWED_MIN_WINDOW_MS,
  SWALLOWED_WINDOW_MS,
  SWALLOWED_RING_CAP,
  get isRunning(): boolean {
    return started;
  },
  reset(): void {
    clearExtraMeters();
  },
  /** Force started (+backdate) without real hooks for hermetic unit tests. */
  forceStart(at: number): void {
    started = true;
    startedAt = at;
  },
  /** Install a sentinel churn hook + push synthetic creation buckets. */
  enableChurnForTest(): void {
    churnHook = { disable() {} };
  },
  pushChurnBucket(t: number, count: number): void {
    churnBuckets.push({ t, count });
  },
  /** File `n` handle creations through the hook's own bucket path, now. */
  noteHandlesForTests(n: number): void {
    const now = Date.now();
    for (let i = 0; i < n; i++) bumpChurn(now);
  },
  /** Install a sentinel rejection listener + set synthetic counters. */
  enableRejectionsForTest(late: number, unhandled: number): void {
    rejectionHandledListener = () => {};
    lateHandledCount = late;
    unhandledWarningCount = unhandled;
  },
  /** Directly fold synthetic SETTLED responses (each held on a full buffer
   *  past the floor when counted as backpressured) into the current minute. */
  addResponsesForTests(total: number, backpressured: number): void {
    bpTotal += total;
    bpBackpressured += backpressured;
    addBpBucket(Date.now(), total, backpressured);
  },
  BP_HELD_FLOOR_MS,
  /** Feed one stray rejection through the listeners' own path. */
  noteStrayRejectionForTests(kind: "late" | "unhandled"): void {
    noteStrayRejection(kind);
  },
  /** Cluster primary paths, hermetically: a worker coming online, a batch of
   *  its counts arriving, and the worker exiting. */
  workerOnlineForTests(id: number, at: number): void {
    isClusterPrimary = true;
    noteWorkerOnline(id, at);
  },
  workerBatchForTests(id: number, n: number, at: number): void {
    isClusterPrimary = true;
    noteWorkerBatch(id, n, at);
  },
  workerExitForTests(id: number): void {
    noteWorkerExit(id);
  },
  /** Force primary mode + inject synthetic worker counts. */
  setWorkerCountsForTests(counts: Record<number, number>): void {
    isClusterPrimary = true;
    const now = Date.now();
    workerCounts.clear();
    workerBornAt.clear();
    for (const [id, n] of Object.entries(counts)) {
      workerCounts.set(Number(id), [{ t: now, n }]);
      workerBornAt.set(Number(id), 0);
    }
  },
  /** Drive the load-deflection collector through the real start/end path. */
  noteDeflection(startInFlight: number, durationMs: number): void {
    noteDeflectionEnd(startInFlight, durationMs);
  },
  /** Directly seed a bucket (by its in-flight floor) with durations, folding
   *  the seeded samples into BOTH the sample count and the meanInFlight
   *  numerator (each seeded sample counts as in-flight-at-start == floor) so
   *  the hermetic state stays consistent with the real record path. */
  seedDeflectionBucket(floor: number, durationsMs: number[]): void {
    const idx = deflectionBucketIndex(floor);
    for (const d of durationsMs) {
      deflectionDurations[idx].push(d);
      // Fold into the merged Load-Headroom accumulators exactly as the real
      // record path does (CLAMPED duration; bucket ring keeps RAW above).
      const y = Math.min(DEFLECTION_MAX_MS, Math.max(0, d));
      const x = floor;
      if (x === 1) {
        deflectionSoloCount++;
        deflectionSoloTotalMs += y;
      } else if (x >= 2) {
        deflectionLoadedCount++;
      }
      deflectionSumX += x;
      deflectionSumY += y;
      deflectionSumXY += x * y;
      deflectionSumX2 += x * x;
    }
    deflectionSamples += durationsMs.length;
    deflectionInFlightSum += floor * durationsMs.length;
  },
  setDeflectionPeakForTests(peak: number): void {
    deflectionPeak = peak;
  },
  bumpDeflectionInFlight(): number {
    return noteDeflectionStart();
  },
  get deflectionInFlight(): number {
    return deflectionInFlight;
  },
  get deflectionPeak(): number {
    return deflectionPeak;
  },
  get deflectionSamples(): number {
    return deflectionSamples;
  },
  /** Arm/fire/read the swallowed-errors hook hermetically. */
  armSwallowedForTests(): void {
    swallowedArmed = true;
  },
  fireSwallowedError(): void {
    noteSwallowedError([new Error("boosthis test")]);
  },
  /** Feed console.error arguments through the counting path as logged. */
  fireSwallowedLogForTests(...args: unknown[]): void {
    noteSwallowedError(args);
  },
  pushSwallowedTs(t: number): void {
    swallowedTs.push(t);
  },
  get swallowedCount(): number {
    return swallowedTs.length;
  },
  /** Run a function while marked as "our own" logging (self-exclusion test). */
  withOurLog(fn: () => void): void {
    swallowedInOurLog = true;
    try {
      fn();
    } finally {
      swallowedInOurLog = false;
    }
  },
  startSwallowed(): void {
    startSwallowedErrors();
  },
  restoreSwallowed(): void {
    restoreSwallowedErrors();
  },
  /* ── Leak Watch test seams ─────────────────────────────────────────────*/
  LEAK_MIN_WINDOW_MS,
  LEAK_WINDOW_MS,
  LEAK_RING_CAP,
  LEAK_LOG_SCAN_MAX,
  LEAK_BODY_SCAN_MAX,
  /** Arm the leak-watch reader hermetically (it shares swallowedArmed). */
  armLeakForTests(): void {
    swallowedArmed = true;
  },
  /** Classify a text slice → category enum only (no substring escapes). */
  classifyLeakForTests(text: string): LeakCategory | null {
    return classifyLeak(text)?.cat ?? null;
  },
  /** Classify a text slice → the closed numeric SHAPE code only. */
  classifyLeakShapeForTests(text: string): number | null {
    return classifyLeak(text)?.shape ?? null;
  },
  /** Drive hook 1 (log/console output) through the real scan+record path. */
  noteLeakFromLogForTests(args: unknown[]): void {
    noteLeakFromLog(args);
  },
  /** Drive hook 2 (response body) through the real scan+record path. */
  noteLeakFromResponseForTests(body: string, routeClass: string): void {
    noteLeakFromResponse(body, routeClass);
  },
  /** Compute the coarse route class (closed {api,page,asset,other}). */
  leakRouteClassForTests(path: string, accept?: string): string {
    return leakRouteClass(path, accept);
  },
  /** Push a synthetic event directly into the ring. Surface/shape default to
   *  the log surface and the stack-frame shape so older callers still work. */
  pushLeakEventForTests(
    t: number,
    cat: LeakCategory,
    surf: 1 | 2 = LEAK_SURFACE_LOG,
    shape: number = LEAK_SHAPE_STACK_FRAME,
  ): void {
    leakEvents.push({ t, cat, surf, shape });
  },
  /** Add a synthetic distinct route class to the observed set. */
  addLeakRouteClassForTests(routeClass: string): void {
    leakRouteClasses.add(routeClass);
  },
  get leakEventCount(): number {
    return leakEvents.length;
  },
  get leakRouteClassCount(): number {
    return leakRouteClasses.size;
  },
  _resetLeakForTests(): void {
    leakEvents.length = 0;
    leakRouteClasses.clear();
  },
  /** Drive the cookie-exposure collector through its REAL parse path. */
  noteCookiesForTests(
    header: string | string[] | undefined | null,
  ): void {
    noteCookiesFromResponse(header);
  },
  /** Read the cookie-exposure axis exactly as the snapshot would. */
  readCookieExposureForTests(): ExtraAxis | null {
    return readCookieExposure();
  },
  _resetCookieExposureForTests(): void {
    resetCookieExposure();
  },
  /** Drive the cross-origin collector through its REAL classify path. */
  noteCorsForTests(
    requestOrigin: unknown,
    allowOrigin: unknown,
    allowCredentials?: unknown,
  ): void {
    noteCorsAnswer(classifyCorsAnswer(requestOrigin, allowOrigin, allowCredentials));
  },
  _setCorsClockForTests(fn: (() => number) | null): void {
    corsNow = fn ?? Date.now;
  },
  _resetCorsExposureForTests(): void {
    resetCorsExposure();
    corsNow = Date.now;
  },
  /* ── Dev Posture test seams ────────────────────────────────────────────*/
  /** Read the dev-posture axis exactly as the snapshot would (freezes the
   *  snapshot on first call after start, like the real read). */
  readDevPostureForTests(): ExtraAxis | null {
    return readDevPosture();
  },
  /** Override the dev-posture checks with synthetic ones so bands / omission
   *  cases can be driven without touching the live process/env. Pass a
   *  partial: keys present become readable flags (0/1), absent keys stay
   *  UNREADABLE (their wire flag is omitted).
   *
   *  `profilingOpen` is the LIVE check, so its override is held separately and
   *  applies to every later read; pass `null` to pin "could not look". */
  _setDevPostureForTests(snap: {
    debugFlag?: number;
    verboseErrors?: number;
    sourceMapTraces?: number;
    profilingOpen?: number | null;
  }): void {
    const { profilingOpen, ...frozen } = snap;
    devPostureFrozen = { ...frozen };
    devPostureProfilingOverride =
      "profilingOpen" in snap ? (profilingOpen ?? null) : null;
  },
  /** Let the LIVE inspector check read the real process again, after
   *  `_setDevPostureForTests` pinned it. */
  _clearDevPostureProfilingOverrideForTests(): void {
    devPostureProfilingOverride = undefined;
  },
  /** Drop the frozen dev-posture snapshot back to a clean (unread) state. */
  _resetDevPostureForTests(): void {
    resetDevPosture();
  },
  /** Fold one synthetic load-deflection sample (startInFlight, durationMs)
   *  through the SAME start/end path the finalizer uses — drive the in-flight
   *  counter up to `startInFlight` via repeated starts, record once via the
   *  end, then unwind the residual counter to 0 — so the merged wire math
   *  (bucket p75 + solo mean + least-squares slope) is exercised end-to-end. */
  addDeflectionSampleForTests(startInFlight: number, durationMs: number): void {
    let token = 0;
    for (let i = 0; i < startInFlight; i++) token = noteDeflectionStart();
    noteDeflectionEnd(token, durationMs);
    // Unwind any residual in-flight (the single end above only decremented one).
    while (deflectionInFlight > 0) deflectionInFlight--;
  },
};

/** Read the three LAUNCH-STATE Node development settings ONCE. Every step is
 *  guarded — a throw anywhere degrades that single check to unreadable (its
 *  flag omitted), never disturbs the host. Counts/booleans only: no env value,
 *  path or URL is ever returned.
 *
 *  The inspector check is NOT taken here: it is live state, re-read on every
 *  snapshot by `readProfilingOpen`. */
function readDevPostureSnapshot(): DevPostureSnapshot {
  const snap: DevPostureSnapshot = {};
  // debugFlag: NODE_ENV !== "production" (Express and most frameworks treat
  // unset as development, with verbose error pages — the honest read of the
  // flag actually in force). Always readable.
  try {
    const nodeEnv =
      typeof process !== "undefined" && process.env
        ? process.env.NODE_ENV || "development"
        : "development";
    snap.debugFlag = nodeEnv !== "production" ? 1 : 0;
  } catch {
    /* leave omitted */
  }
  // verboseErrors: DEBUG is set and non-empty (the de-facto verbose
  // debug-logging switch in the Node ecosystem). Always readable.
  try {
    const dbg =
      typeof process !== "undefined" && process.env
        ? process.env.DEBUG
        : undefined;
    snap.verboseErrors = typeof dbg === "string" && dbg !== "" ? 1 : 0;
  } catch {
    /* leave omitted */
  }
  // sourceMapTraces: the process was LAUNCHED with --enable-source-maps, in
  // process.execArgv or NODE_OPTIONS. This makes V8 resolve the process's OWN
  // stack traces through source maps; nothing is served and nothing is
  // exposed. Always readable.
  //
  // process.sourceMapsEnabled is deliberately NOT read. It is true whenever
  // ANYTHING in the process turned the feature on, including a TypeScript
  // loader (tsx, ts-node) that calls process.setSourceMapsEnabled(true) at
  // import time so traces point at .ts files. The operator did not ask for
  // that and cannot clear it without changing how they run, so scoring it is
  // a finding against a choice that was never made. Only the launch flag is
  // attributable to the operator, and only the launch flag can be removed to
  // clear the finding. See docs/decisions/dev-posture-source-maps.md.
  try {
    // Match the WHOLE argument, never a substring: `node -e "<script>"` puts
    // the script text itself into execArgv, so a substring test reports the
    // flag for any program whose source happens to mention it.
    const isFlag = (a: unknown): boolean =>
      typeof a === "string" &&
      (a === "--enable-source-maps" || a.startsWith("--enable-source-maps="));
    let on = false;
    if (Array.isArray(process.execArgv)) on = process.execArgv.some(isFlag);
    if (!on && process.env && typeof process.env.NODE_OPTIONS === "string") {
      on = process.env.NODE_OPTIONS.split(/\s+/).some(isFlag);
    }
    snap.sourceMapTraces = on ? 1 : 0;
  } catch {
    /* leave omitted */
  }
  return snap;
}

/** profilingOpen, read LIVE on every snapshot — the inspector/debug port is
 *  open (`inspector.url()` returns a non-empty string).
 *
 *  This is the one dev-posture check that is not launch state: an inspector can
 *  be opened on an already-running production process (SIGUSR1, a call to
 *  `inspector.open()`) and closed again. A frozen read would report the startup
 *  answer for ever — missing a debugger opened later, and still reporting one
 *  that has since detached. `inspector.url()` is a cheap synchronous read that
 *  starts nothing. Returns `undefined` when the check could not be taken (its
 *  flag is then OMITTED — "we did not look", never a 0). */
function readProfilingOpen(): number | undefined {
  if (devPostureProfilingOverride !== undefined) {
    return devPostureProfilingOverride ?? undefined;
  }
  try {
    return inspectorUrl() ? 1 : 0;
  } catch {
    return undefined;
  }
}

/** Dev-posture axis. Node reads four checks — three launch-state ones, frozen
 *  at first read, plus the inspector check, re-read every snapshot — so it
 *  always emits once the meters have started. Wire shape is shared with the
 *  Python, Go, Java, Web and RN kits (present flags only); `sourceMapTraces` is
 *  Node's own check and `sourceMaps` (a .map file being SERVED) is never
 *  emitted here, because a Node process cannot see what its static file layer
 *  serves. */
export function readDevPosture(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    const snap = frozenDevPosture();
    const profilingOpen = readProfilingOpen();
    // Collect only the flags that were actually readable this session.
    const present: Array<[string, number]> = [];
    if (snap.debugFlag !== undefined) present.push(["debugFlag", snap.debugFlag]);
    if (snap.verboseErrors !== undefined) {
      present.push(["verboseErrors", snap.verboseErrors]);
    }
    if (snap.sourceMapTraces !== undefined) {
      present.push(["sourceMapTraces", snap.sourceMapTraces]);
    }
    if (profilingOpen !== undefined) {
      present.push(["profilingOpen", profilingOpen]);
    }
    // If a runtime could read ZERO checks the axis is omitted (honest absence);
    // Node always reads at least one, so this is defensive.
    if (present.length === 0) return null;
    const checks = present.length;
    const findings = present.reduce((n, [, v]) => n + (v === 1 ? 1 : 0), 0);
    const debugOn = snap.debugFlag === 1;
    // score: 100, -60 if debugFlag on, -20 for EACH other finding, clamp 0..100.
    let score = 100;
    if (debugOn) score -= 60;
    for (const [name, v] of present) {
      if (v === 1 && name !== "debugFlag") score -= 20;
    }
    score = Math.max(0, Math.min(100, score));
    const rating: Rating = debugOn
      ? "poor"
      : findings > 0
        ? "needs-work"
        : "good";
    // caption: counts and setting NAMES only — never an env value or flag string.
    let caption: string;
    if (findings === 0) {
      caption = `none of the ${checks} development settings we can read were on`;
    } else {
      const on: string[] = [];
      if (snap.debugFlag === 1) on.push("debug mode on");
      if (snap.verboseErrors === 1) on.push("verbose error pages on");
      if (snap.sourceMapTraces === 1) {
        on.push("source-map stack traces on (--enable-source-maps)");
      }
      if (profilingOpen === 1) on.push("profiling port open");
      caption = on.join(", ");
    }
    const axis: ExtraAxis = {
      score,
      rating,
      caption,
      findings,
      checks,
      measurable: 1,
    };
    for (const [name, v] of present) axis[name] = v;
    return axis;
  } catch {
    return null;
  }
}

/** Drop the frozen dev-posture snapshot and the live-check override (wired
 *  into clearExtraMeters). */
function resetDevPosture(): void {
  devPostureFrozen = null;
  devPostureProfilingOverride = undefined;
}

let devPostureFrozen: DevPostureSnapshot | null = null;

/** Test seam for the LIVE inspector check. `undefined` = read the real
 *  inspector; a number pins the answer; `null` pins "could not look" (the flag
 *  is omitted). Never set outside tests. */
let devPostureProfilingOverride: number | null | undefined;

/** Return the frozen dev-posture snapshot, taking it once on first read after
 *  start (freeze-at-init). Idempotent thereafter. */
function frozenDevPosture(): DevPostureSnapshot {
  if (devPostureFrozen === null) devPostureFrozen = readDevPostureSnapshot();
  return devPostureFrozen;
}
/** Detection shapes — WHICH pattern matched. One bit each; a reading reports
 *  the OR of every shape seen in the window (`shapeMask`). Declared together,
 *  and ABOVE the word table that reads them: a bit declared below it is in the
 *  temporal dead zone when the module body runs, so the kit throws on import. */
export const LEAK_SHAPE_JWT = 1;

export const LEAK_SHAPE_BEARER = 2;

export const LEAK_SHAPE_AWS_KEY_ID = 4;

export const LEAK_SHAPE_PRIVATE_KEY = 8;

export const LEAK_SHAPE_NAMED_VALUE = 16;

export const LEAK_SHAPE_EMAIL = 32;

export const LEAK_SHAPE_STACK_FRAME = 64;

/** Words for the matched shapes — read from the closed shape vocabulary, never
 *  from anything the detector matched. */
const LEAK_SHAPE_WORDS: ReadonlyArray<{ bit: number; word: string }> = [
  { bit: LEAK_SHAPE_JWT, word: "a JSON Web Token" },
  { bit: LEAK_SHAPE_BEARER, word: "a bearer credential" },
  { bit: LEAK_SHAPE_AWS_KEY_ID, word: "an AWS access-key id" },
  { bit: LEAK_SHAPE_PRIVATE_KEY, word: "a private-key header" },
  { bit: LEAK_SHAPE_NAMED_VALUE, word: "a named api-key/secret/token value" },
  { bit: LEAK_SHAPE_EMAIL, word: "an email address" },
  { bit: LEAK_SHAPE_STACK_FRAME, word: "a stack frame" },
];

/** One classification outcome: the category AND the single shape code that
 *  decided it. Both are code-defined constants — never any matched text. */
interface LeakClass {
  cat: LeakCategory;
  shape: number;
}

type LeakSurface = typeof LEAK_SURFACE_LOG | typeof LEAK_SURFACE_REPLY;

/** True when the matched VALUE is a placeholder rather than a credential.
 *  Operates on a slice that lives only on the caller's stack. */
function isLeakPlaceholder(value: string): boolean {
  try {
    const v = value.replace(LEAK_VALUE_LTRIM_RE, "");
    return v.length > 0 && LEAK_PLACEHOLDER_VALUE_RE.test(v);
  } catch {
    return false;
  }
}

/** How many matches of ONE shape a single scan inspects. A document that shows
 *  a placeholder and then leaks a real credential below it is the ordinary
 *  case, so the shape must not end at its FIRST match — but the walk stays
 *  bounded, on top of the already-bounded slice, so no input can spin here. */
const LEAK_MAX_MATCHES_PER_SHAPE = 16;

/** Opening punctuation a sentence wraps a value in. */
const LEAK_VALUE_LTRIM_RE = /^[("'`[]+/;

function leakShapePhrase(shapeMask: number): string {
  const words = LEAK_SHAPE_WORDS.filter((s) => (shapeMask & s.bit) !== 0).map(
    (s) => s.word,
  );
  if (words.length === 0) return "shape not recorded";
  return `matched ${words.join(", ")}`;
}

const LEAK_SURFACE_REPLY = 2; // the body of an error reply the app sent

/** True when this free-form shape has at least one match whose value is NOT a
 *  placeholder. Walks successive matches rather than judging the shape by its
 *  first one: "Authorization: Bearer <project-key>" in a document above a real
 *  token must not hide the token. Nothing matched is returned or retained —
 *  the answer is a boolean and the values live only on this stack. */
function hasRealValue(re: RegExp, text: string): boolean {
  try {
    re.lastIndex = 0;
    for (let i = 0; i < LEAK_MAX_MATCHES_PER_SHAPE; i++) {
      const m = re.exec(text);
      if (!m) break;
      if (!isLeakPlaceholder(m[1] ?? "")) return true;
      // A zero-length match would never advance lastIndex.
      if (m[0].length === 0) re.lastIndex += 1;
    }
    return false;
  } catch {
    return false;
  } finally {
    // Never leave state on a shared regex — the next scan starts at 0.
    re.lastIndex = 0;
  }
}
