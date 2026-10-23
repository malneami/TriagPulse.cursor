/** Privacy-safe perf-snapshot mirror for the Node runtime.
 *
 * Node parity for RN's `perfSnapshotUpload.ts`. It captures the whole live
 * meter page as ONE small, allowlisted JSON object and ships it to
 * `POST /api/snapshots` (the same ingest RN uses) so the developer's OWN AI can
 * read the live picture back over the hosted MCP live-read tools + `GET
 * /api/snapshot`. No new server surface is added — the payload maps into the
 * existing allowlisted snapshot fields (`capturedAt`, `runtimeVersion`,
 * `platform`, `startedAt`, `totalEvents`, `rows`, `crossCutting`, `axes`) so it
 * passes the server's `sanitizeSnapshotLabels` + PII guard unchanged.
 *
 * PRIVACY: the snapshot carries only code-defined route labels + numeric
 * timings/counts/rating buckets — never user values, source, or PII. Route-row
 * keys and cross-cutting finding names are still filtered through the PII guard
 * (in telemetry.ts `transmitSnapshot`) before upload, and the whole payload
 * clears `assertNoPII`. Uploading is OFF by default in issues-only mode and is
 * enabled only by the developer's explicit `shareMeterWithAI` opt-in or the
 * server directive once they connect an AI from the web dashboard — matching
 * RN's privacy-by-default contract.
 */

import { isRouteFirst, recent, routeHead, settledSummary, summary, type Sample, type Summary } from "./samples";
import {
  SETTLE_FAMILIES,
  SETTLE_RULE,
  isSettling,
  markSettled,
  processStartMs,
  settledFromMs,
  settlingReading,
} from "./settleRule";
import {
  allStatuses,
  isJudgedBudget,
  BUDGET_WARMUP_N,
  BUDGET_BASELINE_N,
  type BudgetStatus,
} from "./budgets";
import { collectFindings } from "./reporting";
import {
  readRecurrenceRows,
  type CrossCuttingFinding,
} from "./candidateRules";
import { storageDurable } from "./storage";
import { ratingFor, linearScore, MIN_SAMPLES_FOR_AXES } from "./healthAxes";
import { readBlockingAsync, readEventLoopLag, readWorstFreeze } from "./eventLoopLag";
import { readCpuSchedulingMeters } from "./cpuSchedulingMeters";
import { readExtraMeters } from "./extraMeters";
import { hostFactObservations, readServerlessMeters } from "./serverlessMeters";
import { readConnectionSetup } from "./networkSampler";
import { peakRetryBurst } from "./liveDetectors";
import { routeListForSnapshot, type RouteListReport } from "./routeInventory";
import { readVitals } from "./runtimeVitals";
import {
  readBuildIdentity,
  readDepInventory,
  readPatchLag,
  type BuildIdentity,
  type DepEntry,
} from "./buildIdentity";
import {
  SCORE_THRESHOLDS,
  RUNTIME_VERSION,
  EDGE_CACHE_THRESHOLDS,
  readResilienceTail,
  type Rating,
  type NoScoreRating,
} from "./thresholds";
import {
  computeConfidence,
  computeBaselineScore,
  computeNetworkScore,
  computeIdleEfficiency,
  computeLatencyFloor,
  computeMcpToolsScore,
  computeRepeatedWork,
  computeDbWork,
  computeDbSequencing,
  computeDbRowVolume,
  settledDbPoolPressure,
  computeDependencies,
  computeFailureContainment,
  computeAiCalls,
  computeAiSpend,
  computeAiHeadroom,
  computeBackgroundWork,
  computeDependencyDistance,
  decidedFieldsOf,
  capacityWireFieldsOf,
  type RouteSeriesLike,
  type McpToolSeriesLike,
} from "./meterAxes";
import { getDependencyDistanceStats } from "./networkSampler";
import { declaredHostArea } from "./hostArea";
import { getRepeatedWorkStats } from "./repeatedWork";
import {
  getDbWorkStats,
  getDbFailures,
  getDbSequencingStats,
  getDbRowVolumeStats,
  getDbPoolPressureStats,
  dbWorkSettlingRequests,
} from "./dbWork";
import { getAiCallStats } from "./aiCalls";
import { dependencySettlingRequests, getDependencyStats } from "./dependencyWork";
import { getFailureContainmentStats } from "./failureContainment";
import { AI_PRICE_TABLE_DAY } from "./aiUsage";
import { getJobWorkStats, jobWorkSettlingRuns } from "./jobWork";
import { edgeCacheSettlingVerdicts, getEdgeCacheStats } from "./edgeCache";
import { MCP_CALL_PREFIX, MCP_ERROR_SUFFIX } from "./mcpMeasure";
import { NETWORK_SETTLED_FLOOR, getNetworkStats, getSettledNetworkStats } from "./networkSampler";
import {
  getIdleStats,
  getLatencyFloorSettledSamples,
  getLatencyFloorStats,
  getLatencyFloorSuspendStats,
} from "./serverMeters";
import { getHeldOpenStats } from "./heldOpen";
import {
  declaredCallCounts,
  declaredRoutesKeptOut,
  declaredWaitsBlock,
  hasDeclaredCalls,
  type DeclaredRouteRow,
} from "./declaredWaits";
import { isBunRuntime } from "./runtimeTag";
import { getRouteOutcomeTotals, routeOutcomeFor } from "./routeOutcomes";

/** How often the snapshot mirror re-uploads while sharing is enabled. */
export const SNAPSHOT_FLUSH_MS = 60_000;

/** Turbo first-run ramp: a freshly installed kit fills its dashboard tiles in
 *  seconds instead of minutes by uploading faster for the first few minutes,
 *  then settling onto the steady {@link SNAPSHOT_FLUSH_MS} cadence. Given how
 *  long THIS process/session has been alive, return the delay until the NEXT
 *  perf-snapshot upload:
 *    age < 30s  → 10s · age < 90s → 20s · age < 180s → 40s · else → 60s.
 *  Stateless + age-driven ON PURPOSE: a skipped/empty upload must NOT burn a
 *  ramp step, so the delay depends only on wall age, never on upload count.
 *  This makes existing data arrive at the server sooner and lets count-based
 *  gates clear sooner (sampling is denser early) — it never weakens a gate.
 *  Bounded at ≤4 uploads in the first 70s, well under the 60/min ingest cap. */
export function nextSnapshotDelayMs(sessionAgeMs: number): number {
  if (sessionAgeMs < 30_000) return 10_000;
  if (sessionAgeMs < 90_000) return 20_000;
  if (sessionAgeMs < 180_000) return 40_000;
  return SNAPSHOT_FLUSH_MS;
}

/** Set once when the mirror first starts, so the turbo ramp measures how long
 *  the sharing SESSION has been alive rather than raw process uptime. */
let sessionStartedAt = 0;

/** `BOOSTHIS_TURBO=0` (and only that exact value) opts out of the first-run
 *  ramp and falls straight back to the steady 60s interval. Any other value —
 *  or an unreadable env — leaves turbo on. */
function turboDisabled(): boolean {
  try {
    return process.env.BOOSTHIS_TURBO === "0";
  } catch {
    return false;
  }
}

/** Delay until the next scheduled upload, honouring the kill switch. Falls back
 *  to the fixed steady interval when turbo is disabled or before the session
 *  clock is seeded. */
function currentScheduleDelayMs(now = Date.now()): number {
  if (turboDisabled() || sessionStartedAt === 0) return SNAPSHOT_FLUSH_MS;
  return nextSnapshotDelayMs(now - sessionStartedAt);
}

/** Route rows are prefixed with "screen:" so the server's live-data MCP tools —
 *  which filter rows by that prefix (matching the RN convention) — light up for
 *  Node installs exactly as they do for RN. */
const SCREEN_PREFIX = "screen:";

/** Cap the number of route rows + findings in a single snapshot so a busy app
 *  can never ship an unbounded payload (the server also caps at ~2MB). */
const MAX_SNAPSHOT_ROWS = 60;
const MAX_SNAPSHOT_FINDINGS = 30;

/** Newest-first sample scan window used to derive per-route p50/p95/max/last. */
const SAMPLE_WINDOW = 1000;

export interface NodeSnapshotRow {
  key: string;
  count: number;
  p50: number;
  p95: number;
  max: number;
  last: number;
  /** How many responses for this part were observed at the response boundary,
   *  and how many of those were the 5xx class — the reading that lets a part
   *  be called FAILING rather than merely slow (see routeOutcomes.ts).
   *
   *  BOTH FIELDS ARE OMITTED TOGETHER when this part carries no reading: an
   *  absent pair means "nothing seen here", which is not a zero. They are also
   *  a DIFFERENT WINDOW from `count`: `count` is this part's slice of the
   *  recent sample ring, `observed` is every response since the process
   *  started. They are never mixed into one sentence. */
  observed?: number;
  failed?: number;
}

export interface NodeSnapshotFinding {
  kind: string;
  name: string;
  p95: number;
  count: number;
}

export interface NodeAxisResult {
  /** Null while an axis has evidence worth reporting but no honest verdict to
   *  draw from it — the can't-know shape the extra meters already use
   *  (`measurable: 0` + rating "not-available"), and what `resilience` reports
   *  when the median is below the capture resolution. Matches the web kit.
   *
   *  A null score is not one state but three, and `rating` says which: still
   *  warming ("pending"), not takeable on this host ("not-available"), or a
   *  real reading that is deliberately never graded ("not-scored"). */
  score: number | null;
  rating: Rating | NoScoreRating;
  /** null = honestly-unmeasured field (JSON null on the wire), matching the
   *  Python/Go/Java kits' nullable axis fields (e.g. loadDeflection's
   *  deflectionMsPerReq when the load never overlapped). */
  [k: string]: number | string | null;
}

