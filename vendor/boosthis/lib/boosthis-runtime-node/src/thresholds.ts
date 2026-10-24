/** Score thresholds + rating logic — identical to Python + RN. */

export const SCORE_THRESHOLDS = {
  ttff: { good: 300, poor: 800 },
  tti: { good: 500, poor: 1500 },
  fid: { good: 50, poor: 150 },
} as const;

export const RUNTIME_VERSION = "1.0.0-alpha.220" as const;

/** Edge-cache band: of the replies the hosting platform treated as cacheable,
 *  the % it actually served from its own cache. HIGHER IS BETTER (scored via
 *  the complement with the shared lower-is-better helper). Replies the
 *  platform deliberately bypasses are excluded from both sides of the share.
 *  good ≥70% · poor ≤20%. Twin of the web runtime's band. */
export const EDGE_CACHE_THRESHOLDS = { good: 70, poor: 20 } as const;
export type Rating = "good" | "needs-work" | "poor";

/**
 * The three DIFFERENT reasons an axis carries no score. One word for all three
 * ("pending") told a customer to come back later for a verdict that, in two of
 * the three cases, is never coming.
 *
 *   "pending"       — warming up. The meter works here; a score IS coming.
 *   "not-available" — this host cannot take the reading at all. It always
 *                     travels beside `measurable: 0`, which older servers read
 *                     on its own, so dropping the label loses nothing.
 *   "not-scored"    — the reading is real, its counts are true, and by design
 *                     it carries no verdict — permanently, on every install.
 *
 * Kits in every language share this vocabulary; the server owns the sentences.
 * A server that does not know a label drops it at ingest and falls back to the
 * null score, i.e. to "pending" — the same behaviour as before this existed.
 */
export type NoScoreRating = "pending" | "not-available" | "not-scored";
/** A p99 at or below this is not a tail worth acting on, whatever the ratio. */
export const RESILIENCE_TAIL_FLOOR_MS = 50;
/** Classify a request duration against the TTI thresholds (server-side default). */
export function rateDuration(durationMs: number): Rating {
  if (durationMs <= SCORE_THRESHOLDS.tti.good) return "good";
  if (durationMs >= SCORE_THRESHOLDS.tti.poor) return "poor";
  return "needs-work";
}

/** Below this many samples a "p99" is just the slowest of a handful, so no
 *  tail is published at all. */
export const RESILIENCE_MIN_TAIL_SAMPLES = 20;

/** What the tail can honestly say about a set of samples. */
export type TailReading =
  /** Too few samples for a p99 to mean anything — publish no tail at all. */
  | { state: "insufficient" }
  /** The slowest requests are fast in absolute terms: no tail problem exists,
   *  whatever the ratio. `ratio` is null when the median was unmeasurable. */
  | { state: "flat"; ratio: number | null }
  /** A real tail above the floor, but the median is below the capture
   *  resolution, so the ratio cannot be computed — abstain, never guess. */
  | { state: "unmeasurable" }
  /** A ratio worth scoring. */
  | { state: "rated"; ratio: number };

/** The one place this judgement is made in the Node kit. Callers apply their
 *  own bands to `ratio` and their own blend weights to the resulting term. */
export function readResilienceTail(
  p50Ms: number | null | undefined,
  p99Ms: number | null | undefined,
  sampleCount: number,
): TailReading {
  if (
    sampleCount < RESILIENCE_MIN_TAIL_SAMPLES ||
    p50Ms == null ||
    p99Ms == null ||
    !Number.isFinite(p50Ms) ||
    !Number.isFinite(p99Ms)
  ) {
    return { state: "insufficient" };
  }
  const measurableMedian = p50Ms >= RESILIENCE_MIN_MEDIAN_MS;
  if (p99Ms <= RESILIENCE_TAIL_FLOOR_MS) {
    return { state: "flat", ratio: measurableMedian ? p99Ms / p50Ms : null };
  }
  if (!measurableMedian) return { state: "unmeasurable" };
  return { state: "rated", ratio: p99Ms / p50Ms };
}

/** Durations are captured in whole milliseconds, so a median below this is not
 *  a small number — it is an unmeasured one, and no ratio can be taken from it. */
export const RESILIENCE_MIN_MEDIAN_MS = 1;
