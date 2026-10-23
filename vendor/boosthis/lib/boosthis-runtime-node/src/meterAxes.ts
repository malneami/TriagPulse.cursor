/* ─── Boosthis Node meter axes — ADDITIVE server-side perf signals ───────
 *
 * Node parity for the React-Native kit's `meterAxes.ts`. These axes ENRICH the
 * dashboard/bubble and the uploaded snapshot WITHOUT touching the composite
 * Speed score (TTFF/TTI/FID, defined in thresholds.ts). Every scorer here
 * mirrors the SAME thresholds, the SAME linearScore/ratingFor bands
 * (good >= 85, needs-work >= 60, else poor; null score => "pending"), and the
 * SAME honesty gates as the canonical RN source, so the same number means the
 * same thing in every language.
 *
 * The axes added here for cross-runtime parity:
 *   • confidence   — how much data backs the numbers (least-sampled scored route).
 *   • baseline     — each route graded against ITS OWN recent history (drift).
 *   • network      — outbound-call stall/timeout rate + p75 latency.
 *   • idle         — CPU burned while zero requests were in flight.
 *   • latencyFloor — the worst completed 10s window's p95 request latency.
 *   • repeatedWork — the same call, made more than once inside one request.
 *   • dbWork       — how much of a request was spent waiting on the database,
 *                    and whether one request ran the same statement repeatedly.
 *
 * PRIVACY: counts, ratios and durations only. No route label, host, URL, or any
 * customer-controllable string ever reaches these functions — route identity is
 * handled upstream via the middleware's sanitized route-label mechanism, and the
 * baseline axis receives only ordered duration arrays (never the route key).
 */

import { linearScore, ratingFor, MIN_SAMPLES_FOR_AXES } from "./healthAxes";
import type { Rating, NoScoreRating } from "./thresholds";
import { SCORE_THRESHOLDS } from "./thresholds";
import { REASON_NOTHING_TO_COMPARE } from "./axisReasons";
import { SETTLE_RULE, isSettling, markSettled, settlingReading } from "./settleRule";
import { earnedPerMin } from "./rateHonesty";

export type AxisRating = Rating | NoScoreRating;

/* ─── Confidence (sample count) ─────────────────────────────────────────
 * How much data backs the numbers, keyed off the LEAST-sampled SCORED unit —
 * for a server kit, the least-sampled scored ROUTE. Routes without enough
 * samples to be scored are excluded; 0 when nothing is scored yet. Bands mirror
 * RN's CONFIDENCE_CUTOFFS: <=0 none/pending · <5 low/poor · <20 medium/needs-work
 * · >=20 high/good.
 */
export const CONFIDENCE_CUTOFFS = { medium: 5, high: 20 } as const;
export type ConfidenceLevel = "none" | "low" | "medium" | "high";

export function confidenceLevel(sampleCount: number): ConfidenceLevel {
  if (!sampleCount || sampleCount <= 0) return "none";
  if (sampleCount < CONFIDENCE_CUTOFFS.medium) return "low";
  if (sampleCount < CONFIDENCE_CUTOFFS.high) return "medium";
  return "high";
}

/** Pre-derived rating for the confidence axis on the shared bands. "pending"
 *  until there is at least one sample. */
export function confidenceRatingFor(level: ConfidenceLevel): AxisRating {
  return level === "high"
    ? "good"
    : level === "medium"
      ? "needs-work"
      : level === "low"
        ? "poor"
        : "pending";
}

const CONFIDENCE_CAPTIONS: Record<ConfidenceLevel, string> = {
  none: "no samples yet",
  low: "few samples",
  medium: "moderate samples",
  high: "well-sampled",
};

export function confidenceCaptionFor(level: ConfidenceLevel): string {
  return CONFIDENCE_CAPTIONS[level];
}

export interface ConfidenceResult {
  confidence: ConfidenceLevel;
  confidenceMounts: number;
  confidenceRating: AxisRating;
  confidenceCaption: string;
}

/** Build the four scalar confidence keys from the sample count of the
 *  least-sampled scored route (0 when nothing is scored yet). */
export function computeConfidence(
  leastScoredSamples: number,
): ConfidenceResult {
  const mounts = Math.max(0, Math.round(leastScoredSamples || 0));
  const level = confidenceLevel(mounts);
  return {
    confidence: level,
    confidenceMounts: mounts,
    confidenceRating: confidenceRatingFor(level),
    confidenceCaption: confidenceCaptionFor(level),
  };
}

/* ─── Baseline (anomaly vs. its own normal) ─────────────────────────────
 * "Did this route GET slow?" Fixed thresholds answer "is it slow?"; this axis
 * grades each route against ITS OWN earlier normal.
 *
 * THE TWO WINDOWS ARE SUPPLIED SEPARATELY AND CANNOT OVERLAP. This axis used
 * to take one chronological list per route and split it — baseline = all but
 * the last BASELINE_RECENT_N, recent = the last BASELINE_RECENT_N — from
 * whatever the shared 1000-sample ring still held. On a busy app that list is
 * the last few minutes, so both halves came from the same few minutes and a
 * route that doubled over an hour never showed: the yardstick drifted with
 * the thing it measured. The caller now hands over the route's FROZEN
 * baseline (its first samples after warm-up, kept by the ring module as they
 * arrived) and, separately, samples stamped strictly after that baseline
 * closed. The same rule the learned budget follows, so the panel's Baseline
 * tile and the route's budget cannot give one app two answers — see
 * docs/learned-budget-contract.md.
 *
 * Anomaly ratio = recentMedian / baselineMedian; a route is anomalous only
 * when it is BOTH materially slower (ratio >= good) AND the absolute jump
 * clears BASELINE_MIN_DELTA_MS. Score the WORST eligible ratio (1.2× → 100,
 * 2× → 0). Medians, not means. Label-free — only ordered durations reach this
 * function. Additive; never feeds Speed.
 *
 * The React Native kit still splits one window in its own copy of this
 * scorer. That kit is left to its own release; the difference is recorded in
 * docs/learned-budget-contract.md rather than papered over here.
 */
export const BASELINE_THRESHOLDS = { good: 1.2, poor: 2 } as const;
/** Per-route samples needed before a comparison is possible at all: the
 *  frozen baseline's floor plus the recent window's. Kept as the combined
 *  figure it always was, now stated as the sum of its two parts. */
export const BASELINE_MIN_SAMPLES = 6;
/** How many of the most-recent samples form the "current" window. */
export const BASELINE_RECENT_N = 3;
/** How many FROZEN baseline samples a route needs before the axis will judge
 *  it. Named separately from the recent window's floor because the two
 *  windows are now separate inputs, and a reader must be able to see which
 *  side is short. */
export const BASELINE_BASELINE_N = BASELINE_MIN_SAMPLES - BASELINE_RECENT_N;
/** Absolute slowdown (ms) a route must clear to count as an anomaly. */
export const BASELINE_MIN_DELTA_MS = 50;

/** Which algorithm produced a Baseline axis reading. Mirrors the learned
 *  budget's own name so a reader comparing the two surfaces can see they are
 *  the same derivation over the same two windows. */
export const BASELINE_ALGORITHM = "device-ring-frozen-baseline" as const;

/** Structural per-route input: two NON-OVERLAPPING windows of one route's
 *  durations, oldest→newest within each. Label-free by design — the route key
 *  never enters the Baseline axis. */
export interface RouteSeriesLike {
  /** The route's frozen baseline: its first samples in this process, after
   *  the warm-up exclusion. Never contains a sample that is also in
   *  `durations`. */
  baseline: number[];
  /** Samples taken strictly AFTER that baseline closed, oldest→newest. The
   *  last BASELINE_RECENT_N of them are the compared window. */
  durations: number[];
}

export interface BaselineResult {
  score: number | null;
  rating: AxisRating;
  worstRatio: number | null;
  worstBaselineMs: number | null;
  worstCurrentMs: number | null;
  anomalyCount: number;
  /** Routes that completed a comparison — NOT routes that merely had enough
   *  samples. A route whose earlier window is too fast to divide by counts in
   *  `unscoredRoutes` instead, so a caption built from this can never claim
   *  steadiness over a route the axis never examined. */
  scoredRoutes: number;
  /** Routes with enough samples whose earlier-window median was 0ms. Durations
   *  are captured as whole milliseconds, so a sub-millisecond handler leaves no
   *  denominator to divide by and its drift is unknowable here. Counted, never
   *  silently dropped. */
  unscoredRoutes: number;
  /** 0 when nothing could be compared, 1 once any route was. Mirrors the
   *  can't-know shape the extra meters use (`measurable: 0` + "pending"), so an
   *  abstention is visibly different from a good reading. */
  measurable: 0 | 1;
}

/** Median of an unordered list (does not mutate the input). 0 when empty. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function computeBaselineScore(
  series: RouteSeriesLike[],
): BaselineResult {
  let scoredRoutes = 0;
  let unscoredRoutes = 0;
  let anomalyCount = 0;
  let worstRatio: number | null = null;
  let worstBaselineMs: number | null = null;
  let worstCurrentMs: number | null = null;

  for (const route of series) {
    const durations = route?.durations;
    const base = route?.baseline;
    // Each side is gated on its OWN floor. A route whose frozen baseline was
    // never completed (or was dropped) is not judged here at all — falling
    // back to splitting the recent window is the very comparison this axis
    // stopped making.
    if (!Array.isArray(base) || base.length < BASELINE_BASELINE_N) continue;
    if (!Array.isArray(durations) || durations.length < BASELINE_RECENT_N) {
      continue;
    }
    const recent = durations.slice(-BASELINE_RECENT_N);
    const baseMed = median(base);
    const recentMed = median(recent);
    // A sub-millisecond handler records every duration as 0 (whole-ms capture),
    // so its earlier window medians to 0 and there is no ratio to take. Abstain
    // for this route and SAY SO: counting it as scored here is what let a
    // hundred-fold regression on a fast route report "steady · 1 routes".
    if (baseMed <= 0) {
      unscoredRoutes++;
      continue;
    }
    scoredRoutes++;
    const ratio = recentMed / baseMed;
    const delta = recentMed - baseMed;
    if (ratio < BASELINE_THRESHOLDS.good || delta < BASELINE_MIN_DELTA_MS) {
      continue;
    }
    anomalyCount++;
    if (worstRatio === null || ratio > worstRatio) {
      worstRatio = ratio;
      worstBaselineMs = Math.round(baseMed);
      worstCurrentMs = Math.round(recentMed);
    }
  }

  if (scoredRoutes === 0) {
    // Nothing was compared, so there is no verdict — never a perfect score.
    // `unscoredRoutes` tells the two silences apart downstream: 0 = no route
    // has enough samples yet (warming up), >0 = every route was too fast to
    // divide by (cannot tell).
    return {
      score: null,
      rating: "pending",
      worstRatio: null,
      worstBaselineMs: null,
      worstCurrentMs: null,
      anomalyCount: 0,
      scoredRoutes: 0,
      unscoredRoutes,
      measurable: 0,
    };
  }
  if (worstRatio === null) {
    return {
      score: 100,
      rating: "good",
      worstRatio: null,
      worstBaselineMs: null,
      worstCurrentMs: null,
      anomalyCount: 0,
      scoredRoutes,
      unscoredRoutes,
      measurable: 1,
    };
  }
  const score = linearScore(
    worstRatio,
    BASELINE_THRESHOLDS.good,
    BASELINE_THRESHOLDS.poor,
  );
  return {
    score,
    rating: ratingFor(score),
    worstRatio: Math.round(worstRatio * 100) / 100,
    worstBaselineMs,
    worstCurrentMs,
    anomalyCount,
    scoredRoutes,
    unscoredRoutes,
    measurable: 1,
  };
}

/* ─── Which part decided a worst-of-several score ───────────────────────
 *
 * Nine meters score the WORST of several parts: Network, MCP tool speed,
 * Repeated work, Database work, Database rows, AI wait, AI rate-limit
 * headroom, Background work and Outside services (AI spend carries numbers and
 * grades none, so nothing ever decides it). A tile that shows "37" and a list
 * of figures leaves the reader to work out which figure did that — an outside
 * tester did exactly that, by hand, for a queue that was falling behind.
 *
 * So the scorer says which part it was, AT THE POINT THE SCORE IS TAKEN. Not a
 * second copy of the thresholds somewhere downstream re-deciding it: two copies
 * of a band drift, and then the sentence names a part that did not decide.
 *
 * On the wire it is three numbers: a CLOSED code (never a word typed on a
 * customer's machine — the server owns every sentence and drops a code it
 * does not know), the part's figure in that part's own unit, and the threshold
 * this kit calls poor for it. Codes are unique across axes, so a code that
 * arrives on the wrong axis is detectable rather than mis-worded.
 *
 * Absent when nothing pulled the score down (every part scored 100), while the
 * axis is pending or unscored, and from a kit older than this field — every
 * surface then keeps the caption it always had.
 */
export const DECIDED_PART = {
  networkLatency: 1,
  networkStalls: 2,
  mcpLatency: 11,
  mcpErrors: 12,
  repeatedTime: 21,
  repeatedBurst: 22,
  dbWait: 31,
  dbRepeat: 32,
  rowsWorst: 41,
  rowsTypical: 42,
  aiFailures: 51,
  aiFirstWords: 52,
  headroomRequests: 61,
  headroomTokens: 62,
  jobFailures: 71,
  jobOverlaps: 72,
  jobMissed: 73,
  jobWait: 74,
  depWait: 81,
  depFailures: 82,
} as const;

/** Which axis each code may arrive on. A code is only ever worded beside the
 *  axis that owns it, so a mixed-up wire object cannot borrow another meter's
 *  sentence. */
