/**
 * The start-up rule, kit side (docs/settle-rule-contract.md).
 *
 * A process that has just started is not the app: its first request finds
 * cold caches, its heap steps up once while modules load, its collector
 * bursts through the start-up promotions and the traffic that waited for it
 * lands at once. Every time-dependent meter in this kit is judged through
 * this one module, so peaks, slopes, rates and tails are all taken after the
 * process has settled, and every fixed reading carries the closed marker
 * `settleRule: 1`.
 *
 * The numbers are the contract's table, held to the server's
 * `SETTLE_FAMILIES` by this kit's own test (settleRule.test.ts reads the
 * contract document), so they cannot drift apart silently.
 *
 * A reading that cannot be judged yet says so with `rating: "pending"` and no
 * score. The server — never the kit — turns that into "still settling" while
 * the process is younger than the family's settle period, using the
 * snapshot's own `startedAt` and `capturedAt`.
 */

/** The marker a fixed reading carries: this contract, version 1. */
export const SETTLE_RULE = 1 as const;

export type SettleFamily =
  | "latencyTail"
  | "growthSlope"
  | "peakRate"
  | "perRequestMemory"
  | "startupEvent";

export interface SettleFamilySpec {
  /** Nothing from the first this-many seconds of the process is judged. */
  settleSec: number;
  /** The shortest settled span a rate, peak or slope may be judged over. */
  minSpanSec: number;
  /** The first this-many requests carry set-up and are not judged. For a
   *  latency tail it is the first request of EACH route (or other key). */
  skipFirstRequests: number;
  /** The fewest settled samples a verdict may rest on. */
  minSamples: number;
}

export const SETTLE_FAMILIES: Readonly<Record<SettleFamily, SettleFamilySpec>> = {
  latencyTail: { settleSec: 60, minSpanSec: 0, skipFirstRequests: 1, minSamples: 20 },
  growthSlope: { settleSec: 600, minSpanSec: 600, skipFirstRequests: 0, minSamples: 3 },
  peakRate: { settleSec: 60, minSpanSec: 300, skipFirstRequests: 0, minSamples: 2 },
  perRequestMemory: { settleSec: 60, minSpanSec: 0, skipFirstRequests: 20, minSamples: 20 },
  startupEvent: { settleSec: 120, minSpanSec: 0, skipFirstRequests: 0, minSamples: 1 },
};

// ── The process clock ───────────────────────────────────────────────────────
// The same origin the snapshot's `startedAt` uses (Date.now() − uptime), so
// the age a meter judges by and the age the server reads agree.
const LOADED_START_MS = Date.now() - Math.round(process.uptime() * 1000);
let startOverrideMs: number | null = null;

/** When this process started, epoch milliseconds. */
export function processStartMs(): number {
  return startOverrideMs ?? LOADED_START_MS;
}

/** Test seam: pin the process start (null restores the real one). */
export function __setProcessStartForTests(ms: number | null): void {
  startOverrideMs = ms;
}

/** How long this process has been running, milliseconds (never negative). */
export function processAgeMs(nowMs: number = Date.now()): number {
  return Math.max(0, nowMs - processStartMs());
}

/** The first instant whose samples a family judges (epoch ms). */
export function settledFromMs(family: SettleFamily): number {
  return processStartMs() + SETTLE_FAMILIES[family].settleSec * 1000;
}

/** Is the process still inside the family's settle period? */
export function isSettling(family: SettleFamily, nowMs: number = Date.now()): boolean {
  return processAgeMs(nowMs) < SETTLE_FAMILIES[family].settleSec * 1000;
}

/** Was a sample stamped at `tMs` (epoch ms) taken after settling? */
export function isSettledAt(family: SettleFamily, tMs: number): boolean {
  return tMs >= settledFromMs(family);
}

/** A reading that cannot be graded yet: pending, no score, marked. */
export function settlingReading<T extends Record<string, unknown>>(
  extra?: T,
): T & { rating: "pending"; settleRule: typeof SETTLE_RULE } {
  return { ...(extra ?? ({} as T)), rating: "pending", settleRule: SETTLE_RULE };
}

/** Stamp a reading as judged under this contract. */
export function markSettled<T extends object>(reading: T): T & { settleRule: typeof SETTLE_RULE } {
  return Object.assign(reading, { settleRule: SETTLE_RULE });
}

// ── Tails ───────────────────────────────────────────────────────────────────

export interface TimedSample {
  /** Epoch milliseconds the sample was taken. */
  t: number;
  /** The measured value. */
  v: number;
  /** The route, host, tool or other key whose FIRST sample carries set-up. */
  key?: string;
}

