/** The two ungated lines every Boosthis kit says about switching itself on.
 *
 * WHY THIS EXISTS
 * A kit that never started is perfectly silent: it draws nothing, contacts
 * nobody and appears nowhere — which is indistinguishable from a kit that is
 * running quietly by choice. A real customer install was misdiagnosed for two
 * days on exactly that ambiguity (sandboxes and key rotations were blamed; the
 * start call had simply never run).
 *
 * So every kit now says ONE short line the moment its start path begins:
 *
 *   [boosthis] Boosthis starting: project key ...1a2b. Registering next.
 *
 * That line is the anchor for every diagnosis. No line means the kit never
 * started, whatever anyone else believes. It is never silenced by a quiet
 * mode, a privacy setting or a switched-off badge, because it reveals nothing
 * about the app: a four-character tail of a key the developer already holds.
 *
 * The second line refuses a value that cannot be a project key AT THE POINT IT
 * IS SUPPLIED. The same install pasted `Bearer bk_...` (the way an HTTP header
 * shows a key) and the failure surfaced three layers away as a refused
 * registration with no explanation. Nothing is ever stripped or repaired
 * silently — a wrong value is reported and refused.
 *
 * The wording is duplicated verbatim in every kit ON PURPOSE (no server prose
 * ever renders inside a host app) and a cross-runtime guard greps each phrase
 * as a contiguous literal. See .agents/memory/kit-startup-announcement.md.
 */

/** The four things a supplied value can be wrong in. Closed set: a kit must
 *  never invent a fifth explanation. */
export type ProjectKeyProblem =
  | "authWord"
  | "quoted"
  | "cutOff"
  | "wrongShape";

/** Authorization words an HTTP header shows in front of a key. Matched only at
 *  the very start, followed by whitespace. */
const AUTH_WORDS = ["bearer", "token", "basic", "apikey", "api-key", "key"];

/** Quote-ish characters a paste can wrap a key in (including the guide's own
 *  `<...>` placeholder brackets). */
const QUOTE_CHARS = ['"', "'", "`", "\u2018", "\u2019", "\u201c", "\u201d"];

/** A project key is one unbroken run of these characters. */
const KEY_CHARS = /^[A-Za-z0-9_-]+$/;

/**
 * Name what is wrong with a supplied project key, or null when it could be a
 * real one. Deliberately conservative: it refuses only values that CANNOT be a
 * key, never values that merely look unfamiliar (env-configured keys predate
 * the `bk_` prefix and must keep working).
 */
export function findProjectKeyProblem(
  raw: unknown,
): ProjectKeyProblem | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null; // "absent" is a different condition, handled elsewhere
  const lower = value.toLowerCase();
  for (const word of AUTH_WORDS) {
    if (lower.startsWith(word) && /\s/.test(value.charAt(word.length))) {
      return "authWord";
    }
  }
  const first = value.charAt(0);
  const last = value.charAt(value.length - 1);
  if (
    QUOTE_CHARS.indexOf(first) >= 0 ||
    QUOTE_CHARS.indexOf(last) >= 0 ||
    (first === "<" && last === ">")
  ) {
    return "quoted";
  }
  // Only an ELLIPSIS is honest evidence of truncation. A key may be any
  // length (env-configured keys predate the `bk_` prefix entirely), so a
  // short-but-plausible value must never be refused as "cut off" — being
  // shorter than a key can be is a shape problem, checked below.
  if (
    value.endsWith("...") ||
    value.endsWith("\u2026") ||
    value.startsWith("...") ||
    value.startsWith("\u2026")
  ) {
    return "cutOff";
  }
  if (!KEY_CHARS.test(value) || value.length < 8) return "wrongShape";
  return null;
}

/** The sentence, per problem. Kit-authored literals, identical in every kit. */
function problemSentence(problem: ProjectKeyProblem): string {
  switch (problem) {
    case "authWord":
      return "it starts with an authorization word. Paste the key on its own, with nothing in front of it.";
    case "quoted":
      return "it is wrapped in quotes. Paste the key on its own, with no quotes around it.";
    case "cutOff":
      return "it looks cut off. Paste the whole key from your Boosthis Setup page.";
    case "wrongShape":
      return "it is not the shape of a project key. A project key is one unbroken value from your Boosthis Setup page.";
  }
}

