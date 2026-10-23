/**
 * Waits declared on purpose — the Node kit's half (also served as the Bun kit).
 *
 * Contract: docs/held-open-calls.md, "Waits declared on purpose". Some work
 * waits because it is MEANT to: a long-poll route that answers only when there
 * is news, or a bot that long-polls its messaging service (Telegram holds each
 * request for up to 30 seconds). Timed like ordinary work, the first rates the
 * app's own route poor and drags every reading built on request timings with
 * it, and the second reads as an outside service that keeps stalling. Neither
 * is true, and nothing in the traffic can tell such a wait from a slow one —
 * so the developer says which ones they are, by exact name, and the kit takes
 * them out of every speed reading OUT LOUD: each exclusion is counted and sent,
 * so a declaration can never quietly hide a slowness.
 *
 * TWO DIRECTIONS, ONE RULE.
 *
 *   routes — calls the app ANSWERS, named as the dashboard shows them
 *            (`GET /poll`, or `/poll` for every method of that route). Treated
 *            exactly like a held-open stream: the duration stays out of the
 *            score, Code Health, resilience, the latency floor, load
 *            deflection, learned budgets, route timings, slow-route alerts and
 *            traces; errors and in-flight counts are still recorded.
 *   calls  — calls the app MAKES, named by full address without the query
 *            (`https://api.telegram.org/bot:token/getUpdates`). Never on the
 *            stall clock, however long they wait; their durations stay out of
 *            the network and outside-service readings; their failures count.
 *
 * WHAT NEVER LEAVES THIS PROCESS. A call name is an address on someone else's
 * service and can hold a credential the developer pasted in place of a
 * placeholder, so it is compared HERE and only four counts are sent. A route
 * name is a route label the dashboard already shows, so it is sent with its
 * counts — after the same privacy check every route label passes.
 *
 * NO GUESSING. Matching is exact. A wildcard, a prefix, a pattern, a host on
 * its own and the kit's own routes are refused with a reason on the startup
 * line; there is no duration threshold and no automatic recognition. At most
 * ten names per direction: this is a declaration about a handful of routes,
 * never a general "exclude" switch, and a longer list is refused WHOLE (the
 * server says so on the project page) rather than trimmed to an arbitrary ten.
 */
import { transmitLabelHasPII } from "./no-pii";
import { isBunRuntime } from "./runtimeTag";
import { isBoosthisDisabled } from "./runtimeFlags";
import { sayAfterStartupLine, sayNoteAfterStartupLine } from "./startAnnounce";

/** The most names the kit holds, per direction (the contract's cap). */
export const DECLARED_WAIT_NAME_CAP = 10;
/** Longest accepted name, in characters. A route label is guarded at 200. */
export const DECLARED_WAIT_NAME_MAX = 200;
/** The most entries read from one supplied list. Past this the list is read no
 *  further: it is over the cap many times already, and refused whole anyway. */
export const DECLARED_WAIT_READ_MAX = 1000;
/** A request path longer than this is never compared against a call name. */
const MATCH_PATH_MAX = 2048;
/** A call-name segment longer than this is hidden on the startup line. */
const SHOWN_SEGMENT_MAX = 40;

const ROUTE_METHODS: readonly string[] = [
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
];

/** Why a declared name was refused. Closed; the server keeps the same list. */
export type DeclaredNameRefusal =
  | "wildcard"
  | "prefix"
  | "pattern"
  | "kit-route"
  | "host-only"
  | "malformed"
  | "private";

/** The one-line reason for each refusal — word for word the contract's. */
export const DECLARED_NAME_REFUSAL_REASON: Readonly<
  Record<DeclaredNameRefusal, string>
> = {
  wildcard: "a wildcard is not a name — name each route exactly",
  prefix: "a prefix covers routes nobody named — name each route exactly",
  pattern: "a pattern is not a name — write the route as the dashboard shows it",
  "kit-route": "the kit's own routes are not yours to declare",
  "host-only":
    "a host on its own is not an address — give the full address of the call",
  malformed:
    "not a name this rule accepts — no spaces, query or fragment, and a route starts with /",
  private: "the name failed the privacy check every route label passes",
};

