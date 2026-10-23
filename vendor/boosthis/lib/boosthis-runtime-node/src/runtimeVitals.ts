/* ─── Boosthis: runtime-vitals axes (Node) ───────────────────────────────
 *
 * Three more honest, display-only backend meters, added so the Node/Python/Go/
 * Java dashboards expose a comparable set of gauges to the RN kit (the owner's
 * request: "RN shows many meters, the others show few"). Each is derived from
 * cheap, always-available runtime reads — NO background poller (Boosthis's own
 * rule book forbids idle spinners), NO new collection, NO PII:
 *
 *   - Memory Stability — heap-growth trend (a leak/steady-climb signal). The
 *     least-squares slope of heap-used (MB) over wall-clock minutes, sampled at
 *     request boundaries. Flat/shrinking = healthy; a sustained climb = poor.
 *   - GC Pressure     — the share of wall time this process has spent paused in
 *     garbage collection (`PerformanceObserver('gc')`). Low = healthy.
 *   - Reliability     — the request error rate (HTTP 5xx / total) observed by the
 *     middleware, with throughput reported in the caption. Low errors = healthy.
 *
 * PARITY: keys, labels, rating bands, and the wire shape are the cross-runtime
 * standard — Python/Go/Java mirror them byte-for-byte. The metric→score
 * thresholds are necessarily per-runtime (a "healthy" GC share on the V8 heap is
 * not the same number as on the Go or JVM collectors), exactly as `eventLoopLag`
 * uses axis-specific bands rather than the shared TTI thresholds.
 *
 * INVARIANT: these axes are ADDITIVE and display-only. They never feed the
 * composite Speed score (TTFF/TTI/FID) — see thresholds.ts. They carry only
 * numbers, a fixed rating bucket, and a machine-built caption (numbers + fixed
 * vocabulary, never a route name/value/source). Each rides inside the existing
 * snapshot upload and clears the same PII guard as every other field.
 *
 * HONESTY: an axis is OMITTED (the server renders it "pending") until it has
 * enough data to mean something — never a 100 or 0 fabricated from one request
 * or a just-booted process. "Concurrency" is deliberately NOT shipped as a
 * scored axis: raw in-flight/thread counts have no honest good/bad rating
 * without a capacity or SLO reference, and Boosthis never fabricates a score.
 */

import { PerformanceObserver, performance, constants } from "node:perf_hooks";
import { isBoosthisDisabled } from "./runtimeFlags";
import { linearScore, ratingFor } from "./healthAxes";
import { type Rating, type NoScoreRating } from "./thresholds";
import {
  getHeapSpaceStatistics,
  getHeapStatistics,
  type HeapSpaceInfo,
} from "node:v8";
import { readFileSync, readdirSync } from "node:fs";
import { crashCount } from "./crashReporter";
import { crashHistoryWindow, crashReportingVerdict } from "./crashDelivery";
import {
  MEASURED_TO_KIT_ENABLE,
  MEASURED_TO_SERVING,
  clearReadyMark,
  readyToServeMs,
} from "./readyToServe";
import {
  onSuspendIdleStart,
  onSuspendWake,
  SUSPEND_UNIT,
} from "./suspendSensor";
import { systemUnavailableReading } from "./systemLimits";

import {
  MIN_RATE_WINDOW_MIN,
  earnedPerHour,
  earnedPerMin,
  overWords,
  windowMinOf,
  windowPhrase,
} from "./rateHonesty";
// The one correction shared by every meter in this kit that scores the slope
// of a fitted line — see trendVerdict.ts for what `Math.max(slope, 0)` got
// wrong, and why the verdict is now taken at the top of the estimate's own
// uncertainty instead of at the estimate.
import { judgeTrend, medianOf } from "./trendVerdict";
import {
  SETTLE_FAMILIES,
  isSettling,
  markSettled,
  percentileOf,
  persistentGrowthPerMin,
  settledFromMs,
  settledSlope,
  settledSpanMs,
  settledTailValues,
  settlingReading,
  spanJudgeable,
  type TimedSample,
} from "./settleRule";
// Node GC-kind numerics for gcGenerationBalance. perf_hooks exposes these as
// `constants.NODE_PERFORMANCE_GC_*` (MINOR/scavenge = 1, MAJOR/mark-sweep-compact
// = 4, INCREMENTAL = 8, WEAKCB = 16 — a stable ABI). The `@types/node` surface
// for `constants` has drifted across versions, so read the values defensively
// with a numeric fallback and count only complete young/full collections
// (incremental-marking + weak-callback steps are excluded from the balance).
const GC_CONSTS = constants as unknown as Record<string, number>;
const GC_KIND_MAJOR = GC_CONSTS.NODE_PERFORMANCE_GC_MAJOR ?? 4;
const GC_KIND_MINOR = GC_CONSTS.NODE_PERFORMANCE_GC_MINOR ?? 1;

// ── Memory Stability bands ──────────────────────────────────────────────────
/** Heap-growth score bands (MB/min). ≤2 MB/min of sustained growth reads as
 *  stable (100); ≥25 MB/min is a clear steady climb (0). Growth ≤0 (flat or
 *  shrinking) always scores 100. */
const MEM_GROWTH_GOOD = 2;
const MEM_GROWTH_POOR = 25;
/** Minimum boundary samples before a trend is trustworthy. */
const MIN_MEM_SAMPLES = 12;
/** Minimum wall-clock span the samples must cover (ms) — a slope over a few
 *  seconds is noise, not a leak. */
const MIN_MEM_SPAN_MS = 300_000;
const MEM_TREND_WARMUP_MS = 60_000;
const MEM_TREND_FLOOR_BUCKET_MS = 15_000;
const MEM_RISE_FLOOR_MB = 30;
/** Throttle between memory samples (ms) — one per second is plenty for a trend
 *  and keeps a burst of requests from flooding the ring. */
const MEM_THROTTLE_MS = 1_000;
/** Bounded ring so a long-lived process can never grow this unbounded. */
const MEM_RING_CAP = 240;

// ── GC Pressure bands ───────────────────────────────────────────────────────
/** GC-share score bands (% of wall time). ≤1% reads as healthy (100); ≥10% is
 *  a process spending real time paused in collection (0). */
const GC_PCT_GOOD = 1;
const GC_PCT_POOR = 10;
/** Minimum elapsed wall time before the share is meaningful (ms). */
const MIN_GC_ELAPSED_MS = 5_000;
const GC_TAX_GOOD_PCT = 1;
const GC_TAX_POOR_PCT = 10;
const GC_TAX_MIN_WINDOW_MS = 60_000;
const GC_TAX_WINDOW_MS = 10 * 60_000;

// ── memoryPerRequest bands ──────────────────────────────────────────────────
const MEMORY_PER_REQUEST_GOOD_KB = 4;
const MEMORY_PER_REQUEST_POOR_KB = 128;
const MIN_MEMORY_REQUESTS = 50;

// ── Reliability bands ───────────────────────────────────────────────────────
/** Error-rate score bands (% of requests answered 5xx). ≤1% reads as healthy
 *  (100); ≥20% is a service in trouble (0). */
const ERR_PCT_GOOD = 1;
const ERR_PCT_POOR = 20;
/** Minimum requests before an error rate is trustworthy. */
const MIN_REQ_FOR_RELIABILITY = 10;
/** HTTP status at/above which a response counts as a server error. */
const SERVER_ERROR_STATUS = 500;

// ── crashFree bands (universal) ─────────────────────────────────────────────
/** Crash-rate score bands (crashes/hr). 0 → 100, >=3/hr → 0. */
const CRASHFREE_RATE_GOOD = 0;
const CRASHFREE_RATE_POOR = 3;

/** The best score an app that DID crash inside the window may be given.
 *
 *  One below the `good` floor in `ratingFor()`, and it exists because a rate is
 *  a poor way to describe a rare, fatal event: one crash in a 24-hour window is
 *  0.04/hour, which scores 99 and rates "good" — a green tile reading
 *  "crash-free" beside a crash the app really suffered. A crash inside the
 *  window is therefore never `good`, however low the rate it implies; it still
 *  ages out of the window, so this is a bound on a stated period, not a
 *  permanent mark. */
const CRASHFREE_MAX_SCORE_AFTER_CRASH = 84;
/** Observe at least this many minutes before claiming crash-free (a crash
 *  shows immediately regardless). */
const CRASHFREE_MIN_WINDOW_MIN = MIN_RATE_WINDOW_MIN;

// ── eventLoopUtilization bands ──────────────────────────────────────────────
/** ELU score bands (% busy). <=70% healthy, >=90% saturated. */
const ELU_PCT_GOOD = 70;
const ELU_PCT_POOR = 90;
const MIN_ELU_SAMPLES = 3;
const ELU_RING_CAP = 240;

// ── heapFragmentation bands ─────────────────────────────────────────────────
/** Fragmentation score bands — STRANDED heap as a % of the V8 heap CEILING
 *  (`heap_size_limit`), the same denominator `heapHeadroom` scores against.
 *  <=5% of the budget committed but holding nothing is ordinary page overhead
 *  (100); >=25% is a quarter of the whole heap budget carried as dead weight
 *  (0).
 *
 *  The denominator is deliberately NOT the committed heap. Free-over-committed
 *  FALLS as a process fills its heap, so a 500 MB retainer scored better than
 *  an identical 1 MB control and the improvement the meter implied was
 *  "allocate more". Against a fixed ceiling this axis and `heapHeadroom` both
 *  RISE as memory pressure rises: two tiles on one page, one direction, one
 *  denominator, and their sum is simply committed-over-limit. */
const FRAG_PCT_GOOD = 5;
const FRAG_PCT_POOR = 25;
const MIN_FRAG_ELAPSED_MS = 10_000;

// ── handleLeak bands ────────────────────────────────────────────────────────
/** Active-handle growth score bands (handles/min). */
const HANDLE_GROWTH_GOOD = 1;
const HANDLE_GROWTH_POOR = 10;
const MIN_HANDLE_SAMPLES = 12;
/**
 * Wall-clock the JUDGED samples must cover, after the warm-up exclusion.
 *
 * Was sixty seconds. Three minutes is as long as this ring can promise: it
 * holds HANDLE_RING_CAP samples taken no oftener than MEM_THROTTLE_MS apart,
 * so a busy app — the very app this axis keeps getting wrong — can never
 * offer more than four minutes of history. Asking for five would have made
 * the axis permanently absent on exactly the workloads it exists for.
 */
const MIN_HANDLE_SPAN_MS = 180_000;
/** Samples taken inside the first minute of a process are its startup: pools
 *  opening, listeners attaching, the first connections being made. */
const HANDLE_WARMUP_MS = 60_000;
/**
 * Accumulation is what the FLOOR does; load is what the peaks do.
 *
 * `process.getActiveResourcesInfo()` returns an instantaneous count, so a
 * workload that creates many short-lived resources has a genuinely high count
 * whenever a sample lands inside a burst — that is queue depth, not a leak.
 * A tester's 2,000 short-lived handle creations over 76 seconds, retaining
 * NOTHING, read +21.5 handles/min and scored 0/poor; his twenty deliberately
 * retained timers — a real leak — read +12.2/min. The trend is therefore
 * fitted to the lowest count seen in each of these buckets, which is the
 * number the process never got back below. Churn flattens it; retention
 * raises it.
 */
const HANDLE_FLOOR_BUCKET_MS = 15_000;
/** Buckets required before a low-water series is worth fitting. */
const MIN_HANDLE_FLOOR_BUCKETS = 6;
/** Handles the fit must project to have been added across the judged window
 *  before the rate is allowed to cost anything. */
const HANDLE_RISE_FLOOR = 8;
const HANDLE_RING_CAP = 240;

// ── gcPauseTail bands (Node) ────────────────────────────────────────────────
/** GC pause p99 score bands (ms). A p99 collection pause <=5ms is smooth (100);
 *  >=100ms is a stall a user can feel (0). Parity with the Go gcPauseTail axis. */
const GC_PAUSE_P99_GOOD = 5;
const GC_PAUSE_P99_POOR = 100;
/** Minimum collections before a tail percentile means anything (a p99 over a
 *  handful of samples is noise, not a tail). */
const MIN_GC_PAUSE_SAMPLES = 20;
/** Bounded ring of recent pause durations (ms) so a long-lived process can
 *  never grow this unbounded. */
const GC_PAUSE_RING_CAP = 512;

// ── gcGenerationBalance bands (Node) ────────────────────────────────────────
/** Full-to-young GC ratio score bands. A generational heap should sweep the
 *  young space far more often than it runs a full/major collection; <=0.01
 *  (<=1 full per 100 young) is healthy (100), >=0.1 (promotion pressure /
 *  churn) is poor (0). Mirrors the Python gcGenerationBalance axis. */
