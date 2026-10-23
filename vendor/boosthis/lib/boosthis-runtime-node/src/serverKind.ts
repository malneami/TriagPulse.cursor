/** Which kind of Node server this app runs.
 *
 * WHY THIS EXISTS
 *
 * The kit used to be an Express middleware and nothing else, so "what is this
 * customer running?" had one possible answer and nobody had to ask. Now that
 * the kit attaches at the Node request boundary itself, a project can be
 * Next.js, Fastify, Hono, NestJS or a plain `http` server — and we cannot see
 * any of that from the dashboard unless the kit says so.
 *
 * The label is DIAGNOSTIC, not a capability: nothing the kit does branches on
 * it. It exists so that a developer opening their project page sees the kit
 * naming their own stack back to them (a wrong name is a visible sign that
 * something is not what we think it is), and so we can see how customers are
 * really building instead of guessing.
 *
 * One display use beyond printing it, on the Boosthis server: the tag chooses
 * which written form of a Node fix the developer is handed — the Express form
 * on an Express app, Node's own http calls on `node-http`. That is a choice of
 * WORDS, never of measurement: no meter, score or verdict reads the tag, and
 * `unknown`, `worker` or a tag the server does not recognise hands out the
 * framework-neutral fix with every form labelled. So a wrong answer here costs
 * a developer a longer fix to read, never a wrong number.
 *
 * HONESTY RULES
 *   - Positive evidence only. A framework is named when it is actually loaded
 *     in this process, or when the app's own request listener carries its
 *     marks — never because a package.json mentions it.
 *   - `node-http` means "no framework we know of is in this process", which is
 *     what a plain `http.createServer` app looks like from in here. A
 *     framework we have never heard of looks the same; that is stated in the
 *     wording rather than papered over.
 *   - `unknown` is a real answer, kept for the case where we could not look at
 *     all. It is never a placeholder for "probably plain Node".
 */

import { createRequire } from "node:module";

/** The closed set of answers. Additive only: a tag that has been sent can
 *  never be removed (the server stores it and older kits keep sending it). */
export const SERVER_KINDS = [
  "express",
  "fastify",
  "hono",
  "nest",
  "next",
  "node-http",
  // A process with NO web server at all: a queue consumer, a scheduled worker,
  // a nightly import. Never detected — nothing is absent in a way that proves
  // this — so it is only ever DECLARED, by starting the kit in worker mode.
  // Without a tag of its own such a process registers as "unknown", which
  // reads as a web app we failed to recognise rather than as what it is.
  "worker",
  "unknown",
] as const;

export type ServerKind = (typeof SERVER_KINDS)[number];

/** True when a value is one of our tags. An unrecognised value is refused
 *  rather than passed through — a made-up tag on the wire is a label nobody
 *  can render. */