/**
 * The full refusal line. `source` names the attribute, environment variable or
 * setting the value came from, so the developer knows where to look.
 */
export function projectKeyRefusalLine(
  problem: ProjectKeyProblem,
  source: string,
): string {
  return `[boosthis] Boosthis will not use the project key from ${source}: ${problemSentence(problem)}`;
}

/** Last four characters of a key — the only part of it that is ever printed. */
export function projectKeyTail(key: unknown): string | null {
  if (typeof key !== "string") return null;
  const value = key.trim();
  if (!value) return null;
  return value.length >= 4 ? value.slice(-4) : value;
}

/** Why the badge will not be on the page, when it will not. */
export type BadgeState =
  | "visible"
  | "owner-only"
  | "hidden-by-setting"
  | "switched-off";

/** The startup line's words for a wanted badge: the kit injects it only for
 *  a browser switched on with an owner link (or from the machine itself with
 *  `?boosthis=on`). Shared word for word
 *  by every server kit. */
export const OWNER_ONLY_BADGE_SENTENCE =
  " Badge hidden from visitors; it shows only in a browser switched on with the owner link from your project's page on Boosthis, or with ?boosthis=on from this machine itself.";

/** The startup line itself. Exported for tests and for the guides. */
export function kitStartupLine(
  tail: string | null,
  badge: BadgeState = "visible",
): string {
  const head = tail
    ? `[boosthis] Boosthis starting: project key ...${tail}. Registering next.`
    : "[boosthis] Boosthis starting: no project key. Nothing will register.";
  if (badge === "owner-only") return `${head}${OWNER_ONLY_BADGE_SENTENCE}`;
  if (badge === "hidden-by-setting") {
    return `${head} Badge hidden by a setting; Boosthis is still running.`;
  }
  if (badge === "switched-off") {
    return `${head} Badge hidden: Boosthis is switched off.`;
  }
  return head;
}

// ── one line per page load ────────────────────────────────────────────────

let announced = false;
let pendingBadge: BadgeState | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingImmediate: ReturnType<typeof setImmediate> | null = null;
let announcementPending = false;
const refused = new Set<string>();
/** Lines waiting for the anchor, in the order they were produced. `note` marks
 *  evidence (said with console.info) rather than a complaint. */
const heldRefusals: Array<{ line: string; note: boolean }> = [];

function say(line: string): void {
  try {
    // Deliberately console.info, not warn: this line is evidence, not a
    // complaint, and a healthy install prints it too.
    console.info(line);
  } catch {
    // A host that replaced console must never crash because of our line.
  }
}

function sayRefusal(line: string): void {
  try {
    console.warn(line);
  } catch {
    /* a host that replaced console must not crash on a warning */
  }
}

/**
 * Mark the start path as begun, BEFORE a single key is read.
 *
 * From here until the line is actually said, a refusal is held back and
 * released immediately afterwards. Without this the first thing a developer
 * sees can be a complaint about a key — which is precisely the reading order
 * that cost one install two days, because a complaint about a key implies the
 * kit is running when it may not be. The anchor line comes first, always.
 *
 * Holding is strictly bounded: a refusal is only ever queued while an
 * announcement is pending, and every path that announces drains the queue.
 */
export function beginStartAnnouncement(): void {
  if (announced) return;
  announcementPending = true;
}

/**
 * Say a developer-facing complaint, but never ahead of the startup line. For
 * objections produced before the kit is started.
 */
export function sayAfterStartupLine(line: string): void {
  if (announcementPending && !announced) {
    heldRefusals.push({ line, note: false });
    return;
  }
  sayRefusal(line);
}

/**
 * Say an informational line — evidence, not a complaint — but never ahead of
 * the startup line either. For what the developer configured before the kit
 * was started (the waits they declared on purpose), which reads as nonsense
 * above the line that says the kit is running at all.
 */
export function sayNoteAfterStartupLine(line: string): void {
  if (announcementPending && !announced) {
    heldRefusals.push({ line, note: true });
    return;
  }
  say(line);
}

/** Print anything held back. Called the instant the line is said, and by the
 *  start path if it fails before getting that far. */
export function flushHeldRefusals(): void {
  announcementPending = false;
  if (heldRefusals.length === 0) return;
  const lines = heldRefusals.splice(0, heldRefusals.length);
  for (const held of lines) {
    if (held.note) say(held.line);
    else sayRefusal(held.line);
  }
}

