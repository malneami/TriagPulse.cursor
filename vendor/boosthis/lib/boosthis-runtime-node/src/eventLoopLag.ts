/* ─── Boosthis: event-loop lag axis (Node) ───────────────────────────────
 *
 * A fifth honest, display-only meter for the Node dashboard: how long the event
 * loop is *delayed* beyond its scheduled tick. Event-loop delay is the single
 * truest signal of a blocked/overloaded Node process — a sync `fs` call in a
 * handler, `JSON.parse` on a huge body, a tight CPU loop, or GC pressure all
 * show up here even when the per-route timer sees nothing (that timer only
 * measures the handlers Boosthis wraps; loop lag also catches burn BETWEEN
 * requests and inside un-instrumented callbacks/timers).
 *
 * SOURCE: Node core's `perf_hooks.monitorEventLoopDelay()` native histogram — a
 * libuv timer sampled every `RESOLUTION_MS` in C++ with negligible overhead.
 * There is NO background JS poller (Boosthis's own rule book forbids idle
 * spinners); the histogram is maintained natively and only READ on demand when
 * a snapshot is captured, so the meter never itself burns idle.
 *
 * HOST-SUSPEND HONESTY: a scale-to-zero host suspends the container between
 * requests, so the libuv timer fires tens of seconds late during idle gaps and
 * the histogram would record a monster "freeze" no user ever felt. Via the
 * shared suspend sensor, growth of the histogram max that happened ENTIRELY
 * inside a suspicious idle gap is attributed to suspend: the poisoned samples
 * are purged (histogram reset; clean traffic-time worst + sample counts are
 * carried forward) and the axis reports `suspendDiscounts` /
 * `suspendWorstMs` so the discount is visible, never silent. A stall DURING
 * traffic still lands in the histogram and still turns the tile red.
 *
 * PRIVACY: the axis carries ONLY numbers (p50/p99/max loop delay in ms, a
 * sample count, a 0..100 score, suspend-discount counts) plus a fixed rating
 * bucket — never a route name, value, timestamp of user activity, or source.
 * It rides inside the existing snapshot upload and clears the same PII guard
 * as every other field.
 *
 * Node↔Python parity: Python has no libuv loop, so its sibling
 * (`event_loop_lag.py`) measures asyncio scheduling delay and only when an
 * event loop is actually running (async apps); a sync WSGI app simply omits the
 * axis, exactly as this module omits it when the histogram is unavailable or
 * has too few samples.
 */

import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { isBunRuntime } from "./runtimeTag";
import { isBoosthisDisabled } from "./runtimeFlags";
import { SETTLE_RULE, isSettling, markSettled, settledFromMs } from "./settleRule";
import { linearScore, ratingFor } from "./healthAxes";
import { type Rating } from "./thresholds";
import { earnedPerMin, windowMinOf } from "./rateHonesty";
import {
  onSuspendActivity,
  onSuspendIdleStart,
  onSuspendWake,
  SUSPEND_UNIT,
} from "./suspendSensor";

/** libuv sampling resolution (ms). 20ms keeps overhead negligible while still
 *  resolving the sub-100ms stalls that hurt tail latency. */
const RESOLUTION_MS = 20;

/** Lag score bands (ms) — axis-specific and deliberately NOT the shared
 *  TTFF/TTI/FID thresholds: a p99 loop delay of ~50ms is still smooth, ~250ms
 *  is a clearly janky/blocked loop. `linearScore` maps ≤good→100, ≥poor→0. */
const LAG_GOOD_MS = 50;
const LAG_POOR_MS = 250;

/** Below this many histogram samples the axis is OMITTED rather than reporting
 *  a score derived from one or two ticks on a just-booted process (the server
 *  renders an absent axis as pending — same contract as responsiveness/budget). */
const MIN_LAG_SAMPLES = 20;