export const DECIDED_PART_AXIS: Readonly<Record<number, string>> = {
  [DECIDED_PART.networkLatency]: "network",
  [DECIDED_PART.networkStalls]: "network",
  [DECIDED_PART.mcpLatency]: "mcpTools",
  [DECIDED_PART.mcpErrors]: "mcpTools",
  [DECIDED_PART.repeatedTime]: "repeatedWork",
  [DECIDED_PART.repeatedBurst]: "repeatedWork",
  [DECIDED_PART.dbWait]: "dbWork",
  [DECIDED_PART.dbRepeat]: "dbWork",
  [DECIDED_PART.rowsWorst]: "dbRowVolume",
  [DECIDED_PART.rowsTypical]: "dbRowVolume",
  [DECIDED_PART.aiFailures]: "aiCalls",
  [DECIDED_PART.aiFirstWords]: "aiCalls",
  [DECIDED_PART.headroomRequests]: "aiHeadroom",
  [DECIDED_PART.headroomTokens]: "aiHeadroom",
  [DECIDED_PART.jobFailures]: "backgroundWork",
  [DECIDED_PART.jobOverlaps]: "backgroundWork",
  [DECIDED_PART.jobMissed]: "backgroundWork",
  [DECIDED_PART.jobWait]: "backgroundWork",
  [DECIDED_PART.depWait]: "dependencies",
  [DECIDED_PART.depFailures]: "dependencies",
};

/** The part that set a worst-of-several score, as it goes on the wire. */
export interface DecidedPart {
  /** One of {@link DECIDED_PART}. */
  decidedBy: number;
  /** The part's own figure, in its own unit (ms, %, a count or rows). */
  decidedFigure: number;
  /** This kit's own "poor at" line for that part, same unit. */
  decidedPoorAt: number;
}

/** One scored part, as a scorer hands it to {@link worstOfParts}. */
export interface ScoredPart {
  code: number;
  score: number;
  figure: number;
  poorAt: number;
}

/**
 * The worst part's score, and which part it was.
 *
 * Declared order breaks a tie: the EARLIER part decides, so the same reading
 * always names the same part. No part is named when the worst score is 100 —
 * nothing pulled the rating down, and naming a part would invent a culprit.
 */
export function worstOfParts(parts: readonly ScoredPart[]): {
  score: number;
  decided: DecidedPart | null;
} {
  let worst: ScoredPart | null = null;
  for (const p of parts) {
    if (worst === null || p.score < worst.score) worst = p;
  }
  if (worst === null) return { score: 100, decided: null };
  return {
    score: worst.score,
    decided:
      worst.score < 100
        ? {
            decidedBy: worst.code,
            decidedFigure: worst.figure,
            decidedPoorAt: worst.poorAt,
          }
        : null,
  };
}

/** The three wire fields of a result, or nothing — spread into a wire object
 *  so an undecided reading carries no trace of them. */
export function decidedFieldsOf(
  r: Partial<DecidedPart> | null | undefined,
): Partial<DecidedPart> {
  if (
    !r ||
    typeof r.decidedBy !== "number" ||
    typeof r.decidedFigure !== "number" ||
    typeof r.decidedPoorAt !== "number"
  ) {
    return {};
  }
  return {
    decidedBy: r.decidedBy,
    decidedFigure: r.decidedFigure,
    decidedPoorAt: r.decidedPoorAt,
  };
}

/* ─── Network reliability (stalls / silent timeouts) ────────────────────
 * OUTBOUND calls the app makes. Mirrors RN's computeNetworkScore: pending until
 * NETWORK_MIN_ATTEMPTS attempts; latency sub-score on p75 (good 800ms /
 * poor 3000ms); stall sub-score on (timeout + stall) / attempts (good 1% /
 * poor 10%); overall score = the WORSE of the two. Loud "failed" calls stay out
 * of the STALL rate (an app that knows a call failed is the opposite of a
 * silent stall), but their durations ride the p75 like any other attempt: a
 * call that failed five times before it worked cost the app all six attempts,
 * and scoring only the success reported the cheapest one. Counts + durations
 * only — never a host or URL.
 */
export const NETWORK_THRESHOLDS = {
  p75GoodMs: 800,
  p75PoorMs: 3000,
  stallRateGood: 0.01,
  stallRatePoor: 0.1,
} as const;

export const NETWORK_MIN_ATTEMPTS = 3;

/** Minimal label-free aggregate consumed from the network sampler. */
export interface NetworkStatsLike {
  attemptCount: number;
  completedCount: number;
  failedCount: number;
  timeoutCount: number;
  stallCount: number;
  p75Ms: number;
  worstMs: number;
}

export interface NetworkResult extends Partial<DecidedPart> {
  score: number | null;
  rating: AxisRating;
  stallPct: number | null;
  attemptCount: number;
  failedCount: number;
  timeoutCount: number;
  stallCount: number;
  p75Ms: number | null;
  worstMs: number;
}

export function computeNetworkScore(stats: NetworkStatsLike): NetworkResult {
  if (!stats || stats.attemptCount < NETWORK_MIN_ATTEMPTS) {
    return {
      score: null,
      rating: "pending",
      stallPct: null,
      attemptCount: stats?.attemptCount ?? 0,
      failedCount: stats?.failedCount ?? 0,
      timeoutCount: stats?.timeoutCount ?? 0,
      stallCount: stats?.stallCount ?? 0,
      p75Ms: null,
      worstMs: Math.round(stats?.worstMs ?? 0),
    };
  }
  const stallRate =
    (stats.timeoutCount + stats.stallCount) / stats.attemptCount;
  const latencyScore = linearScore(
    stats.p75Ms,
    NETWORK_THRESHOLDS.p75GoodMs,
    NETWORK_THRESHOLDS.p75PoorMs,
  );
  const stallScore = linearScore(
    stallRate,
    NETWORK_THRESHOLDS.stallRateGood,
    NETWORK_THRESHOLDS.stallRatePoor,
  );
  const stallPct = Math.round(stallRate * 1000) / 10;
  // Either slowness OR silent stalls should turn the tile red — take the worse.
  const { score, decided } = worstOfParts([
    {
      code: DECIDED_PART.networkLatency,
      score: latencyScore,
      figure: Math.round(stats.p75Ms),
      poorAt: NETWORK_THRESHOLDS.p75PoorMs,
    },
    {
      code: DECIDED_PART.networkStalls,
      score: stallScore,
      figure: stallPct,
      poorAt: NETWORK_THRESHOLDS.stallRatePoor * 100,
    },
  ]);
  return {
    score,
    rating: ratingFor(score),
    stallPct,
    attemptCount: stats.attemptCount,
    failedCount: stats.failedCount,
    timeoutCount: stats.timeoutCount,
    stallCount: stats.stallCount,
    p75Ms: Math.round(stats.p75Ms),
    worstMs: Math.round(stats.worstMs),
    ...decidedFieldsOf(decided),
  };
}

/* ─── Idle efficiency (wasted CPU while nothing is in flight) ────────────
 * "When the process is NOT serving anything, does it actually go quiet?" We
 * sample process.cpuUsage() and wall time over windows where ZERO requests were
 * in flight; idleBusyPct = busy CPU ms / idle wall ms * 100. Mirrors RN's
 * computeIdleEfficiency thresholds (good 2% / poor 20%) and its minimum-sample
 * gate. A well-behaved server parks its timers when idle; a wasteful one keeps
 * burning CPU (busy-poll, stranded setInterval) even when untouched.
 */
export const IDLE_EFFICIENCY_THRESHOLDS = { good: 0.02, poor: 0.2 } as const;

/** Minimum accumulated idle wall time (ms) before the axis leaves "pending" —
 *  below this, one stray idle burst would swamp the ratio. */
export const IDLE_MIN_WALL_MS = 2_000;

/** Minimal label-free aggregate consumed from the idle CPU sampler. */
export interface IdleStatsLike {
  /** Total wall-clock ms observed across zero-in-flight windows. */
  idleWallMs: number;
  /** Total CPU (user+system) ms burned across those same windows. */
  idleCpuMs: number;
  /** ≥50ms busy stretches observed while idle (sustained wasted work). */
  idleLongTaskCount: number;
}

export interface IdleResult {
  score: number | null;
  rating: AxisRating;
  idleBusyPct: number | null;
  idleLongTaskCount: number;
}

export function computeIdleEfficiency(stats: IdleStatsLike): IdleResult {
  if (!stats || stats.idleWallMs < IDLE_MIN_WALL_MS) {
    return {
      score: null,
      rating: "pending",
      idleBusyPct: null,
      idleLongTaskCount: stats?.idleLongTaskCount ?? 0,
    };
  }
  const busy = stats.idleWallMs > 0 ? stats.idleCpuMs / stats.idleWallMs : 0;
  const score = linearScore(
    busy,
    IDLE_EFFICIENCY_THRESHOLDS.good,
    IDLE_EFFICIENCY_THRESHOLDS.poor,
  );
  return {
    score,
    rating: ratingFor(score),
    idleBusyPct: Math.round(busy * 1000) / 10,
    idleLongTaskCount: stats.idleLongTaskCount,
  };
}

/* ─── MCP tool speed (per-tool latency + error rate) ─────────────────────
 * "Which of this project's MCP tools is slow?" Fed by the closed-set
 * `mcp.call.*` sample labels (see mcpMeasure.ts). Each TOOL is a scored unit
 * once it has MIN_SAMPLES_FOR_AXES samples (success + error samples both
 * count). Latency sub-score = the WORST scored tool's p95 on the shared TTI
 * thresholds; error sub-score = overall failed-call rate (good ≤1% ·
 * poor ≥10%, same bands as the network stall rate). Overall = the WORSE of
 * the two. Pending until at least one tool is scored — a project that serves
 * no MCP simply never grows this axis (honest absence, not a silent gap).
 * Label-free: only ordered duration arrays + error counts reach this scorer.
 */
export const MCP_TOOLS_THRESHOLDS = {
  errRateGood: 0.01,
  errRatePoor: 0.1,
} as const;
export const MCP_TOOLS_MIN_SAMPLES = 5;

/** Structural per-tool input: this tool's durations (success AND error calls,
 *  any order) plus how many of them failed. The tool name never enters. */
export interface McpToolSeriesLike {
  durations: number[];
  errorCount: number;
}

export interface McpToolsResult extends Partial<DecidedPart> {
  score: number | null;
  rating: AxisRating;
  /** Worst scored tool's p95 latency (ms). */
  worstMs: number | null;
  /** Tools with enough samples to be scored. */
  toolCount: number;
  /** Failed-call percentage across all scored tools (1 decimal). */
  errorPct: number | null;
  /** Total calls across all scored tools. */
  sampleCount: number;
}

