/* ─── Boosthis: process & diagnostics meter collectors (2026-08, batch 2) ──
 *
 * The 13 remaining honest Node meters from the toward-50 research
 * (suggestions/meter-research-toward-50-2026-08.md, Node section). Same
 * doctrine as extraMeters.ts / runtimeVitals.ts: ADDITIVE display-only axes
 * that never feed the Speed score, counts/durations/coarse buckets only
 * (never a name, URL, payload or value), bounded memory, honest omission
 * while warming or when the environment cannot provide the signal, and every
 * collector guest-safe (never throws into the host, no-op under the
 * kill-switch, no background pollers — sampling rides existing request /
 * snapshot boundaries).
 *
 * Always-on (warm with ordinary uptime — the server renders them as
 * "warming up" tiles until the gate passes):
 *   • cpuConsumption   — process CPU time vs wall time (resourceUsage).
 *   • residentGrowth   — resident-set slope, catches native growth V8 hides.
 *   • nativeMemoryMix  — external + ArrayBuffer share of the RSS footprint.
 *   • uptimeStability  — wall-clock vs process.uptime() drift (suspends).
 *   • heapSpacePressure— the most-occupied individual V8 heap space.
 *   • codeCachePressure— V8 code + bytecode metadata footprint.
 *   • arrayBufferRetention — retained ArrayBuffer floor + growth.
 *
 * Env-gated (honestly absent unless the host opts in — never a warming tile):
 *   • eventLoopDelayTail / eventLoopDelayMax — BOOSTHIS_EVENT_LOOP_HISTOGRAM=1
 *     (a second monitorEventLoopDelay histogram, windowed p95/p99 + worst).
 *   • perfEntryBacklog — BOOSTHIS_PERF_ENTRIES=1 (unconsumed performance
 *     entries; length only, entries are never read).
 *   • asyncResourceDiversity — BOOSTHIS_ASYNC_RESOURCE_TYPES=1 (distinct
 *     async resource TYPE count; types are never uploaded, only the count).
 *   • diagnosticErrorVolume / diagnosticActivity — BOOSTHIS_DIAGNOSTICS=1
 *     plus an explicit BOOSTHIS_DIAGNOSTICS_CHANNELS allowlist (counts only;
 *     an event is looked at only to see whether it carries an error — an
 *     Error, or an `error` field — and nothing from it is kept; channel names
 *     never leave the process).
 *
 * Dropped from the research list, with reasons (task requires them written):
 *   • #12 Async Context Loss, #15 Worker Utilization Spread, #16 Worker
 *     Message Backlog, #17 Undici Pool Queueing, #19 Trace-Event Throughput —
 *     parked in the research doc itself: each needs host integration or
 *     global tracing state a drop-in kit must not take.
 *   • #18 HTTP Agent Socket Balance — requires the host to register its
 *     http.Agent objects with the kit; under the drop-in rule that is the
 *     same class of shim as #17, so it is parked, not shipped.
 *   • #20 Active Resource Composition — getActiveResourcesInfo()'s coarse
 *     type mix restates the existing active-handle growth axis plus
 *     asyncResourceDiversity's type-count signal; shipping it as a third
 *     tile would be the padding the research doc forbids.
 */

import { isBoosthisDisabled } from "./runtimeFlags";
/* Node built-ins are reached through STATIC imports, never a lazy CommonJS
 * load. This kit ships as ESM, where there is no `require`, so every `node:`
 * built-in fetched that way threw inside its defensive try/catch on the
 * customer's first call and left its meter silently reporting nothing. See
 * __tests__/esmBuiltinAccess.test.ts, the guard that keeps it that way. */
import { createHook } from "node:async_hooks";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { getHeapCodeStatistics, getHeapSpaceStatistics } from "node:v8";

import { linearScore, ratingFor } from "./healthAxes";
import type { ExtraAxis } from "./extraMeters";
// The kit's caption is stripped at ingest (a kit may not put prose on the
// wire), so a reading that refuses to score itself has to say WHY with a code
// from the closed list. Both readings below refuse for the same reason: V8
// publishes no ceiling for either number, so there is nothing to be a
// percentage OF.
import {
  REASON_NOTHING_TO_COMPARE,
  REASON_PLATFORM_DOES_NOT_EXPOSE,
} from "./serverlessPlatform";
// The one correction shared by every meter in this kit that scores the slope
// of a fitted line. See trendVerdict.ts for what `Math.max(slope, 0)` got
// wrong and why the verdict is now taken at the top of the estimate's own
// uncertainty instead.
import { judgeTrend } from "./trendVerdict";
// The start-up rule (docs/settle-rule-contract.md): one settle helper for the
// whole kit decides what a reading may look at.
import {
  isSettling,
  markSettled,
  persistentGrowthPerMin,
  settledFromMs,
  settledSlope,
  settledSpanMs,
  settlingReading,
  spanJudgeable,
} from "./settleRule";

import {
  earnedPerHour,
  earnedPerMin,
  minuteText,
  overWords,
  windowMinOf,
  windowPhrase,
} from "./rateHonesty";
const r1 = (n: number): number => Math.round(n * 10) / 10;

let started = false;
let startedAt = 0;

/* ── Env gates (re-read on start so tests can toggle) ────────────────────*/

function envTrue(name: string): boolean {
  try {
    const v = process.env[name];
    return v === "1" || v === "true" || v === "yes" || v === "on";
  } catch {
    return false;
  }
}

/* ── Boundary sampler (no background pollers) ────────────────────────────
 * Called from the middleware response boundary and from snapshot assembly;
 * throttled so a hot server pays one cheap read burst every SAMPLE_MIN_MS. */
const SAMPLE_MIN_MS = 5_000;
/** Turbo first-run sampling: for the first {@link TURBO_SAMPLE_WINDOW_MS} of a
 *  session, sample these CHEAP counter reads (process.memoryUsage, resourceUsage,
 *  v8 heap stats — no /proc walks, no syscalls of note) every
 *  {@link TURBO_SAMPLE_MIN_MS} so trend/pressure meters warm in seconds instead
 *  of minutes; afterwards we revert to the steady {@link SAMPLE_MIN_MS} throttle.
 *  This only makes existing sampling denser early — no honesty gate moves. */
const TURBO_SAMPLE_MIN_MS = 1_000;
const TURBO_SAMPLE_WINDOW_MS = 180_000;
/** Effective throttle for the boundary sampler given the current session age.
 *  Honours `BOOSTHIS_TURBO=0` (and only that exact value) as an opt-out. */