/** Worst-freeze SEVERITY bands (ms) — the longest SINGLE event-loop block seen
 *  this session (histogram max, never reset). One long freeze is invisible in
 *  an average or even a p99; this axis keeps it the way Latency floor keeps the
 *  worst window.
 *
 *  WHY THESE NUMBERS (re-banded 2026-09; previously 150ms good / 2000ms poor).
 *  A block on this loop is not one slow request. The process answers NOBODY for
 *  its whole duration, so every request already in flight and every one that
 *  arrives during it pays the entire block on top of its own work. The bar
 *  therefore comes from what a stalled caller pays, not from what a single
 *  handler may reasonably take:
 *    · ≤100ms — the long-standing "feels instant" ceiling for a response to a
 *      deliberate action. A block inside it is one no caller can pick out.
 *    · ≥1000ms — a full second in which the process answered no one. Nothing
 *      about that is smooth, at any traffic level.
 *  The old band demanded a TWO-SECOND block before it would say "poor" and held
 *  "good" up to ~437ms: a Node process frozen for very nearly half a second,
 *  rated smooth. On this band the score leaves "good" at 240ms — deliberately
 *  just under the 250ms LAG_POOR_MS above already calls a clearly blocked loop,
 *  so the two axes agree about when this loop is in trouble instead of one of
 *  them waiting for the other to be eight times worse. */
const FREEZE_GOOD_MS = 100;
const FREEZE_POOR_MS = 1_000;

/** A block at or above this is COUNTED as a freeze. The same 250ms bar
 *  LAG_POOR_MS uses for a clearly blocked loop, and above the severity band's
 *  good boundary (240ms), so nothing is ever counted here that the severity
 *  half still calls smooth. */
export const FREEZE_COUNT_MS = 250;

/** Worst-freeze FREQUENCY bands (freezes per minute of observation).
 *
 *  WHY THE AXIS NEEDS THIS AT ALL. `worstMs` is a single lifetime maximum, so
 *  twelve 400ms blocks inside a minute and one 425ms block produce an identical
 *  reading. The difference between a rare hiccup and a process stalling every
 *  five seconds was invisible by construction, and frequency is the half that
 *  decides whether a caller ever meets one.
 *    · ≤1/min — a quarter-second block once a minute is a hiccup most callers
 *      never hit.
 *    · ≥12/min — one every five seconds. A caller making a request a second
 *      meets a stalled process roughly every fifth request, and the loop is
 *      unresponsive for at least 5% of the time it is watched.
 *
 *  ONE VERDICT, AND IT IS THE WORSE HALF. A single very long freeze is bad on
 *  its own; so is a stream of shorter ones. Averaging the two lets either hide
 *  the other, so the axis scores `min(severity, frequency)` and the raw values
 *  of both halves stay on the wire. */
const FREEZE_RATE_GOOD_PER_MIN = 1;
const FREEZE_RATE_POOR_PER_MIN = 12;

export const BLOCKING_ASYNC_GOOD_PER_MIN = 0.5;
export const BLOCKING_ASYNC_POOR_PER_MIN = 10;
export const BLOCKING_ASYNC_MIN_WINDOW_MS = 60_000;

export interface EventLoopLagAxis {
  score: number;
  rating: Rating;
  lagP50Ms: number;
  lagP99Ms: number;
  lagMaxMs: number;
  sampleCount: number;
  /** Suspend purges applied — present only when > 0 (discount, don't hide). */
  suspendDiscounts?: number;
  /** WHAT one of those discounts is. A purge throws away the whole recorded
   *  distribution, so one discount here can stand for thousands of samples —
   *  which is why this count is far smaller than a per-sample axis's over the
   *  same window, and why the unit has to travel with the number. */
  suspendUnit?: number;
}

let histogram: IntervalHistogram | null = null;

/* ── Suspend-discount bookkeeping ──
 * trafficMaxNs   — histogram max as of the last moment we KNEW was traffic
 *                  time (request arrival or loop-went-idle boundary).
 * carriedWorstMs — clean traffic-time worst block carried across purges.
 * carriedSamples — samples accumulated in purged segments (keeps the warm-up
 *                  gate honest across resets).
 * carriedFreezeCount / carriedObservedMs — the freeze tally and the observation
 *                  window carried across purges, so the frequency half survives
 *                  a reset exactly as the worst block does.
 * suspendPurges / suspendWorstMs — the visible discount record. */
let trafficMaxNs = 0;
let carriedWorstMs = 0;
let carriedSamples = 0;
let carriedFreezeCount = 0;
let carriedObservedMs = 0;
let suspendPurges = 0;
let suspendWorstMs = 0;

