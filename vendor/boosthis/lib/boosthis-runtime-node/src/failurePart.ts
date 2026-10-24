/**
 * WHICH PART OF THE APP A FAILURE WAS IN.
 *
 * This kit captured crashes from the beginning and never recorded WHERE. The
 * crash reporter's own comment said it out loud about the two ids it does
 * attach — "neither is screen-bearing". A trace id and a span id identify AN
 * OPERATION; they are random correlation tags and no amount of reading them
 * tells a developer which route the app died on. So a developer was told the
 * app crashes and left to find where, while a slow request in the very same
 * route arrived labelled, because timing findings ride the sample path.
 *
 * This module answers the question, from the route state the kit ALREADY
 * holds — the per-request async scope the middleware opens — and never from a
 * new source of truth and never from the last thing it happened to see.
 *
 * THE THREE HONEST ANSWERS, and why the third exists:
 *
 *   • a part name — the request in flight, as `METHOD /template`, through the
 *     ONE part-name rule (`routeLabel`), which is the same rule and the same
 *     transmit screen every sample's label goes through;
 *   • an unknown TERM — the kit looked and could not tell, and the term says
 *     which of the ways that happens this was;
 *   • nothing at all — not produced here. An absent field on the wire means a
 *     kit that was never taught to send one, which is a different fact from
 *     either of the above and must never be worded as a failure that happened
 *     nowhere.
 *
 * NEVER GUESS. `currentRequestScope()` is AsyncLocalStorage: it answers for
 * the request this code is actually running inside, and `null` when there is
 * none. It is not a "last request seen" variable, and this module holds no
 * mutable state of its own precisely so that it cannot become one. A crash on
 * a background timer reports `no-part-open`, which is true, rather than the
 * route that happened to be served a moment earlier, which would read exactly
 * like the truth and be wrong.
 *
 * BOOSTHIS_FAILURE_PART_V1 — copy of the shared vocabulary in
 * `lib/failure-part-vocabulary.json`.
 * `scripts/src/__tests__/failure-part-coverage.test.ts` fails if this copy
 * drifts from it.
 */

import { currentRequestScope } from "./repeatedWork";
import { routeLabel } from "./routeInventory";

/** What this kit says when it could not name the part. Closed set, the same
 *  three words on every runtime we ship. */
export const FAILURE_PART_UNKNOWN = {
  /** Nothing was open: start-up, a background timer, a worker between jobs. */
  noPartOpen: "no-part-open",
  /** No route state was readable at this moment — this host never gives the
   *  kit one, or the framework had not named a route yet. */
  notTracked: "part-not-tracked",
  /** A part was known and the one part-name rule refused its name. */
  refused: "part-refused",
} as const;

export type FailurePartUnknown =
  (typeof FAILURE_PART_UNKNOWN)[keyof typeof FAILURE_PART_UNKNOWN];

/** The part, or the reason there is not one. Exactly one key is ever set. */
export interface FailurePart {
  routeLabel?: string;
  partUnknown?: FailurePartUnknown;
}

/** Only what this module reads off a host's request object. Deliberately not
 *  the host's own type: this is read-only, four fields, and nothing here is
 *  stored or uploaded except the label the part-name rule accepts. */
interface RequestLike {
  method?: unknown;
  baseUrl?: unknown;
  route?: { path?: unknown } | null;
}

/** A mount path is code-defined (`app.use("/api", …)`), and so is a route
 *  template (`"/orders/:id"`). Both are written by the developer, neither is
 *  derived from the incoming URL, so neither can carry a user value — which
 *  is why this reads the TEMPLATE and never the request path. `routeLabel`
 *  screens the result anyway. */
function templateOf(req: RequestLike): string | null {
  const path = req.route?.path;
  if (typeof path !== "string" || path.length === 0) return null;
  const base = typeof req.baseUrl === "string" ? req.baseUrl : "";
  const joined = `${base}${path}`;
  return joined.startsWith("/") ? joined : `/${joined}`;
}

/**
 * Where the code calling this is running, right now.
 *
 * Never throws: a reporter that could be taken down by its own placement
 * would cost the failure report the part exists to explain.
 */
export function currentFailurePart(): FailurePart {
  try {
    const scope = currentRequestScope();
    const req = scope?.trace as RequestLike | undefined;
    // No request in flight HERE. The honest answer, and the common one on a
    // server: an uncaught exception usually surfaces after an await, and a
    // rejected promise or a timer callback genuinely belongs to no request.
    if (!scope || !req) {
      return { partUnknown: FAILURE_PART_UNKNOWN.noPartOpen };
    }
    const template = templateOf(req);
    // A request IS open and the kit still cannot name where: a bare
    // `http.createServer` host has no route table to match against, and a
    // crash before the router ran has not reached one yet. Saying
    // "nothing was open" here would be false.
    if (template === null) {
      return { partUnknown: FAILURE_PART_UNKNOWN.notTracked };
    }
    const method = typeof req.method === "string" ? req.method : "GET";
    const label = routeLabel(method, template);
    // The one part-name rule refused this name — too long, or its transmit
    // screen matched it. The reading is kept and the name is not; the server
    // reaches the same verdict independently and stores the same word.
    if (label === null) return { partUnknown: FAILURE_PART_UNKNOWN.refused };
    return { routeLabel: label };
  } catch {
    return { partUnknown: FAILURE_PART_UNKNOWN.notTracked };
  }
}

/**
 * Where a FINDING happened, read off the name the detector already filed it
 * under.
 *
 * A finding is accumulated over time rather than caught on a stack, so there
 * is no "now" to read a request scope at. What there is is the name the
 * detector gave it, and for the route-shaped detectors that name IS the part:
 * it is the very label the sample path filed the route under, so a slow-route
 * finding and a slow request in that route join without translating anything.
 *
 * WHICH NAMES QUALIFY IS DECIDED BY THE PART-NAME RULE, NOT BY A LIST OF
 * DETECTORS. A detector kind is not a place: `failing-api` names the OUTBOUND
 * HOST it could not reach, and `outbound-fan-out` names nothing at all. Both
 * are real names and neither is a part of this app. Rather than keep a list of
 * which kinds are route-shaped — which would be wrong the first time a
 * detector is added — the name is offered to the one part-name rule and
 * accepted only if it comes back UNCHANGED. A hostname and a detector's own
 * word fail that, so they report as untracked instead of being presented as
 * screens of the app.
 */
export function findingPart(name: unknown): FailurePart {
  try {
    if (typeof name !== "string" || name.length === 0) {
      return { partUnknown: FAILURE_PART_UNKNOWN.notTracked };
    }
    const space = name.indexOf(" ");
    if (space <= 0) return { partUnknown: FAILURE_PART_UNKNOWN.notTracked };
    const label = routeLabel(name.slice(0, space), name.slice(space + 1));
    // Unchanged, or not a part. A name the rule had to REWRITE is a name the
    // detector was not filing under a route label in the first place.
    if (label !== name) return { partUnknown: FAILURE_PART_UNKNOWN.notTracked };
    return { routeLabel: label };
  } catch {
    return { partUnknown: FAILURE_PART_UNKNOWN.notTracked };
  }
}