/** The `axes` map holds axis result OBJECTS keyed by wire name, plus the four
 *  scalar confidence keys (confidence / confidenceMounts / confidenceRating /
 *  confidenceCaption) that live as siblings of the axis objects — matching the
 *  server's SNAPSHOT_AXES allowlist and the RN kit's flat MeterAxes shape. */
export type NodeAxisValue = NodeAxisResult | number | string;

/**
 * The one value that says a developer ASKED for this reading rather than the
 * timer taking it. Named so the build guard can check the declaration in
 * lib/on-demand-reading-coverage.json against this kit's own bytes in both
 * directions — see docs/on-demand-reading-contract.md.
 */
export const READING_TRIGGER_ON_DEMAND = "on-demand" as const;

/** Who asked for this reading. Absent means the same as `"scheduled"` — every
 *  kit older than the feature sends nothing here, and an ordinary upload is
 *  what that has always meant. */
export type ReadingTrigger = "on-demand" | "scheduled";

export interface NodeSnapshotPayload {
  capturedAt: number;
  runtimeVersion: string;
  platform: "node";
  startedAt: number;
  totalEvents: number;
  rows: NodeSnapshotRow[];
  crossCutting: NodeSnapshotFinding[];
  axes: Record<string, NodeAxisValue>;
  /** Build identity — the running build's commit + build time + frozen age at
   *  capture. Included whenever ANY component is honestly known; omitted
   *  entirely otherwise (never a fabricated field). Backs the Patch-lag meter. */
  build?: BuildIdentity;
  /** Dependency inventory — OPT-IN (BOOSTHIS_DEP_INVENTORY=1), off by default.
   *  Absent unless the opt-in is on. */
  deps?: DepEntry[];
  /** Anonymous live-event counters (numeric-only, mirrors the web kit's
   *  `events` shape): `retryBurstMax10s` is the session-peak same-destination
   *  outbound retry-burst strength (attempt count in one 10s window with no
   *  backoff). Omitted while zero so old payload shapes are unchanged. */
  events?: { retryBurstMax10s: number };
  /**
   * What this instance observed about its hosting PLATFORM — not about the app.
   *
   * A closed, all-numeric set (see `hostFactObservations`) that keeps the
   * server's record of what each platform allows current, and lets a "cannot be
   * measured here" answer carry the date it was last true. Omitted entirely
   * unless this is a recognised function host and something was actually
   * observed; a missing key is never a "no".
   */
  hostFacts?: Record<string, number>;
  /**
   * The whole route list, asked of the running framework (see
   * routeInventory.ts) and merged with anything the developer declared by
   * hand. Carries route TEMPLATES only, each one re-screened at transmit.
   *
   * Present whenever this install has an answer to give — including "we could
   * not read it" and "switched off", which are answers. Absent only when the
   * kit was never handed an app and nothing was declared: that is "nothing
   * yet", and it is the one state a missing key may mean.
   */
  routeList?: RouteListReport;
  /**
   * Who asked for this reading. Set to `"on-demand"` ONLY by {@link readNow},
   * and omitted by every other path — the timer's uploads are what an absent
   * field has always meant.
   *
   * It is a fact about WHO ASKED, not about what was measured: pressing the
   * button on a busy application produces a reading with a real window behind
   * it and is marked on-demand all the same. The server pairs this with
   * `totalEvents` to decide whether a reading covers any usage at all.
   */
  readingTrigger?: ReadingTrigger;
  /**
   * Routes the developer declared as waiting on purpose (declaredWaits.ts,
   * docs/held-open-calls.md): each one, in the order declared, with how many
   * calls were kept out of every speed reading and the longest of them. A
   * name nothing has matched yet travels with zeros. ALWAYS present on this
   * kit: `routes: []` is "declared nothing", and an absent block is a
   * different answer (a kit older than the rule).
   */
  declaredWaits?: { routes: DeclaredRouteRow[] };
}

/** Node's finding kinds are not in the server's snapshot `crossCutting.kind`
 *  allowlist (which mirrors the RN `CrossCuttingFinding.kind` union). Map them
 *  onto the nearest allowed kind so they survive the sanitizer AND so the live
 *  `budgets` tool (which keys off `kind === "regression"`) surfaces Node
 *  regressions. Anything already allowed passes through unchanged. */
const FINDING_KIND_MAP: Record<string, string> = {
  "slow-route": "slow-api",
  "budget-regression": "regression",
};

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
  return sortedAsc[idx];
}

/** Group the recent sample window by route into worst-first rows. `recent()`
 *  returns newest-first, so the FIRST sample seen for a route is its latest —
 *  that becomes `last`. */
function buildRows(): NodeSnapshotRow[] {
  const buf = recent({ limit: SAMPLE_WINDOW });
  const durationsByRoute = new Map<string, number[]>();
  const lastByRoute = new Map<string, number>();
  for (const s of buf) {
    let durs = durationsByRoute.get(s.name);
    if (!durs) {
      durs = [];
      durationsByRoute.set(s.name, durs);
      lastByRoute.set(s.name, s.duration_ms);
    }
    durs.push(s.duration_ms);
  }
  const rows: NodeSnapshotRow[] = [];
  for (const [route, durs] of durationsByRoute) {
    const asc = durs.slice().sort((a, b) => a - b);
    // Join on the RAW label, before the screen: prefix — the failure counts
    // are keyed by the same label the sample was recorded under.
    const outcome = routeOutcomeFor(route);
    rows.push({
      key: `${SCREEN_PREFIX}${route}`,
      count: durs.length,
      p50: percentile(asc, 0.5),
      p95: percentile(asc, 0.95),
      max: asc[asc.length - 1],
      last: lastByRoute.get(route) ?? 0,
      // Both or neither. A part the outcome tracker never saw (or that the
      // label cap turned away) gets no pair at all, so the server renders
      // "nothing seen" rather than inventing a clean bill of health.
      ...(outcome
        ? { observed: outcome.observed, failed: outcome.failed }
        : {}),
    });
  }
  rows.sort((a, b) => b.p95 - a.p95);
  if (rows.length <= MAX_SNAPSHOT_ROWS) return rows;
  // THE CAP MAY NOT DECIDE WHICH PART IS FAILING. Rows are chosen worst-p95
  // first, which is the right order for a page about speed and the wrong one
  // for a page about breakage: a route that answers 500 in two milliseconds
  // is the fastest row on the list and would be the first one dropped. Its
  // failures would still reach the app-wide axis, so the reader would be told
  // this app is failing and never told where — exactly the blindness this
  // reading exists to remove.
  //
  // So parts with failures are selected FIRST (most failures first, then
  // slowest), and the remaining slots go to the worst-p95 of the rest. The
  // list is re-sorted by p95 afterwards, so the payload's ordering contract
  // is unchanged — only which rows survive the cap changes.
  const failedOf = (r: NodeSnapshotRow): number =>
    typeof r.failed === "number" ? r.failed : 0;
  const failing = rows
    .filter((r) => failedOf(r) > 0)
    .sort((a, b) => failedOf(b) - failedOf(a) || b.p95 - a.p95);
  const picked =
    failing.length >= MAX_SNAPSHOT_ROWS
      ? failing.slice(0, MAX_SNAPSHOT_ROWS)
      : [
          ...failing,
          ...rows
            .filter((r) => failedOf(r) === 0)
            .slice(0, MAX_SNAPSHOT_ROWS - failing.length),
        ];
  picked.sort((a, b) => b.p95 - a.p95);
  return picked;
}

/** Map live findings into the allowlisted crossCutting shape. `name` is a raw
 *  route label (no "screen:" prefix — the live-data finding tools read it raw,
 *  matching RN); it is PII-filtered in telemetry.ts before upload. `hint` is
 *  intentionally omitted (dropped by the server sanitizer anyway). */
function buildCrossCutting(
  findings: readonly CrossCuttingFinding[],
): NodeSnapshotFinding[] {
  return findings.slice(0, MAX_SNAPSHOT_FINDINGS).map((f) => ({
    kind: FINDING_KIND_MAP[f.kind] ?? f.kind,
    name: f.name,
    p95: f.p95,
    count: f.count,
  }));
}

/** Two honest, display-only meters mapped into the server's axis allowlist:
 *   - responsiveness: request-latency p75 vs the shared TTI thresholds.
 *   - budget: share of budgeted (non-learning) routes still on budget.
 *  The four live-data triage tools read rows + crossCutting, NOT axes, so these
 *  are for the meter page + `boosthis.snapshot` only. Axes that cannot be
 *  computed honestly (network/baseline/stability/etc.) are simply omitted —
 *  the server renders absent axes as pending. */
/** Build the two NON-OVERLAPPING per-route windows the Baseline anomaly axis
 *  compares. Label-free: the route key is used only to GROUP the durations and
 *  is discarded — only the arrays reach computeBaselineScore.
 *
 *  The baseline half is the SAME frozen baseline the learned budget uses: the
 *  route's first samples in this process, warm-up excluded, taken from the
 *  ring module's arrival record rather than from whatever the shared ring
 *  still holds. Building both halves out of the ring is what let this axis
 *  report a busy route as steady while its budget called the same route
 *  regressed — on a busy app the ring holds only the last few minutes, so
 *  both halves came from the same few minutes. The recent half is drawn from
 *  the ring, restricted to samples stamped strictly after that baseline
 *  closed, so the two can never share a sample. See
 *  docs/learned-budget-contract.md. */