/* ── THE START-UP RULE (settleRule.ts) ──────────────────────────────────────
 * The histogram runs from enable(), so module loading, the first JIT and the
 * traffic that queued while the server booted all landed in it, and one boot
 * stall decided the p99, the worst freeze and the freeze rate for the life of
 * the process. Once the process has settled (latencyTail: 60 s) everything
 * recorded before is dropped, once, and every verdict is taken from what the
 * loop did afterwards. Blocking calls judge from 120 s (startupEvent): the
 * freezes and observed time up to then are held as offsets. */
let settleResetDone = false;
let blockingBase: { count: number; observedMs: number } | null = null;
/** When the current histogram began recording: one started after a settle
 *  instant holds nothing from before it, so there is nothing to drop. */
let histogramStartedMs = 0;

/** A reading taken while the process is still settling: no grade yet. */
export interface SettlingLoopAxis {
  score: null;
  rating: "pending";
  sampleCount: number;
  settleRule: typeof SETTLE_RULE;
  // None of the graded figures exist yet; typed so a caller reads them as absent.
  lagP50Ms?: undefined;
  lagP99Ms?: undefined;
  lagMaxMs?: undefined;
  worstMs?: undefined;
  freezeCount?: undefined;
  freezesPerMin?: undefined;
  windowMin?: undefined;
  count?: undefined;
  perMin?: undefined;
  suspendDiscounts?: undefined;
  suspendUnit?: undefined;
  suspendWorstMs?: undefined;
}

function settleIfDue(nowMs: number = Date.now()): void {
  if (!histogram) return;
  if (!settleResetDone && histogramStartedMs >= settledFromMs("latencyTail")) settleResetDone = true;
  if (!blockingBase && histogramStartedMs >= settledFromMs("startupEvent")) {
    blockingBase = { count: 0, observedMs: 0 };
  }
  if (!settleResetDone && nowMs >= settledFromMs("latencyTail")) {
    settleResetDone = true;
    try {
      histogram.reset();
    } catch {
      /* a reset that throws leaves the lifetime record — still bounded */
    }
    trafficMaxNs = 0;
    carriedWorstMs = 0;
    carriedSamples = 0;
    carriedFreezeCount = 0;
    carriedObservedMs = 0;
  }
  if (settleResetDone && !blockingBase && nowMs >= settledFromMs("startupEvent")) {
    blockingBase = {
      count: carriedFreezeCount + samplesAtOrAbove(histogram, FREEZE_COUNT_MS),
      observedMs: carriedObservedMs + observedMsFromHistogram(histogram),
    };
  }
}

function settlingLoop(count: number): SettlingLoopAxis {
  return { score: null, rating: "pending", sampleCount: count, settleRule: SETTLE_RULE };
}

/** Round nanoseconds → milliseconds (histogram percentiles are reported in ns).
 *  Non-finite / negative inputs (a not-yet-populated histogram) collapse to 0. */
function nsToMs(ns: number): number {
  if (!Number.isFinite(ns) || ns <= 0) return 0;
  return Math.round(ns / 1e6);
}

/** How many recorded samples sit at or above `thresholdMs`, recovered from the
 *  histogram this module already keeps — NO new sampling and no background
 *  poller (this kit's own rule book forbids idle spinners, which is why the
 *  freeze count cannot simply be tallied by a watcher).
 *
 *  `percentile(p)` is hdr_histogram's: it answers for rank
 *  `trunc(p/100 × count + 0.5)`, so bisecting on that rank inverts it — find
 *  the lowest rank whose value has reached the bar and everything from there up
 *  is a freeze.
 *
 *  ASK FOR THE RANK'S MIDDLE, NOT ITS EDGE. Feeding `p = 100k/count` makes that
 *  expression `trunc(k + 0.5)`, half a rank clear of both neighbours, so no
 *  amount of floating-point drift in the division can land it on k-1. Asking at
 *  the rank BOUNDARY (`p = 100(k-0.5)/count`, i.e. `trunc(k ± ε)`) reads a whole
 *  sample low whenever ε is negative: with 23 quiet ticks and twelve 400ms
 *  blocks a native histogram returned eleven freezes, not twelve.
 *
 *  Accuracy is otherwise the histogram's own — a bucket boundary can move the
 *  answer by one sample, which is why the caller floors the result at 1 whenever
 *  the max itself is over the bar. Cost is ~log2(count) native reads, a dozen
 *  for an hour of ticks, and only when a snapshot is captured. */
