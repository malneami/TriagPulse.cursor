/* ─── Boosthis: the outside services an app leans on (Node) ────────────────
 *
 * WHY THIS EXISTS. Signing in is the first thing every visitor does and is
 * almost always somebody else's service; if it is slow, the product is slow
 * before anything loads. Uploads are the slowest thing most of these apps do.
 * Payments sit on the one path where a failure costs money. Messaging failures
 * are normally discovered by a customer complaining. Search over stored
 * knowledge behaves like a database but hides behind a web call. Until now all
 * five arrived as ONE blurred figure — "some outbound calls happened, some
 * were slow" — which is not a sentence anybody can act on.
 *
 * This module keeps the same measurements the outbound pool already kept, but
 * GROUPED BY THE KIND of service the call went to, so the reading becomes
 * "sign-in is what is slow" instead of "something is slow".
 *
 * PRIVACY — the whole reason the grouping lives in here. Grouping by
 * destination inside the app is established practice in this kit: the
 * retry-storm detector has always done it in memory and reported only an
 * anonymous count. This follows the same rule. A hostname is turned into one
 * of six constant WORDS by {@link dependencyKindFor}, the hostname is dropped
 * on this stack, and only counts, durations and that word ever leave. No
 * address, no path, no query, no header and no payload — not the response
 * body, not the status code, only the coarse outcome it implied.
 *
 * WHAT IT DOES NOT CLAIM.
 *   • It never reads what a service sent or received beyond timing + outcome.
 *   • It never judges a provider's reliability publicly and never compares one
 *     provider with another. Only a recognised service's closed name leaves.
 *   • Hosted databases and AI providers are classified upstream as DATABASE
 *     and AI work and never reach this module: their readings are `dbWork` and
 *     `aiCalls`, and counting them here would report one wait twice.
 *
 * SIGN-IN THAT MAKES NO CALL. Several of the most popular sign-in libraries
 * run inside the app and talk only to the app's own database. Classifying by
 * destination misses them entirely, and reporting that such an app has no
 * sign-in would be worse than saying nothing. {@link inAppSigninDetected} reads
 * the host's module cache for one of those libraries — the same honesty move
 * the database meter already makes for a driver it cannot watch — so the page
 * can say plainly that sign-in happens inside the app rather than show a gap.
 *
 * ADDITIVE. This never touches the composite Speed score, and it never moves a
 * reading that already shipped: the same call still feeds the network meter and
 * the repeated-work meter exactly as before. Nothing here subtracts.
 *
 * LATER WORK — the remaining server kits. Node and Python first, because both
 * already have the outbound observation point and the destination-recognition
 * step this reuses. Go, Java, PHP, .NET, Ruby, Rust and Elixir each need that
 * same recognition step located in their own kit before this can be honest
 * there; until then they simply do not upload the axis, which every surface
 * reads as "cannot tell" rather than as an app with no dependencies.
 */

import { isBoosthisDisabled } from "./runtimeFlags";
import { isKitLocked } from "./killSwitch";
import { callFailure, countFailure, countService, emptyFailures, topServices, type CallFailure, type FailureCounts, type ServiceCounts } from "./callFailures";
import { currentRequestScope, requestSettled, type RequestWorkScope } from "./repeatedWork";
import { currentLinkedScope, noteLinkedCall, type LinkedScope } from "./linkedSteps";
import { isSettledAt } from "./settleRule";
import { hostPackageIsLoaded } from "./dbWork";
import {
  DEPENDENCY_KINDS,
  KIND_RULES,
  IN_APP_SIGNIN_PACKAGES,
  dependencyKindFor,
  dependencyFor,
  type DependencyKind,
} from "./dependencyKinds";
import type { DependencyStatsLike } from "./meterAxes";

/** Durations kept per kind for the p75. Six kinds × this is the whole memory
 *  cost of the grouping, and it never grows with traffic. */
const KIND_RING = 128;

/** How a finished call ended, as coarsely as it can honestly be put. */
export type DependencyOutcome = "ok" | "failed" | "timedout";

/* ── Per-kind session totals ─────────────────────────────────────────────── */

interface KindTotals extends FailureCounts {
  services: Map<string, ServiceCounts>;
  calls: number;
  ok: number;
  failed: number;
  timedOut: number;
  /** Watched requests that touched this kind at least once. */
  requests: number;
  ms: number[];
  msAt: number;
  worstMs: number;
}