function buildRouteSeries(): RouteSeriesLike[] {
  const buf = recent({ limit: SAMPLE_WINDOW }); // newest-first
  const byRoute = new Map<string, Sample[]>();
  // recent() is newest-first; prepend so each series ends up oldest→newest.
  for (const s of buf) {
    let arr = byRoute.get(s.name);
    if (!arr) {
      arr = [];
      byRoute.set(s.name, arr);
    }
    arr.unshift(s);
  }
  const series: RouteSeriesLike[] = [];
  for (const [name, rows] of byRoute) {
    const head = routeHead(name);
    // No completed baseline for this route (never enough samples, or its
    // arrival record was dropped): it is not judged here. The axis reports
    // that as "no route compared yet", never as a steady route.
    if (!head || head.head.length < BUDGET_WARMUP_N + BUDGET_BASELINE_N) {
      continue;
    }
    const baselineSlice = head.head.slice(
      BUDGET_WARMUP_N,
      BUDGET_WARMUP_N + BUDGET_BASELINE_N,
    );
    const closedAtMs = baselineSlice[baselineSlice.length - 1]!.timestamp_ms;
    const after = rows.filter((s) => s.timestamp_ms > closedAtMs);
    series.push({
      baseline: baselineSlice.map((s) => s.duration_ms),
      durations: after.map((s) => s.duration_ms),
    });
  }
  return series;
}

/** Sample count of the LEAST-sampled SCORED route — the weakest scored unit
 *  that backs the confidence reading. A route is "scored" once it has at least
 *  MIN_SAMPLES_FOR_AXES samples (the kit's axis-scoring gate); routes below that
 *  are excluded. Returns 0 when nothing is scored yet. */
function leastScoredRouteSamples(sum: Summary): number {
  const scored = Object.values(sum.byRoute)
    .map((r) => r.count)
    .filter((c) => c >= MIN_SAMPLES_FOR_AXES);
  return scored.length ? Math.min(...scored) : 0;
}

