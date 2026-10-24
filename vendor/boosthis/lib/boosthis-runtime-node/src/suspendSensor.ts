/* ─── Boosthis: host-suspend sensor (Node) ───────────────────────────────
 *
 * Scale-to-zero / autoscale hosts SUSPEND the container between requests:
 * timers fire tens of seconds late, CFS throttling accrues while nothing is
 * being served, and the first requests after a wake-up pay the resume cost.
 * The kit's honesty axes (eventLoopLag / worstFreeze / latencyFloor /
 * cpuThrottling) would otherwise record those gaps as terrifying reds even
 * though no user-facing work was ever stalled.
 *
 * This module is the SHARED detector those axes consult so they can DISCOUNT
 * (never hide) suspend artifacts:
 *
 *   • A request arriving after >= SUSPEND_GAP_MS with zero activity is a
 *     WAKE — the idle gap before it is where a suspend can have happened.
 *   • For WAKE_WINDOW_MS after a wake, the process is "waking": request
 *     latencies in that window reflect resume cost, not steady-state code.
 *     (Prod evidence: over 7 days of spans, every >=10s request fell within
 *     60s of a wake after a >=10s idle gap; zero during sustained traffic.)
 *
 * Consumers subscribe to three boundaries:
 *   onSuspendIdleStart — the loop just went idle (snapshot clean baselines).
 *   onSuspendWake      — a request arrived after a suspicious idle gap
 *                        (attribute whatever accrued in the gap to suspend).
 *   onSuspendActivity  — every request arrival (refresh traffic-time marks).
 *
 * Reuses the EXISTING request boundaries liveDetectors already tracks — no
 * new timer, no background poller, bounded state. PRIVACY: timestamps and
 * counts only; nothing here ever sees a route, URL, or customer string.
 */

import { setKitFootprintSuspendProbe } from "./kitFootprint";
import { isBoosthisDisabled } from "./runtimeFlags";

/** An idle gap at/above this (ms) is long enough for the host to have
 *  suspended the container; the wake after it opens a discount window. */
export const SUSPEND_GAP_MS = 10_000;
/** How long (ms) after a wake request latencies are attributed to resume
 *  cost rather than the app's own code. */
export const WAKE_WINDOW_MS = 60_000;
/**
 * How much wall-clock time (ms) a stretch of code may spend NOT running before
 * we stop believing the wall clock described it.
 *
 * Only consulted for intervals whose processor time was measured alongside
 * their wall time, and only on a host that has actually been WITNESSED
 * suspending (see `hostHasSuspended`). A synchronous stretch of our own
 * bookkeeping burns processor continuously; a tenth of a second of wall clock
 * with no processor behind it means the host took the processor away, which is
 * the platform's nap and not the measured code's cost.
 */
export const STALLED_WALL_WITHOUT_CPU_MS = 100;

/**
 * WHAT ONE DISCOUNT IS, per axis.
 *
 * Every suspend-aware reading publishes `suspendDiscounts`, and the number
 * means something different in each: on one production snapshot, over one
 * window and one sensor, `latencyFloor` and `kitFootprint` each reported 946
 * while `worstFreeze` reported 25. Nothing was broken — a discarded latency
 * SAMPLE, a discarded kit RUN and a thrown-away histogram RECORD are three
 * different things counted under one word — but a reader comparing the tiles
 * could only conclude that one of them was missing suspends the others saw.
 *
 * So the unit travels with the count, as a closed numeric vocabulary the
 * server owns the words for. A reading with no unit is a kit older than this
 * change, and its surfaces say exactly what they said before.
 */
export const SUSPEND_UNIT = {
  /** Individual measurements dropped from the reading before it was taken. */
  SAMPLES: 1,
  /** Whole measured runs thrown away rather than charged to the thing
   *  being measured. */
  RUNS: 2,
  /** The recorded worst thrown away and the recording restarted — one
   *  discount can cover any number of samples, which is why this number is
   *  small beside a per-sample one over the same window. */
  RECORD_RESETS: 3,
  /** Accounting periods the host reported while it was asleep. */
  PERIODS: 4,
  /** Whole billed windows the host was witnessed suspending us through. */
  BILLED_WINDOWS: 5,
} as const;

export type SuspendUnit = (typeof SUSPEND_UNIT)[keyof typeof SUSPEND_UNIT];

type Listener = (gapMs: number) => void;

let lastActivityMs = 0;
let wakeUntilMs = 0;
let wakeCount = 0;

const idleStartListeners: Listener[] = [];
const wakeListeners: Listener[] = [];
const activityListeners: Listener[] = [];

function fire(list: Listener[], gapMs: number): void {
  for (const fn of list) {
    try {
      fn(gapMs);
    } catch {
      /* a consumer's bookkeeping must never break the host's request path */
    }
  }
}

/** Call on EVERY request arrival (same boundary as liveDetectors'
 *  noteRequestStart). Detects wakes after suspicious idle gaps, then lets
 *  consumers refresh their traffic-time marks. No-op under the kill-switch. */
export function noteSuspendActivity(): void {
  if (isBoosthisDisabled()) return;
  const now = Date.now();
  if (lastActivityMs > 0) {
    const gap = now - lastActivityMs;
    if (gap >= SUSPEND_GAP_MS) {
      wakeCount++;
      wakeUntilMs = now + WAKE_WINDOW_MS;
      fire(wakeListeners, gap);
    }
  }
  lastActivityMs = now;
  fire(activityListeners, 0);
}

