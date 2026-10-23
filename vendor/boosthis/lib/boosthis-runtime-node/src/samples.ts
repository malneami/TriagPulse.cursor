/** In-process sample ring buffer. Mirrors `lib/boosthis-py/boosthis/samples.py`. */

import type { DoorWord } from "./routeDoor";
import { settledFromMs } from "./settleRule";
import { isKitLocked } from "./killSwitch";
import type { Rating } from "./thresholds";

export interface Sample {
  name: string;
  duration_ms: number;
  rating: Rating;
  timestamp_ms: number;
}

export interface PerRouteSummary {
  count: number;
  max_ms: number;
  worst_rating: Rating;
}

export interface Summary {
  total: number;
  good: number;
  needsWork: number;
  poor: number;
  p50_ms: number | null;
  p75_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  byRoute: Record<string, PerRouteSummary>;
}

const MAX_SAMPLES = 1000;
let buffer: Sample[] = [];

/** Optional observer notified after every recorded sample. The telemetry layer
 *  registers one (when an app has opted in) to drive issue/fix reporting and
 *  optional full-sample upload. Local-only installs never set it, so recording
 *  stays a pure in-process operation. */
export type SampleObserver = (sample: Sample) => void;
let observer: SampleObserver | null = null;

export function setSampleObserver(fn: SampleObserver | null): void {
  observer = fn;
}

/* ── What each route looked like when it ARRIVED ───────────────────────────
 *
 * The ring above is shared by every route and evicts oldest-first, so what it
 * holds for one route is whatever survived the others' traffic. Anything that
 * wants a route's FIRST samples — the learned budget's baseline does — cannot
 * get them from the ring: on a busy app the oldest surviving sample of a route
 * is minutes old, so a "baseline" drawn there is the app compared against
 * itself just now, and drift is invisible by construction.
 *
 * Reading them at arrival is the only way that holds. It is done HERE rather
 * than by a reader registering a callback, because a callback only starts
 * catching samples when its module happens to be imported: an app that runs
 * for an hour before anything reads a budget would hand the first read the
 * same minutes-old window. This record exists from the first sample, whoever
 * reads it and whenever.
 *
 * BOUNDED. At most MAX_TRACKED_ROUTES routes are kept, each with at most
 * ROUTE_HEAD_SAMPLES samples; a long-running process with high-cardinality
 * labels drops the least-recently-seen route rather than growing without
 * limit. A dropped route's head restarts from its next sample, so it reads as
 * learning again — never as a stale yardstick.
 */

/** How many of a route's first samples are kept. Must be at least the warm-up
 *  plus baseline the budget reads (`BUDGET_WARMUP_N + BUDGET_BASELINE_N`); a
 *  test in budgets holds the two together. */
export const ROUTE_HEAD_SAMPLES = 25;

/** How many distinct routes carry a head at once. */
export const MAX_TRACKED_ROUTES = 128;

export interface RouteHead {
  /** Every sample of this route recorded in this process, counted as it
   *  arrived. Unlike the ring's contents, this never goes down — so a route
   *  holding fewer samples than it has been sent is positive evidence that the
   *  shared ring evicted some. */
  total: number;
  /** This route's first ROUTE_HEAD_SAMPLES samples, in arrival order. Frozen
   *  once full, so anything derived from it answers the same on every read. */
  head: Sample[];
  /** Last arrival, in epoch ms. Decides which head is dropped when the table
   *  is full. */
  lastSeenMs: number;
}

let routeHeads = new Map<string, RouteHead>();
let routesDropped = 0;