function buildAxes(
  sum: Summary,
  budgets: readonly BudgetStatus[],
): Record<string, NodeAxisValue> {
  const axes: Record<string, NodeAxisValue> = {};

  // Request-time verdicts judge SETTLED requests only (settleRule.ts): never
  // the first minute, never a route's first request. Below the family's floor
  // the reading waits, marked, and the server says "still settling" while the
  // process is young.
  const settled = settledSummary();
  const tailFloor = SETTLE_FAMILIES.latencyTail.minSamples;
  if (settled.total >= tailFloor && settled.p75_ms != null) {
    const score = linearScore(
      settled.p75_ms,
      SCORE_THRESHOLDS.tti.good,
      SCORE_THRESHOLDS.tti.poor,
    );
    axes.responsiveness = markSettled({
      score,
      rating: ratingFor(score),
      p75Ms: settled.p75_ms,
      count: settled.total,
    });
  } else if (sum.total > 0 && isSettling("latencyTail")) {
    axes.responsiveness = settlingReading({ score: null, p75Ms: null, count: settled.total });
  }

  // Resilience — latency-tail stability: the p99/p50 "tail blowup" ratio
  // blended with the poor-sample rate. Same 2-term wire formula as the RN/Web
  // snapshot axis (tail good ≤3× · poor ≥8× · poor-rate 5%..25%) so the meter
  // reads identically across runtimes. The LOCAL dashboard keeps its richer
  // 3-term version (with the budget-regression term) in healthAxes.ts — the
  // uploaded shape stays the cross-runtime wire standard. Additive +
  // display-only — never feeds the Speed score.
  //
  // The tail term obeys the cross-kit contract in thresholds.ts: an absolute
  // floor (a 22 ms worst case is not a resilience problem however large the
  // ratio), a sample floor (a p99 over five samples is just the slowest of
  // five) and an honest abstention when the median is below the capture
  // resolution — where this axis used to hand out a free perfect score.
  {
    const tail = readResilienceTail(settled.p50_ms, settled.p99_ms, settled.total);
    if (tail.state === "insufficient" && sum.total > 0 && isSettling("latencyTail")) {
      axes.resilience = settlingReading({
        score: null,
        tailRatio: null,
        p50Ms: null,
        p99Ms: null,
        sampleCount: settled.total,
      });
    }
    if (tail.state !== "insufficient") {
      const p50 = settled.p50_ms!;
      const p99 = settled.p99_ms!;
      if (tail.state === "unmeasurable") {
        // 0.6 of the score is the tail. Withhold the whole axis rather than
        // publish a verdict whose dominant term was never measured.
        axes.resilience = {
          score: null,
          rating: "pending",
          tailRatio: null,
          p50Ms: p50,
          p99Ms: p99,
          sampleCount: settled.total,
          settleRule: SETTLE_RULE,
        };
      } else {
        const tailScore =
          tail.state === "flat" ? 100 : linearScore(tail.ratio, 3, 8);
        const poorRate = settled.total > 0 ? settled.poor / settled.total : 0;
        const poorRateScore = linearScore(poorRate, 0.05, 0.25);
        const score = Math.round(0.6 * tailScore + 0.4 * poorRateScore);
        axes.resilience = {
          score,
          rating: ratingFor(score),
          tailRatio:
            tail.ratio == null ? null : Math.round(tail.ratio * 10) / 10,
          p50Ms: p50,
          p99Ms: p99,
          sampleCount: settled.total,
          settleRule: SETTLE_RULE,
        };
      }
      // Held-open honesty: a stream the app deliberately keeps open was never
      // filed as a request sample, so this tail describes the requests that
      // actually completed. Say how many were set aside and how long the
      // longest one ran (docs/held-open-calls.md).
      const held = getHeldOpenStats();
      if (held.heldOpenExcluded > 0) {
        axes.resilience.heldOpenExcluded = held.heldOpenExcluded;
        axes.resilience.heldOpenWorstMs = held.heldOpenWorstMs;
      }
    }
  }
  // A window in which every request was a route DECLARED as waiting on
  // purpose (declaredWaits.ts) holds no sample at all, so nothing above
  // publishes. The reading is still sent, with nothing judged and no score:
  // the server then says "nothing judged", never "good" — and never silence,
  // which would read as an app that served nothing.
  if (!axes.resilience && sum.total === 0 && declaredRoutesKeptOut() > 0) {
    axes.resilience = {
      score: null,
      rating: "pending",
      tailRatio: null,
      p50Ms: null,
      p99Ms: null,
      sampleCount: 0,
      settleRule: SETTLE_RULE,
    };
  }

  // Only routes that reached a verdict. A route still learning has no
  // baseline, and one the shared ring evicted below the floor never drew one
  // — neither may sit in the denominator of an on-budget percentage.
  const budgeted = budgets.filter(isJudgedBudget);
  if (budgeted.length > 0) {
    const onBudget = budgeted.filter((b) => b.state !== "regressed").length;
    const pct = Math.round((100 * onBudget) / budgeted.length);
    axes.budget = markSettled({
      score: pct,
      rating: ratingFor(pct),
      onBudget,
      total: budgeted.length,
      pct,
    });
  } else if (budgets.length > 0 && isSettling("latencyTail")) {
    // Routes seen, none judged yet: a budget is learned from settled samples
    // only, so a young process says so rather than staying silent.
    axes.budget = settlingReading({ score: null, onBudget: 0, total: 0, pct: null });
  }

  // Event-loop lag: the truest single signal of a blocked/overloaded Node
  // process (sync fs, huge JSON.parse, tight CPU loop, GC pressure). Additive
  // and display-only — it never feeds the Speed score. Omitted (rendered
  // pending) until the native histogram has enough samples.
  const lag = readEventLoopLag();
  if (lag) {
    axes.eventLoopLag = { ...lag } as unknown as NodeAxisResult;
  }

  // Runtime vitals (memory stability, GC pressure, reliability) — additive,
  // display-only, omitted while warming up. Cross-runtime standard axes.
  Object.assign(axes, readVitals());

  // Worst single event-loop freeze this session (same histogram as
  // eventLoopLag — lifetime max, so one 4s block stays visible forever).
  const freeze = readWorstFreeze();
  if (freeze) axes.worstFreeze = { ...freeze } as unknown as NodeAxisResult;

  const blocking = readBlockingAsync();
  if (blocking) axes.blockingAsync = { ...blocking } as unknown as NodeAxisResult;

  const scheduling = readCpuSchedulingMeters();
  if (scheduling.cpuEntitlement)
    axes.cpuEntitlement = scheduling.cpuEntitlement as unknown as NodeAxisResult;
  if (scheduling.contextSwitching)
    axes.contextSwitching = scheduling.contextSwitching as unknown as NodeAxisResult;
  if (scheduling.threadFootprint)
    axes.threadFootprint = scheduling.threadFootprint as unknown as NodeAxisResult;
  if (scheduling.queueTime)
    axes.queueTime = scheduling.queueTime as unknown as NodeAxisResult;
  if (scheduling.forkChurn)
    axes.forkChurn = scheduling.forkChurn as unknown as NodeAxisResult;

  // 2026-08 extra Node meters: handle churn, rejection pressure, slow-client
  // backpressure, cluster worker imbalance. All additive/display-only;
  // warming or environment-absent axes are honestly omitted.
  Object.assign(axes, readExtraMeters());

  // FUNCTION HOSTS ONLY: cold starts and what they cost, how close runs come to
  // the platform's timeout, and memory headroom. Every one of these ABSTAINS
  // with a named reason where the platform cannot supply it — a reading the
  // host cannot produce is never drawn as a zero. Absent entirely on an
  // ordinary long-running server, which has none of these things.
  Object.assign(axes, readServerlessMeters());

  // Keep-alive health: % of completed outbound calls that opened a NEW
  // connection. Needs outbound traffic — not an expected axis.
  const connSetup = readConnectionSetup();
  if (connSetup) axes.connectionSetup = { ...connSetup };

  // Dependency distance — how far this app is from its data. Judged ONLY on
  // how long a NEW connection takes to open and secure (pure distance), never
  // on the round trip (which would report a slow service as a distant one).
  // Always emitted on a server kit: with too few newly-opened connections to
  // judge, it ships the counts and says so rather than guessing or vanishing.
  const distance = computeDependencyDistance({
    ...getDependencyDistanceStats(),
    typicalRequestMs: sum.p50_ms ?? null,
    hostArea: declaredHostArea(),
    // A server IS the backend; this limit belongs to the browser kit.
    ownBackendOnly: 0,
  });
  axes.dependencyDistance = {
    score: distance.score,
    rating: distance.rating,
    measurable: distance.measurable,
    // The start-up rule's guard (declared steady): the boot pool fill and
    // each kind's first connection are never in a median.
    settleRule: SETTLE_RULE,
    newConnections: distance.newConnections,
    minConnections: distance.minConnections,
    judgedKinds: distance.judgedKinds,
    worstKind: distance.worstKind,
    worstSetupMs: distance.worstSetupMs,
    worstSharePct: distance.worstSharePct,
    // An excluded reading LARGER than the published worst, so no tile can
    // print a "worst" smaller than a number this same axis is holding.
    unjudgedWorstSetupMs: distance.unjudgedWorstSetupMs,
    unjudgedWorstKind: distance.unjudgedWorstKind,
    unjudgedWorstConnections: distance.unjudgedWorstConnections,
    unjudgedKinds: distance.unjudgedKinds,
    typicalRequestMs: distance.typicalRequestMs,
    hostArea: distance.hostArea,
    ownBackendOnly: distance.ownBackendOnly,
    kinds: distance.kinds,
  } as unknown as NodeAxisResult;

  // ── Cross-runtime parity meters (additive, display-only, never feed Speed) ──
  // Each follows the honesty gate: an axis that cannot be honestly measured yet
  // is OMITTED (the server renders an absent axis as "warming up"). The scorers
  // mirror the canonical RN meterAxes.ts thresholds/bands exactly.

  // Confidence — how much data backs the numbers, keyed off the least-sampled
  // SCORED route (0 when nothing is scored yet). Four scalar keys living as
  // siblings of the axis objects, matching the server's SNAPSHOT_AXES allowlist.
  const conf = computeConfidence(leastScoredRouteSamples(sum));
  if (conf.confidence !== "none") {
    axes.confidence = conf.confidence;
    axes.confidenceMounts = conf.confidenceMounts;
    // No rating word: confidence is how sure, never how healthy (decision).
    axes.confidenceCaption = conf.confidenceCaption;
  }

  // Baseline — each route graded against ITS OWN recent history (drift), from
  // the same in-process sample ring the budget model reads (label-free series).
  const baseline = computeBaselineScore(buildRouteSeries());
  // Emitted whenever there is anything to say: a real verdict, OR an abstention
  // because every route with enough samples was too fast to divide by. Omitting
  // the abstention would leave the tile reading "warming up" forever, which is
  // the wrong one of the four states.
  // Both windows come from a route's SETTLED samples (samples.ts route head).
  if (baseline.score !== null || baseline.unscoredRoutes > 0) {
    axes.baseline = markSettled({
      score: baseline.score,
      rating: baseline.rating as Rating,
      // worst* are null when nothing regressed; ship 0 in that case so the wire
      // stays numeric-only (the server treats 0 ratio/ms as "no anomaly").
      worstRatio: baseline.worstRatio ?? 0,
      worstBaselineMs: baseline.worstBaselineMs ?? 0,
      worstCurrentMs: baseline.worstCurrentMs ?? 0,
      anomalyCount: baseline.anomalyCount,
      scoredRoutes: baseline.scoredRoutes,
      unscoredRoutes: baseline.unscoredRoutes,
      measurable: baseline.measurable,
    });
  }

  // Network — outbound-call stall/timeout rate + p75 latency, from the network
  // sampler fed by the SAME undici observation point as the retry-storm
  // detector. Absent forever if the app makes no outbound calls — correct.
  // Judged from SETTLED attempts only (settleRule.ts, latencyTail): never the
  // first minute's cold calls, never the very first call, and a p75 only from
  // 20 settled durations. The lifetime worst rides as context.
  const settledNet = getSettledNetworkStats();
  const network =
    settledNet.judged >= NETWORK_SETTLED_FLOOR && settledNet.p75Ms !== null
      ? computeNetworkScore({ ...settledNet, p75Ms: settledNet.p75Ms })
      : null;
  if (network && network.score !== null && network.p75Ms !== null) {
    axes.network = markSettled({
      score: network.score,
      rating: network.rating as Rating,
      stallPct: network.stallPct ?? 0,
      attemptCount: network.attemptCount,
      failedCount: network.failedCount,
      timeoutCount: network.timeoutCount,
      stallCount: network.stallCount,
      p75Ms: network.p75Ms,
      worstMs: network.worstMs,
      // Which part set the score (meterAxes.ts, DECIDED_PART). Absent when
      // nothing pulled it below 100.
      ...decidedFieldsOf(network),
    });
  } else if (getNetworkStats().attemptCount > 0 && isSettling("latencyTail")) {
    axes.network = settlingReading({
      score: null,
      attemptCount: settledNet.attemptCount,
      p75Ms: null,
      worstMs: Math.round(settledNet.worstMs),
    });
  }
  // Calls the developer declared as waiting on purpose (declaredWaits.ts):
  // four counts on the reading the calls belong to — zeros when nothing is
  // declared, never absent. While names are held the reading is sent even with
  // no timed call behind it (a bot whose only call is its long-poll), with its
  // count at the attempts actually judged and no score: the server then says
  // "nothing judged", never "good". Not on Bun, whose own fetch the kit cannot
  // see, so no call there is ever timed or kept out (bunLimits.ts).
  const callCounts = declaredCallCounts();
  if (axes.network) {
    Object.assign(axes.network, callCounts);
  } else if (hasDeclaredCalls() && !isBunRuntime()) {
    axes.network = settlingReading({
      score: null,
      attemptCount: settledNet.attemptCount,
      p75Ms: null,
      worstMs: Math.round(settledNet.worstMs),
      ...callCounts,
    });
  }

  // Idle efficiency — CPU burned while zero requests were in flight, measured
  // over the SAME idle-window boundaries the idle-burn detector uses.
  const idle = computeIdleEfficiency(getIdleStats());
  if (idle.score !== null && idle.idleBusyPct !== null) {
    axes.idle = markSettled({
      score: idle.score,
      rating: idle.rating as Rating,
      idleBusyPct: idle.idleBusyPct,
      idleLongTaskCount: idle.idleLongTaskCount,
    });
  } else if (isSettling("peakRate")) {
    // Quiet windows before the process settled are not counted, so a young
    // process says it is settling rather than going silent.
    axes.idle = settlingReading({
      score: null,
      rating: "pending" as const,
      idleBusyPct: null,
      idleLongTaskCount: idle.idleLongTaskCount,
    });
  }

  // Latency floor — the worst completed 10s window's p95 request latency, so a
  // single bad minute is never averaged away inside a good session.
  // Settled windows only, and a verdict only over 20 settled requests
  // (settleRule.ts, latencyTail; serverMeters.ts drops the cold ones).
  const floorSettled = getLatencyFloorSettledSamples();
  const latencyFloor = computeLatencyFloor(getLatencyFloorStats());
  if (floorSettled < SETTLE_FAMILIES.latencyTail.minSamples && isSettling("latencyTail")) {
    axes.latencyFloor = settlingReading({
      score: null,
      windowCount: latencyFloor.windowCount,
    }) as unknown as NodeAxisResult;
  } else if (
    floorSettled >= SETTLE_FAMILIES.latencyTail.minSamples &&
    latencyFloor.score !== null &&
    latencyFloor.worstMs !== null
  ) {
    axes.latencyFloor = markSettled({
      score: latencyFloor.score,
      rating: latencyFloor.rating as Rating,
      worstMs: latencyFloor.worstMs,
      windowCount: latencyFloor.windowCount,
    }) as NodeAxisResult;
    // Host-suspend honesty: post-wake samples are excluded from the floor
    // (resume cost, not the app's code) but the discount stays visible.
    const susp = getLatencyFloorSuspendStats();
    if (susp.suspendDiscounts > 0) {
      axes.latencyFloor.suspendDiscounts = susp.suspendDiscounts;
      axes.latencyFloor.suspendUnit = susp.suspendUnit;
      axes.latencyFloor.suspendWorstMs = susp.suspendWorstMs;
    }
    // Held-open honesty, same rule: a stream the app deliberately keeps open
    // never enters the floor, and the exclusion is said out loud.
    const held = getHeldOpenStats();
    if (held.heldOpenExcluded > 0) {
      axes.latencyFloor.heldOpenExcluded = held.heldOpenExcluded;
      axes.latencyFloor.heldOpenWorstMs = held.heldOpenWorstMs;
    }
  }

  // MCP tool speed — per-tool latency + error rate for projects that ARE MCP
  // servers, from the closed-set `mcp.call.*` labels (auto for HTTP, explicit
  // `mcpTool()` for stdio). Absent forever if the project serves no MCP —
  // honest absence, and the server never renders a "warming up" chip for it.
  const mcpSeries = buildMcpToolSeries();
  const mcp = computeMcpToolsScore(mcpSeries);
  const mcpFloor = SETTLE_FAMILIES.latencyTail.minSamples;
  if (mcp.score !== null && mcp.worstMs !== null && mcp.sampleCount >= mcpFloor) {
    axes.mcpTools = markSettled({
      score: mcp.score,
      rating: mcp.rating as Rating,
      worstMs: mcp.worstMs,
      toolCount: mcp.toolCount,
      errorPct: mcp.errorPct ?? 0,
      sampleCount: mcp.sampleCount,
      ...decidedFieldsOf(mcp),
    }) as NodeAxisResult;
  } else if (isSettling("latencyTail") && hasMcpCalls()) {
    axes.mcpTools = settlingReading({
      score: null,
      sampleCount: mcp.sampleCount,
    }) as unknown as NodeAxisResult;
  }

  // Repeated work — the same call made more than once inside ONE request
  // (an n+1 query loop, or the identical downstream GET the fan-out rule warns
  // about). Counted inside the kit, where the call's identity exists; only the
  // counts and the wasted-time share reach here. Absent forever if the app
  // wraps no identifiable calls — an honest "cannot tell", never a zero.
  const repeatedStats = getRepeatedWorkStats();
  const repeated = computeRepeatedWork(repeatedStats);
  // The start-up rule (startupEvent): requests before the process settled and
  // each route's first request are never folded in; while young and only
  // those have been seen, the reading says it is still settling.
  if (repeated.score === null && isSettling("startupEvent") && (repeatedStats.settlingRequests ?? 0) > 0) {
    axes.repeatedWork = settlingReading({ score: null }) as unknown as NodeAxisResult;
  }
  if (repeated.score !== null && repeated.worstRepeats !== null) {
    axes.repeatedWork = {
      score: repeated.score,
      rating: repeated.rating as Rating,
      settleRule: SETTLE_RULE,
      worstRepeats: repeated.worstRepeats,
      requestsWithRepeat: repeated.requestsWithRepeat,
      watchedRequests: repeated.watchedRequests,
      repeatTimePct: repeated.repeatTimePct,
      ...decidedFieldsOf(repeated),
    };
  }

  // Database work — how much of a request was spent WAITING on the database,
  // and whether one request ran the same statement several times. Covers both
  // a traditional driver (watched at its round-trip layer, inside the kit) and
  // a hosted database reached over the web (classified as database work rather
  // than ordinary API traffic). Only counts, durations and shares reach here:
  // no SQL, no values, no table or column names. Absent when the app has no
  // database work the kit can see — an honest "cannot tell", never a zero —
  // and present with `measurable: 0` plus the unwatched-client count when the
  // app loaded a database library this kit cannot watch, so a blind spot can
  // never render as "no database work".
  const dbWork = computeDbWork(getDbWorkStats());
  // The start-up rule (latencyTail) for the three database readings: only
  // settled requests are folded in; while young, a project whose database
  // work so far is all start-up work reads as still settling.
  const dbSettling = isSettling("latencyTail") && dbWorkSettlingRequests() > 0;
  if (dbWork) {
    const axis: Record<string, number | string | null> = {
      score: dbWork.score,
      rating: dbWork.rating,
      measurable: dbWork.measurable,
      settleRule: SETTLE_RULE,
      waitPct: dbWork.waitPct,
      callCount: dbWork.callCount,
      watchedRequests: dbWork.watchedRequests,
      hostedCalls: dbWork.hostedCalls,
      repeatWorst: dbWork.repeatWorst,
      repeatRequests: dbWork.repeatRequests,
      repeatWastePct: dbWork.repeatWastePct,
      unwatchedClients: dbWork.unwatchedClients,
    };
    // A COUNT of rows, never a row. Omitted rather than zeroed when no
    // finished query reported one, so "we did not see a result size" and "the
    // query returned nothing" stay different answers.
    if (dbWork.rowsWorst !== null) axis.rowsWorst = dbWork.rowsWorst;
    if (dbWork.waitMsPerRequest !== undefined) axis.waitMsPerRequest = dbWork.waitMsPerRequest;
    if (dbWork.measurable === 1) Object.assign(axis, getDbFailures());
    Object.assign(axis, decidedFieldsOf(dbWork));
    axes.dbWork = axis as unknown as NodeAxisResult;
  } else if (dbSettling) {
    axes.dbWork = settlingReading({ score: null }) as unknown as NodeAxisResult;
  }

  // ── Database sequencing ──────────────────────────────────────────────────
  // Whether that database work happened in single file. Two timestamps per
  // call, swept into round-trip waves by the rule every kit shares
  // (docs/db-round-trip-waves.md); no statement, table or column name is read
  // to compute it. Absent when too few requests were judged to say anything —
  // an honest "cannot tell", never a confident zero.
  const dbSequencing = computeDbSequencing(getDbSequencingStats());
  if (dbSequencing) {
    axes.dbSequencing = {
      score: dbSequencing.score,
      rating: dbSequencing.rating,
      measurable: dbSequencing.measurable,
      settleRule: SETTLE_RULE,
      wavesWorst: dbSequencing.wavesWorst,
      wavesAvg: dbSequencing.wavesAvg,
      seriesPct: dbSequencing.seriesPct,
      watchedRequests: dbSequencing.watchedRequests,
      unwatchedClients: dbSequencing.unwatchedClients,
    } as unknown as NodeAxisResult;
  } else if (dbSettling) {
    axes.dbSequencing = settlingReading({ score: null }) as unknown as NodeAxisResult;
  }

  // ── Database row volume ──────────────────────────────────────────────────
  // How much a query hands back, scored on a continuous band so a page whose
  // result size climbs with the account shows the climb instead of nothing
  // until it crosses a cliff. Row COUNTS only — no row, value, column name or
  // table name is read — and withheld entirely when no watched call reported a
  // size, because a cursor-only app is not a zero-row app.
  const dbRowVolume = computeDbRowVolume(getDbRowVolumeStats());
  if (dbRowVolume) {
    axes.dbRowVolume = {
      score: dbRowVolume.score,
      rating: dbRowVolume.rating,
      measurable: dbRowVolume.measurable,
      settleRule: SETTLE_RULE,
      worstRows: dbRowVolume.worstRows,
      rowsAvg: dbRowVolume.rowsAvg,
      sizedCalls: dbRowVolume.sizedCalls,
      watchedRequests: dbRowVolume.watchedRequests,
      unwatchedClients: dbRowVolume.unwatchedClients,
      ...decidedFieldsOf(dbRowVolume),
    } as unknown as NodeAxisResult;
  } else if (dbSettling) {
    axes.dbRowVolume = settlingReading({ score: null }) as unknown as NodeAxisResult;
  }

  // ── Database pool pressure ────────────────────────────────────────────────
  // A point-in-time read of pools the app created after observation armed.
  // No pool (and no bounded capacity denominator) means no axis.
  // Under the start-up rule a young process says it is settling instead.
  const dbPoolPressure = settledDbPoolPressure(getDbPoolPressureStats());
  if (dbPoolPressure && dbPoolPressure.score === null) {
    axes.dbPoolPressure = dbPoolPressure as unknown as NodeAxisResult;
  } else if (dbPoolPressure) {
    axes.dbPoolPressure = {
      score: dbPoolPressure.score,
      rating: dbPoolPressure.rating,
      usedPct: dbPoolPressure.usedPct,
      busy: dbPoolPressure.busy,
      idle: dbPoolPressure.idle,
      waiting: dbPoolPressure.waiting,
      size: dbPoolPressure.size,
      settleRule: dbPoolPressure.settleRule,
    };
  }

  // ── Outside services ─────────────────────────────────────────────────────
  // WHICH kind of outside service a request waits on — sign-in, uploads,
  // payments, messaging, stored-knowledge search — instead of one blurred
  // "some outbound calls were slow". Sign-in gets its own fields because it
  // sits in front of every session, and a destination the kit does not
  // recognise gets its own visible group rather than being folded into a kind
  // it might not be.
  //
  // WHAT TRAVELS: counts, durations, shares, and one of six constant WORDS the
  // kit defines for the kind. The hostname that produced that word was dropped
  // inside the app; no address, path, query, header, payload or status code
  // reaches this point, and the server re-checks the word against the same
  // closed list on arrival and drops any row that fails.
  //
  // Absent when the app leans on no outside service AND signs nobody in
  // itself — an honest "cannot tell", never a confident zero and never a row
  // of empty groups. Present with `measurable: 0` when the only thing worth
  // saying is that sign-in runs INSIDE this app, because letting a founder
  // conclude their app has no sign-in would be worse than saying nothing.
  const dependencies = computeDependencies(getDependencyStats());
  if (dependencies) {
    const axis: Record<string, unknown> = {
      score: dependencies.score,
      rating: dependencies.rating,
      measurable: dependencies.measurable,
      waitPct: dependencies.waitPct,
      dbPct: dependencies.dbPct,
      aiPct: dependencies.aiPct,
      selfPct: dependencies.selfPct,
      callCount: dependencies.callCount,
      watchedRequests: dependencies.watchedRequests,
      failCount: dependencies.failCount,
      timeoutCount: dependencies.timeoutCount,
      failPct: dependencies.failPct,
      p75Ms: dependencies.p75Ms,
      worstMs: dependencies.worstMs,
      kindCount: dependencies.kindCount,
      flakyKinds: dependencies.flakyKinds,
      unknownCalls: dependencies.unknownCalls,
      signinCalls: dependencies.signinCalls,
      signinFailed: dependencies.signinFailed,
      inAppSignin: dependencies.inAppSignin,
    };
    // Omitted rather than zeroed when sign-in made no outside call at all, so
    // "sign-in is instant" and "we never timed a sign-in" stay different
    // answers.
    if (dependencies.signinP75Ms !== null)
      axis.signinP75Ms = dependencies.signinP75Ms;
    if (dependencies.groups.length > 0) axis.groups = dependencies.groups;
    // The start-up rule (latencyTail): settled requests only.
    axis.settleRule = SETTLE_RULE;
    if (dependencies.waitMsPerRequest !== undefined) axis.waitMsPerRequest = dependencies.waitMsPerRequest;
    Object.assign(axis, decidedFieldsOf(dependencies));
    axes.dependencies = axis as unknown as NodeAxisResult;
  } else if (isSettling("latencyTail") && dependencySettlingRequests() > 0) {
    axes.dependencies = settlingReading({ score: null }) as unknown as NodeAxisResult;
  }

  // ── Failure containment ──────────────────────────────────────────────────
  // Whether one failed read took the whole response down with it, or the app
  // answered anyway. Reliability counts failed responses and cannot tell those
  // two apart; this can, from counts the kit already had — how many data calls
  // a request made, how many failed, and what the response finally carried.
  // The boundary is defined once for every runtime in
  // docs/failure-containment.md.
  //
  // Counts only. No dependency name, address, statement or status code: which
  // read broke is deliberately unanswerable here. Absent when no watched
  // request made a data call this kit could see — an honest "cannot tell",
  // never a zero — and present with the score WITHHELD when too few failures
  // have happened to judge, because a full score for an app that has not
  // broken yet is exactly the claim this reading refuses to make.
  const containment = computeFailureContainment(getFailureContainmentStats());
  if (containment) {
    axes.failureContainment = {
      score: containment.score,
      rating: containment.rating,
      measurable: containment.measurable,
      collapsedCount: containment.collapsedCount,
      containedCount: containment.containedCount,
      allFailedCount: containment.allFailedCount,
      unattributedCount: containment.unattributedCount,
      collapsePct: containment.collapsePct,
      watchedRequests: containment.watchedRequests,
      // Present only while the verdict is withheld, so a scored reading carries
      // no stray "why not" — and a withheld one is never a blank tile.
      ...(containment.reasonCode === null
        ? {}
        : { reasonCode: containment.reasonCode }),
    } as unknown as NodeAxisResult;
  }

  // ── AI calls ─────────────────────────────────────────────────────────────
  // The three readings that say what the AI part of this app costs and how
  // long it takes to answer. Every one of them is ABSENT when the app called
  // no AI provider — an app with no AI in it shows nothing here rather than a
  // row of zeros, exactly as a runtime without this reading does.
  //
  // What reaches this point is numbers only: no prompt, no answer, no address.
  // The destination is a POSITION in the kit's maintained provider list, and a
  // call that could not be classified was never counted as AI at all.
  const aiStats = getAiCallStats();

  // How long the AI part took: the share of a request spent waiting on it
  // (reported beside the database share, never scored — waiting for a model is
  // the work, not waste), time to the first words of a streamed answer, stalls
  // mid-answer, and the failures that actually happen to AI calls told apart
  // from one another.
  const aiCalls = computeAiCalls(aiStats);
  // Read the remembered findings ONCE, before the axis is known: the release
  // that stops a pattern usually stops it by removing the AI work, so the run
  // that most needs to say "not seen since" is the run with no AI call in it.
  const remembers = storageDurable() ? 1 : 0;
  const rememberedPatterns = remembers === 1 ? readRecurrenceRows() : null;
  const hasRememberedPatterns = !!(
    rememberedPatterns && rememberedPatterns.length > 0
  );
  if (aiCalls) {
    axes.aiCalls = {
      score: aiCalls.score,
      rating: aiCalls.rating,
      measurable: aiCalls.measurable,
      // The start-up rule: time to first token waits for settled streams.
      settleRule: SETTLE_RULE,
      waitPct: aiCalls.waitPct,
      callCount: aiCalls.callCount,
      watchedRequests: aiCalls.watchedRequests,
      providerCount: aiCalls.providerCount,
      topProvider: aiCalls.topProvider,
      p75Ms: aiCalls.p75Ms,
      worstMs: aiCalls.worstMs,
      streamCount: aiCalls.streamCount,
      // Absent, never 0, until a settled streamed answer was timed.
      ...(aiCalls.ttftP75Ms !== undefined ? { ttftP75Ms: aiCalls.ttftP75Ms } : {}),
      stallCount: aiCalls.stallCount,
      failCount: aiCalls.failCount,
      rateLimitedCount: aiCalls.rateLimitedCount,
      quotaCount: aiCalls.quotaCount,
      timeoutCount: aiCalls.timeoutCount,
      truncatedCount: aiCalls.truncatedCount,
      filteredCount: aiCalls.filteredCount,
      serverMsP75: aiCalls.serverMsP75,
      serverMsCalls: aiCalls.serverMsCalls,
      unwatchedClients: aiCalls.unwatchedClients,
      unclassifiedCalls: aiCalls.unclassifiedCalls,
      ...decidedFieldsOf(aiCalls),
    } as unknown as NodeAxisResult;
    // What this app KEEPS doing. Every finding above is computed in the
    // process and forgotten when it ends, so the same anti-pattern arrives as
    // new on every deploy and nothing can tell a one-off from the fourth
    // release running. These are counts read back out of the local finding
    // store: how many separate runs, how many separate releases, how long
    // ago, and whether this run has seen it at all. No prompt, no prompt
    // hash, no host, no path, no model name — the same contract the rest of
    // this axis keeps.
    //
    // A kit with nowhere durable to remember says so rather than sending an
    // empty list that reads as "nothing recurs here".
    (axes.aiCalls as unknown as Record<string, unknown>).patternMemory =
      remembers;
    if (hasRememberedPatterns) {
      (axes.aiCalls as unknown as Record<string, unknown>).patterns =
        rememberedPatterns;
    }
  } else if (hasRememberedPatterns) {
    // NO AI call in this run, but this device remembers one from an earlier
    // one. `computeAiCalls` is right to stay silent about a run with no AI
    // work in it — but silence here would throw away the one reading that
    // only the memory can give: a pattern that used to appear and has not
    // appeared since a named release. That is the ordinary shape of a fix, so
    // the axis must survive the release that stops the AI work.
    //
    // It arrives UNSCORED and unmeasurable, exactly like the blind-spot case
    // above: score null, rating pending, measurable 0, every count a real
    // zero for this run. Nothing here is a verdict on this app's AI
    // performance — there was none to judge — and the server words it as
    // "cannot tell", with what keeps happening (or what stopped) beside it.
    axes.aiCalls = {
      score: null,
      rating: "pending",
      measurable: 0,
      waitPct: 0,
      callCount: 0,
      watchedRequests: 0,
      providerCount: 0,
      topProvider: 0,
      p75Ms: 0,
      worstMs: 0,
      streamCount: 0,
      stallCount: 0,
      failCount: 0,
      rateLimitedCount: 0,
      quotaCount: 0,
      timeoutCount: 0,
      truncatedCount: 0,
      filteredCount: 0,
      serverMsP75: 0,
      serverMsCalls: 0,
      unwatchedClients: Math.max(
        0,
        Math.round(aiStats?.unwatchedClients ?? 0),
      ),
      unclassifiedCalls: 0,
      patternMemory: remembers,
      patterns: rememberedPatterns,
    } as unknown as NodeAxisResult;
  }

  // What it cost: tokens in and out, how many the provider served from its own
  // cache, and the money — provider-reported where the provider reports it,
  // otherwise priced from a published list whose DATE ships with the number so
  // no surface can show an estimate without being able to show its age. Calls
  // no price could be put on are counted, never treated as free.
  const aiSpend = computeAiSpend(aiStats, AI_PRICE_TABLE_DAY);
  if (aiSpend) {
    const spend: Record<string, number | string | null> = {
      score: aiSpend.score,
      rating: aiSpend.rating,
      measurable: aiSpend.measurable,
      // The shared decision: reported, never graded, in every kit.
      settleRule: SETTLE_RULE,
      calls: aiSpend.calls,
      tokensIn: aiSpend.tokensIn,
      tokensOut: aiSpend.tokensOut,
      cachedIn: aiSpend.cachedIn,
      cacheHitPct: aiSpend.cacheHitPct,
      costMicros: aiSpend.costMicros,
      reportedCostCalls: aiSpend.reportedCostCalls,
      pricedCalls: aiSpend.pricedCalls,
      unpricedCalls: aiSpend.unpricedCalls,
      costPerRequestMicros: aiSpend.costPerRequestMicros,
      worstRequestCostMicros: aiSpend.worstRequestCostMicros,
      windowMs: aiSpend.windowMs,
      usageMissingCalls: aiSpend.usageMissingCalls,
      usageMissingPct: aiSpend.usageMissingPct,
      streamUsageMissingCalls: aiSpend.streamUsageMissingCalls,
      declaredCalls: aiSpend.declaredCalls,
      declaredUnpricedCalls: aiSpend.declaredUnpricedCalls,
      repeatWorst: aiSpend.repeatWorst,
      repeatRequests: aiSpend.repeatRequests,
      priceTableDay: aiSpend.priceTableDay,
    };
    axes.aiSpend = spend as unknown as NodeAxisResult;
  }

  // How close the project is to its provider's published limits — the same
  // ceiling shape as the function-host timeout and memory headroom axes.
  // Absent when the provider published nothing to read, rather than a
  // comforting 100%.
  const aiHeadroom = computeAiHeadroom(aiStats);
  if (aiHeadroom) {
    axes.aiHeadroom = {
      score: aiHeadroom.score,
      rating: aiHeadroom.rating,
      measurable: aiHeadroom.measurable,
      // The start-up rule: graded on the typical settled reading.
      ...(aiHeadroom.settleRule !== undefined ? { settleRule: aiHeadroom.settleRule } : {}),
      ...(aiHeadroom.typicalHeadroomPct !== undefined
        ? { typicalHeadroomPct: aiHeadroom.typicalHeadroomPct }
        : {}),
      reads: aiHeadroom.reads,
      worstRequestsPct: aiHeadroom.worstRequestsPct,
      worstTokensPct: aiHeadroom.worstTokensPct,
      refusals: aiHeadroom.refusals,
      worstRetryAfterMs: aiHeadroom.worstRetryAfterMs,
      ...decidedFieldsOf(aiHeadroom),
    } as unknown as NodeAxisResult;
  }

  // Background work — jobs, queues and schedules: the work that happens with
  // nobody watching. Queue consumers, scheduled tasks, webhook processors and
  // nightly imports have no request behind them, so until now a project doing
  // most of its work here opened a dashboard that looked empty. Counts,
  // timings and code-defined job NAMES only: a job's payload and arguments are
  // never read. Absent when this app has no background work the kit can see —
  // an honest "cannot tell", never a zero — and present with `measurable: 0`
  // plus the unattached-system count when the app loaded a job library this
  // kit has no safe funnel for.
  const backgroundWork = computeBackgroundWork(getJobWorkStats());
  if (backgroundWork) {
    const axis: Record<string, number | string | null> = {
      score: backgroundWork.score,
      rating: backgroundWork.rating,
      measurable: backgroundWork.measurable,
      // The start-up rule (startupEvent): runs started before the process
      // settled are counted apart and never graded.
      settleRule: SETTLE_RULE,
      runs: backgroundWork.runs,
      jobNames: backgroundWork.jobNames,
      otherNames: backgroundWork.otherNames,
      failed: backgroundWork.failed,
      failPct: backgroundWork.failPct,
      retried: backgroundWork.retried,
      retryWorst: backgroundWork.retryWorst,
      overlaps: backgroundWork.overlaps,
      p95Ms: backgroundWork.p95Ms,
      worstMs: backgroundWork.worstMs,
      waitRuns: backgroundWork.waitRuns,
      recurring: backgroundWork.recurring,
      hostedRuns: backgroundWork.hostedRuns,
      manualRuns: backgroundWork.manualRuns,
      attachedSystems: backgroundWork.attachedSystems,
      unattachedSystems: backgroundWork.unattachedSystems,
    };
    // Both of these are OMITTED rather than zeroed when unknown, so "the queue
    // never told us how long a job waited" stays different from "nothing
    // waited", and "no job here has a schedule we are sure of" stays different
    // from "nothing was skipped".
    if (backgroundWork.waitP95Ms !== null) {
      axis.waitP95Ms = backgroundWork.waitP95Ms;
    }
    if (backgroundWork.missed !== null) axis.missed = backgroundWork.missed;
    // Which part set the score, and the capacity reading (finish rate with
    // the window that earned it, busy all window, wait growing beyond its
    // noise). Each is omitted whole when it has nothing to say, so an older
    // reading and "nothing to say" look the same to the server: today's
    // caption.
    Object.assign(axis, decidedFieldsOf(backgroundWork), capacityWireFieldsOf(backgroundWork));
    axes.backgroundWork = axis as unknown as NodeAxisResult;
  }
  if (
    (!backgroundWork || backgroundWork.score === null) &&
    isSettling("startupEvent") &&
    jobWorkSettlingRuns() > 0
  ) {
    // No grade and no run tally: every run so far started before the process
    // settled. What the app DECLARED still rides, because none of it is a
    // start-up measurement: its job names, the rhythms in force (one declared
    // in code is in force from the first exchange) and the job systems seen.
    const declared = getJobWorkStats();
    axes.backgroundWork = settlingReading({
      score: null,
      jobNames: declared.jobNames,
      otherNames: declared.otherNames,
      recurring: declared.recurring,
      attachedSystems: declared.attachedSystems,
      unattachedSystems: declared.unattachedSystems,
    }) as unknown as NodeAxisResult;
  }

  // Upstream cache — the cache verdict declared by the services THIS APP
  // CALLS. Vercel, Cloudflare, Netlify and anything speaking RFC 9211 all
  // declare hit or miss in the reply itself, and nobody reads it.
  //
  // This is deliberately NOT called the project's own hosting cache. A server
  // never sees its own platform's verdict — the CDN stamps that on the way out,
  // after this process has already replied — so the only verdicts reachable
  // here belong to the app's dependencies. Naming it after this project's
  // hosting would attribute a dependency's cache performance to a project that
  // may have no CDN at all. (The browser kit reads this project's own hosting
  // verdict, where the reply really does come from this site.)
  //
  // Replies the platform deliberately bypasses are counted but kept out of the
  // share: a personalised reply SHOULD be served fresh. Absent (never a zero)
  // until ≥20 cacheable replies have declared themselves after the process
  // settled (every first request misses), "still settling" before — an app whose
  // dependencies sit behind plain origins simply never reports this.
  // Additive + display-only: it NEVER feeds the Speed/overall score.
  const edge = getEdgeCacheStats();
  if (edge) {
    // Higher is better here, so the shared lower-is-better helper scores the
    // COMPLEMENT (the share the platform fetched fresh) against the
    // complement of the band.
    const score = linearScore(
      100 - edge.hitPct,
      100 - EDGE_CACHE_THRESHOLDS.good,
      100 - EDGE_CACHE_THRESHOLDS.poor,
    );
    axes.upstreamCache = {
      score,
      rating: ratingFor(score) as Rating,
      // The start-up rule (startupEvent): counters start after settling.
      settleRule: SETTLE_RULE,
      hitPct: edge.hitPct,
      checked: edge.checked,
      hits: edge.hits,
      misses: edge.misses,
      stale: edge.stale,
      bypass: edge.bypass,
    };
  } else if (isSettling("startupEvent") && edgeCacheSettlingVerdicts() > 0) {
    axes.upstreamCache = settlingReading({ score: null }) as unknown as NodeAxisResult;
  }

  // Patch lag — the exposure window between when this build was made and now
  // (frozen at telemetry-enable). Emitted ONLY when the build time is honestly
  // known; otherwise the axis is OMITTED (honest absence — never a fake/warming
  // axis). Additive + display-only: it NEVER feeds the Speed/overall score.
  const patchLag = readPatchLag();
  if (patchLag) {
    // The shared decision (docs/settle-rule-decisions.md, patchLag): the age
    // of a build is not missing patches, and this kit cannot see which patch
    // of the running line is newest. The reading is reported and never
    // graded, in every kit that carries it: the build's age rides for the
    // owner to judge.
    const axis: NodeAxisResult = {
      score: null,
      rating: "not-scored",
      buildAgeMs: patchLag.buildAgeMs,
      buildTimeMs: patchLag.buildTimeMs,
    };
    if (typeof patchLag.depCount === "number")
      axis.depCount = patchLag.depCount;
    axes.patchLag = axis;
  }

  // ── routeFailures ────────────────────────────────────────────────────────
  // App-wide totals for the per-route failure reading. The per-part detail
  // rides `rows` (observed/failed); this axis exists so a reader can tell
  // "this kit reports failures and saw none" from "this kit does not report
  // failures at all" WITHOUT having to interpret the absence of a field on
  // every row. It carries no verdict by design: nothing scores or alerts on
  // this reading, so its rating is permanently "not-scored".
  //
  // OMITTED, NEVER ZEROED, when nothing has been seen. A kit wired without
  // the middleware — attach()-only, a worker with no served requests — stands
  // on no response boundary at all, and `observed: 0` from it would be a
  // fabricated zero that reads as "nothing ever failed here". An absent axis
  // is "nothing seen"; that distinction is the whole point of the reading.
  {
    const t = getRouteOutcomeTotals();
    if (t.parts > 0 || t.untracked > 0) {
      axes.routeFailures = {
        score: null,
        rating: "not-scored",
        parts: t.parts,
        observed: t.observed,
        failed: t.failed,
        // Observations the per-label cap turned away. Reported so the cap is
        // visible rather than silently shrinking the denominator.
        untracked: t.untracked,
        // NO CAPTION, deliberately. Every other axis may ship a worded
        // caption; this one may not. What travels here is a closed set of
        // counts, and a string field is exactly how a closed shape grows to
        // hold a message — a route, a status line, an error. The panel words
        // these numbers itself, in the process that already has them.
      };
    }
  }

  return axes;
}