/** p95 with the same index rule as the sample-ring summary. */
function p95Of(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

export function computeMcpToolsScore(
  series: McpToolSeriesLike[],
): McpToolsResult {
  let toolCount = 0;
  let sampleCount = 0;
  let errorCount = 0;
  let worstMs: number | null = null;
  for (const tool of series) {
    const durations = tool?.durations;
    if (!Array.isArray(durations) || durations.length < MCP_TOOLS_MIN_SAMPLES) {
      continue;
    }
    toolCount++;
    sampleCount += durations.length;
    errorCount += Math.max(0, Math.round(tool.errorCount || 0));
    const p95 = p95Of(durations);
    if (worstMs === null || p95 > worstMs) worstMs = p95;
  }
  if (toolCount === 0 || worstMs === null) {
    return {
      score: null,
      rating: "pending",
      worstMs: null,
      toolCount: 0,
      errorPct: null,
      sampleCount: 0,
    };
  }
  const latencyScore = linearScore(
    worstMs,
    SCORE_THRESHOLDS.tti.good,
    SCORE_THRESHOLDS.tti.poor,
  );
  const errRate = sampleCount > 0 ? errorCount / sampleCount : 0;
  const errScore = linearScore(
    errRate,
    MCP_TOOLS_THRESHOLDS.errRateGood,
    MCP_TOOLS_THRESHOLDS.errRatePoor,
  );
  const errorPct = Math.round(errRate * 1000) / 10;
  // A slow tool OR a failing tool should turn the tile red — take the worse.
  const { score, decided } = worstOfParts([
    {
      code: DECIDED_PART.mcpLatency,
      score: latencyScore,
      figure: Math.round(worstMs),
      poorAt: SCORE_THRESHOLDS.tti.poor,
    },
    {
      code: DECIDED_PART.mcpErrors,
      score: errScore,
      figure: errorPct,
      poorAt: MCP_TOOLS_THRESHOLDS.errRatePoor * 100,
    },
  ]);
  return {
    score,
    rating: ratingFor(score),
    worstMs: Math.round(worstMs),
    toolCount,
    errorPct,
    sampleCount,
    ...decidedFieldsOf(decided),
  };
}

/* ─── Latency Floor (worst window's p95 — one bad minute can't hide) ─────
 * The server analogue of RN's Frame Floor: "one terrible window is never
 * averaged away." Request latency is cut into fixed LATENCY_FLOOR_WINDOW_MS
 * windows; each completed window's p95 is taken, and we score the WORST such
 * window's p95. Require at least LATENCY_FLOOR_MIN_WINDOWS completed windows
 * with samples before scoring, so a single warm-up window can't define the
 * whole session's floor.
 */
export const LATENCY_FLOOR_WINDOW_MS = 10_000;
export const LATENCY_FLOOR_MIN_WINDOWS = 3;

/** Latency-floor bands (ms) — a SERVER REQUEST bar, chosen here and named here.
 *
 *  WHY NOT THE SHARED BAND. This axis used to score on SCORE_THRESHOLDS.tti,
 *  which is good at 500ms — the bar for a PAGE becoming interactive, a whole
 *  round trip plus parse plus paint. Borrowed onto a server API it rated a p95
 *  of 401ms in the worst window as 100/good, which is not a defensible thing to
 *  say about request latency. eventLoopLag already documents that its bands are
 *  deliberately not the shared TTFF/TTI/FID thresholds; this axis now says the
 *  same out loud instead of inheriting a threshold built for another kind of
 *  measurement.
 *
 *  WHY THESE NUMBERS. They are the ones the web kit already justifies for
 *  SERVER-side processing (SERVER_TIMING_THRESHOLDS, good 200 / poor 1000):
 *  200ms of server work leaves room inside a one-second page for the network
 *  and the render it has to pay for as well, and a second of server work has
 *  spent the whole budget before anything reaches the browser. This axis reads
 *  the same quantity from the other end of the wire, so it uses the same bar.
 *  Consequences worth stating: a worst-window p95 stops being "good" at 325ms,
 *  and the 401ms the freeze workload produced now scores 75/needs-work. */
export const LATENCY_FLOOR_GOOD_MS = 200;
export const LATENCY_FLOOR_POOR_MS = 1_000;

/** Minimal label-free aggregate consumed from the latency-floor sampler. */
export interface LatencyFloorStatsLike {
  /** Worst completed window's p95 request latency (ms), 0 when none. */
  worstMs: number;
  /** Completed windows that had at least one sample. */
  windowCount: number;
}

export interface LatencyFloorResult {
  score: number | null;
  rating: AxisRating;
  worstMs: number | null;
  windowCount: number;
}

export function computeLatencyFloor(
  stats: LatencyFloorStatsLike,
): LatencyFloorResult {
  if (!stats || stats.windowCount < LATENCY_FLOOR_MIN_WINDOWS) {
    return {
      score: null,
      rating: "pending",
      worstMs: null,
      windowCount: stats?.windowCount ?? 0,
    };
  }
  const worst = Math.max(0, Math.round(stats.worstMs));
  const score = linearScore(
    worst,
    LATENCY_FLOOR_GOOD_MS,
    LATENCY_FLOOR_POOR_MS,
  );
  return {
    score,
    rating: ratingFor(score),
    worstMs: worst,
    windowCount: stats.windowCount,
  };
}

/* ─── Repeated work (the same call, twice, in one request) ───────────────
 * "Did this app do the same work twice inside one request?" The rule book has
 * always given this advice (n-plus-one-orm-query, node-fanout-overload:
 * "identical downstream GETs within one request should share one promise") and
 * nothing measured it, because a span reaching the server carries a route
 * label and a duration but never the call's identity. repeatedWork.ts counts
 * it INSIDE the kit, where the real call exists, and hands this scorer nothing
 * but numbers.
 *
 * Two sub-scores, worse one wins:
 *   • WASTED TIME  — the share of watched request time spent on the redundant
 *     occurrences. Good at ≤1%, poor at ≥20%.
 *   • WORST BURST  — the largest number of identical calls in one request.
 *     Good at 1 (nothing repeated), poor at ≥10 (a classic n+1 fan-out).
 *
 * ADDITIVE + DISPLAY-ONLY: never feeds the composite Speed score.
 */
export const REPEATED_WORK_TIME_PCT_THRESHOLDS = { good: 1, poor: 20 } as const;
export const REPEATED_WORK_BURST_THRESHOLDS = { good: 1, poor: 10 } as const;

/** Watched requests needed before the axis leaves "pending". Below this a
 *  single unlucky request would define the whole reading. Mirrors the shared
 *  MIN_SAMPLES_FOR_AXES gate. */
export const REPEATED_WORK_MIN_REQUESTS = MIN_SAMPLES_FOR_AXES;

/** Minimal label-free aggregate consumed from the repeated-work detector. */
export interface RepeatedWorkStatsLike {
  /** Requests in which at least one identifiable call was watched. */
  watchedRequests: number;
  /** Requests the start-up rule kept out of the graded figures. */
  settlingRequests?: number;
  /** Of those, how many contained the same call more than once. */
  requestsWithRepeat: number;
  /** Worst number of identical calls inside a SINGLE request (1 = none ever
   *  repeated; 0 only before anything was watched). */
  worstRepeats: number;
  /** Ms attributable to the redundant occurrences, clamped per request. */
  redundantMs: number;
  /** Wall ms of the watched requests (the share denominator). */
  watchedRequestMs: number;
}

export interface RepeatedWorkResult extends Partial<DecidedPart> {
  score: number | null;
  rating: AxisRating;
  /** Worst identical-call count in one request, or null while pending. */
  worstRepeats: number | null;
  requestsWithRepeat: number;
  watchedRequests: number;
  /** Share of watched request time spent redoing work, 0..100. */
  repeatTimePct: number;
}

export function computeRepeatedWork(
  stats: RepeatedWorkStatsLike,
): RepeatedWorkResult {
  if (!stats || stats.watchedRequests < REPEATED_WORK_MIN_REQUESTS) {
    return {
      score: null,
      rating: "pending",
      worstRepeats: null,
      requestsWithRepeat: stats?.requestsWithRepeat ?? 0,
      watchedRequests: stats?.watchedRequests ?? 0,
      repeatTimePct: 0,
    };
  }
  const pct =
    stats.watchedRequestMs > 0
      ? (stats.redundantMs / stats.watchedRequestMs) * 100
      : 0;
  const repeatTimePct = Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
  // A watched request always made at least one call, so the worst burst is at
  // least 1 — "1" is the honest reading for an app that never repeated itself.
  const worst = Math.max(1, Math.round(stats.worstRepeats));
  const { score, decided } = worstOfParts([
    {
      code: DECIDED_PART.repeatedTime,
      score: linearScore(
        repeatTimePct,
        REPEATED_WORK_TIME_PCT_THRESHOLDS.good,
        REPEATED_WORK_TIME_PCT_THRESHOLDS.poor,
      ),
      figure: repeatTimePct,
      poorAt: REPEATED_WORK_TIME_PCT_THRESHOLDS.poor,
    },
    {
      code: DECIDED_PART.repeatedBurst,
      score: linearScore(
        worst,
        REPEATED_WORK_BURST_THRESHOLDS.good,
        REPEATED_WORK_BURST_THRESHOLDS.poor,
      ),
      figure: worst,
      poorAt: REPEATED_WORK_BURST_THRESHOLDS.poor,
    },
  ]);
  return {
    score,
    rating: ratingFor(score),
    worstRepeats: worst,
    requestsWithRepeat: stats.requestsWithRepeat,
    watchedRequests: stats.watchedRequests,
    repeatTimePct,
    ...decidedFieldsOf(decided),
  };
}

/* ─── Database work (how much of a request was spent waiting on the DB) ───
 * "Of the time this request took, how much was the database?" — and "did one
 * request run the same statement over and over?" Both are advice the rule book
 * already gives (`n-plus-one-orm-node`, `unbounded-result-set`,
 * `db-write-in-loop`); neither was ever measured, because a traditional driver
 * talks over its own socket and a hosted database over HTTP looked exactly
 * like any other API call. dbWork.ts watches both INSIDE the kit and hands
 * this scorer nothing but numbers.
 *
 * Two sub-scores, worse one wins:
 *   • DATABASE WAIT — the share of watched request time spent waiting on the
 *     database. Good at ≤20% (a normal read-backed endpoint), poor at ≥70%
 *     (the request is essentially the query). Deliberately far more generous
 *     than the repeated-work bands: database time is WORK, not waste. Only
 *     when it dominates the request is there something to look at.
 *   • WORST REPEAT — the largest number of identical statements in one
 *     request. Good at 1 (nothing repeated), poor at ≥10 (a classic n+1).
 *
 * ADDITIVE + DISPLAY-ONLY: never feeds the composite Speed score, and never
 * moves the repeated-work axis — database repetition is reported here and
 * only here.
 */
export const DB_WAIT_PCT_THRESHOLDS = { good: 20, poor: 70 } as const;
export const DB_REPEAT_BURST_THRESHOLDS = { good: 1, poor: 10 } as const;

/**
 * The point this kit calls a single query's result set UNBOUNDED.
 *
 * A thousand rows out of one statement is far past what a request renders, and
 * it is the shape the rule book's "cap query result size with LIMIT +
 * pagination" advice describes. Below it the kit makes no claim at all — a
 * result size is reported ONLY once it crosses this line, so the number's
 * presence is the judgement and nothing downstream has to invent a threshold
 * of its own.
 */
export const DB_LARGE_RESULT_ROWS = 1000;

/** Watched requests needed before the axis leaves "pending". Below this a
 *  single unlucky request would define the whole reading. Mirrors the shared
 *  MIN_SAMPLES_FOR_AXES gate. */
export const DB_WORK_MIN_REQUESTS = 20;
/** The start-up rule's settled-request floor (latencyTail: 20 samples) is the
 *  gate above; and a wait of 100 ms or less per request is never a database
 *  fault, whatever share of a fast request it is (the shared decision, the
 *  same line in every kit carrying the meter). */
export const DB_WAIT_MS_PER_REQUEST_FLOOR = 100;

/** Minimal label-free aggregate consumed from the database-work detector. */
export interface DbWorkStatsLike {
  /** Requests in which at least one database call was watched. */
  watchedRequests: number;
  /** Wall ms of those requests (the share denominator). */
  watchedRequestMs: number;
  /** Ms spent waiting on the database, clamped per request. */
  dbMs: number;
  /** Database round trips watched. */
  callCount: number;
  /** Of those, how many went to a hosted database reached over the web. */
  hostedCalls: number;
  /** Worst number of identical statements inside a SINGLE request. */
  repeatWorst: number;
  /** Watched requests that ran the same statement more than once. */
  repeatRequests: number;
  /** Ms attributable to the redundant runs, clamped per request. */
  repeatMs: number;
  /** Largest single-statement row count seen in any watched request. A COUNT,
   *  never a row: no value, column name or table name is read to get it. */
  rowsWorst: number;
  /** Database libraries this app loaded that the kit cannot watch. A blind
   *  spot, shipped beside the reading so it can never render as "none". */
  unwatchedClients: number;
}

export interface DbWorkResult extends Partial<DecidedPart> {
  score: number | null;
  rating: AxisRating;
  /** Database wait per settled request (ms); 100 or less grades the wait term
   *  100. Absent while nothing is graded. */
  waitMsPerRequest?: number;
  /** 0 = the kit is watching but has nothing it can honestly score yet, and a
   *  blind spot is the reason the tile must not read as "no database work".
   *  1 = the numbers below are a real reading. */
  measurable: 0 | 1;
  /** Share of watched request time spent waiting on the database, 0..100. */
  waitPct: number;
  callCount: number;
  watchedRequests: number;
  hostedCalls: number;
  /** Worst identical-statement count in one request, or null while pending. */
  repeatWorst: number | null;
  repeatRequests: number;
  /** Share of watched request time wasted on the repeats, 0..100. */
  repeatWastePct: number;
  /**
   * Largest single-statement row count seen, or null when no finished query
   * reported one (every watched call was a cursor or a stream).
   *
   * Reported, never scored: a big result set is sometimes exactly right, so it
   * is the rule-book anchor for capping a query — not a mark against the app.
   */
  rowsWorst: number | null;
  unwatchedClients: number;
}

/**
 * Score the database-work axis, or return null when there is nothing honest to
 * say yet.
 *
 * THREE OUTCOMES, deliberately distinct:
 *   • null — not enough watched requests AND no blind spot. The axis is simply
 *     absent from the snapshot, which every surface reads as "cannot tell".
 *     This is what a language without this meter reports too, so an app with
 *     no database and a runtime with no reading look the same and neither
 *     looks like a zero.
 *   • measurable 0 — too few watched requests to score, but this app loaded a
 *     database library the kit cannot watch. Reporting nothing here would let
 *     a real blind spot pass for a clean app, so the axis ships with the
 *     unwatched count and no score.
 *   • measurable 1 — a real reading.
 */
export function computeDbWork(stats: DbWorkStatsLike): DbWorkResult | null {
  if (!stats) return null;
  const unwatchedClients = Math.max(0, Math.round(stats.unwatchedClients ?? 0));
  if (stats.watchedRequests < DB_WORK_MIN_REQUESTS) {
    if (unwatchedClients === 0) return null;
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      waitPct: 0,
      callCount: stats.callCount ?? 0,
      watchedRequests: stats.watchedRequests ?? 0,
      hostedCalls: stats.hostedCalls ?? 0,
      repeatWorst: null,
      repeatRequests: stats.repeatRequests ?? 0,
      repeatWastePct: 0,
      rowsWorst: null,
      unwatchedClients,
    };
  }
  const pctOf = (ms: number): number => {
    const raw =
      stats.watchedRequestMs > 0 ? (ms / stats.watchedRequestMs) * 100 : 0;
    return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
  };
  const waitPct = pctOf(stats.dbMs);
  const repeatWastePct = pctOf(stats.repeatMs);
  // A watched request always made at least one database call, so the worst
  // repeat is at least 1 — "1" is the honest reading for an app that never
  // ran the same statement twice.
  const repeatWorst = Math.max(1, Math.round(stats.repeatWorst));
  const waitMsPerRequest = Math.round((stats.dbMs / Math.max(1, stats.watchedRequests)) * 10) / 10;
  const { score, decided } = worstOfParts([
    {
      code: DECIDED_PART.dbWait,
      score:
        waitMsPerRequest <= DB_WAIT_MS_PER_REQUEST_FLOOR
          ? 100
          : linearScore(
              waitPct,
              DB_WAIT_PCT_THRESHOLDS.good,
              DB_WAIT_PCT_THRESHOLDS.poor,
            ),
      figure: waitPct,
      poorAt: DB_WAIT_PCT_THRESHOLDS.poor,
    },
    {
      code: DECIDED_PART.dbRepeat,
      score: linearScore(
        repeatWorst,
        DB_REPEAT_BURST_THRESHOLDS.good,
        DB_REPEAT_BURST_THRESHOLDS.poor,
      ),
      figure: repeatWorst,
      poorAt: DB_REPEAT_BURST_THRESHOLDS.poor,
    },
  ]);
  return {
    score,
    rating: ratingFor(score),
    measurable: 1,
    ...decidedFieldsOf(decided),
    waitMsPerRequest,
    waitPct,
    callCount: stats.callCount,
    watchedRequests: stats.watchedRequests,
    hostedCalls: stats.hostedCalls,
    repeatWorst,
    repeatRequests: stats.repeatRequests,
    repeatWastePct,
    // Deliberately outside the score: an unbounded result set is a finding to
    // hand a developer with the rule that caps it, not a number that quietly
    // marks a legitimately large query as poor.
    rowsWorst:
      typeof stats.rowsWorst === "number" &&
      stats.rowsWorst >= DB_LARGE_RESULT_ROWS
        ? Math.floor(stats.rowsWorst)
        : null,
    unwatchedClients,
  };
}

