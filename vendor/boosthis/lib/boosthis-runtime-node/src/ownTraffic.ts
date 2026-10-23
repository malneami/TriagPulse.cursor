/* ─── Boosthis: whose outbound call is this? (Node) ──────────────────────
 *
 * ONE module owns the answer, because there is exactly one honest answer and
 * several places that need it. An outbound call leaving this process is one of
 * three things:
 *
 *   • the APP'S own traffic — the thing every outbound meter exists to measure;
 *   • BOOSTHIS'S traffic — our registrations, check-ins, snapshot flushes and
 *     the forget call itself, which ride the same global `fetch` the observer
 *     watches and are not the app's calls by any reading;
 *   • UNATTRIBUTABLE — an event we could not read a destination off at all.
 *
 * Counting the second as the first is a defect with a measured cost: a service
 * making no outbound calls at all was reported as making 70–86 outbound
 * attempts and opening 9–11 connections, an outbound-reliability row appeared
 * where there should have been no row, and a slow or refusing Boosthis would
 * have dragged down every Node customer's outbound reliability at once and
 * pointed them at their own dependencies.
 *
 * TWO THINGS LIVE HERE THAT DID NOT LIVE ANYWHERE BEFORE.
 *
 * 1. THE EXCLUSION OUTLIVES THE DETECTORS. This set used to sit in
 *    liveDetectors.ts and be emptied by `clearDetectors()`, which
 *    `telemetry.forget()` calls. Forgetting the kit does not stop the kit's own
 *    traffic: `forget()` itself posts to our endpoint after that wipe, uploads
 *    already in flight still land, and the observer re-arms on the host's very
 *    next request. Every one of those calls was then counted as the app's own
 *    outbound traffic — the same defect, back through another door, in a window
 *    the customer cannot see. So the answer to "is this ours?" is held here,
 *    where erasure does not reach it.
 *
 *    WHAT THAT KEEPS, EXACTLY: bare hostnames of OUR OWN upload endpoint, put
 *    here by us from our own configuration. Not the customer's hosts, not their
 *    traffic, nothing they ever sent us — the one address erasure must keep is
 *    our own, because dropping it is what makes our remaining calls read as
 *    theirs. Bounded ({@link MAX_IGNORED_HOSTS}) so it cannot grow, and the
 *    test hook below still empties it so each test starts from a bare process.
 *
 * 2. A COUNTER CANNOT BE FED WITHOUT ASKING. networkSampler.ts is deliberately
 *    host-free — only durations and outcome counts ever reach it — so it cannot
 *    screen our endpoint itself, and the whole exclusion used to live in its one
 *    caller. Correct while there is one caller, and silently wrong the day a
 *    second observation point is wired in (a plain `http.ClientRequest` patch,
 *    another client library): it would feed our own traffic straight into the
 *    app's meters with nothing to refuse it and no test failing.
 *
 *    So the sampler's three starting points now demand an {@link AppTraffic}
 *    pass, and this module is the only place one can be had. A new observation
 *    point that has not asked the question does not compile; one that asks and
 *    gets `null` has been told the answer. The pass carries NO host — it is a
 *    bare marker meaning "somebody asked, and the answer was the app" — so the
 *    sampler's privacy contract is untouched: the question is answered on this
 *    side of the boundary and only the verdict crosses it.
 */

/** Extract a bare, non-PII hostname from a URL/origin/host string. Returns ""
 *  when nothing host-shaped is present (caller then skips the attempt). Never
 *  throws. Path, query, userinfo, and port are all discarded. */
export function hostOf(target: unknown): string {
  if (typeof target !== "string" || target.length === 0) return "";
  try {
    // Absolute URL → use the parser (drops path/query/userinfo/port cleanly).
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
      return new URL(target).hostname.toLowerCase();
    }
  } catch {
    // fall through to the manual path
  }
  // Bare "host", "host:port", or "host/path" — keep the authority's host only.
  let s = target.trim();
  const at = s.lastIndexOf("@");
  if (at >= 0) s = s.slice(at + 1); // strip userinfo
  s = s.split("/")[0].split("?")[0]; // strip path/query
  s = s.split(":")[0]; // strip port
  return s.toLowerCase();
}