/** Group `mcp.call.*` samples per tool for the MCP axis. Success and `.error`
 *  samples fold into the SAME tool (the suffix is stripped for grouping and
 *  counted as an error). Label-free past this point — only duration arrays +
 *  error counts reach the scorer. */
/** Has this process served any MCP call at all (settled or not)? */
function hasMcpCalls(): boolean {
  return recent({ limit: SAMPLE_WINDOW }).some((s) => s.name.startsWith(MCP_CALL_PREFIX));
}

function buildMcpToolSeries(): McpToolSeriesLike[] {
  const buf = recent({ limit: SAMPLE_WINDOW });
  const byTool = new Map<string, McpToolSeriesLike>();
  for (const s of buf) {
    if (!s.name.startsWith(MCP_CALL_PREFIX)) continue;
    const isError = s.name.endsWith(MCP_ERROR_SUFFIX);
    // The start-up rule (latencyTail): nothing from the first minute, and never
    // a tool's first successful call, which pays the cold path. A failure is
    // counted wherever it falls.
    if (s.timestamp_ms < settledFromMs("latencyTail")) continue;
    if (!isError && isRouteFirst(s)) continue;
    const key = isError ? s.name.slice(0, -MCP_ERROR_SUFFIX.length) : s.name;
    let t = byTool.get(key);
    if (!t) {
      t = { durations: [], errorCount: 0 };
      byTool.set(key, t);
    }
    t.durations.push(s.duration_ms);
    if (isError) t.errorCount++;
  }
  return [...byTool.values()];
}

