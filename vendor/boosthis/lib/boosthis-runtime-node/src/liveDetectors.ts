/* ─── Boosthis: live cross-cutting detectors (Node) ──────────────────────
 *
 * Two always-on, observe-only detectors that surface performance anti-patterns
 * the per-route timer cannot see, emitted as ordinary {@link CrossCuttingFinding}s
 * so they ride the EXISTING candidate-rule + snapshot pipeline (no new server
 * route, no new table):
 *
 *   • retry-storm — the same outbound host is hammered many times in a short
 *     window with no backoff (a classic thundering-herd / missing-retry-budget
 *     bug). Fed automatically from undici/global-`fetch` via `diagnostics_channel`
 *     ("undici:request:create") and/or explicitly via {@link recordOutboundAttempt}.
 *
 *   • idle-burn — the event loop keeps burning CPU while NO request is in
 *     flight (a stranded timer / busy-poll leak). Measured only at request
 *     boundaries via `performance.eventLoopUtilization()` — there is NO
 *     background poller (Boosthis's own rule book forbids idle spinners), so
 *     the idle-burn detector never itself burns idle.
 *
 * PRIVACY (identical to every other finding):
 *   - The `name` we keep is a bare outbound HOSTNAME (retry-storm) or a fixed
 *     non-route label (idle-burn). It never carries a path, query, userinfo, or
 *     port, and it is PII-filtered again in telemetry.ts before any upload.
 *   - `signatureFor` drops `name` entirely, so the candidate-rule fingerprint is
 *     kind + severity bucket + count bucket only — never a host, value, or code.
 *   - `p95`/`count` are honest measurements (burst span in ms + attempt count;
 *     loop-active ms during an idle window + occurrence count), NOT synthetic
 *     severity numbers, so the meter page never shows a fabricated latency.
 *   - Everything is in-memory only. Nothing leaves the process here — findings
 *     only travel through the already-gated snapshot/candidate pipeline, which
 *     is off for unregistered installs and silenced entirely by
 *     `BOOSTHIS_DISABLED`.
 *
 * Node↔Python parity: the wire OUTPUT (finding kind + field shape) is
 * byte-identical to `lib/boosthis-py/boosthis/live_detectors.py`; only the
 * runtime-specific plumbing to FEED the detectors differs (diagnostics_channel
 * + ELU here, explicit API + process_time there), exactly as the runtimes
 * already differ elsewhere.
 */

import { performance as perfHooks } from "node:perf_hooks";
import {
  subscribe as dcSubscribe,
  unsubscribe as dcUnsubscribe,
} from "node:diagnostics_channel";
import type { CrossCuttingFinding } from "./candidateRules";
import { collectLiveConnectionFindings } from "./liveConnections";
import { isBoosthisDisabled } from "./runtimeFlags";
import { isKitLocked } from "./killSwitch";
import { clearEdgeCache, noteEdgeCacheHeaders } from "./edgeCache";
import {
  clearCacheDirectives,
  collectCacheDirectiveFindings,
} from "./cacheDirectives";
import { noteIdleStart, noteIdleEnd, clearServerMeters } from "./serverMeters";
import { clearHeldOpen } from "./heldOpen";
import { clearDeclaredWaitCounts, matchDeclaredCall } from "./declaredWaits";
import {
  noteOutboundStart,
  noteOutboundEnd,
  clearRepeatedWork,
  currentRequestScope,
} from "./repeatedWork";
import {
  clearDbWork,
  isHostedDatabaseCall,
  noteHostedDbEnd,
  noteHostedDbStart,
} from "./dbWork";
import { aiProviderCode } from "./aiProviders";
import { dependencyFor } from "./dependencyKinds";
import type { CauseDestination } from "./problemCause";
import {
  noteDependencyStart,
  noteDependencyEnd,
  outcomeForStatus,
  clearDependencyWork,
} from "./dependencyWork";
import { clearFailureContainment } from "./failureContainment";
import { clearJobWork } from "./jobWork";
import { unpatchJobSystems } from "./jobAdapters";
import {
  noteSuspendActivity,
  noteSuspendIdleStart,
  clearSuspendSensor,
} from "./suspendSensor";
import {
  recordAttemptStart,
  recordDeclaredAttemptStart,
  recordAttemptComplete,
  recordAttemptError,
  discardAttempt,
  recordConnectionOpened,
  recordConnectStart,
  recordConnectEstablished,
  recordConnectFailed,
  clearNetworkSampler,
} from "./networkSampler";
import { dependencyKindForHost } from "./depKinds";
import {
  type AppTraffic,
  attributeOutbound,
  attributeOutboundRequest,
  hostOf,
  ignoreHost,
  isOwnUploadHost,
  _ownTrafficInternals,
} from "./ownTraffic";
import { ELAPSED_HEADER, TRACE_HEADER, forwardTraceHeaders } from "./trace";
import { PARENT_HEADER } from "./spanScope";
import { servedHostOf, shouldPropagateTo } from "./tracePropagation";

/* ── Tunables ──────────────────────────────────────────────────────────── */

/** Rolling window for counting outbound attempts to one host. */
const RETRY_WINDOW_MS = 10_000;
/** Attempts to one host within the window before it counts as a storm. */
const RETRY_STORM_THRESHOLD = 5;
/** Median inter-attempt gap at/above which we assume real backoff exists (so
 *  it is NOT a storm — a well-behaved client spaces retries out). */
const RETRY_BACKOFF_MS = 1_000;
/** Cap distinct tracked hosts so a fan-out app can't grow this unbounded. */
const MAX_TRACKED_HOSTS = 200;

/** Fan-out cluster window (ms): many DISTINCT hosts contacted this close
 *  together look like a thundering-herd burst (e.g. a cache miss firing a wave
 *  of parallel downstream calls). Distinct from retry-storm (ONE host, many
 *  hits) — here the signal is BREADTH, not depth. */
const CLUSTER_WINDOW_MS = 50;
/** Distinct hosts within CLUSTER_WINDOW_MS at/above which we flag a fan-out. */
const CLUSTER_HOST_THRESHOLD = 3;

/** Only windows in which NO request was in flight for at least this long count
 *  as a genuine idle gap (below this, brief lulls between bursts are ignored). */
