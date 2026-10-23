/** Live perf reader for the Node MCP server (read side).
 *
 * Faithful port of the live-data readers in
 * `lib/boosthis-runtime-rn/src/liveData.ts`. This lets the live-read MCP tools
 * (`boosthis.session_summary`, `boosthis.recent_samples`, `boosthis.budgets`,
 * `boosthis.what_should_i_look_at_next`, `boosthis.snapshot`,
 * `boosthis.crash_risk`) return an app's REAL uploaded data instead of the
 * static on-device note — but ONLY when the MCP server has been explicitly
 * handed read credentials for one specific install.
 *
 * SNAPSHOT FALLBACK: the four route-level tools read the RAW per-route sample
 * stream (`/screens/summary`, `/samples/list`), which is off in private /
 * issues-only mode. When that stream is empty/unavailable, each tool falls back
 * to the install's uploaded full perf SNAPSHOT (`/snapshot`) and derives the
 * same triage shapes from it, tagged `source: "boosthis-snapshot"`. The
 * snapshot has no raw per-sample stream, so derived values omit fields it
 * cannot supply (p75, recent-vs-older windows) rather than fabricate them.
 *
 * SECURITY — why config is injected, never read from env here:
 * the same tool handlers in `mcp.ts` are reused by the hosted Streamable-HTTP
 * MCP route, which is shared by EVERY invite-key holder. If this module read
 * `process.env` directly, any install id / token set on the server would leak
 * one install's private data to all callers. So ONLY the stdio entrypoint
 * (`mcp-stdio.ts`) reads env and calls `configureLiveData`; the hosted route
 * never calls it, so its live tools always fall back to the on-device note.
 * Per-call creds (the hosted path) are threaded through `resolveCreds` as a
 * PARAMETER and NEVER written to module state, so one caller's creds can never
 * bleed into the next.
 *
 * Fail-open + fail-soft: any error (not configured, offline, non-200, bad JSON,
 * rate limited, kill-switch) yields `null` so the caller serves the note.
 * Returned rows are additionally run through the PII guard (defense in depth)
 * and any row that trips it is dropped rather than thrown. The final piiSafe
 * pass deliberately EXCLUDES our own shipped constants (the `note`, `source`,
 * and rule-id pointers) — `note` itself is a denylisted field name.
 */

import { checkNoPII } from "./no-pii";
import { readAnswerJson } from "./answerRead";
import { isBoosthisDisabled } from "./runtimeFlags";
import { SCORE_THRESHOLDS } from "./thresholds";
import { nudgeFields, type SymptomStats } from "./symptomHints";

interface LiveDataConfig {
  installId: string;
  token: string;
  baseUrl: string;
}

let config: LiveDataConfig | null = null;

/** Per-call read credentials. Passed as a PARAMETER to the getLive* readers so
 *  the hosted (multi-tenant) MCP route can read ONE install per request WITHOUT
 *  ever mutating module state. The stdio (single-tenant) entrypoint uses
 *  `configureLiveData`. */
export interface LiveCreds {
  installId: string;
  token: string;
  baseUrl?: string;
}

/** Normalize raw creds into a usable config, or null if installId/token blank. */
function normalizeCreds(c: {
  installId?: string;
  token?: string;
  baseUrl?: string;
}): LiveDataConfig | null {
  const installId = (c.installId ?? "").trim();
  const token = (c.token ?? "").trim();
  if (!installId || !token) return null;
  // `||` (not `??`) so a blank var never shadows the fallback.
  const base =
    (c.baseUrl && c.baseUrl.trim()) || "https://www.boosthis.com/api";
  return { installId, token, baseUrl: base.replace(/\/+$/, "") };
}

/** Resolve the config for ONE call: an explicit per-call override (hosted path)
 *  wins; otherwise fall back to the injected module config (stdio path). NEVER
 *  writes module state, so per-call creds can never leak between requests. */
function resolveCreds(override?: LiveCreds): LiveDataConfig | null {
  if (override) return normalizeCreds(override);
  return config;
}

/** Inject the read credentials for ONE install. Called only by the stdio
 *  entrypoint. Passing an empty install id or token clears the config (live
 *  data stays off and the tools serve the on-device note). */
