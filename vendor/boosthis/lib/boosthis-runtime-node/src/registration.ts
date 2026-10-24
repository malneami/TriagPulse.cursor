/**
 * "Is THIS install on file with Boosthis?" — the one answer the in-app panel
 * and the standalone status page are allowed to render a registration verdict
 * from. Port of the browser kit's `registration.ts`, word for word in its
 * state machine so the two kits can never disagree about what "registered"
 * means.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Every surface used to decide "registered" from process-local state alone:
 * this process holds a delete token. That is true of the process that first
 * registered and false of every restart that could not read its store, of a
 * second worker in a cluster, and of a container that came up with a cold
 * disk. Same live install, two contradictory verdicts, and only one can be
 * true. Worse, the panel is what an assisting AI reads to decide whether it is
 * done: a false "not registered" makes the AI change the install line's id,
 * which mints a second install, which the panel also calls not registered.
 *
 * A verdict about the SERVER's records has to come from the server. This
 * module holds that answer in FIVE internal states so a real negative can be
 * told apart from an unanswered question:
 *
 *   pending      no answer yet (the check has not run, or is in flight)
 *   registered   we asked (or registered) and the install IS on file
 *   unregistered we asked and it is NOT on file / the key was refused
 *   throttled    we asked and were rate-limited — a temporary, self-clearing
 *                refusal the kit is already waiting out
 *   unreachable  we asked and could not get an answer at all
 *
 * `throttled` exists because it and `unreachable` need OPPOSITE reactions. A
 * server we cannot reach is a fault to investigate — check egress, TLS, the
 * endpoint. A throttle is us being told to wait, by a server that is working
 * perfectly, with a deadline attached. Recording both as "cannot tell" sent
 * developers hunting for a network fault that did not exist.
 *
 * The public verdict collapses `pending`, `throttled` and `unreachable` into
 * `"unknown"`: three outcomes, never two, so an unanswered check can never be
 * shown as a failed install and can never carry the claim that nothing is
 * being sent. A throttled install genuinely is unknown — we were refused
 * before anyone looked at our records.
 *
 * Never throws into the host: every entry point is self-guarded, and a failed
 * probe degrades to `unreachable`.
 */

import { answerWithin, readAnswerJson } from "./answerRead";

/** Internal, five-way. `unreachable` is a FAILED attempt, `throttled` is a
 *  refusal that clears by itself, `pending` is no attempt yet — callers that
 *  need the difference read this. */
export type RegistrationState =
  | "pending"
  | "registered"
  | "unregistered"
  | "throttled"
  | "unreachable";

/** What a display surface is allowed to know: three outcomes, not two. */
export type RegistrationVerdict = "registered" | "unregistered" | "unknown";

let state: RegistrationState = "pending";
let inFlight = false;
let lastAttemptAt = 0;

/** Don't re-ask more than this often while the answer is still missing. The
 *  panel's 5s poll and every status-page load would otherwise hammer the
 *  route. */
const RECHECK_MS = 30_000;

/** The longest one registration question may take, start to finish. */
const REGISTRATION_ASK_MS = 10_000;

function setState(next: RegistrationState): void {
  if (next === state) return;
  state = next;
}

/** The server has this install on file — proven by a consent call it accepted
 *  (a delete token only exists because the server minted it), or by the
 *  registration probe below. */
export function markRegistrationConfirmed(): void {
  setState("registered");
}

/** A definite negative: the server does not have this install on file, or it
 *  refused the project key outright (so this app cannot register with it). */
export function markRegistrationRefused(): void {
  setState("unregistered");
}

/** We asked and got no usable answer (network down, 5xx, a server too old to
 *  know the route). Never downgrades a definite answer we already hold: a
 *  registered install stays registered when the connection drops. */
export function markRegistrationUnreachable(): void {
  if (state === "registered" || state === "unregistered") return;
  setState("unreachable");
}

/** We asked and were rate-limited (HTTP 429). Still "cannot tell" as far as
 *  the public verdict goes — nobody looked at our records — but it is a
 *  WORKING server telling us to wait, not a server we could not reach, and the
 *  kit is already waiting out a deadline it was given. Never downgrades a
 *  definite answer we already hold. */
export function markRegistrationThrottled(): void {
  if (state === "registered" || state === "unregistered") return;
  setState("throttled");
}

export function getRegistrationState(): RegistrationState {
  return state;
}

