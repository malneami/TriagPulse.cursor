/**
 * Owner links on a server (owner decisions, 4–5 Oct 2026 — "no one sees the
 * bubble or its readings except the project's owners").
 *
 * The owner presses "Show the bubble on my site" on their project's page on
 * Boosthis and opens the link it gives: the site's address plus
 * `?boosthis=<proof>`. On that request this module swaps the proof with
 * Boosthis for an owner pass, hands it to the browser in a cookie only the
 * server can read (plus a readable marker the in-page gate checks), and sends
 * the browser on to the same address without the proof.
 *
 * The cookie holds Boosthis's own pass, never one this process signs: a
 * project key also drives browser installs, where it ships inside the page,
 * so nothing derived from it can prove who someone is. Each process asks
 * Boosthis whether a pass holds and keeps the answer for a few minutes, so a
 * pass works on every instance of the app and after a restart.
 *
 * `?boosthis=on` switches a browser on only from the machine itself (a direct
 * loopback request with no proxy headers); anywhere else the address reaches
 * the app untouched. `?boosthis=off` forgets both cookies. A request without
 * a pass cookie never makes a network call.
 *
 * Contract shared by every server kit: .local/state/owner-link-server-contract.md
 * until the rule is published in the kit guides.
 */

import { isDirectLoopback } from "./loopback";
import { readAnswerJson } from "./answerRead";
import { getActiveTelemetryClient } from "./telemetry";

export const OWNER_LINK_PARAM = "boosthis";
export const OWNER_PASS_COOKIE = "boosthis_owner_pass";
export const OWNER_MARKER_COOKIE = "boosthis_owner";

const PROOF_SHAPE = /^op_[0-9a-f]{64}$/;
const PASS_SHAPE = /^bp1\.([0-9a-z]{1,11})\.[0-9a-f]{32}\.[0-9a-f]{64}$/;
const PASS_MAX_AGE_S = 30 * 24 * 3600;
const CREDENTIAL_WAIT_MS = 8_000;
const CREDENTIAL_POLL_MS = 250;
const CALL_TIMEOUT_MS = 8_000;
const YES_TTL_MS = 10 * 60_000;
const NO_TTL_MS = 10 * 60_000;
const UNANSWERED_TTL_MS = 30_000;
const CACHE_MAX = 256;
/** An owner-pass answer is a few hundred bytes; the same 64 KB ceiling the
 *  other server kits read it under. */
const OWNER_ANSWER_MAX_BYTES = 65_536;

/** `"answered"`: this module already sent the response (a redirect). */
export type OwnerVerdict = boolean | "answered";

type Headers = Record<string, unknown>;
export type OwnerReq = {
  method?: string;
  url?: string;
  originalUrl?: string;
  headers?: Headers;
  socket?: { remoteAddress?: string; encrypted?: boolean };
  connection?: { remoteAddress?: string };
};
export type OwnerRes = {
  statusCode?: number;
  headersSent?: boolean;
  setHeader?: (name: string, value: string | number | readonly string[]) => unknown;
  getHeader?: (name: string) => unknown;
  end?: (chunk?: unknown) => unknown;
};

type Credential = { endpoint: string; installId: string; token: string };
type Answer = { kind: "yes"; body: Record<string, unknown> } | { kind: "refused" } | { kind: "unanswered" };
type PassVerdict = "yes" | "no" | "unanswered";

function header(req: OwnerReq, name: string): string | undefined {
  const v = req.headers?.[name];
  if (Array.isArray(v)) return v.map(String).join(", ");
  return typeof v === "string" ? v : undefined;
}