function sampleThrottleMs(now: number): number {
  let turboOff = false;
  try {
    turboOff = process.env.BOOSTHIS_TURBO === "0";
  } catch {
    turboOff = false;
  }
  if (turboOff || startedAt === 0) return SAMPLE_MIN_MS;
  return now - startedAt < TURBO_SAMPLE_WINDOW_MS
    ? TURBO_SAMPLE_MIN_MS
    : SAMPLE_MIN_MS;
}
const RING_CAP = 240;
let lastSampledAt = 0;

interface ProcSample {
  t: number;
  rssMb: number | null;
  externalMb: number | null;
  arrayBufferMb: number | null;
  heapTotalMb: number | null;
  uptimeSec: number | null;
  cpuMs: number | null; // cumulative user+system CPU ms
}
const samples: ProcSample[] = [];

/** Latest v8 space readings (kept as scalars, not per-space history). */
let worstSpacePct: number | null = null;
let spaceCount = 0;
let spaceSkipped = 0;
let spaceSamples = 0;
let codeCacheMb: number | null = null;
let codeCacheSamples = 0;

/** Cumulative wall-vs-uptime drift for uptimeStability. */
let driftMs = 0;
let uptimeSupported = true;

/** perfEntryBacklog ring (env-gated). */
let perfEntriesEnabled = false;
interface CountSample { t: number; n: number }
const perfEntrySamples: CountSample[] = [];

function readMemoryUsage(): {
  rss: number; external: number; arrayBuffers: number; heapTotal: number;
} | null {
  try {
    const mu = process.memoryUsage();
    if (!mu || typeof mu.rss !== "number") return null;
    return {
      rss: mu.rss,
      external: typeof mu.external === "number" ? mu.external : 0,
      arrayBuffers: typeof mu.arrayBuffers === "number" ? mu.arrayBuffers : 0,
      heapTotal: typeof mu.heapTotal === "number" ? mu.heapTotal : 0,
    };
  } catch {
    return null;
  }
}

const MB = 1024 * 1024;

/** Take one boundary sample of every process-level series. Throttled,
 *  guest-safe, never throws. Exported for the middleware boundary. */
export function sampleProcessMeters(now = Date.now()): void {
  if (isBoosthisDisabled() || !started) return;
  if (now - lastSampledAt < sampleThrottleMs(now)) return;
  lastSampledAt = now;
  try {
    const mu = readMemoryUsage();
    let cpuMs: number | null = null;
    try {
      const ru = (process as unknown as {
        resourceUsage?: () => { userCPUTime: number; systemCPUTime: number };
      }).resourceUsage?.();
      if (ru && typeof ru.userCPUTime === "number") {
        cpuMs = (ru.userCPUTime + ru.systemCPUTime) / 1000; // µs → ms
      }
    } catch {
      cpuMs = null;
    }
    let uptimeSec: number | null = null;
    try {
      const u = process.uptime();
      if (typeof u === "number" && Number.isFinite(u)) uptimeSec = u;
    } catch {
      uptimeSupported = false;
    }
    const prev = samples[samples.length - 1];
    if (prev && uptimeSec !== null && prev.uptimeSec !== null) {
      // Wall time that passed vs process time that passed: any positive gap
      // means the process was frozen/suspended (cgroup freeze, host sleep).
      const wallDelta = now - prev.t;
      const upDelta = (uptimeSec - prev.uptimeSec) * 1000;
      const gap = wallDelta - upDelta;
      if (Number.isFinite(gap) && gap > 250) driftMs += gap;
    }
    samples.push({
      t: now,
      rssMb: mu ? mu.rss / MB : null,
      externalMb: mu ? mu.external / MB : null,
      arrayBufferMb: mu ? mu.arrayBuffers / MB : null,
      heapTotalMb: mu ? mu.heapTotal / MB : null,
      uptimeSec,
      cpuMs,
    });
    if (samples.length > RING_CAP) samples.shift();

    // V8 heap spaces + code cache (cheap struct reads).
    //
    // Two reads, two try blocks, on purpose. They used to share one, which
    // meant the FIRST one to be refused took the second down with it: an
    // engine that implements the code-cache read but not the per-space read
    // would lose both, and the second axis would go blank for a reason that
    // has nothing to do with it. (Bun refuses both today, so nothing changes
    // there — but a shared catch that hides an unrelated capability is a
    // silent fault waiting for the next runtime, and splitting it costs
    // nothing.)
    try {
      const spaces = getHeapSpaceStatistics();
      if (Array.isArray(spaces)) {
        let worst = 0;
        let counted = 0;
        let skipped = 0;
        for (const s of spaces) {
          if (!s || typeof s.space_size !== "number" || s.space_size <= 0) continue;
          if (!spaceCanShowPressure(s.space_name)) {
            skipped++;
            continue;
          }
          counted++;
          const pct = (100 * s.space_used_size) / s.space_size;
          if (pct > worst) worst = pct;
        }
        if (counted > 0) {
          worstSpacePct = worst;
          spaceCount = counted;
          spaceSkipped = skipped;
          spaceSamples++;
        }
      }
    } catch {
      /* best-effort — a refused struct read leaves heapSpacePressure absent */
    }
    try {
      const code = getHeapCodeStatistics();
      if (code && typeof code.code_and_metadata_size === "number") {
        codeCacheMb =
          (code.code_and_metadata_size + (code.bytecode_and_metadata_size || 0)) / MB;
        codeCacheSamples++;
      }
    } catch {
      /* best-effort — a refused struct read leaves codeCachePressure absent */
    }

    // Performance-entry backlog (env-gated; length only).
    if (perfEntriesEnabled) {
      try {
        const perf = (globalThis as {
          performance?: { getEntries?: () => unknown[] };
        }).performance;
        const n = perf?.getEntries?.().length;
        if (typeof n === "number" && Number.isFinite(n)) {
          perfEntrySamples.push({ t: now, n });
          if (perfEntrySamples.length > RING_CAP) perfEntrySamples.shift();
        }
      } catch {
        /* honestly absent */
      }
    }
  } catch {
    /* sampling must never disturb the host */
  }
}

function series(pick: (s: ProcSample) => number | null): Array<{ t: number; v: number }> {
  const out: Array<{ t: number; v: number }> = [];
  for (const s of samples) {
    const v = pick(s);
    if (v !== null && Number.isFinite(v)) out.push({ t: s.t, v });
  }
  return out;
}

function spanMs(pts: Array<{ t: number; v: number }>): number {
  return pts.length < 2 ? 0 : pts[pts.length - 1]!.t - pts[0]!.t;
}