const IDLE_GAP_MS = 3_000;
/** Loop-active time during an idle gap at/above which we flag idle-burn. */
const IDLE_ACTIVE_MS = 1_000;
/** Utilization during the idle gap at/above which we flag idle-burn. */
const IDLE_UTIL_THRESHOLD = 0.5;

/* ── Retry-storm state ─────────────────────────────────────────────────── */

/** host → ascending attempt timestamps (ms), trimmed to the rolling window. */
interface OutboundAttempt {
  at: number;
  destination: { to: CauseDestination; service?: string };
}
const attemptsByHost = new Map<string, OutboundAttempt[]>();

/** Session-peak same-host attempt count observed inside the rolling window
 *  while NO backoff was present — the anonymous "how hard did the worst retry
 *  storm hammer one destination" number mirrored to the snapshot as
 *  `events.retryBurstMax10s`. A bare count only — never a host or URL. */
let retryBurstPeak = 0;

/** Outbound attempts observed since this process started, whether the rolling
 *  retry window still holds them or not. Read only as READ-BACK EVIDENCE that
 *  outbound observation is really attached in this app (see
 *  `coverageInventory.ts`): "we armed it" is a claim, "we have seen a call
 *  through it" is a fact. A count and nothing else. */
let outboundAttemptsSeen = 0;
/* Whose outbound call this is — the registered own-upload hosts, the screen
 * over them, and the pass the network sampler demands — lives in
 * `ownTraffic.ts`, deliberately OUTSIDE the state `clearDetectors()` wipes.
 * Forgetting the kit does not stop the kit's own traffic (forget() posts to
 * our endpoint after the wipe, uploads already dispatched still land, and the
 * observer re-arms on the host's next request), so an exclusion that erasure
 * emptied let our own calls count as the app's in a window nobody can see.
 * Re-exported here because this module is where the rest of the kit has always
 * reached for them. */
export { hostOf, ignoreHost };

/** The three headers a hop forwards, in the order the builder emits them.
 *  Named here so the loop below can never invent a fourth: the propagation
 *  contract is "the existing trace headers", not "whatever the builder
 *  returns". A header added to `forwardTraceHeaders` for some other purpose
 *  must be added to this list deliberately, by someone who has decided it may
 *  cross a service boundary. */
const PROPAGATED_HEADERS: readonly string[] = [
  TRACE_HEADER,
  ELAPSED_HEADER,
  PARENT_HEADER,
];

/** True if `headers` already carries ANY of the three propagated headers,
 *  whatever shape undici is holding them in — a flat `[name, value, …]` array
 *  in current versions, a raw string block in older ones, a plain object in a
 *  shim. An unrecognised shape reads as "already there", because the safe
 *  answer to "might the host have set this themselves?" is yes.
 *
 *  ANY of the three, not just the trace id. `addHeader` APPENDS, so a caller
 *  who set the parent or the elapsed header by hand — forwarding a trace from
 *  somewhere the kit cannot see, or correcting one — would otherwise get a
 *  second value for that header on the wire. A two-value parent header is not
 *  a correction; it is a header the next service has to guess about, and its
 *  adoption of the parent and the offset is exactly what this whole change
 *  exists to make reliable. One hand-set header means the caller owns the
 *  trace on this call and the kit stays out of it entirely. */
function carriesAnyTraceHeader(headers: unknown): boolean {
  if (headers === undefined || headers === null) return false;
  const isOurs = (name: string): boolean => {
    const lower = name.toLowerCase();
    return PROPAGATED_HEADERS.includes(lower);
  };
  if (Array.isArray(headers)) {
    for (let i = 0; i < headers.length; i += 2) {
      if (isOurs(String(headers[i]))) return true;
    }
    return false;
  }
  if (typeof headers === "string") {
    const lower = headers.toLowerCase();
    return PROPAGATED_HEADERS.some((name) => lower.includes(name));
  }
  if (typeof headers === "object") {
    for (const key of Object.keys(headers as object)) {
      if (isOurs(key)) return true;
    }
    return false;
  }
  return true;
}

/**
 * FORWARD THIS HOP'S TRACE TO THE NEXT SERVICE.
 *
 * The kit is already standing inside the host's outgoing call to measure it.
 * Attaching the trace headers here is what makes a two-service install produce
 * ONE trace instead of two, with nothing wired by hand at any call site.
 *
 * Four refusals, in the order they are cheapest to decide:
 *
 *   1. A client that gives us no way to add a header. Nothing to do.
 *   2. Boosthis's own upload endpoint. Our flushes are not the customer's next
 *      hop, and tagging them would put a customer's trace id on our own wire
 *      for no reason at all.
 *   3. No trace to forward: this call was not made inside a request the
 *      middleware handled, so there is no hop for the next service to be a
 *      child of. A minted one would name a caller that does not exist.
 *   4. A destination the customer's configuration does not permit — which, by
 *      default, is every destination that is neither internal nor on the same
 *      site as the request being served. See `tracePropagation.ts` for the
 *      rule and why the default is what it is, and `destinationHostOf` below
 *      for WHICH host that rule is asked about. It is not always the one the
 *      socket is open to. The request in hand is read before this one because
 *      its own Host is what the same-site half judges against.
 *
 * And one deference: a host who set ANY of the three headers themselves keeps
 * all three. They may be forwarding a trace from somewhere the kit cannot see,
 * and undici's `addHeader` APPENDS rather than replaces, so a second copy would
 * reach the destination as a two-value header rather than a correction.
 *
 * CANNOT BREAK THE CALL, AND CANNOT HALF-CHANGE IT. Every value is built and
 * checked BEFORE the first one is attached, so the loop runs only over
 * validated strings — but `addHeader` is the host object's own method and
 * pre-validation makes a throw unlikely, not impossible. A throw on the second
 * write would otherwise put the request on the wire carrying part of the set,
 * so the accumulated header block is snapshotted first and put back if the
 * loop does not finish. Whatever happens, the request that is sent is either
 * exactly what the host built or exactly that plus the whole set, and nothing
 * surfaces: at worst the trace stops at this service, as it always used to.
 */