function emptyKind(): KindTotals {
  return {
    ...emptyFailures(),
    services: new Map(),
    calls: 0,
    ok: 0,
    failed: 0,
    timedOut: 0,
    requests: 0,
    ms: [],
    msAt: 0,
    worstMs: 0,
  };
}

const totals = new Map<DependencyKind, KindTotals>();
const learnedServices = new Map<DependencyKind, Set<string>>();

function totalsFor(kind: DependencyKind): KindTotals {
  let t = totals.get(kind);
  if (!t) {
    t = emptyKind();
    totals.set(kind, t);
  }
  return t;
}

function pushMs(t: KindTotals, ms: number): void {
  // Fixed-size ring: the p75 stays honest under long-running traffic without
  // the memory cost growing with it.
  if (t.ms.length < KIND_RING) t.ms.push(ms);
  else {
    t.ms[t.msAt] = ms;
    t.msAt = (t.msAt + 1) % KIND_RING;
  }
}

/** Fold one finished call into a per-kind figure: the session totals, or one
 *  request's hold (below). */
function foldCall(
  t: KindTotals,
  ms: number,
  outcome: DependencyOutcome,
  timed = true,
  word?: CallFailure,
  service?: string,
): void {
  t.calls += 1;
  if (outcome === "timedout") t.timedOut += 1;
  else if (outcome === "failed") t.failed += 1;
  else t.ok += 1;
  countFailure(t, word, outcome === "failed", outcome === "timedout");
  countService(t.services, service, outcome === "failed", outcome === "timedout");
  // A call declared as waiting on purpose is counted, never timed: its
  // duration is the wait it was declared for (docs/held-open-calls.md).
  if (!timed) return;
  if (ms > t.worstMs) t.worstMs = ms;
  pushMs(t, ms);
}

/** Add one settled request's held calls to the session totals. */
function mergeKind(into: KindTotals, from: KindTotals): void {
  into.calls += from.calls;
  into.ok += from.ok;
  into.failed += from.failed;
  into.timedOut += from.timedOut;
  for (const field of Object.keys(emptyFailures()) as (keyof FailureCounts)[]) into[field] += from[field];
  for (const [name, s] of from.services) {
    let dest = into.services.get(name);
    if (!dest && into.services.size < 8) {
      dest = { name, calls: 0, failed: 0, timedOut: 0 };
      into.services.set(name, dest);
    }
    if (dest) { dest.calls += s.calls; dest.failed += s.failed; dest.timedOut += s.timedOut; }
  }
  if (from.worstMs > into.worstMs) into.worstMs = from.worstMs;
  for (const ms of from.ms) pushMs(into, ms);
}

/**
 * The start-up verdict of every request that has already closed (1 = settled),
 * for a call that finishes after its response went out. Weak, so a finished
 * request is held by nothing here.
 */
const closedVerdict = new WeakMap<RequestWorkScope, 0 | 1>();

/* ── Per-request tally ───────────────────────────────────────────────────── */

/** One request's outside-service work. Lives on the request scope the
 *  middleware already opens, so no second async-context carrier is needed. */
export interface DepRequestTally {
  /** Round trips per kind in THIS request. */
  byKind: Map<DependencyKind, number>;
  /** Round trips watched in this request, across every kind. */
  count: number;
  /**
   * Of `count`, how many did NOT come back with an answer — a 5xx, a 429 or a
   * timeout, the same bucket {@link outcomeForStatus} already decides for the
   * per-kind session totals.
   *
   * Kept per REQUEST as well as per kind because one reading needs both halves
   * of the same request at once: how much of its data arrived, and what the
   * response finally carried. See docs/failure-containment.md. The
   * outside-service reading itself does not use this field and does not move
   * because it exists.
   */
  failed: number;
  /** Total ms waited on outside services in this request (calls may overlap
   *  — the fold clamps to the request's own wall time). */
  ms: number;
  /**
   * This request's calls per kind, held until the close: whether they join
   * the per-kind session totals is the start-up rule's verdict on the REQUEST
   * (opened after settling, not its route's first), and the route half is
   * only known once the response is labelled. Without the hold, the per-kind
   * groups counted the start-up calls the reading's own totals leave out.
   */
  kinds: Map<DependencyKind, KindTotals>;
}

