/* ─── Boosthis: one verdict for every meter that fits a line ─────────────
 *
 * Three readings in this kit estimate "is this number climbing?" by fitting a
 * least-squares line to a short ring of samples and scoring the slope. Each
 * one scored `Math.max(slope, 0)`, and that single expression is the whole
 * defect this module exists to remove:
 *
 *   • It is NOT SYMMETRIC. A downward wobble is clamped to zero and scores a
 *     perfect 100; an equal upward wobble is scored as growth. Symmetric noise
 *     cannot produce a symmetric verdict, so a noisy-but-stable app is marked
 *     down on half its reads and never marked up on the other half. The clamp
 *     puts a step change at exactly the value a stable app sits on.
 *
 *   • It treats the ESTIMATE as the FACT. A slope fitted to twelve scattered
 *     points carries an uncertainty, and the clamp throws it away. +21.5
 *     handles/min from a churn workload and +12.2 handles/min from twenty
 *     deliberately retained timers scored the same way, and the churn — which
 *     retained nothing at all — scored WORSE than the real leak.
 *
 *   • It has no sense of SCALE. A rate is a projection; a rate that has not
 *     actually moved the number by anything worth mentioning is a projection
 *     about a change nobody can see.
 *
 * So the correction is one function, in one place, and every slope-scored
 * meter inherits it:
 *
 *   1. JUDGE THE INTERVAL, NOT THE POINT ESTIMATE. The fit's own residual
 *      scatter gives the slope a standard error, and the verdict is taken from
 *      the interval `slope ± 2·se` rather than from the slope alone. There are
 *      exactly three answers:
 *
 *        • the whole interval sits at or below the healthy rate — nothing to
 *          answer for, score 100;
 *        • the whole interval sits above it — the climb is established, and it
 *          is scored at the LEAST growth the samples support, because a leak
 *          is an accusation and it should be no stronger than the evidence;
 *        • the interval straddles the healthy rate — the samples are
 *          consistent with a quiet app AND with a growing one, so neither
 *          answer is given.
 *
 *      On clean data (a real climb, a real decline, a flat line) the residuals
 *      are small, the interval collapses onto the slope, and the verdict is
 *      exactly what it always was. On scattered data it widens.
 *
 *   2. THE MIDDLE ANSWER IS SYMMETRIC. Mirror a series — every sample v
 *      becomes C − v — and the interval becomes its own negation. An upward
 *      wobble inside the noise and the equal downward wobble therefore reach
 *      the SAME answer, which is the one thing `Math.max(slope, 0)` could
 *      never do. That no-verdict reading is not a zero and not a hundred: the
 *      counts still ship, the score is null, and a code from the closed
 *      vocabulary says why.
 *
 *   3. EXCLUDE THE WARM-UP. A trend measured from the first sample a process
 *      ever took is mostly the process starting: code loading, JIT warm-up,
 *      first allocations. Two processes doing identical work landed in
 *      different bands because one of them loaded its code faster. Samples
 *      inside the warm-up window are dropped before anything is fitted.
 *
 *   4. REQUIRE THE MOVEMENT TO BE WORTH REPORTING. A rate is only allowed to
 *      cost a score once the rise it implies across the judged window clears
 *      an absolute floor in the meter's own unit. This is where the absolute
 *      figure enters the verdict instead of sitting beside it, and it is
 *      asked BEFORE the three answers above: if not even the largest rise the
 *      samples support is worth mentioning, that is an answer, and withholding
 *      a verdict over it would be a worse one.
 *
 *   5. SEPARATE ACCUMULATION FROM LOAD (opt-in). A count that rises and falls
 *      with traffic is not accumulating — the peaks are queue depth, and only
 *      the LOW-WATER MARK is what the process is holding on to. A meter that
 *      asks for it is fitted on the per-bucket minimum instead of the raw
 *      samples, so churn reads flat and retention still reads as a climb.
 *
 * Deliberately NOT here: dividing by the level being measured. A leak that
 * makes RSS grow would make its own denominator grow with it and the score
 * would improve as the app got worse. The level enters as a floor, never as a
 * divisor.
 */

import { linearScore } from "./healthAxes";
import { REASON_TREND_INSIDE_NOISE } from "./axisReasons";
// The earned-rate contract. Nothing here EXTRAPOLATES — a fitted slope is a
// projection of nothing, and the minimum spans below are already far past the
// twelvefold ceiling — but the window these verdicts quote is the same window
// the contract governs, and it is stated through the contract's own helper.
import { windowMinOf } from "./rateHonesty";

export interface TrendPoint {
  readonly t: number;
  readonly v: number;
}

