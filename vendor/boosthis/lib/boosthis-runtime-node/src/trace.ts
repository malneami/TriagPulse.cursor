/** Full-stack trace tag — Node/Express sibling of the RN + Python trace
 * primitives. Byte-for-byte the same contract: header name, id format, and
 * adopt-or-mint sanitize-on-receive behavior.
 *
 * Stage 1 of the flagship cross-runtime trace: PROPAGATION + PROOF. The
 * middleware adopts (or mints) a trace id per request, exposes it as
 * `req.boosthisTraceId`, echoes it in the response header, and
 * `forwardTraceHeaders(req)` hands it to the next hop (e.g. a Python worker).
 *
 * PRIVACY CONTRACT (verified against no-pii.ts): the id is exactly 32
 * lowercase hex chars (128 random bits) — pure hex cannot match the guard's
 * value patterns, and `traceId` / `x-boosthis-trace` are guard-clean keys.
 *
 * ⚠️  A trace id must NEVER be used as (or embedded in) a route label:
 *     `normalizePath` redacts 24+ char alnum tokens as `:id`, so a trace id in
 *     a URL segment would be flagged. Keep trace ids in their own header only.
 */

import { randomBytes } from "node:crypto";

import { PARENT_HEADER, sanitizeSpanId } from "./spanScope";

/** Canonical lowercase header name carried on every instrumented request. */
export const TRACE_HEADER = "x-boosthis-trace";

/** A valid trace id is exactly 32 lowercase hex characters (128 bits). */
export const TRACE_ID_RE = /^[0-9a-f]{32}$/;

/** True if `id` matches the locked trace-id format exactly. */
export function isValidTraceId(id: unknown): id is string {
  return typeof id === "string" && TRACE_ID_RE.test(id);
}

/** Mint a fresh 32-hex-char trace id. Uses Node's CSPRNG
 * (`crypto.randomBytes`) with a `Math.random` fallback. The fallback is
 * acceptable because the id is a CORRELATION TAG, not an authenticator — it
 * never gates access, so weaker randomness only risks a rare collision. */
export function newTraceId(): string {
  try {
    return randomBytes(16).toString("hex");
  } catch {
    let out = "";
    for (let i = 0; i < 32; i++) {
      out += Math.floor(Math.random() * 16).toString(16);
    }
    return out;
  }
}

/** Adopt-or-mint: return `id` unchanged if valid, else mint fresh. The
 * sanitize-on-receive trust boundary — anything not matching
 * `^[0-9a-f]{32}$` (incl. CRLF header-injection attempts) is discarded. */
export function sanitizeTraceId(id: unknown): string {
  return isValidTraceId(id) ? id : newTraceId();
}

/** Normalize a raw incoming header value (string | string[] | undefined) to
 * the first string, then adopt-or-mint. */
export function adoptTraceId(headerValue: unknown): string {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return sanitizeTraceId(raw);
}

/** Build the outbound header map for a request. Pass an existing id to
 * propagate it (validated first), or omit to mint a fresh trace. */
export function traceHeaders(id?: string): Record<string, string> {
  return { [TRACE_HEADER]: sanitizeTraceId(id) };
}

/* ─── Elapsed chain (Stage 2 waterfall offsets) ──────────────────────────────
 * A companion header carrying a RELATIVE elapsed-ms integer: how long after the
 * trace root STARTED this hop was reached, chained from each hop's own monotonic
 * delta so the server can stagger the waterfall WITHOUT any absolute client
 * timestamp or cross-machine clock comparison. A bounded non-negative int
 * carries no PII; a malformed value only degrades the OFFSET (→ 0), never the
 * trace correlation. Byte-identical to the RN + Python trace primitives.
 */

/** Companion header carrying the relative elapsed-ms offset for the next hop. */
export const ELAPSED_HEADER = "x-boosthis-trace-elapsed";

/** A propagated elapsed value is 1–6 digits (0..999999); clamped on receive. */
export const TRACE_ELAPSED_RE = /^\d{1,6}$/;