/* ─── Database sequencing (was the work in single file?) ─────────────────
 *
 * The database reading above says how many calls a request made and how long
 * it waited. It says NOTHING about sequencing, and that is the difference
 * between a page that feels instant and one that feels broken: ten calls
 * issued together and ten calls issued one after another produce an identical
 * reading. This axis is the missing half — how many ROUND-TRIP WAVES a request
 * took, and how much of its database time could not overlap with anything.
 *
 * THE RULE IS DEFINED ONCE, for every kit, in docs/db-round-trip-waves.md: a
 * call opens a wave when nothing else is in flight at its start, and joins the
 * wave already running otherwise. It is computed from TWO TIMESTAMPS PER CALL
 * and nothing else — no statement text, no table name, no column name, no
 * parameter. That is what makes it shippable at all.
 *
 * WHAT IS SCORED. The worst request's wave count, and only that. Good at 2
 * (a request that talks to the database once or twice in sequence is an
 * ordinary request), poor at 10 (the page is a queue of round trips). The
 * single-file SHARE is reported beside it rather than scored: an app that
 * makes one query per request is 100% "single file" and perfectly healthy, so
 * scoring the share alone would mark the simplest app poor.
 *
 * ADDITIVE + DISPLAY-ONLY: never feeds the composite Speed score, and it moves
 * no existing reading — dbWork's numbers are untouched, to the digit.
 */

/** Round-trip waves in ONE request. Good at 2, poor at 10. */
export const DB_WAVE_BURST_THRESHOLDS = { good: 2, poor: 10 } as const;

/** Minimal label-free aggregate consumed from the sequencing sweep. Six
 *  numbers; nothing in this shape can carry a statement, a table or a host. */
export interface DbSequencingStatsLike {
  /** Requests whose sequencing was judged. */
  waveRequests: number;
  /** Round-trip waves across those requests. */
  wavesTotal: number;
  /** Most waves any single request took. */
  wavesWorst: number;
  /** Wall ms those requests spent with at least one call outstanding. */
  spanMs: number;
  /** Sum of the call durations over the same requests. */
  sumMs: number;
  /** Database libraries this app loaded that the kit cannot watch. */
  unwatchedClients: number;
}

export interface DbSequencingResult {
  score: number | null;
  rating: AxisRating;
  /** 0 = watching, nothing honest to say yet. 1 = a real reading. */
  measurable: 0 | 1;
  /** Most round-trip waves one request took, or null while pending. */
  wavesWorst: number | null;
  /** Mean waves per judged request, one decimal place. */
  wavesAvg: number;
  /** Share of the database time that could not overlap with another call,
   *  0..100. 100 means every call waited for the one before it. */
  seriesPct: number;
  /** Requests this reading judged. */
  watchedRequests: number;
  unwatchedClients: number;
}

/**
 * Score the database-sequencing axis, or return null when there is nothing
 * honest to say yet.
 *
 * The three outcomes are {@link computeDbWork}'s, deliberately: null (absent,
 * which every surface reads as "cannot tell"), measurable 0 (too few judged
 * requests but this app loaded a database library the kit cannot watch, so
 * silence would let a blind spot pass for a clean app), measurable 1 (a real
 * reading). The choice is made HERE, before a score, a rating or a caption
 * exists, so an unmeasurable state can never be rendered as a confident zero.
 */
export function computeDbSequencing(
  stats: DbSequencingStatsLike,
): DbSequencingResult | null {
  if (!stats) return null;
  const unwatchedClients = Math.max(0, Math.round(stats.unwatchedClients ?? 0));
  const judged = Math.max(0, Math.round(stats.waveRequests ?? 0));
  if (judged < DB_WORK_MIN_REQUESTS) {
    if (unwatchedClients === 0) return null;
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      wavesWorst: null,
      wavesAvg: 0,
      seriesPct: 0,
      watchedRequests: judged,
      unwatchedClients,
    };
  }
  // A judged request made at least one call, so it took at least one wave.
  const wavesWorst = Math.max(1, Math.round(stats.wavesWorst));
  const wavesAvg = Math.round((stats.wavesTotal / judged) * 10) / 10;
  // Session sums, never a mean of per-request ratios: a hundred one-query
  // requests must not drown the page that made forty sequential calls.
  const seriesPct =
    stats.sumMs > 0
      ? Math.min(
          100,
          Math.max(0, Math.round((stats.spanMs / stats.sumMs) * 100)),
        )
      : 100;
  const score = linearScore(
    wavesWorst,
    DB_WAVE_BURST_THRESHOLDS.good,
    DB_WAVE_BURST_THRESHOLDS.poor,
  );
  return {
    score,
    rating: ratingFor(score),
    measurable: 1,
    wavesWorst,
    wavesAvg,
    seriesPct,
    watchedRequests: judged,
    unwatchedClients,
  };
}

/* ─── Database row volume (how much a query hands back) ──────────────────
 *
 * The database reading already collects the worst single result size, but
 * reports it only once it crosses the unbounded-result line and never scores
 * it. So a page whose row volume climbs steadily as a customer's data grows
 * produces no signal at all until it falls off the cliff — which is exactly
 * the fault the rule book's "cost grows with the account" advice describes,
 * and exactly the fault nobody can see coming.
 *
 * This axis makes the same measurement EARNED: scored on a continuous band, so
 * the number moves while the data grows, and reported beside the typical read
 * so one legitimately large export cannot masquerade as a growing page.
 *
 * A COUNT OF ROWS, NEVER A ROW. No value, column name or table name is read to
 * obtain any of it, and dbWork's own `rowsWorst` field keeps its old meaning
 * and its old threshold untouched.
 */

/** The worst single result set. Good at 500 rows, poor at 10,000. */
export const DB_ROWS_WORST_THRESHOLDS = { good: 500, poor: 10_000 } as const;
/** The TYPICAL read. Good at 100 rows, poor at 2,000 — a page that averages
 *  two thousand rows a query is already growing with its customer. */
export const DB_ROWS_TYPICAL_THRESHOLDS = { good: 100, poor: 2_000 } as const;

/** Pool occupancy: a pool is comfortably provisioned through 60% use and
 * under sustained pressure at 95%. Shared with the Ruby and Go kits. */
export const DB_POOL_USED_PCT_THRESHOLDS = { good: 60, poor: 95 } as const;

export interface DbPoolPressureStatsLike {
  busy: number;
  idle: number;
  waiting: number;
  size: number;
}

export interface DbPoolPressureResult extends DbPoolPressureStatsLike {
  score: number;
  rating: AxisRating;
  usedPct: number;
}

/** Score a real pool-state read. An absent or unbounded pool has no honest
 * occupancy denominator and therefore produces no axis. */
export function computeDbPoolPressure(
  stats: DbPoolPressureStatsLike | null,
): DbPoolPressureResult | null {
  if (!stats || !Number.isFinite(stats.size) || stats.size <= 0) return null;
  const size = Math.max(1, Math.round(stats.size));
  const busy = Math.max(0, Math.round(stats.busy));
  const idle = Math.max(0, Math.round(stats.idle));
  const waiting = Math.max(0, Math.round(stats.waiting));
  const usedPct = Math.max(
    0,
    Math.min(100, Math.round(((100 * busy) / size) * 10) / 10),
  );
  const score = linearScore(
    usedPct,
    DB_POOL_USED_PCT_THRESHOLDS.good,
    DB_POOL_USED_PCT_THRESHOLDS.poor,
  );
  return {
    score,
    rating: ratingFor(score),
    usedPct,
    busy,
    idle,
    waiting,
    size,
  };
}

/**
 * The pool read as the snapshot publishes it, under the start-up rule
 * (peak-rate family): a pool filling while the app warms its connections is
 * start-up, not pressure, so a young process says it is settling and carries
 * no score. After settling the point-in-time read is graded and marked.
 */
export function settledDbPoolPressure(
  stats: DbPoolPressureStatsLike | null,
  nowMs: number = Date.now(),
):
  | (DbPoolPressureResult & { settleRule: typeof SETTLE_RULE })
  | { score: null; rating: "pending"; settleRule: typeof SETTLE_RULE }
  | null {
  const result = computeDbPoolPressure(stats);
  if (!result) return null;
  if (isSettling("peakRate", nowMs)) return settlingReading({ score: null });
  return markSettled(result);
}

/** Minimal label-free aggregate consumed from the row-count tally. */
export interface DbRowVolumeStatsLike {
  /** Requests in which at least one database call was watched. */
  watchedRequests: number;
  /** Largest single-statement row count seen in any watched request. */
  rowsWorst: number;
  /** Rows handed back by every call that reported a count, summed. */
  rowsSum: number;
  /** How many calls reported a row count at all. */
  rowsCalls: number;
  /** Database libraries this app loaded that the kit cannot watch. */
  unwatchedClients: number;
}

export interface DbRowVolumeResult extends Partial<DecidedPart> {
  score: number | null;
  rating: AxisRating;
  measurable: 0 | 1;
  /** Largest row count one statement handed back, or null while pending. */
  worstRows: number | null;
  /** Mean rows over the calls that reported a count. */
  rowsAvg: number;
  /** How many calls reported a row count — a cursor or a stream reports none,
   *  and "we never saw a size" must not read as "it returned nothing". */
  sizedCalls: number;
  watchedRequests: number;
  unwatchedClients: number;
}

/**
 * Score the row-volume axis, or return null when there is nothing honest to
 * say yet.
 *
 * Same three outcomes as {@link computeDbWork}, with one more way to be
 * unmeasurable: an app whose every watched call was a cursor or a stream
 * reported no size at all. That is not a zero-row app — it is an app we cannot
 * measure this way — so the axis is withheld rather than scored.
 */
export function computeDbRowVolume(
  stats: DbRowVolumeStatsLike,
): DbRowVolumeResult | null {
  if (!stats) return null;
  const unwatchedClients = Math.max(0, Math.round(stats.unwatchedClients ?? 0));
  const watched = Math.max(0, Math.round(stats.watchedRequests ?? 0));
  const sizedCalls = Math.max(0, Math.round(stats.rowsCalls ?? 0));
  if (watched < DB_WORK_MIN_REQUESTS || sizedCalls === 0) {
    if (unwatchedClients === 0) return null;
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      worstRows: null,
      rowsAvg: 0,
      sizedCalls,
      watchedRequests: watched,
      unwatchedClients,
    };
  }
  const worstRows = Math.max(0, Math.floor(stats.rowsWorst ?? 0));
  const rowsAvg = Math.max(0, Math.round((stats.rowsSum ?? 0) / sizedCalls));
  const { score, decided } = worstOfParts([
    {
      code: DECIDED_PART.rowsWorst,
      score: linearScore(
        worstRows,
        DB_ROWS_WORST_THRESHOLDS.good,
        DB_ROWS_WORST_THRESHOLDS.poor,
      ),
      figure: worstRows,
      poorAt: DB_ROWS_WORST_THRESHOLDS.poor,
    },
    {
      code: DECIDED_PART.rowsTypical,
      score: linearScore(
        rowsAvg,
        DB_ROWS_TYPICAL_THRESHOLDS.good,
        DB_ROWS_TYPICAL_THRESHOLDS.poor,
      ),
      figure: rowsAvg,
      poorAt: DB_ROWS_TYPICAL_THRESHOLDS.poor,
    },
  ]);
  return {
    score,
    rating: ratingFor(score),
    measurable: 1,
    ...decidedFieldsOf(decided),
    worstRows,
    rowsAvg,
    sizedCalls,
    watchedRequests: watched,
    unwatchedClients,
  };
}

/* ─── Outside services: WHICH dependency a request waits on ─────────────
 *
 * The outbound pool could already say "some calls happened, some were slow".
 * This says WHICH KIND of service — sign-in, uploads, payments, messaging,
 * stored-knowledge search, or a destination we do not recognise — so the
 * reading becomes a sentence somebody can act on.
 *
 * ADDITIVE + DISPLAY-ONLY: never feeds the composite Speed score, and never
 * moves the network, repeated-work, database or AI readings. The same call
 * still feeds all of them exactly as it did before.
 */
export const DEP_WAIT_PCT_THRESHOLDS = { good: 25, poor: 75 } as const;
/** Share of runs that failed. Any failing job matters, so the good band is a
 *  fraction of a percent rather than zero. */
export const JOB_FAIL_PCT_THRESHOLDS = { good: 1, poor: 20 } as const;

/* ─── AI calls: how long the AI part of a request takes ─────────────────
 *
 * Every app these builders produce calls an AI provider, and that call is
 * usually the slowest thing in the request. This axis reports the SHAPE of
 * that wait — how long the calls took, how long before the first words of a
 * streamed answer appeared, whether a stream went quiet halfway, and which of
 * the failures that actually happen to AI calls happened here.
 *
 * WHAT IS SCORED, AND WHAT DELIBERATELY IS NOT.
 *   • The share of a request spent on AI is REPORTED and never scored. Time
 *     spent waiting for a model is the work the app exists to do; marking an
 *     app poor for doing it would be the meter misunderstanding the product.
 *     It is reported so it can sit beside the database share in the request
 *     picture, which is the comparison a developer actually needs.
 *   • Failures ARE scored: a call that never delivered an answer is time and
 *     money spent for nothing, whoever's fault it was.
 *   • Time to the first words IS scored, for streamed answers only. On a
 *     stream that is the number a person experiences; total duration is close
 *     to meaningless because it tracks the length of the answer.
 *
 * ADDITIVE + DISPLAY-ONLY: never feeds the composite Speed score.
 */