/** What the developer supplied. Both lists optional. */
export interface DeclaredWaitsOption {
  /** Routes this app answers that wait on purpose, as the dashboard shows
   *  them: `"GET /poll"`, or `"/poll"` for every method of that route. */
  routes?: readonly string[];
  /** Calls this app makes that wait on purpose, by full address without the
   *  query: `"https://api.telegram.org/bot:token/getUpdates"`. A `:name`
   *  inside a path segment stands for the part that changes. */
  calls?: readonly string[];
}

/* ── Name rules ──────────────────────────────────────────────────────────── */

const PATTERN_CHARS = /[\^$()[\]|+\\]/;
const KIT_ROUTE = /^\/_{1,2}boosthis(?:\/|$)/i;
const QUERY_PAIR = /[?&][^/?&]*=/;

/** The path half of a name: every refusal a route and a call path share. */
function pathRefusal(path: string): DeclaredNameRefusal | null {
  if (!path.startsWith("/")) return "malformed";
  if (/\s/.test(path) || path.includes("#")) return "malformed";
  // A query is not part of a route; a bare "?" is a wildcard.
  if (path.includes("?")) return QUERY_PAIR.test(path) ? "malformed" : "wildcard";
  if (
    path.endsWith("...") ||
    path.endsWith("…") ||
    /\/\*+$/.test(path) ||
    path.endsWith("*")
  ) {
    return "prefix";
  }
  if (path.includes("*")) return "wildcard";
  if (PATTERN_CHARS.test(path)) return "pattern";
  if (KIT_ROUTE.test(path)) return "kit-route";
  return null;
}

/**
 * Is this a route name the rule accepts? Null when it is; otherwise the reason
 * it is refused. Mirrors the server's own check, plus the privacy check every
 * route label passes before it leaves the kit.
 */
export function declaredRouteNameRefusal(name: unknown): DeclaredNameRefusal | null {
  if (typeof name !== "string") return "malformed";
  if (name.length === 0 || name.length > DECLARED_WAIT_NAME_MAX) return "malformed";
  let path = name;
  const space = name.indexOf(" ");
  if (space !== -1) {
    if (!ROUTE_METHODS.includes(name.slice(0, space))) return "malformed";
    path = name.slice(space + 1);
  }
  const refusal = pathRefusal(path);
  if (refusal !== null) return refusal;
  if (transmitLabelHasPII(name) !== null) return "private";
  return null;
}

/** One path segment of a call name: the literal text between `:name`
 *  placeholders. One part = an exact segment; k+1 parts = k placeholders. */
type SegmentParts = readonly string[];

interface CallRule {
  /** Normalised `scheme://host[:port]`, compared exactly. */
  origin: string;
  segments: readonly SegmentParts[];
  /** Matched by at least one call since the meters were last cleared. */
  matched: boolean;
  /** What the startup line may say about this name. */
  shown: string;
}

/** An opaque handle to the call name a call matched. */
export type DeclaredCallMatch = object;

const PLACEHOLDER = /:[A-Za-z_][A-Za-z0-9_]*/g;

function segmentParts(segment: string): SegmentParts {
  const parts: string[] = [];
  let last = 0;
  PLACEHOLDER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER.exec(segment)) !== null) {
    parts.push(segment.slice(last, m.index));
    last = m.index + m[0].length;
  }
  parts.push(segment.slice(last));
  return parts;
}

/** The startup line's view of a call name: every segment that could carry a
 *  credential the developer pasted in place of a placeholder is hidden. */
function shownCallName(origin: string, path: string): string {
  const segs = path
    .slice(1)
    .split("/")
    .map((s) =>
      s.length > SHOWN_SEGMENT_MAX ||
      /\d{6}/.test(s) ||
      /[A-Za-z0-9_-]{20}/.test(s) ||
      transmitLabelHasPII(`/${s}`) !== null
        ? "…"
        : s,
    );
  return `${origin}/${segs.join("/")}`;
}

/**
 * Is this a call name the rule accepts? The rule it becomes when it is, or the
 * reason it is refused.
 */