const GEN_RATIO_GOOD = 0.01;
const GEN_RATIO_POOR = 0.1;
/** Minimum young (scavenge) collections before the balance is trustworthy. */
const MIN_YOUNG_GCS = 50;
/** gcGenerationBalance grades good while collection takes at most this share
 *  (%) of the settled window (the Python kit's floor, the same wire field). */
const GEN_BALANCE_GC_PCT_FLOOR = 1;

// ── heapHeadroom bands (Node) ───────────────────────────────────────────────
/** Heap-used-vs-limit score bands (% of the V8 heap_size_limit in use). <=60%
 *  is comfortable headroom (100); >=90% is close to the OOM ceiling (0).
 *  Mirrors the Java heapHeadroom axis (old-gen occupancy there). */
const HEAP_USED_GOOD = 60;
const HEAP_USED_POOR = 90;
/** Warm-up: ignore the first few seconds so a just-booted process (heap not yet
 *  grown into its working set) doesn't read as spuriously roomy. */
const MIN_HEAP_ELAPSED_MS = 5_000;

// ── containerPressure bands (Node) ─────────────────────────────────────────
/** Container memory pressure — process/cgroup memory in use vs the cgroup
 *  memory LIMIT (cgroup v2 memory.current / memory.max, v1 fallback). <=75% is
 *  comfortable headroom (100); >=95% is imminent-OOM-kill territory (0). The
 *  container limit is a HARDER wall than the V8 heap soft-limit heapHeadroom
 *  watches — RSS, native allocations and buffers all count against it and no GC
 *  reclaims it — so the bands sit higher (75/95 vs 60/90). */
const CONTAINER_PCT_GOOD = 75;
const CONTAINER_PCT_POOR = 95;
/** cgroup-v1 "unlimited" sentinel is a near-Int64-max byte count; any limit at
 *  or above this threshold means no real cap is set, so the axis is omitted. */
const CGROUP_V1_UNLIMITED = 0x7000_0000_0000_0000;

// ── cpuThrottling bands (Node) ──────────────────────────────────────────────
/** Container CPU throttling — the share of CFS bandwidth periods in which the
 *  cgroup was throttled (nr_throttled / nr_periods). A little throttling is
 *  normal churn; <=1% reads as healthy (100), >=25% is a process being held
 *  back by its CPU quota often enough to hurt latency (0). Higher is worse. */
const CPU_THROTTLE_PCT_GOOD = 1;
const CPU_THROTTLE_PCT_POOR = 25;

// ── fdSaturation bands (Node) ───────────────────────────────────────────────
/** File-descriptor saturation — open file descriptors vs the process's
 *  RLIMIT_NOFILE soft limit. Running out of FDs kills accept()/open() with
 *  EMFILE, so proximity to the soft cap is an honest failure signal. <=70% is
 *  comfortable headroom (100); >=90% is close to the EMFILE wall (0). Higher is
 *  worse — same lower-is-better direction as containerPressure. */
const FD_USED_GOOD = 70;
const FD_USED_POOR = 90;

// ── gcTrend bands (Node) ───────────────────────────────────────────────────
/** The TREND of collection time (the settle-rule decision for gcTrend): the
 *  persistent growth of the share of time spent collecting, fitted across
 *  whole settled minutes. A busy but steady collector is not a trend, and a
 *  boot burst is one step that is never projected. Young collections per
 *  minute and the worst major pause ride as context. */
/** Rolling window the context figures are taken over (ms). */
const GC_TREND_WINDOW_MS = 10 * 60_000;
/** gcTrend grades the persistent growth of collection time, in share points
 *  per hour, fitted over at most this many settled minutes. */
const GC_TREND_GROWTH_GOOD = 0.5;
const GC_TREND_GROWTH_POOR = 5;
const GC_TREND_FIT_MINUTES = 60;
/** Bounded ring of recent timestamped GC events. */
const GC_EVENT_RING_CAP = 2_048;

// ── heapWall bands (Node) ───────────────────────────────────────────────────
/** Heap-wall countdown — at the current heap-growth rate, hours until the used
 *  heap hits the V8 heap_size_limit. >=24h away is comfortable (100); <=1h is
 *  an OOM crash on today's watch (0); flat/shrinking heap = no wall in sight
 *  (100). Uses the SAME sample ring + warm-up gates as memoryStability. */
const HEAP_WALL_GOOD_HOURS = 24;
const HEAP_WALL_POOR_HOURS = 1;
/** Growth below this (MB/min) is measurement noise, not a march to the wall. */
const HEAP_WALL_MIN_GROWTH = 0.05;
/** Cap the reported countdown so the wire stays a small honest number. */
const HEAP_WALL_MAX_HOURS = 999;

// ── startupImport bands (Node, one-shot display-only) ──────────────────────
/** Startup import cost — how long the app spent loading modules + running
 *  top-level code between Node's own bootstrap finishing and the host calling
 *  enableTelemetry (perf_hooks nodeTiming.bootstrapComplete → enable). Frozen
 *  once at enable, like coldStart — it names the import-cost slice of the cold
 *  start. <=1500ms is a light import graph (100); >=15000ms is a heavy one (0). */
const STARTUP_IMPORT_MS_GOOD = 1_500;
const STARTUP_IMPORT_MS_POOR = 15_000;
/** Same sanity guard as coldStart: enabling >10min after boot is not a
 *  bootstrap measurement — omit rather than lie. */
const STARTUP_IMPORT_MAX_MS = 600_000;

// ── coldStart bands (universal, display-only) ───────────────────────────────
/** Cold-start / boot-time proxy — how long the OS process had been alive when
 *  the host called enableTelemetry (process start -> telemetry-enable). Captured
 *  ONCE at telemetry init and FROZEN; NEVER re-read at snapshot time (a live
 *  "now - processStart" read is uptime, not cold start, and would grow forever).
 *  Shared cross-runtime bands: <=5000ms is a snappy boot (100); >=30000ms is a
 *  slow bootstrap (0); linear in between. Lower is better. */
const COLDSTART_MS_GOOD = 5_000;
const COLDSTART_MS_POOR = 30_000;
/** Sanity guards (both honest-omission cases):
 *   - value <= 0 -> treat as unavailable (omit): a non-positive age is nonsense.
 *   - value > 600000ms (10 minutes) -> OMIT: a host that enables telemetry long
 *     after boot is not measuring bootstrap; reporting a huge value as a "poor
 *     cold start" would be a lie, so omission is the honest move. */
const COLDSTART_MAX_MS = 600_000;

/** Wire shape for every runtime-vitals axis: NodeAxisResult-compatible
 *  (numeric score + rating + number/string extras incl. a caption). */
export interface VitalAxis {
  /** Null when a reading exists but the judgement has not been earned — the
   *  crash COUNT is real from the first second, the crash RATE is not (the
   *  earned-rate contract, rateHonesty.ts). Matches ExtraAxis, which the
   *  server already reads this way. */
  score: number | null;
  rating: Rating | NoScoreRating;
  /** Machine-built caption (numbers + fixed vocabulary). OPTIONAL: the
   *  display-only coldStart axis is numeric-only and omits it — the server
   *  rebuilds captions for that axis. */
  caption?: string;
  [k: string]: number | string | null | undefined;
}

interface MemSample {
  t: number;
  heapMb: number;
  rssMb: number;
}

interface CountSample {
  t: number;
  count: number;
}

let started = false;
let startedAt = 0;

// Memory
const memSamples: MemSample[] = [];
const liveSetSamples: MemSample[] = [];
let lastMemSampleAt = 0;

// GC
let gcObserver: PerformanceObserver | null = null;
let gcMs = 0;
let gcCount = 0;
// gcPauseTail — bounded ring of recent GC pause durations (ms).
const gcPauseRing: number[] = [];
// gcGenerationBalance — lifetime counts of full (major) vs young (minor) GCs.
let fullGcCount = 0;
let youngGcCount = 0;
// heapHeadroom — test-only injected V8 heap stats (null = read live).
let heapStatsOverride: { used_heap_size: number; heap_size_limit: number } | null =
  null;
// containerPressure — test-only injected cgroup memory numbers (bytes); null =
// read live, "unavailable" forces the no-cgroup path.
let cgroupOverride: { usedBytes: number; maxBytes: number } | "unavailable" | null =
  null;
// cpuThrottling — test-only injected cgroup CPU throttle counters; null = read
// live, "unavailable" forces the no-cgroup / unlimited-quota path.
let cpuThrottleOverride: { periods: number; throttled: number } | "unavailable" | null =
  null;
// cpuThrottling host-suspend discount — CFS periods/throttles that accrued
// while the loop was IDLE across a suspend-suspicious gap (a scale-to-zero
// host throttling a suspended container, not the app fighting its quota).
// Baseline snapshotted when the loop goes idle; the delta at the next wake is
// attributed to suspend. Kept visible on the axis — discount, don't hide.
let cpuIdleBaseline: { periods: number; throttled: number } | null = null;
let suspendPeriodsDiscounted = 0;
let suspendThrottledDiscounted = 0;
let suspendThrottleWakes = 0;
// fdSaturation — test-only injected open-fd count + soft limit; null = read
// live, "unavailable" forces the no-fd-count / unlimited-limit path.
let fdOverride: { open: number; max: number } | "unavailable" | null = null;

// gcTrend — bounded ring of timestamped GC events (t, young?, pause ms).
interface GcEvent { t: number; young: boolean; major: boolean; ms: number }
const gcEvents: GcEvent[] = [];

// The start-up rule (settleRule.ts, docs/settle-rule-contract.md): collections
// are judged from the settled point on. The lifetime counters above are kept
// for the panel's context and never decide a grade.
let settledGcMs = 0;
let settledGcCount = 0;
let settledYoungGcs = 0;
let settledFullGcs = 0;
/** Every pause with its time, for the settled tail (gcPauseTail). */
const gcPauseTimed: TimedSample[] = [];
/** Collection time per wall-clock minute, oldest first (gcTrend's series). */
const gcMinuteMs: Array<{ t: number; ms: number }> = [];
const GC_MINUTE_CAP = 90;

/** memoryPerRequest: the live set (what a collection left, see liveSetMbOf)
 *  beside the settled requests served so far, one point per 15-second bucket
 *  keeping the bucket's lowest live set. The slope of one against the other is
 *  the memory a request leaves behind; the heap read at the end of a request
 *  is not (it still holds everything the request allocated and the next
 *  collection frees). */
interface RetainedPoint {
  t: number;
  heapMb: number;
  reqs: number;
}
const retainedPoints: RetainedPoint[] = [];
const RETAINED_BUCKET_MS = 15_000;
const RETAINED_POINT_CAP = 240;
let settledRequestCount = 0;

/** Add a collection's time to its whole minute. An entry delivered late joins
 *  the minute it happened in; one older than every held minute is dropped
 *  (it would otherwise read as a fresh minute holding only itself). */
function noteGcMinute(t: number, ms: number): void {
  const minute = Math.floor(t / 60_000) * 60_000;
  for (let i = gcMinuteMs.length - 1; i >= 0; i--) {
    const bucket = gcMinuteMs[i]!;
    if (bucket.t === minute) {
      bucket.ms += ms;
      return;
    }
    if (bucket.t < minute) break;
    if (i === 0) return;
  }
  const at = gcMinuteMs.findIndex((bucket) => bucket.t > minute);
  if (at === -1) gcMinuteMs.push({ t: minute, ms });
  else gcMinuteMs.splice(at, 0, { t: minute, ms });
  if (gcMinuteMs.length > GC_MINUTE_CAP) gcMinuteMs.shift();
}

function noteGcEvent(t: number, ms: number, young: boolean, major: boolean): void {
  gcMs += ms;
  gcCount += 1;
  gcPauseRing.push(ms);
  if (gcPauseRing.length > GC_PAUSE_RING_CAP) gcPauseRing.shift();
  if (major) fullGcCount += 1;
  else if (young) youngGcCount += 1;
  gcEvents.push({ t, young, major, ms });
  if (gcEvents.length > GC_EVENT_RING_CAP) gcEvents.shift();
  gcPauseTimed.push({ t, v: ms });
  if (gcPauseTimed.length > GC_PAUSE_RING_CAP) gcPauseTimed.shift();
  noteGcMinute(t, ms);
  if (t >= settledFromMs("peakRate")) {
    settledGcMs += ms;
    settledGcCount += 1;
    if (major) settledFullGcs += 1;
    else if (young) settledYoungGcs += 1;
  }
}

