/**
 * Ask the framework for the whole route list.
 *
 * The map can only draw pages somebody has already opened. The one feature
 * that could fix that — declaring your routes — needed the developer to
 * hand-type them, and nobody ever did, so "which routes were never reached?"
 * always answered "none declared".
 *
 * The running framework already holds the answer. This module asks it. It is
 * NOT a source-code reader and NOT a crawler: it calls a public accessor where
 * one exists (Hapi's server table, Fastify's printed route tree) and walks a
 * known internal structure where it does not (Express, Koa). Nothing is opened
 * from disk and nothing is driven.
 *
 * HONESTY RULES, in order of importance:
 *
 *  1. An unrecognised shape reports NOTHING. Not a partial list, not a guess.
 *     A framework version that moves its internals must degrade to
 *     `"unreadable"`, never to a half-truth and never to a throw.
 *  2. A framework we cannot ask at all is `"unsupported"` — a stated answer,
 *     not silence, so the map can say "observed routes only" instead of
 *     implying the app has no other routes.
 *  3. A route the framework lists but traffic never touched is NOT SEEN. It is
 *     never dead, broken or unused: we cannot know why it is quiet.
 *  4. A hand-declared list and a framework-read list MERGE. Neither silently
 *     overwrites the other, and every entry records where it came from.
 *
 * PRIVACY: only route TEMPLATES travel — the code-defined shape of a path with
 * every parameter collapsed to `:id`. Each label is re-checked by the same
 * transmit-time guard that governs every other route label, and an entry that
 * fails it is dropped rather than redacted. The whole list is switchable off
 * with `BOOSTHIS_ROUTE_LIST=0`, and the fact that it travels — including paths
 * traffic would never have revealed — is written into TERMS.md §5.
 */

import { readFlagValue } from "./runtimeFlags";
import { transmitLabelHasPII } from "./no-pii";

// BOOSTHIS_PART_NAME_V1 — shared with lib/part-name-vocabulary.json.
export const MAX_PART_NAME = 100;

/** How the route list stands for this install. Four answers that must never be
 *  confused with one another:
 *
 *   - `read`        the framework answered. `entries` is what it said (which
 *                   may legitimately be empty: an app with no routes yet).
 *   - `unsupported` nothing here could be asked — no accessor, no recognised
 *                   router. A stated "we cannot", not a zero.
 *   - `unreadable`  a framework WAS recognised and its shape was not. We
 *                   report nothing from it rather than guess.
 *   - `off`         the developer switched this off. Nothing was read.
 */
export type RouteListStatus = "read" | "unsupported" | "unreadable" | "off";

/** Where one entry came from. `both` means the framework listed it AND the
 *  developer declared it — recorded rather than collapsed, so neither list can
 *  silently swallow the other. */
export type RouteListOrigin = "framework" | "declared" | "both";

export interface RouteListEntry {
  /** `METHOD /path` for a server route — the same shape the per-route rows
   *  use, so a listed route and a measured one join on the label. */
  readonly label: string;
  readonly from: RouteListOrigin;
}

export interface RouteListReport {
  readonly status: RouteListStatus;
  /** Which framework answered — a word from the closed vocabulary below.
   *  Absent when nothing was read from a framework. */
  readonly source?: string;
  readonly entries: readonly RouteListEntry[];
  /** How many entries the merge held BEFORE the cap. `entries` may be shorter;
   *  a reader that sees `total > entries.length` knows it has "at least". */
  readonly total: number;
}

/**
 * The closed set of framework words this kit may put on the wire. Kept in step
 * with the server's `SNAPSHOT_ROUTE_SOURCE_WORDS` by
 * scripts/src/__tests__/route-list-vocabulary.test.ts — a word the server does
 * not know is dropped at ingest, and a dropped word is a silent lie about
 * where a list came from.
 */
export const ROUTE_SOURCE_WORDS = [
  "express",
  "fastify",
  "koa",
  "hapi",
] as const;

