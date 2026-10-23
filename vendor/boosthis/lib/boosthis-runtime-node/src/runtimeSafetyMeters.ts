/* Additive Node readings for uncaught errors and outstanding JS timers.
 * Neither reading participates in the Speed score. */
import { linearScore, ratingFor } from "./healthAxes";
import { REASON_BLOCKED_BY_ENVIRONMENT } from "./axisReasons";
import { windowMinOf } from "./rateHonesty";
import { isSettling, markSettled, settledFromMs, settlingReading } from "./settleRule";
import type { ExtraAxis } from "./extraMeters";

const ERROR_GOOD_PER_HOUR = 0;
const ERROR_POOR_PER_HOUR = 5;
const MIN_ERROR_WINDOW_MS = 5 * 60_000;
const TIMER_GOOD_PER_MIN = 1;
const TIMER_POOR_PER_MIN = 30;
const MIN_TIMER_SAMPLES = 12;
const MIN_TIMER_SPAN_MS = 60_000;
const SAMPLE_EVERY_MS = 5_000;
const RING_CAP = 240;

type TimerCallback = (...args: unknown[]) => void;
type SetTimer = (callback: TimerCallback, delay?: number, ...args: unknown[]) => unknown;
type SetImmediateTimer = (callback: TimerCallback, ...args: unknown[]) => unknown;
type ClearTimer = (handle?: unknown) => void;
type Sample = { t: number; count: number };

let startedAt = 0;
let errorCount = 0;
let errorInstalled = false;
let errorInstallFailed = false;
let errorMonitor: ((error: Error, origin: string) => void) | null = null;

let timersInstalled = false;
let outstanding = 0;
let unwatchedTimers = 1; // Node's native-addon timer surface is not wrappable.
let sampler: unknown = null;
const samples: Sample[] = [];
const timeoutHandles = new Set<unknown>();
const intervalHandles = new Set<unknown>();
const immediateHandles = new Set<unknown>();

let origSetTimeout: SetTimer | null = null;
let origSetInterval: SetTimer | null = null;
let origSetImmediate: SetImmediateTimer | null = null;
let origClearTimeout: ClearTimer | null = null;
let origClearInterval: ClearTimer | null = null;
let origClearImmediate: ClearTimer | null = null;
let wrappedSetTimeout: SetTimer | null = null;
let wrappedSetInterval: SetTimer | null = null;
let wrappedSetImmediate: SetImmediateTimer | null = null;
let wrappedClearTimeout: ClearTimer | null = null;
let wrappedClearInterval: ClearTimer | null = null;
let wrappedClearImmediate: ClearTimer | null = null;

function r1(value: number): number {
  return Math.round(value * 10) / 10;
}

function sample(now = Date.now()): void {
  if (!timersInstalled) return;
  samples.push({ t: now, count: outstanding });
  if (samples.length > RING_CAP) samples.shift();
}

function dec(set: Set<unknown>, handle: unknown): void {
  try {
    if (set.delete(handle) && outstanding > 0) outstanding--;
  } catch {
    /* bookkeeping must never disturb a host timer */
  }
}

function countPreexistingTimers(): number {
  try {
    const handles = (process as unknown as { _getActiveHandles?: () => unknown[] })
      ._getActiveHandles?.() ?? [];
    return handles.filter((handle) => {
      const name = (handle as { constructor?: { name?: string } })?.constructor?.name;
      return name === "Timeout" || name === "Immediate" || name === "Timer";
    }).length;
  } catch {
    return 0;
  }
}

