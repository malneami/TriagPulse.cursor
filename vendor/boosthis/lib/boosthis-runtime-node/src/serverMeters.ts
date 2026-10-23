/* ─── Boosthis: server-side meter collectors (Node) ──────────────────────
 *
 * Two label-free collectors that feed the `idle` and `latencyFloor` meter axes
 * (see meterAxes.ts). Both reuse the kit's EXISTING sampling boundaries — no new
 * background timer, no new interception layer, bounded memory — so they stay
 * guest-safe inside the host app.
 *
 *   • Idle efficiency — CPU burned while ZERO requests are in flight. The
 *     idle-window boundaries are the SAME request start/end boundaries
 *     liveDetectors already uses for its idle-burn detector; on each such
 *     boundary we fold the process.cpuUsage() delta and the wall gap into
 *     running idle totals (only genuine idle gaps — wall >= IDLE_GAP_MS — count,
 *     matching the idle-burn detector's gate).
 *
 *   • Latency floor — the worst completed fixed-length window's p95 request
 *     latency. Every recorded request duration is folded into the current
 *     10s window (LATENCY_FLOOR_WINDOW_MS); when a window closes we take its
 *     p95 and keep the WORST across a bounded ring of completed windows, so one
 *     terrible window is never averaged away by a good session.
 *
 * PRIVACY: durations, CPU ms, wall ms and counts only — never a route label,
 * host, or any customer string. In-memory only; no-op under the kill-switch.
 */

import { isBoosthisDisabled } from "./runtimeFlags";
import {
  IDLE_MIN_WALL_MS,
  LATENCY_FLOOR_WINDOW_MS,
  type IdleStatsLike,
  type LatencyFloorStatsLike,
} from "./meterAxes";
import { inSuspendWakeWindow, SUSPEND_UNIT } from "./suspendSensor";
import { settledFromMs } from "./settleRule";

/* ── Idle CPU efficiency ─────────────────────────────────────────────────
 * Mirrors liveDetectors' idle-burn gate: only a window with NO request in
 * flight for at least IDLE_GAP_MS counts as a genuine idle gap (brief lulls
 * between bursts are ignored). IDLE_ACTIVE_MS-scale busy stretches inside a gap
 * are tallied as idleLongTaskCount. */
const IDLE_GAP_MS = 3_000;
/** CPU-ms burned inside one idle gap at/above which we count a sustained
 *  wasted-work stretch (mirrors liveDetectors' IDLE_ACTIVE_MS). */
const IDLE_LONG_TASK_MS = 1_000;
/** Cap total retained idle wall so long-lived processes stay bounded and the
 *  ratio reflects recent behaviour rather than the whole uptime. */
const IDLE_MAX_WALL_MS = 3_600_000; // 1 hour of accumulated idle time

let idleWallMs = 0;
let idleCpuMs = 0;
let idleLongTaskCount = 0;
/** CPU snapshot captured when the loop last went idle, or null. */
let idleCpuMark: NodeJS.CpuUsage | null = null;
/** Wall-clock ms when the loop last went idle, or 0. */
let idleSince = 0;

function cpuAvailable(): boolean {
  return typeof process?.cpuUsage === "function";
}

/** Call when the process transitions to idle (no request in flight). Snapshots
 *  the CPU + wall baseline for the idle window about to begin. No-op under the
 *  kill-switch. */
export function noteIdleStart(): void {
  if (isBoosthisDisabled()) return;
  idleSince = Date.now();
  if (cpuAvailable()) {
    try {
      idleCpuMark = process.cpuUsage();
    } catch {
      idleCpuMark = null;
    }
  }
}

/** Call when the process leaves idle (a request arrived). Folds the just-ended
 *  idle window's CPU + wall into the running idle totals, but only when it was
 *  a genuine gap (wall >= IDLE_GAP_MS). No-op under the kill-switch. */
