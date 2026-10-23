/* ─── Boosthis: repeated-work detector (Node) ─────────────────────────────
 *
 * The rule book already tells developers not to redo the same work inside one
 * request (`n-plus-one-orm-query`, `node-fanout-overload`: "identical
 * downstream GETs within one request should share one promise"). Nothing
 * MEASURED it: a span that reaches the server carries a route label, a
 * duration and a rating — never a query, a URL, or an argument — so the server
 * can see that two calls happened but never that they were the SAME call.
 *
 * The counting therefore has to happen HERE, where the real call exists, and
 * only a number may leave.
 *
 * WHAT IS WATCHED. Every call the kit can see the INPUTS of:
 *   • `trackPerf(name, fn)(...args)` — name + arguments are both visible.
 *   • outbound HTTP — the undici observation point liveDetectors already
 *     subscribes to (method + origin + path), paired create → headers/error so
 *     the call's duration is known.
 * `perf(name, fn)` is deliberately NOT watched: it has no visible inputs, so
 * two `perf("db.load_user")` blocks may be two DIFFERENT users. Calling that a
 * repeat would be a lie, and this meter would rather stay quiet.
 *
 * IDENTITY. A call's identity is a 32-bit FNV-1a hash of a bounded local
 * rendering of its target plus its arguments. The rendering is built on the
 * stack, hashed, and dropped: the text, the URL and the argument values are
 * never stored, never logged and NEVER leave this process. Only counts and
 * durations are reported.
 *
 * REQUEST SCOPE. A request's calls are collected in a per-request scope the
 * middleware opens around `next()`. The scope is carried by AsyncLocalStorage
 * (Node's own request-scoped carrier), and the middleware also holds the scope
 * TOKEN directly, so the close always pairs with the open even though the
 * `finish`/`close` listener runs outside the async context. A declined open
 * (the kill-switch, or a shim that lacks AsyncLocalStorage) returns null, and
 * every later call with a null token is a no-op.
 *
 * HONEST WHEN BLIND. A kit that identified no calls at all reports NOTHING —
 * the axis is omitted and the dashboard says "cannot tell". A kit that watched
 * real calls and found no repeat reports a real zero.
 *
 * PRIVACY: counts, durations and one non-reversible in-process hash. No route
 * label, no host, no URL, no argument value. In-memory, bounded, and a no-op
 * under the kill-switch.
 *
 * LATER WORK — the remaining SERVER kits. This ships in Node and Python first
 * because both already have a wrapper that sees a call's inputs plus an
 * outbound observation point to reuse. Go, Java, PHP, .NET, Ruby, Rust and
 * Elixir each need the same two things located in their own kit before the
 * axis can be honest there; until then they simply do not upload it, which
 * reads as "cannot tell" rather than a zero. The phone and browser kits are
 * out of scope: they wrap no calls of this shape.
 */

import { isSettledAt, type SettleFamily } from "./settleRule";
import { AsyncLocalStorage } from "node:async_hooks";

// TYPE-ONLY, deliberately: `dbWork.ts` imports real values from this module,
// so a runtime import back the other way would be a cycle. A type import is
// erased entirely, leaving the one-way dependency intact.
import type { DbRequestTally } from "./dbWork";
import type { AiRequestTally } from "./aiCalls";
import type { DepRequestTally } from "./dependencyWork";
import type { TraceCarrier } from "./trace";
import type { LinkedScope } from "./linkedSteps";

import { isBoosthisDisabled } from "./runtimeFlags";
import { isKitLocked } from "./killSwitch";
import type { RepeatedWorkStatsLike } from "./meterAxes";

/** Most distinct call identities tracked inside ONE request. Past this the
 *  scope stops learning new identities (repeats of the ones it already knows
 *  still count), so a pathological request can never grow memory. */
const MAX_DISTINCT_CALLS = 512;
/** Most arguments folded into one identity. */
const MAX_ARGS = 8;
/** How deep an object/array argument is walked. Also the cycle guard: a walk
 *  that cannot recurse forever cannot hang on a self-referencing argument. */
const MAX_DEPTH = 2;
/** Most keys/elements read from one object/array. */
const MAX_MEMBERS = 12;
/** Longest string value folded in verbatim (longer ones fold in a prefix plus
 *  their length, which still separates two different long values). */