/** Share of AI calls that delivered nothing. Good at none, poor at 1 in 10. */
export const AI_FAIL_PCT_THRESHOLDS = { good: 0, poor: 10 } as const;
/**
 * Time to the first words of a streamed answer.
 *
 * Good at 1s and poor at 8s: under a second the answer feels immediate, and
 * past eight a reader has already decided the app is broken. Applied only to
 * streamed replies, and only once some have been seen.
 */
export const AI_TTFT_MS_THRESHOLDS = { good: 1000, poor: 8000 } as const;
/** Settled streamed calls before time to first token is judged (the same
 *  floor every kit applies). */
export const AI_TTFT_MIN_STREAMS = 5;

/** Watched requests needed before the axis leaves "pending". Mirrors the
 *  shared MIN_SAMPLES_FOR_AXES gate. */
export const AI_WORK_MIN_REQUESTS = MIN_SAMPLES_FOR_AXES;

/** Minimal label-free aggregate consumed from the AI-call detector. Every
 *  member is a number: no provider name, host, URL, model, prompt or answer
 *  can reach a scorer, because none of them is in this shape. */
export interface AiCallStatsLike {
  watchedRequests: number;
  watchedRequestMs: number;
  aiMs: number;
  callCount: number;
  providerCount: number;
  /** 1-based position in the maintained provider list; 0 when none. */
  topProvider: number;
  p75Ms: number;
  worstMs: number;
  streamCount: number;
  ttftP75Ms: number;
  /** Settled streamed calls the p75 above rests on (the start-up rule). */
  ttftSettledCount?: number;
  stallCount: number;
  failCount: number;
  rateLimitedCount: number;
  quotaCount: number;
  timeoutCount: number;
  truncatedCount: number;
  filteredCount: number;
  serverMsP75: number;
  serverMsCalls: number;
  unwatchedClients: number;
  /** Calls whose PATH looked like an AI inference request while their host
   *  classified to nothing — the app's own model server, a private gateway or
   *  a regional endpoint, none of which this kit can measure until it is
   *  declared. A count only; absent from a kit that cannot tell. */
  unclassifiedCalls?: number;
  tokensIn: number;
  tokensOut: number;
  cachedIn: number;
  costMicros: number;
  reportedCostCalls: number;
  pricedCalls: number;
  unpricedCalls: number;
  worstRequestCostMicros: number;
  windowMs: number;
  usageMissingCalls: number;
  streamUsageMissingCalls: number;
  /** Calls that went to an endpoint the app declared as its own. */
  declaredCalls?: number;
  /** Of those, the ones we saw usage for and deliberately did not price. */
  declaredUnpricedCalls?: number;
  /** How many endpoints are declared — so "none declared" and "declared, but
   *  never called" are different answers. */
  declaredEndpoints?: number;
  promptRepeatWorst: number;
  promptRepeatRequests: number;
  serialWorst: number;
  serialRequests: number;
  noTimeLimitCalls: number;
  retryNoBackoffCount: number;
  headroomReads: number;
  /** Settled headroom readings of the newest half hour, and the median of
   *  each budget across them: the meter grades the TYPICAL settled reading,
   *  never the worst ever seen (the start-up rule). */
  headroomSettledReads?: number;
  typicalRequestsPct?: number | null;
  typicalTokensPct?: number | null;
  worstRequestsPct: number | null;
  worstTokensPct: number | null;
  worstRetryAfterMs: number;
}

export interface AiCallsResult extends Partial<DecidedPart> {
  score: number | null;
  rating: AxisRating;
  /** 0 = watching, but nothing honest to score yet AND a blind spot is the
   *  reason the tile must not read as "this app makes no AI calls". */
  measurable: 0 | 1;
  waitPct: number;
  callCount: number;
  watchedRequests: number;
  providerCount: number;
  topProvider: number;
  p75Ms: number;
  worstMs: number;
  streamCount: number;
  /** p75 time to first words over SETTLED streamed answers (the start-up
   *  rule). ABSENT until one was timed — never a 0 standing in for "none". */
  ttftP75Ms?: number;
  stallCount: number;
  failCount: number;
  rateLimitedCount: number;
  quotaCount: number;
  timeoutCount: number;
  truncatedCount: number;
  filteredCount: number;
  serverMsP75: number;
  serverMsCalls: number;
  unwatchedClients: number;
  /** AI-shaped calls to a host this kit could not classify — see
   *  AI_SHAPED_PATHS in aiCalls.ts. Never part of any count above. */
  unclassifiedCalls: number;
}

/**
 * Score the AI-wait axis, or return null when there is nothing honest to say.
 *
 * THREE OUTCOMES, the same three the database axis uses:
 *   • null — this app made no AI calls, or too few to read, and there is no
 *     blind spot. The axis is absent from the snapshot, which every surface
 *     reads as "cannot tell". An app that calls no AI provider shows nothing
 *     here rather than a row of zeros, and a runtime without this reading
 *     looks exactly the same — neither can be mistaken for a measured zero.
 *   • measurable 0 — too few watched requests to score, but this app loaded an
 *     HTTP client the kit cannot watch, so a real blind spot would otherwise
 *     pass for an app with no AI in it.
 *   • measurable 1 — a real reading.
 */
export function computeAiCalls(stats: AiCallStatsLike): AiCallsResult | null {
  if (!stats) return null;
  const unwatchedClients = Math.max(0, Math.round(stats.unwatchedClients ?? 0));
  const unclassifiedCalls = Math.max(
    0,
    Math.round(stats.unclassifiedCalls ?? 0),
  );
  const ttftP75Ms =
    (stats.ttftSettledCount ?? 1) > 0
      ? Math.max(0, Math.round(stats.ttftP75Ms ?? 0))
      : 0;
  const base = {
    callCount: Math.max(0, Math.round(stats.callCount ?? 0)),
    watchedRequests: Math.max(0, Math.round(stats.watchedRequests ?? 0)),
    providerCount: Math.max(0, Math.round(stats.providerCount ?? 0)),
    topProvider: Math.max(0, Math.round(stats.topProvider ?? 0)),
    p75Ms: Math.max(0, Math.round(stats.p75Ms ?? 0)),
    worstMs: Math.max(0, Math.round(stats.worstMs ?? 0)),
    streamCount: Math.max(0, Math.round(stats.streamCount ?? 0)),
    // Only a first-words wait that was really timed: a settled stream. No
    // such stream yet (every one so far was a provider's first, or came in
    // before the process settled) is no figure at all, never 0ms.
    ...(ttftP75Ms > 0 ? { ttftP75Ms } : {}),
    stallCount: Math.max(0, Math.round(stats.stallCount ?? 0)),
    failCount: Math.max(0, Math.round(stats.failCount ?? 0)),
    rateLimitedCount: Math.max(0, Math.round(stats.rateLimitedCount ?? 0)),
    quotaCount: Math.max(0, Math.round(stats.quotaCount ?? 0)),
    timeoutCount: Math.max(0, Math.round(stats.timeoutCount ?? 0)),
    truncatedCount: Math.max(0, Math.round(stats.truncatedCount ?? 0)),
    filteredCount: Math.max(0, Math.round(stats.filteredCount ?? 0)),
    serverMsP75: Math.max(0, Math.round(stats.serverMsP75 ?? 0)),
    serverMsCalls: Math.max(0, Math.round(stats.serverMsCalls ?? 0)),
    unwatchedClients,
    unclassifiedCalls,
  };
  // No AI call has EVER been seen. With nothing else to report, that is an
  // app with no AI layer, and the honest answer is silence.
  //
  // Two things break that silence, and neither is a reading. An AI-SHAPED
  // call to a host we could not classify: the app IS doing AI work and this
  // kit could not see whose. And a loaded HTTP client this kit cannot watch:
  // "no AI here" and "AI we cannot see" must not arrive looking the same,
  // which is the whole reason the count travels. Nothing is scored off
  // either — the axis comes back unmeasurable, carrying the count and nothing
  // else.
  if (base.callCount === 0) {
    if (unclassifiedCalls === 0 && unwatchedClients === 0) return null;
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      waitPct: 0,
      ...base,
    };
  }
  if (base.watchedRequests < AI_WORK_MIN_REQUESTS) {
    if (unwatchedClients === 0 && unclassifiedCalls === 0) return null;
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      waitPct: 0,
      ...base,
    };
  }
  const waitPct = (() => {
    const raw =
      stats.watchedRequestMs > 0
        ? (stats.aiMs / stats.watchedRequestMs) * 100
        : 0;
    return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
  })();
  const failPct =
    base.callCount > 0 ? (base.failCount / base.callCount) * 100 : 0;
  const terms: ScoredPart[] = [
    {
      code: DECIDED_PART.aiFailures,
      score: linearScore(
        failPct,
        AI_FAIL_PCT_THRESHOLDS.good,
        AI_FAIL_PCT_THRESHOLDS.poor,
      ),
      figure: Math.round(failPct * 10) / 10,
      poorAt: AI_FAIL_PCT_THRESHOLDS.poor,
    },
  ];
  // Only judge the first-words wait where there were streamed answers to
  // judge. An app that never streams is not slow at streaming.
  // Time to first token is judged only from AI_TTFT_MIN_STREAMS settled
  // streamed calls: the first call pays TLS and the model's warm-up.
  if ((stats.ttftSettledCount ?? 0) >= AI_TTFT_MIN_STREAMS && ttftP75Ms > 0) {
    terms.push({
      code: DECIDED_PART.aiFirstWords,
      score: linearScore(
        ttftP75Ms,
        AI_TTFT_MS_THRESHOLDS.good,
        AI_TTFT_MS_THRESHOLDS.poor,
      ),
      figure: ttftP75Ms,
      poorAt: AI_TTFT_MS_THRESHOLDS.poor,
    });
  }
  const { score, decided } = worstOfParts(terms);
  return {
    score,
    rating: ratingFor(score),
    measurable: 1,
    waitPct,
    ...base,
    ...decidedFieldsOf(decided),
  };
}

/* ─── AI spend: tokens, cache and money ─────────────────────────────────
 *
 * The token counts a provider returns, what they cost, and how much of the
 * input it served out of its own prompt cache — which is the whole difference
 * between an expensive app and a cheap one.
 *
 * WHAT IS SCORED. Two things a developer can actually fix:
 *   • Usage the app never got told. On a streamed reply some providers only
 *     report usage when the caller asks for it, so a project can be flying
 *     blind on cost without knowing. That is a finding with a one-line fix,
 *     and it is scored so it does not sit unnoticed.
 *   • The same prompt sent more than once inside one request — the same tokens
 *     paid for twice.
 *
 * WHAT IS NOT SCORED, ON PURPOSE. Money. A big bill can be exactly right: an
 * app that does real work with a real model is not a broken app. Cost is
 * reported so the developer can see it, never graded. A cold prompt cache is
 * likewise reported as a finding rather than a mark, because an app whose
 * prompts have no cacheable prefix has nothing to fix.
 */

/** Share of AI calls whose usage was never reported. */
export const AI_USAGE_MISSING_PCT_THRESHOLDS = { good: 0, poor: 50 } as const;
/** Identical prompts inside ONE request. 1 is the honest floor. */
export const AI_PROMPT_REPEAT_THRESHOLDS = { good: 1, poor: 4 } as const;

export interface AiSpendResult {
  score: number | null;
  rating: AxisRating;
  measurable: 0 | 1;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  cachedIn: number;
  /** Share of input tokens the provider served from its own cache, or null
   *  when no reply ever reported an input-token count — which is "cannot
   *  tell", never a cold cache. */
  cacheHitPct: number | null;
  costMicros: number;
  reportedCostCalls: number;
  pricedCalls: number;
  unpricedCalls: number;
  costPerRequestMicros: number;
  worstRequestCostMicros: number;
  /** The session window the cost accrued over, so a surface can project a
   *  monthly rate and SAY it is a projection over this window. */
  windowMs: number;
  usageMissingCalls: number;
  usageMissingPct: number;
  streamUsageMissingCalls: number;
  /**
   * Calls to an endpoint the app hosts itself, and how many of those carried
   * usage we refused to price. Both are needed to read the money honestly: a
   * cost figure that covers only part of an app's AI work must be able to say
   * which part it left out, and WHY it left it out — "you host this" is a
   * different sentence from "the provider reported nothing".
   */
  declaredCalls: number;
  declaredUnpricedCalls: number;
  repeatWorst: number | null;
  repeatRequests: number;
  /** The price table's publication date, as whole days since the epoch, so no
   *  surface can show an estimate without being able to show its age. */
  priceTableDay: number;
}

/**
 * Score the AI-spend axis, or return null when this app buys no AI at all.
 *
 * `priceTableDay` is supplied by the caller rather than imported, so this
 * module stays free of the price table and the scorer stays pure.
 */
