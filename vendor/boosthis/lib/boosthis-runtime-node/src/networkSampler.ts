/* ─── Boosthis: outbound-network sampler (Node) ──────────────────────────
 *
 * Aggregates the OUTBOUND calls the app makes into the label-free counts +
 * durations the `network` meter axis scores (see meterAxes.ts computeNetworkScore).
 * It is FED from the SAME undici/global-`fetch` `diagnostics_channel`
 * observation point that already drives the retry-storm detector in
 * liveDetectors.ts — there is NO second interception layer. liveDetectors owns
 * the subscription and calls the lifecycle hooks here (attempt start / complete
 * / error), and any outbound client the runtime cannot auto-observe can call
 * `recordOutboundAttempt` explicitly, exactly as the retry-storm detector does.
 *
 * Outcome buckets mirror the RN network sampler:
 *   • completed — the call finished (with any HTTP status; a 500 is a LOUD,
 *     completed response, not a silent stall).
 *   • failed    — the call errored (undici emitted an error).
 *   • timeout   — the call errored with a timeout-class error.
 *   • stall     — the call NEVER completed within the kit's existing stall
 *     horizon (NETWORK_STALL_MS): the silent-drop class the axis exists for.
 *
 * WHAT THIS COUNTS, AND WHAT THE RETRY-STORM DETECTOR COUNTS. The two are fed
 * from one observation point but they do not measure the same thing, so their
 * attempt counts are not interchangeable:
 *   • This sampler counts attempts it can TIME — one per `recordAttemptStart`,
 *     i.e. one per auto-observed undici request. Every start is counted, even
 *     when the in-flight table is full, so the rate stays honest; the outcome
 *     buckets only advance when an attempt RESOLVES, so `attemptCount` is
 *     >= completed+failed+timeout+stall while calls are still in flight.
 *   • The retry-storm detector (liveDetectors.ts) counts attempts per TARGET
 *     HOST over a rolling window. It also accepts attempts an app reports by
 *     hand for clients the kit cannot observe; those never reach this sampler,
 *     because a hand-reported attempt carries no end signal to time it against.
 *     And it drops attempts past its host cap, which this sampler does not.
 * On the auto-observed path the two agree attempt-for-attempt — including a
 * burst of retries — and outboundRetryAccounting.test.ts holds them to it.
 * Everywhere else the storm detector sees MORE attempts, never fewer.
 *
 * WHAT NEITHER OF THEM COUNTS is a call to Boosthis's own upload endpoint.
 * Registrations, check-ins and snapshot flushes ride the same global `fetch`
 * the observer watches, and they are not the app's outbound traffic: the
 * observer drops them at the top of every callback, before any counter here
 * runs. This sampler therefore measures only calls the app made itself, which
 * is what lets an app with no outbound dependencies report none — and what
 * keeps a slow or refusing Boosthis from degrading a customer's
 * outbound-reliability reading.
 *
 * AND IT IS NOT COUNTED ON TRUST. Every function here that STARTS an attempt
 * or a connection takes an `AppTraffic` pass, which only `ownTraffic.ts` can
 * mint and only for a destination it could read and that is not ours. The
 * screen used to be a property of this module's ONE caller: true today, and
 * silently false the day a second observation point is wired in — a plain
 * `http.ClientRequest` patch, another client library — which would have fed
 * our own traffic straight into the app's meters with nothing refusing it and
 * no test failing. A new caller that has not asked the question now fails to
 * compile; one that forces its way past the types is refused here at runtime
 * and counted as a refusal (see `_networkSamplerInternals.unattributedRefused`)
 * rather than dropped in silence.
 *
 * PRIVACY: only durations (ms) and outcome counts ever reach this module — no
 * host, URL, path, header, status line, or any request detail. THE PASS IS NOT
 * AN EXCEPTION TO THAT: it carries no host and no request, only the verdict
 * "somebody asked, and this is the app's". The question is answered on the
 * caller's side of the boundary; only the answer crosses it. Everything is
 * in-memory only and bounded (a fixed-size ring of recent durations). A no-op
 * under the kill-switch.
 */