function tallyFor(scope: RequestWorkScope): DepRequestTally {
  let t = scope.dep;
  if (!t) {
    t = { byKind: new Map(), count: 0, failed: 0, ms: 0, kinds: new Map() };
    scope.dep = t;
  }
  return t;
}

/* ── Session totals (the only things that ever leave) ────────────────────── */

/** Requests in which at least one outside-service call was watched. */
let watchedRequests = 0;
/** Wall ms of those requests (the share denominator for all four shares). */
let watchedRequestMs = 0;
/** Ms spent waiting on outside services, clamped per request. */
let depMs = 0;
/** Ms those same requests spent waiting on the DATABASE. Read off the shared
 *  request scope at close time — not measured again here — so the three waits
 *  and the app's own time are shares of ONE denominator and actually add up. */
let dbMs = 0;
/** Ms those same requests spent waiting on an AI PROVIDER, read the same way
 *  and for the same reason. */
let aiMs = 0;
/** Outside-service round trips watched. */
let callCount = 0;

/* ── Recording ───────────────────────────────────────────────────────────── */

/**
 * File one finished outside-service round trip against a request scope
 * CAPTURED WHEN THE CALL WAS ISSUED.
 *
 * The scope is passed in rather than read here for the reason the database
 * meter documents at length: a pooled connection answers on a socket opened
 * during some EARLIER request, so the async context a completion callback runs
 * in belongs to whoever created that socket. Reading the ambient scope at
 * completion time files every call after the first against a long-finished
 * request. Never throws.
 */
export function noteDependencyCallIn(
  scope: RequestWorkScope | null,
  kind: DependencyKind,
  durationMs: number,
  outcome: DependencyOutcome,
  timed = true,
  detail?: { status?: number; error?: unknown; service?: string },
): void {
  if (isBoosthisDisabled() || isKitLocked()) return;
  try {
    const elapsed = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
    // An untimed call (declared as waiting on purpose) keeps none of its
    // duration: the elapsed time only dates its start, below.
    const ms = timed ? elapsed : 0;
    const word = callFailure(detail?.status, detail?.error);
    // A service is accepted only when it belongs to this kind's closed table.
    let service = kind !== "other" && detail?.service && KIND_RULES.some(r => r.kind === kind && r.service === detail.service) ? detail.service : undefined;
    if (service) {
      let seen = learnedServices.get(kind);
      if (!seen) { seen = new Set(); learnedServices.set(kind, seen); }
      if (seen.has(service) || seen.size < 8) seen.add(service);
      else service = undefined;
    }
    // A call outside a request scope still teaches the per-kind totals (it
    // really happened), but it cannot contribute to a per-REQUEST share, so
    // no tally is attributed to a guess. With no request to judge it by, its
    // own start decides the start-up rule: begun before the process settled,
    // it is start-up work and stays out of the graded figures.
    if (!scope) {
      if (isSettledAt("latencyTail", Date.now() - elapsed)) {
        foldCall(totalsFor(kind), ms, outcome, timed, word, service);
      }
      return;
    }
    // A call that outlived its response: the request's verdict is known.
    const closed = closedVerdict.get(scope);
    if (closed !== undefined) {
      if (closed === 1) foldCall(totalsFor(kind), ms, outcome, timed, word, service);
      return;
    }
    const rt = tallyFor(scope);
    rt.count += 1;
    if (outcome !== "ok") rt.failed += 1;
    rt.ms += ms;
    rt.byKind.set(kind, (rt.byKind.get(kind) ?? 0) + 1);
    let held = rt.kinds.get(kind);
    if (!held) {
      held = emptyKind();
      rt.kinds.set(kind, held);
    }
    foldCall(held, ms, outcome, timed, word, service);
  } catch {
    /* instrumentation must never disturb the host */
  }
}

/* ── Outbound pairing (undici create → headers/error) ────────────────────── */

interface PendingDependency {
  scope: RequestWorkScope | null;
  /** The linked-step scope captured with it (linkedSteps.ts). */
  linked: LinkedScope | null;
  kind: DependencyKind;
  service?: string;
  start: number;
  /** Declared as waiting on purpose (declaredWaits.ts): its failures count,
   *  its duration and its linked step never do. */
  declared: boolean;
}