/* ── 1. CPU consumption ──────────────────────────────────────────────────*/
const CPU_GOOD_PCT = 70;   // ≤70% of one CPU sustained is fine
const CPU_POOR_PCT = 100;  // a full core pegged over the window
const MIN_CPU_SAMPLES = 3;

export function readCpuConsumption(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    const all = series((s) => s.cpuMs);
    if (all.length === 0) return null;
    const now = Date.now();
    // The start-up rule (peakRate): the share is taken over the settled
    // window only. Loading modules and filling the first caches is not load,
    // and a lifetime average would carry it for hours.
    if (isSettling("peakRate", now)) return settlingReading({ score: null });
    const from = settledFromMs("peakRate");
    const pts = all.filter((p) => p.t >= from);
    if (pts.length < MIN_CPU_SAMPLES) return null;
    const wall = spanMs(pts);
    if (!spanJudgeable(wall)) return null;
    const cpu = pts[pts.length - 1]!.v - pts[0]!.v;
    const cpuPct = r1(Math.max(0, (100 * cpu) / wall));
    const score = linearScore(cpuPct, CPU_GOOD_PCT, CPU_POOR_PCT);
    return markSettled({
      score,
      rating: ratingFor(score),
      cpuPct,
      sampleCount: pts.length,
      caption: `${cpuPct}% of one CPU over the window`,
    });
  } catch {
    return null;
  }
}

/* ── 2. Resident growth ──────────────────────────────────────────────────*/
const RESIDENT_GROWTH_GOOD_MB_MIN = 0.5;
const RESIDENT_GROWTH_POOR_MB_MIN = 5;
const MIN_TREND_SAMPLES = 12;
/**
 * Wall-clock the JUDGED samples must cover, after the warm-up exclusion.
 *
 * Was sixty seconds, and sixty seconds starting at boot is a measurement of
 * the process starting up. A tester bundling his app — a path we document —
 * got 3.7 MB/min unbundled and 5.1 MB/min bundled from the same install, the
 * same state directory and the same 120-request load, and the BUNDLED process
 * (the one using LESS total resident memory) was rated worse. Bundling loads
 * more code faster, so a window that begins at boot reads it as faster growth.
 *
 * Five minutes, after a minute of warm-up is discarded, is long enough that
 * the estimate is about the running app rather than about how quickly it
 * loaded its code.
 */
const MIN_TREND_SPAN_MS = 300_000;
/** Samples taken inside the first minute of a process are its startup. */
const TREND_WARMUP_MS = 60_000;
/**
 * How far RSS must be projected to have climbed across the judged window
 * before the rate is allowed to cost anything.
 *
 * The absolute figure used to be carried in the payload and then ignored —
 * only the slope was scored, which is how a process holding less memory was
 * rated worse than one holding more. Thirty megabytes is a noticeable slice of
 * an ordinary small container, so below it there is a rate but nothing yet
 * worth telling anyone about. It is a FLOOR, never a divisor: dividing a
 * growth rate by the level it is growing would make a leak improve its own
 * score as it got worse.
 */
const RESIDENT_GROWTH_RISE_FLOOR_MB = 30;
const RESIDENT_GROWTH_FLOOR_BUCKET_MS = 15_000;

export function readResidentGrowth(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    const pts = series((s) => s.rssMb);
    const trend = judgeTrend(pts, {
      good: RESIDENT_GROWTH_GOOD_MB_MIN,
      poor: RESIDENT_GROWTH_POOR_MB_MIN,
      minSamples: MIN_TREND_SAMPLES,
      minSpanMs: MIN_TREND_SPAN_MS,
      warmupMs: TREND_WARMUP_MS,
      startedAt,
      riseFloor: RESIDENT_GROWTH_RISE_FLOOR_MB,
      floorBucketMs: RESIDENT_GROWTH_FLOOR_BUCKET_MS,
      minFloorBuckets: 6,
      abstainAroundZero: true,
    });
    if (!trend) return null;
    const growthMbPerMin = r1(trend.perMin);
    const slopeSeMbPerMin = r1(trend.slopeSePerMin);
    const rssMb = r1(trend.judged[trend.judged.length - 1]!.v);
    const windowMin = windowMinOf(trend.spanMs);
    // The samples are consistent with a flat process AND with a climbing one.
    // The counts are real and still ship; the verdict does not, and the kit
    // sends the CODE for why (the words belong to the server).
    if (trend.score === null) {
      return {
        score: null,
        // One word for one silence, shared with its three siblings: a
        // withheld trend verdict is a wait for a calmer window, and the
        // server writes "could not tell" from the reason code. "not-scored"
        // means never graded by design, which this is not.
        rating: "pending",
        reasonCode: trend.reasonCode,
        growthMbPerMin,
        slopeSeMbPerMin,
        rssMb,
        windowMin,
        sampleCount: trend.sampleCount,
        caption: `resident memory ${rssMb} MB · moves too much over ${overWords(windowMin)} to call a trend`,
      };
    }
    const riseMb = r1(trend.rise);
    // A climb the rate projects but the floor has not let cost anything: say
    // both halves, or the reader sees a green tile beside a positive rate and
    // cannot tell which number the score believed.
    if (trend.score >= 100 && growthMbPerMin > 0) {
      return {
        score: trend.score,
        rating: ratingFor(trend.score),
        growthMbPerMin,
        slopeSeMbPerMin,
        rssMb,
        windowMin,
        sampleCount: trend.sampleCount,
        caption: `resident memory ${rssMb} MB · +${growthMbPerMin} MB/min is ${riseMb} MB over ${overWords(windowMin)}, too little to call a climb`,
      };
    }
    const score = trend.score;
    return {
      score,
      rating: ratingFor(score),
      growthMbPerMin,
      slopeSeMbPerMin,
      rssMb,
      windowMin,
      sampleCount: trend.sampleCount,
      caption:
        growthMbPerMin <= 0
          ? `resident memory flat at ${rssMb} MB`
          : `resident memory climbing ${growthMbPerMin} MB/min`,
    };
  } catch {
    return null;
  }
}

/* ── 3. Native memory mix ────────────────────────────────────────────────*/
const MIN_MIX_SAMPLES = 5;

export function readNativeMemoryMix(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    const pts = samples.filter(
      (s) => s.rssMb !== null && s.rssMb > 0 && s.externalMb !== null,
    );
    if (pts.length < MIN_MIX_SAMPLES) return null;
    const last = pts[pts.length - 1]!;
    const externalMb = r1(last.externalMb!);
    const arrayBufferMb = r1(last.arrayBufferMb ?? 0);
    const nativePct = r1(Math.min(100, (100 * (last.externalMb! )) / last.rssMb!));
    // The shared decision: the share of external memory (buffers and native
    // add-ons, which is neither all native memory nor pressure) is reported,
    // never graded. No mix is healthy or unhealthy on its own.
    return {
      score: null,
      rating: "not-scored",
      nativePct,
      externalMb,
      arrayBufferMb,
      caption: `${nativePct}% of resident memory is external (buffers and add-ons)`,
    };
  } catch {
    return null;
  }
}