export interface TrendOptions {
  /** At or below this rate, nothing is wrong (score 100). */
  readonly good: number;
  /** At or above this rate, the climb is the whole story (score 0). */
  readonly poor: number;
  /** Samples required AFTER the warm-up exclusion. */
  readonly minSamples: number;
  /** Wall-clock the judged samples must cover, after the warm-up exclusion. */
  readonly minSpanMs: number;
  /** Samples taken within this long of {@link startedAt} are not judged. */
  readonly warmupMs?: number;
  /** When this collector started. Required for the warm-up exclusion. */
  readonly startedAt?: number;
  /**
   * How far the fit must project the number to move, across the judged
   * window, before the rate is allowed to cost anything. In the meter's own
   * unit (MB, handles). Zero disables it.
   */
  readonly riseFloor?: number;
  /**
   * Fit the LOW-WATER MARK instead of the raw samples: the series becomes one
   * point per bucket of this length, each the minimum seen in that bucket.
   * For counts that rise and fall with traffic.
   */
  readonly floorBucketMs?: number;
  /** Buckets required before a floor series may be fitted. */
  readonly minFloorBuckets?: number;
  /** Contract trend mode: abstain when zero is inside ±1 SE and score the
   * fitted slope itself. Used by residentGrowth and memoryStability. */
  readonly abstainAroundZero?: boolean;
}

export interface TrendVerdict {
  /** The fitted slope, per minute. Never clamped — this is the estimate. */
  readonly perMin: number;
  /** The slope at two standard errors above the estimate. */
  readonly upperPerMin: number;
  /** The slope at two standard errors below the estimate. */
  readonly lowerPerMin: number;
  /** Standard error of the fitted slope, in the same unit/min. */
  readonly slopeSePerMin: number;
  /** 0..100, or null when the observation cannot pick a band. */
  readonly score: number | null;
  /** Set exactly when {@link score} is null. */
  readonly reasonCode: number | null;
  /** Raw samples that survived the warm-up exclusion. */
  readonly sampleCount: number;
  /** Wall-clock those samples cover. */
  readonly spanMs: number;
  /** That window in minutes, unrounded. */
  readonly windowMin: number;
  /** Movement the upper bound projects across the judged window. */
  readonly rise: number;
  /** The samples actually judged, for a meter that reports a level too. */
  readonly judged: readonly TrendPoint[];
}

/**
 * How many standard errors above the estimate the verdict is taken at.
 *
 * Two, which at the twelve-plus samples every caller gates on is a one-sided
 * bound somewhere between 95% and 97.5%. Deliberately a plain number rather
 * than a t-table lookup: the point is to stop scoring scatter as signal, not
 * to publish a confidence interval, and a reader can check this arithmetic by
 * hand.
 */
export const NOISE_SIGMAS = 2;

/** Least-squares fit with the scatter left in, or null when there is none to
 *  be had (fewer than three points leaves no degrees of freedom for it). */
function fitLine(
  pts: readonly TrendPoint[],
): { slope: number; stdErr: number } | null {
  const n = pts.length;
  if (n < 3) return null;
  const t0 = pts[0]!.t;
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += (p.t - t0) / 60_000;
    sy += p.v;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = (p.t - t0) / 60_000 - mx;
    sxx += dx * dx;
    sxy += dx * (p.v - my);
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  // Residual scatter about the fitted line. n-2 because the line spent two
  // degrees of freedom on itself.
  let ss = 0;
  for (const p of pts) {
    const x = (p.t - t0) / 60_000;
    const resid = p.v - (my + slope * (x - mx));
    ss += resid * resid;
  }
  const variance = ss / (n - 2);
  const stdErr = variance > 0 ? Math.sqrt(variance / sxx) : 0;
  if (!Number.isFinite(slope) || !Number.isFinite(stdErr)) return null;
  return { slope, stdErr };
}

/**
 * One point per bucket, each the smallest value seen in it, kept at the moment
 * it was seen. Empty buckets are simply absent.
 *
 * The newest bucket is dropped unless the samples reach at least halfway
 * through it. A bucket the collector only watched for an instant has not had
 * the chance to see a trough, so its minimum is just a raw instantaneous
 * sample — the very thing the low-water mark exists to get away from — and it
 * would sit at the end of the series where a least-squares fit gives it the
 * most leverage. The oldest bucket needs no such care: bucket boundaries are
 * measured from the first sample, so it starts full.
 */
function floorSeries(
  pts: readonly TrendPoint[],
  bucketMs: number,
): TrendPoint[] {
  if (bucketMs <= 0) return [...pts];
  const t0 = pts[0]!.t;
  const lowest = new Map<number, TrendPoint>();
  const reachedInto = new Map<number, number>();
  for (const p of pts) {
    const key = Math.floor((p.t - t0) / bucketMs);
    const cur = lowest.get(key);
    if (!cur || p.v < cur.v) lowest.set(key, p);
    reachedInto.set(key, p.t - (t0 + key * bucketMs));
  }
  const keys = [...lowest.keys()].sort((a, b) => a - b);
  const newest = keys[keys.length - 1];
  if (
    newest !== undefined &&
    keys.length > 1 &&
    (reachedInto.get(newest) ?? 0) < bucketMs / 2
  ) {
    lowest.delete(newest);
  }
  return [...lowest.values()].sort((a, b) => a.t - b.t);
}

