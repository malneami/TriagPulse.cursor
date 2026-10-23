/* ─── Boosthis: one failed read, whole response lost (Node) ────────────────
 *
 * WHY THIS EXISTS. Reliability is a ratio — failed responses over total
 * responses — and it cannot tell these two apart:
 *
 *   • a page that made nineteen reads, lost one, and still rendered eighteen
 *     panels and an apology where the nineteenth should have been;
 *   • a page that made nineteen reads, lost one, and returned a blank 500.
 *
 * Same failure rate, same reading, opposite engineering. The rule book already
 * tells developers to isolate risky subtrees so a failure costs one region
 * rather than the screen; until this reading existed nothing anywhere pointed
 * at it, so a customer doing the resilient thing and a customer one bad row
 * away from a blank screen got identical numbers.
 *
 * WHAT IT NEEDS. Nothing new. Three numbers this kit already has when a
 * request ends, all of them already on the shared request scope:
 *
 *   • how many watched DATA CALLS the request made — database round trips
 *     (dbWork) plus outside-service round trips (dependencyWork);
 *   • how many of those FAILED;
 *   • whether the response the app finally sent was itself a failure.
 *
 * THE BOUNDARY is written down once, for every runtime, in
 * docs/failure-containment.md. This module implements exactly that document
 * and nothing beyond it. In particular it does NOT know what a page section
 * is: it cannot, and it must not guess. A "panel" is a fact about somebody's
 * interface; this sees round trips and a status code.
 *
 * PRIVACY. Counts leave, and nothing else. No dependency name, host, address,
 * path or statement; no status code; no route; no timing. "Which read broke"
 * is deliberately unanswerable here — the reading says how much of the work
 * survived, and the rule book says what to do about it.
 *
 * WHAT IT DOES NOT TOUCH. Reliability, crash-free and every other failure
 * reading keep their exact meaning and value. This sits beside them: it adds a
 * per-request classification and moves no existing number.
 */

import { isBoosthisDisabled } from "./runtimeFlags";
import type { RequestWorkScope } from "./repeatedWork";

/** Session totals for the `failureContainment` axis. Numbers only. */
export interface FailureContainmentStatsLike {
  /** Finished requests that made at least one watched data call — the whole
   *  population this reading can speak about. */
  watchedRequests: number;
  /** Of those: a read failed and the app answered anyway. The good outcome. */
  contained: number;
  /** A read failed, at least one other read SUCCEEDED, and the whole response
   *  went down with it. This is the finding. */
  collapsed: number;
  /** Every read the request made failed and the response failed — an outage,
   *  with nothing left to salvage and so no containment to do. */
  allFailed: number;
  /** The response failed and no watched read did: the cause is in the app's
   *  own code, or in a client this kit cannot watch. */
  unattributed: number;
}

let watchedRequests = 0;
let contained = 0;
let collapsed = 0;
let allFailed = 0;
let unattributed = 0;

/**
 * A failed response, by the SAME definition the reliability reading uses:
 * status >= 500. Written here as its own function so the two can never drift
 * into calling one response a failure and the other a success.
 */
function responseFailed(status: unknown): boolean {
  const s = typeof status === "number" && Number.isFinite(status) ? status : 0;
  return s >= 500;
}

/**
 * Classify one finished request and fold it into the session totals.
 *
 * MUST RUN BEFORE the outside-service and database closes: both of those
 * CLEAR their per-request tally off the scope, and this is the one place that
 * needs to read both of them together with the status the host actually sent.
 * Running it after either would read zero calls on every request and report a
 * permanently clean tile — the exact failure this reading exists to prevent —
 * so the order is asserted by a test rather than trusted to this comment.
 *
 * `status` is the response's own status code. It is read here, on this stack,
 * only to decide the boolean above and is then dropped: no code leaves.
 *
 * Never throws; a null scope (declined open) does nothing.
 */
export function noteRequestContainment(
  scope: RequestWorkScope | null,
  status: unknown,
): void {
  if (!scope) return;
  try {
    if (isBoosthisDisabled()) return;
    // Both halves of "how much of this request's data arrived". A request that
    // touched neither is not counted at all — the same rule every other
    // per-request reading here follows, and the reason an app whose data
    // client cannot be watched reports NOTHING rather than a clean sheet.
    const db = scope.db;
    const dep = scope.dep;
    const calls = (db?.count ?? 0) + (dep?.count ?? 0);
    if (calls <= 0) return;
    const failed = (db?.failed ?? 0) + (dep?.failed ?? 0);
    watchedRequests += 1;
    const lost = responseFailed(status);
    if (failed <= 0) {
      // Nothing this reading can see went wrong, so a failed response is one
      // it cannot explain — said out loud rather than folded into a verdict.
      if (lost) unattributed += 1;
      return;
    }
    if (!lost) {
      // A read failed and the app answered anyway. Counted even when EVERY
      // read failed: rendering a page after losing all of them is the
      // strongest containment there is, and it earns the credit.
      contained += 1;
      return;
    }
    // Everything failed — an outage, a different conversation, and no
    // containment decision was available to make. This is also where a request
    // with a SINGLE data call lands: an error boundary around the only read on
    // the page still leaves a page with no data, so calling it a containment
    // failure would tell a developer to isolate a subtree that is the whole
    // tree.
    if (failed >= calls) {
      allFailed += 1;
      return;
    }
    collapsed += 1;
  } catch {
    /* instrumentation must never disturb the host */
  }
}

/** Session totals for the `failureContainment` axis. Numbers only. */
export function getFailureContainmentStats(): FailureContainmentStatsLike {
  return { watchedRequests, contained, collapsed, allFailed, unattributed };
}

/** Forget everything measured so far. Used by the telemetry forget lever and
 *  by tests; this module holds no wrapper and no host state to detach. */
export function clearFailureContainment(): void {
  watchedRequests = 0;
  contained = 0;
  collapsed = 0;
  allFailed = 0;
  unattributed = 0;
}