/** The live set a request can add to: the JS heap left after a collection
 *  AND the memory outside the heap that live JS objects still hold. Node
 *  keeps a Buffer's bytes outside the heap (`external`, which includes
 *  `arrayBuffers`), so a heap-only live set never sees the commonest Node
 *  leak, a Buffer kept per request. A missing or refused `external` counts
 *  as none rather than dropping the point. */
function liveSetMbOf(mem: { heapUsed: number; external?: number }): number {
  const external = typeof mem.external === "number" && Number.isFinite(mem.external) && mem.external > 0 ? mem.external : 0;
  return (mem.heapUsed + external) / BYTES_PER_MB;
}

function noteLiveSet(t: number, heapMb: number): void {
  if (!Number.isFinite(heapMb)) return;
  const bucket = Math.floor(t / RETAINED_BUCKET_MS);
  const last = retainedPoints[retainedPoints.length - 1];
  if (last && Math.floor(last.t / RETAINED_BUCKET_MS) === bucket) {
    if (heapMb < last.heapMb) {
      last.t = t;
      last.heapMb = heapMb;
      last.reqs = settledRequestCount;
    }
    return;
  }
  retainedPoints.push({ t, heapMb, reqs: settledRequestCount });
  if (retainedPoints.length > RETAINED_POINT_CAP) retainedPoints.shift();
}

/** A reading inside the settle period: pending, no score, marked. */
function settlingAxis(): VitalAxis {
  return settlingReading({ score: null }) as unknown as VitalAxis;
}

// startupImport — captured ONCE at telemetry-enable and FROZEN (like coldStart).
let startupImportMs: number | null = null;
let startupBootMs: number | null = null;
// startupImport — test-only injected readings; null = read live via nodeTiming.
let startupReaderOverride: (() => { importMs: number; bootMs: number }) | null =
  null;

// coldStart — the process age (ms) captured ONCE at telemetry-enable and FROZEN.
// null = never captured (axis omitted). Captured value is never re-read.
let coldStartMs: number | null = null;
// coldStart — test-only injected process-age reader (ms). null = read live via
// process.uptime(); a function lets tests inject a fake age or a thrower.
let coldStartReaderOverride: (() => number) | null = null;

// Reliability
let reqTotal = 0;
let reqErrors = 0;
let firstReqAt = 0;
let lastReqAt = 0;

// eventLoopUtilization — utilization deltas sampled at request boundaries.
let lastELU: ReturnType<typeof performance.eventLoopUtilization> | null = null;
/** Loop time split into idle and active ms, one entry per interval of at
 *  least ELU_INTERVAL_MS. Utilisation is active over elapsed across the
 *  settled window, so a long quiet stretch weighs what it lasted. */
const eluSamples: Array<{ t: number; idle: number; active: number }> = [];
let lastEluAt = 0;
const ELU_INTERVAL_MS = 15_000;
const ELU_WINDOW_MS = 10 * 60_000;

function noteEluInterval(t: number, idle: number, active: number): void {
  if (!Number.isFinite(idle) || !Number.isFinite(active) || idle < 0 || active < 0) return;
  if (idle + active <= 0) return;
  eluSamples.push({ t, idle, active });
  if (eluSamples.length > ELU_RING_CAP) eluSamples.shift();
}
// handleLeak — active-handle counts sampled at request boundaries (Node 17+).
const handleSamples: CountSample[] = [];

const BYTES_PER_MB = 1024 * 1024;
const r0 = (n: number): number => Math.round(n);
const r1 = (n: number): number => Math.round(n * 10) / 10;
const r2 = (n: number): number => Math.round(n * 100) / 100;
const signed = (n: number): string => (n >= 0 ? `+${r1(n)}` : `${r1(n)}`);

/** Start vitals collection. Idempotent, no-op under the kill-switch. Wires the
 *  GC observer (best-effort — a runtime/bundler without `PerformanceObserver`
 *  simply omits the GC axis). Never throws. Called from `enableTelemetry`. */
export function startVitals(): void {
  if (isBoosthisDisabled() || started) return;
  started = true;
  startedAt = Date.now();
  try {
    if (typeof PerformanceObserver !== "function") return;
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // entry.duration is the GC pause in ms. `detail.kind` on Node >=16,
        // the legacy top-level `kind` before that. MAJOR = full, MINOR = young.
        const e = entry as unknown as { kind?: number; detail?: { kind?: number } };
        const kind = e.detail?.kind ?? e.kind;
        noteGcEvent(Date.now(), entry.duration, kind === GC_KIND_MINOR, kind === GC_KIND_MAJOR);
        // The collection has completed when this callback runs, so heapUsed is
        // the live set that survived it rather than allocation churn.
        try {
          const mem = process.memoryUsage();
          liveSetSamples.push({
            t: Date.now(),
            heapMb: mem.heapUsed / BYTES_PER_MB,
            rssMb: mem.rss / BYTES_PER_MB,
          });
          if (liveSetSamples.length > MEM_RING_CAP) liveSetSamples.shift();
          noteLiveSet(Date.now(), liveSetMbOf(mem));
        } catch {
          /* a refused memory read leaves this sample absent */
        }
      }
    });
    obs.observe({ entryTypes: ["gc"] });
    gcObserver = obs;
  } catch {
    gcObserver = null;
  }
}

/** Read the process age in ms (OS process start -> now), cross-platform and
 *  always available via process.uptime(). Rounded to an integer. Test override
 *  takes precedence so tests never depend on the live value. */
function readProcessAgeMs(): number {
  if (coldStartReaderOverride) return coldStartReaderOverride();
  return Math.round(process.uptime() * 1000);
}

/** Capture the cold-start / boot-time proxy ONCE and FREEZE it: reads the
 *  process age at the moment telemetry comes up and stores it. IDEMPOTENT — a
 *  second call must NOT overwrite the first value (a live re-read would be
 *  uptime, not cold start). Guest-safe: never throws; on any failure it stores
 *  nothing and the axis is simply omitted. Called from `enableTelemetry`. */
export function captureColdStart(): void {
  if (coldStartMs !== null) return; // freeze: never overwrite the first capture
  try {
    const age = readProcessAgeMs();
    if (typeof age === "number" && Number.isFinite(age)) {
      coldStartMs = Math.round(age);
    }
  } catch {
    /* best-effort — a failed capture leaves the axis omitted, never fatal */
  }
}

/** Capture the startup-import-cost proxy ONCE and FREEZE it: ms between Node's
 *  own bootstrap finishing (perf_hooks nodeTiming.bootstrapComplete) and this
 *  call — i.e. the host app's module loading + top-level code, the slice of the
 *  cold start the app owns. IDEMPOTENT; guest-safe: on any failure it stores
 *  nothing and the axis is simply omitted. Called from `enableTelemetry`. */
export function captureStartupImport(): void {
  if (startupImportMs !== null) return; // freeze: never overwrite
  try {
    if (startupReaderOverride) {
      const r = startupReaderOverride();
      startupImportMs = Math.round(r.importMs);
      startupBootMs = Math.round(r.bootMs);
      return;
    }
    const nt = (performance as unknown as {
      nodeTiming?: { bootstrapComplete?: number };
    }).nodeTiming;
    const boot = nt?.bootstrapComplete;
    if (typeof boot !== "number" || !Number.isFinite(boot) || boot < 0) return;
    const importMs = performance.now() - boot;
    if (!Number.isFinite(importMs)) return;
    startupImportMs = Math.round(importMs);
    startupBootMs = Math.round(boot);
  } catch {
    /* best-effort — a failed capture leaves the axis omitted, never fatal */
  }
}

/** Record one finished request at the boundary: bumps the reliability counters
 *  and (throttled) samples memory. Called once per request from the middleware
 *  finish/close handler. No-op under the kill-switch / before start. Never
 *  throws — instrumentation must never take down the host. */
export function noteRequest(statusCode?: number): void {
  if (isBoosthisDisabled() || !started) return;
  try {
    const ts = Date.now();
    reqTotal += 1;
    if (typeof statusCode === "number" && statusCode >= SERVER_ERROR_STATUS) {
      reqErrors += 1;
    }
    if (firstReqAt === 0) firstReqAt = ts;
    lastReqAt = ts;
    if (
      ts >= settledFromMs("perRequestMemory") &&
      reqTotal > SETTLE_FAMILIES.perRequestMemory.skipFirstRequests
    ) {
      settledRequestCount += 1;
    }
    sampleMemory(ts);
  } catch {
    /* best-effort — never fatal to the host */
  }
}


function sampleMemory(ts: number): void {
  if (ts - lastMemSampleAt < MEM_THROTTLE_MS) return;
  lastMemSampleAt = ts;
  const mem = process.memoryUsage();
  memSamples.push({
    t: ts,
    heapMb: mem.heapUsed / BYTES_PER_MB,
    rssMb: mem.rss / BYTES_PER_MB,
  });
  if (memSamples.length > MEM_RING_CAP) memSamples.shift();
  // eventLoopUtilization — record the busy fraction over the interval since
  // the last sample. Guarded: a runtime without the API simply omits the axis.
  try {
    if (
      typeof performance.eventLoopUtilization === "function" &&
      ts - lastEluAt >= ELU_INTERVAL_MS
    ) {
      const cur = performance.eventLoopUtilization();
      if (lastELU) {
        const d = performance.eventLoopUtilization(cur, lastELU);
        noteEluInterval(ts, d.idle, d.active);
      }
      lastELU = cur;
      lastEluAt = ts;
    }
  } catch {
    /* best-effort */
  }
  // handleLeak — active-handle count trend (open sockets/timers/streams).
  try {
    const g = (process as { getActiveResourcesInfo?: () => string[] })
      .getActiveResourcesInfo;
    if (typeof g === "function") {
      handleSamples.push({ t: ts, count: g.call(process).length });
      if (handleSamples.length > HANDLE_RING_CAP) handleSamples.shift();
    }
  } catch {
    /* best-effort */
  }
}

/** Least-squares slope of heapMb over wall-clock minutes. */
function heapSlopePerMin(samples: readonly MemSample[]): number {
  const n = samples.length;
  const t0 = samples[0].t;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const s of samples) {
    const x = (s.t - t0) / 60_000;
    const y = s.heapMb;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return 0;
  return (n * sxy - sx * sy) / denom;
}

/** Memory-stability axis, or null while warming up (fewer than MIN samples or
 *  too short a window). Pure read — never mutates state. Never throws. */
export function readMemoryStability(): VitalAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    const last = liveSetSamples[liveSetSamples.length - 1];
    // Same fitted-slope defect as handleLeak, residentGrowth and
    // arrayBufferRetention — `Math.max(0, growth)` scored an upward wobble and
    // gave a downward one a perfect 100 — so it takes the same correction
    // (trendVerdict.ts). Only the correction: the gate constants, the bands
    // and the fields are left exactly as they are, because this axis key is
    // shared with the Python, Go, Java, .NET and Elixir kits and its warm-up
    // promise is published per runtime. Whether a heap trend should also
    // exclude its own startup is a question for all six at once, not for this
    // one behind their backs.
    const trend = judgeTrend(
      liveSetSamples.map((s) => ({ t: s.t, v: s.heapMb })),
      {
        good: MEM_GROWTH_GOOD,
        poor: MEM_GROWTH_POOR,
        minSamples: MIN_MEM_SAMPLES,
        minSpanMs: MIN_MEM_SPAN_MS,
        warmupMs: MEM_TREND_WARMUP_MS,
        startedAt,
        floorBucketMs: MEM_TREND_FLOOR_BUCKET_MS,
        minFloorBuckets: 6,
        riseFloor: MEM_RISE_FLOOR_MB,
        abstainAroundZero: true,
      },
    );
    if (!trend) return null;
    const growth = trend.perMin;
    const heapMb = r0(last.heapMb);
    const rssMb = r0(last.rssMb);
    // The window this slope was fitted over, never floored up to a minute we
    // did not watch (rateHonesty.ts).
    const mins = windowMinOf(trend.spanMs);
    if (trend.score === null) {
      return {
        score: null,
        // The SAME word its three siblings use for the same silence
        // (handleLeak, residentGrowth, arrayBufferRetention): a withheld trend
        // verdict is temporary — a calmer window produces a score — and the
        // server turns `reasonCode` into "could not tell" on every surface.
        // "not-scored" is this codebase's word for a reading deliberately
        // never graded at all, so using it here would file a wait as a
        // permanent decision.
        rating: "pending",
        reasonCode: trend.reasonCode,
        heapMb,
        rssMb,
        growthMbPerMin: r1(growth),
        slopeSeMbPerMin: r1(trend.slopeSePerMin),
        sampleCount: trend.sampleCount,
        windowMin: mins,
        caption: `heap ${heapMb} MB · moves too much over ${overWords(mins)} to call a trend`,
      };
    }
    const score = trend.score;
    return {
      score,
      rating: ratingFor(score),
      heapMb,
      rssMb,
      growthMbPerMin: r1(growth),
      slopeSeMbPerMin: r1(trend.slopeSePerMin),
      sampleCount: trend.sampleCount,
      windowMin: mins,
      caption: `heap ${heapMb} MB · ${signed(growth)} MB/min over ${overWords(mins)}`,
    };
  } catch {
    return null;
  }
}