/** Most routes an install may list. A bigger app states its `total` and hands
 *  back the first slice, so the map says "at least" rather than pretending the
 *  list is whole. */
export const MAX_ROUTE_LIST_ENTRIES = 200;

/** HTTP methods a framework may report. Anything outside this set is not a
 *  method we recognise, and a label we cannot build correctly is not built. */
const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
  "TRACE",
  "CONNECT",
]);

/** What a decoded path template may contain once every parameter has been
 *  collapsed. A character outside this set means the decode did not fully
 *  understand the pattern, so the read reports nothing. */
const SAFE_TEMPLATE_RE = /^\/[A-Za-z0-9_\-./:~%]*$/;

// ── The developer's own declaration ──────────────────────────────────────────

let declaredRoutes: string[] | null = null;
const warnedDeclarationRefusals = new Set<string>();

export function warnPartNameRefusal(reason: "too-long" | "invalid"): void {
  if (warnedDeclarationRefusals.has(reason)) return;
  warnedDeclarationRefusals.add(reason);
  try {
    console.warn(
      reason === "too-long"
        ? `Boosthis refused a route because its length exceeds ${MAX_PART_NAME} characters. Use a METHOD /path template of at most ${MAX_PART_NAME} characters, with volatile segments written as :id.`
        : `Boosthis refused a route because it is not a safe route template. Use a METHOD /path template such as GET /users/:id.`,
    );
  } catch {
    /* a host console must never break registration */
  }
}

/**
 * Declare this app's routes by hand.
 *
 * Still supported, and still worth doing for anything the framework cannot be
 * asked about (a route served by a proxy in front, a handler wired up by a
 * library that keeps no table). A declared list and a framework-read list are
 * MERGED — declaring routes never switches the framework read off, and the
 * framework read never erases what you declared.
 *
 * Labels are `METHOD /path` where a method is known, or a bare `/path`. Never
 * throws.
 */
export function registerRoutes(routes: readonly string[]): void {
  try {
    if (!Array.isArray(routes)) return;
    const cleaned: string[] = [];
    for (const raw of routes) {
      if (typeof raw !== "string") continue;
      const label = normalizeDeclaredLabel(raw);
      if (label) cleaned.push(label);
      else {
        const trimmed = raw.trim();
        const hasMethod = trimmed.indexOf(" ") > 0;
        warnPartNameRefusal(
          trimmed.length + (hasMethod ? 0 : 4) > MAX_PART_NAME
            ? "too-long"
            : "invalid",
        );
      }
    }
    declaredRoutes = cleaned.length > 0 ? Array.from(new Set(cleaned)) : null;
  } catch {
    /* a declaration must never break the host */
  }
}

/** Test + diagnostic reader for what was declared by hand. */
export function getDeclaredRoutes(): readonly string[] {
  return declaredRoutes ?? [];
}

// ── The app handle we were given ─────────────────────────────────────────────

let appHandle: unknown = null;

/**
 * Remember the application object so the route table can be read from it.
 *
 * Callers: `mount(app)` and `attach({ app })` hand it over explicitly, and the
 * Express middleware picks up `req.app` off the first request it sees — which
 * is why an Express install needs no developer work at all. Storing a
 * reference costs nothing; the walk itself happens later, when a snapshot is
 * captured, so nothing is read at startup and no request is ever delayed by
 * it.
 */
export function registerApp(app: unknown): void {
  try {
    if (app === null || app === undefined) return;
    if (typeof app !== "object" && typeof app !== "function") return;
    if (appHandle) return;
    appHandle = app;
  } catch {
    /* never let a handle we were handed disturb the host */
  }
}

/** Test helper — forget the declared list and the app handle. */
export function _resetRouteInventoryForTests(): void {
  declaredRoutes = null;
  appHandle = null;
  warnedDeclarationRefusals.clear();
}

// ── The switch ───────────────────────────────────────────────────────────────

