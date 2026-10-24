/* Processor, thread and scheduling readings. Additive/display-only. */
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { linearScore, ratingFor } from "./healthAxes";
import type { ExtraAxis } from "./extraMeters";
import { judgeTrend, type TrendPoint } from "./trendVerdict";
import { windowMinOf } from "./rateHonesty";
import { hostPlatform, systemUnavailableReading } from "./systemLimits";
import {
  isSettling,
  markSettled,
  processStartMs,
  SETTLE_FAMILIES,
  settledFromMs,
  settlingReading,
} from "./settleRule";

export const CPU_ENTITLEMENT_GOOD_RATIO = 1;
export const CPU_ENTITLEMENT_POOR_RATIO = 4;
export const CONTEXT_INVOLUNTARY_GOOD_PCT = 10;
export const CONTEXT_INVOLUNTARY_POOR_PCT = 60;
export const CONTEXT_MIN_WINDOW_MS = 60_000;
export const CONTEXT_MIN_SWITCHES = 500;
/** The shared decision's absolute floor: preemption at or under this many
 *  involuntary switches per second costs too little to carry a word, whatever
 *  share of all switches it is (the same floor as every kit carrying it). */
export const CONTEXT_INVOLUNTARY_FLOOR_PER_SEC = 50;
/** Every judged window is at least the peak-rate family's span. */
const CONTEXT_WINDOW_MS = Math.max(
  CONTEXT_MIN_WINDOW_MS,
  SETTLE_FAMILIES.peakRate.minSpanSec * 1000,
);
export const THREAD_GROWTH_GOOD_PER_MIN = 0.5;
export const THREAD_GROWTH_POOR_PER_MIN = 5;
export const THREAD_MIN_SAMPLES = 12;
export const THREAD_MIN_SPAN_MS = 60_000;
export const THREAD_STARTUP_EXCLUSION_MS = 60_000;
export const THREAD_RING_CAP = 240;
export const QUEUE_GOOD_MS = 10;
export const QUEUE_POOR_MS = 250;
export const QUEUE_MIN_SAMPLES = 20;
export const QUEUE_RING_CAP = 240;
export const FORK_GOOD_PER_MIN = 6;
export const FORK_POOR_PER_MIN = 60;
export const FORK_MIN_WINDOW_MS = 60_000;

type StatusReading = {
  voluntary: number;
  involuntary: number;
  threads: number;
};
type ContextAnchor = { at: number; voluntary: number; involuntary: number };
type QueueSample = { t: number; v: number };

let contextAnchor: ContextAnchor | null = null;
let threadSamples: TrendPoint[] = [];
let queueSamples: QueueSample[] = [];
let forkStartedAt = 0;
// Spawns counted once the process has settled (the start-up rule): a worker
// pool or a toolchain probe launched while the app boots is one batch, not a
// rate the process keeps up.
let forkSettledTotal = 0;
let forkArmed = false;
let patchedChild: Record<string, unknown> | null = null;
const originalChildCalls = new Map<string, (...args: unknown[]) => unknown>();

const r1 = (n: number): number => Math.round(n * 10) / 10;
const scored = (value: number, good: number, poor: number) => {
  const score = linearScore(value, good, poor);
  return { score, rating: ratingFor(score) };
};

function readStatus(): StatusReading | null {
  if (hostPlatform() !== "linux") return null;
  try {
    const raw = readFileSync("/proc/self/status", "utf8");
    const voluntary = /^\s*voluntary_ctxt_switches:\s*(\d+)\s*$/m.exec(raw);
    const involuntary = /^\s*nonvoluntary_ctxt_switches:\s*(\d+)\s*$/m.exec(raw);
    const threads = /^\s*Threads:\s*(\d+)\s*$/m.exec(raw);
    if (!voluntary || !involuntary || !threads) return null;
    return {
      voluntary: Number(voluntary[1]),
      involuntary: Number(involuntary[1]),
      threads: Number(threads[1]),
    };
  } catch {
    return null;
  }
}

function readQuota(): { allowedCpus: number; sourceCode: "cgroup2" | "cgroup1" } | null {
  try {
    const [quotaWord, periodWord] = readFileSync("/sys/fs/cgroup/cpu.max", "utf8")
      .trim()
      .split(/\s+/);
    if (quotaWord !== "max") {
      const quota = Number(quotaWord);
      const period = Number(periodWord);
      if (quota > 0 && period > 0) {
        return { allowedCpus: quota / period, sourceCode: "cgroup2" };
      }
    }
  } catch { /* try cgroup v1 */ }
  try {
    const quota = Number(readFileSync("/sys/fs/cgroup/cpu/cpu.cfs_quota_us", "utf8").trim());
    const period = Number(readFileSync("/sys/fs/cgroup/cpu/cpu.cfs_period_us", "utf8").trim());
    if (quota > 0 && period > 0) {
      return { allowedCpus: quota / period, sourceCode: "cgroup1" };
    }
  } catch { /* source absent */ }
  return null;
}