function samplesAtOrAbove(h: IntervalHistogram, thresholdMs: number): number {
  const total = h.count ?? 0;
  if (total <= 0) return 0;
  if (nsToMs(h.max ?? 0) < thresholdMs) return 0;
  const valueAtRank = (k: number): number =>
    nsToMs(h.percentile(Math.min(100, (100 * k) / total)));
  let lo = 1;
  let hi = total;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (valueAtRank(mid) >= thresholdMs) hi = mid;
    else lo = mid + 1;
  }
  return valueAtRank(lo) >= thresholdMs ? total - lo + 1 : 0;
}

/** How long the loop has actually been WATCHED (ms), derived from the
 *  histogram's own ticks rather than a wall clock.
 *
 *  ON NODE, EACH SAMPLE IS ALREADY THE WHOLE INTERVAL. `monitorEventLoopDelay`
 *  records the time between one firing of its timer and the next — resolution
 *  included, which is why an idle loop reads a mean of ~20ms on a 20ms
 *  resolution rather than ~0. The watched time is therefore the sum of the
 *  samples, `count × mean`, and adding the resolution on top would count every
 *  interval twice: 1.2 real seconds came back as 2.37 through that mistake,
 *  halving every rate divided by it. Bun reports the same field with the
 *  resolution taken OUT, so it needs the opposite correction — see
 *  `observedMsFromHistogram` for both, measured.
 *
 *  Two consequences of deriving it from ticks, both wanted: a container the host
 *  suspended contributes no ticks and therefore no window — the same discount
 *  the worst block already gets — and time the loop spent blocked is still
 *  counted, because a block is exactly what the interval on the next tick
 *  measures. */
function observedMsFromHistogram(h: IntervalHistogram): number {
  const count = h.count ?? 0;
  if (count <= 0) return 0;
  const meanNs = h.mean;
  const meanMs = Number.isFinite(meanNs) && meanNs > 0 ? meanNs / 1e6 : 0;
  // ON BUN THIS HISTOGRAM CANNOT ANSWER, so it says nothing rather than
  // guessing. Node's sample IS the interval, by definition of the field. Bun
  // reports the delay alone, on top of an interval it never reports and does
  // not keep to. Measured here on the same 20ms resolution:
  //
  //                          ticks   mean     count × mean   real time
  //   Node, idle              1960   20.4ms         40.0s       40s
  //   Node, 20k requests      1429   42.0ms         60.0s       60s
  //   Bun,  idle              1938    0.6ms          1.2s       40s
  //   Bun,  20k requests      1451   21.3ms         31.0s       60s
  //   Bun,  the proof rig     1655    1.2ms          1.9s       96s
  //
  // There is no constant relating Bun's two columns to the third: its timer
  // fired every 20.6ms in one run, 41ms in another and 58ms in a third, while
  // the delay it reported moved independently. A resolution floor recovers
  // the idle case and still credits a third of the busy one, which is a
  // guess wearing an answer's clothes. So Bun earns no window at all, and
  // every rate divided by one is withheld instead of published wrong — the
  // same rule the rest of this family follows when a window is short. The
  // counts and the worst block are unaffected; they need no window.
  //
  // What Bun would need is a window taken from a clock rather than from
  // ticks, with the suspend gaps this module already detects subtracted from
  // it. See bunLimits.ts, where the blocked-loop rate is declared.
  if (isBunRuntime()) return 0;
  // A histogram whose mean is unreadable (an edge or bundler shim) still ran
  // its timer, so each tick is worth at least the interval it was scheduled
  // on.
  return Math.round(count * Math.max(meanMs, RESOLUTION_MS));
}

/** Refresh the traffic-time high-water mark: everything the histogram has seen
 *  up to this boundary happened while the app was demonstrably live. */
function markTrafficTime(): void {
  if (!histogram) return;
  try {
    const m = histogram.max ?? 0;
    if (m > trafficMaxNs) trafficMaxNs = m;
  } catch {
    /* an edge/shim histogram without .max simply never gets discounts */
  }
}

/** A request arrived after a suspicious idle gap. If the histogram max GREW
 *  during that gap, the growth is a suspend artifact (the loop was idle; no
 *  user-facing work was stalled): record the discount, carry the clean state
 *  forward, and purge the poisoned samples. */