import { type AppTraffic, isAppTraffic } from "./ownTraffic";
import { isBoosthisDisabled } from "./runtimeFlags";
import { type DeclaredCallMatch, noteDeclaredCallExcluded } from "./declaredWaits";
import { SETTLE_FAMILIES, settledFromMs, settledTail } from "./settleRule";
import type {
  DependencyDistanceKindStat,
  NetworkStatsLike,
} from "./meterAxes";

/** A call that never completes within this horizon is counted as a silent
 *  stall (mirrors the retry-storm window's order of magnitude). */
export const NETWORK_STALL_MS = 10_000;

/** Fixed cap on tracked in-flight calls + retained durations so a fan-out app
 *  can never grow this unbounded (guest-safety: bounded memory). */
const MAX_INFLIGHT = 512;
const MAX_DURATIONS = 500;

interface InFlight {
  start: number;
  /** Timer that promotes an unresolved call to a stall. Unref'd so it never
   *  keeps the host process alive. */
  stallTimer: ReturnType<typeof setTimeout> | null;
}

/** id → attempts started on that id and not yet resolved, OLDEST FIRST. `id` is
 *  any stable per-call handle liveDetectors can provide (undici exposes the
 *  request object; its identity is used as a key via a WeakMap-style numeric
 *  token). Never a URL.
 *
 *  A QUEUE, not one record: a client that retries a failing dependency reuses
 *  the same call handle, and holding one record per key made five attempts
 *  overwrite each other into one. Four attempts then had no record to resolve,
 *  so only the last outcome was ever bucketed — a five-failure burst reported
 *  as a single call. Retries are the exact fault this axis exists to catch, so
 *  each attempt gets its own record and its own stall timer. */
const inFlight = new Map<unknown, InFlight[]>();
/** Total records across every queue — what MAX_INFLIGHT bounds. */
let inFlightTotal = 0;

/** Ring of resolved-attempt durations (ms) used to derive p75 / worst. */
let durations: number[] = [];

/** The same resolved attempts with the instant each STARTED, which is what
 *  the start-up rule judges (settleRule.ts): an attempt begun inside the first
 *  minute pays the cold path (DNS, TLS, an empty pool) and never decides the
 *  verdict, and neither does the very first call. */
let timed: Array<{ t: number; v: number }> = [];

/** Attempts STARTED after the process settled, and their outcomes: the rates
 *  the verdict judges. The lifetime counters above stay as context. */
let settledAttempts = 0;
let settledCompleted = 0;
let settledFailed = 0;
let settledTimeouts = 0;
let settledStalls = 0;

const settledStart = (startMs: number): boolean => startMs >= settledFromMs("latencyTail");

/** Bank one resolved attempt's duration (every outcome that ENDED). */
function bank(dur: number, startMs: number): void {
  durations.push(dur);
  if (durations.length > MAX_DURATIONS) durations.shift();
  timed.push({ t: startMs, v: dur });
  if (timed.length > MAX_DURATIONS) timed.shift();
  if (dur > worstMs) worstMs = dur;
}

/** connectionSetup — how many NEW connections undici opened. A healthy
 *  keep-alive pool reuses sockets, so connects per completed call should be
 *  far below 1; a broken keep-alive reconnects on (nearly) every call. Count
 *  only — never a host/URL. */
let connectCount = 0;

let attemptCount = 0;
let completedCount = 0;
let failedCount = 0;
let timeoutCount = 0;
let stallCount = 0;
let worstMs = 0;

/** Starts refused because the caller could not say whose traffic it was.
 *  Zero on every ordinary path — the observer never offers an unattributed
 *  call — so this exists to make the refusal COUNTABLE rather than silent: a
 *  wrongly-wired second observation point shows up as a number a test can
 *  assert on, instead of a meter that quietly reads low. Never reported. */
let unattributedRefused = 0;

/** Refuse anything that did not come from `ownTraffic.attributeOutbound`.
 *  Returns true when the start may proceed. */
function refuseUnattributed(pass: unknown): boolean {
  if (isAppTraffic(pass)) return false;
  if (unattributedRefused < Number.MAX_SAFE_INTEGER) unattributedRefused++;
  return true;
}