function cpuEntitlement(
  quota = readQuota(),
  visibleCpus = availableParallelism(),
): ExtraAxis | null {
  if (!quota) return null;
  if (!(visibleCpus > 0) || !(quota.allowedCpus > 0)) return null;
  const mismatchRatio = visibleCpus / quota.allowedCpus;
  return {
    ...scored(mismatchRatio, CPU_ENTITLEMENT_GOOD_RATIO, CPU_ENTITLEMENT_POOR_RATIO),
    visibleCpus,
    allowedCpus: r1(quota.allowedCpus),
    mismatchRatio: r1(mismatchRatio),
    sourceCode: quota.sourceCode,
  };
}

function contextSwitching(status: StatusReading, now: number): ExtraAxis | null {
  const current = {
    at: now,
    voluntary: status.voluntary,
    involuntary: status.involuntary,
  };
  // The start-up rule (peak-rate family): no window opens while the process
  // is still loading, so the switches of start-up never reach a share.
  if (isSettling("peakRate", now)) {
    contextAnchor = null;
    return settlingReading() as ExtraAxis;
  }
  if (!contextAnchor || contextAnchor.at < settledFromMs("peakRate")) {
    contextAnchor = current;
    return null;
  }
  const voluntary = current.voluntary - contextAnchor.voluntary;
  const involuntary = current.involuntary - contextAnchor.involuntary;
  const span = current.at - contextAnchor.at;
  if (voluntary < 0 || involuntary < 0 || span <= 0) {
    contextAnchor = current;
    return null;
  }
  const switches = voluntary + involuntary;
  if (span < CONTEXT_WINDOW_MS || switches < CONTEXT_MIN_SWITCHES) return null;
  const involuntaryPct = (100 * involuntary) / switches;
  const involuntaryPerSec = involuntary / (span / 1000);
  contextAnchor = current;
  // The shared decision: switches per second over a settled window. A share
  // alone cannot tell a scheduler taking the processor back thousands of
  // times a second from a quiet process preempted now and then, so at or
  // under the absolute floor the share carries no word.
  const score =
    involuntaryPerSec <= CONTEXT_INVOLUNTARY_FLOOR_PER_SEC
      ? 100
      : linearScore(involuntaryPct, CONTEXT_INVOLUNTARY_GOOD_PCT, CONTEXT_INVOLUNTARY_POOR_PCT);
  return markSettled({
    score,
    rating: ratingFor(score),
    involuntaryPct: r1(involuntaryPct),
    involuntaryPerSec: r1(involuntaryPerSec),
    switchesPerSec: r1(switches / (span / 1000)),
    windowMin: windowMinOf(span),
  });
}

function threadFootprint(status: StatusReading, now: number): ExtraAxis | null {
  threadSamples.push({ t: now, v: status.threads });
  if (threadSamples.length > THREAD_RING_CAP) threadSamples.shift();
  const verdict = judgeTrend(threadSamples, {
    good: THREAD_GROWTH_GOOD_PER_MIN,
    poor: THREAD_GROWTH_POOR_PER_MIN,
    minSamples: THREAD_MIN_SAMPLES,
    minSpanMs: THREAD_MIN_SPAN_MS,
    warmupMs: THREAD_STARTUP_EXCLUSION_MS,
    startedAt: processStartMs(),
    abstainAroundZero: true,
  });
  if (!verdict) return null;
  const peakThreads = Math.max(...verdict.judged.map((point) => point.v));
  return {
    score: verdict.score,
    rating: verdict.score === null ? "pending" : ratingFor(verdict.score),
    threads: status.threads,
    peakThreads,
    growthPerMin: r1(verdict.perMin),
    sampleCount: verdict.sampleCount,
    windowMin: verdict.windowMin,
  };
}

export function noteQueueStartHeader(value: unknown, handlerStartedAt = Date.now()): void {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== "string") return;
  const raw = first.trim().replace(/^t=/i, "");
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return;
  const n = Number(raw);
  const arrivalMs = n < 10_000_000_000 ? n * 1000 : n;
  const wait = handlerStartedAt - arrivalMs;
  if (!Number.isFinite(wait) || wait < 0) return;
  queueSamples.push({ t: handlerStartedAt, v: wait });
  if (queueSamples.length > QUEUE_RING_CAP) queueSamples.shift();
}