export function startRuntimeSafetyMeters(): void {
  if (startedAt > 0) return;
  startedAt = Date.now();

  // uncaughtExceptionMonitor observes the same last-resort event without
  // changing Node's fatal default and without replacing or bypassing any host
  // uncaughtException handler.
  try {
    errorMonitor = () => {
      try {
        errorCount++;
      } catch {
        /* the host's fatal path must remain untouched */
      }
    };
    process.on("uncaughtExceptionMonitor", errorMonitor);
    errorInstalled = true;
  } catch {
    errorMonitor = null;
    errorInstallFailed = true;
  }

  try {
    const g = globalThis as unknown as {
      setTimeout?: SetTimer;
      setInterval?: SetTimer;
      setImmediate?: SetImmediateTimer;
      clearTimeout?: ClearTimer;
      clearInterval?: ClearTimer;
      clearImmediate?: ClearTimer;
    };
    if (
      typeof g.setTimeout !== "function" ||
      typeof g.setInterval !== "function" ||
      typeof g.setImmediate !== "function" ||
      typeof g.clearTimeout !== "function" ||
      typeof g.clearInterval !== "function" ||
      typeof g.clearImmediate !== "function"
    ) return;

    origSetTimeout = g.setTimeout;
    origSetInterval = g.setInterval;
    origSetImmediate = g.setImmediate;
    origClearTimeout = g.clearTimeout;
    origClearInterval = g.clearInterval;
    origClearImmediate = g.clearImmediate;
    unwatchedTimers = 1 + countPreexistingTimers();

    wrappedSetTimeout = function (callback, delay, ...args) {
      let handle: unknown;
      const wrapped = function (this: unknown, ...callbackArgs: unknown[]): void {
        dec(timeoutHandles, handle);
        return callback.apply(this, callbackArgs);
      };
      handle = (origSetTimeout as SetTimer)(wrapped, delay, ...args);
      try {
        timeoutHandles.add(handle);
        outstanding++;
      } catch { /* best-effort */ }
      return handle;
    };
    wrappedSetInterval = function (callback, delay, ...args) {
      const handle = (origSetInterval as SetTimer)(callback, delay, ...args);
      try {
        intervalHandles.add(handle);
        outstanding++;
      } catch { /* best-effort */ }
      return handle;
    };
    wrappedSetImmediate = function (callback, ...args) {
      let handle: unknown;
      const wrapped = function (this: unknown, ...callbackArgs: unknown[]): void {
        dec(immediateHandles, handle);
        return callback.apply(this, callbackArgs);
      };
      handle = (origSetImmediate as SetImmediateTimer)(wrapped, ...args);
      try {
        immediateHandles.add(handle);
        outstanding++;
      } catch { /* best-effort */ }
      return handle;
    };
    wrappedClearTimeout = (handle) => {
      dec(timeoutHandles, handle);
      // Node deliberately permits clearTimeout/clearInterval to be used
      // interchangeably; mirror that behaviour in the bookkeeping too.
      dec(intervalHandles, handle);
      (origClearTimeout as ClearTimer)(handle);
    };
    wrappedClearInterval = (handle) => {
      dec(intervalHandles, handle);
      dec(timeoutHandles, handle);
      (origClearInterval as ClearTimer)(handle);
    };
    wrappedClearImmediate = (handle) => {
      dec(immediateHandles, handle);
      (origClearImmediate as ClearTimer)(handle);
    };
    g.setTimeout = wrappedSetTimeout;
    g.setInterval = wrappedSetInterval;
    g.setImmediate = wrappedSetImmediate;
    g.clearTimeout = wrappedClearTimeout;
    g.clearInterval = wrappedClearInterval;
    g.clearImmediate = wrappedClearImmediate;
    timersInstalled = true;
    sample();
    // Use the captured original so the meter never counts its own sampler.
    sampler = origSetInterval(() => sample(), SAMPLE_EVERY_MS);
    (sampler as { unref?: () => void })?.unref?.();
  } catch {
    clearTimerTracking();
  }
}

export function readUnhandledErrors(now = Date.now()): ExtraAxis {
  const windowMs = Math.max(0, now - startedAt);
  const windowMin = windowMinOf(windowMs);
  if (!errorInstalled) {
    const unavailable: ExtraAxis = {
      score: null, rating: "pending", count: null, windowMin, perHour: null,
    };
    if (errorInstallFailed) {
      unavailable.measurable = 0;
      unavailable.reasonCode = REASON_BLOCKED_BY_ENVIRONMENT;
    }
    return unavailable;
  }
  if (windowMs < MIN_ERROR_WINDOW_MS) {
    return {
      score: null,
      rating: "pending",
      count: errorCount === 0 ? null : errorCount,
      windowMin,
      perHour: null,
    };
  }
  const perHour = r1(errorCount / (windowMs / 3_600_000));
  const score = linearScore(perHour, ERROR_GOOD_PER_HOUR, ERROR_POOR_PER_HOUR);
  return { score, rating: ratingFor(score), count: errorCount, windowMin, perHour };
}

function slopePerMin(points: readonly Sample[]): number {
  const n = points.length;
  const t0 = points[0].t;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const point of points) {
    const x = (point.t - t0) / 60_000;
    sx += x;
    sy += point.count;
    sxx += x * x;
    sxy += x * point.count;
  }
  const denominator = n * sxx - sx * sx;
  return denominator === 0 ? 0 : (n * sxy - sx * sy) / denominator;
}