function handleSuspendWake(): void {
  if (!histogram) return;
  try {
    const curMax = histogram.max ?? 0;
    if (nsToMs(curMax) > nsToMs(trafficMaxNs)) {
      suspendPurges++;
      suspendWorstMs = Math.max(suspendWorstMs, nsToMs(curMax));
      const cleanMaxMs = nsToMs(trafficMaxNs);
      carriedWorstMs = Math.max(carriedWorstMs, cleanMaxMs);
      carriedSamples += histogram.count ?? 0;
      // Freezes carried forward are the ones no worse than the clean
      // traffic-time worst: anything ABOVE that is the growth this purge is
      // attributing to suspend, and counting it would turn one idle gap into a
      // freeze the app never had.
      carriedFreezeCount += Math.max(
        0,
        samplesAtOrAbove(histogram, FREEZE_COUNT_MS) -
          samplesAtOrAbove(histogram, cleanMaxMs + 1),
      );
      // TICKS ONLY for a purged segment. The delay it recorded is dominated by
      // the suspend gap being discarded, and crediting any of it would add time
      // the host had the process stopped to the window a rate is divided by.
      carriedObservedMs += (histogram.count ?? 0) * RESOLUTION_MS;
      histogram.reset();
      trafficMaxNs = 0;
    }
  } catch {
    /* never let discount bookkeeping break the request path */
  }
}

// Module wiring (not data): the sensor fires wake BEFORE the activity refresh,
// so the purge sees the pre-wake traffic mark.
onSuspendWake(handleSuspendWake);
onSuspendActivity(markTrafficTime);
onSuspendIdleStart(markTrafficTime);

/** Start the event-loop-delay histogram. Idempotent, no-op under the
 *  kill-switch. Called from `enableTelemetry`. Never throws — a runtime without
 *  `monitorEventLoopDelay` (an edge/bundler shim) simply gets no axis. */
export function startEventLoopLag(): void {
  if (isBoosthisDisabled() || histogram) return;
  try {
    if (typeof monitorEventLoopDelay !== "function") return;
    const h = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
    h.enable();
    histogram = h;
    histogramStartedMs = Date.now();
    // Settle on time even if nothing reads in between (both boundaries).
    for (const at of [settledFromMs("latencyTail"), settledFromMs("startupEvent")]) {
      const t = setTimeout(() => settleIfDue(), Math.max(0, at - Date.now()) + 5);
      if (typeof (t as { unref?: () => void }).unref === "function") {
        (t as { unref: () => void }).unref();
      }
    }
  } catch {
    histogram = null;
  }
}

/** Read the current lag axis, or null when unavailable / not enough samples
 *  (the snapshot then omits the axis). Pure read — never mutates or resets the
 *  histogram. Never throws. */
export function readEventLoopLag(): EventLoopLagAxis | SettlingLoopAxis | null {
  if (isBoosthisDisabled() || !histogram) return null;
  try {
    settleIfDue();
    const count = (histogram.count ?? 0) + carriedSamples;
    if (!settleResetDone) return count > 0 && isSettling("latencyTail") ? settlingLoop(count) : null;
    if (count < MIN_LAG_SAMPLES) return null;
    const lagP50Ms = nsToMs(histogram.percentile(50));
    const lagP99Ms = nsToMs(histogram.percentile(99));
    const lagMaxMs = Math.max(nsToMs(histogram.max), carriedWorstMs);
    // Score the p99: the tail delay is what users feel as jank, and it is the
    // band the axis thresholds are tuned for. (Post-purge, the percentiles
    // reflect traffic time only — suspend gaps have been discounted.)
    const score = linearScore(lagP99Ms, LAG_GOOD_MS, LAG_POOR_MS);
    const axis: EventLoopLagAxis = {
      score,
      rating: ratingFor(score),
      lagP50Ms,
      lagP99Ms,
      lagMaxMs,
      sampleCount: count,
    };
    markSettled(axis);
    if (suspendPurges > 0) {
      axis.suspendDiscounts = suspendPurges;
      axis.suspendUnit = SUSPEND_UNIT.RECORD_RESETS;
    }
    return axis;
  } catch {
    return null;
  }
}