/** GC-pressure axis, or null until at least one collection has been seen over a
 *  few seconds of wall time. Pure read. Never throws. */
export function readGcPressure(): VitalAxis | null {
  if (isBoosthisDisabled() || !started || !gcObserver) return null;
  try {
    if (gcCount < 1) return null;
    const now = Date.now();
    // The start-up rule: boot collections (module loading, the first cache
    // fills) are not pressure. The share is taken over the settled window.
    if (isSettling("peakRate", now)) return settlingAxis();
    const elapsed = settledSpanMs(startedAt, now);
    if (elapsed < MIN_GC_ELAPSED_MS || !spanJudgeable(elapsed)) return null;
    const gcPct = (100 * settledGcMs) / elapsed;
    const score = linearScore(gcPct, GC_PCT_GOOD, GC_PCT_POOR);
    return markSettled({
      score,
      rating: ratingFor(score),
      gcMs: r0(settledGcMs),
      gcCount: settledGcCount,
      gcPct: r2(gcPct),
      windowMin: windowMinOf(elapsed),
      caption: `${r2(gcPct)}% time in GC · ${settledGcCount} collections`,
    });
  } catch {
    return null;
  }
}

/** Recent GC share over a rolling window. The same observer feeds this and
 * gcPressure; unlike the lifetime average, old healthy time ages out. */
export function readGcTax(): VitalAxis | null {
  if (isBoosthisDisabled() || !started || !gcObserver) return null;
  try {
    const now = Date.now();
    if (isSettling("peakRate", now)) return gcCount > 0 ? settlingAxis() : null;
    // The newest ten minutes, never reaching back into the settle period, and
    // never further back than the event ring still holds.
    let windowStart = Math.max(startedAt, settledFromMs("peakRate"), now - GC_TAX_WINDOW_MS);
    if (gcEvents.length >= GC_EVENT_RING_CAP) windowStart = Math.max(windowStart, gcEvents[0]!.t);
    const windowMs = now - windowStart;
    if (windowMs < GC_TAX_MIN_WINDOW_MS || !spanJudgeable(windowMs)) return null;
    const recent = gcEvents.filter((event) => event.t >= windowStart);
    if (recent.length === 0) return null;
    const gcMs = recent.reduce((sum, event) => sum + event.ms, 0);
    const gcPct = (100 * gcMs) / windowMs;
    const score = linearScore(gcPct, GC_TAX_GOOD_PCT, GC_TAX_POOR_PCT);
    return markSettled({
      score,
      rating: ratingFor(score),
      gcPct: r2(gcPct),
      gcCount: recent.length,
      windowMin: windowMinOf(windowMs),
      caption: `${r2(gcPct)}% time in recent GC · ${recent.length} collections`,
    });
  } catch {
    return null;
  }
}

/** Mean retained heap per completed request over the bounded recent ring. */
export function readMemoryPerRequest(): VitalAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    const now = Date.now();
    // The start-up rule (perRequestMemory): the first requests fill caches,
    // pools and compiled code once. Nothing they leave is counted.
    if (settledRequestCount === 0) {
      // Armed means a collection has handed over a live set as well as a
      // request having been served. On an engine whose collector delivers no
      // entries (Bun) this reading can never be taken, so it says nothing
      // rather than "still settling" for a reading that will never come.
      return isSettling("perRequestMemory", now) && reqTotal > 0 && retainedPoints.length > 0
        ? settlingAxis()
        : null;
    }
    const pts = retainedPoints.filter((point) => point.reqs > 0);
    if (pts.length < 3) return null;
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    const requests = last.reqs - first.reqs;
    if (requests < MIN_MEMORY_REQUESTS) return null;
    const fit = perRequestFit(pts);
    if (!fit) return null;
    // Growth that holds across the fit, not one collection's luck.
    const avgKb = Math.max(0, fit.slopeMb - 2 * fit.seMb) * 1024;
    const score = linearScore(avgKb, MEMORY_PER_REQUEST_GOOD_KB, MEMORY_PER_REQUEST_POOR_KB);
    return markSettled({
      score,
      rating: ratingFor(score),
      avgKb: r1(avgKb),
      requestCount: requests,
      windowMin: windowMinOf(last.t - first.t),
      caption: `${r1(avgKb)} KB retained per request`,
    });
  } catch {
    return null;
  }
}

/** Least-squares slope of the live set against settled requests served, in
 *  MB per request, with its standard error. */
function perRequestFit(pts: readonly RetainedPoint[]): { slopeMb: number; seMb: number } | null {
  const n = pts.length;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.reqs;
    my += p.heapMb;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.reqs - mx) ** 2;
    sxy += (p.reqs - mx) * (p.heapMb - my);
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  let sse = 0;
  for (const p of pts) sse += (p.heapMb - (my + slope * (p.reqs - mx))) ** 2;
  const se = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : 0;
  return { slopeMb: slope, seMb: se };
}

/** Process high-water resident memory. Linux exposes the exact lifetime peak
 * as VmHWM; elsewhere the best honest answer is the maximum sampled RSS. */
export function readPeakRss(): VitalAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    const current = process.memoryUsage().rss / BYTES_PER_MB;
    try {
      const status = readFileSync("/proc/self/status", "utf8");
      const match = /^VmHWM:\s+(\d+)\s+kB$/m.exec(status);
      if (match) {
        const peakRssMb = Number(match[1]) / 1024;
        if (Number.isFinite(peakRssMb)) {
          return {
            score: null,
            rating: "not-scored",
            peakRssMb: r1(peakRssMb),
            rssMb: r1(current),
            sampleCount: 1,
            exact: 1,
            caption: `${r1(peakRssMb)} MB peak resident memory`,
          };
        }
      }
    } catch {
      /* sampled fallback below */
    }
    const observed = memSamples.map((sample) => sample.rssMb);
    observed.push(current);
    if (observed.length === 0) return null;
    return {
      score: null,
      rating: "not-scored",
      peakRssMb: r1(Math.max(...observed)),
      rssMb: r1(current),
      sampleCount: observed.length,
      exact: 0,
      caption: `${r1(Math.max(...observed))} MB sampled peak resident memory`,
    };
  } catch {
    return null;
  }
}

/** Reliability axis (5xx error rate + throughput caption), or null until enough
 *  requests have been observed. Pure read. Never throws. */
export function readReliability(): VitalAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    if (reqTotal < MIN_REQ_FOR_RELIABILITY) return null;
    const errorPct = (100 * reqErrors) / reqTotal;
    const score = linearScore(errorPct, ERR_PCT_GOOD, ERR_PCT_POOR);
    const spanMs = Math.max(0, lastReqAt - firstReqAt);
    const spanMin = windowMinOf(spanMs);
    // The earned-rate contract (rateHonesty.ts). Throughput divided by a span
    // of a few seconds is a projection, not a measurement: 5 requests in 4s is
    // not "75/min". Below the ceiling the error share and the request count —
    // both actually measured — still stand on their own.
    const rpm = earnedPerMin(reqTotal, spanMs);
    return {
      score,
      rating: ratingFor(score),
      total: reqTotal,
      errors: reqErrors,
      errorRate: r2(errorPct / 100),
      errorPct: r1(errorPct),
      ...(rpm === null ? {} : { rpm }),
      windowMin: spanMin,
      // WHICH requests. This counter is bumped once per RESPONSE at the
      // middleware's finish boundary, while the panel headline counts every
      // timed unit of work in the sample ring — hand-marked spans and work
      // outside an HTTP response included. A capture showed "429 requests
      // measured" in the headline over "10 requests" here, which reads as
      // the kit having missed 419 of them. Each names what it counted.
      caption:
        rpm === null
          ? `${r1(errorPct)}% errors · ${reqTotal} responses · ${windowPhrase(spanMin)}`
          : `${r1(errorPct)}% errors · ${reqTotal} responses · ${rpm}/min over ${overWords(spanMin)}`,
    };
  } catch {
    return null;
  }
}

/** Crash-free axis (universal). Score from the observed crash rate; warming up
 *  until a few minutes have elapsed (a crash surfaces immediately). Pure read. */
export function readCrashFree(): VitalAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    // A RESTART MAY NOT ERASE THE EVIDENCE. `crashCount()` lives in the memory
    // of the running process, so the one event this axis exists to report — a
    // crash that ENDS that process — also destroys the only thing it consults.
    // Six seconds later the replacement reported "crash-free · over 5 minutes",
    // truthfully, about a process that had never crashed, while the crash that
    // killed its predecessor sat on disk. So the count and the window are both
    // read from the app's own durable history as well: crashes suffered by
    // EARLIER lifetimes inside the retention window, and the time those
    // lifetimes actually observed. See CRASH_HISTORY_WINDOW_MS for why the
    // window is finite, and docs/decisions/crash-free-verdict-source.md for
    // why the kit's history answers this rather than the server's records.
    const history = crashHistoryWindow();
    // Eligibility is judged on the RAW elapsed time, never on the reported
    // two-decimal window (see windowMinOf in rateHonesty.ts).
    //
    // AND THE WINDOW BOUNDS BOTH HALVES OF THE RATE. A process up for three
    // days may not divide by three days while the caption says the last 24
    // hours: the denominator would be time the verdict does not answer for,
    // and it would quietly dilute a crash that IS inside the window.
    const uptimeMs = Date.now() - startedAt;
    const windowMs = Math.min(
      history.windowMs,
      Math.max(uptimeMs, history.observedMs),
    );
    const windowMin = windowMinOf(windowMs);
    // The same bound applies to the numerator, and only the stamped history can
    // apply it: `crashCount()` is a LIFETIME total, so a long-lived process
    // would keep answering for a crash it survived days ago. Its occurrences
    // are in the history too, stamped, so they age out like everybody else's.
    // Two honest fallbacks: with no history readable at all, the in-memory
    // count is all there is; and while this run is younger than the window,
    // every crash it counted is inside the window by definition, so the count
    // is a floor under a history that may have failed to record one.
    const ownInWindow = !history.recorded
      ? crashCount()
      : uptimeMs <= history.windowMs
        ? Math.max(history.own, crashCount())
        : history.own;
    const crashes = ownInWindow + history.carried;
    // "at least", when a crash loop overflowed the bounded ring.
    const countWord = history.carriedAtLeast ? "at least " : "";
    // More than one run inside the window means the verdict spans a restart.
    // Said out loud: a succession of healthy young processes is exactly how an
    // app in a crash loop presents itself, and this is the only place the
    // reading admits that its window covers more than the process reporting it.
    const runsTail =
      history.runs > 1
        ? ` \u00b7 ${history.runsAtLeast ? "at least " : ""}${history.runs} runs in the last 24h`
        : "";
    // "CRASH-FREE" IS A CLAIM ABOUT THE APP, NOT ABOUT OUR BOOKKEEPING. Two
    // different failures of ours produce the same reassuring zero:
    //
    //   • `cannot-keep`  — the crash could not be written to disk, so a fatal
    //     one dies with the process and is never seen again.
    //   • `not-delivering` — a crash IS held, was offered, and the server
    //     turned it away. A crash restored from a previous run is not in this
    //     process's own count, so without this the customer whose service is
    //     crash-looping and whose reports are being refused reads 100/good.
    //   • `holding` — a crash IS held and has NOT been offered yet (no
    //     credential, kit still locked, server unreachable). Same shape as a
    //     refusal from where the reading is taken: this process did not see it
    //     happen and the server has not been told, so scoring it 100 tells a
    //     crashing app it is clean while its own crash sits on disk.
    //
    // Either way a zero here is our own blindness rendered as the customer's
    // good news. Say "not available here" instead, in the four-state
    // vocabulary every axis already uses (`measurable: 0` plus a closed reason
    // code; the server writes the words). This never fabricates a crash and
    // never hides one: a count we DO have is still reported below.
    const reportingVerdict = crashReportingVerdict();
    if (crashes === 0 && reportingVerdict !== "reporting") {
      return {
        score: null,
        rating: "pending",
        measurable: 0,
        // 8 = "where this app runs blocks the reading"
        // (AXIS_NOT_AVAILABLE_REASON.BLOCKED_BY_ENVIRONMENT, server-side).
        reasonCode: 8,
        windowMin,
      };
    }
    // The earned-rate contract (rateHonesty.ts). Nothing to say at all while
    // the window is short and no crash has happened; but once one HAS, the
    // count and the window are reported immediately — only the projection and
    // the score wait for an observation that earned them.
    const perHour = earnedPerHour(crashes, windowMs);
    if (perHour === null) {
      if (crashes === 0) return null;
      return {
        score: null,
        rating: "pending",
        crashes,
        windowMin,
        ...(history.runs > 1 ? { runsInWindow: history.runs } : {}),
        caption: `${countWord}${crashes} crash${crashes === 1 ? "" : "es"} \u00b7 ${windowPhrase(windowMin, "observed so far")}${runsTail}`,
      };
    }
    // SCORED FROM THE UNROUNDED RATE. `earnedPerHour` rounds to one decimal for
    // display, and one crash in a 24-hour window is 0.04/hour — which rounds to
    // 0.0, scores 100 and rates "good". That is the original false all-clear
    // rebuilt out of arithmetic: the crash survived the restart, reached the
    // reading, and was rounded back out of it. The exact rate scores; the
    // rounded one is only ever spoken.
    // Same helper, same twelvefold ceiling — asked for the precision a SCORE
    // needs rather than the precision a sentence needs.
    const exactPerHour = earnedPerHour(crashes, windowMs, 4) ?? perHour;
    const rateScore = linearScore(
      exactPerHour,
      CRASHFREE_RATE_GOOD,
      CRASHFREE_RATE_POOR,
    );
    const score =
      crashes > 0
        ? Math.min(rateScore, CRASHFREE_MAX_SCORE_AFTER_CRASH)
        : rateScore;
    return {
      score,
      rating: ratingFor(score),
      crashes,
      windowMin,
      ...(history.runs > 1 ? { runsInWindow: history.runs } : {}),
      caption:
        crashes === 0
          ? `crash-free \u00b7 ${windowPhrase(windowMin)}${runsTail}`
          : // A rate that rounded to zero is not spoken at all: "1 crash ·
            // 0/hour over 24h" reads as a rounding artefact arguing with the
            // count beside it. The count and the window are both measured.
            perHour === 0
            ? `${countWord}${crashes} crash${crashes === 1 ? "" : "es"} \u00b7 ${windowPhrase(windowMin)}${runsTail}`
            : `${countWord}${crashes} crash${crashes === 1 ? "" : "es"} \u00b7 ${perHour}/hour over ${overWords(windowMin)}${runsTail}`,
    };
  } catch {
    return null;
  }
}