export function parseDeclaredCallName(
  name: unknown,
): { rule: CallRule } | { refusal: DeclaredNameRefusal } {
  const malformed = { refusal: "malformed" as const };
  if (typeof name !== "string") return malformed;
  if (name.length === 0 || name.length > DECLARED_WAIT_NAME_MAX) return malformed;
  if (/\s/.test(name) || name.includes("#")) return malformed;
  if (name.includes("?")) {
    return { refusal: QUERY_PAIR.test(name) ? "malformed" : "wildcard" };
  }
  const scheme = /^(https?):\/\//i.exec(name);
  if (!scheme) {
    // A host on its own ("api.telegram.org") would name every call to a
    // service; a site path or another scheme is not an outside address.
    if (!name.startsWith("/") && /^[^/]+\/?$/.test(name)) {
      return { refusal: name.includes("*") ? "wildcard" : "host-only" };
    }
    return malformed;
  }
  const rest = name.slice(scheme[0].length);
  const slash = rest.indexOf("/");
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? "" : rest.slice(slash);
  if (authority.length === 0 || authority.includes("@")) return malformed;
  if (authority.includes("*")) return { refusal: "wildcard" };
  if (path === "" || path === "/") return { refusal: "host-only" };
  const refusal = pathRefusal(path);
  if (refusal !== null) return { refusal };
  let origin: string;
  try {
    origin = new URL(`${scheme[1]!.toLowerCase()}://${authority}/`).origin;
  } catch {
    return malformed;
  }
  if (origin === "null" || origin.length === 0) return malformed;
  return {
    rule: {
      origin,
      segments: path.slice(1).split("/").map(segmentParts),
      matched: false,
      shown: shownCallName(origin, path),
    },
  };
}

/** Does one request segment fit one name segment? Linear: each literal is
 *  found once, left to right, and a placeholder takes at least one character.
 *  Never a regular expression built from developer text. */
function segmentFits(parts: SegmentParts, seg: string): boolean {
  if (parts.length === 1) return seg === parts[0];
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  if (!seg.startsWith(first)) return false;
  let pos = first.length;
  for (let i = 1; i < parts.length - 1; i++) {
    const lit = parts[i]!;
    const from = pos + 1;
    if (lit.length === 0) {
      pos = from;
      continue;
    }
    const at = seg.indexOf(lit, from);
    if (at === -1) return false;
    pos = at + lit.length;
  }
  return seg.length - last.length >= pos + 1 && seg.endsWith(last);
}

/* ── State ───────────────────────────────────────────────────────────────── */

interface RouteRule {
  name: string;
  /** Null: the name covers every method of the route. */
  method: string | null;
  path: string;
  /** The path again, segment by segment, for comparing with the request's own
   *  path where the shown route is redacted (see `routeFits`). */
  segments: readonly SegmentParts[];
  excluded: number;
  worstMs: number;
}

let routeRules: RouteRule[] = [];
/** Valid route names past the cap, in order: the list is refused whole. */
let routeNamesOverCap: string[] | null = null;
const routeNamesSeen = new Set<string>();

let callRules: CallRule[] = [];
const callKeysSeen = new Set<string>();
/** Valid call names held, counted even past the cap (at most the read cap). */
let callNamesHeld = 0;
let callsOverCap = false;
let callExcluded = 0;
let callWorstMs = 0;

const originCache = new Map<string, string | null>();

function normalOrigin(raw: string): string | null {
  const hit = originCache.get(raw);
  if (hit !== undefined) return hit;
  let o: string | null;
  try {
    o = new URL(raw).origin;
    if (o === "null") o = null;
  } catch {
    o = null;
  }
  if (originCache.size >= 64) originCache.clear();
  originCache.set(raw, o);
  return o;
}

function readList(list: unknown): unknown[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, DECLARED_WAIT_READ_MAX);
}

/**
 * Take a declaration. Called by every `boosthis()` (and so every `attach()`);
 * the names are the UNION of every call, in the order first supplied, and the
 * cap counts the valid names in that union. Says what was declared — or why a
 * name was refused — on the startup line. Never throws.
 */
