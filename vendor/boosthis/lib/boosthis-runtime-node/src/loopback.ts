/**
 * The kit's STRICT "this request came from this machine" guard.
 *
 * Lives on its own so the two places that serve local-only surfaces — the
 * mounted routes (`/connect`, `/account`, `/status`) and the middleware's
 * direct route interception — enforce exactly the same rule. A second copy of
 * this logic is how a local-only surface quietly becomes a public one.
 */

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// Headers that a same-host reverse proxy will add to forwarded requests.
// Their presence means the TCP peer being loopback is due to the proxy hop,
// not a direct local connection — so the loopback guard must not grant access.
export const PROXY_HEADERS: readonly string[] = [
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "forwarded",
];

/** Minimal request shape this guard reads. Deliberately structural so it
 *  accepts an Express request, a bare `http.IncomingMessage`, or a test stub. */
export interface LoopbackReqLike {
  socket?: { remoteAddress?: string } | undefined;
  connection?: { remoteAddress?: string } | undefined;
  headers?: Record<string, unknown> | undefined;
}

const LOOPBACK_V4 = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * A host name that can only mean this machine: `localhost`, a name under it
 * (`app.localhost` — browsers answer the whole name space with loopback by
 * rule, without asking DNS), or a 127.x.y.z address written as four numbers.
 *
 * Deliberately NOT `0.0.0.0`, a `.local` or `.test` name, a preview address or
 * any other name: the rule's job is to refuse a name somebody else can point at
 * 127.0.0.1, and a name that resolves through DNS is one.
 */
export function isLoopbackHostName(raw: string): boolean {
  const h = String(raw).trim().toLowerCase().replace(/\.$/, "");
  if (h === "localhost") return true;
  if (h.endsWith(".localhost") && h.length > ".localhost".length) return true;
  const v4 = LOOPBACK_V4.exec(h);
  return !!v4 && v4.slice(1).every((o) => Number(o) <= 255);
}

/**
 * A Host value — or the host part of an Origin — that names this machine:
 * a loopback name or address with an optional numeric port. IPv6 is written in
 * brackets, as HTTP writes it, and only `[::1]` counts.
 */
export function isLoopbackAuthority(raw: string): boolean {
  const v = String(raw).trim();
  if (v.startsWith("[")) {
    const end = v.indexOf("]");
    if (end < 0 || !/^(?::\d*)?$/.test(v.slice(end + 1))) return false;
    return v.slice(1, end).toLowerCase() === "::1";
  }
  const parts = v.split(":");
  if (parts.length > 2) return false;
  if (parts.length === 2 && !/^\d*$/.test(parts[1])) return false;
  return isLoopbackHostName(parts[0]);
}

/** An Origin header naming a page served from this machine. `null`, a
 *  non-web scheme, or anything that is not exactly `scheme://host[:port]`
 *  is not one. */
export function isLoopbackOrigin(raw: string): boolean {
  const m = /^https?:\/\/([^/?#@\s]+)$/i.exec(String(raw).trim());
  return !!m && isLoopbackAuthority(m[1]);
}

/** Every value of one header. `null` means it could not be read. */
function headerValues(headers: Record<string, unknown>, name: string): string[] | null {
  const v = headers[name];
  if (v === undefined) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
  return null;
}

/**
 * Whether the request was ADDRESSED to this machine, as the browser saw it.
 *
 * A web page can point a name it owns at 127.0.0.1 (DNS rebinding) and then
 * read local answers as its own origin: the TCP peer is loopback and no proxy
 * header is set, so peer and headers alone call that request "the machine
 * itself" — and `/connect` and `/account` hand it the install's tokens. The
 * browser still writes the page's own host in Host (`:authority` on HTTP/2),
 * and in Origin when it sends one. So: every Host or `:authority` value must
 * name this machine, at least one must be present, and an Origin, when there
 * is one, must be a page on this machine too. A same-origin GET carries no
 * Origin, which is how the kit's own page, panel and bubble ask.
 */
export function isAddressedToThisMachine(headers: Record<string, unknown>): boolean {
  const host = headerValues(headers, "host");
  const authority = headerValues(headers, ":authority");
  if (host === null || authority === null) return false;
  const named = [...host, ...authority];
  if (named.length === 0 || !named.every(isLoopbackAuthority)) return false;
  const origin = headerValues(headers, "origin");
  if (origin === null || origin.length > 1) return false;
  return origin.length === 0 || isLoopbackOrigin(origin[0]);
}

/**
 * True only for a request whose real TCP peer is loopback, which carries no
 * proxy/forwarding headers, and which was addressed to this machine by a
 * loopback name or address (see {@link isAddressedToThisMachine}).
 *
 * Deliberately does NOT honour `req.ip`. Express resolves `req.ip` from
 * X-Forwarded-For when the host app sets `trust proxy`, which makes the
 * loopback guard spoofable from the public internet. The real TCP peer is on
 * `req.socket.remoteAddress` (or the legacy `req.connection`), which the client
 * cannot rewrite.
 *
 * Fail-safe: any error answers `false` — a guard that throws must never end up
 * granting access.
 */
export function isDirectLoopback(req: LoopbackReqLike): boolean {
  try {
    const ip = req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? "";
    if (!LOOPBACK.has(ip)) return false;

    // Even when the TCP peer is loopback, reject if proxy headers are present.
    // In a same-host reverse-proxy deployment every external request arrives
    // with a loopback peer address AND one or more forwarding headers set by
    // the proxy. A genuinely direct local connection has none of those headers.
    const headers = req.headers ?? {};
    if (PROXY_HEADERS.some((h) => headers[h] !== undefined)) return false;

    return isAddressedToThisMachine(headers);
  } catch {
    return false;
  }
}