/** Record the START of one outbound attempt, keyed by a per-call token. Safe to
 *  call on every request; a no-op under the kill-switch. Bounded — once
 *  MAX_INFLIGHT calls are tracked, extra starts are dropped (still counted as
 *  attempts so the rate stays honest).
 *
 *  `whose` is the caller's answer to "is this the app's traffic?" — see the
 *  file header. There is no overload without it: an observation point that
 *  cannot answer cannot start an attempt. */
export function recordAttemptStart(token: unknown, whose: AppTraffic): void {
  if (isBoosthisDisabled()) return;
  if (refuseUnattributed(whose)) return;
  attemptCount++;
  if (settledStart(Date.now())) settledAttempts++;
  if (inFlightTotal >= MAX_INFLIGHT) return;
  const rec: InFlight = { start: Date.now(), stallTimer: null };
  const timer = setTimeout(() => {
    // Never completed within the horizon → silent stall. Drop THIS record and
    // no other: with retries queued under one token, deleting by key alone
    // would let an abandoned attempt's timer resolve a later, live one.
    if (drop(token, rec)) {
      stallCount++;
      if (settledStart(rec.start)) settledStalls++;
    }
  }, NETWORK_STALL_MS);
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }
  rec.stallTimer = timer;
  const q = inFlight.get(token);
  if (q) q.push(rec);
  else inFlight.set(token, [rec]);
  inFlightTotal++;
}

/* ── Waits declared on purpose (docs/held-open-calls.md) ────────────────────
 *
 * A call the developer declared as waiting on purpose — a bot long-polling its
 * messaging service — is NEVER put on the stall clock: no timer is armed for
 * it, however long it waits, so it can never be filed as a silent stall. Nor
 * is it timed: an answer is counted as kept out (declaredWaits.ts sends the
 * count and the longest wait), never as an attempt, a completion or a
 * duration, so every reading here reads exactly as it would without it. A
 * FAILURE is still a failure — counted as an attempt that failed or timed out,
 * with no duration, because its duration is the wait it was declared for.
 *
 * Keyed weakly by undici's own per-call request object, so a declared call
 * that never ends is collected with it: nothing to bound, no timer to leak. */

interface DeclaredInFlight {
  start: number;
  match: DeclaredCallMatch;
}

let declaredInFlight = new WeakMap<object, DeclaredInFlight[]>();

/** Record the START of a call that matched a declared name. Same pass as
 *  {@link recordAttemptStart}: an observation point that cannot say whose call
 *  it is cannot start one. Counts nothing yet. */
export function recordDeclaredAttemptStart(
  token: unknown,
  whose: AppTraffic,
  match: DeclaredCallMatch,
): void {
  if (isBoosthisDisabled()) return;
  if (refuseUnattributed(whose)) return;
  if (typeof token !== "object" || token === null) return;
  const rec: DeclaredInFlight = { start: Date.now(), match };
  const q = declaredInFlight.get(token);
  if (q) q.push(rec);
  else declaredInFlight.set(token, [rec]);
}

/** Resolve the oldest declared call on this token, if it is one. */
function resolveDeclared(token: unknown): DeclaredInFlight | null {
  if (typeof token !== "object" || token === null) return null;
  const q = declaredInFlight.get(token);
  const rec = q?.shift();
  if (!rec) return null;
  if (q!.length === 0) declaredInFlight.delete(token);
  return rec;
}

/** Remove one SPECIFIC record from its queue (identity, not key). Returns
 *  whether it was still there — a record is only ever resolved once. */
function drop(token: unknown, rec: InFlight): boolean {
  const q = inFlight.get(token);
  if (!q) return false;
  const i = q.indexOf(rec);
  if (i < 0) return false;
  q.splice(i, 1);
  inFlightTotal--;
  if (q.length === 0) inFlight.delete(token);
  if (rec.stallTimer) clearTimeout(rec.stallTimer);
  return true;
}

/** Resolve the OLDEST unresolved attempt on this token. Sequential retries
 *  finish in the order they started, so oldest-first pairs each end signal
 *  with the attempt that produced it. */