export function setDeclaredWaits(option: unknown): void {
  try {
    if (option === undefined || option === null) return;
    if (typeof option !== "object") {
      sayAfterStartupLine(
        "[boosthis] Boosthis will not use declaredWaits: it must be { routes: [...], calls: [...] }.",
      );
      return;
    }
    const { routes, calls } = option as { routes?: unknown; calls?: unknown };
    let changed = false;

    if (routes !== undefined && !Array.isArray(routes)) {
      sayAfterStartupLine(
        "[boosthis] Boosthis will not use declaredWaits.routes: it must be a list of route names.",
      );
    }
    readList(routes).forEach((raw, i) => {
      const refusal = declaredRouteNameRefusal(raw);
      if (refusal !== null) {
        sayAfterStartupLine(
          `[boosthis] Boosthis will not use declared route ${i + 1}: ${DECLARED_NAME_REFUSAL_REASON[refusal]}.`,
        );
        return;
      }
      const name = raw as string;
      if (routeNamesSeen.has(name)) return;
      routeNamesSeen.add(name);
      changed = true;
      const space = name.indexOf(" ");
      const path = space === -1 ? name : name.slice(space + 1);
      routeRules.push({
        name,
        method: space === -1 ? null : name.slice(0, space),
        path,
        segments: path.slice(1).split("/").map(segmentParts),
        excluded: 0,
        worstMs: 0,
      });
    });
    if (routeNamesSeen.size > DECLARED_WAIT_NAME_CAP && routeNamesOverCap === null) {
      routeNamesOverCap = routeRules.map((r) => r.name);
      sayAfterStartupLine(
        `[boosthis] Boosthis will not use the declared routes: ${routeNamesSeen.size} were declared and at most ${DECLARED_WAIT_NAME_CAP} are accepted, so none of them is kept out of the readings until the list is cut to ${DECLARED_WAIT_NAME_CAP}.`,
      );
    }

    if (calls !== undefined && !Array.isArray(calls)) {
      sayAfterStartupLine(
        "[boosthis] Boosthis will not use declaredWaits.calls: it must be a list of addresses.",
      );
    }
    readList(calls).forEach((raw, i) => {
      const parsed = parseDeclaredCallName(raw);
      if ("refusal" in parsed) {
        sayAfterStartupLine(
          `[boosthis] Boosthis will not use declared call ${i + 1}: ${DECLARED_NAME_REFUSAL_REASON[parsed.refusal]}.`,
        );
        return;
      }
      const rule = parsed.rule;
      const key = `${rule.origin}/${rule.segments.map((p) => p.join("\u0000")).join("/")}`;
      if (callKeysSeen.has(key)) return;
      callKeysSeen.add(key);
      changed = true;
      callNamesHeld = Math.min(callNamesHeld + 1, DECLARED_WAIT_READ_MAX);
      callRules.push(rule);
    });
    if (callNamesHeld > DECLARED_WAIT_NAME_CAP && !callsOverCap) {
      callsOverCap = true;
      sayAfterStartupLine(
        `[boosthis] Boosthis will not use the declared calls: ${callNamesHeld} were declared and at most ${DECLARED_WAIT_NAME_CAP} are accepted, so every one of them is still timed until the list is cut to ${DECLARED_WAIT_NAME_CAP}.`,
      );
    }

    if (changed) announceDeclared();
  } catch {
    /* a declaration can never stop the kit starting */
  }
}

function announceDeclared(): void {
  const parts: string[] = [];
  if (routeRules.length > 0 && routeNamesOverCap === null) {
    parts.push(`routes ${routeRules.map((r) => r.name).join(", ")}`);
  }
  if (callRules.length > 0 && !callsOverCap) {
    parts.push(`calls ${callRules.map((r) => r.shown).join(", ")}`);
  }
  if (parts.length === 0) return;
  sayNoteAfterStartupLine(
    `[boosthis] Waits declared on purpose: ${parts.join("; ")}. Their durations are kept out of every speed reading and counted instead; their errors still count.`,
  );
  if (callRules.length > 0 && !callsOverCap && isBunRuntime()) {
    sayNoteAfterStartupLine(
      "[boosthis] On Bun the kit sees no call made with Bun's own fetch, so those calls are never timed and declaring them changes nothing.",
    );
  }
}