/* ── 4. Process uptime stability ─────────────────────────────────────────*/
const DRIFT_QUIET_PCT = 1;
const MIN_UPTIME_OBSERVED_MS = 5 * 60_000;

export function readUptimeStability(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started || !uptimeSupported) return null;
  try {
    const pts = series((s) => s.uptimeSec);
    if (pts.length < 2) return null;
    const observed = spanMs(pts);
    if (observed < MIN_UPTIME_OBSERVED_MS) return null;
    const uptimeMin = r1(pts[pts.length - 1]!.v / 60);
    const observedMin = windowMinOf(observed);
    const driftPct = r1(Math.min(100, (100 * driftMs) / observed));
    // The shared decision (every kit carrying it): a gap between the wall
    // clock and the process clock is a clock adjustment or a host pause, not
    // instability of a process that never stopped serving; restarts belong to
    // the server's restart chain. The drift is reported, never graded.
    return markSettled({
      score: null,
      rating: "not-scored" as const,
      uptimeMin,
      observedMin,
      driftPct,
      caption:
        driftPct <= DRIFT_QUIET_PCT
          ? `continuously alive · ${windowPhrase(observedMin)}`
          : `the wall clock moved ${driftPct}% apart from the process clock`,
    });
  } catch {
    return null;
  }
}

/* ── 5. Heap-space composition ───────────────────────────────────────────*/
//
// REPORTED, NEVER RATED — and that is the whole point of this axis now.
//
// This used to score the fullest space's used/size ratio (good 85%, poor 99%)
// and it was pinned to POOR on every Node process in existence. The reason is
// that `space_size` is what V8 has COMMITTED, not a ceiling: V8 commits pages
// to meet demand, so a space in use is a space that is nearly full. Measured
// on an idle process at boot, then holding ~100 MB, then under heavy
// short-lived churn:
//
//   large_object_space       98.5%  ·  99.8%  ·  99.9%   (one page per object)
//   new_large_object_space      —   ·  99.9%  ·     —
//   old_space                92.8%  ·  99.6%  ·  98.9%   (grows on demand)
//   trusted_space            67.8%  ·  71.3%  ·  71.5%
//   new_space                38.5%  ·   8.4%  ·  11.2%   (scavenge phase)
//   code_space                5.9%  ·  25.9%  ·  27.0%
//
// An idle process using 2.6 MB of heap read 98.5%. Two customer processes
// minutes apart both read exactly 99.8%, and a matched pair differing by more
// than two orders of magnitude in retained memory both read exactly 99.8% as
// well. That is a constant, not a measurement.
//
// So the fullest-space choice now skips every space whose occupancy cannot
// mean anything (see `spaceCanShowPressure`), and the axis reports what is
// left WITHOUT a verdict. There is no honest denominator here at all: the only
// real ceiling a Node heap has is the heap size limit, and `heapHeadroom`
// already scores that correctly. Reporting the composition is still worth
// something to somebody reading a memory problem; rating it is not.
const MIN_SPACE_SAMPLES = 5;

/**
 * Can this V8 space's used/size ratio ever indicate pressure?
 *
 * `read_only_space` is a fixed region of immutable objects, ~100% occupied by
 * design from the moment the process boots (newer V8 reports it with size 0,
 * which the size filter already drops; older builds report it full).
 *
 * Every `*large_object_space` is committed one object at a time, so used is
 * always ≈ size — 98.5% on an idle process with a quarter of a megabyte in it.
 *
 * `new_space` is a semi-space that fills between scavenges BY DESIGN; a sample
 * caught just before a scavenge reads near-full on a perfectly healthy app.
 *
 * What remains (old_space, code_space, trusted_space, shared_space) still
 * reports committed size rather than a ceiling, which is why this axis
 * abstains from a score — but at least the number it prints moves with the
 * app instead of sitting on a constant.
 */
function spaceCanShowPressure(name: unknown): boolean {
  if (typeof name !== "string") return false;
  if (name === "read_only_space") return false;
  if (name === "new_space") return false;
  if (name.endsWith("large_object_space")) return false;
  return true;
}

export function readHeapSpacePressure(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    if (spaceSamples < MIN_SPACE_SAMPLES || worstSpacePct === null) return null;
    const worst = r1(worstSpacePct);
    const judged = `${spaceCount} growable heap ${spaceCount === 1 ? "space" : "spaces"}`;
    const skipped =
      spaceSkipped > 0
        ? `, ${spaceSkipped} fixed/on-demand ${spaceSkipped === 1 ? "space" : "spaces"} not judged`
        : "";
    return {
      // A WITHHELD VERDICT, NOT AN UNTAKEN READING.
      //
      // This sent `pending` + `measurable: 0` + "the platform does not expose
      // this" while publishing `worstSpacePct` — a number it demonstrably
      // has, taken from a reading the platform demonstrably does expose. On
      // our own server that abstention hid a space at 92.1% full. The
      // abstention itself is right, and the reason was wrong: V8 hands us
      // every one of these figures, and what is missing is a ceiling to
      // judge them against, which is `nothing to compare`. Same shape as
      // refusalHonesty: measured, published, deliberately unscored.
      score: null,
      rating: "not-scored",
      measurable: 1,
      reasonCode: REASON_NOTHING_TO_COMPARE,
      worstSpacePct: worst,
      spaceCount,
      skippedSpaces: spaceSkipped,
      caption:
        `fullest of ${judged} is at ${worst}%${skipped} · not rated: V8 commits ` +
        `space on demand, so this is not a ceiling — see Heap Headroom`,
    };
  } catch {
    return null;
  }
}

/* ── 6. Compiled-code size ───────────────────────────────────────────────*/
//
// REPORTED, NEVER RATED, for the same reason.
//
// This used to divide V8's compiled-code size by `heapTotal` and score the
// percentage (good 15%, poor 40%). Compiled-code size is a function of how
// much code the app loaded: it does not grow under pressure and an app cannot
// relieve it. Dividing it by heap size does not make a pressure signal — it
// makes a statement about how big the heap is, pointed the wrong way round.
// Measured on a matched pair, twice: the treatment holding ~500 MB scored
// 100/good at 1.7% of heap while the lean ~1 MB control scored 65 and 61
// (needs-work) at 23.7% and 24.8%. The healthy arm was rated worse, and the
// metric IMPROVES as the app gets worse.
//
// V8 exposes no code-cache ceiling to measure against — unlike the JVM, where
// the code cache is a fixed region and Java's copy of this axis scores real
// occupancy against a real max. So this reports the size and abstains.
const MIN_CODE_SAMPLES = 5;