/** One cookie's value from the request, or null. */
export function readCookie(req: OwnerReq, name: string): string | null {
  const raw = req.headers?.cookie;
  const all = Array.isArray(raw) ? raw.map(String).join("; ") : raw;
  if (typeof all !== "string" || !all) return null;
  for (const part of all.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function splitAddress(req: OwnerReq): { path: string; params: URLSearchParams } {
  const raw = String(req.originalUrl ?? req.url ?? "/").split("#")[0]!;
  const q = raw.indexOf("?");
  return {
    path: q >= 0 ? raw.slice(0, q) : raw,
    params: new URLSearchParams(q >= 0 ? raw.slice(q + 1) : ""),
  };
}

/** The address the browser is sent on to: the same one minus the owner key. */
function strippedAddress(req: OwnerReq): string {
  const { path, params } = splitAddress(req);
  params.delete(OWNER_LINK_PARAM);
  const rest = params.toString();
  // A backslash is refused too: a browser reads "/\other.example" as
  // "//other.example", somebody else's site (a proxy in front may have decoded
  // a %5C on the way in).
  const safePath =
    path.startsWith("/") && !path.startsWith("//") && !/[\\\r\n]/.test(path) ? path : "/";
  return `${safePath}${rest ? `?${rest}` : ""}`;
}

function cookieTail(req: OwnerReq, maxAgeS: number): string {
  const proto = (header(req, "x-forwarded-proto") ?? "").split(",")[0]!.trim().toLowerCase();
  const secure = req.socket?.encrypted === true || proto === "https";
  return `; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeS))}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function addCookies(res: OwnerRes, cookies: string[]): void {
  const prior = res.getHeader?.("set-cookie");
  const list = Array.isArray(prior) ? prior.map(String) : prior ? [String(prior)] : [];
  res.setHeader?.("set-cookie", [...list, ...cookies]);
}

/** Forget both cookies on this response. */
export function clearOwnerCookies(req: OwnerReq, res: OwnerRes): void {
  try {
    addCookies(res, [
      `${OWNER_PASS_COOKIE}=${cookieTail(req, 0)}; HttpOnly`,
      `${OWNER_MARKER_COOKIE}=${cookieTail(req, 0)}`,
    ]);
  } catch {
    /* headers already gone: the cookies simply stay until they expire */
  }
}

function redirect(res: OwnerRes, location: string): void {
  res.statusCode = 303;
  res.setHeader?.("location", location);
  res.setHeader?.("cache-control", "no-store");
  res.setHeader?.("referrer-policy", "no-referrer");
  res.setHeader?.("content-length", "0");
  res.end?.();
}

function say(line: string): void {
  try {
    console.info(`[boosthis] ${line}`);
  } catch {
    /* nothing more can be said */
  }
}

function credential(): Credential | null {
  if (transportForTests) return transportForTests.credential();
  const client = getActiveTelemetryClient();
  const token = client?.deleteToken ?? client?.readToken;
  if (!client || !token || !client.installId || !client.endpoint) return null;
  return { endpoint: client.endpoint, installId: client.installId, token };
}

async function waitForCredential(): Promise<Credential | null> {
  const deadline = Date.now() + CREDENTIAL_WAIT_MS;
  for (;;) {
    const c = credential();
    if (c || Date.now() >= deadline) return c;
    await new Promise((r) => setTimeout(r, CREDENTIAL_POLL_MS).unref?.());
  }
}

async function ask(c: Credential, path: string, body: Record<string, string>): Promise<Answer> {
  const f = transportForTests?.fetch ?? (typeof fetch === "function" ? fetch : null);
  if (!f) return { kind: "unanswered" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CALL_TIMEOUT_MS);
  timer.unref?.();
  try {
    const res = await f(`${c.endpoint.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.token}` },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    // Only Boosthis's own "no" is an answer about the pass.
    if (res.status === 403) return { kind: "refused" };
    if (!res.ok) return { kind: "unanswered" };
    // Bounded while reading, on the same call clock: an answer over the
    // ceiling, too slow or not JSON is "unanswered", never a verdict.
    const parsed = await readAnswerJson(res, {
      maxBytes: OWNER_ANSWER_MAX_BYTES,
      timeoutMs: CALL_TIMEOUT_MS,
    });
    if (parsed && typeof parsed === "object" && (parsed as { ok?: unknown }).ok === true) {
      return { kind: "yes", body: parsed as Record<string, unknown> };
    }
    return { kind: "unanswered" };
  } catch {
    return { kind: "unanswered" };
  } finally {
    clearTimeout(timer);
  }
}

const verdicts = new Map<string, { verdict: PassVerdict; until: number }>();
const inFlight = new Map<string, Promise<PassVerdict>>();

function remember(pass: string, verdict: PassVerdict, ttlMs: number, passExpiresMs: number): void {
  if (verdicts.size >= CACHE_MAX) {
    const oldest = verdicts.keys().next().value;
    if (oldest !== undefined) verdicts.delete(oldest);
  }
  const until = Date.now() + ttlMs;
  verdicts.set(pass, { verdict, until: verdict === "yes" ? Math.min(until, passExpiresMs) : until });
}

function passExpiry(pass: string): number | null {
  const m = PASS_SHAPE.exec(pass);
  if (!m) return null;
  const ms = parseInt(m[1]!, 36) * 1000;
  return Number.isSafeInteger(ms) ? ms : null;
}

/** Does this pass hold? Sync when this process already knows. */
function checkPass(pass: string): PassVerdict | Promise<PassVerdict> {
  const expires = passExpiry(pass);
  if (expires === null || expires <= Date.now()) return "no";
  const known = verdicts.get(pass);
  if (known && known.until > Date.now()) return known.verdict;
  const pending = inFlight.get(pass);
  if (pending) return pending;
  const c = credential();
  if (!c) return "unanswered";
  const p = ask(c, "/owner-bubble/confirm", { installId: c.installId, pass }).then((a) => {
    const v: PassVerdict = a.kind === "yes" ? "yes" : a.kind === "refused" ? "no" : "unanswered";
    remember(pass, v, v === "yes" ? YES_TTL_MS : v === "no" ? NO_TTL_MS : UNANSWERED_TTL_MS, expires);
    return v;
  });
  inFlight.set(pass, p);
  void p.finally(() => inFlight.delete(pass));
  return p;
}

function verdictToOwner(req: OwnerReq, res: OwnerRes, v: PassVerdict): boolean {
  if (v === "no") clearOwnerCookies(req, res);
  return v === "yes";
}

/** Is this request from a browser holding a pass Boosthis confirmed? */
export function ownerFromPass(req: OwnerReq, res: OwnerRes): boolean | Promise<boolean> {
  const pass = readCookie(req, OWNER_PASS_COOKIE);
  if (!pass) return false;
  const v = checkPass(pass);
  return typeof v === "string" ? verdictToOwner(req, res, v) : v.then((x) => verdictToOwner(req, res, x));
}

async function redeem(req: OwnerReq, res: OwnerRes, proof: string): Promise<"answered"> {
  const c = await waitForCredential();
  let cookies: string[] = [];
  if (!c) {
    say("This owner link could not be checked: this app has not registered with Boosthis yet, so nothing was switched on.");
  } else {
    const a = await ask(c, "/owner-bubble/redeem", { installId: c.installId, proof });
    const pass = a.kind === "yes" ? a.body.pass : null;
    const until = a.kind === "yes" ? Date.parse(String(a.body.passExpiresAt)) : NaN;
    if (typeof pass === "string" && PASS_SHAPE.test(pass) && Number.isFinite(until) && until > Date.now()) {
      const maxAge = Math.min(PASS_MAX_AGE_S, (until - Date.now()) / 1000);
      cookies = [
        `${OWNER_PASS_COOKIE}=${pass}${cookieTail(req, maxAge)}; HttpOnly`,
        `${OWNER_MARKER_COOKIE}=1${cookieTail(req, maxAge)}`,
      ];
      remember(pass, "yes", YES_TTL_MS, until);
    } else {
      say(
        a.kind === "refused"
          ? "This owner link was not accepted: it was used already, has expired or belongs to another project. Open a new one from your project's page on Boosthis."
          : "Boosthis could not be reached to check this owner link, so nothing was switched on.",
      );
    }
  }
  try {
    if (res.headersSent !== true) {
      if (cookies.length) addCookies(res, cookies);
      redirect(res, strippedAddress(req));
    }
  } catch {
    /* the connection went away; nothing was switched on for it */
  }
  return "answered";
}

/**
 * Settle the owner question for one request, before the app sees it: apply an
 * owner link or switch from the address (answering with a redirect), then
 * check a pass cookie. True only for a browser holding a confirmed pass.
 */
export function settleOwnerRequest(req: OwnerReq, res: OwnerRes): OwnerVerdict | Promise<OwnerVerdict> {
  const method = String(req.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    const raw = splitAddress(req).params.get(OWNER_LINK_PARAM);
    if (raw !== null) {
      const value = raw.trim();
      if (PROOF_SHAPE.test(value)) return redeem(req, res, value);
      const word = value.toLowerCase();
      if (word === "off") {
        const pass = readCookie(req, OWNER_PASS_COOKIE);
        if (pass) verdicts.delete(pass);
        clearOwnerCookies(req, res);
        redirect(res, strippedAddress(req));
        return "answered";
      }
      if (word === "on" && isDirectLoopback(req)) {
        addCookies(res, [`${OWNER_MARKER_COOKIE}=1${cookieTail(req, PASS_MAX_AGE_S)}`]);
        redirect(res, strippedAddress(req));
        return "answered";
      }
    }
  }
  return ownerFromPass(req, res);
}

/** May this response carry the bubble? A confirmed pass, or the machine
 *  itself after `?boosthis=on` set the marker. */
export function ownerMayHaveBubble(req: OwnerReq, owner: boolean): boolean {
  try {
    return owner || (isDirectLoopback(req) && readCookie(req, OWNER_MARKER_COOKIE) === "1");
  } catch {
    return false;
  }
}

let transportForTests: { credential: () => Credential | null; fetch: typeof fetch } | null = null;

/** @internal test hooks: stand in for the registered install and the network. */
export function _setOwnerLinkTransportForTests(
  t: { credential: () => Credential | null; fetch: typeof fetch } | null,
): void {
  transportForTests = t;
}

/** @internal */
export function _resetOwnerLinkForTests(): void {
  verdicts.clear();
  inFlight.clear();
  transportForTests = null;
}