function resolve(token: unknown): { dur: number; start: number } | null {
  const q = inFlight.get(token);
  const rec = q?.[0];
  if (!rec) return null;
  drop(token, rec);
  const dur = Date.now() - rec.start;
  return { dur: dur >= 0 ? dur : 0, start: rec.start };
}

/* THE RESOLVING HALF TAKES NO PASS, AND THAT IS THE WHOLE POINT OF SCREENING
 * THE STARTS. Completing, erroring, discarding, establishing and failing do
 * not create anything: each of them finds a record a screened start already
 * put there, or finds nothing and returns. A call that never earned a start
 * has nothing here to resolve, so an unattributed end signal cannot add a
 * count however it arrives — which is also why the observer can hand every
 * end signal straight through without re-asking whose call it was. */

/** Record that an attempt COMPLETED (any HTTP status — a loud, finished
 *  response). No-op under the kill-switch or for an unknown token. */
export function recordAttemptComplete(token: unknown): void {
  if (isBoosthisDisabled()) return;
  const done = resolve(token);
  if (done === null) {
    // A declared wait that ended with an answer: kept out, and counted.
    const declared = resolveDeclared(token);
    if (declared !== null) {
      noteDeclaredCallExcluded(declared.match, Math.max(0, Date.now() - declared.start));
    }
    return;
  }
  completedCount++;
  if (settledStart(done.start)) settledCompleted++;
  bank(done.dur, done.start);
}

/** Record that an attempt ERRORED. `timeout` marks the timeout-class errors so
 *  they feed the silent-drop stall rate; other errors are LOUD failures, which
 *  stay OUT of that rate. No-op under the kill-switch / unknown token.
 *
 *  A failed attempt banks its duration, exactly like a completed one. It had a
 *  start and an end and it cost the app the time in between; discarding it made
 *  a call that failed five times and then worked report ONE measurement — the
 *  success, in isolation, with nothing to show what getting there cost. Every
 *  sibling kit that takes a duration (RN, Go, Java, Kotlin, Swift, Flutter,
 *  Rust, Ruby, PHP, .NET) banks it whatever the outcome; so does the
 *  cross-runtime parity harness. Only a silent stall has no duration to bank,
 *  because it never ended at all. */
export function recordAttemptError(token: unknown, timeout = false): void {
  if (isBoosthisDisabled()) return;
  const done = resolve(token);
  if (done === null) {
    // A declared wait that FAILED is a failure like any other — counted as an
    // attempt that failed or timed out — but never timed: its duration is the
    // wait it was declared for, and banking it would put the long-poll back
    // into the very p75 the declaration keeps it out of.
    const declared = resolveDeclared(token);
    if (declared === null) return;
    attemptCount++;
    if (timeout) timeoutCount++;
    else failedCount++;
    if (settledStart(declared.start)) {
      settledAttempts++;
      if (timeout) settledTimeouts++;
      else settledFailed++;
    }
    return;
  }
  if (timeout) timeoutCount++;
  else failedCount++;
  if (settledStart(done.start)) {
    if (timeout) settledTimeouts++;
    else settledFailed++;
  }
  bank(done.dur, done.start);
}

/** Stop tracking an attempt WITHOUT bucketing an outcome, undoing its start.
 *
 *  The completion side of the own-upload exclusion. The observer refuses a call
 *  to Boosthis's own endpoint before any counter runs, so on the ordinary path
 *  no record was ever started and this is a no-op. It exists for the one
 *  ordering that would otherwise be dishonest: an attempt that began before the
 *  endpoint was registered as ours and ended after it was. Its record would
 *  otherwise sit in flight until the stall horizon and bank as a silent drop —
 *  a stall the app never suffered, on traffic that was never the app's. The
 *  attempt is un-counted with it, because it should never have been counted.
 *  No-op under the kill-switch or for an unknown token. */
export function discardAttempt(token: unknown): void {
  if (isBoosthisDisabled()) return;
  const q = inFlight.get(token);
  const rec = q?.[0];
  if (!rec) {
    // A declared call counted nothing at its start, so there is nothing to undo.
    resolveDeclared(token);
    return;
  }
  if (drop(token, rec) && attemptCount > 0) {
    attemptCount--;
    if (settledStart(rec.start) && settledAttempts > 0) settledAttempts--;
  }
}