/**
 * The samples a tail may judge: nothing from the settle period, and never the
 * first sample of a key (its first request pays the cold path wherever it
 * falls). Returns values in time order.
 */
export function settledTailValues(
  samples: readonly TimedSample[],
  family: SettleFamily = "latencyTail",
): number[] {
  const from = settledFromMs(family);
  const skip = SETTLE_FAMILIES[family].skipFirstRequests;
  const seen = new Map<string, number>();
  const ordered = [...samples].sort((a, b) => a.t - b.t);
  const out: number[] = [];
  for (const s of ordered) {
    if (!Number.isFinite(s.v)) continue;
    const key = s.key ?? "";
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n < skip) continue;
    if (s.t < from) continue;
    out.push(s.v);
  }
  return out;
}

/** Nearest-rank percentile of an unsorted list (null when empty). */
export function percentileOf(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/**
 * A settled tail: the percentile of the settled samples, or null while fewer
 * than the family's floor exist. Below 100 samples a p99 IS the slowest
 * sample, which is why the floor and the exclusions both matter.
 */
export function settledTail(
  samples: readonly TimedSample[],
  p: number,
  family: SettleFamily = "latencyTail",
): { value: number; n: number } | null {
  const values = settledTailValues(samples, family);
  if (values.length < SETTLE_FAMILIES[family].minSamples) return null;
  const value = percentileOf(values, p);
  return value === null ? null : { value, n: values.length };
}

// ── Rates and peaks ─────────────────────────────────────────────────────────

/** The settled span between a window's start and now, milliseconds. */
export function settledSpanMs(
  windowStartMs: number,
  nowMs: number = Date.now(),
  family: SettleFamily = "peakRate",
): number {
  return Math.max(0, nowMs - Math.max(windowStartMs, settledFromMs(family)));
}

/** May a rate or peak be judged over this settled span? */
export function spanJudgeable(spanMs: number, family: SettleFamily = "peakRate"): boolean {
  return spanMs >= SETTLE_FAMILIES[family].minSpanSec * 1000;
}

/**
 * Events per minute over the settled part of [windowStart, now], or null when
 * the settled span is shorter than the family's minimum.
 */
export function settledRatePerMin(
  eventTimesMs: readonly number[],
  windowStartMs: number,
  nowMs: number = Date.now(),
  family: SettleFamily = "peakRate",
): { perMin: number; events: number; spanMs: number } | null {
  const from = Math.max(windowStartMs, settledFromMs(family));
  const spanMs = Math.max(0, nowMs - from);
  if (!spanJudgeable(spanMs, family)) return null;
  let events = 0;
  for (const t of eventTimesMs) if (t >= from && t <= nowMs) events++;
  return { perMin: events / (spanMs / 60_000), events, spanMs };
}

// ── Slopes ──────────────────────────────────────────────────────────────────

export interface SlopeFit {
  /** Fitted growth per minute. */
  slopePerMin: number;
  /** Standard error of that slope (0 when the fit is exact). */
  slopeStdErr: number;
  n: number;
  spanMs: number;
}

/**
 * A least-squares slope over the samples taken after the family settled,
 * spanning at least its minimum span and resting on at least its floor —
 * never a single boot step projected into a rate. Null until then.
 */
export function settledSlope(
  points: readonly TimedSample[],
  family: SettleFamily = "growthSlope",
): SlopeFit | null {
  const from = settledFromMs(family);
  const pts = points.filter((p) => p.t >= from && Number.isFinite(p.v));
  const spec = SETTLE_FAMILIES[family];
  if (pts.length < spec.minSamples) return null;
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const p of pts) {
    if (p.t < tMin) tMin = p.t;
    if (p.t > tMax) tMax = p.t;
  }
  const spanMs = tMax - tMin;
  if (spanMs < spec.minSpanSec * 1000 || spanMs <= 0) return null;
  const n = pts.length;
  const xs = pts.map((p) => (p.t - tMin) / 60_000);
  const ys = pts.map((p) => p.v);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx <= 0) return null;
  const slope = sxy / sxx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - (my + slope * (xs[i] - mx))) ** 2;
  const se = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : 0;
  return { slopePerMin: slope, slopeStdErr: se, n, spanMs };
}

/**
 * The growth a slope verdict may act on: the part of the fitted slope that
 * stands clear of its own noise (slope − 2·se), never below zero.
 */
export function persistentGrowthPerMin(fit: SlopeFit): number {
  return Math.max(0, fit.slopePerMin - 2 * fit.slopeStdErr);
}