/* ── Routes the app answers ──────────────────────────────────────────────── */

/** Is any route declared and in force? */
export function hasDeclaredRoutes(): boolean {
  return routeRules.length > 0 && routeNamesOverCap === null;
}

/** The request's own path, segment by segment, or null when it cannot be
 *  compared (absent, too long, not a path). Any query is ignored. */
function requestSegments(rawPath: unknown): string[] | null {
  if (typeof rawPath !== "string") return null;
  const q = rawPath.indexOf("?");
  const p = q === -1 ? rawPath : rawPath.slice(0, q);
  if (p.length > MATCH_PATH_MAX || !p.startsWith("/")) return null;
  return p.slice(1).split("/");
}

/**
 * Does a declared route name this request? Either the route as the dashboard
 * shows it, compared exactly — template segments included, as written — or
 * the request's own path. The second is for a host with no route table to
 * ask (a bare Node server, an edge isolate): the route shown there is built
 * from the path and redacted, so `/poll` shows as `/:id` and a developer who
 * names the route they wrote would otherwise never match. Against the path,
 * a `:name` in the declared name stands for exactly one segment, as a route
 * template does; everything else must be equal. The path is compared here
 * and never kept or sent.
 */
function routeFits(r: RouteRule, shownPath: string | null, rawSegs: string[] | null): boolean {
  if (shownPath !== null && r.path === shownPath) return true;
  if (rawSegs === null || rawSegs.length !== r.segments.length) return false;
  for (let i = 0; i < rawSegs.length; i++) {
    if (!segmentFits(r.segments[i]!, rawSegs[i]!)) return false;
  }
  return true;
}

/**
 * Is this finished request a declared route? When it is, its duration is
 * counted (kept out, longest wait) and the caller keeps it out of every speed
 * reading. `shown` is the route as the dashboard shows it: `GET /poll`, or the
 * path alone when the label could not be formed. `rawPath` is the request's
 * own path (see `routeFits`). A name with a method wins over one without.
 */
export function noteDeclaredRouteCall(
  method: unknown,
  shown: unknown,
  durationMs: number,
  rawPath?: unknown,
): boolean {
  if (routeRules.length === 0 || routeNamesOverCap !== null) return false;
  if (isBoosthisDisabled()) return false;
  try {
    const label = typeof shown === "string" ? shown : null;
    const space = label === null ? -1 : label.indexOf(" ");
    const m =
      space === -1
        ? (typeof method === "string" ? method.trim().toUpperCase() : "")
        : label!.slice(0, space);
    const shownPath = label === null ? null : space === -1 ? label : label.slice(space + 1);
    const rawSegs = requestSegments(rawPath);
    if (shownPath === null && rawSegs === null) return false;
    let hit: RouteRule | null = null;
    for (const r of routeRules) {
      if (r.method !== null && r.method !== m) continue;
      if (!routeFits(r, shownPath, rawSegs)) continue;
      if (r.method !== null) {
        hit = r;
        break;
      }
      if (hit === null) hit = r;
    }
    if (hit === null) return false;
    if (hit.excluded < Number.MAX_SAFE_INTEGER) hit.excluded += 1;
    const ms = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
    if (ms > hit.worstMs) hit.worstMs = ms;
    return true;
  } catch {
    return false;
  }
}

/** How many calls the declared routes kept out since the meters were last
 *  cleared, all routes together. Zero when nothing is declared or in force. */
export function declaredRoutesKeptOut(): number {
  if (routeNamesOverCap !== null) return 0;
  let n = 0;
  for (const r of routeRules) n += r.excluded;
  return n;
}

/** One declared route as it is sent. */
export interface DeclaredRouteRow {
  name: string;
  excluded: number;
  worstMs: number;
}

/**
 * The block every snapshot carries: each declared route with the calls kept
 * out and the longest wait — zero for a name nothing has matched, and an
 * empty list when nothing is declared. Over the cap the first eleven names go
 * with zeros, so the server refuses the list whole and says why.
 */