/** Keyed by undici's own per-call request object, so a call that never
 *  completes is collected with it — no unbounded map, no timers. */
const pending = new WeakMap<object, PendingDependency>();

/**
 * An outside-service call started. `host` is the bare hostname the outbound
 * observer already normalised; it is turned into one of six constant words
 * here and dropped on this stack. Never throws.
 */
export function noteDependencyStart(
  token: object,
  host: unknown,
  declared = false,
): void {
  if (isBoosthisDisabled() || isKitLocked()) return;
  try {
    pending.set(token, {
      scope: currentRequestScope(),
      linked: declared ? null : currentLinkedScope(),
      ...dependencyFor(host),
      start: performance.now(),
      declared,
    });
  } catch {
    /* instrumentation must never disturb the host */
  }
}

/**
 * The paired end of {@link noteDependencyStart} — files the call's measured
 * duration and outcome into the request that STARTED it. Never throws.
 */
export function noteDependencyEnd(
  token: object,
  outcome: DependencyOutcome,
  detail?: { status?: number; error?: unknown },
): void {
  if (isBoosthisDisabled() || isKitLocked()) return;
  try {
    const p = pending.get(token);
    if (!p) return;
    pending.delete(token);
    // A call declared as waiting on purpose: an answer is kept out of this
    // reading entirely (the network reading counts it as kept out), and a
    // failure is a failure like any other — with no duration and no linked
    // step, because both would be the wait it was declared for.
    if (p.declared) {
      // The elapsed time is handed over untimed: it only lets the start-up
      // rule judge the call by when it STARTED, as every other call is.
      if (outcome !== "ok") {
        noteDependencyCallIn(p.scope, p.kind, performance.now() - p.start, outcome, false, { ...detail, service: p.service });
      }
      return;
    }
    const end = performance.now();
    // The linked step: the same kind word this reading already groups by,
    // the timing, and whether it worked — a timeout is a failure here too.
    noteLinkedCall(p.linked, p.kind, p.start, end, outcome !== "ok");
    noteDependencyCallIn(p.scope, p.kind, end - p.start, outcome, true, { ...detail, service: p.service });
  } catch {
    /* instrumentation must never disturb the host */
  }
}

/**
 * How a finished HTTP response should be counted.
 *
 * A status code is read on this stack to decide, and thrown away: only the
 * coarse bucket is kept, and it is a COUNT that leaves, never a code. A 5xx is
 * the service failing; a 429 is the service refusing to serve you, which is
 * the same experience for a visitor. Every other status — including a 404 or a
 * 401, which are the app's own doing rather than the dependency breaking — is
 * a call that completed.
 */
export function outcomeForStatus(status: unknown): DependencyOutcome {
  const s = typeof status === "number" && Number.isFinite(status) ? status : 0;
  if (s >= 500 || s === 429) return "failed";
  return "ok";
}

/* ── Request lifecycle ───────────────────────────────────────────────────── */

/**
 * Fold one finished request's outside-service work into the session totals.
 *
 * MUST RUN BEFORE the database and AI closes, and the middleware calls it
 * there: this is the one place that can read all three waits off the SAME
 * request scope, and those two closes clear their tallies. Getting the order
 * wrong does not corrupt anything — the two borrowed shares simply read zero —
 * but the breakdown stops adding up, so the order is asserted by a test.
 *
 * `requestMs` is the request's own wall time — the denominator for every
 * share. Never throws; a request that called no outside service teaches this
 * meter nothing and is not counted as watched.
 */
