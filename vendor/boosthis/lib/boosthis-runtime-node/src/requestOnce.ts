/** One request is measured ONCE, however many doors it came through.
 *
 * A project can legitimately have two of our doors on the same request: the
 * framework-free attach observes every request at the Node boundary, and an
 * Express app that also calls `app.use(boosthis())` would then see the same
 * request a second time on its way through the router. Two observations mean
 * two samples, two spans and two sets of meter readings for one visitor —
 * numbers a developer cannot reconcile with anything they can see.
 *
 * The mark lives on the request object itself, under a PROCESS-WIDE symbol
 * (`Symbol.for`), so two copies of the kit loaded from different places in the
 * dependency tree still see each other's mark. Siblings that cannot see each
 * other are how the same install ends up double-counting.
 *
 * Writing to someone else's request object is done with care: the property is
 * non-enumerable, so a host that serialises or spreads the request never sees
 * it, and every access is guarded — a frozen or proxied request simply cannot
 * be marked, and an unmarkable request is measured rather than dropped.
 */

const OBSERVED = Symbol.for("boosthis.requestObserved");

type Markable = Record<PropertyKey, unknown>;

/** True when this request has already been observed by one of our doors. */
export function isRequestObserved(req: unknown): boolean {
  try {
    if (!req || (typeof req !== "object" && typeof req !== "function")) return false;
    return (req as Markable)[OBSERVED] === true;
  } catch {
    return false;
  }
}

/**
 * Claim this request. Returns "claimed" for the first door to reach it and
 * "already" for every later one.
 *
 * A request that cannot be marked at all (frozen, sealed, or a hostile proxy)
 * answers "claimed": measuring twice is a bad number, but measuring zero times
 * is a blank dashboard, and blank is the failure this whole attach exists to
 * prevent.
 */
export function claimRequest(req: unknown): "claimed" | "already" {
  try {
    if (!req || (typeof req !== "object" && typeof req !== "function")) {
      return "claimed";
    }
    const target = req as Markable;
    if (target[OBSERVED] === true) return "already";
    Object.defineProperty(target, OBSERVED, {
      value: true,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    return "claimed";
  } catch {
    return "claimed";
  }
}

/** @internal test hook — forget the mark on one request. */
export function _unclaimRequest(req: unknown): void {
  try {
    if (req && typeof req === "object") {
      delete (req as Markable)[OBSERVED];
    }
  } catch {
    /* nothing to undo */
  }
}