export function declaredWaitsBlock(): { routes: DeclaredRouteRow[] } {
  if (routeNamesOverCap !== null) {
    return {
      routes: routeNamesOverCap
        .slice(0, DECLARED_WAIT_NAME_CAP + 1)
        .map((name) => ({ name, excluded: 0, worstMs: 0 })),
    };
  }
  return {
    routes: routeRules.map((r) => ({
      name: r.name,
      excluded: r.excluded,
      worstMs: r.excluded > 0 ? Math.round(r.worstMs) : 0,
    })),
  };
}

/* ── Calls the app makes ─────────────────────────────────────────────────── */

/** Is any call name held (in force or refused over the cap)? */
export function hasDeclaredCalls(): boolean {
  return callNamesHeld > 0;
}

/**
 * Does this outgoing call match a declared name? `origin` is the call's
 * `scheme://host[:port]` and `path` its path (any query is ignored). The match
 * is marked at once; the handle it returns is handed back when the call ends.
 * Null when nothing matches, nothing is declared, or the list is over the cap.
 */
export function matchDeclaredCall(origin: unknown, path: unknown): DeclaredCallMatch | null {
  if (callRules.length === 0 || callsOverCap) return null;
  if (isBoosthisDisabled()) return null;
  try {
    if (typeof origin !== "string" || typeof path !== "string") return null;
    const o = normalOrigin(origin);
    if (o === null) return null;
    const q = path.indexOf("?");
    const p = q === -1 ? path : path.slice(0, q);
    if (p.length > MATCH_PATH_MAX || !p.startsWith("/")) return null;
    const segs = p.slice(1).split("/");
    for (const rule of callRules) {
      if (rule.origin !== o || rule.segments.length !== segs.length) continue;
      let fits = true;
      for (let i = 0; i < segs.length; i++) {
        if (!segmentFits(rule.segments[i]!, segs[i]!)) {
          fits = false;
          break;
        }
      }
      if (fits) {
        rule.matched = true;
        return rule;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** A declared call that ended with an answer: kept out, and counted. */
export function noteDeclaredCallExcluded(match: DeclaredCallMatch | null, durationMs: number): void {
  if (isBoosthisDisabled()) return;
  if (match !== null) (match as CallRule).matched = true;
  if (callExcluded < Number.MAX_SAFE_INTEGER) callExcluded += 1;
  const ms = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  if (ms > callWorstMs) callWorstMs = ms;
}

/** The four counts the calls direction sends, on the reading the calls belong
 *  to. Zero across the board when nothing is declared — never absent. Over the
 *  cap the true number of names goes with three zeros, so the server refuses
 *  the declaration and says why instead of reporting it as in force. */
export function declaredCallCounts(): {
  waitDeclaredNames: number;
  waitDeclaredMatched: number;
  waitDeclaredExcluded: number;
  waitDeclaredWorstMs: number;
} {
  if (callsOverCap) {
    return {
      waitDeclaredNames: callNamesHeld,
      waitDeclaredMatched: 0,
      waitDeclaredExcluded: 0,
      waitDeclaredWorstMs: 0,
    };
  }
  let matched = 0;
  for (const r of callRules) if (r.matched) matched += 1;
  return {
    waitDeclaredNames: callRules.length,
    waitDeclaredMatched: matched,
    waitDeclaredExcluded: callExcluded,
    waitDeclaredWorstMs: callExcluded > 0 ? Math.round(callWorstMs) : 0,
  };
}

/** Reset the counts with the rest of the kit's meters. The NAMES stay: they
 *  are configuration, not readings. */
export function clearDeclaredWaitCounts(): void {
  for (const r of routeRules) {
    r.excluded = 0;
    r.worstMs = 0;
  }
  for (const r of callRules) r.matched = false;
  callExcluded = 0;
  callWorstMs = 0;
}

/** @internal test hook — forget the declaration as well as the counts. */
export function _resetDeclaredWaitsForTests(): void {
  routeRules = [];
  routeNamesOverCap = null;
  routeNamesSeen.clear();
  callRules = [];
  callKeysSeen.clear();
  callNamesHeld = 0;
  callsOverCap = false;
  callExcluded = 0;
  callWorstMs = 0;
  originCache.clear();
}