/** Record that undici opened one NEW connection (fed from the same
 *  diagnostics_channel observation point — `undici:client:connected`). No-op
 *  under the kill-switch.
 *
 *  Counts only connections the APP opened: the caller answers whose connection
 *  it was from the same connect event the dependency-distance reading is
 *  paired from, so the two can never disagree about it, and hands that answer
 *  over as `whose`. */
export function recordConnectionOpened(whose: AppTraffic): void {
  if (isBoosthisDisabled()) return;
  if (refuseUnattributed(whose)) return;
  connectCount++;
}

/** Label-free aggregate for the connectionSetup axis: new connections opened
 *  vs completed outbound calls (keep-alive health). */
export interface ConnectionSetupStatsLike {
  connectCount: number;
  completedCount: number;
}

export function getConnectionSetupStats(): ConnectionSetupStatsLike {
  return { connectCount, completedCount };
}

/** connectionSetup — % of completed outbound calls that opened a NEW
 *  connection. Reported, never graded (the shared decision,
 *  docs/settle-rule-decisions.md): the share of calls that open a connection
 *  is not what setting one up COSTS — an app calling a service every thirty
 *  seconds opens a fresh connection on every call because keep-alive expired,
 *  and pays a few milliseconds for it. The same wire shape as every kit that
 *  carries the meter: `reconnectPct` and its counts ride. Warm-up: >=20
 *  completed calls. Env-dependent (needs outbound traffic) so it is NOT an
 *  expected axis. */
const MIN_CONNECT_CALLS = 20;

export interface ConnectionSetupAxis {
  score: null;
  rating: "not-scored";
  reconnectPct: number;
  connectCount: number;
  attemptCount: number;
}

/** Connection-setup (keep-alive health) axis, or null while warming. */
export function readConnectionSetup(): ConnectionSetupAxis | null {
  if (isBoosthisDisabled()) return null;
  try {
    if (completedCount < MIN_CONNECT_CALLS) return null;
    const reconnectPct =
      Math.round((100 * Math.min(connectCount, completedCount) * 10) / completedCount) / 10;
    return {
      score: null,
      rating: "not-scored",
      reconnectPct,
      connectCount,
      attemptCount: completedCount,
    };
  } catch {
    return null;
  }
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(s.length - 1, Math.ceil(q * s.length) - 1));
  return s[idx];
}

/** Read the current label-free network aggregate for the `network` axis.
 *  `attemptCount` counts every started call; `completedCount` those that
 *  finished; the p75 / worst are over every attempt that RESOLVED — a failure
 *  and a timeout cost the app their duration just as a success does, and a
 *  retried call's real cost is all of its attempts, not the last one alone.
 *  Only a silent stall contributes no duration: it never ended. */
export function getNetworkStats(): NetworkStatsLike {
  return getNetworkStatsLifetime();
}

/**
 * The aggregate the `network` VERDICT judges (settleRule.ts, family
 * latencyTail): attempts started after the process settled, the p75 of their
 * durations without the very first call, and `judged` — how many durations
 * that p75 rests on. Below the family's floor (20) `p75Ms` is null and the
 * verdict waits: a p75 of three attempts was one cold call. `worstMs` stays
 * the lifetime figure, context only.
 */
export function getSettledNetworkStats(): Omit<NetworkStatsLike, "p75Ms"> & {
  judged: number;
  p75Ms: number | null;
} {
  const tail = settledTail(timed, 75);
  return {
    attemptCount: settledAttempts,
    completedCount: settledCompleted,
    failedCount: settledFailed,
    timeoutCount: settledTimeouts,
    stallCount: settledStalls,
    p75Ms: tail ? tail.value : null,
    worstMs,
    judged: tail ? tail.n : 0,
  };
}

/** The settled floor the network verdict needs. */
export const NETWORK_SETTLED_FLOOR = SETTLE_FAMILIES.latencyTail.minSamples;

function getNetworkStatsLifetime(): NetworkStatsLike {
  return {
    attemptCount,
    completedCount,
    failedCount,
    timeoutCount,
    stallCount,
    p75Ms: percentile(durations, 0.75),
    worstMs,
  };
}