function queueTime(now = Date.now()): ExtraAxis | null {
  // The start-up rule (latency-tail family): requests that queued while the
  // process was still starting waited for the boot, not for capacity, and a
  // whole batch of them can fill a p75 that one cold wait never could.
  const settledFrom = settledFromMs("latencyTail");
  const settled = queueSamples.filter((s) => s.t >= settledFrom).map((s) => s.v);
  if (settled.length < QUEUE_MIN_SAMPLES) {
    return queueSamples.length > 0 && isSettling("latencyTail", now)
      ? (settlingReading() as ExtraAxis)
      : null;
  }
  const sorted = settled.sort((a, b) => a - b);
  const p75Ms = r1(sorted[Math.ceil(sorted.length * 0.75) - 1]!);
  return markSettled({
    ...scored(p75Ms, QUEUE_GOOD_MS, QUEUE_POOR_MS),
    p75Ms,
    worstMs: r1(sorted[sorted.length - 1]!),
    sampleCount: sorted.length,
  });
}

export function armForkChurn(): void {
  if (forkArmed) return;
  forkArmed = true;
  forkStartedAt = Date.now();
  try {
    const child = createRequire(import.meta.url)("node:child_process") as Record<string, unknown>;
    patchedChild = child;
    for (const name of ["spawn", "fork", "exec"] as const) {
      const original = child[name];
      if (typeof original !== "function") continue;
      originalChildCalls.set(name, original as (...args: unknown[]) => unknown);
      child[name] = function boosthisCountedChildCall(this: unknown, ...args: unknown[]) {
        noteSpawn();
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      };
    }
    syncBuiltinESMExports();
  } catch {
    forkArmed = false;
    forkStartedAt = 0;
  }
}

function noteSpawn(now = Date.now()): void {
  if (now >= settledFromMs("startupEvent")) forkSettledTotal++;
}

function forkChurn(now: number): ExtraAxis | null {
  if (!forkArmed) return null;
  // The start-up rule (start-up event family): the rate is taken over the
  // settled part of the watch only, so an initialisation batch is not
  // carried forward as an ongoing spawn rate. `total` is the spawns that
  // rate counts.
  if (isSettling("startupEvent", now)) return settlingReading() as ExtraAxis;
  const span = now - Math.max(forkStartedAt, settledFromMs("startupEvent"));
  if (span < FORK_MIN_WINDOW_MS) return null;
  const spawnsPerMin = forkSettledTotal / (span / 60_000);
  return markSettled({
    ...scored(spawnsPerMin, FORK_GOOD_PER_MIN, FORK_POOR_PER_MIN),
    spawnsPerMin: r1(spawnsPerMin),
    total: forkSettledTotal,
    windowMin: windowMinOf(span),
  });
}

export function readCpuSchedulingMeters(now = Date.now()): Record<string, ExtraAxis> {
  const out: Record<string, ExtraAxis> = {};
  // A system with no Linux control groups has no CPU quota to compare with,
  // and one with no /proc process files has no switch counts. Each says so
  // rather than leave its tile waiting. The thread count is not among them:
  // threads exist everywhere, so its tile keeps its ordinary "nothing yet".
  const entitlement = systemUnavailableReading("cpuEntitlement") ?? cpuEntitlement();
  if (entitlement) out.cpuEntitlement = entitlement;
  const contextLacking = systemUnavailableReading("contextSwitching");
  if (contextLacking) out.contextSwitching = contextLacking;
  const status = readStatus();
  if (status) {
    if (!contextLacking) {
      const context = contextSwitching(status, now);
      if (context) out.contextSwitching = context;
    }
    const footprint = threadFootprint(status, now);
    if (footprint) out.threadFootprint = footprint;
  }
  const queued = queueTime(now);
  if (queued) out.queueTime = queued;
  const forks = forkChurn(now);
  if (forks) out.forkChurn = forks;
  return out;
}

export function clearCpuSchedulingMeters(): void {
  contextAnchor = null;
  threadSamples = [];
  queueSamples = [];
  forkSettledTotal = 0;
  if (patchedChild) {
    for (const [name, original] of originalChildCalls) patchedChild[name] = original;
    syncBuiltinESMExports();
  }
  originalChildCalls.clear();
  patchedChild = null;
  forkArmed = false;
  forkStartedAt = 0;
}

export const _cpuSchedulingInternals = {
  cpuEntitlement,
  contextSwitching,
  threadFootprint,
  queueTime,
  forkChurn,
  setContextAnchor(value: ContextAnchor | null): void { contextAnchor = value; },
  setThreadSamples(value: TrendPoint[]): void { threadSamples = value.slice(); },
  /** Plain waits are stamped as taken after the process settled. */
  setQueueSamples(value: Array<number | QueueSample>): void {
    queueSamples = value.map((v) => (typeof v === "number" ? { t: Date.now(), v } : { ...v }));
  },
  noteSpawn,
  /** `total` is the settled spawns the rate counts. */
  setForkState(startedAt: number, total: number, armed = true): void {
    forkStartedAt = startedAt;
    forkSettledTotal = total;
    forkArmed = armed;
  },
};