function flushPending(): void {
  pendingTimer = null;
  pendingImmediate = null;
  if (announced || pendingBadge === null) return;
  const badge = pendingBadge;
  pendingBadge = null;
  announced = true;
  say(kitStartupLine(null, badge));
  flushHeldRefusals();
}

/**
 * The second half of the wait.
 *
 * WHY TWO HOPS AND NOT ONE. The install this runtime documents supplies the
 * key AFTER the start call, and often from inside `app.listen(...)`'s
 * callback. Whether a bare `setTimeout(…, 0)` gives that callback its turn
 * first is an engine decision, and the engines disagree:
 *
 *   node — listen callback, then the timer
 *   bun  — the timer, then the listen callback
 *
 * On Bun a one-hop wait therefore expires first and the kit says "no project
 * key. Nothing will register." about an install that goes on to register
 * perfectly. That line is the anchor for every diagnosis, so it lying is worse
 * than it being late. Hopping once more (timer, then check phase) puts the
 * flush after the listen callback on BOTH engines — measured, not assumed —
 * without adding any wall-clock delay or a second line.
 */
function waitOneMoreTurn(): void {
  pendingTimer = null;
  if (announced || pendingBadge === null) return;
  if (typeof setImmediate !== "function") {
    flushPending();
    return;
  }
  try {
    pendingImmediate = setImmediate(flushPending);
  } catch {
    flushPending();
  }
}

/** Cancel whichever half of the wait is still outstanding. */
function cancelPendingWait(): void {
  if (pendingTimer !== null) {
    try {
      clearTimeout(pendingTimer);
    } catch {
      /* nothing to do */
    }
    pendingTimer = null;
  }
  if (pendingImmediate !== null) {
    try {
      clearImmediate(pendingImmediate);
    } catch {
      /* nothing to do */
    }
    pendingImmediate = null;
  }
}

/**
 * Say the startup line. Called at the very top of the `boosthis()` middleware
 * factory — before
 * the key is resolved, before any registration, ahead of the measurement APIs
 * — so it appears wherever the badge would.
 *
 * This runtime's key can arrive AFTER its start call: the install is
 * documented as `app.use(boosthis())` and then `enableTelemetry({ inviteKey })`
 * separately. So when no key is known yet the line waits one turn of the event
 * loop for `enableTelemetry` to supply one, rather than committing to a "no
 * project key" the install does not deserve. Exactly one line is printed
 * either way.
 */
export function announceKitStart(
  key: string | null | undefined,
  badge: BadgeState,
): void {
  if (announced || pendingBadge !== null) return;
  const tail = projectKeyTail(key);
  if (tail) {
    announced = true;
    say(kitStartupLine(tail, badge));
    flushHeldRefusals();
    return;
  }
  pendingBadge = badge;
  try {
    pendingTimer = setTimeout(waitOneMoreTurn, 0);
  } catch {
    flushPending();
  }
}

/** The key the reporting client resolved. Fills in a start line that is still
 *  waiting for one; a no-op once the line has been said. */
export function announceProjectKey(key: string | null | undefined): void {
  if (announced || pendingBadge === null) return;
  const tail = projectKeyTail(key);
  if (!tail) return;
  const badge = pendingBadge;
  pendingBadge = null;
  cancelPendingWait();
  announced = true;
  say(kitStartupLine(tail, badge));
  flushHeldRefusals();
}

/**
 * Refuse a supplied value once, naming where it came from. Returns true when
 * the value was refused (the caller must then behave as if no key was given —
 * never as if a repaired one was).
 */
export function warnProjectKeyRefused(raw: unknown, source: string): boolean {
  const problem = findProjectKeyProblem(raw);
  if (!problem) return false;
  if (!refused.has(source)) {
    refused.add(source);
    const line = projectKeyRefusalLine(problem, source);
    // Never ahead of the anchor line: a refusal read first implies the kit is
    // running, which is the one thing it cannot vouch for.
    if (announcementPending && !announced) heldRefusals.push({ line, note: false });
    else sayRefusal(line);
  }
  return true;
}

/** @internal test hook */
export function _resetStartAnnounceForTests(): void {
  announced = false;
  pendingBadge = null;
  cancelPendingWait();
  announcementPending = false;
  heldRefusals.length = 0;
  refused.clear();
}
