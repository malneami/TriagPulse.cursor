/** WHICH PROJECT this kit reports to, in the developer's own words.
 *
 * WHY this exists: every surface a developer could open inside their own app —
 * the floating panel, the /_boosthis page, the status page — named a masked key
 * tail, an install id and an app name, and NEVER the project name they typed on
 * their dashboard. Meanwhile the AI connection had been naming the project
 * everywhere for weeks. The same project told two different stories depending
 * on which window you were looking at, and a developer holding two projects in
 * one codebase could not tell from inside the app which one they were feeding.
 *
 * A kit cannot work the name out on its own: it holds a key, not a name. So the
 * server sends it back on the registration reply and this module keeps it.
 *
 * TWO rules that are easy to get wrong:
 *
 *  1. THE NAME IS UNTRUSTED DISPLAY DATA. It is the one developer-authored
 *     string a kit draws from the wire (everything else the panel renders is a
 *     literal in the kit's own source). The server screens and caps it at mint
 *     time; this module screens it AGAIN — control characters out, whitespace
 *     collapsed, hard length cap — and every renderer sets it as TEXT, never as
 *     markup.
 *
 *  2. THE FALLBACK WORDING IS OURS, NOT THE SERVER'S. An unnamed project sends
 *     a code and no name; a server that is too old to know about any of this
 *     sends neither. Both cases are answered by literals below, so no server
 *     prose is ever drawn inside a customer's app.
 */

/** Hard cap on a rendered project name. Matches the server's own mint-time cap
 *  so a long name can never crowd the code out of a narrow panel. */
const MAX_NAME_CHARS = 60;
/** The code is a key-fingerprint prefix — short, and only ever letters/digits. */
const MAX_CODE_CHARS = 16;

/** What the panel says when a real project simply has no name yet. The kit's
 *  own words, matching what the dashboard calls such a project. */
export const PROJECT_UNNAMED_TEXT = "Unnamed project";

/** What the panel says when the server has told this kit NOTHING about its
 *  project — it has not registered yet, or it is talking to a server older than
 *  this field. Honest about the gap instead of showing a blank or a guess. */
export const PROJECT_UNKNOWN_TEXT = "Not received from Boosthis yet";

/** The label every surface puts in front of the value above. */
export const PROJECT_LABEL = "Project";

/** The identity this kit is CURRENTLY holding, printed on every surface that
 *  reports whether the install is on file. Without it a developer comparing
 *  the panel with the dashboard has no way to tell whether they are looking at
 *  the same install — and an assisting AI reading a "not registered" line has
 *  no way to tell which id was asked about. */
export const INSTALL_ID_LABEL = "Install ID";

/** What that line says before any identity exists — the kit has not started,
 *  so there is nothing to compare with the dashboard yet. */
export const INSTALL_ID_UNKNOWN_TEXT = "not assigned yet";

/** The caption printed under the headline score, on every kit surface that
 *  shows one. The score is computed from what this process measured about
 *  itself and says NOTHING about whether any of it reached Boosthis — an app
 *  that has never once connected still scores 100. Without this line a green
 *  number reads as proof of a healthy connection, which is exactly the quiet
 *  failure the notice above the score exists to end. */
export const SCORE_CAPTION =
  "Measured on this device. Not proof anything reached Boosthis.";

/** What this kit knows about its project. Both fields null until the server
 *  says otherwise. */
export interface KitProject {
  /** The developer's own name, sanitised, or null when the project is unnamed
   *  (or nothing has arrived yet). */
  name: string | null;
  /** The short project code, or null when nothing has arrived yet. */
  code: string | null;
}

/** Strip anything that could break, hide or reshape a rendered line: control
 *  characters out, every run of whitespace collapsed to one space, then capped.
 *  Returns null when nothing readable is left. */
export function sanitizeProjectName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_CHARS)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** The code is ours, not the developer's, but it arrives over the same wire —
 *  so it is held to the shape we know it has: letters and digits only. */
export function sanitizeProjectCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^A-Za-z0-9]/g, "").slice(0, MAX_CODE_CHARS);
  return cleaned.length > 0 ? cleaned : null;
}

/** The one spelling of a project, used by every surface so they can never
 *  disagree:
 *    named        -> `Acme Store (ab12cd34)`
 *    unnamed      -> `Unnamed project (ab12cd34)`
 *    nothing yet  -> `Not received from Boosthis yet`
 */
export function projectDisplay(p: KitProject | null | undefined): string {
  const code = p?.code ?? null;
  if (!code) return PROJECT_UNKNOWN_TEXT;
  return `${p?.name ?? PROJECT_UNNAMED_TEXT} (${code})`;
}

// ── The one copy this process holds ─────────────────────────────────────────

let current: KitProject = { name: null, code: null };

/** Record what the server said on a consent reply. Only ever moves forward: a
 *  reply that omits the fields (an older server, or a path that could not
 *  resolve the key) leaves the last known answer alone rather than blanking a
 *  name the developer is already reading. */
export function setKitProject(name: unknown, code: unknown): void {
  const nextCode = sanitizeProjectCode(code);
  const nextName = sanitizeProjectName(name);
  if (nextCode) current = { name: nextName, code: nextCode };
  else if (nextName) current = { name: nextName, code: current.code };
}

/** What this kit currently knows. Never throws, never null. */
export function getKitProject(): KitProject {
  return { name: current.name, code: current.code };
}

/** Forget everything the server said: the project's name and code and the
 *  promises it sent. Part of the kit's own erase on a dissolved project
 *  (docs/kit-lock-rule.md). Never throws. */
export function clearKitProject(): void {
  current = { name: null, code: null };
  currentPromises = [];
  currentPromiseTotal = 0;
}