/** Build the current privacy-safe snapshot from live in-process state. Pure —
 *  reads only the sample ring, budgets, and findings; performs no I/O. */
export function capturePerfSnapshot(): NodeSnapshotPayload {
  const sum = summary();
  const budgets = allStatuses();
  const findings = collectFindings();
  const now = Date.now();
  // Build identity (frozen at enable) — included only when ANY component is
  // honestly known; omitted entirely otherwise. Never fabricated.
  const build = readBuildIdentity();
  // Dependency inventory — present only when the opt-in was ON at capture.
  const deps = readDepInventory();
  // What this instance observed about its hosting platform. Empty on anything
  // that is not a recognised function host, and empty is omitted.
  const hostFacts = hostFactObservations();
  // The whole route list, asked of the framework. Read HERE rather than at
  // startup: the walk costs the app nothing on boot and never sits in front of
  // a request, and reading it now is what lets a route registered late still
  // appear on the map.
  const routeList = routeListForSnapshot();
  return {
    capturedAt: now,
    runtimeVersion: RUNTIME_VERSION,
    platform: "node",
    // Approximate process boot time from uptime so the meter page can show
    // "running for N" without collecting any timestamp of user activity.
    // The start-up rule's own clock, so the age the server reads is the age
    // every meter judged by.
    startedAt: processStartMs(),
    totalEvents: sum.total,
    rows: buildRows(),
    crossCutting: buildCrossCutting(findings),
    axes: buildAxes(sum, budgets),
    ...(build ? { build } : {}),
    ...(deps ? { deps } : {}),
    ...(peakRetryBurst() > 0
      ? { events: { retryBurstMax10s: peakRetryBurst() } }
      : {}),
    ...(Object.keys(hostFacts).length > 0 ? { hostFacts } : {}),
    // ALWAYS present, whatever the answer was. A kit that can do this says so
    // every time; an absent block means the kit is older than the feature,
    // and that is the only thing it may ever mean.
    routeList,
    // ALWAYS present for the same reason: `routes: []` is "declared nothing".
    declaredWaits: declaredWaitsBlock(),
  };
}