export function readCodeCachePressure(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    if (codeCacheSamples < MIN_CODE_SAMPLES || codeCacheMb === null) return null;
    const usedMb = r1(codeCacheMb);
    return {
      // Same correction as its neighbour above: the size IS exposed and IS
      // published here. What V8 does not give is a code-cache ceiling to
      // measure it against, which is a missing comparison, not a missing
      // reading — and a reading we hold must never be cited as one we cannot
      // get.
      score: null,
      rating: "not-scored",
      measurable: 1,
      reasonCode: REASON_NOTHING_TO_COMPARE,
      usedMb,
      caption:
        `${usedMb} MB of compiled code · not rated: V8 has no code-cache ` +
        `ceiling to measure this against`,
    };
  } catch {
    return null;
  }
}

/* ── 7. ArrayBuffer retention ────────────────────────────────────────────*/
const AB_GOOD_MB_MIN = 0.5;
const AB_POOR_MB_MIN = 10;
/**
 * How much buffer memory the rate must project to have added across the
 * judged window before it is allowed to cost anything. Same reasoning as
 * RESIDENT_GROWTH_RISE_FLOOR_MB, at the scale this axis works on: eight megabytes of
 * buffers that are still being held is a hold worth mentioning, and less than
 * that is a rate describing a change nobody can see.
 */
const AB_RISE_FLOOR_MB = 8;
/**
 * How far back the retention FLOOR is allowed to look.
 *
 * The floor used to be taken over the whole ring. The ring holds 240 samples
 * with no time bound and only fills at request/snapshot boundaries, so a
 * modest workload never evicts the samples taken at boot and the floor stayed
 * at the pre-allocation value for as long as the process lived. One payload
 * shipped `nativeMemoryMix.arrayBufferMb: 152.3` beside
 * `arrayBufferRetention.retainedMb: 2` — both from this ring, twenty lines
 * apart on the page, wrong by a factor of seventy-five.
 *
 * A level is only a level if it is bounded in time. Ten minutes is long enough
 * that a burst of short-lived buffers does not read as retention, and short
 * enough that the number still describes the process as it is now.
 */
const AB_FLOOR_WINDOW_MS = 10 * 60_000;
const AB_FLOOR_WINDOW_MIN = AB_FLOOR_WINDOW_MS / 60_000;

export function readArrayBufferRetention(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    const pts = series((s) => s.arrayBufferMb);
    const trend = judgeTrend(pts, {
      good: AB_GOOD_MB_MIN,
      poor: AB_POOR_MB_MIN,
      minSamples: MIN_TREND_SAMPLES,
      minSpanMs: MIN_TREND_SPAN_MS,
      warmupMs: TREND_WARMUP_MS,
      startedAt,
      riseFloor: AB_RISE_FLOOR_MB,
    });
    if (!trend) return null;
    // The GROWTH half reads the whole series — a slope wants every point it
    // can get. The LEVEL may not: only samples inside the window can say what
    // this process is holding now, and the window is measured back from the
    // moment of OBSERVATION. Measured back from the newest sample instead,
    // that sample always falls inside it, so a ring that stopped filling an
    // hour ago would still read as current and the dated branch below could
    // never be reached.
    const now = Date.now();
    const newest = pts[pts.length - 1]!;
    const recent = pts.filter((p) => p.t >= now - AB_FLOOR_WINDOW_MS);
    // A floor is only a floor across a stretch of time. Fewer than two samples
    // in the window — or a stretch too short to name — leaves the newest
    // reading as the only thing that can be said, and that is the same figure
    // nativeMemoryMix reports, so the two tiles cannot disagree. A floor is
    // never presented as the newest reading: over the reviewer's ring (2 MB
    // half a minute ago, 152 MB now) the minimum is neither current nor what
    // the neighbouring tile shows.
    const windowMin = recent.length >= 2 ? windowMinOf(spanMs(recent)) : 0;
    const floorPts = windowMin > 0 ? recent : [newest];
    let floor = Infinity;
    for (const p of floorPts) if (p.v < floor) floor = p.v;
    if (!Number.isFinite(floor)) return null;
    const retainedMb = r1(floor);
    const growthMbPerMin = r1(trend.perMin);
    // How old the newest sample is, through the shared window helper (a window
    // rounded to a whole minute states an observation we did not make — the
    // earned-rate contract, rateHonesty.ts). Normally ~0: the ring is filled at
    // the same request/snapshot boundary this is read from. When it is not —
    // the ring stopped filling — the figure is dated rather than offered as
    // what the process holds now.
    const ageMin = windowMinOf(Math.max(0, now - newest.t));
    const stale = ageMin >= AB_FLOOR_WINDOW_MIN;
    // The samples are consistent with a process holding nothing extra AND
    // with one filling up. The level, the window and its age are all still
    // true, so they ship; the verdict is withheld with its reason.
    if (trend.score === null) {
      return {
        score: null,
        rating: "pending",
        reasonCode: trend.reasonCode,
        retainedMb,
        growthMbPerMin,
        windowMin,
        ageMin,
        caption: `${retainedMb} MB of buffers · moves too much over ${overWords(windowMinOf(trend.spanMs))} to call a trend`,
      };
    }
    const score = trend.score;
    return {
      score,
      rating: ratingFor(score),
      retainedMb,
      growthMbPerMin,
      windowMin,
      ageMin,
      caption: stale
        ? `${retainedMb} MB of buffers when last measured ${minuteText(ageMin)} ago · ${
            growthMbPerMin > 0 ? `was climbing ${growthMbPerMin} MB/min` : "not growing"
          }`
        : // A rate the floor has not let cost anything must say so beside the
          // green tile, or the reader is left with a positive number and a
          // good rating and no way to tell which one the score believed.
          growthMbPerMin > 0 && score >= 100
          ? `buffer memory +${growthMbPerMin} MB/min is ${r1(trend.rise)} MB over ${overWords(windowMinOf(trend.spanMs))}, too little to call a climb`
          : growthMbPerMin > 0
            ? `buffer memory climbing ${growthMbPerMin} MB/min`
            : windowMin >= 1
              ? `${retainedMb} MB of buffers held throughout the last ${minuteText(windowMin)} · not growing`
              : windowMin > 0
                ? `${retainedMb} MB of buffers held throughout under a minute of samples · not growing`
                : `${retainedMb} MB of buffers at the latest reading · not growing`,
    };
  } catch {
    return null;
  }
}