export function isServerKind(value: unknown): value is ServerKind {
  return (
    typeof value === "string" &&
    (SERVER_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Package names that identify a framework, most specific FIRST.
 *
 * NestJS and Next.js sit above Express on purpose: both run an Express (or
 * Fastify) server underneath, so the more specific answer is the true one —
 * "this is a Nest app", not "this is Express".
 */
const MODULE_MARKS: ReadonlyArray<[ServerKind, string]> = [
  ["next", "next"],
  ["nest", "@nestjs/core"],
  ["fastify", "fastify"],
  ["hono", "hono"],
  ["hono", "@hono/node-server"],
  ["express", "express"],
];

/** Order the marks are resolved in, so two frameworks in one process (a Nest
 *  app IS an Express app) always resolve the same way. */
const PRECEDENCE: readonly ServerKind[] = [
  "next",
  "nest",
  "fastify",
  "hono",
  "express",
];

/** Everything the decision is made from. Passed in so the judgement itself is
 *  a pure function the tests can drive without a real server. */
export interface ServerKindEvidence {
  /** What the developer said, if anything. Wins over every observation. */
  explicit?: string | null;
  /** `BOOSTHIS_SERVER_KIND`, for a stack we cannot see (a proxy in front, an
   *  unusual bundler). Same standing as `explicit`. */
  env?: string | null;
  /** Package names observed LOADED in this process. */
  modules?: readonly string[];
  /** Marks read off the host's own request listeners (see
   *  {@link listenerMarks}) — evidence that the framework is not merely
   *  installed but actually serving. */
  listeners?: readonly ServerKind[];
  /** False when the module scan could not run at all. */
  looked?: boolean;
}

/**
 * Judge the evidence. Pure — no process state is read here.
 */
export function serverKindFrom(evidence: ServerKindEvidence): ServerKind {
  const stated = evidence.explicit ?? evidence.env ?? null;
  if (isServerKind(stated)) return stated;

  const seen = new Set<ServerKind>(evidence.listeners ?? []);
  const modules = evidence.modules ?? [];
  for (const [kind, pkg] of MODULE_MARKS) {
    if (modules.includes(pkg)) seen.add(kind);
  }
  for (const kind of PRECEDENCE) {
    if (seen.has(kind)) return kind;
  }
  // Nothing known is loaded. If we genuinely looked, this app is being served
  // by node:http directly as far as the kit can tell.
  return evidence.looked === false ? "unknown" : "node-http";
}

/** Package name from a resolved file path, or null. Handles scopes. */
export function packageNameFromPath(path: string): string | null {
  const at = path.lastIndexOf("/node_modules/");
  if (at < 0) return null;
  const rest = path.slice(at + "/node_modules/".length);
  const parts = rest.split("/");
  if (!parts.length) return null;
  if (parts[0]!.startsWith("@")) {
    return parts.length > 1 ? `${parts[0]}/${parts[1]}` : null;
  }
  return parts[0] ?? null;
}

/**
 * Which of the framework packages are LOADED in this process.
 *
 * Reads the CommonJS module registry, which is process-wide and populated even
 * for an ESM app: Node loads a CommonJS dependency through the same loader
 * whichever syntax imported it. A pure-ESM framework can therefore be missed
 * here, which is why the listener marks below exist as a second, independent
 * source of evidence.
 *
 * Never throws: an unreadable registry answers "we could not look", which
 * `serverKindFrom` reports as `unknown` rather than as a plain Node app.
 */
export function loadedFrameworkModules(): { modules: string[]; looked: boolean } {
  try {
    const req = createRequire(import.meta.url);
    const cache = (req as unknown as { cache?: Record<string, unknown> }).cache;
    if (!cache || typeof cache !== "object") return { modules: [], looked: false };
    const wanted = new Set(MODULE_MARKS.map(([, pkg]) => pkg));
    const found = new Set<string>();
    for (const key of Object.keys(cache)) {
      const name = packageNameFromPath(key);
      if (name && wanted.has(name)) found.add(name);
    }
    return { modules: [...found], looked: true };
  } catch {
    return { modules: [], looked: false };
  }
}

/** A function that might be a framework's request listener. */
type MaybeListener = unknown;

/**
 * Marks read off ONE of the host's request listeners. This is the evidence
 * that a framework is really SERVING, not merely installed — and it is the
 * only evidence available for a framework loaded as pure ESM.
 */
export function listenerMarks(listener: MaybeListener): ServerKind[] {
  const marks: ServerKind[] = [];
  try {
    if (typeof listener !== "function") return marks;
    const fn = listener as unknown as Record<string, unknown> & { name?: string };
    // An Express application IS a function, with its own router handle and the
    // settings API bolted on. Connect-style clones share `handle`/`use` but not
    // `set`, so all three are required.
    if (
      typeof fn.handle === "function" &&
      typeof fn.use === "function" &&
      typeof fn.set === "function"
    ) {
      marks.push("express");
    }
    // Next's own server exposes its handler through a named wrapper; both the
    // CLI server and the documented custom-server path go through it.
    if (typeof fn.name === "string" && /nextRequestHandler|nextServer/i.test(fn.name)) {
      marks.push("next");
    }
  } catch {
    /* evidence gathering must never disturb the host */
  }
  return marks;
}

/** Cached so a per-request read costs nothing after the first. */
let cached: ServerKind | null = null;
let explicitOverride: string | null = null;
const listenerSeen = new Set<ServerKind>();

/** Record what a server's own request listeners look like. Called by the
 *  attach when it patches, and again on the first request. */
export function noteServerListeners(listeners: readonly MaybeListener[]): void {
  try {
    let added = false;
    for (const l of listeners) {
      for (const mark of listenerMarks(l)) {
        if (!listenerSeen.has(mark)) {
          listenerSeen.add(mark);
          added = true;
        }
      }
    }
    // New evidence outranks a cached verdict formed without it.
    if (added) cached = null;
  } catch {
    /* never disturb the host */
  }
}

/** The developer's own answer, from `attach({ serverKind })`. */
export function setDeclaredServerKind(kind: string | null | undefined): void {
  explicitOverride = typeof kind === "string" && kind ? kind : null;
  cached = null;
}

/**
 * What this process is serving with. Cached after the first call; the cache is
 * dropped whenever new evidence arrives.
 */
export function detectServerKind(): ServerKind {
  if (cached) return cached;
  let verdict: ServerKind = "unknown";
  try {
    const { modules, looked } = loadedFrameworkModules();
    verdict = serverKindFrom({
      explicit: explicitOverride,
      env: typeof process !== "undefined" ? process.env?.BOOSTHIS_SERVER_KIND ?? null : null,
      modules,
      listeners: [...listenerSeen],
      looked,
    });
  } catch {
    verdict = "unknown";
  }
  cached = verdict;
  return verdict;
}

/** How the kit names each kind to a developer, in the kit's own words. Server
 *  prose is never rendered inside a host app, so this table is the kit's. */
export function serverKindLabel(kind: ServerKind): string {
  switch (kind) {
    case "express":
      return "Express";
    case "fastify":
      return "Fastify";
    case "hono":
      return "Hono";
    case "nest":
      return "NestJS";
    case "next":
      return "Next.js";
    case "node-http":
      return "Plain Node server";
    case "worker":
      return "Worker process (no web server)";
    case "unknown":
      return "Unrecognised server";
  }
}

/** @internal test hook */
export function _resetServerKindForTests(): void {
  cached = null;
  explicitOverride = null;
  listenerSeen.clear();
}