function noteArrival(s: Sample): void {
  // The head is the route's first SETTLED samples (start-up rule): a baseline
  // learned from them never carries the boot minute's cold requests. `total`
  // still counts every arrival.
  const settledNow = s.timestamp_ms >= settledFromMs("latencyTail");
  const existing = routeHeads.get(s.name);
  if (existing) {
    existing.total++;
    existing.lastSeenMs = s.timestamp_ms;
    if (settledNow && existing.head.length < ROUTE_HEAD_SAMPLES) existing.head.push(s);
    return;
  }
  if (routeHeads.size >= MAX_TRACKED_ROUTES) {
    let oldestName: string | null = null;
    let oldestSeen = Infinity;
    for (const [name, rec] of routeHeads) {
      if (rec.lastSeenMs < oldestSeen) {
        oldestSeen = rec.lastSeenMs;
        oldestName = name;
      }
    }
    if (oldestName === null) return;
    routeHeads.delete(oldestName);
    routesDropped++;
  }
  routeHeads.set(s.name, { total: 1, head: settledNow ? [s] : [], lastSeenMs: s.timestamp_ms });
}

/** This route's arrival record, or null where the route has never been seen
 *  in this process (or its head was dropped to stay within the bound). */
export function routeHead(name: string): RouteHead | null {
  return routeHeads.get(name) ?? null;
}

/** Every route with an arrival record, including ones the ring no longer
 *  holds a single sample of. A surface listing routes must union this with the
 *  ring's own names, or a fully evicted route silently disappears from it. */
export function trackedRoutes(): string[] {
  return [...routeHeads.keys()];
}

/** How many routes' heads were dropped to stay within MAX_TRACKED_ROUTES. */
export function droppedRouteCount(): number {
  return routesDropped;
}

export function record(name: string, durationMs: number, rating: Rating): Sample {
  return recordSample(name, durationMs, rating, null);
}

/* ── How the route answered a request with no credentials ──────────────────
 *
 * The middleware knows, when it records a request, which door word the
 * request earned (routeDoor.ts). The word rides the upload and nothing else,
 * so it is kept OFF the sample object — every reader of the ring, the panel
 * and the snapshot included, sees exactly the sample it always saw — in a
 * WeakMap the upload queue reads synchronously, as the observer runs. Not
 * re-exported from the package: a developer recording a sample by hand has no
 * door to describe. */
const doorWords = new WeakMap<Sample, DoorWord>();

/** Record a request the middleware measured, with its door word (or none). */
export function recordWithDoor(
  name: string,
  durationMs: number,
  rating: Rating,
  door: DoorWord | null,
): Sample {
  return recordSample(name, durationMs, rating, door);
}

/** The door word this sample was recorded with, or null. */
export function doorWordOf(s: Sample): DoorWord | null {
  return doorWords.get(s) ?? null;
}

function recordSample(
  name: string,
  durationMs: number,
  rating: Rating,
  door: DoorWord | null,
): Sample {
  const s: Sample = {
    name,
    duration_ms: Math.round(durationMs),
    rating,
    timestamp_ms: Date.now(),
  };
  // LOCKED (docs/kit-lock-rule.md): nothing is kept and nobody is told. The
  // caller still gets its sample back, so code that records by hand runs
  // exactly as it did.
  if (isKitLocked()) return s;
  if (door !== null) doorWords.set(s, door);
  noteRouteFirst(s);
  buffer.push(s);
  if (buffer.length > MAX_SAMPLES) buffer.shift();
  noteArrival(s);
  // Notify the telemetry layer (if registered). Never let an observer error
  // take down the host app's request path — instrumentation must be silent.
  if (observer) {
    try {
      observer(s);
    } catch {
      // swallow
    }
  }
  return s;
}

export function recent(opts: { limit?: number; name?: string } = {}): Sample[] {
  const { limit = 100, name } = opts;
  // Snapshot first to avoid mid-iteration mutation.
  const snap = buffer.slice();
  const out: Sample[] = [];
  for (let i = snap.length - 1; i >= 0 && out.length < limit; i--) {
    const s = snap[i];
    if (name && s.name !== name) continue;
    out.push(s);
  }
  return out;
}