/** Event-loop utilization axis (Node) — the mean busy fraction over recent
 *  sampled intervals. Null until a few intervals are captured. Pure read. */
export function readEventLoopUtilization(): VitalAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    const now = Date.now();
    if (isSettling("peakRate", now)) return eluSamples.length > 0 ? settlingAxis() : null;
    // Elapsed-time utilisation over the settled window: active time over the
    // time the intervals cover. An interval that began before the settled
    // point carries start-up work and is left out whole.
    const from = Math.max(settledFromMs("peakRate"), now - ELU_WINDOW_MS);
    let idle = 0;
    let active = 0;
    let n = 0;
    let firstStart = Infinity;
    for (const sample of eluSamples) {
      const begin = sample.t - (sample.idle + sample.active);
      if (begin < from) continue;
      idle += sample.idle;
      active += sample.active;
      n += 1;
      if (begin < firstStart) firstStart = begin;
    }
    if (n < MIN_ELU_SAMPLES || idle + active <= 0) return null;
    const windowMs = now - firstStart;
    if (!spanJudgeable(windowMs)) return null;
    const utilPct = r1((100 * active) / (idle + active));
    const score = linearScore(utilPct, ELU_PCT_GOOD, ELU_PCT_POOR);
    return markSettled({
      score,
      rating: ratingFor(score),
      utilPct,
      windowMin: windowMinOf(windowMs),
      caption: `${utilPct}% loop utilization`,
    });
  } catch {
    return null;
  }
}

/** Heap spaces whose committed pages can strand memory.
 *
 *  The read-only space, the semi-space nursery and the large-object spaces
 *  commit and release on their own schedule — a half-empty nursery is how a
 *  scavenger is supposed to look, and a large-object space reports a made-up
 *  `space_available_size` — so slack inside them is not fragmentation. Mirrors
 *  the exclusion list `heapSpacePressure` uses in processMeters.ts; the two
 *  readings must speak for the same part of the heap. */
function fragmentableSpace(name: unknown): boolean {
  if (typeof name !== "string" || name === "") return false;
  if (name === "read_only_space" || name === "new_space") return false;
  return !name.endsWith("large_object_space");
}
/** Heap-fragmentation axis (Node) — committed heap that holds no live object
 *  and is not on a free list either: memory V8 has taken from the OS and can
 *  neither use nor give back, measured against the heap ceiling.
 *
 *  This used to be `(total - used) / total`, which is not fragmentation at all
 *  — committed-but-unused heap is slack, and slack is normal. Worse, the
 *  denominator was the thing going wrong: filling the heap drove the share
 *  toward zero, so a leaking process scored BETTER than an identical clean one
 *  and a process on the edge of its ceiling reported perfect fragmentation.
 *  The per-space data says which of that slack is genuinely stranded, and
 *  `heap_size_limit` is the one denominator a leak cannot move.
 *
 *  Warming up for the first few seconds to avoid boot-time noise. Pure read. */
export function readHeapFragmentation(): VitalAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    if (Date.now() - startedAt < MIN_FRAG_ELAPSED_MS) return null;
    const s = getHeapStatistics();
    const total = s.total_heap_size;
    const limit = s.heap_size_limit;
    if (!Number.isFinite(total) || total <= 0) return null;
    if (!Number.isFinite(limit) || limit <= 0) return null;
    // No per-space read (Bun, or an engine that refuses the struct) means no
    // honest fragmentation figure — and the slack share it would fall back to
    // is the reading being replaced. The axis stays absent instead.
    const spaces = getHeapSpaceStatistics();
    if (!Array.isArray(spaces) || spaces.length === 0) return null;
    const { stranded, counted } = strandedHeapBytes(spaces);
    if (counted === 0) return null;
    const strandedMb = r1(stranded / BYTES_PER_MB);
    const fragPct = r1((100 * stranded) / limit);
    const heapMb = r0(total / BYTES_PER_MB);
    const maxMb = r0(limit / BYTES_PER_MB);
    const score = linearScore(fragPct, FRAG_PCT_GOOD, FRAG_PCT_POOR);
    return {
      score,
      rating: ratingFor(score),
      fragmentationPct: fragPct,
      fragPct,
      strandedMb,
      limitMb: maxMb,
      heapMb,
      maxMb,
      elapsedMs: Date.now() - startedAt,
      caption:
        `${strandedMb} MB of committed heap holds nothing \u00b7 ` +
        `${fragPct}% of the ${maxMb} MB heap ceiling`,
    };
  } catch {
    return null;
  }
}

/** Handle-leak axis (Node) — least-squares growth of the active-handle count.
 *  Null until enough samples cover a long-enough window. Pure read. */
export function readHandleLeak(): VitalAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    const trend = judgeTrend(
      handleSamples.map((s) => ({ t: s.t, v: s.count })),
      {
        good: HANDLE_GROWTH_GOOD,
        poor: HANDLE_GROWTH_POOR,
        minSamples: MIN_HANDLE_SAMPLES,
        minSpanMs: MIN_HANDLE_SPAN_MS,
        warmupMs: HANDLE_WARMUP_MS,
        startedAt,
        floorBucketMs: HANDLE_FLOOR_BUCKET_MS,
        minFloorBuckets: MIN_HANDLE_FLOOR_BUCKETS,
        riseFloor: HANDLE_RISE_FLOOR,
      },
    );
    if (!trend) return null;
    // The figure beside the verdict used to be the single latest sample —
    // "104 handles" was whatever happened to be in flight at one arbitrary
    // instant, which on a bursty workload is the burst. The middle of the
    // judged samples is what this process typically holds.
    const handles = Math.round(medianOf(trend.judged.map((p) => p.v)) ?? 0);
    const growth = trend.perMin;
    const mins = windowMinOf(trend.spanMs);
    // Consistent with a process holding steady AND with one accumulating.
    // The count is real and ships; the verdict does not, with its reason.
    if (trend.score === null) {
      return {
        score: null,
        rating: "pending",
        reasonCode: trend.reasonCode,
        handles,
        growthPerMin: r1(growth),
        windowMin: mins,
        sampleCount: trend.sampleCount,
        caption: `${handles} handles \u00b7 moves too much over ${overWords(mins)} to call a trend`,
      };
    }
    const score = trend.score;
    return {
      score,
      rating: ratingFor(score),
      handles,
      growthPerMin: r1(growth),
      windowMin: mins,
      sampleCount: trend.sampleCount,
      caption:
        score >= 100 && growth > 0
          ? `${handles} handles \u00b7 ${signed(growth)}/min is ${Math.round(trend.rise)} over ${overWords(mins)}, too few to call a leak`
          : `${handles} handles \u00b7 ${signed(growth)}/min over ${overWords(mins)}`,
    };
  } catch {
    return null;
  }
}

/** Nearest-rank percentile of an ascending-sorted array (p in 0..100). */
function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.max(0, Math.min(sortedAsc.length - 1, idx))];
}

/** GC pause-tail axis (Node) — the p99 (and max) garbage-collection pause over
 *  recent collections. Null until enough collections make a tail meaningful.
 *  Pure read. Never throws. */
export function readGcPauseTail(): VitalAxis | null {
  if (isBoosthisDisabled() || !started || !gcObserver) return null;
  try {
    const now = Date.now();
    // The start-up rule (latencyTail): the boot collections and the first
    // collection of all are not the tail. Below 100 pauses a p99 is the
    // slowest settled pause.
    if (isSettling("latencyTail", now)) return gcCount > 0 ? settlingAxis() : null;
    const values = settledTailValues(gcPauseTimed, "latencyTail");
    if (values.length < Math.max(MIN_GC_PAUSE_SAMPLES, SETTLE_FAMILIES.latencyTail.minSamples)) {
      return null;
    }
    const p99 = percentileOf(values, 99) ?? 0;
    const maxMs = Math.max(...values);
    const score = linearScore(p99, GC_PAUSE_P99_GOOD, GC_PAUSE_P99_POOR);
    return markSettled({
      score,
      rating: ratingFor(score),
      p99Ms: r1(p99),
      maxMs: r1(maxMs),
      pauseCount: values.length,
      caption: `${r1(p99)}ms p99 pause \u00b7 ${values.length} GCs`,
    });
  } catch {
    return null;
  }
}

/** GC generation-balance axis (Node) — the ratio of full (major) to young
 *  (minor) collections. A healthy generational heap collects the young space
 *  far more often than it runs a full GC. Null until enough young collections
 *  are seen. Pure read. Never throws. */
export function readGcGenerationBalance(): VitalAxis | null {
  if (isBoosthisDisabled() || !started || !gcObserver) return null;
  try {
    const now = Date.now();
    if (isSettling("peakRate", now)) return gcCount > 0 ? settlingAxis() : null;
    if (settledYoungGcs < MIN_YOUNG_GCS) return null;
    const spanMs = settledSpanMs(startedAt, now);
    if (!spanJudgeable(spanMs)) return null;
    const ratio = settledFullGcs / Math.max(1, settledYoungGcs);
    // The yardstick's floor (docs/settle-rule-decisions.md): while collection
    // takes no more than 1% of the settled window, the generation mix costs
    // nothing worth acting on. The ratio rides either way.
    const gcPct = (100 * settledGcMs) / spanMs;
    const score =
      gcPct <= GEN_BALANCE_GC_PCT_FLOOR ? 100 : linearScore(ratio, GEN_RATIO_GOOD, GEN_RATIO_POOR);
    return markSettled({
      score,
      rating: ratingFor(score),
      fullCount: settledFullGcs,
      youngCount: settledYoungGcs,
      fullRatio: r2(ratio),
      gcPct: r2(gcPct),
      caption: `${settledFullGcs} full GCs \u00b7 ${settledYoungGcs} young`,
    });
  } catch {
    return null;
  }
}

/** Heap-headroom axis (Node) — used heap vs the V8 heap_size_limit (the
 *  --max-old-space-size ceiling). High occupancy is proximity to the OOM wall.
 *  Warming up for the first few seconds. Pure read. Never throws. */
