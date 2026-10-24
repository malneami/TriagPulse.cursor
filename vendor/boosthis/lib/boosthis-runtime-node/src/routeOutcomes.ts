/** Per-route failure counts — "which route is FAILING", not just which is slow.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT. The middleware already reads
 * `res.statusCode` and already derives the route label, in the same function,
 * at the same instant — and then throws the pair away: the status goes to the
 * app-wide outcome meters and the label goes to a timing sample. This module
 * is the join. It observes NOTHING new: it is handed two values the request
 * path had already computed, and keeps a count.
 *
 * WHAT TRAVELS. A count against a label that already travels. The status is
 * reduced to its CLASS at the boundary and the class is not even kept — only
 * the two counters it decides. There is no field here that could hold a URL, a
 * message, a stack, a body or a header, and no parameter that could carry one.
 *
 * WHAT COUNTS AS FAILED. The 5xx class: the answer this service itself got
 * wrong. A 4xx is a refusal the caller provoked — it belongs to the refusal
 * meters (refusalHonesty, accessPressure), not here, and counting it would
 * paint a login page red for doing its job. A request whose handler threw is
 * a 5xx by the time the response ends, so it is already included.
 *
 * ABSENCE IS NOT ZERO. A label this module never saw has no entry, and a
 * missing entry is rendered as "nothing seen here" — never as a zero and never
 * as health. When the label cap fills, further NEW labels are not invented as
 * empty rows: they are simply untracked, and the number of observations that
 * went untracked is reported so the gap is visible rather than silent.
 */

/** What a status code is reduced to at the boundary. The class itself never
 *  leaves this module — it decides which counter moves and is discarded. */
export type StatusClass = "1xx" | "2xx" | "3xx" | "4xx" | "5xx" | "unknown";

/** Reduce a status code to its class. Anything not a real HTTP status is
 *  "unknown" and is counted as observed but never as failed — a code we cannot
 *  read is not evidence of a failure. */
export function statusClassOf(status: unknown): StatusClass {
  if (typeof status !== "number" || !Number.isFinite(status)) return "unknown";
  const s = Math.floor(status);
  if (s >= 100 && s < 200) return "1xx";
  if (s >= 200 && s < 300) return "2xx";
  if (s >= 300 && s < 400) return "3xx";
  if (s >= 400 && s < 500) return "4xx";
  if (s >= 500 && s < 600) return "5xx";
  return "unknown";
}

/** How many distinct route labels this module will track. Matches the server's
 *  per-day part cap, so a project can never build a picture here that its own
 *  history cannot hold. */
export const MAX_TRACKED_ROUTE_OUTCOMES = 200;

/** One part's answers. Both numbers are counts of responses this process
 *  completed, for the life of the process. */
export interface RouteOutcomeCounts {
  /** Responses observed for this label. */
  observed: number;
  /** Of those, how many were the 5xx class. */
  failed: number;
}

let counts = new Map<string, RouteOutcomeCounts>();
/** Observations that arrived for a label the cap would not let us start
 *  tracking. Reported, never hidden: it is the difference between "this part
 *  had no failures" and "we stopped looking". */
let untracked = 0;

/** Record how one response ENDED, beside the label already derived for it.
 *  Never throws — instrumentation must not disturb the host. */
export function noteRouteOutcome(label: unknown, status: unknown): void {
  try {
    if (typeof label !== "string" || label.length === 0) return;
    // Only an answer this kit can actually JUDGE enters the denominator.
    // A status we cannot read is not evidence that the response was fine, and
    // counting it as a non-failure would dilute the very rate the reading
    // exists to make honest — a route that answered 500 ten times looks
    // half as bad if ten unreadable endings sit beside them. An
    // informational 1xx is not a final answer either. Both are simply not
    // observed: "nothing seen" rather than "seen and it was fine".
    const cls = statusClassOf(status);
    if (cls === "unknown" || cls === "1xx") return;
    let row = counts.get(label);
    if (!row) {
      if (counts.size >= MAX_TRACKED_ROUTE_OUTCOMES) {
        untracked++;
        return;
      }
      row = { observed: 0, failed: 0 };
      counts.set(label, row);
    }
    row.observed++;
    if (statusClassOf(status) === "5xx") row.failed++;
  } catch {
    /* swallow */
  }
}

/** The counts for one label, or null when this part has not been seen. Null is
 *  "nothing seen", which is NOT a zero. */
export function routeOutcomeFor(label: string): RouteOutcomeCounts | null {
  const row = counts.get(label);
  return row ? { observed: row.observed, failed: row.failed } : null;
}

/** App-wide totals for the axis: how many parts carry a reading, how many
 *  answers were observed across all of them, how many failed, and how many
 *  observations the label cap turned away. */
export interface RouteOutcomeTotals {
  parts: number;
  observed: number;
  failed: number;
  untracked: number;
}

export function getRouteOutcomeTotals(): RouteOutcomeTotals {
  let observed = 0;
  let failed = 0;
  for (const row of counts.values()) {
    observed += row.observed;
    failed += row.failed;
  }
  return { parts: counts.size, observed, failed, untracked };
}

/** Clear everything. Called by `forget()` and by the disable path, exactly
 *  like every other in-process meter. */
export function resetRouteOutcomes(): void {
  counts = new Map();
  untracked = 0;
}