/** The middle value of a set of samples — what the meter was typically
 *  holding, rather than whatever one arbitrary sample caught. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const spanOf = (pts: readonly TrendPoint[]): number =>
  pts.length < 2 ? 0 : pts[pts.length - 1]!.t - pts[0]!.t;

/**
 * Judge a fitted trend, or null while there is not enough to judge.
 *
 * Null means "still warming" and the caller omits the axis, exactly as it did
 * before. A returned verdict with a null `score` is the other thing: a real
 * reading whose verdict is withheld because the samples cannot tell a climb
 * from ordinary movement. That one ships, with its counts and its reason.
 */
export function judgeTrend(
  points: readonly TrendPoint[],
  opts: TrendOptions,
): TrendVerdict | null {
  const warmupMs = opts.warmupMs ?? 0;
  const startedAt = opts.startedAt ?? 0;
  // A trend measured across a process's own startup is mostly the startup.
  // With no start time to measure from we do not guess one: the exclusion is
  // simply not applied, which is the behaviour that existed before it.
  const judged =
    warmupMs > 0 && startedAt > 0
      ? points.filter((p) => p.t >= startedAt + warmupMs)
      : [...points];
  if (judged.length < opts.minSamples) return null;
  const spanMs = spanOf(judged);
  if (spanMs < opts.minSpanMs) return null;

  let fitPts: readonly TrendPoint[] = judged;
  if (opts.floorBucketMs && opts.floorBucketMs > 0) {
    const floor = floorSeries(judged, opts.floorBucketMs);
    if (floor.length < (opts.minFloorBuckets ?? 6)) return null;
    fitPts = floor;
  }

  const fit = fitLine(fitPts);
  if (!fit) return null;

  // Through the shared helper, never a bare division: a window stated to the
  // whole minute claims an observation we did not make, and the rise below is
  // this window multiplied by a rate.
  const windowMin = windowMinOf(spanMs);
  const upperPerMin = fit.slope + NOISE_SIGMAS * fit.stdErr;
  const lowerPerMin = fit.slope - NOISE_SIGMAS * fit.stdErr;
  const riseFloor = opts.riseFloor ?? 0;

  if (opts.abstainAroundZero) {
    const materialRise = fit.slope * windowMin >= riseFloor;
    // A noise band of zero is not a noise band. A series that sits on one
    // value fits exactly: the standard error is 0, and `|slope| <= stdErr`
    // would abstain on 0 <= 0 — turning the calmest possible process, the one
    // case where flat is certain, into "cannot tell". Abstention needs real
    // scatter to hide the answer in, so it is only reachable once there is
    // some.
    if (fit.stdErr > 0 && Math.abs(fit.slope) <= fit.stdErr) {
      return verdict(fit.slope, upperPerMin, lowerPerMin, null, REASON_TREND_INSIDE_NOISE);
    }
    const score = !materialRise
      ? 100
      : linearScore(fit.slope, opts.good, opts.poor);
    return verdict(fit.slope, upperPerMin, lowerPerMin, score, null);
  }

  // A rate is a projection, and this is where the absolute figure enters the
  // verdict. Taken against the LARGEST rise the samples support: if even that
  // is not movement worth telling someone about, then no reading consistent
  // with this data is, and there is nothing left to be uncertain about. It is
  // asked FIRST for exactly that reason — an immaterial move is an answer, and
  // withholding a verdict over it would be a worse one.
  if (riseFloor > 0 && upperPerMin * windowMin < riseFloor) {
    return verdict(fit.slope, upperPerMin, lowerPerMin, 100, null);
  }

  // Nothing the samples support is worse than the healthy rate. Includes every
  // decline, every flat line, and every wobble small enough to be nothing.
  if (upperPerMin <= opts.good) {
    return verdict(fit.slope, upperPerMin, lowerPerMin, 100, null);
  }

  // Everything the samples support is worse than the healthy rate, so the
  // climb is established. Scored at the LEAST growth they support: an
  // accusation should be no stronger than its evidence, and on clean data the
  // bound IS the slope, so a real leak still reads exactly as it did.
  if (lowerPerMin >= opts.good) {
    const rise = lowerPerMin * windowMin;
    const score =
      riseFloor > 0 && rise < riseFloor
        ? 100
        : linearScore(lowerPerMin, opts.good, opts.poor);
    return verdict(fit.slope, upperPerMin, lowerPerMin, score, null);
  }

  // Neither: the samples are consistent with a quiet app AND with a growing
  // one. This is where ordinary fluctuation lands, in BOTH directions — mirror
  // the series and it reaches this same branch — and no verdict is given.
  return verdict(
    fit.slope,
    upperPerMin,
    lowerPerMin,
    null,
    REASON_TREND_INSIDE_NOISE,
  );

  function verdict(
    perMin: number,
    upper: number,
    lower: number,
    score: number | null,
    reasonCode: number | null,
  ): TrendVerdict {
    return {
      perMin,
      upperPerMin: upper,
      lowerPerMin: lower,
      slopeSePerMin: fit!.stdErr,
      score,
      reasonCode,
      sampleCount: judged.length,
      spanMs,
      windowMin,
      // The movement the verdict was taken against: what was established when
      // there is a climb, the most the data allows when there is not.
      rise: (score !== null && lower >= opts.good ? lower : upper) * windowMin,
      judged,
    };
  }
}

export const _trendVerdictInternals = {
  fitLine,
  floorSeries,
  spanOf,
};