/**
 * Whether the route list may be read and uploaded at all.
 *
 * ON by default, because a map that draws only what has been clicked is the
 * problem this exists to fix. `BOOSTHIS_ROUTE_LIST=0` (or `false`/`off`/`no`)
 * turns it off, and the snapshot then says `off` rather than falling silent —
 * a switched-off reading and a reading nobody took are different facts and the
 * map must be able to tell them apart.
 */
export function routeListEnabled(): boolean {
  try {
    const v = readFlagValue("BOOSTHIS_ROUTE_LIST");
    if (v === undefined) return true;
    if (typeof v === "boolean") return v;
    return !["0", "false", "off", "no"].includes(v.trim().toLowerCase());
  } catch {
    return true;
  }
}

// ── Label building ───────────────────────────────────────────────────────────

/** Collapse a framework's parameter spellings to one placeholder.
 *
 *  Express/Koa `:id`, Hapi `{id}` and `{id?}`, and a wildcard tail all become
 *  `:id`. The literal segments are left exactly as the developer wrote them:
 *  they are code, not user data, and rewriting them would turn a real route
 *  template into a shape nobody could recognise on the map. */
function collapseParams(path: string): string {
  return path
    .replace(/\{[^/{}]*\}/g, ":id") // Hapi / OpenAPI-style {id}, {id?}, {id*}
    .replace(/<[^/<>]*>/g, ":id") // Django-style <int:pk>
    .replace(/:[A-Za-z0-9_]+/g, ":id") // Express / Koa :userId
    .replace(/\*+/g, ":id"); // wildcard tail
}

/** Turn one framework-supplied path template into a wire-safe path, or null
 *  when it cannot be made safe. Never guesses: a template that still carries
 *  pattern syntax after the collapse is refused. */
export function safePathTemplate(path: string): string | null {
  if (typeof path !== "string") return null;
  let p = path.trim();
  if (p.length === 0) return null;
  if (p.length > MAX_PART_NAME) return null;
  // Query and fragment are never part of a registered template; if one is
  // present the value did not come from where we think it did.
  if (p.includes("?") && !/\{[^/{}]*\?\}/.test(p)) return null;
  if (p.includes("#")) return null;
  p = collapseParams(p);
  if (!p.startsWith("/")) p = `/${p}`;
  // Collapse a trailing slash so `/a` and `/a/` are one route, not two.
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (!SAFE_TEMPLATE_RE.test(p)) return null;
  return p;
}

/** Build the wire label for one method + path pair, or null when either half
 *  is unusable. */
export function routeLabel(method: string, path: string): string | null {
  const m = typeof method === "string" ? method.trim().toUpperCase() : "";
  if (!HTTP_METHODS.has(m)) return null;
  const p = safePathTemplate(path);
  if (p === null) return null;
  const label = `${m} ${p}`;
  if (label.length > MAX_PART_NAME) return null;
  if (transmitLabelHasPII(label) !== null) return null;
  return label;
}

/** Normalize one hand-declared entry. Accepts `GET /users/:id` and a bare
 *  `/users/:id` (which is filed as GET, the only method a bare path can mean
 *  on a server that answers pages). */
function normalizeDeclaredLabel(raw: string): string | null {
  const s = raw.trim();
  if (s.length === 0) return null;
  const space = s.indexOf(" ");
  if (space > 0) {
    return routeLabel(s.slice(0, space), s.slice(space + 1));
  }
  return routeLabel("GET", s);
}

// ── Reading the framework ────────────────────────────────────────────────────

interface FrameworkRead {
  readonly status: "read" | "unsupported" | "unreadable";
  readonly source?: string;
  readonly labels: readonly string[];
}

const UNSUPPORTED: FrameworkRead = { status: "unsupported", labels: [] };
function unreadable(source: string): FrameworkRead {
  return { status: "unreadable", source, labels: [] };
}

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** An Express router IS a request-handling function that carries its stack as
 *  a property, so anything holding a route stack may be a function as well as
 *  an object. Reading properties off it is identical either way. */