export function readHeapHeadroom(): VitalAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    if (Date.now() - startedAt < MIN_HEAP_ELAPSED_MS) return null;
    const stats = heapStatsOverride ?? getHeapStatistics();
    const limit = stats.heap_size_limit;
    const used = stats.used_heap_size;
    if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(used)) return null;
    const usedMb = r0(used / BYTES_PER_MB);
    const maxMb = r0(limit / BYTES_PER_MB);
    const usedPct = r1((100 * used) / limit);
    const score = linearScore(usedPct, HEAP_USED_GOOD, HEAP_USED_POOR);
    // The start-up rule (peakRate): what the process holds while it boots
    // is not its settled level, so the first minute waits.
    if (isSettling("peakRate", Date.now())) return settlingAxis();
    return markSettled({
      score,
      rating: ratingFor(score),
      usedMb,
      limitMb: maxMb,
      maxMb,
      usedPct,
      // WHICH heap, and against WHAT. This axis and Heap Space Pressure sit
      // next to each other on the panel and can read 100/good beside a space
      // at 99.8% full, which looks like two verdicts on one resource. They
      // are not: this is the whole heap against the ceiling it may not pass,
      // and that one is the fullest individual V8 space, which V8 grows on
      // demand (it says so in its own caption, and points back here).
      caption: `${usedMb} MB of ${maxMb} MB heap (${usedPct}%) · whole heap against its ceiling, not one V8 space`,
      elapsedMs: Date.now() - startedAt,
    });
  } catch {
    return null;
  }
}

/** Read current cgroup memory usage + limit (bytes): cgroup v2
 *  (memory.current / memory.max) first, then the v1 fallback. Returns null when
 *  no cgroup is present, the limit is unset / "max" / an unlimited sentinel, or
 *  any read fails — the axis is then omitted rather than faked. Never throws. */
function readCgroupMem(): { usedBytes: number; maxBytes: number } | null {
  if (cgroupOverride === "unavailable") return null;
  if (cgroupOverride) return cgroupOverride;
  // cgroup v2 — the modern unified hierarchy.
  try {
    const maxRaw = readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim();
    if (maxRaw !== "max") {
      const maxBytes = Number(maxRaw);
      const usedBytes = Number(
        readFileSync("/sys/fs/cgroup/memory.current", "utf8").trim(),
      );
      if (
        Number.isFinite(maxBytes) && maxBytes > 0 && maxBytes < CGROUP_V1_UNLIMITED &&
        Number.isFinite(usedBytes) && usedBytes >= 0
      ) {
        return { usedBytes, maxBytes };
      }
    }
  } catch {
    /* fall through to the v1 hierarchy */
  }
  // cgroup v1 — the legacy per-controller hierarchy.
  try {
    const maxBytes = Number(
      readFileSync("/sys/fs/cgroup/memory/memory.limit_in_bytes", "utf8").trim(),
    );
    const usedBytes = Number(
      readFileSync("/sys/fs/cgroup/memory/memory.usage_in_bytes", "utf8").trim(),
    );
    if (
      Number.isFinite(maxBytes) && maxBytes > 0 && maxBytes < CGROUP_V1_UNLIMITED &&
      Number.isFinite(usedBytes) && usedBytes >= 0
    ) {
      return { usedBytes, maxBytes };
    }
  } catch {
    /* no cgroup memory controller available */
  }
  return null;
}

/** Container-pressure axis (Node) — process memory vs the cgroup memory limit
 *  (the container OOM-kill wall). Unlike heapHeadroom there is no warm-up: the
 *  proximity to a hard limit is honest the moment the kit is running, and the
 *  no-cgroup case is handled by omission. Pure read. Never throws. */
export function readContainerPressure(): VitalAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  // No Linux control groups on this system: no container limit to read.
  const lacking = systemUnavailableReading("containerPressure");
  if (lacking) return lacking;
  try {
    const mem = readCgroupMem();
    if (!mem) return null;
    const { usedBytes: used, maxBytes: limit } = mem;
    if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(used) || used < 0) {
      return null;
    }
    const usedMb = r0(used / BYTES_PER_MB);
    const maxMb = r0(limit / BYTES_PER_MB);
    const usedPct = r1((100 * used) / limit);
    const score = linearScore(usedPct, CONTAINER_PCT_GOOD, CONTAINER_PCT_POOR);
    // The start-up rule (peakRate): what the process holds while it boots
    // is not its settled level, so the first minute waits.
    if (isSettling("peakRate", Date.now())) return settlingAxis();
    return markSettled({
      score,
      rating: ratingFor(score),
      usedMb,
      maxMb,
      usedPct,
      caption: `${usedMb} MB of ${maxMb} MB container limit (${usedPct}%)`,
    });
  } catch {
    return null;
  }
}

/** Read current cgroup CPU throttling counters (CFS bandwidth): cgroup v2
 *  (cpu.max quota + cpu.stat) first, then the v1 fallback (cpu.cfs_quota_us +
 *  cpu.stat). Returns null when no cgroup cpu controller is present, the quota
 *  is unlimited ("max" / a value <= 0), or any read fails — the axis is then
 *  omitted rather than faked. Never throws. */
function readCgroupCpu(): { periods: number; throttled: number } | null {
  if (cpuThrottleOverride === "unavailable") return null;
  if (cpuThrottleOverride) return cpuThrottleOverride;
  // cgroup v2 — the modern unified hierarchy.
  try {
    const quotaRaw = readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim();
    // "<quota> <period>"; a leading "max" quota means no CPU cap is set.
    if (quotaRaw.split(/\s+/)[0] !== "max") {
      const stat = readFileSync("/sys/fs/cgroup/cpu.stat", "utf8");
      const periods = readStatLine(stat, "nr_periods");
      const throttled = readStatLine(stat, "nr_throttled");
      if (
        periods !== null && Number.isFinite(periods) && periods >= 0 &&
        throttled !== null && Number.isFinite(throttled) && throttled >= 0
      ) {
        return { periods, throttled };
      }
    }
  } catch {
    /* fall through to the v1 hierarchy */
  }
  // cgroup v1 — the legacy per-controller hierarchy.
  try {
    const quota = Number(
      readFileSync("/sys/fs/cgroup/cpu/cpu.cfs_quota_us", "utf8").trim(),
    );
    // A quota <= 0 means no CPU cap is set (unlimited).
    if (Number.isFinite(quota) && quota > 0) {
      const stat = readFileSync("/sys/fs/cgroup/cpu/cpu.stat", "utf8");
      const periods = readStatLine(stat, "nr_periods");
      const throttled = readStatLine(stat, "nr_throttled");
      if (
        periods !== null && Number.isFinite(periods) && periods >= 0 &&
        throttled !== null && Number.isFinite(throttled) && throttled >= 0
      ) {
        return { periods, throttled };
      }
    }
  } catch {
    /* no cgroup cpu controller available */
  }
  return null;
}

/** Parse a "<key> <value>" line out of a cgroup stat blob; null if absent. */
function readStatLine(stat: string, key: string): number | null {
  for (const line of stat.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === key) {
      const n = Number(parts[1]);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

/** The window a throttle share is read over. Both cgroup counters are
 *  LIFETIME totals for the whole container, so dividing them as read gives a
 *  since-container-start average: it barely moves under a burst, and every
 *  process in the container reports the identical number. The axis therefore
 *  keeps the counters from its previous read and reports the delta since
 *  then, which is what "is this app being held back right now" asks. */
const CPU_THROTTLE_MIN_WINDOW_MS = SETTLE_FAMILIES.peakRate.minSpanSec * 1000;

/** Counters as they stood at the last window boundary; null until the first
 *  read plants one. */
let cpuThrottleAnchor:
  | {
      periods: number;
      throttled: number;
      suspendPeriods: number;
      suspendThrottled: number;
      atMs: number;
    }
  | null = null;
/** What the current window already answered, so a second caller inside one
 *  reporting cycle gets that answer instead of consuming a fresh window. */
let cpuThrottleLast: VitalAxis | null = null;

/** CPU-throttling axis (Node) — the share of CFS bandwidth periods in which
 *  the cgroup was throttled against its CPU quota, over the window since the
 *  last read. Omitted until a window exists: the first read only plants the
 *  anchor, because a lifetime average presented as a current level is exactly
 *  what this axis must not say. The no-cgroup / unlimited-quota / no-data
 *  cases are omissions too. Pure read apart from the anchor. Never throws. */
export function readCpuThrottling(): VitalAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  // No Linux control groups on this system: no throttling counters to read.
  const lacking = systemUnavailableReading("cpuThrottling");
  if (lacking) return lacking;
  try {
    const cpu = readCgroupCpu();
    if (!cpu) return null;
    const { periods, throttled } = cpu;
    if (!Number.isFinite(periods) || periods < 0) return null;
    if (!Number.isFinite(throttled) || throttled < 0) return null;
    const now = Date.now();
    // The start-up rule: the boot CPU burst is not throttling to act on. No
    // window is anchored until the process has settled.
    if (isSettling("peakRate", now)) {
      cpuThrottleAnchor = null;
      cpuThrottleLast = null;
      return settlingAxis();
    }
    const anchor = cpuThrottleAnchor;
    // First read — or counters that went backwards, which means a different
    // container behind the same process. Plant the anchor and say nothing.
    if (
      anchor === null ||
      periods < anchor.periods ||
      throttled < anchor.throttled
    ) {
      cpuThrottleAnchor = {
        periods,
        throttled,
        suspendPeriods: suspendPeriodsDiscounted,
        suspendThrottled: suspendThrottledDiscounted,
        atMs: now,
      };
      cpuThrottleLast = null;
      return null;
    }
    const elapsed = now - anchor.atMs;
    // Two readers in one reporting cycle must not each consume the window.
    if (elapsed < CPU_THROTTLE_MIN_WINDOW_MS) return cpuThrottleLast;
    // Host-suspend honesty, differenced the same way: discount only the
    // periods and throttles written off DURING this window (a scale-to-zero
    // host throttling a suspended container), not the lifetime total.
    const suspendPeriods = Math.max(
      0,
      suspendPeriodsDiscounted - anchor.suspendPeriods,
    );
    const suspendThrottled = Math.max(
      0,
      suspendThrottledDiscounted - anchor.suspendThrottled,
    );
    const windowPeriods = Math.max(
      0,
      periods - anchor.periods - suspendPeriods,
    );
    const windowThrottled = Math.min(
      Math.max(0, throttled - anchor.throttled - suspendThrottled),
      windowPeriods,
    );
    // A window in which the CPU controller completed no period at all says
    // nothing about throttling. Keep the anchor so the window grows, and say
    // NOTHING: the cached answer belongs to a window that has already closed,
    // so handing it back here would date a stale reading to this minute.
    if (windowPeriods <= 0) return null;
    const throttledPct = r1((100 * windowThrottled) / windowPeriods);
    const score = linearScore(
      throttledPct,
      CPU_THROTTLE_PCT_GOOD,
      CPU_THROTTLE_PCT_POOR,
    );
    const windowMin = windowMinOf(elapsed);
    const axis: VitalAxis = {
      score,
      rating: ratingFor(score),
      throttledPct,
      throttledPeriods: windowThrottled,
      periods: windowPeriods,
      windowMin,
      caption:
        suspendThrottled > 0
          ? `${throttledPct}% of CPU periods throttled during traffic (${windowThrottled}/${windowPeriods}) \u00b7 ${windowPhrase(windowMin, "observed")} \u00b7 ${suspendThrottled} idle-suspend throttles discounted`
          : `${throttledPct}% of CPU periods throttled (${windowThrottled}/${windowPeriods}) \u00b7 ${windowPhrase(windowMin, "observed")}`,
    };
    if (suspendThrottled > 0) {
      axis.suspendDiscounts = suspendThrottled;
      // Accounting periods the host reported while asleep — its own unit
      // again, neither samples nor runs nor a thrown-away record.
      axis.suspendUnit = SUSPEND_UNIT.PERIODS;
    }
    cpuThrottleAnchor = {
      periods,
      throttled,
      suspendPeriods: suspendPeriodsDiscounted,
      suspendThrottled: suspendThrottledDiscounted,
      atMs: now,
    };
    markSettled(axis);
    cpuThrottleLast = axis;
    return axis;
  } catch {
    return null;
  }
}

/** Suspend-sensor boundaries for the cpuThrottling discount. The loop going
 *  idle snapshots a clean counter baseline; a wake after a suspicious gap
 *  attributes the idle-time delta to host suspend. Both are cheap (two sysfs
 *  reads at most, only on idle transitions / rare wakes). Never throw. */
function cpuThrottleIdleStart(): void {
  if (isBoosthisDisabled() || !started) return;
  try {
    cpuIdleBaseline = readCgroupCpu();
  } catch {
    cpuIdleBaseline = null;
  }
}

function cpuThrottleSuspendWake(): void {
  if (isBoosthisDisabled() || !started) return;
  const base = cpuIdleBaseline;
  cpuIdleBaseline = null;
  if (!base) return;
  try {
    const cur = readCgroupCpu();
    if (!cur) return;
    const dPeriods = Math.max(0, cur.periods - base.periods);
    const dThrottled = Math.max(0, cur.throttled - base.throttled);
    if (dPeriods > 0 || dThrottled > 0) {
      suspendPeriodsDiscounted += dPeriods;
      suspendThrottledDiscounted += Math.min(dThrottled, dPeriods);
      suspendThrottleWakes++;
    }
  } catch {
    /* never let discount bookkeeping break the request path */
  }
}

// Module wiring (not data): boundaries come from the shared suspend sensor.
onSuspendIdleStart(cpuThrottleIdleStart);
onSuspendWake(cpuThrottleSuspendWake);

/** Read the current open file-descriptor count + the RLIMIT_NOFILE soft limit.
 *  openFds = the number of entries under /proc/self/fd; maxFds = the SOFT column
 *  (2nd) of the "Max open files" row of /proc/self/limits. Returns null when the
 *  count or limit cannot be read, or the limit is "unlimited" / <= 0 — the axis
 *  is then omitted rather than faked. Never throws. */
function readFdCounts(): { open: number; max: number } | null {
  if (fdOverride === "unavailable") return null;
  if (fdOverride) return fdOverride;
  try {
    // Reading /proc/self/fd itself opens a transient fd; the directory entries
    // are the currently-open descriptors.
    const open = readdirSync("/proc/self/fd").length;
    const limits = readFileSync("/proc/self/limits", "utf8");
    let max: number | null = null;
    for (const line of limits.split("\n")) {
      // "Max open files            1024                 524288               files"
      if (line.startsWith("Max open files")) {
        const soft = line.slice("Max open files".length).trim().split(/\s+/)[0];
        if (soft === "unlimited") return null;
        const n = Number(soft);
        if (Number.isFinite(n)) max = n;
        break;
      }
    }
    if (max === null || !Number.isFinite(max) || max <= 0) return null;
    if (!Number.isFinite(open) || open < 0) return null;
    return { open, max };
  } catch {
    return null;
  }
}

/** FD-saturation axis (Node) — open file descriptors vs the RLIMIT_NOFILE soft
 *  limit. Like containerPressure there is no warm-up: proximity to the EMFILE
 *  wall is honest the moment the kit is running, and the no-count / unlimited /
 *  no-data cases are handled by omission. Pure read. Never throws. */
export function readFdSaturation(): VitalAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  // No /proc process files on this system: no descriptor count to read.
  const lacking = systemUnavailableReading("fdSaturation", { scopeCode: 1 });
  if (lacking) return lacking;
  try {
    const fds = readFdCounts();
    if (!fds) return null;
    const { open: openFds, max: maxFds } = fds;
    if (!Number.isFinite(maxFds) || maxFds <= 0) return null;
    if (!Number.isFinite(openFds) || openFds < 0) return null;
    const usedPct = r1((100 * openFds) / maxFds);
    const score = linearScore(usedPct, FD_USED_GOOD, FD_USED_POOR);
    // The start-up rule (peakRate): what the process holds while it boots
    // is not its settled level, so the first minute waits.
    if (isSettling("peakRate", Date.now())) return settlingAxis();
    return markSettled({
      score,
      rating: ratingFor(score),
      openFds,
      maxFds,
      usedPct,
      scopeCode: 1,
      caption: `${openFds} of ${maxFds} file descriptors (${usedPct}%)`,
    });
  } catch {
    return null;
  }
}