/** WHERE THIS REQUEST IS REALLY GOING, as the propagation rule must judge it.
 *
 * `origin` is the host the CONNECTION is open to, and through a plain-HTTP
 * forward proxy that is the proxy — usually loopback, usually permitted —
 * while the request itself is on its way to a company nothing has judged.
 * undici puts the real recipient in `path`, as an absolute-form request
 * target (`http://api.provider.com/pay` rather than `/pay`), and that is the
 * only place on the request where it appears. Judging `origin` alone let the
 * default rule pass a header to exactly the destination it exists to refuse.
 *
 * A CONNECT tunnel needs nothing extra here: undici opens the tunnel beneath a
 * Client whose origin IS the far-side service, so `origin` already names the
 * recipient. Python's stdlib client differs — its connection keeps the proxy
 * as its host for the tunnel's whole life — which is why `_destination_host`
 * over there has a third case this one does not need.
 *
 * Both readings go through `hostOf`, which for a string beginning `http://`
 * or `https://` uses the URL parser. That matters for IPv6: a hand-rolled
 * "drop the port by splitting on the colon" turns `2001:4860:4860::8888` into
 * the single-label name `2001`, and single-label names are internal by
 * default — one helper would open every public IPv6 address there is.
 *
 * Never throws. A target it cannot read is `""`, which attaches nothing.
 */
function destinationHostOf(req: { origin?: unknown; path?: unknown }): string {
  try {
    const target = req.path;
    if (typeof target === "string" && /^https?:\/\//i.test(target)) {
      const proxied = hostOf(target);
      if (proxied) return proxied;
    }
    return hostOf(req.origin);
  } catch {
    return "";
  }
}
/** Record one outbound attempt to `target`. Safe to call on every request; a
 *  no-op under the kill-switch. Exposed for apps whose HTTP client Boosthis
 *  cannot auto-observe (axios, node-fetch, gRPC, DB drivers, …).
 *
 *  This counts attempts PER HOST for the retry-storm detector. It is not the
 *  same tally as the network sampler's `attemptCount`, which counts attempts it
 *  can TIME. Where both are fed from the undici observer below they agree
 *  attempt-for-attempt, retries included. They part company in two places, both
 *  deliberate: an attempt an app reports by hand arrives here only, because it
 *  carries no end signal for the sampler to time it against; and this detector
 *  drops attempts past MAX_TRACKED_HOSTS, which the sampler does not. So this
 *  side sees MORE attempts, never fewer. Neither of them counts a call to
 *  Boosthis's own endpoint: the observer drops those before either is reached
 *  (see {@link isOwnUploadHost}), and a caller reaching this function directly
 *  is refused on the next line. See the header of networkSampler.ts for the
 *  sampler's half of the same statement. */
export function recordOutboundAttempt(target: unknown, path?: unknown): void {
  if (isBoosthisDisabled() || isKitLocked()) return;
  ensureArmed();
  const host = hostOf(target);
  if (!host || isOwnUploadHost(host)) return;
  // Read-back evidence that this app's outbound calls really reach the
  // observer. Bounded on purpose: the coverage inventory only ever asks
  // whether it is above zero.
  if (outboundAttemptsSeen < Number.MAX_SAFE_INTEGER) outboundAttemptsSeen++;
  const now = Date.now();
  let arr = attemptsByHost.get(host);
  if (!arr) {
    if (attemptsByHost.size >= MAX_TRACKED_HOSTS) return; // bounded
    arr = [];
    attemptsByHost.set(host, arr);
  }
  const recognised = dependencyFor(host);
  const destination: OutboundAttempt["destination"] =
    isHostedDatabaseCall(host, path) ? { to: "database" } :
    aiProviderCode(host) > 0 ? { to: "ai" } :
    recognised.service ? { service: recognised.service, to: recognised.kind } : { to: recognised.kind };
  arr.push({ at: now, destination });
  if (arr.length > 10_000) arr.shift();
  // Trim to the rolling window so memory stays bounded per host.
  const cutoff = now - RETRY_WINDOW_MS;
  while (arr.length > 0 && arr[0].at < cutoff) arr.shift();
  // Update the session-peak burst counter (anonymous number for the snapshot's
  // `events.retryBurstMax10s`): only qualifying storms count — enough attempts
  // in the window AND no real backoff between them.
  if (
    arr.length >= RETRY_STORM_THRESHOLD &&
    medianGap(arr.map(a => a.at)) < RETRY_BACKOFF_MS &&
    arr.length > retryBurstPeak
  ) {
    retryBurstPeak = arr.length;
  }
}

/** Session-peak same-destination retry-burst strength (attempts inside one
 *  rolling window with no backoff). 0 when no storm was observed. Read by the
 *  snapshot builder — ships as the anonymous `events.retryBurstMax10s` number
 *  (count only, never a host/URL), mirroring the web kit's
 *  `events.requestBurstMax1s` posture. */
export function peakRetryBurst(): number {
  return isBoosthisDisabled() ? 0 : retryBurstPeak;
}

/** Have this app's outbound calls actually been seen by the observer?
 *
 *  Read-back evidence, not a claim: arming subscribes to a channel, and a
 *  channel nothing publishes on looks exactly like an app that makes no calls.
 *  Only a call that arrived here says the surface is really watched. */
export function outboundAttemptsObserved(): number {
  return isBoosthisDisabled() ? 0 : outboundAttemptsSeen;
}
/** Median of an ascending numeric array (0 for <2 elements). */
function medianGap(sortedTimestamps: number[]): number {
  if (sortedTimestamps.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < sortedTimestamps.length; i++) {
    gaps.push(sortedTimestamps[i] - sortedTimestamps[i - 1]);
  }
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid];
}

function collectRetryStorms(): CrossCuttingFinding[] {
  const out: CrossCuttingFinding[] = [];
  const now = Date.now();
  const cutoff = now - RETRY_WINDOW_MS;
  for (const [host, arr] of attemptsByHost) {
    while (arr.length > 0 && arr[0].at < cutoff) arr.shift();
    if (arr.length < RETRY_STORM_THRESHOLD) continue;
    if (medianGap(arr.map(a => a.at)) >= RETRY_BACKOFF_MS) continue; // backoff present → fine
    // Honest measurements: the burst span (first→last attempt, ms) and the
    // number of attempts in the window. NOT a fabricated latency.
    const spanMs = arr[arr.length - 1].at - arr[0].at;
    out.push({
      kind: "retry-storm",
      name: host,
      p95: spanMs,
      count: arr.length,
      cause: { readAt: now, retry: { ...arr[arr.length - 1].destination, attempts: arr.length, spanMs } },
      hint: "The same outbound host was retried many times with no backoff.",
    });
  }
  return out;
}