/* ── 8+9. Event-loop delay tail + max (env-gated) ────────────────────────*/
const ELD_WINDOW_MS = 60_000;
const MIN_ELD_WINDOWS = 3;
const ELD_P99_GOOD_MS = 20;
const ELD_P99_POOR_MS = 200;
const ELD_MAX_GOOD_MS = 50;
const ELD_MAX_POOR_MS = 1_000;

let eldEnabled = false;
let eldHistogram: {
  percentile(p: number): number;
  max: number;
  reset(): void;
  disable(): unknown;
} | null = null;
let eldWindowStart = 0;
interface EldWindow { p95Ms: number; p99Ms: number; maxMs: number; startMs: number }
const eldWindows: EldWindow[] = [];

function startEventLoopDelay(): void {
  if (!envTrue("BOOSTHIS_EVENT_LOOP_HISTOGRAM") || eldHistogram) return;
  try {
    const h = monitorEventLoopDelay({ resolution: 20 });
    h.enable();
    eldHistogram = h;
    eldEnabled = true;
    eldWindowStart = Date.now();
  } catch {
    eldHistogram = null;
  }
}

/** Rolls the histogram window if due; rides the same sampling boundary. */
function rollEldWindow(now: number): void {
  if (!eldHistogram || now - eldWindowStart < ELD_WINDOW_MS) return;
  try {
    const NS = 1e6;
    const p95Ms = eldHistogram.percentile(95) / NS;
    const p99Ms = eldHistogram.percentile(99) / NS;
    const maxMs = eldHistogram.max / NS;
    if (Number.isFinite(p99Ms) && p99Ms >= 0) {
      eldWindows.push({ p95Ms, p99Ms, maxMs, startMs: eldWindowStart });
      if (eldWindows.length > RING_CAP) eldWindows.shift();
    }
    eldHistogram.reset();
    eldWindowStart = now;
  } catch {
    /* best-effort */
  }
}

export function readEventLoopDelayTail(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started || !eldEnabled) return null;
  try {
    // The start-up rule (latencyTail): the window that held module loading is
    // not the loop's tail; only windows opened after settling are read.
    if (isSettling("latencyTail", Date.now())) return settlingReading({ score: null });
    const from = settledFromMs("latencyTail");
    const settled = eldWindows.filter((w) => w.startMs >= from);
    if (settled.length < MIN_ELD_WINDOWS) return null;
    let p95 = 0, p99 = 0;
    for (const w of settled) {
      if (w.p95Ms > p95) p95 = w.p95Ms;
      if (w.p99Ms > p99) p99 = w.p99Ms;
    }
    const p95Ms = r1(p95);
    const p99Ms = r1(p99);
    const score = linearScore(p99Ms, ELD_P99_GOOD_MS, ELD_P99_POOR_MS);
    return markSettled({
      score,
      rating: ratingFor(score),
      p95Ms,
      p99Ms,
      windowCount: settled.length,
      caption: `p99 timer delay ${p99Ms}ms across ${settled.length} windows`,
    });
  } catch {
    return null;
  }
}

export function readEventLoopDelayMax(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started || !eldEnabled) return null;
  try {
    // The start-up rule (peakRate): the window that held the start-up long
    // task is excluded, not retained, and the worst is taken over at least
    // five settled minutes.
    if (isSettling("peakRate", Date.now())) return settlingReading({ score: null });
    const from = settledFromMs("peakRate");
    const settled = eldWindows.filter((w) => w.startMs >= from);
    if (settled.length < MIN_ELD_WINDOWS || !spanJudgeable(settled.length * ELD_WINDOW_MS)) return null;
    let worst = 0;
    for (const w of settled) if (w.maxMs > worst) worst = w.maxMs;
    const worstMs = r1(worst);
    const score = linearScore(worstMs, ELD_MAX_GOOD_MS, ELD_MAX_POOR_MS);
    return markSettled({
      score,
      rating: ratingFor(score),
      worstMs,
      windowCount: settled.length,
      caption: `worst observed delay ${worstMs}ms`,
    });
  } catch {
    return null;
  }
}

/* ── 10. Performance-entry backlog (env-gated) ───────────────────────────*/
/** The settle-rule decision: entries that keep accumulating after settling.
 *  A count that holds steady is a buffer somebody reads, however large; the
 *  verdict is the persistent growth per minute. */
const PERF_GROWTH_GOOD_PER_MIN = 1;
const PERF_GROWTH_POOR_PER_MIN = 50;
const MIN_PERF_SAMPLES = 5;

export function readPerfEntryBacklog(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started || !perfEntriesEnabled) return null;
  try {
    if (perfEntrySamples.length === 0) return null;
    // The start-up rule (growthSlope): marks set while booting are a step,
    // never projected; the slope is fitted over settled samples only.
    if (isSettling("growthSlope", Date.now())) return settlingReading({ score: null });
    if (perfEntrySamples.length < MIN_PERF_SAMPLES) return null;
    const fit = settledSlope(
      perfEntrySamples.map((s) => ({ t: s.t, v: s.n })),
      "growthSlope",
    );
    if (!fit) return null;
    const last = perfEntrySamples[perfEntrySamples.length - 1]!;
    const entryCount = Math.round(last.n);
    const growthPerMin = r1(persistentGrowthPerMin(fit));
    const score = linearScore(growthPerMin, PERF_GROWTH_GOOD_PER_MIN, PERF_GROWTH_POOR_PER_MIN);
    return markSettled({
      score,
      rating: ratingFor(score),
      entryCount,
      growthPerMin,
      windowMin: windowMinOf(fit.spanMs),
      caption:
        growthPerMin > 0
          ? `${entryCount} performance entries held · growing ${growthPerMin}/min`
          : `${entryCount} performance entries held · not growing`,
    });
  } catch {
    return null;
  }
}

/* ── 11. Async resource diversity (env-gated) ────────────────────────────*/
const MIN_DIVERSITY_ELAPSED_MS = 60_000;
const DIVERSITY_TYPE_CAP = 64;

let diversityHook: { disable(): unknown } | null = null;
const diversityTypes = new Set<string>();
let diversityInits = 0;

function startAsyncDiversity(): void {
  if (!envTrue("BOOSTHIS_ASYNC_RESOURCE_TYPES") || diversityHook) return;
  try {
    const hook = createHook({
      init(_id: number, type: string) {
        try {
          diversityInits++;
          if (diversityTypes.size < DIVERSITY_TYPE_CAP) diversityTypes.add(type);
        } catch {
          /* never throw from an init hook */
        }
      },
    });
    hook.enable();
    diversityHook = hook;
  } catch {
    diversityHook = null;
  }
}