function asHolder(v: unknown): Dict | null {
  if (typeof v === "function") return v as unknown as Dict;
  return isDict(v) ? v : null;
}

/**
 * Ask whichever framework this app is for its whole route table.
 *
 * Order matters only in that each reader must first RECOGNISE its framework
 * before it reads anything; a reader that does not recognise the app hands on
 * to the next one, and when none recognises it the answer is `unsupported`.
 */
export function readFrameworkRoutes(app: unknown): FrameworkRead {
  if (app === null || (typeof app !== "object" && typeof app !== "function")) {
    return UNSUPPORTED;
  }
  try {
    const a = app as Dict;
    // Hapi — a real public accessor. `server.table()` returns every route the
    // server will answer, already split into method + path.
    if (typeof a.table === "function" && typeof a.route === "function") {
      return readHapi(a);
    }
    // Fastify — prints its whole route tree once ready. The printed form IS
    // the documented way to read it; there is no public route array.
    if (
      typeof a.printRoutes === "function" &&
      typeof a.addHook === "function" &&
      typeof a.route === "function"
    ) {
      return readFastify(a);
    }
    // Express — no public accessor, a walkable router stack.
    if (looksLikeExpressApp(a)) return readExpress(a);
    // Koa — no public accessor either; its routers live in the middleware
    // array and each one carries its own stack.
    if (Array.isArray(a.middleware) && typeof a.use === "function") {
      return readKoa(a.middleware);
    }
    return UNSUPPORTED;
  } catch {
    // A framework that throws while being asked has told us nothing, and a
    // throw must never reach the host. There is no framework word to name here
    // because we did not get far enough to know which one it was.
    return { status: "unreadable", labels: [] };
  }
}

// ── Hapi ─────────────────────────────────────────────────────────────────────

function readHapi(app: Dict): FrameworkRead {
  const table = (app.table as () => unknown)();
  if (!Array.isArray(table)) return unreadable("hapi");
  const labels: string[] = [];
  for (const raw of table) {
    if (!isDict(raw)) return unreadable("hapi");
    const method = raw.method;
    const path = raw.path;
    if (typeof method !== "string" || typeof path !== "string") {
      return unreadable("hapi");
    }
    // Hapi's own wildcard method means "everything"; it names no method we
    // could put on a label, so it is refused rather than invented.
    const label = routeLabel(method, path);
    if (label) labels.push(label);
  }
  return { status: "read", source: "hapi", labels: dropAutoHead(labels) };
}

// ── Fastify ──────────────────────────────────────────────────────────────────

/**
 * One printed line of Fastify's route tree.
 *
 * The indent is repeated four-character units (`│   ` for a branch that
 * continues, four spaces for one that does not), then the branch marker, then
 * this node's path FRAGMENT, then the methods it answers in brackets. A node
 * with no brackets is a branch that is not itself a route.
 *
 * `commonPrefix: false` stops Fastify splitting a path mid-word, but it does
 * NOT flatten the tree — `/api/c` and `/api/c/:key` still print as parent and
 * child — so the fragments are reassembled down the indent rather than read
 * line by line.
 */
const FASTIFY_LINE_RE =
  /^((?:(?:│|\s)\s{3})*)(?:├|└)── (\S*)(?: \(([A-Za-z, ]+)\))?$/;