function pct(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

const ORDER: Record<Rating, number> = { good: 0, "needs-work": 1, poor: 2 };

// ── The start-up rule (settleRule.ts) ──────────────────────────────────────
// The first request a route ever serves pays its cold path (module loads,
// first connection, empty caches) wherever in the process's life it falls, and
// every request in the first minute meets a process still settling. A verdict
// over request times judges neither; a COUNT still counts every request.
const MAX_FIRST_TRACKED = 10_000;
const seenRoutes = new Set<string>();
const firstOfRoute = new WeakSet<Sample>();

function noteRouteFirst(s: Sample): void {
  if (seenRoutes.has(s.name)) return;
  if (seenRoutes.size < MAX_FIRST_TRACKED) seenRoutes.add(s.name);
  firstOfRoute.add(s);
}

/** Was this sample the first its route ever served in this process? */
export function isRouteFirst(s: Sample): boolean {
  return firstOfRoute.has(s);
}

/** The samples a latency verdict may judge: settled, never a route's first. */
export function settledSamples(): Sample[] {
  const from = settledFromMs("latencyTail");
  return buffer.filter((s) => s.timestamp_ms >= from && !firstOfRoute.has(s));
}

/** The summary of the samples a verdict may judge (see settledSamples). */
export function settledSummary(): Summary {
  return summarize(settledSamples());
}

export function summary(): Summary {
  return summarize(buffer.slice());
}

function summarize(snap: Sample[]): Summary {
  if (snap.length === 0) {
    return {
      total: 0,
      good: 0,
      needsWork: 0,
      poor: 0,
      p50_ms: null,
      p75_ms: null,
      p95_ms: null,
      p99_ms: null,
      byRoute: {},
    };
  }
  const durations = snap.map((s) => s.duration_ms).sort((a, b) => a - b);
  let good = 0, needsWork = 0, poor = 0;
  const byRoute: Record<string, PerRouteSummary> = {};
  for (const s of snap) {
    if (s.rating === "good") good++;
    else if (s.rating === "needs-work") needsWork++;
    else poor++;
    const r = byRoute[s.name] ?? { count: 0, max_ms: 0, worst_rating: "good" as Rating };
    r.count++;
    if (s.duration_ms > r.max_ms) r.max_ms = s.duration_ms;
    if (ORDER[s.rating] > ORDER[r.worst_rating]) r.worst_rating = s.rating;
    byRoute[s.name] = r;
  }
  return {
    total: snap.length,
    good,
    needsWork,
    poor,
    p50_ms: pct(durations, 0.5),
    p75_ms: pct(durations, 0.75),
    p95_ms: pct(durations, 0.95),
    p99_ms: pct(durations, 0.99),
    byRoute,
  };
}

/** Bumped every time the ring is emptied.
 *
 *  A reader that CACHES something derived from the ring needs to know when the
 *  ring it derived from stopped existing — the learned budget freezes a
 *  baseline that has to outlive eviction, so it cannot re-derive one on every
 *  read to notice a clear(). Exposing a counter keeps that knowledge here
 *  without this module having to import its readers, which would put the leaf
 *  of the module graph at the head of a cycle. */
let generation = 0;

export function epoch(): number {
  return generation;
}

export function clear(): void {
  seenRoutes.clear();
  buffer = [];
  routeHeads = new Map();
  routesDropped = 0;
  generation++;
}

/* ── Circuit summary (local-only session_summary enrichment) ──────────────
 * Pure, on-device computation over the same in-process ring. Surfaces two
 * "circuit integrity" signals for the developer's own AI:
 *
 *   1. LOOP SUSPECTS — one route hit again and again in a tight cadence
 *      (≥8 hits inside a 30s window with a median gap ≤2s). That's the
 *      inbound signature of a retry/redirect loop round-tripping to itself
 *      (rule: node-retry-redirect-loop).
 *   2. FAN-OUT BURST — the max number of requests landing inside any 1s
 *      window (≥6 flags it). A page/aggregator driving N concurrent calls
 *      shows up here as a spike (rule: node-fanout-overload).
 *
 * Counts + already-sanitized route labels only — computed on demand, never
 * uploaded, never part of any snapshot/telemetry payload. Thresholds are
 * byte-parity with the Python/Java/Go siblings. */

const CIRCUIT_LOOP_MIN_HITS = 8;
const CIRCUIT_LOOP_WINDOW_MS = 30_000;
const CIRCUIT_LOOP_MAX_MEDIAN_GAP_MS = 2_000;
const CIRCUIT_BURST_WINDOW_MS = 1_000;
const CIRCUIT_BURST_MIN = 6;
const CIRCUIT_MAX_LOOP_SUSPECTS = 5;

export interface CircuitLoopSuspect {
  route: string;
  hits: number;
  window_s: number;
  median_gap_ms: number;
}

export interface CircuitSummary {
  loop_suspects: CircuitLoopSuspect[];
  burst_max_1s: number;
  burst_route_count: number;
  related_rules: string[];
}

function medianOf(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function circuitSummary(): CircuitSummary {
  const snap = buffer.slice();
  const out: CircuitSummary = {
    loop_suspects: [],
    burst_max_1s: 0,
    burst_route_count: 0,
    related_rules: [],
  };
  if (snap.length === 0) return out;

  // ── Loop suspects: per-route sliding 30s window ──
  const byRoute = new Map<string, number[]>();
  for (const s of snap) {
    const arr = byRoute.get(s.name);
    if (arr) arr.push(s.timestamp_ms);
    else byRoute.set(s.name, [s.timestamp_ms]);
  }
  for (const [route, tsRaw] of byRoute) {
    const ts = tsRaw.slice().sort((a, b) => a - b);
    if (ts.length < CIRCUIT_LOOP_MIN_HITS) continue;
    // Best (densest) 30s window over this route's hits.
    let bestStart = 0;
    let bestCount = 0;
    let lo = 0;
    for (let hi = 0; hi < ts.length; hi++) {
      while (ts[hi] - ts[lo] > CIRCUIT_LOOP_WINDOW_MS) lo++;
      const count = hi - lo + 1;
      if (count > bestCount) {
        bestCount = count;
        bestStart = lo;
      }
    }
    if (bestCount < CIRCUIT_LOOP_MIN_HITS) continue;
    const windowTs = ts.slice(bestStart, bestStart + bestCount);
    const gaps: number[] = [];
    for (let i = 1; i < windowTs.length; i++) gaps.push(windowTs[i] - windowTs[i - 1]);
    gaps.sort((a, b) => a - b);
    const medianGap = medianOf(gaps);
    if (medianGap > CIRCUIT_LOOP_MAX_MEDIAN_GAP_MS) continue;
    out.loop_suspects.push({
      route,
      hits: bestCount,
      window_s: Math.max(1, Math.round((windowTs[windowTs.length - 1] - windowTs[0]) / 1000)),
      median_gap_ms: medianGap,
    });
  }
  out.loop_suspects.sort((a, b) => b.hits - a.hits);
  if (out.loop_suspects.length > CIRCUIT_MAX_LOOP_SUSPECTS) {
    out.loop_suspects.length = CIRCUIT_MAX_LOOP_SUSPECTS;
  }

  // ── Fan-out burst: densest 1s window across ALL samples ──
  const allTs = snap
    .map((s) => ({ ts: s.timestamp_ms, route: s.name }))
    .sort((a, b) => a.ts - b.ts);
  let burstMax = 0;
  let burstLo = 0;
  let burstHiIdx = 0;
  let lo2 = 0;
  for (let hi = 0; hi < allTs.length; hi++) {
    while (allTs[hi].ts - allTs[lo2].ts > CIRCUIT_BURST_WINDOW_MS) lo2++;
    const count = hi - lo2 + 1;
    if (count > burstMax) {
      burstMax = count;
      burstLo = lo2;
      burstHiIdx = hi;
    }
  }
  out.burst_max_1s = burstMax;
  if (burstMax > 0) {
    const routes = new Set<string>();
    for (let i = burstLo; i <= burstHiIdx; i++) routes.add(allTs[i].route);
    out.burst_route_count = routes.size;
  }

  if (out.loop_suspects.length > 0) out.related_rules.push("node-retry-redirect-loop");
  if (out.burst_max_1s >= CIRCUIT_BURST_MIN) out.related_rules.push("node-fanout-overload");
  return out;
}