const MAX_STRING = 64;
/** Hard cap on the rendered identity string before hashing. */
const MAX_IDENTITY_CHARS = 512;

/* ── Per-request scope ──────────────────────────────────────────────────── */

interface CallTally {
  /** How many times this identity was called in this request. */
  n: number;
  /** Total ms spent across those calls. */
  ms: number;
}

/** One request's collected call identities. Opaque to callers — the middleware
 *  only ever passes it back to `runInRequestWork` / `endRequestWork`. */
export interface RequestWorkScope {
  calls: Map<number, CallTally>;
  /**
   * The start-up rule (docs/settle-rule-contract.md): when this request opened
   * (epoch ms), and 1 when it was the first its route served (set by the
   * middleware before the closes run). A closing meter folds only a SETTLED
   * request into a graded figure; see `requestSettled`.
   */
  openedAt?: number;
  routeFirst?: 0 | 1;
  /**
   * The same request's DATABASE work, kept in a separate tally by the
   * database-work meter. It rides this scope so the kit opens ONE async
   * context per request rather than two, but the two readings never mix:
   * database round trips are reported by `dbWork` and are deliberately NOT
   * folded into the repeated-work numbers, which keep the meaning they
   * shipped with. Written and cleared only by `dbWork.ts`; `undefined` in
   * every request that made no database call.
   */
  db?: DbRequestTally;
  /**
   * The same request's AI-PROVIDER work, kept in its own tally by the AI-call
   * meter, for the same reason the database tally is separate: it rides this
   * scope so the kit still opens ONE async context per request, but the two
   * readings never mix. An AI call is claimed by `aiCalls.ts` INSTEAD of the
   * repeated-work meter — two different prompts to one provider endpoint share
   * a method, an origin and a path, so the older meter had to call them a
   * repeat, while the AI meter can tell them apart by prompt. Written and
   * cleared only by `aiCalls.ts`; `undefined` in every request that called no
   * AI provider.
   */
  ai?: AiRequestTally;
  /**
   * The same request's OUTSIDE-SERVICE work — sign-in, uploads, payments,
   * messaging, stored-knowledge search — grouped by the KIND of service, in
   * its own tally for the same reason the two above are. It rides this scope
   * so the kit still opens ONE async context per request.
   *
   * Unlike the database and AI tallies this one is ADDITIVE rather than
   * exclusive: the same call still feeds the repeated-work numbers, because
   * three identical GETs to one payment endpoint really are the same call
   * repeated and that reading must not move because this one shipped.
   *
   * Written and cleared only by `dependencyWork.ts`; `undefined` in every
   * request that called no outside service.
   */
  dep?: DepRequestTally;
  /**
   * The REQUEST this scope belongs to, held so the outbound observer can ask
   * the trace primitives for this hop's headers.
   *
   * It rides here for the same reason the tallies above do — this is already
   * the one async context the kit opens per request, and the outbound observer
   * is already reaching into it. The alternative was a second
   * AsyncLocalStorage holding the same object, which would double the async-
   * hook cost the kit imposes on every host in order to carry a field it can
   * have for free.
   *
   * NOT a copy of the request and not a snapshot of it: it is the host's own
   * object, read-only from here, and it goes out of reach with the scope when
   * the request ends. Nothing in it is stored, counted or uploaded — `trace.ts`
   * reads four fields off it and returns three header strings.
   *
   * `undefined` when the middleware did not run (a scope opened by a host that
   * wired the kit some other way), which simply means the outbound observer has
   * no trace to forward and attaches nothing.
   */
  trace?: TraceCarrier;
  /**
   * The same request's database and outside-service calls, folded by word
   * into the LINKED STEPS sent beside the request's own step (see
   * `linkedSteps.ts`). It rides this scope for the reason every tally above
   * does: one async context per request. Opened by the middleware, written
   * only through `linkedSteps.ts`, and read nowhere else — none of the
   * meters above ever sees it, so no reading moves because it exists.
   */
  linked?: LinkedScope | null;
}

interface AsyncLocalStorageLike {
  getStore(): RequestWorkScope | undefined;
  run<T>(store: RequestWorkScope, fn: () => T): T;
}