function readFastify(app: Dict): FrameworkRead {
  const printed = (
    app.printRoutes as (o: Record<string, unknown>) => unknown
  )({ commonPrefix: false, includeMeta: false, includeHooks: false });
  if (typeof printed !== "string") return unreadable("fastify");
  const labels: string[] = [];
  // pathAtDepth[d] is the whole path of the node currently open at depth d.
  const pathAtDepth: string[] = [];
  for (const rawLine of printed.split("\n")) {
    if (rawLine.trim().length === 0) continue;
    const m = FASTIFY_LINE_RE.exec(rawLine);
    // A line we cannot parse means the printed format has moved. Report
    // nothing rather than the half of the tree we happened to understand.
    if (!m) return unreadable("fastify");
    const depth = m[1].length / 4;
    if (!Number.isInteger(depth) || depth > pathAtDepth.length) {
      return unreadable("fastify");
    }
    const whole = (depth === 0 ? "" : pathAtDepth[depth - 1]) + m[2];
    pathAtDepth[depth] = whole;
    pathAtDepth.length = depth + 1;
    if (m[3] === undefined) continue; // a branch, not a route
    for (const method of m[3].split(",")) {
      const label = routeLabel(method, whole);
      if (label) labels.push(label);
    }
  }
  return { status: "read", source: "fastify", labels: dropAutoHead(labels) };
}

// ── Express ──────────────────────────────────────────────────────────────────

/**
 * Recognise an Express application before reading anything out of it.
 *
 * This matters because Express 4 builds its router lazily: an app that has
 * registered nothing at all has no router to find. Recognising the app first
 * is what lets that answer be "read, no routes yet" instead of "this is not a
 * framework we can ask" — two facts the map words differently.
 */
function looksLikeExpressApp(app: Dict): boolean {
  return (
    typeof app.use === "function" &&
    typeof app.handle === "function" &&
    typeof app.set === "function" &&
    typeof app.listen === "function" &&
    isDict(app.settings)
  );
}

/**
 * Express 4 keeps the router on `_router`; Express 5 exposes `router`.
 *
 * Each read is guarded on its own because Express 4 defines `app.router` as a
 * getter that THROWS — a 3.x-to-4.x migration notice. Reading it to see
 * whether it is there is enough to take the whole read down, which is exactly
 * the kind of thing a defensive walker must survive.
 */
function expressRouterOf(app: Dict): Dict | null {
  for (const key of ["_router", "router"]) {
    let r: unknown;
    try {
      r = app[key];
    } catch {
      continue;
    }
    const holder = asHolder(r);
    if (holder && Array.isArray(holder.stack)) return holder;
  }
  return null;
}

function readExpress(app: Dict): FrameworkRead {
  const router = expressRouterOf(app);
  // Recognised, with nothing registered on it yet. Express builds its router
  // on first use, so there is genuinely nothing to list — a real zero.
  if (!router) return { status: "read", source: "express", labels: [] };
  const labels: string[] = [];
  const ok = walkExpressStack(router.stack as unknown[], "", labels, 0);
  if (!ok) return unreadable("express");
  return { status: "read", source: "express", labels: dropAutoHead(labels) };
}

/** Returns false the moment anything in the stack is a shape we do not
 *  recognise — the caller then reports nothing at all. */
function walkExpressStack(
  stack: unknown[],
  prefix: string,
  out: string[],
  depth: number,
): boolean {
  // A router nested more than this deep is not a shape we have seen; refusing
  // is cheaper than an unbounded walk over a structure we do not understand.
  if (depth > 10) return false;
  for (const rawLayer of stack) {
    if (!isDict(rawLayer)) return false;
    const route = rawLayer.route;
    if (isDict(route)) {
      if (!collectExpressRoute(route, prefix, out)) return false;
      continue;
    }
    const nested = nestedExpressStack(rawLayer);
    if (nested) {
      const mount = expressMountPrefix(rawLayer);
      if (mount === null) return false;
      if (!walkExpressStack(nested, `${prefix}${mount}`, out, depth + 1)) {
        return false;
      }
      continue;
    }
    // A whole Express app mounted with `app.use(path, subApp)`. Express wraps
    // it in a closure named `mounted_app` and keeps no reference to the app
    // itself, so its routes are genuinely beyond reach. Reporting the rest of
    // the table would hand back a complete-looking skeleton with a wing
    // missing, so the whole read reports nothing instead.
    if (rawLayer.name === "mounted_app") return false;
    // A plain middleware layer: a function with no route and no stack. That is
    // a shape we DO recognise — it simply registers no route — so it is
    // skipped rather than treated as a failure.
    if (typeof rawLayer.handle === "function") continue;
    return false;
  }
  return true;
}