export function endDependencyWork(
  scope: RequestWorkScope | null,
  requestMs: number,
): void {
  if (!scope) return;
  try {
    // The start-up rule (latencyTail): the first connection's DNS and TLS ride
    // the requests before the process settled and each route's first request;
    // those are counted apart and never folded into a graded figure. Kept for
    // a call still in flight, which finishes after this close.
    const settled = requestSettled(scope, "latencyTail");
    closedVerdict.set(scope, settled ? 1 : 0);
    const t = scope.dep;
    if (!t) return;
    scope.dep = undefined;
    if (t.count === 0) return;
    if (isBoosthisDisabled() || isKitLocked()) return;
    if (!settled) {
      settlingRequestCount += 1;
      return;
    }
    const wall = Number.isFinite(requestMs) && requestMs > 0 ? requestMs : 0;
    watchedRequests += 1;
    watchedRequestMs += wall;
    callCount += t.count;
    // Clamp each wait to this request's own wall time: parallel calls can add
    // up to more than the request lasted, and a share above 100% is not a fact.
    depMs += wall > 0 ? Math.min(t.ms, wall) : 0;
    const db = scope.db?.ms;
    if (typeof db === "number" && db > 0 && wall > 0) dbMs += Math.min(db, wall);
    const ai = scope.ai?.ms;
    if (typeof ai === "number" && ai > 0 && wall > 0) aiMs += Math.min(ai, wall);
    for (const [kind, held] of t.kinds) mergeKind(totalsFor(kind), held);
    t.kinds.clear();
    for (const kind of t.byKind.keys()) totalsFor(kind).requests += 1;
    t.byKind.clear();
  } catch {
    /* instrumentation must never disturb the host */
  }
}

/* ── Sign-in that runs inside the app ────────────────────────────────────── */

/**
 * Does this app sign people in ITSELF, with no outside service to time?
 *
 * A read of the host's module cache — the same honesty move the database meter
 * makes for a driver it cannot watch. Answers a boolean, never a name, and
 * never loads or resolves anything. Never throws.
 */
export function inAppSigninDetected(): boolean {
  if (isBoosthisDisabled()) return false;
  try {
    for (const name of IN_APP_SIGNIN_PACKAGES) {
      if (hostPackageIsLoaded(name)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/* ── Reading out ─────────────────────────────────────────────────────────── */

function p75Of(t: KindTotals): number {
  if (t.ms.length === 0) return 0;
  const sorted = [...t.ms].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75));
  return Math.round(sorted[i]!);
}

/** Session totals for the `dependencies` axis. Numbers, plus the six constant
 *  kind words — nothing else has ever been kept to leak. */
let settlingRequestCount = 0;

/** Requests with outside-service work the start-up rule kept out of the
 *  graded figures. */
export function dependencySettlingRequests(): number {
  return settlingRequestCount;
}

export function getDependencyStats(): DependencyStatsLike {
  const groups = [];
  for (const kind of DEPENDENCY_KINDS) {
    const t = totals.get(kind);
    if (!t || t.calls === 0) continue;
    groups.push({
      kind,
      calls: t.calls,
      failed: t.failed,
      timedOut: t.timedOut,
      couldNotConnect: t.couldNotConnect,
      noAnswer: t.noAnswer,
      turnedAway: t.turnedAway,
      tooManyRequests: t.tooManyRequests,
      serverError: t.serverError,
      cancelled: t.cancelled,
      ...(kind !== "other" ? topServices(t.services) : {}),
      requests: t.requests,
      p75Ms: p75Of(t),
      worstMs: Math.round(t.worstMs),
      // Intermittent: this kind BOTH worked and broke inside the window. A
      // dependency that always fails is a different problem from one that
      // fails now and then, and the fix is different too — so the two are
      // never rendered as the same finding.
      flaky: t.ok > 0 && t.failed + t.timedOut > 0 ? (1 as const) : (0 as const),
    });
  }
  return {
    watchedRequests,
    watchedRequestMs,
    depMs,
    dbMs,
    aiMs,
    callCount,
    groups,
    inAppSignin: inAppSigninDetected() ? 1 : 0,
  };
}

/** Forget everything measured so far. Used by the telemetry forget lever and
 *  by tests; leaves no per-kind residue behind. */
export function clearDependencyWork(): void {
  learnedServices.clear();
  settlingRequestCount = 0;
  totals.clear();
  watchedRequests = 0;
  watchedRequestMs = 0;
  depMs = 0;
  dbMs = 0;
  aiMs = 0;
  callCount = 0;
}

/** Test seam: file a synthetic finished call without an undici round trip.
 *  Never used by shipped code paths. */
export const __dependencyInternals = {
  fileSynthetic(
    kind: DependencyKind,
    durationMs: number,
    outcome: DependencyOutcome,
    scope?: RequestWorkScope | null,
  ): void {
    noteDependencyCallIn(scope ?? currentRequestScope(), kind, durationMs, outcome);
  },
};