/** `undefined` = never probed, `null` = unavailable on this runtime. */
let store: AsyncLocalStorageLike | null | undefined;

function requestStore(): AsyncLocalStorageLike | null {
  if (store !== undefined) return store;
  store = null;
  try {
    // STATIC import, deliberately — not a lazy `require`. This kit ships as
    // ESM (its package.json says `"type": "module"`), where `require` is not
    // defined at all: a lazy require would throw into the catch below on every
    // real install, decline the scope, and leave this meter permanently silent
    // while every unit test passed (the test runner provides a `require`
    // shim). The kit already static-imports `node:perf_hooks`, so it cannot
    // load on a runtime without Node built-ins anyway. The guard below stays
    // for a shim that exports the module without the class.
    if (typeof AsyncLocalStorage === "function") {
      store = new AsyncLocalStorage() as unknown as AsyncLocalStorageLike;
    }
  } catch {
    store = null;
  }
  return store;
}

/* ── Session totals (the only things that ever leave) ───────────────────── */

/** Requests in which at least one identifiable call was watched. */
let watchedRequests = 0;
/** Of those, how many contained the same call more than once. */
let requestsWithRepeat = 0;
/** Worst number of identical calls seen inside a SINGLE request. */
let worstRepeats = 0;
/** Wall ms of the watched requests (the share denominator). */
let watchedRequestMs = 0;
/** Ms attributable to the redundant occurrences (every call after the first
 *  of each repeated identity), clamped per request to that request's wall
 *  time so concurrency can never push the share past 100%. */
let redundantMs = 0;

/* ── Identity (local, non-reversible, never uploaded) ───────────────────── */

/** 32-bit FNV-1a. Fast, allocation-free and stable within one process — which
 *  is all an identity needs to be, since it never leaves. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Bounded, shallow, allocation-light rendering of one argument. Depth- and
 *  width-capped so a huge or self-referencing argument costs a fixed amount.
 *  The result is hashed immediately and discarded. */
function renderValue(v: unknown, depth: number): string {
  const t = typeof v;
  if (t === "string") {
    const s = v as string;
    return s.length > MAX_STRING ? `s${s.length}:${s.slice(0, MAX_STRING)}` : `s:${s}`;
  }
  if (t === "number" || t === "boolean" || t === "bigint") return `${t[0]}:${String(v)}`;
  if (t === "undefined") return "u";
  if (t === "function") return "f";
  if (t === "symbol") return "y";
  if (v === null) return "z";
  if (depth <= 0) return "o";
  try {
    if (Array.isArray(v)) {
      const n = Math.min(v.length, MAX_MEMBERS);
      const parts: string[] = [];
      for (let i = 0; i < n; i++) parts.push(renderValue(v[i], depth - 1));
      return `[${v.length}:${parts.join(",")}]`;
    }
    if (v instanceof Date) return `d:${v.getTime()}`;
    // Binary: a Buffer / typed array is index-keyed, so the object walk below
    // would enumerate it byte by byte — expensive, and it would fold real
    // customer bytes into the render. Database parameters carry these often
    // (a uuid, a hash, an uploaded blob). Its LENGTH is identity enough.
    if (ArrayBuffer.isView(v)) return `b:${(v as ArrayBufferView).byteLength}`;
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).sort().slice(0, MAX_MEMBERS);
    const parts: string[] = [];
    for (const k of keys) parts.push(`${k}=${renderValue(o[k], depth - 1)}`);
    return `{${parts.join(",")}}`;
  } catch {
    // A throwing getter or an exotic proxy: fall back to a type tag rather
    // than letting instrumentation break the host's call.
    return "o";
  }
}

/**
 * Local identity for one call: its target plus its arguments, hashed.
 *
 * PRIVACY: the rendered string exists only on this stack and is never stored,
 * logged or transmitted. The returned number is an in-process grouping key —
 * it never leaves the kit either.
 */
export function callIdentity(target: string, args: readonly unknown[]): number {
  try {
    let s = target;
    const n = Math.min(args.length, MAX_ARGS);
    for (let i = 0; i < n; i++) {
      s += `|${renderValue(args[i], MAX_DEPTH)}`;
      if (s.length > MAX_IDENTITY_CHARS) {
        s = s.slice(0, MAX_IDENTITY_CHARS);
        break;
      }
    }
    // An over-long argument list still separates on its length, so a 9-arg
    // call is never confused with an 8-arg one.
    if (args.length > n) s += `|+${args.length}`;
    return fnv1a(s);
  } catch {
    return fnv1a(target);
  }
}