function collectExpressRoute(route: Dict, prefix: string, out: string[]): boolean {
  const paths = Array.isArray(route.path) ? route.path : [route.path];
  const methods = route.methods;
  if (!isDict(methods)) return false;
  for (const p of paths) {
    if (typeof p !== "string") return false;
    for (const [method, on] of Object.entries(methods)) {
      if (on !== true) continue;
      if (method === "_all") continue;
      const label = routeLabel(method, joinPath(prefix, p));
      if (label) out.push(label);
    }
  }
  return true;
}

function nestedExpressStack(layer: Dict): unknown[] | null {
  const h = asHolder(layer.handle);
  if (!h) return null;
  if (Array.isArray(h.stack)) return h.stack;
  // A whole express app mounted with app.use("/x", subApp).
  if (looksLikeExpressApp(h)) {
    const sub = expressRouterOf(h);
    return sub ? (sub.stack as unknown[]) : [];
  }
  return null;
}

/**
 * Decode a mounted router's prefix from the regexp Express built for it.
 *
 * Express does not keep the mount path, only the compiled pattern. The pattern
 * for a mount is a fixed shape, so this DECODES it rather than guessing: the
 * anchors come off, each parameter group becomes `:id`, the escapes are
 * undone, and the result must then look like a path. Anything left over —
 * a character class, an alternation, a shape from a version we have not
 * seen — returns null, and the whole read reports nothing.
 */
