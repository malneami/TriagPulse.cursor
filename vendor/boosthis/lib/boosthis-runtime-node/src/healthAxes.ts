/** Additive dashboard meters derived from live, privacy-safe perf state.
 *
 * Two read-only gauges shown on the Node dashboard:
 *   - Code Health — how much rule pressure the running app is under right now
 *     (poor/needs-work routes, budget regressions, distinct live finding kinds).
 *   - Resilience  — how stable latency is under load (tail blowup p99/p50,
 *     poor-sample rate, and budget-regression pressure).
 *
 * IMPORTANT: these axes are ADDITIVE. They are computed from the same
 * in-process summary + budget state the dashboard already shows, and they
 * NEVER feed the composite Speed score (TTFF/TTI/FID) — see thresholds.ts.
 * They carry only counts, ratios, scores, and rating buckets; no route names,
 * timings, source, or values are added to any transmit path. Mirrored by
 * `lib/boosthis-py/boosthis/health_axes.py` (keep the two in sync).
 */

import {
  readResilienceTail,
  RESILIENCE_MIN_MEDIAN_MS,
  RESILIENCE_MIN_TAIL_SAMPLES,
  RESILIENCE_TAIL_FLOOR_MS,
  type Rating,
  type NoScoreRating,
} from "./thresholds";
import type { Summary } from "./samples";
import { SETTLE_FAMILIES, SETTLE_RULE } from "./settleRule";
import { isJudgedBudget, type BudgetStatus } from "./budgets";

export type AxisRating = Rating | NoScoreRating;

export interface AxisSummary {
  key: string;
  label: string;
  /** 0..100, or null while pending (fewer than MIN_SAMPLES_FOR_AXES samples). */
  score: number | null;
  rating: AxisRating;
  caption: string;
  /** Judged under the start-up rule (settleRule.ts): settled samples only. */
  settleRule?: typeof SETTLE_RULE;
}

export interface DashboardAxes {
  codeHealth: AxisSummary;
  resilience: AxisSummary;
}

/** Below this sample count both meters report "pending" (null score) rather
 *  than a misleading 100 or 0 computed from one or two requests. */
export const MIN_SAMPLES_FOR_AXES = 5;

/** Code Health and Resilience judge the SETTLED summary (samples.settledSummary:
 *  never the first minute, never a route's first request) and wait for the
 *  start-up rule's floor of settled samples. */
export const SETTLED_FLOOR = SETTLE_FAMILIES.latencyTail.minSamples;

/** Map a 0..100 score onto the shared rating bands (good >= 85, needs-work >= 60). */
export function ratingFor(score: number): Rating {
  if (score >= 85) return "good";
  if (score >= 60) return "needs-work";
  return "poor";
}

/**
 * An axis band whose two constants are the wrong way round.
 *
 * A band is a pair of CONSTANTS in our own source: `good` is the value at or
 * below which a reading scores 100, `poor` the value at or above which it
 * scores 0. `good` below `poor` is not a convention, it is what makes the
 * interpolation mean anything, so a pair that is equal or reversed is a typo
 * in the kit — never something a customer's app did.
 *
 * This used to answer 100. A meter wired backwards therefore reported perfect
 * health on every install for ever, and nothing anywhere complained: the one
 * defect the scoring helper could produce by itself was also the one it was
 * guaranteed to hide. It refuses now, in every runtime, with the same words.
 *
 * The throw is the BACKSTOP, not the guard. scripts' axis-band-inversion gate
 * reads the declared constants out of every shipped kit and fails the release
 * before an inverted pair can reach anybody.
 */
export class InvertedAxisBandError extends Error {
  readonly good: number;
  readonly poor: number;
  constructor(good: number, poor: number) {
    super(`${INVERTED_BAND_MESSAGE} (good=${good}, poor=${poor})`);
    this.name = "InvertedAxisBandError";
    this.good = good;
    this.poor = poor;
  }
}

