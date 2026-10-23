/* ─── Boosthis: held-open calls (Node) ───────────────────────────────────
 *
 * A server that streams holds a connection open on purpose — server-sent
 * events, a replacing frame feed, a WebSocket. Timed as an ordinary request,
 * such a call reports however long the client stayed (60 seconds is common) and
 * that number is not a measurement of how fast the app is. Production showed
 * exactly this: a `GET /stream` p99 of ~60,000 ms against a p50 of 1 ms, which
 * pinned `resilience`, `latencyFloor` and `loadDeflection` at a permanent poor
 * for a feature working as designed.
 *
 * This module owns the ONE definition of "held open" for the Node kit — the
 * same predicate `liveConnections` uses to decide which responses to adopt, so
 * the held-open-connections reading and the latency family agree by
 * construction. The cross-kit contract is docs/held-open-calls.md.
 *
 * The tally is counts + ms only: never a route label, path, host, or any
 * customer string. In-memory, bounded (two scalars), no-op under the
 * kill-switch.
 */

import { isBoosthisDisabled } from "./runtimeFlags";

/**
 * The CLOSED list of streaming media types. A response carrying one of these is
 * held open by design; anything else is a request.
 *
 * `application/grpc` and `application/x-ndjson` are deliberately absent: both
 * are used for streams AND for ordinary bounded responses, and a kit reading
 * only the content type cannot tell them apart. Excluding them would silently
 * drop real request latency, which is the worse failure. Keep this list
 * byte-identical with every other kit — scripts' held-open-parity gate holds
 * all of them to it.
 */
export const HELD_OPEN_CONTENT_TYPES: readonly string[] = [
  "text/event-stream",
  "multipart/x-mixed-replace",
] as const;

/**
 * Is this `Content-Type` a streaming media type?
 *
 * The MEDIA TYPE is compared, not searched for: everything before the first
 * `;` is trimmed, lowercased and matched exactly against the closed list. A
 * substring search reads `application/json; profile="text/event-stream"` as a
 * stream and drops a perfectly ordinary request out of the distribution — the
 * mirror image of the fault this module exists to fix, and the worse one,
 * because the customer is never told a real request went missing. Parameters
 * and case are still ignored, so `Text/Event-Stream; charset=utf-8` matches.
 * Never throws.
 */
export function isHeldOpenContentType(raw: unknown): boolean {
  if (typeof raw !== "string" || raw.length === 0) return false;
  const semi = raw.indexOf(";");
  const mediaType = (semi >= 0 ? raw.slice(0, semi) : raw).trim().toLowerCase();
  if (mediaType.length === 0) return false;
  return HELD_OPEN_CONTENT_TYPES.includes(mediaType);
}

/**
 * Decide whether this finished call was held open, from the response alone.
 *
 * Two signals, the same two every other kit uses (docs/held-open-calls.md):
 * a `101` status — the connection left HTTP, so its lifetime was never a
 * request duration — or a streaming media type. Handles the array form Node
 * allows for a header, and the `Content-Type` casing Express may use. Any
 * failure reads as "an ordinary request" — a kit never guesses a call away
 * from the distribution.
 */
export function isHeldOpenResponse(res: unknown): boolean {
  try {
    const r = res as
      | { getHeader?: (n: string) => unknown; statusCode?: unknown }
      | null;
    if (!r) return false;
    if (r.statusCode === 101) return true;
    if (typeof r.getHeader !== "function") return false;
    const header = r.getHeader("content-type");
    if (Array.isArray(header)) {
      return header.some((v) => isHeldOpenContentType(v));
    }
    return isHeldOpenContentType(header);
  } catch {
    return false;
  }
}

/* ── Upgraded connections ──────────────────────────────────────────────────
 * A WebSocket handshake in Node does not always leave a `101` on the response
 * object the middleware is timing. The `ws` family answers the handshake by
 * writing to the socket directly, so the `ServerResponse` a framework like
 * express-ws still hands down the stack keeps its default status and finishes
 * only when the socket finally closes — minutes later. Read as a request, that
 * is the socket's whole lifetime.
 *
 * The kit already learns about every upgrade at `http.Server`'s own `upgrade`
 * event (liveConnections). Marking the request there is what lets the request
 * boundary recognise the same call: one signal, one definition, and the
 * held-open-connections reading and the latency family cannot disagree. */

const UPGRADED = Symbol.for("boosthis.heldOpen.upgraded");

/**
 * Mark this request as one whose connection was upgraded off HTTP. Called from
 * the upgrade watcher. Total: a frozen or proxied request simply keeps no
 * mark, and the call is then judged on the response alone.
 */
export function markUpgraded(req: unknown): void {
  try {
    if (!req || typeof req !== "object") return;
    Object.defineProperty(req, UPGRADED, {
      value: true,
      enumerable: false,
      configurable: true,
      writable: false,
    });
  } catch {
    /* the upgrade always proceeds; an unmarkable request is judged on its response */
  }
}

/** Was this request's connection upgraded off HTTP? Never throws. */
export function wasUpgraded(req: unknown): boolean {
  try {
    if (!req || typeof req !== "object") return false;
    return (req as Record<symbol, unknown>)[UPGRADED] === true;
  } catch {
    return false;
  }
}

/**
 * The whole question, at the one point a finished call is recorded: was this
 * an upgraded connection, or a streaming response? Either way it is not a
 * request/response exchange and its duration is not a measurement of the app.
 */
export function isHeldOpenCall(req: unknown, res: unknown): boolean {
  return wasUpgraded(req) || isHeldOpenResponse(res);
}

/* ── The tally ─────────────────────────────────────────────────────────── */

let heldOpenExcluded = 0;
let heldOpenWorstMs = 0;

/**
 * Record that one finished call was recognised as a held-open stream and kept
 * out of the latency family. Discount, don't hide: the count and the longest
 * one ride the wire so a customer with a streaming endpoint can see the call
 * was recognised rather than ignored.
 */
export function noteHeldOpenExcluded(durationMs: number): void {
  if (isBoosthisDisabled()) return;
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  heldOpenExcluded++;
  const ms = Math.round(durationMs);
  if (ms > heldOpenWorstMs) heldOpenWorstMs = ms;
}

/** The wire record: how many held-open calls were excluded and the longest.
 *  Both zero means nothing was excluded and the fields are omitted upstream. */
export function getHeldOpenStats(): {
  heldOpenExcluded: number;
  heldOpenWorstMs: number;
} {
  return { heldOpenExcluded, heldOpenWorstMs };
}

/** Reset between hermetic test runs / on meter clear. */
export function clearHeldOpen(): void {
  heldOpenExcluded = 0;
  heldOpenWorstMs = 0;
}