/** Ceiling on how many of our own endpoints one process can register. An app
 *  that enables the kit twice against two endpoints is ordinary; thousands is
 *  not, and this set is no longer emptied by erasure, so it states its own
 *  bound rather than trusting the callers it happens to have today. */
const MAX_IGNORED_HOSTS = 16;

/** Hosts that are OURS, not the app's. Holds only our own upload endpoint —
 *  registered by `enableTelemetry` from the configured endpoint and passed
 *  through {@link hostOf}, so only a bare hostname is ever stored and nothing
 *  here came from the customer. */
const ignoredHosts = new Set<string>();

/** Register a host as Boosthis's own upload endpoint. Idempotent, bounded, and
 *  safe under the kill-switch. */
export function ignoreHost(target: unknown): void {
  const host = hostOf(target);
  if (!host) return;
  if (ignoredHosts.has(host)) return;
  if (ignoredHosts.size >= MAX_IGNORED_HOSTS) return;
  ignoredHosts.add(host);
}

/** Is this bare host Boosthis's OWN upload endpoint?
 *
 *  ONE RULE, ASKED BEFORE ANY COUNTER. Every observer callback in
 *  `liveDetectors.ensureArmed` asks this FIRST and returns, rather than each
 *  reading remembering to ask for itself.
 *
 *  It used to be asked eleven lines in, which guarded the repeated-work,
 *  hosted-database, AI and dependency readings and left everything above it
 *  counting our own traffic: the network sampler's attempts, completions,
 *  failures, timeouts, stalls and retained durations, and the new-connection
 *  count. See this file's header for what that cost. */
export function isOwnUploadHost(host: string): boolean {
  return host !== "" && ignoredHosts.has(host);
}

/** Proof that somebody asked whose outbound call this was and was told "the
 *  app's". Carries no host, no URL and no request — only the verdict — so a
 *  module that must never see a destination can still demand that the question
 *  was answered before it counts anything.
 *
 *  Mintable ONLY by {@link attributeOutbound}, which is what makes it proof
 *  rather than decoration. */
export interface AppTraffic {
  /** Present so the marker is recognisable across a duplicated module copy,
   *  where identity alone would fail and every meter would silently go to
   *  zero. Writing this object out by hand to dodge the screen is not
   *  something anyone does by accident, which is the only failure this guards
   *  against — the compiler catches the rest. */
  readonly boosthisOutbound: "app";
}

const APP_TRAFFIC: AppTraffic = Object.freeze({ boosthisOutbound: "app" });

/** Ask whose outbound call this is. Returns a pass for the app's own traffic,
 *  and `null` for the two cases a meter must not count:
 *
 *   • our own endpoint — it is our traffic, not theirs;
 *   • a host we could not read — a call we cannot attribute MIGHT be ours, and
 *     a maybe counted as the app's is exactly the mistake this closes. The
 *     connect-side callbacks have always dropped an unreadable host; the
 *     request-side ones now agree with them instead of counting it.
 *
 *  Never throws. */
export function attributeOutbound(host: string): AppTraffic | null {
  if (typeof host !== "string" || host === "") return null;
  if (ignoredHosts.has(host)) return null;
  return APP_TRAFFIC;
}

/** The same question about an undici request object. */
export function attributeOutboundRequest(
  req: { origin?: unknown } | null | undefined,
): AppTraffic | null {
  if (!req) return null;
  return attributeOutbound(hostOf(req.origin));
}

/** Does this value really come from {@link attributeOutbound}? Used by the
 *  sampler to refuse a caller that never asked. */
export function isAppTraffic(pass: unknown): pass is AppTraffic {
  if (pass === APP_TRAFFIC) return true;
  return (
    typeof pass === "object" &&
    pass !== null &&
    (pass as { boosthisOutbound?: unknown }).boosthisOutbound === "app"
  );
}

/** @internal test hook.
 *
 *  Erasure deliberately does NOT clear the registered endpoints (see the file
 *  header), so this is how a test gets back to a bare process. It is a test
 *  hook and not a second erasure path on purpose: the production call that
 *  wipes detector state must keep the exclusion, and a test proving that must
 *  be able to use the real one. */
export const _ownTrafficInternals = {
  MAX_IGNORED_HOSTS,
  reset(): void {
    ignoredHosts.clear();
  },
  get ignoredHostCount(): number {
    return ignoredHosts.size;
  },
};