/** The three-outcome verdict every display surface must use. */
export function getRegistrationVerdict(): RegistrationVerdict {
  if (state === "registered") return "registered";
  if (state === "unregistered") return "unregistered";
  return "unknown";
}

/** Test-only: forget the answer and every latch. */
export function _resetRegistrationForTests(): void {
  state = "pending";
  inFlight = false;
  lastAttemptAt = 0;
}

export interface RegistrationCheckContext {
  endpoint: string | null | undefined;
  installId: string | null | undefined;
  /** The project key this app registers with. Without one the app cannot
   *  register at all, and we cannot ask about it either. */
  projectKey: string | null | undefined;
  fetchImpl?: typeof fetch;
  /** Test seam only. */
  nowMs?: number;
}

/**
 * Ask the server whether this install is on file, and record the answer.
 *
 * `GET /installs/{installId}/registration` with the project key as the bearer —
 * the process already holds that key (it is what the kit registers with), so
 * asking leaks nothing new. The route answers `{ registered: boolean }`, and
 * only ever says `true` for an install on the presented key's own key line.
 *
 * Fire-and-forget: never rejects, never throws, and re-asks at most once every
 * 30s while the answer is still missing. Anything that is not a clean answer
 * (offline, 5xx, an older server that 404s the route itself) lands on
 * `unreachable` — "cannot tell", never "not registered".
 */
export async function checkRegistrationOnce(
  ctx: RegistrationCheckContext,
): Promise<void> {
  try {
    // A definite answer is never re-asked; local latching keeps the panel calm.
    if (state === "registered" || state === "unregistered") return;
    if (inFlight) return;
    const now = ctx.nowMs ?? Date.now();
    if (lastAttemptAt !== 0 && now - lastAttemptAt < RECHECK_MS) return;

    const endpoint = ctx.endpoint;
    const installId = ctx.installId;
    if (!endpoint || !installId) {
      // Nothing to ask about: the kit never started. That is a LOCAL fact, not
      // a guess about the server, so it is a definite negative.
      setState("unregistered");
      return;
    }
    if (!ctx.projectKey) {
      // No key means this app cannot register with us at all — equally a local
      // fact.
      setState("unregistered");
      return;
    }
    const f = ctx.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
    if (!f) {
      // No way to ask at all — that is "cannot tell", never a failed install.
      setState("unreachable");
      return;
    }

    inFlight = true;
    lastAttemptAt = now;
    // One clock for the whole question: the server starting to answer AND the
    // answer arriving. A host transport that ignores the abort is still let go
    // of at the same moment, so a server that never answers cannot pin the
    // check (and its in-flight latch) for the life of the process.
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), REGISTRATION_ASK_MS);
    (timer as { unref?: () => void }).unref?.();
    try {
      const base = endpoint.replace(/\/$/, "");
      const url = `${base}/installs/${encodeURIComponent(installId)}/registration`;
      const res = await answerWithin(
        f(url, {
          method: "GET",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${ctx.projectKey}`,
          },
          ...(ctl ? { signal: ctl.signal } : {}),
        }),
        REGISTRATION_ASK_MS,
      );
      if (res.status === 200) {
        let registered: unknown = undefined;
        try {
          // Bounded while reading: an answer over the ceiling, too slow to
          // arrive, or not JSON is the same as no answer — "unreachable",
          // asked again after RECHECK_MS.
          const body = (await readAnswerJson(res, {
            timeoutMs: REGISTRATION_ASK_MS,
          })) as { registered?: unknown } | null;
          registered = body?.registered;
        } catch {
          // Unreadable body — we asked, but we did not get an answer.
        }
        if (registered === true) setState("registered");
        else if (registered === false) setState("unregistered");
        else setState("unreachable");
        return;
      }
      if (res.status === 401 || res.status === 403) {
        // The key was refused, so this app cannot be registered under it.
        setState("unregistered");
        return;
      }
      if (res.status === 429) {
        // Rate-limited. We still do not know whether this install is on file,
        // but "we could not reach Boosthis" would be a lie — we reached it and
        // it answered, with an instruction to come back later. Keeping the two
        // apart is the difference between a developer checking their egress
        // and a developer doing nothing, correctly.
        setState("throttled");
        return;
      }
      // 404 (a server too old to know this route), 5xx, anything else:
      // we could not get an answer. Say exactly that.
      setState("unreachable");
    } finally {
      clearTimeout(timer);
      inFlight = false;
    }
  } catch {
    inFlight = false;
    try {
      markRegistrationUnreachable();
    } catch {
      // never throw into the host
    }
  }
}