/* ─── Dependency distance: how long a NEW connection takes to OPEN ───────
 *
 * Distance is judged on connection SETUP only — the time between "start
 * opening a connection" and "the connection is open and secured", before a
 * single byte of the request is sent. A round trip would fold in however long
 * the service spent thinking, and a slow service would then be reported as a
 * distant one; that is the mistake this axis exists to avoid.
 *
 * What is kept: a dependency KIND code and a duration. The pairing key (host
 * and port) lives in this process for the length of one handshake and is never
 * read by anything that reports.
 */

/** Cap on handshakes waiting to be paired, and on retained setup samples per
 *  kind — a fan-out app can never grow these unbounded. */
const MAX_PENDING_CONNECTS = 64;
const MAX_SETUPS_PER_KIND = 200;
/** A handshake still unpaired after this long is abandoned, not counted. */
const PENDING_CONNECT_TTL_MS = 60_000;

interface PendingConnect {
  at: number;
  kind: number;
}

/** pairing key ("host|port") → handshakes started and not yet resolved, oldest
 *  first. Cleared as soon as each one is answered. */
const pendingConnects = new Map<string, PendingConnect[]>();
let pendingConnectTotal = 0;
/** kind code → setup durations (ms) of NEWLY OPENED connections. */
const setupsByKind = new Map<number, number[]>();
let newConnectionsTimed = 0;
let settlingConnects = 0;

/** New connections whose setup the start-up rule set aside (the boot pool
 *  fill). */
export function dependencyDistanceSettlingConnects(): number {
  return settlingConnects;
}

function nowMs(): number {
  const p = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof p?.now === "function" ? p.now() : Date.now();
}

function takePending(key: string): PendingConnect | null {
  const q = pendingConnects.get(key);
  if (!q || q.length === 0) return null;
  const rec = q.shift()!;
  pendingConnectTotal--;
  if (q.length === 0) pendingConnects.delete(key);
  return rec;
}

/** Record that a connection attempt has BEGUN. This is the signal the kit was
 *  missing: without it only the moment a connection became ready is known, and
 *  the setup itself cannot be measured. `key` pairs the two events inside this
 *  process; `kind` is a closed dependency code; `whose` is the caller's answer
 *  to "is this the app's traffic?" (see the file header). No-op under the
 *  kill-switch. */
export function recordConnectStart(
  key: string,
  kind: number,
  whose: AppTraffic,
): void {
  if (isBoosthisDisabled()) return;
  if (refuseUnattributed(whose)) return;
  if (!key || !Number.isFinite(kind) || kind <= 0) return;
  const at = nowMs();
  // Drop anything that was never answered before making room for a new one.
  if (pendingConnectTotal >= MAX_PENDING_CONNECTS) {
    for (const [k, q] of pendingConnects) {
      while (q.length > 0 && at - q[0]!.at > PENDING_CONNECT_TTL_MS) {
        q.shift();
        pendingConnectTotal--;
      }
      if (q.length === 0) pendingConnects.delete(k);
    }
    if (pendingConnectTotal >= MAX_PENDING_CONNECTS) return;
  }
  const q = pendingConnects.get(key);
  if (q) q.push({ at, kind });
  else pendingConnects.set(key, [{ at, kind }]);
  pendingConnectTotal++;
}

/** Record that a connection is now OPEN and secured. Pairs with the matching
 *  start and banks the setup time against its kind. */
export function recordConnectEstablished(key: string): void {
  if (isBoosthisDisabled()) return;
  const rec = takePending(key);
  if (!rec) return;
  const dur = nowMs() - rec.at;
  if (!(dur >= 0) || dur > PENDING_CONNECT_TTL_MS) return;
  // Counted whatever the clock says: the connection count and this reading
  // answer "how many connections did the app open" from the same event pair.
  newConnectionsTimed++;
  // The start-up rule's guard (settleRule.ts): the pool filling at boot is
  // not the distance to the service. Its setups are counted apart and never
  // enter a median.
  if (Date.now() < settledFromMs("latencyTail")) {
    settlingConnects++;
    return;
  }
  const list = setupsByKind.get(rec.kind);
  if (list) {
    list.push(dur);
    if (list.length > MAX_SETUPS_PER_KIND) list.shift();
  } else {
    setupsByKind.set(rec.kind, [dur]);
  }
}