export function configureLiveData(opts: {
  installId?: string;
  token?: string;
  baseUrl?: string;
}): void {
  config = normalizeCreds(opts);
}

export function isLiveDataConfigured(): boolean {
  return config !== null;
}

/** Test-only: clear the injected config so each test starts hermetic. */
export function _resetLiveDataForTests(): void {
  config = null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** The live dashboard read is the one answer larger than the default ceiling
 *  (a snapshot carries every route's numbers). Refused past this, while
 *  reading. */
const LIVE_ANSWER_MAX_BYTES = 2_000_000;

/** GET a JSON body from the configured server with the install bearer token.
 *  Never throws; returns null on any failure. */
async function fetchJson(
  path: string,
  cfg: LiveDataConfig,
): Promise<unknown | null> {
  if (isBoosthisDisabled()) return null;
  try {
    const url = `${cfg.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${cfg.token}`,
        },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      // Bounded while reading, on the same 5s clock as the request: an answer
      // over the ceiling, too slow or not JSON is "no data" (null), and the
      // next read asks again.
      return await readAnswerJson(res, {
        maxBytes: LIVE_ANSWER_MAX_BYTES,
        timeoutMs: 5000,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/** Defense in depth: keep a mapped row only if it passes the PII guard. */
function piiSafe<T>(row: T): boolean {
  return checkNoPII(row) === null;
}

/** Fetch the install's latest stored snapshot object, or null on any failure. */
async function fetchSnapshotObj(
  cfg: LiveDataConfig,
): Promise<Record<string, unknown> | null> {
  const snap = await fetchJson(
    `/snapshot?installId=${encodeURIComponent(cfg.installId)}`,
    cfg,
  );
  if (snap === null || typeof snap !== "object" || Array.isArray(snap)) {
    return null;
  }
  if (!piiSafe(snap)) return null;
  return snap as Record<string, unknown>;
}

// ── Route-level live readers (session_summary / recent_samples / budgets /
// what_should_i_look_at_next) + snapshot fallback ──────────────────────────
// Faithful port of the RN readers. Node route labels take the canonical
// "screen:GET /path" shape in the uploaded snapshot rows, so stripping the
// "screen:" prefix yields the method-path label ("GET /path"). Every mapped row
// is re-run through the PII guard (defense in depth). Wire field names match RN
// exactly (`screen`, `screens`, `routes`, `p50Ms`, …) so the same tool output
// shape lights up across all three runtimes.

type Rating = "good" | "needs-work" | "poor";
type Trend = "improved" | "regressed" | "stable" | "insufficient-data";

interface ScreenStatRow {
  routeLabel?: string;
  sampleCount?: number;
  p50Ms?: number;
  p75Ms?: number;
  p95Ms?: number;
  p99Ms?: number;
  stdevMs?: number;
  spikeRatio?: number | null;
  worstRating?: Rating;
  recentP95Ms?: number | null;
  olderP95Ms?: number | null;
  trend?: Trend;
}

interface SampleRow {
  routeLabel?: string;
  durationMs?: number;
  rating?: Rating;
  ruleId?: string | null;
  createdAt?: string;
}

const SCREEN_PREFIX = "screen:";

const NOTE_LIVE =
  "Live per-route data read from your Boosthis server (full-details " +
  "telemetry). Worst routes first.";

const NOTE_SNAPSHOT_FALLBACK =
  "Derived from your app's latest uploaded Boosthis SNAPSHOT (the full meter " +
  "page). The raw per-sample stream is off (private / issues-only mode with " +
  "shareMeterWithAI), so these are the snapshot's per-route aggregates, " +
  "worst-first. For the complete meter page call boosthis.snapshot.";

/** Classify a route p95 against the shared TTI thresholds. */
function rateMs(ms: number): Rating {
  if (ms <= SCORE_THRESHOLDS.tti.good) return "good";
  if (ms >= SCORE_THRESHOLDS.tti.poor) return "poor";
  return "needs-work";
}

async function fetchScreens(
  windowDays: number,
  cfg: LiveDataConfig,
): Promise<ScreenStatRow[] | null> {
  const data = (await fetchJson(
    `/screens/summary?installId=${encodeURIComponent(cfg.installId)}` +
      `&windowDays=${encodeURIComponent(String(windowDays))}`,
    cfg,
  )) as { screens?: ScreenStatRow[] } | null;
  if (!data || !Array.isArray(data.screens)) return null;
  return data.screens;
}

interface SnapScreenRow {
  screen: string;
  p50Ms: number;
  p95Ms: number;
  sampleCount: number;
  worstRating: Rating;
  p99Ms?: number;
  stdevMs?: number;
  spikeRatio?: number;
}

/** Per-route aggregate rows from the snapshot's `rows` (keys "screen:GET /x"),
 *  worst-first by p95. Each row is re-checked against the PII guard. */
function snapScreenRows(snap: Record<string, unknown>): SnapScreenRow[] {
  const rows = Array.isArray(snap.rows)
    ? (snap.rows as Record<string, unknown>[])
    : [];
  const out: SnapScreenRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const key = typeof r.key === "string" ? r.key : "";
    if (!key.startsWith(SCREEN_PREFIX)) continue;
    const p95 = num(r.p95);
    const p50 = num(r.p50);
    const p99 = typeof r.p99 === "number" && isFinite(r.p99) ? r.p99 : undefined;
    const stdev =
      typeof r.stdev === "number" && isFinite(r.stdev) ? r.stdev : undefined;
    const row: SnapScreenRow = {
      screen: key.slice(SCREEN_PREFIX.length),
      p50Ms: p50,
      p95Ms: p95,
      sampleCount: num(r.count),
      worstRating: rateMs(p95),
      ...(p99 !== undefined ? { p99Ms: p99 } : {}),
      ...(stdev !== undefined ? { stdevMs: stdev } : {}),
      ...(p99 !== undefined && p50 > 0
        ? { spikeRatio: Math.round((p99 / p50) * 10) / 10 }
        : {}),
    };
    if (piiSafe(row)) out.push(row);
  }
  out.sort((a, b) => b.p95Ms - a.p95Ms);
  return out;
}

interface SnapFinding {
  kind: string;
  name: string;
  p95Ms: number;
  count: number;
}

/** Cross-cutting findings from the snapshot — structured fields only. `hint`
 *  is intentionally excluded: it is Boosthis-generated prose the server drops at
 *  ingest/readback, and copying it into MCP output would re-open the plain-text
 *  exfiltration channel that server-side sanitization closes. */
function snapFindings(snap: Record<string, unknown>): SnapFinding[] {
  const arr = Array.isArray(snap.crossCutting)
    ? (snap.crossCutting as Record<string, unknown>[])
    : [];
  const out: SnapFinding[] = [];
  for (const f of arr) {
    if (!f || typeof f !== "object") continue;
    const item: SnapFinding = {
      kind: typeof f.kind === "string" ? f.kind : "unknown",
      name: typeof f.name === "string" ? f.name : "",
      p95Ms: num(f.p95),
      count: num(f.count),
    };
    if (piiSafe(item)) out.push(item);
  }
  return out;
}

/** p50/p75/p95 + per-route worst-rating, worst-first. */
export async function getLiveSessionSummary(
  windowDays = 7,
  creds?: LiveCreds,
): Promise<unknown | null> {
  const cfg = resolveCreds(creds);
  if (!cfg) return null;
  const screens = await fetchScreens(windowDays, cfg);
  if (screens && screens.length > 0) {
    const mapped = screens
      .filter((s) => typeof s.routeLabel === "string")
      .map((s) => ({
        screen: s.routeLabel as string,
        sampleCount: s.sampleCount ?? 0,
        p50Ms: s.p50Ms ?? 0,
        p75Ms: s.p75Ms ?? 0,
        p95Ms: s.p95Ms ?? 0,
        worstRating: s.worstRating ?? "good",
        ...(typeof s.p99Ms === "number" ? { p99Ms: s.p99Ms } : {}),
        ...(typeof s.stdevMs === "number" ? { stdevMs: s.stdevMs } : {}),
        ...(typeof s.spikeRatio === "number" ? { spikeRatio: s.spikeRatio } : {}),
      }))
      .filter(piiSafe);
    return {
      available: true,
      source: "boosthis-server",
      windowDays,
      screens: mapped,
      note: NOTE_LIVE,
    };
  }
  // Fallback: derive per-route aggregates from the uploaded snapshot.
  const snap = await fetchSnapshotObj(cfg);
  if (snap) {
    const rows = snapScreenRows(snap);
    if (rows.length > 0) {
      return {
        available: true,
        source: "boosthis-snapshot",
        windowDays,
        screens: rows.map((r) => ({
          screen: r.screen,
          sampleCount: r.sampleCount,
          p50Ms: r.p50Ms,
          p95Ms: r.p95Ms,
          worstRating: r.worstRating,
          ...(typeof r.p99Ms === "number" ? { p99Ms: r.p99Ms } : {}),
          ...(typeof r.stdevMs === "number" ? { stdevMs: r.stdevMs } : {}),
          ...(typeof r.spikeRatio === "number" ? { spikeRatio: r.spikeRatio } : {}),
        })),
        note: NOTE_SNAPSHOT_FALLBACK,
      };
    }
  }
  return null;
}

/** Most recent raw samples (newest first), optionally filtered by route. */
export async function getLiveRecentSamples(
  limit = 20,
  name?: string,
  creds?: LiveCreds,
): Promise<unknown | null> {
  const cfg = resolveCreds(creds);
  if (!cfg) return null;
  const lim = Math.max(1, Math.min(200, Math.floor(limit) || 20));
  let path =
    `/samples/list?installId=${encodeURIComponent(cfg.installId)}` +
    `&limit=${encodeURIComponent(String(lim))}`;
  if (typeof name === "string" && name.length > 0) {
    path += `&routeLabel=${encodeURIComponent(name)}`;
  }
  const data = (await fetchJson(path, cfg)) as { items?: SampleRow[] } | null;
  if (data && Array.isArray(data.items) && data.items.length > 0) {
    const samples = data.items
      .filter((s) => typeof s.routeLabel === "string")
      .map((s) => ({
        screen: s.routeLabel as string,
        durationMs: s.durationMs ?? 0,
        rating: s.rating ?? "good",
        ruleId: s.ruleId ?? null,
        at: s.createdAt ?? null,
      }))
      .filter(piiSafe);
    return {
      available: true,
      source: "boosthis-server",
      samples,
      count: samples.length,
    };
  }
  // Fallback: the snapshot carries NO raw per-sample stream — point the AI at
  // the aggregate tools instead of fabricating samples.
  const snap = await fetchSnapshotObj(cfg);
  if (snap) {
    return {
      available: true,
      source: "boosthis-snapshot",
      samples: [],
      count: 0,
      note:
        "No individual perf samples are available for this install. The raw " +
        "per-sample stream is uploaded only in full-telemetry mode; private / " +
        "issues-only apps (even with shareMeterWithAI) upload only the aggregate " +
        "snapshot. Use boosthis.session_summary for per-route aggregates or " +
        "boosthis.snapshot for the full meter page.",
    };
  }
  return null;
}

/** Auto-learned baselines per route + regressions (recent vs older p95). */
export async function getLiveBudgets(
  windowDays = 7,
  creds?: LiveCreds,
): Promise<unknown | null> {
  const cfg = resolveCreds(creds);
  if (!cfg) return null;
  const screens = await fetchScreens(windowDays, cfg);
  if (screens && screens.length > 0) {
    const all = screens
      .filter((s) => typeof s.routeLabel === "string")
      .map((s) => ({
        screen: s.routeLabel as string,
        recentP95Ms: s.recentP95Ms ?? null,
        baselineP95Ms: s.olderP95Ms ?? null,
        trend: s.trend ?? "insufficient-data",
      }))
      .filter(piiSafe);
    const regressions = all.filter((r) => r.trend === "regressed");
    return {
      available: true,
      source: "boosthis-server",
      // A DIFFERENT algorithm from the kit's own learned budget, over
      // different data: Boosthis splits the window's uploaded readings into
      // an older and a recent half per route. Named so a reader never mixes
      // its numbers with the device's frozen-baseline verdicts.
      algorithm: "server-window",
      span: `the last ${windowDays} days of readings uploaded from every install of this project`,
      windowDays,
      all,
      regressions,
    };
  }
  // Fallback: the snapshot's Baseline axis surfaces regressions as crossCutting
  // findings (each carries a baseline p95 + delta). Use those for regressions;
  // the snapshot has no recent-vs-older window per route, so `all` lists the
  // current p95 with an insufficient-data trend.
  const snap = await fetchSnapshotObj(cfg);
  if (snap) {
    const all = snapScreenRows(snap).map((r) => ({
      screen: r.screen,
      recentP95Ms: r.p95Ms,
      baselineP95Ms: null as number | null,
      trend: "insufficient-data" as Trend,
    }));
    const cc = Array.isArray(snap.crossCutting)
      ? (snap.crossCutting as Record<string, unknown>[])
      : [];
    const regressions: Array<{
      screen: string;
      recentP95Ms: number;
      baselineP95Ms: number;
      deltaPct: number;
      trend: Trend;
    }> = [];
    for (const f of cc) {
      if (!f || typeof f !== "object" || f.kind !== "regression") continue;
      const base = f.baseline;
      if (!base || typeof base !== "object") continue;
      const b = base as Record<string, unknown>;
      const reg = {
        screen: typeof f.name === "string" ? f.name : "",
        recentP95Ms: num(f.p95),
        baselineP95Ms: num(b.p95),
        deltaPct: num(b.deltaPct),
        trend: "regressed" as Trend,
      };
      if (piiSafe(reg)) regressions.push(reg);
    }
    if (all.length > 0 || regressions.length > 0) {
      return {
        available: true,
        source: "boosthis-snapshot",
        // A third answer again: the snapshot's Baseline axis, computed by the
        // reporting install itself over its own session. Not comparable with
        // either of the other two.
        algorithm: "snapshot-baseline-axis",
        span: "the reporting install's most recent snapshot",
        windowDays,
        all,
        regressions,
        note: NOTE_SNAPSHOT_FALLBACK,
      };
    }
  }
  return null;
}

/**
 * What a capped list of routes is NOT showing.
 *
 * Counted from the routes that REPORTED — never from a route table, a
 * framework's declared list or anything else the app says about itself. A
 * reader of this answer learns how much of the list is missing and nothing
 * whatsoever about how many routes the app is supposed to have.
 *
 * Fields only where something was actually left out, so "complete" and
 * "nobody counted" stay distinguishable.
 */
function routeShortfall(
  reporting: number,
  shown: number,
): Record<string, unknown> {
  const omitted = Math.max(0, reporting - shown);
  if (omitted <= 0) return { routesOmitted: 0, routesReporting: reporting };
  return {
    routesReporting: reporting,
    routesOmitted: omitted,
    routesOmittedNote:
      `Showing ${shown} of ${reporting} routes that reported here — ` +
      `${omitted} route${omitted === 1 ? " is" : "s are"} not listed. Raise ` +
      `the limit to see more.`,
  };
}

/** Proactive triage: worst-rated routes first. */
export async function getLiveWhatNext(
  limit = 5,
  creds?: LiveCreds,
): Promise<unknown | null> {
  const cfg = resolveCreds(creds);
  if (!cfg) return null;
  const lim = Math.max(1, Math.min(50, Math.floor(limit) || 5));
  const screens = await fetchScreens(7, cfg);
  if (screens && screens.length > 0) {
    // How many routes REPORTED, before any cap of ours. A short list that does
    // not say what it left out reads as a complete one, and this list is
    // bounded twice — by the caller's limit and by the PII filter — so the
    // shortfall has to be counted rather than assumed to be zero.
    const labelled = screens.filter((s) => typeof s.routeLabel === "string");
    const routes = labelled
      .map((s) => {
        const p95 = s.p95Ms ?? 0;
        const rating = s.worstRating ?? "good";
        const trend = s.trend ?? "insufficient-data";
        const reason =
          `p95 ${p95}ms · rated ${rating}` +
          (trend === "regressed" ? " · regressing" : "");
        const row = { screen: s.routeLabel as string, p95Ms: p95, worstRating: rating, trend, reason };
        const stats: SymptomStats = {
          worstRating: rating,
          p50Ms: s.p50Ms,
          p99Ms: s.p99Ms,
          spikeRatio: s.spikeRatio ?? undefined,
        };
        return { row, stats };
      })
      .filter((e) => piiSafe(e.row))
      .slice(0, lim)
      // Attach the symptom nudge AFTER the PII filter — these are shipped
      // constants (enum + rule ids + fixed prose), never measured data.
      .map((e) => ({ ...e.row, ...nudgeFields(e.stats) }));
    return {
      available: true,
      source: "boosthis-server",
      routes,
      ...routeShortfall(labelled.length, routes.length),
    };
  }
  // Fallback: worst routes from the snapshot + cross-cutting findings.
  const snap = await fetchSnapshotObj(cfg);
  if (snap) {
    const rows = snapScreenRows(snap);
    const findings = snapFindings(snap);
    if (rows.length > 0 || findings.length > 0) {
      const routes = rows.slice(0, lim).map((r) => ({
        screen: r.screen,
        p95Ms: r.p95Ms,
        worstRating: r.worstRating,
        trend: "insufficient-data" as Trend,
        reason: `p95 ${r.p95Ms}ms · rated ${r.worstRating}`,
        // snapScreenRows already passed the PII guard; nudge is shipped constants.
        ...nudgeFields({
          worstRating: r.worstRating,
          p50Ms: r.p50Ms,
          p99Ms: r.p99Ms,
          spikeRatio: r.spikeRatio,
        }),
      }));
      return {
        available: true,
        source: "boosthis-snapshot",
        routes,
        ...routeShortfall(rows.length, routes.length),
        findings: findings.slice(0, lim),
        findingsOmitted: Math.max(0, findings.length - lim),
        note: NOTE_SNAPSHOT_FALLBACK,
      };
    }
  }
  return null;
}

const NOTE_SNAPSHOT =
  "Live full-bubble snapshot read from your Boosthis server (the whole meter " +
  "page — boot ladder, per-route rows, cross-cutting findings, axes, summary).";

/** The WHOLE bubble for one install — the latest full perf snapshot the app
 *  uploaded (every meter + axis the dashboard shows). Returns null on any
 *  failure (not configured, offline, non-200, no snapshot yet, PII trip) so the
 *  caller serves the on-device note. The snapshot already passed the upload PII
 *  guard; we re-check here (defense in depth) and drop it rather than throw. */
export async function getLiveSnapshot(
  creds?: LiveCreds,
): Promise<unknown | null> {
  const cfg = resolveCreds(creds);
  if (!cfg) return null;
  const snap = await fetchSnapshotObj(cfg);
  if (snap === null) return null;
  return {
    available: true,
    source: "boosthis-server",
    snapshot: snap,
    note: NOTE_SNAPSHOT,
  };
}

// ── Potential-crashes risk feed ────────────────────────────────────────────
// The READ side of the "what is likely to crash my app" channel. The runtime
// already records each crash class it has actually hit (uncaught error,
// unhandled promise rejection, caught render near-miss) as a privacy-safe
// signature — error name, a redacted top frame, a count bucket. GET
// /crashes/risk joins those with the JS-thread (event-loop) Stability summary
// from the latest snapshot; this reader fetches that joined view, fail-opens to
// null (caller serves the on-device note), and attaches STATIC rule-id pointers
// so the AI knows which Node-pack rules to fetch with boosthis.get_rule.

const NOTE_CRASH_RISK =
  "Potential-crashes risk feed read from your Boosthis server: the crash " +
  "classes your app has ALREADY recorded (uncaught errors, unhandled promise " +
  "rejections, and caught render near-misses), newest-first, joined with the " +
  "event-loop (ANR-style) Stability summary from your latest snapshot. Each " +
  "crash class carries relatedRules — fetch them with boosthis.get_rule for the " +
  "fix. Signatures are code-derived (error name + redacted frame), never the " +
  "raw error message, so no user value is exposed.";

// Static, shipped map from a crash KIND to the Node-pack rule ids most likely to
// prevent it. Deterministic (no server round-trip): the matcher/rule book holds
// the fix text; this only points the AI at the right rules for each crash class.
//
// NOTE: the RN runtime's crash-rule ids (remote-null-field-read,
// unsafe-json-response-parse, …) do NOT exist in the 72-rule Node pack, so these
// are the nearest analogous Node-pack ids (see checklist.ts): unbounded input
// handling + missing timeouts are the Node-side crash/stability analogues.
const DEFAULT_CRASH_RULES = [
  "unbounded-json-body",
  "regex-redos",
  "fetch-no-timeout-node",
];
const CRASH_KIND_RULES: Record<string, string[]> = {
  uncaught: DEFAULT_CRASH_RULES,
  unhandledRejection: [
    "fetch-no-timeout-node",
    "db-query-no-timeout",
    "client-retry-storm",
  ],
  render: DEFAULT_CRASH_RULES,
};

// Rules that address event-loop hangs / ANR-style stability (the snapshot's
// Stability axis), independent of any single crash class.
const STABILITY_RULES = [
  "event-loop-monitoring-missing",
  "sync-fs-in-handler",
  "sync-crypto-on-hot-path",
];

interface CrashRiskItem {
  signature?: string;
  errorName?: string;
  kind?: string;
  redactedFrame?: string;
  countBucket?: string;
  occurrences?: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
}

/** The install's already-recorded crash classes + Stability summary, with rule
 *  pointers. Fail-open: any failure (not configured, offline, non-200, bad JSON,
 *  PII trip) returns null so the caller serves the on-device note. NEVER mutates
 *  module state — per-call creds are threaded through resolveCreds only. */
export async function getLiveCrashRisk(
  creds?: LiveCreds,
): Promise<unknown | null> {
  const cfg = resolveCreds(creds);
  if (!cfg) return null;
  const data = (await fetchJson(
    `/crashes/risk?installId=${encodeURIComponent(cfg.installId)}`,
    cfg,
  )) as {
    crashClasses?: number;
    totalOccurrences?: number;
    crashes?: CrashRiskItem[];
    stability?: Record<string, unknown>;
  } | null;
  if (!data) return null;

  const crashesIn = Array.isArray(data.crashes) ? data.crashes : [];
  const crashes = crashesIn
    .map((c) => {
      const kind = typeof c.kind === "string" ? c.kind : "uncaught";
      return {
        signature: typeof c.signature === "string" ? c.signature : "",
        errorName: typeof c.errorName === "string" ? c.errorName : "",
        kind,
        redactedFrame:
          typeof c.redactedFrame === "string" ? c.redactedFrame : "",
        countBucket: typeof c.countBucket === "string" ? c.countBucket : "",
        occurrences: num(c.occurrences),
        firstSeenAt: typeof c.firstSeenAt === "string" ? c.firstSeenAt : null,
        lastSeenAt: typeof c.lastSeenAt === "string" ? c.lastSeenAt : null,
        relatedRules: CRASH_KIND_RULES[kind] ?? DEFAULT_CRASH_RULES,
      };
    })
    .filter(piiSafe);

  const stabilityRaw =
    data.stability &&
    typeof data.stability === "object" &&
    !Array.isArray(data.stability)
      ? (data.stability as Record<string, unknown>)
      : null;
  const stability = stabilityRaw && piiSafe(stabilityRaw) ? stabilityRaw : null;

  // Defense in depth over the SERVER-SUPPLIED data only. `note`/`source`/the
  // rule-id pointers are our own shipped constants, not server data — and the
  // field name "note" itself trips the guard — so the final check excludes them.
  if (!piiSafe({ crashes, stability })) return null;

  return {
    available: true,
    source: "boosthis-server",
    crashClasses: num(data.crashClasses),
    totalOccurrences: num(data.totalOccurrences),
    crashes,
    stability,
    stabilityRules: STABILITY_RULES,
    note: NOTE_CRASH_RISK,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Full-stack trace read (Stage 2 flagship)
// ───────────────────────────────────────────────────────────────────────────

const NOTE_FULL_STACK_TRACE =
  "Latest full-stack trace read from your Boosthis server: one user action " +
  "stitched across the layers this install recorded, as a waterfall of spans " +
  "(layer, code-defined route label, duration, start offset, rating) plus an " +
  "honest full-stack score rated against the shared TTI thresholds. Each " +
  "span's slowestLayerRules point at the rules most likely to fix that " +
  "layer — fetch them with boosthis.get_rule. NOTE: a per-install read token " +
  "is self-scoped, so this shows only THIS install's own spans; pass an " +
  "account_token on the hosted MCP to unlock the full stitched " +
  "RN \u2192 Node \u2192 Python waterfall across all your apps.";

// Static, shipped map from a span's LAYER to the rule ids most likely to fix a
// slow span in that layer. Deterministic (no server round-trip): the matcher /
// rule book holds the fix text; this only points the AI at the right rules.
const LAYER_RULES: Record<string, string[]> = {
  rn: [
    "per-item-fetch-waterfall",
    "client-refetch-no-cache",
    "screen-load-budget-500ms-p75",
    "oversized-thumbnail-fetch",
  ],
  node: [
    "sync-fs-in-handler",
    "await-in-loop",
    "n-plus-one-orm-node",
    "no-keepalive-outbound",
  ],
  py: [
    "n-plus-one-orm-query",
    "sync-io-in-async-handler",
    "fastapi-sync-route-blocks-event-loop",
    "db-statement-timeout-missing",
  ],
};

interface TraceReadSpanItem {
  layer?: string;
  routeLabel?: string;
  durationMs?: number;
  startOffsetMs?: number;
  rating?: string;
  isRoot?: boolean;
}

/** The install's own latest full-stack trace waterfall, with rule pointers for
 *  the slowest span's layer. Fail-open: any failure (not configured, offline,
 *  non-200 / no trace yet, bad JSON, PII trip) returns null so the caller
 *  serves the on-device note. NEVER mutates module state — per-call creds are
 *  threaded through resolveCreds only. */
export async function getLiveFullStackTrace(
  creds?: LiveCreds,
): Promise<unknown | null> {
  const cfg = resolveCreds(creds);
  if (!cfg) return null;
  const data = (await fetchJson(
    `/traces/latest?installId=${encodeURIComponent(cfg.installId)}`,
    cfg,
  )) as {
    traceId?: string;
    spanCount?: number;
    layers?: unknown[];
    rootLayer?: string;
    rootDurationMs?: number;
    score?: number;
    scoreRating?: string;
    summary?: string;
    slowest?: TraceReadSpanItem;
    spans?: TraceReadSpanItem[];
  } | null;
  if (!data) return null;

  const mapSpan = (s: TraceReadSpanItem) => ({
    layer: typeof s.layer === "string" ? s.layer : "",
    routeLabel: typeof s.routeLabel === "string" ? s.routeLabel : "",
    durationMs: num(s.durationMs),
    startOffsetMs: num(s.startOffsetMs),
    rating: typeof s.rating === "string" ? s.rating : "",
    isRoot: s.isRoot === true,
  });

  const spansIn = Array.isArray(data.spans) ? data.spans : [];
  const spans = spansIn.map(mapSpan).filter(piiSafe);

  const slowestRaw =
    data.slowest && typeof data.slowest === "object" ? data.slowest : null;
  const slowestMapped = slowestRaw ? mapSpan(slowestRaw) : null;
  const slowest =
    slowestMapped && piiSafe(slowestMapped) ? slowestMapped : null;

  const layers = (Array.isArray(data.layers) ? data.layers : []).filter(
    (l): l is string => typeof l === "string",
  );

  const traceId = typeof data.traceId === "string" ? data.traceId : "";
  const summary = typeof data.summary === "string" ? data.summary : "";

  // Defense in depth over the SERVER-SUPPLIED data only. `note`/`source`/the
  // rule-id pointers are our own shipped constants, not server data — and the
  // field name "note" itself trips the guard — so the final check excludes them.
  if (!piiSafe({ traceId, layers, summary, slowest, spans })) return null;

  return {
    available: true,
    source: "boosthis-server",
    traceId,
    spanCount: num(data.spanCount),
    layers,
    rootLayer: typeof data.rootLayer === "string" ? data.rootLayer : null,
    rootDurationMs: num(data.rootDurationMs),
    score: num(data.score),
    scoreRating:
      typeof data.scoreRating === "string" ? data.scoreRating : null,
    summary,
    slowest,
    slowestLayerRules:
      slowest && LAYER_RULES[slowest.layer] ? LAYER_RULES[slowest.layer] : [],
    spans,
    note: NOTE_FULL_STACK_TRACE,
  };
}