export function readAsyncResourceDiversity(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started || !diversityHook) return null;
  try {
    if (Date.now() - startedAt < MIN_DIVERSITY_ELAPSED_MS) return null;
    const typeCount = diversityTypes.size;
    // The shared decision: how many async resource TYPES were ever created is
    // not a health quantity (and is a lifetime count, not what is in play
    // now). Reported, never graded; a genuine async leak is leakWatch's.
    return {
      score: null,
      rating: "not-scored",
      typeCount,
      sampleCount: Math.min(diversityInits, 1_000_000_000),
      caption: `${typeCount} async resource types created since start`,
    };
  } catch {
    return null;
  }
}

/* ── 13+14. Diagnostic channel meters (env-gated + explicit allowlist) ───*/
const DIAG_ERR_GOOD_PER_HOUR = 1;
const DIAG_ERR_POOR_PER_HOUR = 60;
const MIN_DIAG_EVENTS = 5;
const DIAG_MAX_CHANNELS = 16;
const DIAG_ACTIVE_WINDOW_MS = 10 * 60_000;

interface DiagChannel {
  /** Every message seen. */
  count: number;
  /** Messages after the start-up rule settled (startupEvent). */
  settledCount: number;
  /** Messages whose payload carried an error, and those after settling. */
  errors: number;
  settledErrors: number;
  lastAt: number;
  unsubscribe: (() => void) | null;
}

/** Does a diagnostics-channel payload carry an error? Node's own channels
 *  publish `{ error }` on their error events (http.client.request.error,
 *  undici:request:error, tracing:*:error); a channel's NAME decides nothing. */
function payloadCarriesError(msg: unknown): boolean {
  if (msg instanceof Error) return true;
  if (typeof msg !== "object" || msg === null) return false;
  const error = (msg as { error?: unknown }).error;
  return error !== undefined && error !== null && error !== false;
}

/** File one message on a watched channel. */
function noteDiagMessage(entry: DiagChannel, msg: unknown): void {
  const now = Date.now();
  const settled = now >= settledFromMs("startupEvent");
  entry.count++;
  if (settled) entry.settledCount++;
  if (payloadCarriesError(msg)) {
    entry.errors++;
    if (settled) entry.settledErrors++;
  }
  entry.lastAt = now;
}
const diagChannels = new Map<string, DiagChannel>();

function startDiagnostics(): void {
  if (!envTrue("BOOSTHIS_DIAGNOSTICS") || diagChannels.size > 0) return;
  try {
    const raw = process.env.BOOSTHIS_DIAGNOSTICS_CHANNELS || "";
    const names = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 64)
      .slice(0, DIAG_MAX_CHANNELS);
    if (names.length === 0) return; // absent unless an allowlist is configured
    for (const name of names) {
      const entry: DiagChannel = {
        count: 0,
        settledCount: 0,
        errors: 0,
        settledErrors: 0,
        lastAt: 0,
        unsubscribe: null,
      };
      // The callback reads only WHETHER the message carries an error; nothing
      // of the message is kept.
      const cb = (msg: unknown): void => {
        try {
          noteDiagMessage(entry, msg);
        } catch {
          /* passive */
        }
      };
      try {
        subscribe(name, cb);
        entry.unsubscribe = () => unsubscribe(name, cb);
        diagChannels.set(name, entry);
      } catch {
        /* channel refused — skip */
      }
    }
  } catch {
    diagChannels.clear();
  }
}

export function readDiagnosticErrorVolume(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    if (diagChannels.size === 0) return null; // nothing allowlisted
    let errCount = 0;
    for (const c of diagChannels.values()) errCount += c.settledErrors;
    const now = Date.now();
    // The start-up rule (startupEvent): a probe failing while the app boots
    // is ordinary; only errors after settling count, over the settled window.
    // The channels are subscribed, so until then the reading says it is
    // settling — never silence, whether or not anything has failed yet.
    if (isSettling("startupEvent", now)) return settlingReading({ score: null });
    // Eligibility is judged on the RAW settled time, never on the reported
    // two-decimal window (see windowMinOf in rateHonesty.ts).
    const windowMs = settledSpanMs(startedAt, now, "startupEvent");
    const windowMin = windowMinOf(windowMs);
    // The earned-rate contract (rateHonesty.ts): the projection and its score
    // wait for a window that earned them; the error COUNT does not.
    const perHour = earnedPerHour(errCount, windowMs);
    if (perHour === null) {
      if (errCount === 0) return null;
      return markSettled({
        score: null,
        rating: "pending" as const,
        count: errCount,
        perHour: null,
        windowMin,
        caption: `${errCount} subsystem error${errCount === 1 ? "" : "s"} · ${windowPhrase(windowMin, "observed so far")}`,
      });
    }
    const score = linearScore(perHour, DIAG_ERR_GOOD_PER_HOUR, DIAG_ERR_POOR_PER_HOUR);
    return markSettled({
      score,
      rating: ratingFor(score),
      count: errCount,
      perHour,
      windowMin,
      caption:
        errCount === 0
          ? `no subsystem errors · ${windowPhrase(windowMin)}`
          : `${errCount} subsystem errors · ${perHour}/hour over ${overWords(windowMin)}`,
    });
  } catch {
    return null;
  }
}

export function readDiagnosticActivity(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started) return null;
  try {
    if (diagChannels.size === 0) return null;
    const now = Date.now();
    // The shared decision: channel activity at boot is noise, so only activity
    // after settling is reported, and activity is never graded (coverage of
    // channels is not the health of the subsystems behind them). Until then
    // the reading says it is settling and carries no count.
    if (isSettling("startupEvent", now)) return settlingReading({ score: null });
    let total = 0;
    let active = 0;
    for (const c of diagChannels.values()) {
      total += c.settledCount;
      if (c.settledCount > 0 && c.lastAt > 0 && now - c.lastAt <= DIAG_ACTIVE_WINDOW_MS) active++;
    }
    if (total < MIN_DIAG_EVENTS) return null;
    const elapsed = settledSpanMs(startedAt, now, "startupEvent");
    const windowMin = windowMinOf(elapsed);
    const channelCount = diagChannels.size;
    // The earned-rate contract (rateHonesty.ts): below the minimum observation
    // the per-minute projection is withheld.
    const perMin = earnedPerMin(total, elapsed);
    return markSettled({
      score: null,
      rating: "not-scored" as const,
      channelCount,
      count: total,
      perMin,
      windowMin,
      caption:
        perMin === null
          ? `${active} of ${channelCount} watched subsystems active · ${total} event${total === 1 ? "" : "s"} in ${windowPhrase(windowMin, "")}`
          : `${active} of ${channelCount} watched subsystems active · ${perMin} events/min over ${overWords(windowMin)}`,
    });
  } catch {
    return null;
  }
}