/** Upper clamp for a propagated elapsed value (mirrors MAX_SPAN_DURATION_MS). */
export const MAX_TRACE_ELAPSED_MS = 600000;

/** Sanitize-on-receive for the elapsed chain: parse a bounded non-negative
 * integer from the incoming header value (string | string[] | undefined), or 0
 * if missing/malformed. Never throws; a bad value degrades the offset only. */
export function sanitizeTraceElapsed(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === "string" && TRACE_ELAPSED_RE.test(raw)) {
    return Math.min(MAX_TRACE_ELAPSED_MS, parseInt(raw, 10));
  }
  return 0;
}

/** Everything the trace primitives read off a request. Exported because the
 *  per-request work scope holds one so the outbound observer can build this
 *  hop's headers without a second copy of the builder. */
export interface TraceCarrier {
  boosthisTraceId?: string;
  /** This request's own span identity (set by the middleware). */
  boosthisSpanId?: string;
  /** Elapsed-ms base adopted from the incoming request (set by the middleware). */
  boosthisTraceElapsedBase?: number;
  /** `performance.now()` captured when the middleware began handling the request. */
  boosthisTraceStart?: number;
  headers?: Record<string, unknown> | undefined;
}

/** Read the trace id the middleware attached to a request. Falls back to the
 * incoming header (adopt-or-mint) if the middleware did not run, so callers
 * always get a valid id. Never throws. */
export function getTraceId(req: TraceCarrier): string {
  try {
    if (isValidTraceId(req.boosthisTraceId)) return req.boosthisTraceId as string;
    return adoptTraceId(req.headers?.[TRACE_HEADER]);
  } catch {
    return newTraceId();
  }
}

/** Elapsed ms since the trace root started, advanced to the NEXT hop:
 * the base adopted on receive + this process's own monotonic time-in-request.
 * Relative-only (no absolute timestamp), clamped [0, MAX]. Never throws. */
export function getTraceElapsed(req: TraceCarrier): number {
  try {
    const base =
      typeof req.boosthisTraceElapsedBase === "number" &&
      Number.isFinite(req.boosthisTraceElapsedBase)
        ? Math.max(0, req.boosthisTraceElapsedBase)
        : sanitizeTraceElapsed(req.headers?.[ELAPSED_HEADER]);
    const sinceStart =
      typeof req.boosthisTraceStart === "number" &&
      Number.isFinite(req.boosthisTraceStart)
        ? Math.max(0, performance.now() - req.boosthisTraceStart)
        : 0;
    return Math.max(
      0,
      Math.min(MAX_TRACE_ELAPSED_MS, Math.round(base + sinceStart)),
    );
  } catch {
    return 0;
  }
}

/** Read the span identity the middleware attached to this request, or null if
 * the middleware did not run. Adopt-or-DROP: unlike the trace id this is never
 * minted here, because a minted parent would name a call that does not
 * exist. Never throws. */
export function getSpanId(req: TraceCarrier): string | null {
  try {
    return sanitizeSpanId(req.boosthisSpanId);
  } catch {
    return null;
  }
}

/** Build the header map to forward the current request's trace id AND its
 * advanced elapsed offset to the next hop (e.g.
 * `fetch(pythonWorker, { headers: forwardTraceHeaders(req) })`).
 *
 * Also carries THIS request's span identity as the next hop's parent, so the
 * downstream span records what caused it rather than merely sharing a trace id
 * with it. Omitted entirely when this request has no identity of its own (the
 * middleware did not run) — an absent parent reads as "top level", which is
 * true, where a guessed one would not be. */
export function forwardTraceHeaders(req: TraceCarrier): Record<string, string> {
  const headers: Record<string, string> = {
    [TRACE_HEADER]: getTraceId(req),
    [ELAPSED_HEADER]: String(getTraceElapsed(req)),
  };
  const spanId = getSpanId(req);
  if (spanId !== null) headers[PARENT_HEADER] = spanId;
  return headers;
}