export function computeAiSpend(
  stats: AiCallStatsLike,
  priceTableDay: number,
): AiSpendResult | null {
  if (!stats) return null;
  const calls = Math.max(0, Math.round(stats.callCount ?? 0));
  if (calls === 0) return null;
  const tokensIn = Math.max(0, Math.round(stats.tokensIn ?? 0));
  const tokensOut = Math.max(0, Math.round(stats.tokensOut ?? 0));
  const cachedIn = Math.max(0, Math.round(stats.cachedIn ?? 0));
  const usageMissingCalls = Math.max(
    0,
    Math.round(stats.usageMissingCalls ?? 0),
  );
  const watchedRequests = Math.max(0, Math.round(stats.watchedRequests ?? 0));
  const costMicros = Math.max(0, Math.round(stats.costMicros ?? 0));
  const usageMissingPct =
    Math.round((usageMissingCalls / calls) * 100 * 10) / 10;
  const shape = {
    calls,
    tokensIn,
    tokensOut,
    cachedIn,
    // Never 0% for an app whose provider simply reported no input tokens —
    // that is "cannot tell", and a 0% cache hit rate is a very different
    // (and actionable) statement.
    cacheHitPct:
      tokensIn > 0
        ? Math.max(
            0,
            Math.min(100, Math.round((cachedIn / tokensIn) * 1000) / 10),
          )
        : null,
    costMicros,
    reportedCostCalls: Math.max(0, Math.round(stats.reportedCostCalls ?? 0)),
    pricedCalls: Math.max(0, Math.round(stats.pricedCalls ?? 0)),
    unpricedCalls: Math.max(0, Math.round(stats.unpricedCalls ?? 0)),
    // The denominator is an inbound REQUEST that called AI, never an AI call
    // and never the app's whole traffic: `watchedRequests` is only incremented
    // for a request that made at least one call, so a request that made three
    // is charged once, at what all three cost together. That is the number a
    // developer budgets with. Money per CALL is `costMicros / pricedCalls`,
    // derived where it is shown rather than carried twice on the wire.
    costPerRequestMicros:
      watchedRequests > 0 ? Math.round(costMicros / watchedRequests) : 0,
    worstRequestCostMicros: Math.max(
      0,
      Math.round(stats.worstRequestCostMicros ?? 0),
    ),
    windowMs: Math.max(0, Math.round(stats.windowMs ?? 0)),
    usageMissingCalls,
    usageMissingPct,
    streamUsageMissingCalls: Math.max(
      0,
      Math.round(stats.streamUsageMissingCalls ?? 0),
    ),
    declaredCalls: Math.max(0, Math.round(stats.declaredCalls ?? 0)),
    // The deliberate abstentions are a SUBSET of the unpriced calls, and every
    // surface subtracts one from the other to separate "we could not price
    // this" from "we chose not to". Sanitising the two independently lets a
    // malformed or older stats object emit a pair that cannot both be true,
    // and the subtraction then goes negative on a real dashboard. Clamped
    // here, at the boundary where the numbers are emitted.
    declaredUnpricedCalls: Math.min(
      Math.max(0, Math.round(stats.unpricedCalls ?? 0)),
      Math.max(0, Math.round(stats.declaredUnpricedCalls ?? 0)),
    ),
    repeatRequests: Math.max(0, Math.round(stats.promptRepeatRequests ?? 0)),
    priceTableDay: Math.round(priceTableDay),
  };
  if (watchedRequests < AI_WORK_MIN_REQUESTS) {
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      repeatWorst: null,
      ...shape,
    };
  }
  // A watched request always made at least one AI call, so the worst repeat is
  // at least 1 — "1" is the honest reading for an app that never sent the same
  // prompt twice.
  const repeatWorst = Math.max(1, Math.round(stats.promptRepeatWorst ?? 0));
  // The shared decision (docs/settle-rule-decisions.md, aiSpend): spend has no
  // universal yardstick (a price is right or wrong only against the owner's
  // own budget), and a repeated prompt is not spend. Every number rides;
  // nothing is graded, in every kit that carries the meter.
  return {
    score: null,
    rating: "not-scored",
    measurable: 1,
    repeatWorst,
    ...shape,
  };
}

/* ─── AI rate-limit headroom ────────────────────────────────────────────
 *
 * How close this project is to its provider's published limits, in the SAME
 * shape as every other ceiling this kit reports (the function-host timeout and
 * memory headroom axes): a remaining percentage, worst-seen, with the refusals
 * that already happened beside it.
 *
 * Free to collect — the providers publish it on every reply — and honest by
 * omission: a project whose provider publishes nothing gets no axis at all
 * rather than a comforting 100%.
 */

/** Remaining share of the window. Good with 40% left, poor at 5%. */
export const AI_HEADROOM_PCT_THRESHOLDS = { good: 40, poor: 5 } as const;
/** Settled readings (of the newest half hour) before headroom is graded: the
 *  same rule every kit applies. */
export const AI_HEADROOM_MIN_READS = 3;

export interface AiHeadroomResult extends Partial<DecidedPart> {
  score: number | null;
  rating: AxisRating;
  measurable: 0 | 1;
  /** The start-up rule's marker (settleRule.ts). */
  settleRule?: number;
  /** The tighter budget's typical settled headroom: the figure that decided. */
  typicalHeadroomPct?: number;
  reads: number;
  worstRequestsPct: number;
  worstTokensPct: number;
  refusals: number;
  worstRetryAfterMs: number;
}

/**
 * Score the AI rate-limit headroom axis, or return null when the provider
 * published nothing to read.
 *
 * A refusal that arrived with no headroom headers still ships the axis, with
 * measurable 0 — being refused is itself the strongest possible evidence that
 * a ceiling exists, and staying silent about it would be the one dishonest
 * outcome here.
 */
export function computeAiHeadroom(
  stats: AiCallStatsLike,
): AiHeadroomResult | null {
  if (!stats) return null;
  const reads = Math.max(0, Math.round(stats.headroomReads ?? 0));
  const refusals = Math.max(0, Math.round(stats.rateLimitedCount ?? 0));
  if (reads === 0 && refusals === 0) return null;
  const worstRetryAfterMs = Math.max(
    0,
    Math.round(stats.worstRetryAfterMs ?? 0),
  );
  const pct = (v: number | null): number | null =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.max(0, Math.min(100, Math.round(v * 10) / 10))
      : null;
  const req = pct(stats.worstRequestsPct ?? null);
  const tok = pct(stats.worstTokensPct ?? null);
  if (req === null && tok === null) {
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      reads,
      // Not "full" — unknown. The tile reads measurable 0 first and says so.
      worstRequestsPct: 0,
      worstTokensPct: 0,
      refusals,
      worstRetryAfterMs,
    };
  }
  // The tighter of the two ceilings decides: a project with plenty of request
  // headroom and no tokens left is out of headroom.
  const context = {
    reads,
    worstRequestsPct: req ?? 100,
    worstTokensPct: tok ?? 100,
    refusals,
    worstRetryAfterMs,
  };
  // The start-up rule (startupEvent): grade the TYPICAL (median) headroom of
  // the settled readings in the newest half hour, from AI_HEADROOM_MIN_READS
  // or more. The worst ever seen (a boot-time refusal, a quota window that
  // has since reset) rides as context and never decides.
  // (The window and the medians are taken where the readings live, aiCalls.ts.)
  const settledReads = Math.max(0, Math.round(stats.headroomSettledReads ?? 0));
  const typReq = pct(stats.typicalRequestsPct ?? null);
  const typTok = pct(stats.typicalTokensPct ?? null);
  if (settledReads < AI_HEADROOM_MIN_READS || (typReq === null && typTok === null)) {
    return { score: null, rating: "pending", measurable: 1, settleRule: SETTLE_RULE, ...context };
  }
  const typical = Math.min(typReq ?? 100, typTok ?? 100);
  // linearScore rises as the value falls, and headroom is the other way
  // round, so it is scored on how much of the window is USED.
  const usedScore = (left: number): number =>
    linearScore(
      100 - left,
      100 - AI_HEADROOM_PCT_THRESHOLDS.good,
      100 - AI_HEADROOM_PCT_THRESHOLDS.poor,
    );
  // The tighter budget decides. Scoring each budget and taking the worse is
  // the same number as scoring the tighter one (the band is monotonic), and
  // it says WHICH budget it was. A budget the provider never published is
  // not a part at all — it cannot be the tighter one.
  const parts: ScoredPart[] = [];
  if (typReq !== null) {
    parts.push({
      code: DECIDED_PART.headroomRequests,
      score: usedScore(typReq),
      figure: typReq,
      poorAt: AI_HEADROOM_PCT_THRESHOLDS.poor,
    });
  }
  if (typTok !== null) {
    parts.push({
      code: DECIDED_PART.headroomTokens,
      score: usedScore(typTok),
      figure: typTok,
      poorAt: AI_HEADROOM_PCT_THRESHOLDS.poor,
    });
  }
  const { score, decided } = worstOfParts(parts);
  return {
    score,
    rating: ratingFor(score),
    measurable: 1,
    settleRule: SETTLE_RULE,
    typicalHeadroomPct: typical,
    ...context,
    ...decidedFieldsOf(decided),
  };
}

/** Setup-time bands. 20 ms is same-region; 150 ms is another continent. */
export const DEPENDENCY_DISTANCE_SETUP_MS_THRESHOLDS = {
  good: 20,
  poor: 150,
} as const;

/** Runs that should have happened and did not. One is a real problem. */
export const JOB_MISSED_THRESHOLDS = { good: 0, poor: 3 } as const;

/** Runs that began while another of the same name was still going. */
export const JOB_OVERLAP_THRESHOLDS = { good: 0, poor: 5 } as const;

/** Minimal label-free aggregate consumed from the background-work meter. */
export interface JobWorkStatsLike {
  /** Job runs that finished, successfully or not. */
  runs: number;
  /** Distinct job names tracked in full (including the everything-else group). */
  jobNames: number;
  /** Distinct names folded INTO the everything-else group. Visible on purpose:
   *  a capped view must say how much it is not showing. */
  otherNames: number;
  failed: number;
  /** Runs that were an attempt after the first. */
  retried: number;
  /** Highest attempt number any run reported. */
  retryWorst: number;
  /** Runs that began while another of the same name was still running. */
  overlaps: number;
  worstMs: number;
  p95Ms: number;
  /** Runs whose queue told us how long they waited. */
  waitRuns: number;
  /** p95 of that wait, or null when no system reported one. */
  waitP95Ms: number | null;
  /** Runs this kit concluded should have happened and did not. */
  missed: number;
  /** Jobs whose cadence this kit is confident about. `missed` means nothing
   *  without it: 0 missed across 0 recurring jobs is "we do not know", not
   *  "nothing was skipped". */
  recurring: number;
  /** Runs that arrived as a platform invocation (a hosted job service). */
  hostedRuns: number;
  /** Runs a developer marked by hand rather than an adapter finding them. */
  manualRuns: number;
  /** Job systems this kit attached to on its own. */
  attachedSystems: number;
  /** Job systems this app loaded that the kit has no safe funnel for. A blind
   *  spot, shipped beside the reading so it can never render as "no jobs". */
  unattachedSystems: number;
  /**
   * CAPACITY, read only from what the kit already sees of one job's runs —
   * never a question put to the queue itself. Present only once that job has
   * been watched for a whole window (jobWork.ts, the capacity window).
   *
   * Runs that job FINISHED over the window: a raw count. The axis turns it
   * into a per-minute rate through the earned-rate helper, beside the window
   * it was counted over (docs/rate-honesty-contract.md).
   */
  capFinishes?: number;
  /** The window those finishes were counted over, raw milliseconds. */
  capWindowMs?: number;
  /** 1 = at least one run of that job was in flight for the whole window. */
  capBusy?: 0 | 1;
  /** 1 = its queue wait rose across the window by more than its own noise. */
  capWaitGrowing?: 0 | 1;
}

/**
 * The capacity reading as the axis publishes it: the finish rate, the window
 * that earned it, and the two flags. On Background work `windowMs` belongs to
 * this reading alone — the axis publishes no other rate — and it is the field
 * the server's one window reader (`axisWindowMin`) judges the rate by.
 */
export interface CapacityFields {
  capFinishPerMin?: number;
  capBusy?: 0 | 1;
  capWaitGrowing?: 0 | 1;
  windowMs?: number;
}

/** The whole set or nothing: two flags without the rate they qualify, or a
 *  rate without the window that earned it, would be a sentence with a number
 *  missing. */
function wholeCapacity(
  rate: number | null | undefined,
  windowMs: number | null | undefined,
  busy: unknown,
  growing: unknown,
): CapacityFields {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) return {};
  if (typeof windowMs !== "number" || !Number.isFinite(windowMs) || windowMs <= 0) {
    return {};
  }
  return {
    capFinishPerMin: rate,
    capBusy: busy === 1 ? 1 : 0,
    capWaitGrowing: growing === 1 ? 1 : 0,
    windowMs,
  };
}

/** The capacity reading from the meter's raw counts. The rate goes through
 *  `earnedPerMin`, so a window too short to earn a per-minute projection
 *  publishes no capacity reading at all rather than a stretched one. */
export function capacityFieldsOf(
  stats: Pick<JobWorkStatsLike, "capFinishes" | "capWindowMs" | "capBusy" | "capWaitGrowing">,
): CapacityFields {
  const finishes = stats?.capFinishes;
  const windowMs = stats?.capWindowMs;
  if (typeof finishes !== "number" || !Number.isFinite(finishes) || finishes < 0) return {};
  if (typeof windowMs !== "number" || !Number.isFinite(windowMs)) return {};
  return wholeCapacity(
    earnedPerMin(finishes, windowMs),
    windowMs,
    stats.capBusy,
    stats.capWaitGrowing,
  );
}

/** A scored reading's capacity fields, copied onto the wire whole or not at
 *  all. Re-checks the set rather than trusting it. */
export function capacityWireFieldsOf(
  reading: CapacityFields | null | undefined,
): CapacityFields {
  if (!reading) return {};
  return wholeCapacity(
    reading.capFinishPerMin,
    reading.windowMs,
    reading.capBusy,
    reading.capWaitGrowing,
  );
}

/** How long a job waited in the queue before starting, p95, in ms. A queue
 *  falling behind shows up here long before anything errors. */
export const JOB_WAIT_MS_THRESHOLDS = { good: 1_000, poor: 60_000 } as const;

/** Job runs needed before the axis leaves "pending". Below this a single
 *  unlucky run would define the whole reading. Mirrors the shared gate. */
export const JOB_WORK_MIN_RUNS = MIN_SAMPLES_FOR_AXES;

export interface BackgroundWorkResult extends Partial<DecidedPart>, CapacityFields {
  score: number | null;
  rating: AxisRating;
  /** 0 = the kit is watching but has nothing it can honestly score yet, and a
   *  blind spot or a bare handful of runs is the reason the tile must not read
   *  as "no background work". 1 = the numbers below are a real reading. */
  measurable: 0 | 1;
  runs: number;
  jobNames: number;
  otherNames: number;
  failed: number;
  /** Share of runs that failed, 0..100. */
  failPct: number;
  retried: number;
  retryWorst: number;
  overlaps: number;
  p95Ms: number;
  worstMs: number;
  waitRuns: number;
  waitP95Ms: number | null;
  /** Runs that never happened, or null when no job has a cadence this kit is
   *  confident about — a zero there would be a claim it cannot back. */
  missed: number | null;
  recurring: number;
  hostedRuns: number;
  manualRuns: number;
  attachedSystems: number;
  unattachedSystems: number;
  // The capacity reading ({@link CapacityFields}) rides scored readings only.
}