/* ── Lifecycle + assembly ────────────────────────────────────────────────*/

/** Start every process-meter collector. Idempotent, no-op under the
 *  kill-switch, never throws. Called from `startExtraMeters`. */
export function startProcessMeters(): void {
  if (isBoosthisDisabled() || started) return;
  started = true;
  startedAt = Date.now();
  perfEntriesEnabled = envTrue("BOOSTHIS_PERF_ENTRIES");
  try { startEventLoopDelay(); } catch { /* best-effort */ }
  try { startAsyncDiversity(); } catch { /* best-effort */ }
  try { startDiagnostics(); } catch { /* best-effort */ }
}

/** Assemble every currently-available process axis (warming/env-absent axes
 *  omitted — the server renders expected ones as pending). Takes a fresh
 *  boundary sample first so idle apps still warm via snapshot cadence. */
export function readProcessMeters(): Record<string, ExtraAxis> {
  const axes: Record<string, ExtraAxis> = {};
  if (isBoosthisDisabled() || !started) return axes;
  try {
    const now = Date.now();
    sampleProcessMeters(now);
    rollEldWindow(now);
  } catch {
    /* best-effort */
  }
  const put = (key: string, ax: ExtraAxis | null): void => {
    if (ax) axes[key] = ax;
  };
  put("cpuConsumption", readCpuConsumption());
  put("residentGrowth", readResidentGrowth());
  put("nativeMemoryMix", readNativeMemoryMix());
  put("uptimeStability", readUptimeStability());
  put("heapSpacePressure", readHeapSpacePressure());
  // V8 exposes compiled-code bytes but no code-cache capacity. It therefore
  // cannot honestly provide the contract's capacity-based codeCachePressure.
  put("arrayBufferRetention", readArrayBufferRetention());
  put("eventLoopDelayTail", readEventLoopDelayTail());
  put("eventLoopDelayMax", readEventLoopDelayMax());
  put("perfEntryBacklog", readPerfEntryBacklog());
  put("asyncResourceDiversity", readAsyncResourceDiversity());
  put("diagnosticErrorVolume", readDiagnosticErrorVolume());
  put("diagnosticActivity", readDiagnosticActivity());
  return axes;
}

/** Tear down hooks/subscriptions and drop all state. Idempotent. */
export function clearProcessMeters(): void {
  started = false;
  startedAt = 0;
  lastSampledAt = 0;
  samples.length = 0;
  worstSpacePct = null;
  spaceCount = 0;
  spaceSkipped = 0;
  spaceSamples = 0;
  codeCacheMb = null;
  codeCacheSamples = 0;
  driftMs = 0;
  uptimeSupported = true;
  perfEntriesEnabled = false;
  perfEntrySamples.length = 0;
  try {
    if (eldHistogram) eldHistogram.disable();
  } catch { /* best-effort */ }
  eldHistogram = null;
  eldEnabled = false;
  eldWindows.length = 0;
  eldWindowStart = 0;
  try {
    if (diversityHook) diversityHook.disable();
  } catch { /* best-effort */ }
  diversityHook = null;
  diversityTypes.clear();
  diversityInits = 0;
  for (const c of diagChannels.values()) {
    try {
      c.unsubscribe?.();
    } catch { /* best-effort */ }
  }
  diagChannels.clear();
}

/** @internal test hooks. */
export const _processMetersInternals = {
  SAMPLE_MIN_MS,
  MIN_TREND_SAMPLES,
  MIN_TREND_SPAN_MS,
  TREND_WARMUP_MS,
  RESIDENT_GROWTH_RISE_FLOOR_MB,
  AB_RISE_FLOOR_MB,
  CPU_GOOD_PCT,
  CPU_POOR_PCT,
  RESIDENT_GROWTH_GOOD_MB_MIN,
  RESIDENT_GROWTH_POOR_MB_MIN,
  DRIFT_QUIET_PCT,
  PERF_GROWTH_GOOD_PER_MIN,
  PERF_GROWTH_POOR_PER_MIN,
  spaceCanShowPressure,
  MIN_ELD_WINDOWS,
  MIN_DIAG_EVENTS,
  get isRunning(): boolean {
    return started;
  },
  reset(): void {
    clearProcessMeters();
  },
  /** Force started (+backdate) without env hooks for hermetic unit tests. */
  forceStart(at: number): void {
    started = true;
    startedAt = at;
  },
  pushSample(s: ProcSample): void {
    samples.push(s);
  },
  setSpaceStats(worstPct: number, count: number, sampleN: number, skipped = 0): void {
    worstSpacePct = worstPct;
    spaceCount = count;
    spaceSkipped = skipped;
    spaceSamples = sampleN;
  },
  setCodeCache(mb: number, sampleN: number): void {
    codeCacheMb = mb;
    codeCacheSamples = sampleN;
  },
  addDrift(ms: number): void {
    driftMs += ms;
  },
  enableEldForTest(): void {
    eldEnabled = true;
  },
  /** A closed delay window; one with no stated start opened a minute ago. */
  pushEldWindow(w: Omit<EldWindow, "startMs"> & { startMs?: number }): void {
    eldWindows.push({ ...w, startMs: w.startMs ?? Date.now() - ELD_WINDOW_MS });
  },
  enablePerfEntriesForTest(): void {
    perfEntriesEnabled = true;
  },
  pushPerfEntrySample(t: number, n: number): void {
    perfEntrySamples.push({ t, n });
  },
  enableDiversityForTest(types: string[], inits: number): void {
    diversityHook = { disable() {} };
    for (const t of types) diversityTypes.add(t);
    diversityInits = inits;
  },
  /** A watched channel that has seen `count` settled messages, every one of
   *  them carrying an error payload when `isError`. */
  setDiagChannelForTest(
    name: string,
    isError: boolean,
    count: number,
    lastAt: number,
  ): void {
    const errors = isError ? count : 0;
    diagChannels.set(name, {
      count,
      settledCount: count,
      errors,
      settledErrors: errors,
      lastAt,
      unsubscribe: null,
    });
  },
  /** Deliver one message to a watched channel's own filing path. */
  publishDiagForTest(name: string, msg: unknown): void {
    const entry = diagChannels.get(name);
    if (entry) noteDiagMessage(entry, msg);
  },
};