/* ── Recording ──────────────────────────────────────────────────────────── */

function file(scope: RequestWorkScope, identity: number, durationMs: number): void {
  const ms = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  const seen = scope.calls.get(identity);
  if (seen) {
    seen.n += 1;
    seen.ms += ms;
    return;
  }
  // Bounded: past the cap we stop LEARNING identities but keep counting the
  // ones already known, so a fan-out that has already been spotted is still
  // measured correctly.
  if (scope.calls.size >= MAX_DISTINCT_CALLS) return;
  scope.calls.set(identity, { n: 1, ms });
}

/**
 * Record one watched call against the request currently in scope. Outside a
 * request scope this is a no-op: a call we cannot attribute to a request is a
 * call we cannot judge for repetition. Never throws.
 */
export function noteWatchedCall(identity: number, durationMs: number): void {
  if (isBoosthisDisabled() || isKitLocked()) return;
  try {
    const scope = requestStore()?.getStore();
    if (scope) file(scope, identity, durationMs);
  } catch {
    /* instrumentation must never disturb the host */
  }
}

/* ── Outbound pairing (undici create → headers/error) ───────────────────── */

interface PendingOutbound {
  scope: RequestWorkScope;
  identity: number;
  start: number;
}

/** Keyed by undici's own per-call request object, so a call that never
 *  completes is collected with it — no unbounded map, no timers. */
const pendingOutbound = new WeakMap<object, PendingOutbound>();

/**
 * An outbound call started inside the current request. `target` is a
 * code-level description of the call (method + origin + path); it is hashed
 * immediately and never retained. Never throws.
 */
export function noteOutboundStart(token: object, target: string): void {
  if (isBoosthisDisabled() || isKitLocked()) return;
  try {
    const scope = requestStore()?.getStore();
    if (!scope) return;
    pendingOutbound.set(token, {
      scope,
      identity: callIdentity(target, []),
      start: performance.now(),
    });
  } catch {
    /* instrumentation must never disturb the host */
  }
}

/** The paired end of `noteOutboundStart` — files the call with its measured
 *  duration into the request that STARTED it (not whichever request happens to
 *  be in scope when the response lands). Never throws. */
export function noteOutboundEnd(token: object): void {
  if (isBoosthisDisabled() || isKitLocked()) return;
  try {
    const p = pendingOutbound.get(token);
    if (!p) return;
    pendingOutbound.delete(token);
    file(p.scope, p.identity, performance.now() - p.start);
  } catch {
    /* instrumentation must never disturb the host */
  }
}

/* ── Request lifecycle ──────────────────────────────────────────────────── */

/**
 * Open a request scope, or DECLINE (null) under the kill-switch or on a
 * runtime with no async_hooks. A declined open makes every later call for that
 * request — including the close — a no-op, so the pair can never half-run.
 */
export function beginRequestWork(): RequestWorkScope | null {
  if (isBoosthisDisabled() || isKitLocked()) return null;
  if (!requestStore()) return null;
  return { calls: new Map(), openedAt: Date.now() };
}

/** Mark the request as the first its route served (the start-up rule: that
 *  request pays the route's cold handler, connection and schema reads). */
export function noteRouteFirst(scope: RequestWorkScope | null, first: boolean): void {
  if (scope && first) scope.routeFirst = 1;
}

/** Was this a settled request for `family`: opened after the process settled,
 *  and not the first its route served? Only settled requests are graded. */
export function requestSettled(scope: RequestWorkScope, family: SettleFamily): boolean {
  return scope.routeFirst !== 1 && isSettledAt(family, scope.openedAt ?? 0);
}

let settlingRequestCount = 0;

/** Run the rest of the request inside `scope`, so a wrapped call anywhere down
 *  the stack finds it. A declined scope runs `fn` untouched. */
export function runInRequestWork<T>(scope: RequestWorkScope | null, fn: () => T): T {
  const s = scope ? requestStore() : null;
  if (!scope || !s) return fn();
  return s.run(scope, fn);
}