/** Worst-freeze axis: HOW BAD and HOW OFTEN the event loop stopped answering.
 *  `worstMs` is the longest single block this session (histogram lifetime max
 *  plus the clean worst carried across suspend purges); `freezeCount` /
 *  `freezesPerMin` are how many blocks over FREEZE_COUNT_MS the same histogram
 *  holds, so a process that stalls on a schedule cannot read like one that
 *  hiccupped once. Same warm-up gate as the lag axis so a just-booted process
 *  never scores off one tick. Suspend-attributed idle-gap blocks are reported
 *  via `suspendDiscounts`/`suspendWorstMs` instead of poisoning the score. Pure
 *  read. Never throws. */
export interface WorstFreezeAxis {
  score: number;
  rating: Rating;
  worstMs: number;
  /** Blocks at or above FREEZE_COUNT_MS seen this session. ALWAYS reported: a
   *  short window withholds a projection, never the events themselves. */
  freezeCount: number;
  /** Freezes per minute — withheld (absent) until the observation has earned
   *  the projection, together with the judgement derived from it. */
  freezesPerMin?: number;
  /** How long the loop was actually watched, in minutes, so the rendering edge
   *  can reach the same verdict about the projection that this kit did. */
  windowMin: number;
  sampleCount: number;
  /** Suspend purges applied — present only when > 0 (discount, don't hide). */
  suspendDiscounts?: number;
  /** WHAT one discount is here: a thrown-away record, not a dropped sample.
   *  Published so this axis's 25 and a sibling's 946, over the same window
   *  and the same sensor, can be read as the different units they are. */
  suspendUnit?: number;
  /** Worst idle-gap block attributed to host suspend (ms) — present with
   *  suspendDiscounts so the discounted reading stays visible. */
  suspendWorstMs?: number;
}

export function readWorstFreeze(): WorstFreezeAxis | SettlingLoopAxis | null {
  if (isBoosthisDisabled() || !histogram) return null;
  try {
    settleIfDue();
    const count = (histogram.count ?? 0) + carriedSamples;
    if (!settleResetDone) return count > 0 && isSettling("latencyTail") ? settlingLoop(count) : null;
    if (count < MIN_LAG_SAMPLES) return null;
    const worstMs = Math.max(nsToMs(histogram.max), carriedWorstMs);
    const severity = linearScore(worstMs, FREEZE_GOOD_MS, FREEZE_POOR_MS);

    // How OFTEN, read out of the same histogram. The max IS one of the samples,
    // so a worst block over the bar can never come back as "no freezes" when a
    // bucket boundary rounds the inversion down.
    const freezeCount = Math.max(
      carriedFreezeCount + samplesAtOrAbove(histogram, FREEZE_COUNT_MS),
      worstMs >= FREEZE_COUNT_MS ? 1 : 0,
    );
    const observedMs = carriedObservedMs + observedMsFromHistogram(histogram);
    const freezesPerMin = earnedPerMin(freezeCount, observedMs);

    // ONE verdict, the worse of the two halves (see FREEZE_RATE_* above). Until
    // the window has earned a per-minute projection the score is severity
    // alone: the earned-rate contract withholds the projection AND the
    // judgement derived from it, never the count.
    const score =
      freezesPerMin === null
        ? severity
        : Math.min(
            severity,
            linearScore(
              freezesPerMin,
              FREEZE_RATE_GOOD_PER_MIN,
              FREEZE_RATE_POOR_PER_MIN,
            ),
          );

    const axis: WorstFreezeAxis = {
      score,
      rating: ratingFor(score),
      worstMs,
      freezeCount,
      windowMin: windowMinOf(observedMs),
      sampleCount: count,
    };
    markSettled(axis);
    if (freezesPerMin !== null) axis.freezesPerMin = freezesPerMin;
    if (suspendPurges > 0) {
      axis.suspendDiscounts = suspendPurges;
      axis.suspendUnit = SUSPEND_UNIT.RECORD_RESETS;
      axis.suspendWorstMs = suspendWorstMs;
    }
    return axis;
  } catch {
    return null;
  }
}

export interface BlockingAsyncAxis {
  score: number;
  rating: Rating;
  count: number;
  perMin: number;
  worstMs: number;
  windowMin: number;
}