/** Detect an outbound fan-out burst: many DISTINCT hosts all contacted within a
 *  very short window (a thundering-herd — e.g. one cache miss firing a wave of
 *  parallel downstream calls). Derived from the SAME `attemptsByHost` buffer as
 *  retry-storm, so it adds NO new collection. Honest measurements: the burst
 *  span (ms across the widest cluster) and the distinct-host count. Reuses the
 *  server-allowlisted `api-thundering-herd` finding kind.
 *
 *  Algorithm (byte-identical to the Python sibling): flatten every in-window
 *  (ts, host) pair, sort by ts, then slide a CLUSTER_WINDOW_MS window and track
 *  the largest set of DISTINCT hosts co-occurring inside it. */
function collectConcurrentClusters(): CrossCuttingFinding[] {
  const now = Date.now();
  const cutoff = now - RETRY_WINDOW_MS;
  const events: { ts: number; host: string; to: CauseDestination }[] = [];
  for (const [host, arr] of attemptsByHost) {
    for (const attempt of arr) {
      if (attempt.at >= cutoff) events.push({ ts: attempt.at, host, to: attempt.destination.to });
    }
  }
  if (events.length < CLUSTER_HOST_THRESHOLD) return [];
  events.sort((a, b) => a.ts - b.ts);
  let bestHosts = 0;
  let bestSpan = 0;
  let bestDestinations: { to: CauseDestination; hosts: number }[] = [];
  let left = 0;
  const windowHosts = new Map<string, number>();
  for (let right = 0; right < events.length; right++) {
    const h = events[right].host;
    windowHosts.set(h, (windowHosts.get(h) ?? 0) + 1);
    while (events[right].ts - events[left].ts > CLUSTER_WINDOW_MS) {
      const lh = events[left].host;
      const c = (windowHosts.get(lh) ?? 0) - 1;
      if (c <= 0) windowHosts.delete(lh);
      else windowHosts.set(lh, c);
      left++;
    }
    const distinct = windowHosts.size;
    if (distinct > bestHosts) {
      bestHosts = distinct;
      bestSpan = events[right].ts - events[left].ts;
      const counts = new Map<CauseDestination, number>();
      const destinations = new Map<string, CauseDestination>();
      for (let i = left; i <= right; i++) destinations.set(events[i].host, events[i].to);
      for (const to of destinations.values()) {
        counts.set(to, (counts.get(to) ?? 0) + 1);
      }
      bestDestinations = [...counts].map(([to, hosts]) => ({ to, hosts }))
        .sort((a, b) => b.hosts - a.hosts || (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
    }
  }
  if (bestHosts < CLUSTER_HOST_THRESHOLD) return [];
  return [
    {
      kind: "api-thundering-herd",
      name: "outbound-fan-out",
      p95: bestSpan,
      count: bestHosts,
      cause: { readAt: now, fanOut: { hosts: bestHosts, windowMs: bestSpan, destinations: bestDestinations } },
      hint: "Many distinct outbound hosts were contacted in a single burst (a thundering-herd fan-out).",
    },
  ];
}

/* ── Idle-burn state ───────────────────────────────────────────────────── */

let inFlight = 0;
/** Wall-clock ms when the last request finished and the loop went idle. */
let idleSince = 0;
/** ELU reading captured when the loop last went idle. */
let idleElu: ReturnType<typeof perfHooks.eventLoopUtilization> | null = null;
/** How many idle-burn windows we've observed (honest occurrence count). */
let idleBurnCount = 0;
/** Worst loop-active ms observed during a single idle window. */
let worstIdleActiveMs = 0;

function eluAvailable(): boolean {
  return typeof perfHooks?.eventLoopUtilization === "function";
}

/** Call at the START of every request. Detects idle-burn across the window that
 *  just ended (the loop was idle from `idleSince` until now). No-op under the
 *  kill-switch. */
export function noteRequestStart(): void {
  if (isBoosthisDisabled() || isKitLocked()) return;
  ensureArmed();
  // Host-suspend sensor: wake detection (fires BEFORE the idle-efficiency
  // fold below so suspend-aware consumers see the pre-wake state first).
  noteSuspendActivity();
  if (inFlight === 0 && idleSince > 0 && idleElu && eluAvailable()) {
    const wallGap = Date.now() - idleSince;
    if (wallGap >= IDLE_GAP_MS) {
      try {
        const delta = perfHooks.eventLoopUtilization(idleElu);
        if (
          delta.active >= IDLE_ACTIVE_MS &&
          delta.utilization >= IDLE_UTIL_THRESHOLD
        ) {
          idleBurnCount++;
          worstIdleActiveMs = Math.max(worstIdleActiveMs, Math.round(delta.active));
        }
      } catch {
        // ELU can be unavailable on some carriers — silently skip.
      }
    }
    // The idle window that was open until now has ended — fold its CPU/wall
    // delta into the idle-efficiency meter (reuses THIS boundary; no new timer).
    noteIdleEnd();
  }
  inFlight++;
}

/** Call when a request FINISHES. When the loop returns to idle, snapshot the
 *  ELU baseline so the next request-start can measure the idle window. No-op
 *  under the kill-switch. */
export function noteRequestEnd(): void {
  if (isBoosthisDisabled() || isKitLocked()) return;
  if (inFlight > 0) inFlight--;
  if (inFlight === 0) {
    idleSince = Date.now();
    if (eluAvailable()) {
      try {
        idleElu = perfHooks.eventLoopUtilization();
      } catch {
        idleElu = null;
      }
    }
    // Loop is now idle — snapshot the CPU/wall baseline for the idle-efficiency
    // meter so the next request-start can measure this idle window.
    noteIdleStart();
    // Host-suspend sensor: mark the traffic/idle boundary so suspend-aware
    // axes can snapshot their "everything so far was traffic time" baselines.
    noteSuspendIdleStart();
  }
}

function collectIdleBurn(): CrossCuttingFinding[] {
  if (idleBurnCount === 0) return [];
  return [
    {
      kind: "idle-burn",
      name: "cpu-during-idle",
      p95: worstIdleActiveMs,
      count: idleBurnCount,
      hint: "The event loop kept burning CPU while no request was in flight.",
    },
  ];
}

/* ── Auto-arming (undici/global-fetch observer) ───────────────────────────
 *
 * Subscribing to `diagnostics_channel` is observe-only and removable — it only
 * bumps in-memory counters. We arm lazily on the first request boundary (or the
 * first explicit attempt) so importing the package costs nothing until the app
 * actually serves traffic, and we never arm under the kill-switch.
 */

let armed = false;
let unsubscribe: (() => void) | null = null;

function ensureArmed(): void {
  if (armed || isBoosthisDisabled() || isKitLocked()) return;
  armed = true;
  try {
    // STATIC import, deliberately — this was a lazy `require`, which cannot
    // work: the kit ships as ESM (`"type": "module"`), where `require` is not
    // defined, so every real install threw straight into the catch below and
    // watched ZERO outbound calls while every unit test passed (the test
    // runner provides a `require` shim). This module already static-imports
    // `node:perf_hooks`, so it cannot load without Node built-ins anyway. The
    // guard below stays for a shim that exports the module without the hook.
    const dc = {
      subscribe: dcSubscribe as
        | ((name: string, cb: (msg: unknown) => void) => void)
        | undefined,
      unsubscribe: dcUnsubscribe as
        | ((name: string, cb: (msg: unknown) => void) => void)
        | undefined,
    };
    if (typeof dc.subscribe !== "function") return;
    const onCreate = (msg: unknown): void => {
      const req = (
        msg as {
          request?: { origin?: unknown; path?: unknown; method?: unknown };
        }
      )?.request;
      // TRACE PROPAGATION, FIRST AND ON ITS OWN.
      //
      // This is the only thing in the callback that touches the host's
      // outgoing request rather than merely reading it, so it runs before the
      // bookkeeping (which must never sit in front of a host request) and
      // inside its own guard: a measurement that throws must not cost the
      // customer their joined trace, and a propagation that throws must not
      // cost them a measurement.
      if (req) propagateTraceToNextHop(req);
      try {
        // OUR OWN UPLOADS ARE NOT THE APP'S TRAFFIC — and the question is
        // asked HERE, above every counter, not eleven lines down where it used
        // to sit. See ownTraffic.ts for what counting them cost.
        //
        // The answer is also the PASS the network sampler demands, so the
        // question cannot be skipped on the way to a counter: a call whose
        // destination we could not read gets no pass either, because a call we
        // cannot attribute might be our own, and the connect callbacks below
        // have always dropped that case rather than counting it.
        const whose = attributeOutboundRequest(req);
        if (!whose) return;
        // A call the developer DECLARED as waiting on purpose — a bot
        // long-polling its messaging service (declaredWaits.ts, contract in
        // docs/held-open-calls.md). Matched here, against an address that
        // never leaves this stack. It is never put on the stall clock and never
        // timed: no attempt, no duration, no repeated-work identity, no linked
        // step; an answer is counted as kept out, and a failure still counts.
        const declared = req ? matchDeclaredCall(req.origin, req.path) : null;
        // undici exposes `origin` (protocol+host[:port]); host only is kept.
        recordOutboundAttempt(req?.origin, req?.path);
        // Same observation point feeds the network-reliability meter: the
        // undici `request` object is the per-call token (never a URL/host),
        // and `whose` is the verdict above, carried across a boundary that is
        // never allowed to see a host.
        if (req) {
          if (declared !== null) recordDeclaredAttemptStart(req, whose, declared);
          else recordAttemptStart(req, whose);
        }
        if (req && declared !== null) {
          // The outside-service reading still counts a declared call that
          // FAILS (and only that); a hosted database or an AI provider keeps
          // the readings it always had, which are not timed from here.
          if (
            !isHostedDatabaseCall(hostOf(req.origin), req.path) &&
            aiProviderCode(hostOf(req.origin)) === 0
          ) {
            noteDependencyStart(req as object, hostOf(req.origin), true);
          }
          return;
        }
        // …and the repeated-work meter, which is the one rule the fan-out
        // advice actually names ("identical downstream GETs within one request
        // should share one promise"). method+origin+path are hashed on this
        // stack and dropped — neither the URL nor the hash ever leaves the kit,
        // only the count of how many times one identity recurred.
        // Our own endpoint is already gone at the top of this callback, so no
        // identity is ever formed for it — our periodic flushes can never be
        // attributed to whatever request happens to be in flight and reported
        // back to the developer as their app repeating itself.
        if (req) {
          const target = `${String(req.method ?? "")} ${String(req.origin ?? "")}${String(req.path ?? "")}`;
          // A hosted database reached over the web (Supabase, Firebase, Neon's
          // HTTP driver, Turso, PlanetScale …) is DATABASE work, so it goes to
          // the database meter INSTEAD of the repeated-work one — not as well
          // as. Counting it in both would report one repeated query twice, as
          // an app repeating a downstream API call AND as a repeated
          // statement, and leaving it in the API tally is exactly what made a
          // hosted database invisible on the one reading that should show it.
          // Only the hostname and the path PREFIX are consulted to decide —
          // nothing beyond what the classification needs is read, and nothing
          // about the call leaves the kit either way. The network meters above
          // (attempt counts, reliability) still see every call, database or
          // not: those measure the WIRE, which is the same wire.
          if (isHostedDatabaseCall(hostOf(req.origin), req.path)) {
            noteHostedDbStart(req as object, target);
          } else if (aiProviderCode(hostOf(req.origin)) > 0) {
            // A call to a known AI provider is AI work, and it goes to the AI
            // meter INSTEAD of the repeated-work one — for the same reason a
            // hosted database does, only more sharply. Repeated-work identity
            // is method + origin + path, and every call an app makes to one
            // provider endpoint shares all three, so two entirely different
            // prompts looked like the same call repeated. The AI meter can
            // tell them apart properly (by the prompt's own in-process hash),
            // so this is where that reading belongs. As with the database
            // case, the network meters above still see the call: they measure
            // the wire, which is the same wire.
          } else {
            noteOutboundStart(req, target);
          }
          // …and, ADDITIVELY, the outside-dependency meter, which is the only
          // reading that says WHICH KIND of service a request waited on
          // (sign-in, uploads, payments, messaging, stored-knowledge search,
          // or a destination we do not recognise). Additive, not exclusive,
          // unlike the two branches above: three identical GETs to one payment
          // endpoint really are the same call repeated, so the repeated-work
          // reading must keep seeing them and must not move because this one
          // shipped. Only the bare hostname is handed over, and only so it can
          // be turned into one of six constant words and dropped — the address
          // itself never leaves this stack.
          //
          // A hosted database and an AI provider are deliberately NOT offered
          // here: they were already claimed above, they have their own axes,
          // and grouping them here as well would report one wait twice.
          if (
            !isHostedDatabaseCall(hostOf(req.origin), req.path) &&
            aiProviderCode(hostOf(req.origin)) === 0
          ) {
            noteDependencyStart(req as object, hostOf(req.origin));
          }
        }
      } catch {
        // never let an observer callback disturb the host app
      }
    };
    // Response headers received → the call completed (any HTTP status is a
    // LOUD, finished response — not a silent stall).
    const onHeaders = (msg: unknown): void => {
      try {
        const m = msg as {
          request?: unknown;
          response?: { statusCode?: unknown };
        };
        const req = m?.request;
        // OUR OWN UPLOADS ARE NOT THE APP'S TRAFFIC — above every counter, for
        // the same reason the create handler asks first. The attempt was never
        // started, so the discard is a no-op on the ordinary path; it exists
        // only so an attempt that began before the endpoint was registered as
        // ours is un-counted here rather than left to bank as a silent stall.
        if (!attributeOutboundRequest(req as { origin?: unknown } | undefined)) {
          discardAttempt(req);
          return;
        }
        if (req) recordAttemptComplete(req);
        // Paired end of the repeated-work observation: files the call's
        // measured duration into the request that STARTED it.
        if (req) noteOutboundEnd(req as object);
        // …and the paired end of the hosted-database observation. A call that
        // was never classified as database work has no pending entry, so this
        // is a single miss on the common path. The status is read here, on
        // this stack, only to say whether the round trip failed — the same
        // bucket the outside-service reading uses two lines below — and is
        // then dropped: a boolean leaves, never a code.
        if (req) {
          noteHostedDbEnd(
            req as object,
            outcomeForStatus(m?.response?.statusCode) !== "ok",
            { status: typeof m?.response?.statusCode === "number" ? m.response.statusCode : undefined },
          );
        }
        // …and the paired end of the outside-dependency observation. The
        // status code is read HERE, on this stack, only to decide whether the
        // service failed or merely answered, and is then dropped: a count
        // leaves, never a code. Separating the two is the point — a payment
        // provider returning 500 is a different problem from one that is slow.
        if (req) {
          noteDependencyEnd(
            req as object,
            outcomeForStatus(m?.response?.statusCode),
            { status: typeof m?.response?.statusCode === "number" ? m.response.statusCode : undefined },
          );
        }
        // The hosting platform's own cache verdict, where the reply declares
        // one. Read from the headers this event already carries — no new hook
        // and no new traffic. Boosthis's own upload endpoint is already gone
        // at the top of this callback, exactly as it is for every other
        // reading: our flushes are not the app's traffic, and a verdict on OUR
        // replies is not the app's caching story.
        noteEdgeCacheHeaders(
          (msg as { response?: { headers?: unknown } })?.response?.headers,
        );
      } catch {
        /* observer must never disturb the host */
      }
    };
    // Request error → an errored call. Timeout-class errors feed the silent-drop
    // stall rate; any other error is a LOUD failure (context only, not scored).
    const onError = (msg: unknown): void => {
      try {
        const m = msg as { request?: unknown; error?: { code?: unknown; name?: unknown } };
        if (!m?.request) return;
        // OUR OWN UPLOADS ARE NOT THE APP'S TRAFFIC — above every counter, as
        // in the two callbacks above. A failing Boosthis must never show up as
        // the app's outbound failures; that is the delayed half of this bug,
        // and it is the half a customer would actually be misled by.
        if (!attributeOutboundRequest(m.request as { origin?: unknown })) {
          discardAttempt(m.request);
          return;
        }
        const code = String(m.error?.code ?? "");
        const name = String(m.error?.name ?? "");
        const isTimeout =
          /timeout/i.test(code) ||
          /timeout/i.test(name) ||
          code === "UND_ERR_HEADERS_TIMEOUT" ||
          code === "UND_ERR_BODY_TIMEOUT" ||
          code === "UND_ERR_CONNECT_TIMEOUT";
        recordAttemptError(m.request, isTimeout);
        // A failed call is still a call that HAPPENED — it counts towards a
        // repeat exactly like a successful one (three identical failing GETs
        // are three identical GETs). Paired end of noteOutboundStart.
        noteOutboundEnd(m.request as object);
        // A failed hosted-database call is still time this request spent
        // waiting on the database — same reasoning, same pairing. It is also
        // a round trip that came back with nothing, which is the half the
        // containment reading needs.
        noteHostedDbEnd(m.request as object, true, { error: m.error });
        // A call that never got an answer is the sharpest thing this reading
        // can report, and it is kept apart from a slow one: a timeout means
        // the app gave up waiting, any other error means the connection broke.
        noteDependencyEnd(m.request as object, isTimeout ? "timedout" : "failed", { error: m.error });
      } catch {
        /* observer must never disturb the host */
      }
    };
    /* A connection attempt is ABOUT TO BEGIN. This is the one signal the kit
     * never heard: without it we know when a connection became ready but not
     * when its setup started, so the setup itself — which is pure distance —
     * could not be measured. The hostname is read HERE to decide which KIND of
     * dependency this is, and is then dropped: what is retained is our own
     * kind code, plus a host|port string used only to pair this attempt with
     * its own completion inside this process (see networkSampler). */
    const pairKey = (params: unknown): string => {
      const p = params as { hostname?: unknown; host?: unknown; port?: unknown };
      const h = typeof p?.hostname === "string" ? p.hostname : "";
      const fallback = typeof p?.host === "string" ? p.host : "";
      const port = p?.port == null ? "" : String(p.port);
      return `${(h || fallback).toLowerCase()}|${port}`;
    };
    /* The bare host a connect event is opening a connection to. Shared by all
     * three connect callbacks so they cannot read the same event differently:
     * whose connection this is has to be ONE answer, or the readings paired
     * from these events disagree about it. */
    const connectHostOf = (params: unknown): string => {
      const p = params as { hostname?: unknown; host?: unknown };
      const rawHost =
        typeof p?.hostname === "string"
          ? p.hostname
          : typeof p?.host === "string"
            ? p.host
            : "";
      return hostOf(rawHost) || String(rawHost).toLowerCase();
    };
    const onBeforeConnect = (msg: unknown): void => {
      try {
        const params = (msg as { connectParams?: unknown })?.connectParams;
        // Our OWN upload endpoint is excluded before any kind is formed — the
        // distance to Boosthis is not the customer's dependency distance —
        // and the verdict travels on as the sampler's pass.
        const host = connectHostOf(params);
        const whose = attributeOutbound(host);
        if (!whose) return;
        recordConnectStart(pairKey(params), dependencyKindForHost(host), whose);
      } catch {
        /* observer must never disturb the host */
      }
    };
    // New physical connection opened (DNS+TCP+TLS ran) — feeds the
    // connectionSetup keep-alive-health meter (count only) AND closes the
    // setup timing opened above.
    const onConnected = (msg: unknown): void => {
      try {
        const params = (msg as { connectParams?: unknown })?.connectParams;
        // ONE EVENT PAIR, ONE ANSWER ABOUT WHOSE CONNECTION THIS IS.
        //
        // The host is right here in the connect parameters, and the
        // before-connect handler beside this one already reads it and returns
        // early for our own endpoint. This handler counted every connection,
        // including the ones our own uploads open — so from the very same
        // event pair the dependency-distance reading excluded us and the
        // new-connection count did not. An app with no outbound dependencies
        // was reported as opening 9–11 connections, and `connectionSetup`,
        // which scores new connections as a share of completed outbound
        // calls, became close to a pure reading of OUR keep-alive health
        // presented as theirs.
        const whose = attributeOutbound(connectHostOf(params));
        if (!whose) return;
        recordConnectionOpened(whose);
        recordConnectEstablished(pairKey(params));
      } catch {
        /* observer must never disturb the host */
      }
    };
    // A handshake that never completed is not a distance reading — drop it
    // rather than let it bank as an instant connection.
    const onConnectError = (msg: unknown): void => {
      try {
        const params = (msg as { connectParams?: unknown })?.connectParams;
        // Asked here too, so all three connect callbacks refuse our own
        // endpoint on the same line and a counter added to any of them later
        // inherits the exclusion.
        if (!attributeOutbound(connectHostOf(params))) return;
        recordConnectFailed(pairKey(params));
      } catch {
        /* observer must never disturb the host */
      }
    };
    dc.subscribe("undici:request:create", onCreate);
    dc.subscribe("undici:client:beforeConnect", onBeforeConnect);
    dc.subscribe("undici:client:connected", onConnected);
    dc.subscribe("undici:client:connectError", onConnectError);
    dc.subscribe("undici:request:headers", onHeaders);
    dc.subscribe("undici:request:error", onError);
    if (typeof dc.unsubscribe === "function") {
      unsubscribe = () => {
        try {
          dc.unsubscribe!("undici:request:create", onCreate);
          dc.unsubscribe!("undici:client:beforeConnect", onBeforeConnect);
          dc.unsubscribe!("undici:client:connected", onConnected);
          dc.unsubscribe!("undici:client:connectError", onConnectError);
          dc.unsubscribe!("undici:request:headers", onHeaders);
          dc.unsubscribe!("undici:request:error", onError);
        } catch {
          /* best-effort */
        }
      };
    }
  } catch {
    // No diagnostics_channel — explicit recordOutboundAttempt() still works.
  }
}

/* ── Public collector + lifecycle ─────────────────────────────────────────*/

/** Drain the current live-detector findings. Called by
 *  `reporting.collectFindings()` so these ride the same candidate + snapshot
 *  path as every other finding. Returns [] under the kill-switch. */
export function collectDetectorFindings(): CrossCuttingFinding[] {
  if (isBoosthisDisabled()) return [];
  return [
    ...collectRetryStorms(),
    ...collectConcurrentClusters(),
    ...collectIdleBurn(),
    // Realtime: reconnect storms, silent-but-open connections and connections
    // nothing ever closes. Same counters the tile reads, so the two surfaces
    // can never disagree.
    ...collectLiveConnectionFindings(),
    // What this app's own replies say about caching. Same finding shape, so it
    // rides the same candidate + snapshot path as everything else.
    ...collectCacheDirectiveFindings(),
  ];
}

/** Wipe all detector state + detach the observer. Wired into
 *  `telemetry.forget()` so nothing Boosthis-shaped is left behind. */
export function clearDetectors(): void {
  attemptsByHost.clear();
  // OUR OWN ADDRESS IS THE ONE THING ERASURE KEEPS, and it is kept
  // deliberately. This used to empty the ignored-host set with everything
  // else, which reads as thorough and is the opposite: forgetting the kit does
  // not stop the kit's own traffic. `forget()` posts to our endpoint AFTER
  // this runs, uploads already dispatched still land, and the observer re-arms
  // on the host's very next request — so for as long as our own calls kept
  // arriving they were counted as the app's outbound attempts, failures and
  // new connections, with nothing left that could tell them apart. The set is
  // ours, holds only our own endpoint, and now lives in ownTraffic.ts where
  // this wipe cannot reach it; tests that need a bare process clear it through
  // the internals hook below.
  retryBurstPeak = 0;
  outboundAttemptsSeen = 0;
  inFlight = 0;
  idleSince = 0;
  idleElu = null;
  idleBurnCount = 0;
  worstIdleActiveMs = 0;
  // The network sampler + server-meter collectors are fed exclusively from this
  // detector's observation boundaries, so forget() clears them here too —
  // nothing Boosthis-shaped keeps counting after erasure.
  clearNetworkSampler();
  clearServerMeters();
  clearHeldOpen();
  // Waits declared on purpose share the held-open counting window: the counts
  // go with the meters, the NAMES stay (they are configuration).
  clearDeclaredWaitCounts();
  clearRepeatedWork();
  // Database observation is armed from the request boundary and torn down
  // here: forget() must also DETACH the wrapper we put on the host's database
  // client, not merely zero the counters, or something Boosthis-shaped is left
  // running inside the host after erasure.
  clearDbWork();
  // Same deal for the job systems: forget() must DETACH the wrappers we put on
  // the host's queue library and scheduler, not merely zero the counters.
  unpatchJobSystems();
  clearJobWork();
  // The outside-dependency grouping is pure in-memory counting with no wrapper
  // to detach — but forgetting must still leave no per-kind residue behind.
  clearDependencyWork();
  // Same for the containment reading: it holds no wrapper either, being fed
  // entirely from the two closes above plus the response status, but its
  // session tallies must go the same way as everything else.
  clearFailureContainment();
  // The platform's cache verdict is fed exclusively from the headers boundary
  // above, and the app's own cache instructions from the request boundary, so
  // erasure zeroes both here.
  clearEdgeCache();
  clearCacheDirectives();
  clearSuspendSensor();
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  armed = false;
}

/** @internal test hook. */
export const _detectorInternals = {
  RETRY_WINDOW_MS,
  RETRY_STORM_THRESHOLD,
  RETRY_BACKOFF_MS,
  CLUSTER_WINDOW_MS,
  CLUSTER_HOST_THRESHOLD,
  IDLE_GAP_MS,
  IDLE_ACTIVE_MS,
  IDLE_UTIL_THRESHOLD,
  reset(): void {
    clearDetectors();
    // A test wants a bare process; `forget()` deliberately does not (see
    // clearDetectors). Only the test hook forgets which endpoint is ours.
    _ownTrafficInternals.reset();
  },
  markIdleBurnForTests(activeMs: number): void {
    idleBurnCount++;
    worstIdleActiveMs = Math.max(worstIdleActiveMs, Math.round(activeMs));
  },
};

function propagateTraceToNextHop(req: {
  origin?: unknown;
  path?: unknown;
  method?: unknown;
  addHeader?: unknown;
  headers?: unknown;
}): void {
  try {
    // THE KILL-SWITCH IS RE-READ ON EVERY CALL, NOT AT ARMING TIME.
    //
    // The switch promises the kit becomes a no-op the moment it is thrown. The
    // observer that reaches this line was armed at the request boundary, and a
    // request already in flight — or background work still holding that async
    // context — keeps running with the observer attached long after the switch
    // is thrown. Anything gated only where the observer is INSTALLED therefore
    // keeps going for the life of that scope, and this is the one thing in the
    // callback that writes to the host's request rather than reading it: a
    // trace id would still be leaving the process after an emergency stop.
    //
    // Inside the function rather than at the call site, so no future caller
    // can reach the attach without passing the switch. Python gates its own
    // attach the same way and for the same reason, and the parity guard holds
    // both to it.
    if (isBoosthisDisabled()) return;

    // A CONNECT IS NOT THE CUSTOMER'S REQUEST TO THEIR SERVICE.
    //
    // undici publishes TWO requests when a client tunnels: the application
    // request, whose origin already is the far-side service, and the CONNECT
    // that opens the tunnel beneath it. The CONNECT is addressed to the PROXY,
    // and its target is authority-form — `host:port`, no scheme — which is not
    // a target `destinationHostOf` reads, so that reading falls back to the
    // origin and answers "the proxy". A loopback proxy is internal, so without
    // this line the headers would ride a control request to the proxy operator
    // on the way to a far side the policy refuses. Refusing the CONNECT costs
    // nothing: the application request beneath it is published separately and
    // is still judged on its own destination, which is the request the
    // customer's other service actually receives.
    if (typeof req.method === "string" && req.method.toUpperCase() === "CONNECT") {
      return;
    }

    if (typeof req.addHeader !== "function") return;
    const host = destinationHostOf(req);
    if (isOwnUploadHost(host)) return;
    const carrier = currentRequestScope()?.trace;
    if (!carrier) return;
    // The request being served is also what the same-site rule judges the
    // destination against: its own Host, read off the carrier the scope
    // already holds. Nothing is copied off it and nothing about it is kept.
    if (!shouldPropagateTo(host, servedHostOf(carrier))) return;
    if (carriesAnyTraceHeader(req.headers)) return;
    const built = forwardTraceHeaders(carrier);
    const ready: string[] = [];
    for (const name of PROPAGATED_HEADERS) {
      const value = built[name];
      // A missing parent is normal (a top-level hop has none) and simply is
      // not forwarded. A present-but-unusable value is dropped rather than
      // guessed at.
      if (typeof value === "string" && value.length > 0) {
        ready.push(name, value);
      }
    }
    if (ready.length === 0) return;
    const add = req.addHeader as (name: string, value: string) => unknown;
    // ALL OF THEM OR NONE. undici accumulates the block on `req.headers` — a
    // raw string in older versions, a flat array in current ones — so keeping
    // a copy of that one property is enough to undo a part-finished loop. An
    // array is copied rather than aliased, because `addHeader` pushes into it
    // in place and the alias would come back already mutated.
    const before = Array.isArray(req.headers)
      ? (req.headers as unknown[]).slice()
      : req.headers;
    try {
      for (let i = 0; i < ready.length; i += 2) {
        add.call(req, ready[i] as string, ready[i + 1] as string);
      }
    } catch {
      // Put the request back the way the host built it. If even that fails,
      // what is left on the request is a strict PREFIX of our own set — the
      // trace id, possibly the elapsed offset — which the inbound half reads
      // as an ordinary hop with no parent. Degraded, never malformed.
      try {
        const current = (req as { headers?: unknown }).headers;
        if (Array.isArray(current) && Array.isArray(before)) {
          // In place, not by reassignment: undici pushes into this array and
          // may already hold a reference to it, so swapping the property for
          // a copy would leave the original — the one that gets serialised —
          // still carrying our entries.
          current.length = 0;
          for (const item of before) current.push(item);
        } else {
          (req as { headers?: unknown }).headers = before;
        }
      } catch {
        /* nothing further is safe to try on the host's object */
      }
      return;
    }
  } catch {
    // never let propagation disturb the host app — the call goes out exactly
    // as it was built, and the trace simply stops here as it always used to.
  }
}