/** Cold-start axis (universal, display-only) — how long this app took to be
 *  READY TO SERVE: process start -> the first server socket accepted
 *  connections (`measuredTo: 1`). ADDITIVE: it never feeds the composite Speed
 *  score.
 *
 *  When this process was never seen to bind (a worker, a function host, or a
 *  server that was already listening before the kit was switched on) the axis
 *  falls back to the interval it CAN see — process start -> telemetry-enable —
 *  and says so: `measuredTo: 4`, no score, no rating. A partial interval is
 *  never rated, because "cold start: good" is read as "this app starts fast"
 *  and everything the app does after our enable call sits in that gap. See
 *  docs/cold-start-boundary-contract.md.
 *
 *  Omitted entirely when neither mark exists, or when both trip the sanity
 *  guards (value <= 0 -> unavailable; value > 10 min -> not a bootstrap
 *  measurement). Pure read — never re-reads a clock. Never throws. */
export function readColdStart(): VitalAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    const usable = (v: number | null): number | null => {
      if (v === null) return null;
      const ms = Math.round(v);
      if (!Number.isFinite(ms) || ms <= 0) return null;
      // value > 10 min -> not a bootstrap read (a kit switched on long after
      // boot, or a socket bound an hour into the process's life).
      if (ms > COLDSTART_MAX_MS) return null;
      return ms;
    };
    const ready = usable(readyToServeMs());
    if (ready === null) {
      const enable = usable(coldStartMs);
      if (enable === null) return null;
      // Numeric-only — no caption (the server rebuilds captions for this axis).
      return {
        score: null,
        rating: "pending",
        startupMs: enable,
        measuredTo: MEASURED_TO_KIT_ENABLE,
      };
    }
    const score = linearScore(ready, COLDSTART_MS_GOOD, COLDSTART_MS_POOR);
    return {
      score,
      rating: ratingFor(score),
      startupMs: ready,
      measuredTo: MEASURED_TO_SERVING,
    };
  } catch {
    return null;
  }
}

/** GC-trend axis (Node) — young collections per minute over the recent rolling
 *  window, worst major pause in the caption. Null until enough recent
 *  collections over enough wall time. Pure read. Never throws. */
export function readGcTrend(): VitalAxis | null {
  if (isBoosthisDisabled() || !started || !gcObserver) return null;
  try {
    const now = Date.now();
    // The start-up rule (growthSlope): the quantity is the TREND of collection
    // time, fitted across whole settled minutes. A boot burst is one step and
    // is never projected; a busy but steady collector is not a trend.
    if (isSettling("growthSlope", now)) return gcCount > 0 ? settlingAxis() : null;
    const from = Math.max(settledFromMs("growthSlope"), startedAt);
    const firstMinute = Math.ceil(from / 60_000) * 60_000;
    const lastMinute = Math.floor(now / 60_000) * 60_000 - 60_000;
    if (lastMinute < firstMinute) return null;
    const oldestHeld = gcMinuteMs.length >= GC_MINUTE_CAP ? gcMinuteMs[0]!.t : -Infinity;
    const byMinute = new Map(gcMinuteMs.map((bucket) => [bucket.t, bucket.ms]));
    const points: TimedSample[] = [];
    const startMinute = Math.max(firstMinute, oldestHeld, lastMinute - (GC_TREND_FIT_MINUTES - 1) * 60_000);
    for (let m = startMinute; m <= lastMinute; m += 60_000) {
      points.push({ t: m, v: byMinute.get(m) ?? 0 });
    }
    const fit = settledSlope(points, "growthSlope");
    if (!fit) return null;
    // ms of collection per minute, per minute -> share points per hour.
    const growthPtsPerHour = r2(persistentGrowthPerMin(fit) / 10);
    const gcMsPerMin = r1(points.reduce((sum, point) => sum + point.v, 0) / points.length);
    const windowMs = Math.min(now - from, GC_TREND_WINDOW_MS);
    const windowStart = now - windowMs;
    const recent = gcEvents.filter((e) => e.t >= windowStart);
    const young = recent.filter((e) => e.young).length;
    const youngPerMin = r1(young / Math.max(windowMs / 60_000, 1 / 60));
    let worstMajorMs = 0;
    for (const e of recent) {
      if (e.major && e.ms > worstMajorMs) worstMajorMs = e.ms;
    }
    worstMajorMs = r1(worstMajorMs);
    const score = linearScore(growthPtsPerHour, GC_TREND_GROWTH_GOOD, GC_TREND_GROWTH_POOR);
    return markSettled({
      score,
      rating: ratingFor(score),
      gcGrowthPctPerHour: growthPtsPerHour,
      gcMsPerMin,
      youngPerMin,
      worstMajorMs,
      windowMin: windowMinOf(fit.spanMs),
      caption: `GC time ${signed(growthPtsPerHour)} pts/h · ${gcMsPerMin} ms/min · worst major pause ${worstMajorMs}ms`,
    });
  } catch {
    return null;
  }
}

/** Heap-wall countdown axis (Node) — at the current heap-growth slope, hours
 *  until used heap hits the V8 heap limit. Flat/shrinking heap = no wall in
 *  sight (score 100, countdown capped). Same warm-up gates as memoryStability.
 *  Pure read. Never throws. */
export function readHeapWall(): VitalAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    const now = Date.now();
    // The start-up rule (peakRate): one-time set-up allocation is a step, not
    // growth. The slope is fitted over settled samples only, and only growth
    // that holds across the fit is projected.
    if (isSettling("peakRate", now)) return memSamples.length > 0 ? settlingAxis() : null;
    const from = settledFromMs("peakRate");
    const settled = memSamples.filter((sample) => sample.t >= from);
    if (settled.length < MIN_MEM_SAMPLES) return null;
    const last = settled[settled.length - 1]!;
    if (last.t - settled[0]!.t < MIN_MEM_SPAN_MS) return null;
    const fit = settledSlope(
      settled.map((sample) => ({ t: sample.t, v: sample.heapMb })),
      "peakRate",
    );
    if (!fit) return null;
    const stats = heapStatsOverride ?? getHeapStatistics();
    const limit = stats.heap_size_limit;
    if (!Number.isFinite(limit) || limit <= 0) return null;
    const limitMb = limit / BYTES_PER_MB;
    const headroomMb = Math.max(0, limitMb - last.heapMb);
    const growth = persistentGrowthPerMin(fit);
    let hoursToWall: number;
    if (growth < HEAP_WALL_MIN_GROWTH) {
      hoursToWall = HEAP_WALL_MAX_HOURS; // flat or shrinking — no wall in sight
    } else {
      hoursToWall = Math.min(HEAP_WALL_MAX_HOURS, headroomMb / growth / 60);
    }
    const span = HEAP_WALL_GOOD_HOURS - HEAP_WALL_POOR_HOURS;
    const score =
      hoursToWall >= HEAP_WALL_GOOD_HOURS
        ? 100
        : hoursToWall <= HEAP_WALL_POOR_HOURS
          ? 0
          : Math.round((100 * (hoursToWall - HEAP_WALL_POOR_HOURS)) / span);
    return markSettled({
      score,
      rating: ratingFor(score),
      hoursToWall: r1(hoursToWall),
      headroomMb: r0(headroomMb),
      growthMbPerMin: r1(growth),
      caption:
        hoursToWall >= HEAP_WALL_MAX_HOURS
          ? `no heap wall in sight · ${r0(headroomMb)} MB headroom`
          : `hits heap limit in ~${r1(hoursToWall)}h at ${signed(growth)} MB/min`,
    });
  } catch {
    return null;
  }
}

/** Startup-import-cost axis (Node, one-shot display-only) — the FROZEN ms the
 *  app spent loading modules + top-level code before enableTelemetry (names
 *  the import slice of the cold start). Omitted when never captured or the
 *  sanity guards trip. Pure read — never re-reads. Never throws. */
export function readStartupImport(): VitalAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    if (startupImportMs === null) return null;
    const importMs = Math.round(startupImportMs);
    if (!Number.isFinite(importMs) || importMs <= 0) return null;
    if (importMs > STARTUP_IMPORT_MAX_MS) return null;
    const bootMs = Math.max(0, Math.round(startupBootMs ?? 0));
    const score = linearScore(importMs, STARTUP_IMPORT_MS_GOOD, STARTUP_IMPORT_MS_POOR);
    // Numeric-only — no caption (the server rebuilds captions for this axis).
    return {
      score,
      rating: ratingFor(score),
      importMs,
      bootMs,
    };
  } catch {
    return null;
  }
}

/** Assemble every currently-available vitals axis. Warming-up axes are omitted
 *  (the server renders an absent axis as pending) — same contract as
 *  responsiveness/resilience/eventLoopLag. Pure read. Never throws. */