/** Record that a connection attempt FAILED. A handshake that never completed
 *  is not a distance reading — it is discarded, never counted as fast. */
export function recordConnectFailed(key: string): void {
  if (isBoosthisDisabled()) return;
  takePending(key);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Label-free per-kind setup aggregate for the dependencyDistance axis. */
export function getDependencyDistanceStats(): {
  kinds: DependencyDistanceKindStat[];
  newConnections: number;
} {
  const kinds: DependencyDistanceKindStat[] = [];
  for (const [kind, list] of setupsByKind) {
    if (list.length === 0) continue;
    kinds.push({ kind, connections: list.length, setupMs: median(list) });
  }
  return { kinds, newConnections: newConnectionsTimed };
}

/** Wipe all sampler state (wired into `telemetry.forget()` so nothing
 *  Boosthis-shaped keeps counting after erasure). Idempotent. */
export function clearNetworkSampler(): void {
  for (const q of inFlight.values()) {
    for (const rec of q) {
      if (rec.stallTimer) clearTimeout(rec.stallTimer);
    }
  }
  inFlight.clear();
  inFlightTotal = 0;
  declaredInFlight = new WeakMap();
  durations = [];
  timed = [];
  settledAttempts = 0;
  settledCompleted = 0;
  settledFailed = 0;
  settledTimeouts = 0;
  settledStalls = 0;
  attemptCount = 0;
  completedCount = 0;
  failedCount = 0;
  timeoutCount = 0;
  stallCount = 0;
  worstMs = 0;
  connectCount = 0;
  pendingConnects.clear();
  pendingConnectTotal = 0;
  setupsByKind.clear();
  newConnectionsTimed = 0;
  settlingConnects = 0;
  unattributedRefused = 0;
}

/** @internal test hook. */
export const _networkSamplerInternals = {
  NETWORK_STALL_MS,
  reset(): void {
    clearNetworkSampler();
  },
  /** Attempts tracked in flight — records, NOT keys: retries queued under one
   *  token are several attempts and must read as several. */
  get inFlightSize(): number {
    return inFlightTotal;
  },
  /** Inject synthetic opened connections (connectionSetup tests). */
  recordSyntheticConnects(n: number): void {
    connectCount += n;
  },
  /** Inject synthetic NEW-connection setup times for one dependency kind, so
   *  the distance axis can be tested without a live handshake. */
  recordSyntheticSetups(kind: number, ...durationsMs: number[]): void {
    for (const d of durationsMs) {
      const list = setupsByKind.get(kind);
      if (list) {
        list.push(d);
        if (list.length > MAX_SETUPS_PER_KIND) list.shift();
      } else {
        setupsByKind.set(kind, [d]);
      }
      newConnectionsTimed++;
    }
  },
  get pendingConnectCount(): number {
    return pendingConnectTotal;
  },
  /** Starts refused for not saying whose traffic they were. Above zero means a
   *  caller is feeding this sampler without asking `ownTraffic`. */
  get unattributedRefused(): number {
    return unattributedRefused;
  },
  /** Inject a fully-resolved synthetic attempt (hermetic tests without a live
   *  undici round-trip). `outcome`: completed | failed | timeout | stall. */
  recordSyntheticAttempt(
    outcome: "completed" | "failed" | "timeout" | "stall",
    durationMs = 0,
    startMs: number = Date.now(),
  ): void {
    attemptCount++;
    if (outcome === "completed") completedCount++;
    else if (outcome === "failed") failedCount++;
    else if (outcome === "timeout") timeoutCount++;
    else stallCount++;
    if (settledStart(startMs)) {
      settledAttempts++;
      if (outcome === "completed") settledCompleted++;
      else if (outcome === "failed") settledFailed++;
      else if (outcome === "timeout") settledTimeouts++;
      else settledStalls++;
    }
    // Every outcome that ENDED banks its duration, exactly as the live path
    // does. A stall never ended, so it has none.
    if (outcome !== "stall") bank(durationMs, startMs);
  },
};