/**
 * The request scope in flight on this async stack, or null outside one.
 *
 * Exported so the database-work meter can attribute a query to the request
 * that issued it WITHOUT opening a second AsyncLocalStorage — two contexts per
 * request would double the async-hook cost the kit imposes on every host. Work
 * that happens outside a request (a startup migration, a background job) finds
 * no scope and is deliberately not counted: it cannot be attributed to a
 * request, so it cannot honestly contribute to a per-request share.
 */
export function currentRequestScope(): RequestWorkScope | null {
  try {
    return requestStore()?.getStore() ?? null;
  } catch {
    return null;
  }
}

/**
 * How many onward calls this request made that the kit could identify.
 *
 * Read by the function-host limit reading, which needs "how many calls did one
 * run make" and must not invent the number. It is deliberately the IDENTIFIED
 * count and not a guess at the true one: a call through a client the kit does
 * not watch is not counted, which is why the reading beside it says what it is
 * counting rather than claiming completeness.
 *
 * Must be read BEFORE `endRequestWork`, which clears the scope.
 */
export function identifiedCallCount(scope: RequestWorkScope | null): number {
  if (!scope) return 0;
  try {
    let n = 0;
    for (const tally of scope.calls.values()) n += tally.n;
    return n;
  } catch {
    return 0;
  }
}
/**
 * Close a request scope and fold it into the session totals. `requestMs` is
 * the request's own wall time — the denominator for the repeat share. Never
 * throws; a null scope (declined open) does nothing.
 */
export function endRequestWork(
  scope: RequestWorkScope | null,
  requestMs: number,
): void {
  if (!scope) return;
  try {
    let identified = 0;
    let worst = 0;
    let redundant = 0;
    for (const tally of scope.calls.values()) {
      identified += tally.n;
      if (tally.n > worst) worst = tally.n;
      // Mean duration × the redundant occurrences: we keep a total, not a list.
      if (tally.n > 1) redundant += (tally.ms / tally.n) * (tally.n - 1);
    }
    scope.calls.clear();
    // Nothing identifiable happened in this request — it teaches the meter
    // nothing, so it is not counted as watched. (An app that NEVER identifies
    // a call therefore reports no axis at all: "cannot tell", not a zero.)
    if (identified === 0) return;
    if (isBoosthisDisabled() || isKitLocked()) return;
    // The start-up rule (startupEvent): warm-up reading the same config twice
    // is ordinary, so a request before the process settled, or the first its
    // route served, is counted apart and never graded.
    if (!requestSettled(scope, "startupEvent")) {
      settlingRequestCount += 1;
      return;
    }
    const wall = Number.isFinite(requestMs) && requestMs > 0 ? requestMs : 0;
    watchedRequests += 1;
    watchedRequestMs += wall;
    if (worst > worstRepeats) worstRepeats = worst;
    if (worst > 1) {
      requestsWithRepeat += 1;
      // Clamp to this request's own wall time: parallel repeats can add up to
      // more than the request lasted, and a share above 100% is not a fact.
      redundantMs += Math.min(redundant, wall);
    }
  } catch {
    /* instrumentation must never disturb the host */
  }
}

/* ── Reading ────────────────────────────────────────────────────────────── */

/** Session totals for the `repeatedWork` axis. Numbers only. */
export function getRepeatedWorkStats(): RepeatedWorkStatsLike {
  return {
    watchedRequests,
    requestsWithRepeat,
    worstRepeats,
    redundantMs,
    watchedRequestMs,
    settlingRequests: settlingRequestCount,
  };
}

/** Wipe all state (wired into `forget()` so nothing Boosthis-shaped keeps
 *  counting after erasure). Idempotent; never throws. */
export function clearRepeatedWork(): void {
  settlingRequestCount = 0;
  watchedRequests = 0;
  requestsWithRepeat = 0;
  worstRepeats = 0;
  watchedRequestMs = 0;
  redundantMs = 0;
}

/** @internal test hooks. */
export const _repeatedWorkInternals = {
  MAX_DISTINCT_CALLS,
  MAX_ARGS,
  MAX_IDENTITY_CHARS,
  renderValue,
  fnv1a,
};