export function readVitals(): Record<string, VitalAxis> {
  const axes: Record<string, VitalAxis> = {};
  const peak = readPeakRss();
  if (peak) axes.peakRss = peak;
  const mem = readMemoryStability();
  if (mem) axes.memoryStability = mem;
  const gc = readGcPressure();
  if (gc) axes.gcPressure = gc;
  const tax = readGcTax();
  if (tax) axes.gcTax = tax;
  const mpr = readMemoryPerRequest();
  if (mpr) axes.memoryPerRequest = mpr;
  const rel = readReliability();
  if (rel) axes.reliability = rel;
  const cf = readCrashFree();
  if (cf) axes.crashFree = cf;
  const elu = readEventLoopUtilization();
  if (elu) axes.eventLoopUtilization = elu;
  const frag = readHeapFragmentation();
  if (frag) axes.heapFragmentation = frag;
  const hl = readHandleLeak();
  if (hl) axes.handleLeak = hl;
  const gpt = readGcPauseTail();
  if (gpt) axes.gcPauseTail = gpt;
  const ggb = readGcGenerationBalance();
  if (ggb) axes.gcGenerationBalance = ggb;
  const hh = readHeapHeadroom();
  if (hh) axes.heapHeadroom = hh;
  const cp = readContainerPressure();
  if (cp) axes.containerPressure = cp;
  const ct = readCpuThrottling();
  if (ct) axes.cpuThrottling = ct;
  const fd = readFdSaturation();
  if (fd) axes.fdSaturation = fd;
  const cs = readColdStart();
  if (cs) axes.coldStart = cs;
  const gt = readGcTrend();
  if (gt) axes.gcTrend = gt;
  const hw = readHeapWall();
  if (hw) axes.heapWall = hw;
  const si = readStartupImport();
  if (si) axes.startupImport = si;
  return axes;
}

/** Stop the GC observer and drop all vitals state (wired into
 *  `telemetry.forget()` so nothing Boosthis-shaped keeps sampling after
 *  erasure). Idempotent. Never throws. */
export function clearVitals(): void {
  if (gcObserver) {
    try {
      gcObserver.disconnect();
    } catch {
      /* best-effort */
    }
    gcObserver = null;
  }
  started = false;
  startedAt = 0;
  memSamples.length = 0;
  liveSetSamples.length = 0;
  retainedPoints.length = 0;
  settledRequestCount = 0;
  lastMemSampleAt = 0;
  gcMs = 0;
  gcCount = 0;
  reqTotal = 0;
  reqErrors = 0;
  firstReqAt = 0;
  lastReqAt = 0;
  lastELU = null;
  lastEluAt = 0;
  eluSamples.length = 0;
  settledGcMs = 0;
  settledGcCount = 0;
  settledYoungGcs = 0;
  settledFullGcs = 0;
  gcPauseTimed.length = 0;
  gcMinuteMs.length = 0;
  handleSamples.length = 0;
  gcPauseRing.length = 0;
  fullGcCount = 0;
  youngGcCount = 0;
  heapStatsOverride = null;
  cgroupOverride = null;
  cpuThrottleOverride = null;
  cpuIdleBaseline = null;
  cpuThrottleAnchor = null;
  cpuThrottleLast = null;
  suspendPeriodsDiscounted = 0;
  suspendThrottledDiscounted = 0;
  suspendThrottleWakes = 0;
  fdOverride = null;
  coldStartMs = null;
  coldStartReaderOverride = null;
  clearReadyMark();
  gcEvents.length = 0;
  startupImportMs = null;
  startupBootMs = null;
  startupReaderOverride = null;
}

/** @internal test hooks. */
export const _vitalsInternals = {
  MEM_GROWTH_GOOD,
  MEM_GROWTH_POOR,
  MIN_MEM_SAMPLES,
  MIN_MEM_SPAN_MS,
  MEM_THROTTLE_MS,
  MEM_RING_CAP,
  MEM_TREND_WARMUP_MS,
  MEM_TREND_FLOOR_BUCKET_MS,
  MEM_RISE_FLOOR_MB,
  GC_PCT_GOOD,
  GC_PCT_POOR,
  MIN_GC_ELAPSED_MS,
  GC_TAX_GOOD_PCT,
  GC_TAX_POOR_PCT,
  GC_TAX_MIN_WINDOW_MS,
  GC_TAX_WINDOW_MS,
  MEMORY_PER_REQUEST_GOOD_KB,
  MEMORY_PER_REQUEST_POOR_KB,
  MIN_MEMORY_REQUESTS,
  ERR_PCT_GOOD,
  ERR_PCT_POOR,
  MIN_REQ_FOR_RELIABILITY,
  SERVER_ERROR_STATUS,
  CRASHFREE_RATE_POOR,
  CRASHFREE_MIN_WINDOW_MIN,
  ELU_PCT_GOOD,
  ELU_PCT_POOR,
  MIN_ELU_SAMPLES,
  FRAG_PCT_GOOD,
  FRAG_PCT_POOR,
  MIN_FRAG_ELAPSED_MS,
  strandedHeapBytes,
  HANDLE_GROWTH_GOOD,
  HANDLE_GROWTH_POOR,
  MIN_HANDLE_SAMPLES,
  MIN_HANDLE_SPAN_MS,
  HANDLE_WARMUP_MS,
  HANDLE_FLOOR_BUCKET_MS,
  MIN_HANDLE_FLOOR_BUCKETS,
  HANDLE_RISE_FLOOR,
  GC_PAUSE_P99_GOOD,
  GC_PAUSE_P99_POOR,
  MIN_GC_PAUSE_SAMPLES,
  GC_PAUSE_RING_CAP,
  GEN_RATIO_GOOD,
  GEN_RATIO_POOR,
  MIN_YOUNG_GCS,
  HEAP_USED_GOOD,
  HEAP_USED_POOR,
  MIN_HEAP_ELAPSED_MS,
  CPU_THROTTLE_PCT_GOOD,
  CPU_THROTTLE_PCT_POOR,
  FD_USED_GOOD,
  FD_USED_POOR,
  COLDSTART_MS_GOOD,
  COLDSTART_MS_POOR,
  COLDSTART_MAX_MS,
  HEAP_WALL_GOOD_HOURS,
  HEAP_WALL_POOR_HOURS,
  HEAP_WALL_MIN_GROWTH,
  HEAP_WALL_MAX_HOURS,
  STARTUP_IMPORT_MS_GOOD,
  STARTUP_IMPORT_MS_POOR,
  STARTUP_IMPORT_MAX_MS,
  /** Push a synthetic timestamped GC event (gcTrend tests). */
  pushGcEvent(t: number, young: boolean, major: boolean, ms: number): void {
    noteGcEvent(t, ms, young, major);
  },
  /** A collection that left `heapMb` live, at time `t`. */
  pushLiveSet(t: number, heapMb: number): void {
    noteLiveSet(t, heapMb);
  },
  /** The live set the collection observer records for a memory reading. */
  liveSetMbOf,
  /** Inject the startup-import reader (tests). */
  setStartupReader(fn: (() => { importMs: number; bootMs: number }) | null): void {
    startupReaderOverride = fn;
    startupImportMs = null;
    startupBootMs = null;
  },
  get isRunning(): boolean {
    return started;
  },
  reset(): void {
    clearVitals();
  },
  /** Force the started flag without a GC observer (deterministic unit tests). */
  forceStart(at: number): void {
    started = true;
    startedAt = at;
  },
  setStartedAt(at: number): void {
    startedAt = at;
  },
  /** Install a no-op GC observer sentinel so readGcPressure's observer guard
   *  passes deterministically (no dependence on a real collection firing). */
  enableGcForTest(): void {
    gcObserver = { disconnect() {} } as unknown as PerformanceObserver;
  },
  /** Push a synthetic memory sample, bypassing throttle + process.memoryUsage. */
  pushMemSample(t: number, heapMb: number, rssMb: number): void {
    const sample = { t, heapMb, rssMb };
    memSamples.push(sample);
    liveSetSamples.push(sample);
    if (memSamples.length > MEM_RING_CAP) memSamples.shift();
    if (liveSetSamples.length > MEM_RING_CAP) liveSetSamples.shift();
  },
  /** Push a synthetic ELU sample (utilization fraction 0..1). */
  /** One loop interval ending at `t`: `idle` and `active` ms. */
  pushEluInterval(t: number, idle: number, active: number): void {
    noteEluInterval(t, idle, active);
  },
  /** Push a synthetic active-handle count sample. */
  pushHandleSample(t: number, count: number): void {
    handleSamples.push({ t, count });
    if (handleSamples.length > HANDLE_RING_CAP) handleSamples.shift();
  },
  /** Record synthetic GC time. */
  addGc(ms: number): void {
    noteGcEvent(Date.now(), ms, false, false);
  },
  /** Record a synthetic collection driving all GC axes (pause ring + kind
   *  counters), mirroring the PerformanceObserver path. */
  recordGc(durationMs: number, kind: "young" | "full" | "other"): void {
    noteGcEvent(Date.now(), durationMs, kind === "young", kind === "full");
  },
  /** Inject synthetic V8 heap statistics for heapHeadroom (bytes). */
  setHeapStatsForTest(usedBytes: number, limitBytes: number): void {
    heapStatsOverride = { used_heap_size: usedBytes, heap_size_limit: limitBytes };
  },
  /** Inject synthetic cgroup memory numbers for containerPressure (bytes), or
   *  "unavailable" to force the no-cgroup path. */
  setCgroupForTest(
    v: { usedBytes: number; maxBytes: number } | "unavailable" | null,
  ): void {
    cgroupOverride = v;
  },
  /** Inject synthetic cgroup CPU throttle counters for cpuThrottling, or
   *  "unavailable" to force the no-cgroup / unlimited-quota path. */
  setCpuThrottleForTest(
    v: { periods: number; throttled: number } | "unavailable" | null,
  ): void {
    cpuThrottleOverride = v;
  },
  /** Drive the cpuThrottling suspend boundaries directly (idle baseline snap /
   *  wake delta attribution) without wall-clock games. */
  cpuThrottleIdleStartForTest(): void {
    cpuThrottleIdleStart();
  },
  cpuThrottleSuspendWakeForTest(): void {
    cpuThrottleSuspendWake();
  },
  getCpuSuspendStateForTest() {
    return {
      suspendPeriodsDiscounted,
      suspendThrottledDiscounted,
      suspendThrottleWakes,
    };
  },
  /** Age the cpuThrottling window anchor by `ms` so a test can cross the
   *  minimum window without wall-clock games. No-op before the first read. */
  advanceCpuThrottleWindowForTest(ms: number): void {
    if (cpuThrottleAnchor) cpuThrottleAnchor.atMs -= ms;
  },
  /** Inject synthetic open-fd count + soft limit for fdSaturation, or
   *  "unavailable" to force the no-count / unlimited-limit path. */
  setFdForTest(
    v: { open: number; max: number } | "unavailable" | null,
  ): void {
    fdOverride = v;
  },
  /** Inject a fake process-age reader (ms) for coldStart so tests never depend
   *  on the live value; the reader may also throw to exercise the omit path.
   *  null restores the live process.uptime() reader. */
  setColdStartReaderForTest(reader: (() => number) | null): void {
    coldStartReaderOverride = reader;
  },
  /** Trigger the ONCE-only, frozen cold-start capture (same call
   *  `enableTelemetry` makes). A second call after a value is stored is a no-op
   *  (freeze semantics). */
  captureColdStart(): void {
    captureColdStart();
  },
  /** The frozen captured value (ms), or null if never captured. */
  get coldStartMs(): number | null {
    return coldStartMs;
  },
  /** Record a synthetic request outcome (drives reliability without a server). */
  noteReq(statusCode: number, at: number): void {
    reqTotal += 1;
    if (statusCode >= SERVER_ERROR_STATUS) reqErrors += 1;
    if (firstReqAt === 0) firstReqAt = at;
    lastReqAt = at;
  },
  get memCount(): number {
    return memSamples.length;
  },
  get reqTotal(): number {
    return reqTotal;
  },
};

/** Committed heap bytes that hold no live object and are not on a free list,
 *  summed over the spaces where that is a fault, plus how many spaces answered.
 *
 *  Pure and separately testable: this is the half of the reading a matched
 *  leaking-vs-clean pair has to pin, and driving it needs synthetic spaces
 *  rather than whatever the test runner's own heap happens to look like. */
function strandedHeapBytes(spaces: readonly HeapSpaceInfo[]): {
  stranded: number;
  counted: number;
} {
  let stranded = 0;
  let counted = 0;
  for (const sp of spaces) {
    if (!sp || typeof sp.space_size !== "number" || sp.space_size <= 0) continue;
    if (!fragmentableSpace(sp.space_name)) continue;
    counted++;
    const live = typeof sp.space_used_size === "number" ? sp.space_used_size : 0;
    const free =
      typeof sp.space_available_size === "number" ? sp.space_available_size : 0;
    // Committed minus live minus what the free list can still hand out: page
    // overhead plus the swept remainder no allocation can reach.
    const dead = sp.space_size - live - free;
    if (dead > 0) stranded += dead;
  }
  return { stranded, counted };
}