/** Did this window keep anything out as a declared wait? Such a window has
 *  something to say even with no other reading: that every call in it was
 *  declared, which the server turns into "nothing judged". */
function keptOutDeclaredWaits(snap: NodeSnapshotPayload): boolean {
  if (snap.declaredWaits?.routes.some((r) => r.excluded > 0)) return true;
  const net = snap.axes.network as { waitDeclaredExcluded?: unknown } | undefined;
  return typeof net?.waitDeclaredExcluded === "number" && net.waitDeclaredExcluded > 0;
}

/** A snapshot worth uploading has at least one recorded sample or route row —
 *  an empty snapshot from a just-booted app is skipped so we never ship a
 *  content-free payload. */
function hasData(snap: NodeSnapshotPayload): boolean {
  // Events and route rows are the usual evidence. On a function they are not
  // the only kind: a handler invoked directly (a queue message, a scheduled
  // run, an inline handler that never goes through the request middleware)
  // records no route row at all, yet the instance still knows what the run
  // cost, how close it came to its limits and what starting up cost — and the
  // meter page is the only way any of that leaves the machine before it is
  // frozen. Judging that page "empty" would delete the whole reading for
  // exactly the hosts it was built for.
  //
  // Nor is a window in which every call was DECLARED as waiting on purpose
  // (docs/held-open-calls.md): it holds no sample by design, and skipping it
  // would hide the very counts that say why.
  return (
    snap.totalEvents > 0 ||
    snap.rows.length > 0 ||
    snap.axes.serverless !== undefined ||
    keptOutDeclaredWaits(snap)
  );
}