export function expressMountPrefix(layer: Dict): string | null {
  const re = layer.regexp;
  if (re === undefined || re === null) return null;
  if (isDict(re) && re.fast_slash === true) return "";
  if (!(re instanceof RegExp)) {
    // Express 5 keeps `matchers` instead of a bare regexp and no longer
    // exposes a decodable pattern here. Recognised, not readable.
    return null;
  }
  if ((re as RegExp & { fast_slash?: boolean }).fast_slash === true) return "";
  let src = re.source;
  if (!src.startsWith("^")) return null;
  src = src.slice(1);
  // The trailing "optional slash, followed by a slash or the end" assertion
  // every mount pattern carries.
  const tail = "\\/?(?=\\/|$)";
  if (!src.endsWith(tail)) return null;
  src = src.slice(0, -tail.length);
  // Parameter groups, in the spellings path-to-regexp has used. The slash is
  // inside the group in the current spelling, so the replacement carries it.
  src = src
    .replace(/\(\?:\\\/\(\[\^\\?\/\]\+\?\)\)/g, "/:id")
    .replace(/\(\?:\(\[\^\\?\/\]\+\?\)\)/g, ":id")
    .replace(/\(\[\^\\?\/\]\+\?\)/g, ":id");
  src = src.replace(/\\\//g, "/");
  if (src.length === 0) return "";
  if (!src.startsWith("/")) return null;
  // Anything still carrying regexp syntax was not understood.
  if (/[\\()[\]{}|+*?^$]/.test(src)) return null;
  if (!SAFE_TEMPLATE_RE.test(src)) return null;
  return src.length > 1 && src.endsWith("/") ? src.slice(0, -1) : src;
}

function joinPath(prefix: string, path: string): string {
  if (!prefix) return path;
  if (path === "/" || path === "") return prefix;
  return `${prefix}${path.startsWith("/") ? "" : "/"}${path}`;
}

// ── Koa ──────────────────────────────────────────────────────────────────────

/**
 * Koa has no route table of its own — it has a middleware array, and a router
 * library puts its own table on the middleware function it hands back
 * (`dispatch.router`, the shape @koa/router and koa-router both use). A Koa
 * app with no such middleware genuinely has no route list to read, which is a
 * different answer from a shape we failed to understand.
 */
function readKoa(middleware: unknown[]): FrameworkRead {
  const labels: string[] = [];
  let sawRouter = false;
  for (const mw of middleware) {
    if (typeof mw !== "function") continue;
    const router = (mw as unknown as Dict).router;
    if (!isDict(router)) continue;
    sawRouter = true;
    const stack = router.stack;
    if (!Array.isArray(stack)) return unreadable("koa");
    for (const rawLayer of stack) {
      if (!isDict(rawLayer)) return unreadable("koa");
      const path = rawLayer.path;
      const methods = rawLayer.methods;
      if (typeof path !== "string" || !Array.isArray(methods)) {
        return unreadable("koa");
      }
      for (const method of methods) {
        if (typeof method !== "string") return unreadable("koa");
        const label = routeLabel(method, path);
        if (label) labels.push(label);
      }
    }
  }
  if (!sawRouter) return UNSUPPORTED;
  return { status: "read", source: "koa", labels: dropAutoHead(labels) };
}

// ── Merge ────────────────────────────────────────────────────────────────────

/**
 * Drop `HEAD /x` where `GET /x` is also listed.
 *
 * Fastify, Koa's router and Hapi all register HEAD automatically alongside
 * GET. Listing both would double the map with routes the developer never
 * wrote, and a map whose size is an artefact of the framework is a map nobody
 * trusts. A HEAD route registered on its own still travels.
 */
function dropAutoHead(labels: readonly string[]): string[] {
  const gets = new Set(
    labels.filter((l) => l.startsWith("GET ")).map((l) => l.slice(4)),
  );
  return labels.filter((l) => !(l.startsWith("HEAD ") && gets.has(l.slice(5))));
}

/**
 * The whole route list for this install: what the framework said and what the
 * developer declared, merged, with each entry recording where it came from.
 *
 * Never throws; on any internal failure the answer is `unreadable`, which says
 * "we could not read it" rather than "there is nothing".
 */
export function routeListReport(): RouteListReport {
  try {
    if (!routeListEnabled()) return { status: "off", entries: [], total: 0 };
    const framework = appHandle ? readFrameworkRoutes(appHandle) : UNSUPPORTED;
    const declared = declaredRoutes ?? [];
    // Merge: a label in both lists is ONE entry that says so. Neither side
    // erases the other, and the framework's answer never hides a declaration
    // for a route it does not know about (a route behind a proxy, say).
    const byLabel = new Map<string, RouteListOrigin>();
    for (const label of framework.labels) byLabel.set(label, "framework");
    for (const label of declared) {
      byLabel.set(label, byLabel.has(label) ? "both" : "declared");
    }
    const all = [...byLabel.entries()].map(([label, from]) => ({ label, from }));
    all.sort((a, b) => a.label.localeCompare(b.label));
    return {
      status: framework.status,
      ...(framework.source ? { source: framework.source } : {}),
      entries: all.slice(0, MAX_ROUTE_LIST_ENTRIES),
      total: all.length,
    };
  } catch {
    return { status: "unreadable", entries: [], total: 0 };
  }
}

/**
 * The block a snapshot carries. A kit that HAS this feature always answers.
 *
 * Every state is a sentence the map can print: `read` (here is the table),
 * `unsupported` (nothing could be asked — either the framework offers no
 * accessor or this kit was never handed an app), `unreadable` (we recognised
 * the framework and not the shape it answered in), and `off` (the developer
 * switched the list off). An absent block means one thing only, and it must
 * keep meaning only that: the kit running there is older than this feature.
 *
 * That is why "no app was handed over" is NOT silence. Saying nothing there
 * would make an idle Express app indistinguishable from a kit that cannot do
 * this at all, and the page would have to hedge both ways at once.
 */
export function routeListForSnapshot(): RouteListReport {
  return routeListReport();
}