/** Count late ticks from the event-loop histogram already used above. */
export function readBlockingAsync(): BlockingAsyncAxis | SettlingLoopAxis | null {
  if (isBoosthisDisabled() || !histogram) return null;
  try {
    settleIfDue();
    if (!blockingBase) {
      // "Still settling" promises a rate once the process settles. Bun never
      // earns the watch window that rate divides by (observedMsFromHistogram),
      // so there it says nothing rather than count down to a reading that
      // cannot come; bunLimits.ts declares it instead.
      if (isBunRuntime()) return null;
      const n = (histogram.count ?? 0) + carriedSamples;
      return n > 0 && isSettling("startupEvent") ? settlingLoop(n) : null;
    }
    // Only what the loop did after 120 s: freezes and time up to then are offsets.
    const observedMs = Math.max(
      0,
      carriedObservedMs + observedMsFromHistogram(histogram) - blockingBase.observedMs,
    );
    if (observedMs < BLOCKING_ASYNC_MIN_WINDOW_MS) return null;
    const worstMs = Math.max(nsToMs(histogram.max), carriedWorstMs);
    const count = Math.max(
      0,
      carriedFreezeCount + samplesAtOrAbove(histogram, FREEZE_COUNT_MS) - blockingBase.count,
    );
    const perMin = earnedPerMin(count, observedMs);
    if (perMin === null) return null;
    const score = linearScore(
      perMin,
      BLOCKING_ASYNC_GOOD_PER_MIN,
      BLOCKING_ASYNC_POOR_PER_MIN,
    );
    return markSettled({
      score,
      rating: ratingFor(score),
      count,
      perMin,
      worstMs,
      windowMin: windowMinOf(observedMs),
    });
  } catch {
    return null;
  }
}

/** @internal test hooks. */
export const _lagInternals = {
  MIN_LAG_SAMPLES,
  FREEZE_GOOD_MS,
  FREEZE_POOR_MS,
  FREEZE_COUNT_MS,
  FREEZE_RATE_GOOD_PER_MIN,
  FREEZE_RATE_POOR_PER_MIN,
  RESOLUTION_MS,
  /** Swap in a fake histogram (worstFreeze / lag unit tests). */
  setHistogramForTest(h: IntervalHistogram | null): void {
    histogram = h;
    histogramStartedMs = Date.now();
    settleResetDone = false;
    blockingBase = null;
  },
  /** The two histogram derivations, exposed so a test can drive them against a
   *  REAL `monitorEventLoopDelay` rather than a double that models its own
   *  assumptions back at it. */
  observedMsForTest(h: IntervalHistogram): number {
    return observedMsFromHistogram(h);
  },
  samplesAtOrAboveForTest(h: IntervalHistogram, thresholdMs: number): number {
    return samplesAtOrAbove(h, thresholdMs);
  },
  /** Drive the suspend boundaries directly (no wall-clock games). */
  markTrafficTimeForTest(): void {
    markTrafficTime();
  },
  handleSuspendWakeForTest(): void {
    handleSuspendWake();
  },
  getSuspendStateForTest() {
    return {
      suspendPurges,
      suspendWorstMs,
      carriedWorstMs,
      carriedSamples,
      carriedFreezeCount,
      carriedObservedMs,
    };
  },
};

/** Stop + drop the histogram (wired into `telemetry.forget()` so nothing
 *  Boosthis-shaped keeps sampling after erasure). Idempotent. Never throws. */
export function clearEventLoopLag(): void {
  if (histogram) {
    try {
      histogram.disable();
    } catch {
      /* best-effort — a disabled/edge histogram is not fatal to forget() */
    }
    histogram = null;
  }
  trafficMaxNs = 0;
  carriedWorstMs = 0;
  carriedSamples = 0;
  carriedFreezeCount = 0;
  carriedObservedMs = 0;
  suspendPurges = 0;
  suspendWorstMs = 0;
  settleResetDone = false;
  blockingBase = null;
}

/** @internal test hook. */
export const _eventLoopLagInternals = {
  LAG_GOOD_MS,
  LAG_POOR_MS,
  MIN_LAG_SAMPLES,
  RESOLUTION_MS,
  get isRunning(): boolean {
    return histogram !== null;
  },
  reset(): void {
    clearEventLoopLag();
  },
};