export function noteIdleEnd(): void {
  if (isBoosthisDisabled()) return;
  if (idleSince <= 0 || !idleCpuMark || !cpuAvailable()) {
    idleSince = 0;
    idleCpuMark = null;
    return;
  }
  const startedAt = idleSince;
  const wall = Date.now() - idleSince;
  idleSince = 0;
  const mark = idleCpuMark;
  idleCpuMark = null;
  if (wall < IDLE_GAP_MS) return; // brief lull — ignore
  // The start-up rule (peakRate; docs/settle-rule-decisions.md): a quiet
  // window that began before the process settled holds start-up work (module
  // loading, pools filling, caches warming), and its CPU cannot be split by
  // time — so it is not booked as idle burn at all.
  if (startedAt < settledFromMs("peakRate")) return;
  try {
    const delta = process.cpuUsage(mark); // microseconds
    const cpuMs = (delta.user + delta.system) / 1000;
    idleWallMs += wall;
    idleCpuMs += cpuMs;
    if (cpuMs >= IDLE_LONG_TASK_MS) idleLongTaskCount++;
    // Keep the accounting bounded + recent: once we exceed the cap, halve both
    // totals so the ratio is preserved while memory/age stay bounded.
    if (idleWallMs > IDLE_MAX_WALL_MS) {
      idleWallMs /= 2;
      idleCpuMs /= 2;
    }
  } catch {
    // process.cpuUsage can throw on exotic carriers — silently skip.
  }
}

export function getIdleStats(): IdleStatsLike {
  return {
    idleWallMs: Math.round(idleWallMs),
    idleCpuMs: Math.round(idleCpuMs),
    idleLongTaskCount,
  };
}

/* ── Latency floor ───────────────────────────────────────────────────────
 * Fold every recorded request duration into fixed 10s windows; keep the WORST
 * completed window's p95 across a bounded ring. */
/** Bounded ring of completed windows' p95 values so a long session stays
 *  memory-bounded; the axis reports the max over them. */
const LATENCY_FLOOR_MAX_WINDOWS = 4_320; // ~12h of 10s windows, hard cap

/** Start (epoch ms, floored to the window) of the window currently filling.
 *  -1 until the first sample arrives (0 is a valid window start at the epoch,
 *  so it can't double as the "unset" sentinel). */
let curWindowStart = -1;
/** Durations recorded in the current, not-yet-closed window. */
let curWindow: number[] = [];
/** Completed windows' p95 values (bounded ring). */
let closedP95s: number[] = [];
/** Worst (max) completed-window p95 seen so far (ms). */
let worstWindowP95 = 0;
/** Samples discounted because they landed inside a post-suspend wake window
 *  (resume cost, not the app's own latency) + the worst such sample. Kept
 *  visible on the axis — discount, don't hide. */
let suspendSamplesDiscounted = 0;
let suspendWorstSampleMs = 0;

/* The start-up rule (settleRule.ts, latencyTail): a request served inside the
 * process's first minute, or a route's first request wherever it falls, met a
 * cold path and joins no window. The worst window is then the worst SETTLED
 * window, and the verdict waits for 20 settled requests. */
const MAX_FLOOR_KEYS = 10_000;
const seenFloorKeys = new Set<string>();
let settledFloorSamples = 0;

/** How many settled requests the closed and open windows rest on. */
export function getLatencyFloorSettledSamples(): number {
  return settledFloorSamples;
}

function windowStartOf(now: number): number {
  return Math.floor(now / LATENCY_FLOOR_WINDOW_MS) * LATENCY_FLOOR_WINDOW_MS;
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1));
  return s[idx];
}

/** Close the current window (if it had samples): record its p95 and roll the
 *  worst forward. */
function closeCurrentWindow(): void {
  if (curWindow.length > 0) {
    const val = p95(curWindow);
    closedP95s.push(val);
    if (closedP95s.length > LATENCY_FLOOR_MAX_WINDOWS) closedP95s.shift();
    if (val > worstWindowP95) worstWindowP95 = val;
  }
  curWindow = [];
}

/** Fold one recorded request duration (ms) into the latency-floor windows.
 *  Called from the same request-recording path the sampler already uses. No-op
 *  under the kill-switch. */