/** Call when the loop returns to idle (zero requests in flight — same
 *  boundary as liveDetectors' noteRequestEnd). Consumers snapshot their clean
 *  "everything up to now was traffic time" baselines here. */
export function noteSuspendIdleStart(): void {
  if (isBoosthisDisabled()) return;
  lastActivityMs = Date.now();
  fire(idleStartListeners, 0);
}

/** True while inside the post-wake window (resume-cost territory). */
export function inSuspendWakeWindow(nowMs?: number): boolean {
  const now = nowMs ?? Date.now();
  return wakeUntilMs > 0 && now <= wakeUntilMs;
}

/** How many suspend-suspicious wakes have been seen this session. */
export function getSuspendWakeCount(): number {
  return wakeCount;
}

/** Has this host ever been caught suspending? The witness, not the shape:
 *  a capability table can say a container's processor freezes between
 *  requests, but only a wake actually observed proves it happened HERE. */
export function hostHasSuspended(): boolean {
  return wakeCount > 0;
}

/** A stretch of code whose cost is about to be published, offered to the
 *  sensor for a second opinion before it is believed. */
export interface MeasuredInterval {
  /** `Date.now()` when the stretch ended — the sensor's own clock domain. */
  readonly endedAtMs: number;
  /** Wall-clock length of the stretch, ms. */
  readonly wallMs: number;
  /** Processor time consumed inside it, ms. Null where the caller could not
   *  measure it; the processor clause is then simply not available. */
  readonly cpuMs: number | null;
}

/**
 * Did the host stop running us inside this interval?
 *
 * The one question every wall-clock reading should ask before charging a
 * duration to the code it wrapped. Three clauses, none of which can fire on a
 * host that never suspends:
 *
 *   1. The interval overlaps a post-wake window. Whatever the wall clock says
 *      about a stretch that straddles a resume, it is not describing the code.
 *   2. The interval is itself longer than a suspicious idle gap. Nothing this
 *      is asked about is a stretch of synchronous bookkeeping that can honestly
 *      take ten seconds; the floor is an absurdity check, not a judgement.
 *   3. The host has been WITNESSED suspending, and the interval spent at least
 *      `STALLED_WALL_WITHOUT_CPU_MS` of wall clock with no processor behind it.
 *      This is the clause that catches the ordinary case on a container whose
 *      processor is frozen the moment it answers: the freeze does not need a
 *      wake to have been recently observed, it happens on every request, and
 *      only the gap between wall time and processor time shows it.
 *
 * On a host with no witnessed wake, clause 1 cannot fire (no window was ever
 * opened) and clause 3 is not consulted at all, so a reading taken there is
 * exactly the reading it was before this existed.
 */
export function suspendTouchedInterval(interval: MeasuredInterval): boolean {
  const { endedAtMs, wallMs, cpuMs } = interval;
  if (!Number.isFinite(endedAtMs) || !Number.isFinite(wallMs) || wallMs < 0) {
    return false;
  }
  if (
    inSuspendWakeWindow(endedAtMs) ||
    inSuspendWakeWindow(endedAtMs - wallMs)
  ) {
    return true;
  }
  if (wallMs >= SUSPEND_GAP_MS) return true;
  if (
    hostHasSuspended() &&
    cpuMs !== null &&
    Number.isFinite(cpuMs) &&
    wallMs - Math.max(0, cpuMs) >= STALLED_WALL_WITHOUT_CPU_MS
  ) {
    return true;
  }
  return false;
}

export function onSuspendIdleStart(fn: Listener): void {
  idleStartListeners.push(fn);
}
export function onSuspendWake(fn: Listener): void {
  wakeListeners.push(fn);
}
export function onSuspendActivity(fn: Listener): void {
  activityListeners.push(fn);
}

/** Wipe sensor state (wired into the same forget()/clear path as the other
 *  server meters). Listener registrations survive — they are module wiring,
 *  not data. Idempotent. */
export function clearSuspendSensor(): void {
  lastActivityMs = 0;
  wakeUntilMs = 0;
  wakeCount = 0;
}

/* ─── Wiring: the kit's own cost asks this question too ─────────────────── */

/**
 * `kitFootprint` publishes what BOOSTHIS costs its host, against ceilings we
 * state in public — and it was the one host-cost reading taking a wall-clock
 * delta without ever asking whether the clock had jumped (see
 * docs/kit-footprint-suspend-2026-09.md). It cannot import this module: it is
 * deliberately import-free so its own module evaluation can be timed from the
 * earliest instant inside the kit. So the sensor hands it the question instead,
 * here, at module level — the same shape as the listener registrations
 * eventLoopLag and runtimeVitals make.
 */
setKitFootprintSuspendProbe(suspendTouchedInterval);

/** @internal test hooks. */
export const _suspendSensorInternals = {
  SUSPEND_GAP_MS,
  WAKE_WINDOW_MS,
  STALLED_WALL_WITHOUT_CPU_MS,
  reset(): void {
    clearSuspendSensor();
  },
  /** Pretend the host has been caught suspending, so the processor clause of
   *  `suspendTouchedInterval` is live without staging a real idle gap. */
  setWakeCountForTest(count: number): void {
    wakeCount = count;
  },
  /** Force the sensor into (or out of) a wake window without wall-clock games. */
  setWakeWindowForTest(untilMs: number): void {
    wakeUntilMs = untilMs;
  },
  /** Backdate the last-activity mark so the next activity registers a gap. */
  setLastActivityForTest(ms: number): void {
    lastActivityMs = ms;
  },
};