/** The slowest third's growth: the settled window cut into three equal spans
 *  of time, each fitted on its own, and the smallest slope kept. A trend
 *  counts only when every third shows it, so one batch of timers armed at
 *  the start of the window is not growth. A third with fewer than two
 *  samples shows nothing (0). */
function everyThirdSlopePerMin(points: readonly Sample[]): number {
  const t0 = points[0].t;
  const span = points[points.length - 1].t - t0;
  let slowest = Infinity;
  for (let k = 0; k < 3; k++) {
    const lo = t0 + (span * k) / 3;
    const hi = t0 + (span * (k + 1)) / 3;
    const slice = points.filter((p) => p.t >= lo && (k === 2 ? p.t <= hi : p.t < hi));
    slowest = Math.min(slowest, slice.length < 2 ? 0 : slopePerMin(slice));
  }
  return slowest;
}

/** The start-up rule (startupEvent): the timers a process arms while it boots
 *  (pools, caches, schedulers) are ordinary set-up, not a leak. The trend is
 *  taken over the samples after settling only, needs 12 of them over 60 s, and
 *  is the every-third growth above. While the process settles the reading says
 *  so (pending, marked); a graded reading carries the marker. */
export function readTimerHealth(): ExtraAxis {
  const now = Date.now();
  const from = settledFromMs("startupEvent");
  const settled = samples.filter((s) => s.t >= from);
  if (
    !timersInstalled ||
    settled.length < MIN_TIMER_SAMPLES ||
    settled[settled.length - 1].t - settled[0].t < MIN_TIMER_SPAN_MS
  ) {
    const pending: ExtraAxis = {
      score: null,
      rating: "pending",
      timers: null,
      growthPerMin: null,
      sampleCount: settled.length,
      unwatchedTimers,
    };
    return timersInstalled && isSettling("startupEvent", now) ? settlingReading(pending) : pending;
  }
  // `|| 0`: a flat count fits to -0 in a third (Math.min keeps -0 below 0).
  const growthPerMin = r1(everyThirdSlopePerMin(settled)) || 0;
  const score = linearScore(
    Math.max(0, growthPerMin),
    TIMER_GOOD_PER_MIN,
    TIMER_POOR_PER_MIN,
  );
  return markSettled({
    score,
    rating: ratingFor(score),
    timers: settled[settled.length - 1].count,
    growthPerMin,
    sampleCount: settled.length,
    unwatchedTimers,
  });
}

function clearTimerTracking(): void {
  try {
    if (sampler != null && origClearInterval) origClearInterval(sampler);
    const g = globalThis as unknown as Record<string, unknown>;
    if (g.setTimeout === wrappedSetTimeout && origSetTimeout) g.setTimeout = origSetTimeout;
    if (g.setInterval === wrappedSetInterval && origSetInterval) g.setInterval = origSetInterval;
    if (g.setImmediate === wrappedSetImmediate && origSetImmediate) g.setImmediate = origSetImmediate;
    if (g.clearTimeout === wrappedClearTimeout && origClearTimeout) g.clearTimeout = origClearTimeout;
    if (g.clearInterval === wrappedClearInterval && origClearInterval) g.clearInterval = origClearInterval;
    if (g.clearImmediate === wrappedClearImmediate && origClearImmediate) g.clearImmediate = origClearImmediate;
  } catch { /* best-effort */ }
  timersInstalled = false;
  sampler = null;
  outstanding = 0;
  samples.length = 0;
  timeoutHandles.clear();
  intervalHandles.clear();
  immediateHandles.clear();
}

export function clearRuntimeSafetyMeters(): void {
  try {
    if (errorMonitor) process.removeListener("uncaughtExceptionMonitor", errorMonitor);
  } catch { /* best-effort */ }
  errorMonitor = null;
  errorInstalled = false;
  errorInstallFailed = false;
  errorCount = 0;
  clearTimerTracking();
  startedAt = 0;
}

export const _runtimeSafetyInternals = {
  MIN_ERROR_WINDOW_MS,
  MIN_TIMER_SAMPLES,
  MIN_TIMER_SPAN_MS,
  forceStartedAt(value: number): void { startedAt = value; },
  setErrorInstalled(value: boolean): void { errorInstalled = value; },
  addErrors(value: number): void { errorCount += value; },
  setTimersInstalled(value: boolean): void { timersInstalled = value; },
  pushTimerSample(t: number, count: number): void { samples.push({ t, count }); },
};