export function recordLatencySample(durationMs: number, routeKey?: string | null): void {
  if (isBoosthisDisabled()) return;
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const now = Date.now();
  if (routeKey && !seenFloorKeys.has(routeKey)) {
    if (seenFloorKeys.size < MAX_FLOOR_KEYS) seenFloorKeys.add(routeKey);
    return;
  }
  if (now < settledFromMs("latencyTail")) return;
  // Post-suspend wake window: this duration reflects the host RESUMING a
  // suspended container, not the app's own code. Discount it from the floor
  // but keep the discount visible on the axis (count + worst discounted ms).
  if (inSuspendWakeWindow(now)) {
    suspendSamplesDiscounted++;
    if (durationMs > suspendWorstSampleMs) {
      suspendWorstSampleMs = Math.round(durationMs);
    }
    return;
  }
  const start = windowStartOf(now);
  if (curWindowStart < 0) {
    curWindowStart = start;
  } else if (start > curWindowStart) {
    // One or more window boundaries crossed since the last sample — close the
    // window that was filling (empty intervening windows contribute nothing).
    closeCurrentWindow();
    // Recompute worst from the ring in case a shifted-out window was the worst.
    if (closedP95s.length > 0) {
      worstWindowP95 = Math.max(...closedP95s);
    }
    curWindowStart = start;
  }
  curWindow.push(durationMs);
  settledFloorSamples++;
}

export function getLatencyFloorStats(): LatencyFloorStatsLike {
  // Report only COMPLETED windows; the currently-filling window is excluded so
  // a single in-progress window can't define the floor before it closes.
  return {
    worstMs: worstWindowP95,
    windowCount: closedP95s.length,
  };
}

/** Suspend-discount record for the latency-floor axis: how many post-wake
 *  samples were discounted from the floor, and the worst such sample (ms).
 *  Attached to the uploaded axis when > 0 so the discount is never silent.
 *
 *  The UNIT rides with the count. This axis discards one measurement at a
 *  time, so its number is naturally thousands of times the size of a
 *  sibling's that throws away a whole recorded distribution per discount —
 *  and on one production snapshot that difference (946 against 25) read as
 *  one of the two axes missing suspends the other caught. */
export function getLatencyFloorSuspendStats(): {
  suspendDiscounts: number;
  suspendWorstMs: number;
  suspendUnit: number;
} {
  return {
    suspendDiscounts: suspendSamplesDiscounted,
    suspendWorstMs: suspendWorstSampleMs,
    suspendUnit: SUSPEND_UNIT.SAMPLES,
  };
}

/** Wipe all server-meter state (wired into `telemetry.forget()`). Idempotent. */
export function clearServerMeters(): void {
  idleWallMs = 0;
  idleCpuMs = 0;
  idleLongTaskCount = 0;
  idleCpuMark = null;
  idleSince = 0;
  curWindowStart = -1;
  curWindow = [];
  closedP95s = [];
  worstWindowP95 = 0;
  seenFloorKeys.clear();
  settledFloorSamples = 0;
  suspendSamplesDiscounted = 0;
  suspendWorstSampleMs = 0;
}

/** @internal test hook. */
export const _serverMetersInternals = {
  IDLE_GAP_MS,
  IDLE_MIN_WALL_MS,
  LATENCY_FLOOR_WINDOW_MS,
  reset(): void {
    clearServerMeters();
  },
  /** Directly fold an idle window (for hermetic tests without wall/CPU I/O). */
  addIdleWindowForTests(wallMs: number, cpuMs: number): void {
    if (wallMs < IDLE_GAP_MS) return;
    idleWallMs += wallMs;
    idleCpuMs += cpuMs;
    if (cpuMs >= IDLE_LONG_TASK_MS) idleLongTaskCount++;
  },
  /** Directly close a window with a given p95 (for hermetic tests). */
  addClosedWindowForTests(p95Ms: number): void {
    settledFloorSamples += 10;
    closedP95s.push(p95Ms);
    if (p95Ms > worstWindowP95) worstWindowP95 = p95Ms;
  },
};