/**
 * Score the background-work axis, or return null when there is nothing honest
 * to say yet.
 *
 * THREE OUTCOMES, deliberately distinct — the same shape the database-work
 * axis uses, for the same reason:
 *   • null — no runs, and no job system this kit failed to attach to. The axis
 *     is simply absent, which every surface renders as "cannot tell". A
 *     runtime without this meter reports the same way, so a project with no
 *     background work and a runtime with no reading look alike, and neither
 *     looks like a zero.
 *   • measurable 0 — too few runs to score, but this app either started some
 *     jobs or loaded a job system the kit cannot watch. Reporting nothing here
 *     would let a real blind spot pass for a project with no background work.
 *   • measurable 1 — a real reading.
 */
export function computeBackgroundWork(
  stats: JobWorkStatsLike,
): BackgroundWorkResult | null {
  if (!stats) return null;
  const unattachedSystems = Math.max(
    0,
    Math.round(stats.unattachedSystems ?? 0),
  );
  const runs = Math.max(0, Math.round(stats.runs ?? 0));
  const recurring = Math.max(0, Math.round(stats.recurring ?? 0));
  // A missing run is only claimable for a job whose cadence this kit knows.
  // Without one, `missed` is null — "we cannot tell" — never 0.
  const missed =
    recurring > 0 ? Math.max(0, Math.round(stats.missed ?? 0)) : null;

  if (runs < JOB_WORK_MIN_RUNS) {
    if (runs === 0 && unattachedSystems === 0) return null;
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      runs,
      jobNames: stats.jobNames ?? 0,
      otherNames: stats.otherNames ?? 0,
      failed: stats.failed ?? 0,
      failPct: 0,
      retried: stats.retried ?? 0,
      retryWorst: Math.max(1, Math.round(stats.retryWorst ?? 1)),
      overlaps: stats.overlaps ?? 0,
      p95Ms: 0,
      worstMs: 0,
      waitRuns: stats.waitRuns ?? 0,
      waitP95Ms: null,
      // NOT the missed count, even when one is known.
      //
      // This branch has already decided it cannot judge: `measurable: 0`, no
      // score, rating "pending". A bare figure published beside that verdict is
      // a number with nothing standing behind it — and it read as reassurance
      // exactly when it should not have, telling a developer "eight runs were
      // missed" on a surface that was simultaneously saying it could not tell.
      // The kit's own answer and Boosthis's answer must be the same answer, so
      // the side that cannot support the number does not publish one.
      missed: null,
      recurring,
      hostedRuns: stats.hostedRuns ?? 0,
      manualRuns: stats.manualRuns ?? 0,
      attachedSystems: stats.attachedSystems ?? 0,
      unattachedSystems,
    };
  }

  const failed = Math.max(0, Math.round(stats.failed ?? 0));
  const failPct = Math.round((failed / runs) * 1000) / 10;
  const overlaps = Math.max(0, Math.round(stats.overlaps ?? 0));

  const parts: ScoredPart[] = [
    {
      code: DECIDED_PART.jobFailures,
      score: linearScore(
        failPct,
        JOB_FAIL_PCT_THRESHOLDS.good,
        JOB_FAIL_PCT_THRESHOLDS.poor,
      ),
      figure: failPct,
      poorAt: JOB_FAIL_PCT_THRESHOLDS.poor,
    },
    {
      code: DECIDED_PART.jobOverlaps,
      score: linearScore(
        overlaps,
        JOB_OVERLAP_THRESHOLDS.good,
        JOB_OVERLAP_THRESHOLDS.poor,
      ),
      figure: overlaps,
      poorAt: JOB_OVERLAP_THRESHOLDS.poor,
    },
  ];
  // Only judge the two readings the app actually supports. A project whose
  // queue never reports a wait, or whose jobs have no known cadence, must not
  // be scored on a number nobody measured.
  if (missed !== null) {
    parts.push({
      code: DECIDED_PART.jobMissed,
      score: linearScore(
        missed,
        JOB_MISSED_THRESHOLDS.good,
        JOB_MISSED_THRESHOLDS.poor,
      ),
      figure: missed,
      poorAt: JOB_MISSED_THRESHOLDS.poor,
    });
  }
  const waitP95Ms =
    typeof stats.waitP95Ms === "number" && stats.waitRuns > 0
      ? Math.max(0, Math.round(stats.waitP95Ms))
      : null;
  if (waitP95Ms !== null) {
    parts.push({
      code: DECIDED_PART.jobWait,
      score: linearScore(
        waitP95Ms,
        JOB_WAIT_MS_THRESHOLDS.good,
        JOB_WAIT_MS_THRESHOLDS.poor,
      ),
      figure: waitP95Ms,
      poorAt: JOB_WAIT_MS_THRESHOLDS.poor,
    });
  }
  const { score, decided } = worstOfParts(parts);
  const capacity = capacityFieldsOf(stats);

  return {
    score,
    rating: ratingFor(score),
    measurable: 1,
    ...decidedFieldsOf(decided),
    ...capacity,
    runs,
    jobNames: stats.jobNames ?? 0,
    otherNames: stats.otherNames ?? 0,
    failed,
    failPct,
    retried: Math.max(0, Math.round(stats.retried ?? 0)),
    retryWorst: Math.max(1, Math.round(stats.retryWorst ?? 1)),
    overlaps,
    p95Ms: Math.max(0, Math.round(stats.p95Ms ?? 0)),
    worstMs: Math.max(0, Math.round(stats.worstMs ?? 0)),
    waitRuns: Math.max(0, Math.round(stats.waitRuns ?? 0)),
    waitP95Ms,
    missed,
    recurring,
    hostedRuns: Math.max(0, Math.round(stats.hostedRuns ?? 0)),
    manualRuns: Math.max(0, Math.round(stats.manualRuns ?? 0)),
    attachedSystems: Math.max(0, Math.round(stats.attachedSystems ?? 0)),
    unattachedSystems,
  };
}

/** New connections needed for ONE kind before that kind can be judged. */
export const DEPENDENCY_DISTANCE_MIN_CONNECTIONS = 5;

/** One kind's newly-opened-connection setup times, label-free. */
export interface DependencyDistanceKindStat {
  /** Closed code from depKinds.ts — never a name. */
  kind: number;
  /** How many NEW connections to this kind were timed. */
  connections: number;
  /** Median setup (connect + secure) in ms across those connections. */
  setupMs: number;
}

export interface DependencyDistanceResult {
  score: number | null;
  rating: AxisRating;
  /** 1 once at least one kind cleared the floor; 0 while it cannot judge. */
  measurable: number;
  newConnections: number;
  minConnections: number;
  /** How many kinds cleared the floor. */
  judgedKinds: number;
  /** The furthest judged kind, or 0 when nothing could be judged. */
  worstKind: number;
  worstSetupMs: number;
  worstSharePct: number | null;
  /**
   * A LARGER READING THIS AXIS HELD AND DID NOT JUDGE.
   *
   * A kind below the connection floor is excluded from the verdict — rightly:
   * two handshakes cannot establish a distance. But the tile then published
   * the smaller, judged figure under the word "worst" while carrying a bigger
   * one in its own rows (122.9ms published, 723.3ms held). A "worst" must
   * never be smaller than something the same reading holds, so the excluded
   * maximum travels beside it, with the count of connections that was not
   * enough to judge it.
   *
   * Null when nothing was excluded, which is the ordinary case.
   */
  unjudgedWorstSetupMs: number | null;
  unjudgedWorstKind: number | null;
  unjudgedWorstConnections: number | null;
  /** How many kinds were held back for having too few connections. */
  unjudgedKinds: number;
  /** 0 when the app has no typical request yet. */
  typicalRequestMs: number;
  hostArea: number;
  ownBackendOnly: number;
  kinds: DependencyDistanceKindRow[];
}

function ms1(v: number): number {
  return Math.max(0, Math.round(v * 10) / 10);
}

export function computeDependencyDistance(
  stats: DependencyDistanceStatsLike,
): DependencyDistanceResult {
  const typical =
    typeof stats?.typicalRequestMs === "number" &&
    Number.isFinite(stats.typicalRequestMs) &&
    stats.typicalRequestMs > 0
      ? stats.typicalRequestMs
      : 0;
  const shareOf = (setupMs: number): number | null =>
    typical > 0
      ? Math.max(0, Math.min(100, Math.round((setupMs / typical) * 1000) / 10))
      : null;

  const rows: DependencyDistanceKindRow[] = [];
  let worstKind = 0;
  let worstSetupMs = 0;
  let judgedKinds = 0;
  // The excluded side of the same sweep, so an unjudged reading larger than
  // the published worst can never be invisible.
  let unjudgedKinds = 0;
  let unjudgedWorstSetupMs: number | null = null;
  let unjudgedWorstKind: number | null = null;
  let unjudgedWorstConnections: number | null = null;

  for (const k of stats?.kinds ?? []) {
    if (!k || !Number.isFinite(k.kind) || k.kind <= 0) continue;
    const connections = Math.max(0, Math.round(k.connections ?? 0));
    if (connections <= 0) continue;
    const setupMs = ms1(k.setupMs ?? 0);
    const row: DependencyDistanceKindRow = {
      kind: Math.round(k.kind),
      connections,
      setupMs,
    };
    const share = shareOf(setupMs);
    if (share !== null) row.sharePct = share;
    rows.push(row);
    // A kind is only JUDGED once it has enough new connections of its own.
    if (connections >= DEPENDENCY_DISTANCE_MIN_CONNECTIONS) {
      judgedKinds++;
      if (setupMs > worstSetupMs) {
        worstSetupMs = setupMs;
        worstKind = row.kind;
      }
    } else {
      unjudgedKinds++;
      if (unjudgedWorstSetupMs === null || setupMs > unjudgedWorstSetupMs) {
        unjudgedWorstSetupMs = setupMs;
        unjudgedWorstKind = row.kind;
        unjudgedWorstConnections = connections;
      }
    }
  }
  rows.sort((a, b) => b.setupMs - a.setupMs || a.kind - b.kind);

  const newConnections = Math.max(0, Math.round(stats?.newConnections ?? 0));
  const hostArea = Math.max(0, Math.round(stats?.hostArea ?? 0));
  const ownBackendOnly = stats?.ownBackendOnly ? 1 : 0;

  if (judgedKinds === 0) {
    // Too few newly-opened connections to judge. This is a STATE, not a zero:
    // the counts still ship so the reading can say how far off a verdict is.
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      newConnections,
      minConnections: DEPENDENCY_DISTANCE_MIN_CONNECTIONS,
      judgedKinds: 0,
      worstKind: 0,
      worstSetupMs: 0,
      worstSharePct: null,
      unjudgedWorstSetupMs,
      unjudgedWorstKind,
      unjudgedWorstConnections,
      unjudgedKinds,
      typicalRequestMs: Math.round(typical),
      hostArea,
      ownBackendOnly,
      kinds: rows,
    };
  }

  const score = linearScore(
    worstSetupMs,
    DEPENDENCY_DISTANCE_SETUP_MS_THRESHOLDS.good,
    DEPENDENCY_DISTANCE_SETUP_MS_THRESHOLDS.poor,
  );
  return {
    score,
    rating: ratingFor(score),
    measurable: 1,
    newConnections,
    minConnections: DEPENDENCY_DISTANCE_MIN_CONNECTIONS,
    judgedKinds,
    worstKind,
    worstSetupMs,
    worstSharePct: shareOf(worstSetupMs),
    // Only interesting when it is BIGGER than the published worst — a smaller
    // excluded reading changes nothing about what "worst" means. Sent
    // whenever it is larger, so no surface has to re-derive it from the rows.
    unjudgedWorstSetupMs:
      unjudgedWorstSetupMs !== null && unjudgedWorstSetupMs > worstSetupMs
        ? unjudgedWorstSetupMs
        : null,
    unjudgedWorstKind:
      unjudgedWorstSetupMs !== null && unjudgedWorstSetupMs > worstSetupMs
        ? unjudgedWorstKind
        : null,
    unjudgedWorstConnections:
      unjudgedWorstSetupMs !== null && unjudgedWorstSetupMs > worstSetupMs
        ? unjudgedWorstConnections
        : null,
    unjudgedKinds,
    typicalRequestMs: Math.round(typical),
    hostArea,
    ownBackendOnly,
    kinds: rows,
  };
}

export interface DependencyDistanceKindRow {
  kind: number;
  connections: number;
  setupMs: number;
  /** Share of a typical request spent purely on distance; omitted when there
   *  is no typical request to compare against. */
  sharePct?: number;
}

export interface DependencyDistanceStatsLike {
  kinds: DependencyDistanceKindStat[];
  /** Every timed new connection, including kinds still under the floor. */
  newConnections: number;
  /** A typical request in THIS app (p50), or null when nothing is measured. */
  typicalRequestMs: number | null;
  /** The platform's OWN declared area code; 0 when it declared nothing. */
  hostArea: number;
  /** 1 where the runtime can only time the app's own backend (the browser). */
  ownBackendOnly: number;
}

/** Watched requests needed before the axis leaves "pending". Mirrors the
 *  shared gate: below this a single unlucky request defines the reading. */
export const DEPENDENCY_MIN_REQUESTS = 20;
/** An outside-service wait of 100 ms or less per request is never a fault,
 *  whatever share of a fast request it is (the shared decision). */
export const DEP_WAIT_MS_PER_REQUEST_FLOOR = 100;

/** One kind of outside service, with how often it is called, how long it
 *  takes and how often it fails. The `kind` is one of six constant words the
 *  kit defines — never an address, and never a vendor. */