/** Test-only: forget everything the server said. */
export function _resetKitProject(): void {
  clearKitProject();
}

// ── The developer's own standing promises ───────────────────────────────────
//
// A promise is the one thing in Boosthis that IS a standing instruction, and
// the surfaces that carried it were all outside the app: the dashboard, an
// alert, an AI connection. This kit serves a page inside the developer's own
// app, so the promises ride the same consent reply the project name does.
//
// The SAME two rules apply, with one addition:
//
//  1. THE WORDING IS UNTRUSTED DISPLAY DATA — the developer's own words,
//     screened by the server, screened again here, rendered as text.
//  2. THE STANDING IS A CLOSED TOKEN, never a sentence. The words for
//     "watched" and "remembered only" are literals in the page's own source,
//     held byte-equal to the server's by a test, so no server prose is drawn
//     inside a customer's app.
//  3. NO VERDICT TRAVELS. Whether a watched promise is currently broken moves
//     between one registration and the next, and this page would go on
//     showing the answer from process start. The page says where each promise
//     stands with Boosthis; the dashboard says how it is doing.

/** Hard cap on a rendered promise, and deliberately the SAME number the
 *  server refuses a longer promise at. A smaller one here would quietly
 *  rewrite the developer's own standing instruction — the one piece of text
 *  in this page that is theirs and not ours — and the page would give no sign
 *  it had. So nothing that was accepted can be trimmed, and anything longer
 *  than the server would ever store is dropped WHOLE rather than shortened.
 *  Held to the server's own limit by a test in the scripts package. */
const MAX_PROMISE_CHARS = 240;

/** The most promises this kit will hold. Bounded here as well as on the
 *  server, so a reply cannot make this page grow without limit. */
const MAX_PROMISES = 6;

/** Where a promise stands with Boosthis. Exactly two values, ever. */
export type KitPromiseStanding = "watched" | "remembered-only";

/** One promise, as this kit holds it. */
export interface KitPromise {
  /** The developer's own words, sanitised. */
  text: string;
  standing: KitPromiseStanding;
}

let currentPromises: KitPromise[] = [];
/** How many the project holds in total, so the page can say what it is not
 *  showing rather than trimming silently. */
let currentPromiseTotal = 0;

/** Same screen as a project name: control characters out, whitespace
 *  collapsed, capped. Returns null when nothing readable is left. */
export function sanitizePromiseText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Whole, or not at all. A promise longer than the server stores did not
  // come from the promise store, and half of someone's standing instruction
  // is not a shorter version of it.
  if (cleaned.length === 0 || cleaned.length > MAX_PROMISE_CHARS) return null;
  return cleaned;
}

/** Read the promises off a consent reply. Anything unrecognised is dropped —
 *  a standing this kit does not know is not rendered as either of the two it
 *  does.
 *
 *  THE REPLY IS THE ANSWER, whatever it says. A list replaces what was held,
 *  an empty list clears it, and a reply carrying no promises at all clears it
 *  too: the server sends the empty list explicitly when a project holds none,
 *  so nothing arriving means Boosthis could not read them — and a promise we
 *  cannot confirm is still held is exactly the one this page must stop
 *  showing. Unlike the project name, which is an identity that does not stop
 *  being true, a promise is a live list the developer edits. */
export function setKitPromises(raw: unknown): void {
  const obj = raw as { total?: unknown; items?: unknown } | null | undefined;
  const items = Array.isArray(obj?.items) ? obj!.items : null;
  if (!items) {
    currentPromises = [];
    currentPromiseTotal = 0;
    return;
  }
  const next: KitPromise[] = [];
  for (const item of items.slice(0, MAX_PROMISES)) {
    const entry = item as { text?: unknown; standing?: unknown };
    const text = sanitizePromiseText(entry?.text);
    const standing = entry?.standing;
    if (!text) continue;
    if (standing !== "watched" && standing !== "remembered-only") continue;
    next.push({ text, standing });
  }
  currentPromises = next;
  const total = typeof obj?.total === "number" ? Math.floor(obj.total) : 0;
  // Never below what is actually being shown: a total that disagreed with the
  // list would make the page say it is hiding a negative number of promises.
  currentPromiseTotal = Math.max(next.length, total > 0 ? total : 0);
}

/** What this kit currently holds. Never throws. */
export function getKitPromises(): { total: number; items: KitPromise[] } {
  return {
    total: currentPromiseTotal,
    items: currentPromises.map((p) => ({ text: p.text, standing: p.standing })),
  };
}

/** The serialised form persisted beside the project name, so a restarted
 *  process shows the promises before its first consent comes back. */
export function serializeKitPromises(): string {
  return JSON.stringify(getKitPromises());
}

/** Read back {@link serializeKitPromises}. Anything unreadable is treated as
 *  nothing stored — the page then shows no promises until the next reply. */
export function parseKitPromises(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** The serialised form persisted beside the kit's other credentials, so a
 *  restarted process still names its project before the first consent of the
 *  new run has come back. */
export function serializeKitProject(p: KitProject): string {
  return JSON.stringify({ name: p.name, code: p.code });
}

/** Read back {@link serializeKitProject}. Anything unreadable is treated as
 *  "nothing stored" — a lost name only means the panel says so until the next
 *  registration. */
export function parseKitProject(raw: unknown): KitProject | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const obj = JSON.parse(raw) as { name?: unknown; code?: unknown };
    const code = sanitizeProjectCode(obj?.code);
    const name = sanitizeProjectName(obj?.name);
    if (!code && !name) return null;
    return { name, code };
  } catch {
    return null;
  }
}
