/**
 * symptomHints — proactive, no-source-read "what's probably wrong" pairing for
 * the `what_should_i_look_at_next` triage tool (Node.js pack).
 *
 * Mirror of `lib/boosthis-runtime-rn/src/symptomHints.ts` (the source of truth).
 * See that file for the full rationale. In short: Boosthis never reads the
 * developer's source, but it can see a route's timing SHAPE, and the shape is a
 * strong prior on the CLASS of cause:
 *
 *   • steady-slow (p99≈p50): sequential awaits, N+1, missing index, no caching,
 *     synchronous work on every request.
 *   • spiky-tail (p99 ≫ p50): event-loop stalls, GC/heap growth, ReDoS, retry
 *     storms, cold starts, unbounded concurrency.
 *
 * The map below points at the Node rule ids most commonly behind each shape,
 * with a `next_step` that tells the AI to CONFIRM against the real handler
 * source (which its own AI can read) via `match_rules_for_code` + `get_rule`.
 * It is a prior, never a diagnosis. Rule ids are asserted to exist in the Node
 * checklist by `symptomHints.test.ts`.
 */

export type Symptom = "steady-slow" | "spiky-tail" | "unknown";

/** Timing shape of one route — the only inputs used to classify. Every field is
 *  a number/rating derived from measured latency; NO source, labels, or values
 *  are consulted. */
export interface SymptomStats {
  worstRating?: "good" | "needs-work" | "poor";
  p50Ms?: number;
  p99Ms?: number;
  spikeRatio?: number | null;
}

/**
 * Symptom → the Node rule ids most commonly behind that latency shape. Kept
 * small (≤8), ranked most-likely-first.
 */
export const SYMPTOM_HINTS: Record<Symptom, readonly string[]> = {
  // Consistently slow route — steady per-request work to cut.
  "steady-slow": [
    "sequential-independent-awaits",
    "n-plus-one-orm-node",
    "query-missing-index-full-scan",
    "sync-fs-in-handler",
    "await-in-loop",
    "db-write-in-loop",
    "large-json-serialize-sync",
    "missing-cache-headers",
  ],
  // Intermittent tail spikes — bursty work, not steady load.
  "spiky-tail": [
    "regex-redos",
    "event-loop-monitoring-missing",
    "heap-growth-unmonitored",
    "fetch-no-timeout-node",
    "client-retry-storm",
    "unbounded-promise-concurrency",
    "sync-crypto-on-hot-path",
    "heavy-dependency-cold-start",
  ],
  // Rated slow but the shape can't be classified — a blend to confirm.
  unknown: [
    "sequential-independent-awaits",
    "n-plus-one-orm-node",
    "sync-fs-in-handler",
    "event-loop-monitoring-missing",
    "query-missing-index-full-scan",
  ],
};

/** Fixed prose — makes clear this is a prior to confirm, never a diagnosis. */
export const NEXT_STEP =
  "These are the rule ids most commonly behind this latency shape — a prior, " +
  "not a confirmed diagnosis. Call boosthis.match_rules_for_code on this " +
  "route's handler source to see which actually apply, then boosthis.get_rule " +
  "for the fix.";

const SPIKY_RATIO = 4;

/**
 * Classify a route's timing shape. Returns null when the route is healthy
 * (good / unrated) so callers attach NO nudge to fast routes.
 */
export function classifySymptom(s: SymptomStats): Symptom | null {
  const rating = s.worstRating;
  if (rating == null || rating === "good") return null;
  let ratio: number | undefined;
  if (typeof s.spikeRatio === "number" && isFinite(s.spikeRatio)) {
    ratio = s.spikeRatio;
  } else if (
    typeof s.p99Ms === "number" &&
    typeof s.p50Ms === "number" &&
    s.p50Ms > 0
  ) {
    ratio = s.p99Ms / s.p50Ms;
  }
  if (ratio === undefined) return "unknown";
  return ratio >= SPIKY_RATIO ? "spiky-tail" : "steady-slow";
}

export interface NudgeFields {
  symptom: Symptom;
  candidate_rule_ids: readonly string[];
  next_step: string;
}

/**
 * Build the nudge fields to spread onto a triage row, or `{}` for a healthy
 * route. Attach these AFTER the PII filter — they are shipped constants (enum +
 * rule ids + fixed prose), so the guard must never drop a row over them.
 */
export function nudgeFields(s: SymptomStats): NudgeFields | Record<string, never> {
  const symptom = classifySymptom(s);
  if (!symptom) return {};
  return {
    symptom,
    candidate_rule_ids: SYMPTOM_HINTS[symptom],
    next_step: NEXT_STEP,
  };
}