/** The leading words every runtime uses when it refuses an inverted band, so
 *  the same mistake is recognisable whichever kit reported it. */
export const INVERTED_BAND_MESSAGE =
  "boosthis: inverted axis band, good must be below poor";

/** Linear 0..100 score for a "lower is better" metric: `good` (or below) -> 100,
 *  `poor` (or above) -> 0, linear in between. `good` must be < `poor`; a
 *  misconfigured band (poor <= good, or either end not a finite number)
 *  REFUSES — see {@link InvertedAxisBandError}. */
export function linearScore(value: number, good: number, poor: number): number {
  if (!Number.isFinite(good) || !Number.isFinite(poor) || poor <= good) {
    throw new InvertedAxisBandError(good, poor);
  }
  if (value <= good) return 100;
  if (value >= poor) return 0;
  return Math.round((100 * (poor - value)) / (poor - good));
}

function clamp(n: number): number {
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

interface FindingLike {
  kind: string;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Code Health — rule pressure right now. Starts at 100 and subtracts capped
 * penalties for: poor/needs-work routes, budget regressions, and the number of
 * distinct live finding kinds the runtime is currently surfacing.
 */
export function computeCodeHealth(
  sum: Summary,
  regressions: BudgetStatus[],
  findings: FindingLike[],
): AxisSummary {
  if (sum.total < SETTLED_FLOOR) {
    return {
      key: "codeHealth",
      label: "Code Health",
      score: null,
      rating: "pending",
      caption: `Need ${SETTLED_FLOOR} settled samples — ${sum.total} so far.`,
      settleRule: SETTLE_RULE,
    };
  }
  let poorRoutes = 0;
  let needsWorkRoutes = 0;
  for (const r of Object.values(sum.byRoute)) {
    if (r.worst_rating === "poor") poorRoutes++;
    else if (r.worst_rating === "needs-work") needsWorkRoutes++;
  }
  const regressedRoutes = regressions.length;
  const distinctKinds = new Set(findings.map((f) => f.kind)).size;

  const penaltyRoutes = Math.min(45, poorRoutes * 12 + needsWorkRoutes * 6);
  const penaltyRegress = Math.min(30, regressedRoutes * 15);
  const penaltyKinds = Math.min(25, distinctKinds * 10);
  const score = clamp(100 - penaltyRoutes - penaltyRegress - penaltyKinds);

  return {
    key: "codeHealth",
    label: "Code Health",
    score,
    rating: ratingFor(score),
    caption:
      `${plural(findings.length, "live rule signal")} · ` +
      `${plural(poorRoutes, "poor route")} · ` +
      `${plural(regressedRoutes, "regression")}`,
    settleRule: SETTLE_RULE,
  };
}

/**
 * Resilience — how stable latency is under load. Weighted blend of:
 *   - tail blowup p99/p50 (good <= 3x, poor >= 8x)        weight 0.40
 *   - poor-sample rate poor/total (good <= 5%, poor >= 25%) weight 0.35
 *   - regression pressure regressed/budgeted routes        weight 0.25
 *     (good = 0, poor >= 25%; scored 100 while every route is still learning).
 */
export function computeResilience(
  sum: Summary,
  allBudgets: BudgetStatus[],
  regressions: BudgetStatus[],
): AxisSummary {
  if (sum.total < SETTLED_FLOOR) {
    return {
      key: "resilience",
      label: "Resilience",
      score: null,
      rating: "pending",
      caption: `Need ${SETTLED_FLOOR} settled samples — ${sum.total} so far.`,
      settleRule: SETTLE_RULE,
    };
  }

  // The tail term follows the cross-kit contract in thresholds.ts: an
  // absolute floor below which no ratio is worth acting on, a sample floor
  // below which no p99 is published, and an honest abstention when the median
  // is smaller than the capture resolution. See RESILIENCE_TAIL_FLOOR_MS.
  const tail = readResilienceTail(sum.p50_ms, sum.p99_ms, sum.total);
  if (tail.state === "insufficient") {
    return {
      key: "resilience",
      label: "Resilience",
      score: null,
      rating: "pending",
      caption: `Need ${RESILIENCE_MIN_TAIL_SAMPLES} settled samples for a tail — ${sum.total} so far.`,
      settleRule: SETTLE_RULE,
    };
  }
  if (tail.state === "unmeasurable") {
    // The tail is the dominant term. Rescoring the axis on the other two
    // would publish a verdict most of whose weight was never measured, so the
    // whole axis withholds instead.
    return {
      key: "resilience",
      label: "Resilience",
      score: null,
      rating: "pending",
      caption:
        `Tail not judged — median under ${RESILIENCE_MIN_MEDIAN_MS}ms, ` +
        `too small to measure a p99/p50 ratio against (p99 ${sum.p99_ms}ms).`,
      settleRule: SETTLE_RULE,
    };
  }
  const tailRatio = tail.ratio;
  const tailScore = tail.state === "flat" ? 100 : linearScore(tail.ratio, 3, 8);

  const poorRate = sum.total > 0 ? sum.poor / sum.total : 0;
  const poorRateScore = linearScore(poorRate, 0.05, 0.25);

  // Only a route that reached a verdict carries a budget. A route still
  // learning has no baseline yet, and one whose history the shared ring
  // evicted never will on its own — counting either would make a fresh app
  // look perfectly resilient or unfairly penalized before anything was
  // measured.
  const routesWithBudgets = allBudgets.filter(isJudgedBudget).length;

  // WHEN NOTHING CARRIES A BUDGET THE TERM WITHDRAWS — it is not scored 100.
  // A full mark awarded because nothing could be computed is the fabricated
  // all-clear the four-state rule forbids everywhere else in the product: it
  // lifted the axis by up to 25 points on every app whose routes were all
  // still learning. The two measured terms are renormalized over their own
  // weight instead, and the caption says the third was not judged.
  const terms: Array<{ weight: number; score: number }> = [
    { weight: 0.4, score: tailScore },
    { weight: 0.35, score: poorRateScore },
  ];
  let regressionCaption: string;
  if (routesWithBudgets > 0) {
    const regressionRatio = regressions.length / routesWithBudgets;
    terms.push({ weight: 0.25, score: linearScore(regressionRatio, 0, 0.25) });
    regressionCaption = `${plural(regressions.length, "regression")} of ${routesWithBudgets} budgeted`;
  } else {
    regressionCaption = "regressions not judged — no route carries a baseline";
  }
  const weight = terms.reduce((acc, t) => acc + t.weight, 0);
  const score = clamp(
    terms.reduce((acc, t) => acc + t.weight * t.score, 0) / weight,
  );

  return {
    key: "resilience",
    label: "Resilience",
    score,
    rating: ratingFor(score),
    caption:
      `${
        tail.state === "flat"
          ? `tail ${sum.p99_ms}ms — every request under ${RESILIENCE_TAIL_FLOOR_MS}ms`
          : `tail p99/p50 ${tailRatio!.toFixed(1)}×`
      } · ` +
      `${Math.round(poorRate * 100)}% poor · ` +
      regressionCaption,
    settleRule: SETTLE_RULE,
  };
}

/** Build both dashboard axes from already-fetched live state. The caller passes
 *  in the summary, all budget statuses, the regressed subset, and the live
 *  finding list (from reporting.collectFindings) so nothing is recomputed here. */
export function computeDashboardAxes(
  sum: Summary,
  allBudgets: BudgetStatus[],
  regressions: BudgetStatus[],
  findings: FindingLike[],
): DashboardAxes {
  return {
    codeHealth: computeCodeHealth(sum, regressions, findings),
    resilience: computeResilience(sum, allBudgets, regressions),
  };
}