export interface DependencyGroupLike {
  kind: string;
  calls: number;
  failed: number;
  timedOut: number;
  couldNotConnect?: number;
  noAnswer?: number;
  turnedAway?: number;
  tooManyRequests?: number;
  serverError?: number;
  cancelled?: number;
  services?: { name: string; calls: number; failed: number; timedOut: number }[];
  /** Watched requests that touched this kind at least once. */
  requests: number;
  p75Ms: number;
  worstMs: number;
  /** 1 when this kind BOTH worked and broke in the window — an intermittent
   *  failure, which is a different problem from one that always fails. */
  flaky: 0 | 1;
}

export interface DependencyResult extends Partial<DecidedPart> {
  score: number | null;
  rating: AxisRating;
  /** Outside-service wait per settled request (ms); 100 or less grades the
   *  wait term 100. Absent while nothing is graded. */
  waitMsPerRequest?: number;
  /** 0 = nothing scoreable yet, but there IS something the page must say (a
   *  sign-in that runs inside the app). 1 = a real reading. */
  measurable: 0 | 1;
  /** Share of watched request time spent waiting on OUTSIDE SERVICES. */
  waitPct: number;
  /** …on the database, over the same requests. */
  dbPct: number;
  /** …on an AI provider, over the same requests. */
  aiPct: number;
  /** …the app's OWN work: whatever the three waits above did not account
   *  for. Floored at zero — a negative remainder is a rounding artefact, not
   *  a fact about the app. */
  selfPct: number;
  callCount: number;
  watchedRequests: number;
  /** Calls that FAILED, counted apart from calls that were merely slow. */
  failCount: number;
  /** Calls that ran out of patience, counted apart from calls that answered
   *  with a failure. */
  timeoutCount: number;
  /** Share of outside-service calls that failed or timed out, 0..100. */
  failPct: number;
  /** Slowest quarter boundary across every kind, ms. */
  p75Ms: number;
  worstMs: number;
  /** How many kinds of outside service this app leans on. */
  kindCount: number;
  /** Kinds that both worked and broke — intermittent failure, visible as
   *  such rather than averaged into a rate. */
  flakyKinds: number;
  /** Calls to a destination the recognition list does not know. Their own
   *  visible group, never folded into a known kind. */
  unknownCalls: number;
  /** Sign-in's own place, because it sits in front of every session. */
  signinCalls: number;
  /** p75 ms for sign-in, or null when sign-in makes no outside call. */
  signinP75Ms: number | null;
  signinFailed: number;
  /** 1 = this app signs people in ITSELF, so there is no outside call to
   *  time. The page says so plainly; it never reads as "no sign-in". */
  inAppSignin: 0 | 1;
  groups: DependencyGroupLike[];
}

/**
 * Score the outside-dependency axis, or return null when there is nothing
 * honest to say.
 *
 * THREE OUTCOMES, deliberately distinct:
 *   • null — no outside-service calls AND no in-app sign-in library. The axis
 *     is absent, which every surface reads as "cannot tell". A project with no
 *     outside dependencies therefore shows NOTHING here rather than empty
 *     rows, and a runtime without this meter looks the same — neither looks
 *     like a confident zero.
 *   • measurable 0 — too few watched requests to score, but this app signs
 *     people in inside itself. Saying nothing would leave a founder to
 *     conclude their app has no sign-in, so the axis ships with that one fact
 *     and no score.
 *   • measurable 1 — a real reading.
 */
export function computeDependencies(
  stats: DependencyStatsLike,
): DependencyResult | null {
  if (!stats) return null;
  const inAppSignin: 0 | 1 = stats.inAppSignin === 1 ? 1 : 0;
  const groups = Array.isArray(stats.groups) ? stats.groups : [];
  if (stats.watchedRequests < DEPENDENCY_MIN_REQUESTS) {
    if (inAppSignin === 0) return null;
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      waitPct: 0,
      dbPct: 0,
      aiPct: 0,
      selfPct: 0,
      callCount: stats.callCount ?? 0,
      watchedRequests: stats.watchedRequests ?? 0,
      failCount: 0,
      timeoutCount: 0,
      failPct: 0,
      p75Ms: 0,
      worstMs: 0,
      kindCount: 0,
      flakyKinds: 0,
      unknownCalls: 0,
      signinCalls: 0,
      signinP75Ms: null,
      signinFailed: 0,
      inAppSignin,
      groups: [],
    };
  }
  const pctOf = (ms: number): number => {
    const raw =
      stats.watchedRequestMs > 0 ? (ms / stats.watchedRequestMs) * 100 : 0;
    return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
  };
  const waitPct = pctOf(stats.depMs);
  const dbPct = pctOf(stats.dbMs);
  const aiPct = pctOf(stats.aiMs);
  const selfPct = Math.max(
    0,
    Math.round((100 - waitPct - dbPct - aiPct) * 10) / 10,
  );

  let failCount = 0;
  let timeoutCount = 0;
  let p75Ms = 0;
  let worstMs = 0;
  let flakyKinds = 0;
  let unknownCalls = 0;
  let signinCalls = 0;
  let signinP75Ms: number | null = null;
  let signinFailed = 0;
  for (const g of groups) {
    failCount += g.failed ?? 0;
    timeoutCount += g.timedOut ?? 0;
    if ((g.p75Ms ?? 0) > p75Ms) p75Ms = g.p75Ms;
    if ((g.worstMs ?? 0) > worstMs) worstMs = g.worstMs;
    if (g.flaky === 1) flakyKinds += 1;
    if (g.kind === "other") unknownCalls += g.calls ?? 0;
    if (g.kind === "signin") {
      signinCalls = g.calls ?? 0;
      signinP75Ms = g.p75Ms ?? 0;
      signinFailed = (g.failed ?? 0) + (g.timedOut ?? 0);
    }
  }
  const calls = stats.callCount ?? 0;
  const failPct =
    calls > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(((failCount + timeoutCount) / calls) * 1000) / 10,
          ),
        )
      : 0;
  const waitMsPerRequest = Math.round((stats.depMs / Math.max(1, stats.watchedRequests)) * 10) / 10;
  const { score, decided } = worstOfParts([
    {
      code: DECIDED_PART.depWait,
      score:
        waitMsPerRequest <= DEP_WAIT_MS_PER_REQUEST_FLOOR
          ? 100
          : linearScore(
              waitPct,
              DEP_WAIT_PCT_THRESHOLDS.good,
              DEP_WAIT_PCT_THRESHOLDS.poor,
            ),
      figure: waitPct,
      poorAt: DEP_WAIT_PCT_THRESHOLDS.poor,
    },
    {
      code: DECIDED_PART.depFailures,
      score: linearScore(
        failPct,
        DEP_FAIL_PCT_THRESHOLDS.good,
        DEP_FAIL_PCT_THRESHOLDS.poor,
      ),
      figure: failPct,
      poorAt: DEP_FAIL_PCT_THRESHOLDS.poor,
    },
  ]);
  return {
    score,
    rating: ratingFor(score),
    measurable: 1,
    ...decidedFieldsOf(decided),
    waitMsPerRequest,
    waitPct,
    dbPct,
    aiPct,
    selfPct,
    callCount: calls,
    watchedRequests: stats.watchedRequests,
    failCount,
    timeoutCount,
    failPct,
    p75Ms: Math.round(p75Ms),
    worstMs: Math.round(worstMs),
    kindCount: groups.length,
    flakyKinds,
    unknownCalls,
    signinCalls,
    signinP75Ms,
    signinFailed,
    inAppSignin,
    groups,
  };
}

/** Minimal label-free aggregate consumed from the outside-dependency
 *  detector. */
export interface DependencyStatsLike {
  /** Requests in which at least one outside-service call was watched. */
  watchedRequests: number;
  /** Wall ms of those requests — the denominator for ALL FOUR shares. */
  watchedRequestMs: number;
  /** Ms of those requests spent waiting on outside services. */
  depMs: number;
  /** Ms of those SAME requests spent waiting on the database. */
  dbMs: number;
  /** Ms of those same requests spent waiting on an AI provider. */
  aiMs: number;
  /** Outside-service round trips watched. */
  callCount: number;
  groups: DependencyGroupLike[];
  /** 1 when a sign-in library that runs INSIDE the app is loaded, so there is
   *  no outside call to time. Never a guess and never an absence. */
  inAppSignin: 0 | 1;
}

/** Share of outside-service calls that FAILED. Separate from slowness on
 *  purpose: a dependency that breaks is a different problem from one that
 *  drags, and the two are never folded into one number. */
export const DEP_FAIL_PCT_THRESHOLDS = { good: 0.5, poor: 10 } as const;

/* ─── Failure containment: one failed read, whole response lost ───────────
 *
 * Reliability counts failed responses. It cannot say whether a failure cost
 * one region or the whole screen, so an app that degrades gracefully and an
 * app one bad row away from a blank page read identically. This scores the
 * difference, from counts the kit already had. The boundary — what counts as
 * contained, collapsed, all-failed or unattributed — is defined once for every
 * runtime in docs/failure-containment.md; this is that document in code.
 *
 * Reliability itself is untouched and keeps its exact value. This sits beside
 * it, and like every other axis here it never feeds the Speed score.
 */

/** Share of SALVAGEABLE failures that took the whole response down. Good at
 *  none of them; poor at half. Half of the requests that had something worth
 *  rendering throwing it away is as bad as this reading needs to say — the
 *  rule book prescribes the fix, this only points. */
export const CONTAINMENT_COLLAPSE_PCT_THRESHOLDS = {
  good: 0,
  poor: 50,
} as const;

/**
 * Requests in the denominator before a SCORE is given.
 *
 * The floor belongs on the verdict, never on the evidence: a developer looking
 * at their first collapse must see that collapse, and an app that has simply
 * not broken yet must never be handed a perfect score for it. Below this the
 * counts still ship and the score is withheld in words.
 */
export const CONTAINMENT_MIN_JUDGED = 3;

/** Minimal label-free aggregate consumed from the containment collector. */
export interface FailureContainmentStatsLike {
  watchedRequests: number;
  contained: number;
  collapsed: number;
  allFailed: number;
  unattributed: number;
}

export interface FailureContainmentResult {
  /** 0..100, or null while there is nothing to judge. */
  score: number | null;
  rating: AxisRating;
  /** 1 when this kit can see both halves of a request — how much of its data
   *  arrived, and what the response finally carried. A kit that can only see
   *  one half sends 0 and the server words the can't-know for its runtime. */
  measurable: 0 | 1;
  /** A read failed and the app answered anyway. */
  containedCount: number;
  /** A read failed, another succeeded, and the response died with it. */
  collapsedCount: number;
  /** Every read failed — an outage, reported and never scored. */
  allFailedCount: number;
  /** The response failed and no watched read did. */
  unattributedCount: number;
  /** collapsed / (contained + collapsed) × 100, one decimal. 0 while pending. */
  collapsePct: number;
  /** Finished requests that made at least one watched data call. */
  watchedRequests: number;
  /**
   * Why there is no score, from the shared closed vocabulary. Null when there
   * is one.
   *
   * A pending tile with no reason is a blank the page cannot put into words:
   * every other pending axis carries a code and this one did not, so the
   * surface fell back to "warming up" — a promise of a reading that only
   * arrives if the app actually breaks. The reading is still `measurable: 1`;
   * the counts are real and must keep rendering. The code explains the missing
   * VERDICT, not a missing reading.
   */
  reasonCode: number | null;
}

/**
 * Score the containment axis, or return null when there is nothing to say.
 *
 * THREE OUTCOMES, the same three the database and AI axes use:
 *   • null — no request this kit watched made a single data call it could see.
 *     The axis is absent, which every surface reads as "cannot tell". That is
 *     the honest answer for an app whose data client cannot be watched, and it
 *     is deliberately indistinguishable from a runtime that has no reading at
 *     all: neither may be mistaken for a measured zero.
 *   • score null / rating "pending" — requests were watched, but too few of
 *     them had a salvageable failure to divide. NO VERDICT, stated as such.
 *     The counts ship anyway; a full score here would be a claim the app never
 *     earned, and the whole point of this reading is not to hand one out.
 *   • a score — at least CONTAINMENT_MIN_JUDGED salvageable failures.
 */
export function computeFailureContainment(
  stats: FailureContainmentStatsLike,
): FailureContainmentResult | null {
  if (!stats) return null;
  const watchedRequests = Math.max(0, Math.round(stats.watchedRequests ?? 0));
  if (watchedRequests <= 0) return null;
  const containedCount = Math.max(0, Math.round(stats.contained ?? 0));
  const collapsedCount = Math.max(0, Math.round(stats.collapsed ?? 0));
  const allFailedCount = Math.max(0, Math.round(stats.allFailed ?? 0));
  const unattributedCount = Math.max(0, Math.round(stats.unattributed ?? 0));
  const base = {
    measurable: 1 as const,
    containedCount,
    collapsedCount,
    allFailedCount,
    unattributedCount,
    watchedRequests,
  };
  // Only the requests that HAD a choice: something already in hand worth
  // rendering, and a read that broke. An outage had nothing to salvage and an
  // unexplained failure had no read to blame, so folding either in would move
  // the score for reasons that are not about containment at all.
  const judged = containedCount + collapsedCount;
  if (judged < CONTAINMENT_MIN_JUDGED) {
    return {
      ...base,
      score: null,
      rating: "pending",
      collapsePct: 0,
      // Nothing to divide. Containment is a ratio of salvageable failures, and
      // fewer than CONTAINMENT_MIN_JUDGED of them means there is no denominator
      // yet — which is precisely "the reading compares things this app has only
      // one of", the sixth code in the shared list.
      reasonCode: REASON_NOTHING_TO_COMPARE,
    };
  }
  const collapsePct = Math.round((1000 * collapsedCount) / judged) / 10;
  const score = linearScore(
    collapsePct,
    CONTAINMENT_COLLAPSE_PCT_THRESHOLDS.good,
    CONTAINMENT_COLLAPSE_PCT_THRESHOLDS.poor,
  );
  return {
    ...base,
    score,
    rating: ratingFor(score),
    collapsePct,
    reasonCode: null,
  };
}