/** Has the route-list-only upload already gone? Process-lifetime state: the
 *  point is to send the list ONCE from an app with no traffic, not to re-send
 *  the same list every tick for as long as the app stays quiet. */
let routeListOnlySent = false;
export type SnapshotSubmitter = (
  snapshot: NodeSnapshotPayload,
) => Promise<number>;

let submitter: SnapshotSubmitter | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

/** Register (or clear) the function that actually ships a snapshot. The
 *  telemetry client sets this to `transmitSnapshot`; clearing it (not just
 *  stopping the timer) is required because `uploadPerfSnapshotNow()` calls the
 *  submitter DIRECTLY, so a stale submitter could leak a snapshot on a manual
 *  flush after the timer stops. */
export function setSnapshotSubmitter(fn: SnapshotSubmitter | null): void {
  submitter = fn;
}

/** Capture + submit one snapshot now (used by the auto-upload tick and by any
 *  caller wanting an immediate flush). No-op without a submitter or data.
 *  Never throws — instrumentation must stay silent. */
export async function uploadPerfSnapshotNow(): Promise<number> {
  if (!submitter || inFlight) return 0;
  const snap = capturePerfSnapshot();
  const measured = hasData(snap);
  const listOnly = !measured && routeListWorthSendingAlone(snap);
  if (!measured && !listOnly) return 0;
  inFlight = true;
  try {
    const shipped = await submitter(snap);
    // Spent only on an ACCEPTED upload. The submitter reports how many
    // snapshots the server took, and it answers 0 for every ordinary refusal
    // it handles itself — no consent yet, no token, an HTTP error, an
    // unreachable server — without throwing. Marking the one-shot on a
    // resolved promise would spend it on exactly those, and a refused first
    // upload must leave the app's list still owed.
    if (listOnly && shipped > 0) routeListOnlySent = true;
    return shipped;
  } catch {
    return 0;
  } finally {
    inFlight = false;
  }
}

/** What a read-now attempt did, in a shape a developer can print. Closed set
 *  of outcomes — a caller learns something whichever way it went. */
export interface ReadNowResult {
  /** Did a reading reach Boosthis? */
  sent: boolean;
  /** Why not, when it did not. One of a closed set, never free prose:
   *  `not-started` (the kit was never switched on, or sharing is off),
   *  `already-reading` (one is in flight), `refused` (the server did not take
   *  it — no consent yet, no token, or it was unreachable), `failed` (the
   *  upload threw). Null when it was sent. */
  reason: "not-started" | "already-reading" | "refused" | "failed" | null;
  /** How many requests this reading had behind it. 0 is the normal answer for
   *  a freshly installed kit and is exactly why the reading is marked. */
  measuredRequests: number;
}

/**
 * TAKE A READING NOW, from an app that may have served nothing at all.
 *
 * The ordinary snapshot, captured the ordinary way, stamped as asked-for and
 * handed to the SAME submitter the timer uses. Nothing is measured differently
 * and nothing is invented: what a process can answer about itself — memory,
 * uptime, its container's ceiling, the build it is running, its own route
 * table — is genuinely known the instant it starts, and what needs a served
 * request is simply absent, which is how every Boosthis surface already words
 * it.
 *
 * The one thing it does that the timer does not is skip {@link hasData}. That
 * gate exists so a quiet app does not pay for a content-free tick every
 * interval; it is precisely wrong for the one upload a developer asked for,
 * because the whole point is a reading before there is traffic to justify one.
 *
 * It makes no request against the host application. Never throws.
 *
 * See docs/on-demand-reading-contract.md.
 */
export async function readNow(): Promise<ReadNowResult> {
  if (!submitter) {
    return { sent: false, reason: "not-started", measuredRequests: 0 };
  }
  if (inFlight) {
    return { sent: false, reason: "already-reading", measuredRequests: 0 };
  }
  const snap: NodeSnapshotPayload = {
    ...capturePerfSnapshot(),
    readingTrigger: READING_TRIGGER_ON_DEMAND,
  };
  const measuredRequests = snap.totalEvents;
  inFlight = true;
  try {
    const shipped = await submitter(snap);
    // A reading that carried the route list and was ACCEPTED spends the
    // one-shot, exactly as the timer's list-only upload does: the list has
    // arrived, and re-sending it every time somebody presses this would be
    // paying for the same sentence twice.
    if (shipped > 0 && !hasData(snap)) routeListOnlySent = true;
    return shipped > 0
      ? { sent: true, reason: null, measuredRequests }
      : { sent: false, reason: "refused", measuredRequests };
  } catch {
    return { sent: false, reason: "failed", measuredRequests };
  } finally {
    inFlight = false;
  }
}

function scheduleNext(): void {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void uploadPerfSnapshotNow().catch(() => {}).finally(() => {
      // Only keep the loop alive while a submitter is still registered.
      if (submitter) scheduleNext();
    });
  }, currentScheduleDelayMs());
  // Never keep the host process alive just for the mirror timer.
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }
}

/** Start the periodic snapshot mirror. Fires one immediate flush (so the AI has
 *  something to read the instant sharing is enabled) then re-uploads every
 *  {@link SNAPSHOT_FLUSH_MS}. Idempotent — a second call while running is a
 *  no-op. */
export function startSnapshotAutoUpload(): void {
  // Seed the turbo session clock on the FIRST start only (idempotent — a second
  // call while running must not reset the ramp).
  if (sessionStartedAt === 0) sessionStartedAt = Date.now();
  // Immediate first tick, then the recurring loop.
  void uploadPerfSnapshotNow();
  scheduleNext();
}

/** Stop the periodic mirror. The submitter is left as-is (the caller clears it
 *  via setSnapshotSubmitter(null) when tearing down) so this only cancels the
 *  timer. */
export function stopSnapshotAutoUpload(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/** @internal test hook — reset module state between hermetic runs. */
export const _snapshotInternals = {
  reset(): void {
    submitter = null;
    inFlight = false;
    sessionStartedAt = 0;
    routeListOnlySent = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  },
  /** @internal test hook — force the turbo session-start clock. */
  setSessionStartedAt(ts: number): void {
    sessionStartedAt = ts;
  },
  get currentScheduleDelayMs(): number {
    return currentScheduleDelayMs();
  },
  get hasSubmitter(): boolean {
    return submitter !== null;
  },
  get isRunning(): boolean {
    return timer !== null;
  },
};

/**
 * A route list is worth ONE upload even from an app that has served nothing.
 *
 * `hasData` exists to stop a content-free payload, and a route table is not
 * content-free: it is the only thing that can put the whole app on the map
 * before traffic arrives, and the privacy page says in as many words that it
 * is the one thing here that travels before any traffic does. Without this an
 * app that had registered its routes and served nobody yet would send
 * nothing, and the page would say "nothing yet" about an app whose list we
 * were holding.
 *
 * Once, though. A quiet app re-sending an unchanged list every tick would be
 * paying for the same sentence for ever; the next upload carries it again as
 * soon as there is any traffic to carry it with.
 */
function routeListWorthSendingAlone(snap: NodeSnapshotPayload): boolean {
  if (routeListOnlySent) return false;
  return (snap.routeList?.entries.length ?? 0) > 0;
}
