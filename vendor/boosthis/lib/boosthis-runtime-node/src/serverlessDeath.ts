/** Reporting a run's death from inside the run, while it is still alive.
 *
 * WHY THIS EXISTS. When a function is killed for running out of time or out of
 * memory, the code does not get to finish, the buffered measurements die with
 * it, and the developer is left with a platform log line saying the run was
 * killed. Everyone in this market reconstructs those deaths afterwards from
 * those log lines — and the log line does not contain the cause. It says the
 * run ended. It does not say the run had been sitting on a database call for
 * nine of its ten seconds.
 *
 * On a platform that hands the running code a live countdown, that is a
 * solvable problem: we can see the kill coming, and we can spend the last slice
 * of the run saying so — that it is dying, why, and what it was waiting on when
 * it died. The report goes out while the run still exists, so it survives.
 *
 * WHAT THIS WILL NOT DO. Without a live countdown there is no honest way to
 * know a kill is coming. Elapsed time measured against a limit nobody told us
 * is a guess, and a guessed death is worse than a missing one: it invents
 * failures in a healthy app. On those platforms this module abstains, the
 * reading says so, and the reason is shown to the customer.
 *
 * SAFETY. Everything here is self-guarded and unref'd. A timer of ours must
 * never hold a host's process open, and a fault of ours must never reach the
 * host's response.
 */

import {
  noteKitReduced,
  kitShouldReduce,
} from "./kitFootprint";

/* ─── Tunables ──────────────────────────────────────────────────────────── */

/**
 * How much of the run's last moments we reserve to report the death.
 *
 * Large enough for one small POST on a warm connection, small enough that we
 * are not the reason a run that would have finished does not. Reserving too
 * much would make the kit the cause of the very deaths it reports.
 */
export const DEATH_SLICE_MS = 400;

/** A run this close to its memory ceiling is one allocation from a kill. */
export const MEMORY_NEAR_KILL_PCT = 90;

/** Below this the memory sampler does not arm at all: an app running at half
 *  its ceiling does not need to be watched every quarter second, and the kit
 *  refuses to spend the customer's money watching for something that is not
 *  about to happen. */
export const MEMORY_WATCH_PCT = 70;

/** How often memory is read once a run is known to be running hot. */
const MEMORY_SAMPLE_MS = 250;

/**
 * How often memory is read on a run that is NOT yet near its ceiling.
 *
 * A run cannot be told "you have never been near the line, so you will not go
 * near it now" — the very first invocation of a fresh instance can allocate
 * straight into a kill, and that is precisely the run whose death is hardest to
 * explain afterwards. So the watch always arms where a ceiling is known; it
 * just watches half as often until something crosses the line, and speeds
 * itself up the moment one does. Two memory reads a second is far below the
 * kit's own per-run ceiling, and the ceiling still overrides it.
 */
const MEMORY_SAMPLE_COARSE_MS = 500;

/* ─── What it was waiting on ────────────────────────────────────────────── */

/**
 * A CLASS, never a name. The wire carries numbers only, and a hostname or a
 * file path is the customer's data — so the report says "waiting on the
 * network", and the line printed into the customer's OWN logs (which never
 * leave their account) is free to be more specific.
 */
export const WAITING_UNKNOWN = 0 as const;
export const WAITING_NETWORK = 1 as const;
export const WAITING_DISK = 2 as const;
export const WAITING_TIMER = 3 as const;
export const WAITING_CHILD_PROCESS = 4 as const;
/** Nothing outstanding: the run was busy in its own code. */
export const WAITING_OWN_CODE = 5 as const;

export type WaitingClass = 0 | 1 | 2 | 3 | 4 | 5;

const WAITING_TEXT: Record<WaitingClass, string> = {
  [WAITING_UNKNOWN]: "something this runtime will not name",
  [WAITING_NETWORK]: "a network call that had not come back",
  [WAITING_DISK]: "a file it was reading or writing",
  [WAITING_TIMER]: "a timer it was sleeping on",
  [WAITING_CHILD_PROCESS]: "another process it had started",
  [WAITING_OWN_CODE]: "nothing — it was busy in its own code",
};

export function waitingText(c: WaitingClass): string {
  return WAITING_TEXT[c] ?? WAITING_TEXT[WAITING_UNKNOWN];
}

/**
 * Classify what the run is blocked on, using the runtime's own list of things
 * still keeping it alive.
 *
 * This asks Node rather than instrumenting the app, on purpose: it needs no
 * hooks, costs nothing until a death is imminent, and cannot be fooled by a
 * library we do not watch. Where the runtime is too old to answer, the report
 * says it could not tell rather than picking the most likely-sounding cause.
 */
export function classifyWaiting(): WaitingClass {
  let names: string[];
  try {
    const fn = (
      process as unknown as { getActiveResourcesInfo?: () => string[] }
    ).getActiveResourcesInfo;
    if (typeof fn !== "function") return WAITING_UNKNOWN;
    names = fn.call(process) ?? [];
  } catch {
    return WAITING_UNKNOWN;
  }
  let network = 0;
  let disk = 0;
  let timer = 0;
  let child = 0;
  for (const raw of names) {
    const n = String(raw);
    if (n.includes("TCP") || n.includes("Socket") || n.includes("UDP") || n.includes("TLS")) {
      network++;
    } else if (n.includes("FS") || n.includes("File")) {
      disk++;
    } else if (n.includes("Timeout") || n.includes("Interval") || n.includes("Immediate")) {
      timer++;
    } else if (n.includes("Process") || n.includes("Pipe")) {
      child++;
    }
  }
  // Ranked by what actually kills functions. A run holding a socket open is
  // waiting on someone else's answer; a run holding only a timer chose to
  // sleep. Ties go to the network because that is the expensive one — the
  // whole point of "billed while waiting" is money spent on somebody else.
  if (network > 0) return WAITING_NETWORK;
  if (disk > 0) return WAITING_DISK;
  if (child > 0) return WAITING_CHILD_PROCESS;
  if (timer > 0) return WAITING_TIMER;
  return WAITING_OWN_CODE;
}

/* ─── What a death report looks like ────────────────────────────────────── */

export const DEATH_BY_TIME = 1 as const;
export const DEATH_BY_MEMORY = 2 as const;
export type DeathCause = 1 | 2;

export interface DeathReport {
  readonly cause: DeathCause;
  readonly waitingOn: WaitingClass;
  /** Milliseconds left on the clock when we noticed. */
  readonly remainingMs: number;
  /** Peak memory at the moment of the report, when known. */
  readonly usedMb: number | null;
  readonly limitMb: number | null;
}

/* ─── State ─────────────────────────────────────────────────────────────── */

type Reporter = () => Promise<unknown>;

let reporter: Reporter | null = null;
let timeTimer: ReturnType<typeof setTimeout> | null = null;
let memTimer: ReturnType<typeof setInterval> | null = null;
let runActive = false;
let reportedThisRun = false;

/**
 * A warning is not a death.
 *
 * Entering the last slice of the clock, or crossing the memory line, means the
 * run is ABOUT to be stopped — and most of the value here is saying so while
 * the run can still speak. But plenty of runs cross that line and finish
 * anyway, and counting the warning as a kill would tell a project its platform
 * is stopping runs that in fact all returned. So the warning is counted as a
 * warning, and a death is only counted on evidence that the run never came
 * back: the warned run's own limit has passed — it cannot still be running —
 * and the next run on this instance begins while it never closed its books.
 * Everything still open at the end stays unconfirmed and is reported as
 * unconfirmed, never folded into either total.
 */
let timeNearKills = 0;
let memoryNearKills = 0;
let warnedSurvived = 0;
let pendingCause: DeathCause | null = null;
/** When the warned run's own limit expires. A run cannot outlive it — the
 *  platform enforces it — so once this moment has passed, a run that never
 *  closed its books is a run that never came back. Null where the host hands
 *  the code no countdown, and then nothing is ever confirmed from inside. */
let pendingDeadlineAtMs: number | null = null;
/** The deadline of the run currently being watched, taken at arming time. */
let runDeadlineAtMs: number | null = null;

let timeDeaths = 0;
let memoryDeaths = 0;
let peakRssMbThisRun = 0;
const waitingTally = new Map<WaitingClass, number>();
let lastReport: DeathReport | null = null;

/** One line per cause per process, on the host's OWN error stream. Ungated —
 *  same contract as the kit's other "you need to know this" lines. It is the
 *  half of the report that survives even when the network does not. */
const said = new Set<string>();

/** Wired by the lifecycle: sends what is buffered, right now, without waiting
 *  for the next scheduled upload. */
export function setDeathReporter(fn: Reporter | null): void {
  reporter = fn;
}

function say(line: string): void {
  try {
    if (said.has(line)) return;
    said.add(line);
    // eslint-disable-next-line no-console
    console.error(line);
  } catch {
    /* a host with no console is not a reason to fail a run */
  }
}

function unref(t: unknown): void {
  try {
    (t as { unref?: () => void })?.unref?.();
  } catch {
    /* not all timer objects are unref-able */
  }
}

function rssMb(): number {
  try {
    return Math.round(process.memoryUsage().rss / (1024 * 1024));
  } catch {
    return 0;
  }
}

/* ─── The report ────────────────────────────────────────────────────────── */

function report(cause: DeathCause, remainingMs: number, limitMb: number | null): void {
  if (reportedThisRun) return;
  reportedThisRun = true;
  const waitingOn = classifyWaiting();
  const used = rssMb();
  // A WARNING, not a death. What happens to this run decides which it becomes:
  // it either closes its own books (survived) or the next run finds it still
  // open (never came back). Counting it as a kill here is how a run that
  // finished perfectly well gets reported as stopped by the platform.
  if (cause === DEATH_BY_TIME) timeNearKills++;
  else memoryNearKills++;
  pendingCause = cause;
  pendingDeadlineAtMs = runDeadlineAtMs;
  waitingTally.set(waitingOn, (waitingTally.get(waitingOn) ?? 0) + 1);
  lastReport = {
    cause,
    waitingOn,
    remainingMs: Math.max(0, Math.round(remainingMs)),
    usedMb: used > 0 ? used : null,
    limitMb,
  };

  say(
    cause === DEATH_BY_TIME
      ? `Boosthis: this run is about to be stopped for running out of time — ` +
          `about ${Math.max(0, Math.round(remainingMs))}ms left, waiting on ${waitingText(waitingOn)}. ` +
          `Reporting it now, because a stopped run cannot report itself.`
      : `Boosthis: this run is close to its memory ceiling — ` +
          `${used}MB of ${limitMb ?? "?"}MB, waiting on ${waitingText(waitingOn)}. ` +
          `Reporting it now, because a run killed for memory cannot report itself.`,
  );

  // Spend the reserved slice getting it out. Fire-and-forget on purpose: the
  // run is ending either way, and awaiting here would put our upload between
  // the customer's code and their response.
  try {
    void reporter?.()?.catch?.(() => {});
  } catch {
    /* the reporter is best-effort by construction */
  }
}

/* ─── Arming ────────────────────────────────────────────────────────────── */

/**
 * Start (or restart) the memory sampler at one of its two speeds.
 *
 * Split out because the slow speed has to be able to promote itself: a run that
 * starts comfortable and climbs is the case the old rule missed entirely, and
 * the cheapest honest answer is to watch it slowly and switch to the close
 * watch the moment it crosses the line.
 */
function startMemorySampler(limitMb: number, hot: boolean): void {
  if (memTimer) {
    clearInterval(memTimer);
    memTimer = null;
  }
  memTimer = setInterval(
    () => {
      if (!runActive) return;
      const used = rssMb();
      if (used > peakRssMbThisRun) peakRssMbThisRun = used;
      const pct = (used / limitMb) * 100;
      if (pct >= MEMORY_NEAR_KILL_PCT) {
        report(DEATH_BY_MEMORY, 0, limitMb);
        return;
      }
      // Crossed the watch line while sampling slowly: from here it is one bad
      // allocation from a kill, so watch it properly.
      if (!hot && pct >= MEMORY_WATCH_PCT) startMemorySampler(limitMb, true);
    },
    hot ? MEMORY_SAMPLE_MS : MEMORY_SAMPLE_COARSE_MS,
  );
  unref(memTimer);
}

/**
 * Arm the watch for one run.
 *
 * `remainingMs` is the platform's own live countdown, read at the start of the
 * run. Null means the platform does not hand one down — and then nothing is
 * armed, because there is nothing honest to arm on.
 *
 * `memoryLimitMb` arms the second half. Wherever a ceiling is known the watch
 * arms — including on the very first run of a fresh instance, which is exactly
 * the run that can allocate straight into a kill with no history to warn on.
 * What it does NOT do is watch a comfortable app closely: it samples slowly
 * until something is seen above the watch line and speeds up from there, so an
 * app nowhere near its ceiling pays almost nothing for a watch it does not need.
 */
export function armDeathWatch(
  remainingMs: number | null,
  memoryLimitMb: number | null,
): void {
  try {
    runActive = true;
    reportedThisRun = false;
    // What this run cannot outlive. Kept for both causes: a run stopped for
    // memory is still a run whose time limit passes, and that is what tells us
    // afterwards that it was never coming back.
    runDeadlineAtMs =
      remainingMs !== null && Number.isFinite(remainingMs)
        ? Date.now() + Math.max(0, Math.round(remainingMs))
        : null;

    if (remainingMs !== null && Number.isFinite(remainingMs)) {
      const fireIn = Math.round(remainingMs) - DEATH_SLICE_MS;
      // A run that is ALREADY inside its last slice is reported immediately —
      // waiting for a timer that fires in negative time reports nothing.
      if (fireIn <= 0) {
        report(DEATH_BY_TIME, remainingMs, memoryLimitMb);
      } else {
        timeTimer = setTimeout(() => {
          if (runActive) report(DEATH_BY_TIME, DEATH_SLICE_MS, memoryLimitMb);
        }, fireIn);
        unref(timeTimer);
      }
    }

    if (memoryLimitMb !== null && memoryLimitMb > 0) {
      // Our own ceiling comes first: if the kit is already costing more than it
      // said it would, it gives up its optional watching rather than the
      // customer's money.
      if (kitShouldReduce()) {
        noteKitReduced();
      } else {
        // Already hot — from a previous run's peak, or from where this run is
        // starting. Either way there is no reason to sample slowly.
        const startedAt = rssMb();
        if (startedAt > peakRssMbThisRun) peakRssMbThisRun = startedAt;
        const hot =
          (peakRssMbThisRun / memoryLimitMb) * 100 >= MEMORY_WATCH_PCT;
        startMemorySampler(memoryLimitMb, hot);
      }
    }
  } catch {
    /* arming a watch must never break a customer's request */
  }
}

/**
 * A NEW run has begun while a warning from an earlier run is still open.
 *
 * This is the only evidence available from inside a process that a warning
 * became a real kill, and it takes TWO facts together: the warned run's own
 * limit has passed, so the platform cannot still be running it, and it never
 * closed its own books — a run that answers disarms the watch, so a warning
 * still open at this point belongs to a run that never came back.
 *
 * The expired limit is what makes this safe on the always-on look-alike: a
 * container billed per request-second serves many runs at once, so a new run
 * beginning proves nothing on its own about an older one, but a run past its
 * own limit is over on any host. Where the platform hands the code no
 * countdown there is no limit to expire, so nothing is ever confirmed from
 * inside and the warning is reported as unconfirmed. Guessing here is how a
 * healthy app gets told its platform is killing runs that all came back.
 *
 * Returns true when a death was confirmed.
 */
export function settleWarnedRunAtNewRun(): boolean {
  try {
    if (pendingCause === null) return false;
    // The one piece of evidence that survives concurrency: the warned run's own
    // limit has passed, so it cannot still be running, and it never closed its
    // books. Without a countdown there is no deadline to pass and nothing is
    // ever confirmed from inside — the warning is reported as unconfirmed
    // instead of being guessed either way.
    if (pendingDeadlineAtMs === null || Date.now() < pendingDeadlineAtMs) {
      return false;
    }
    if (pendingCause === DEATH_BY_TIME) timeDeaths++;
    else memoryDeaths++;
    pendingCause = null;
    pendingDeadlineAtMs = null;
    return true;
  } catch {
    return false;
  }
}

/** The run ended on its own. Stand everything down. */
export function disarmDeathWatch(memoryLimitMb: number | null): void {
  try {
    runActive = false;
    // The run closed its own books, so whatever we warned about, the platform
    // did not stop it. The warning stands (it was true — the run was one slice
    // from being killed) but it is a survival, not a death.
    if (pendingCause !== null) {
      warnedSurvived++;
      pendingCause = null;
      pendingDeadlineAtMs = null;
    }
    runDeadlineAtMs = null;
    if (timeTimer) {
      clearTimeout(timeTimer);
      timeTimer = null;
    }
    if (memTimer) {
      clearInterval(memTimer);
      memTimer = null;
    }
    // Remember the peak ACROSS runs: it is what decides whether the next run
    // is worth sampling. A run that ended at 85% of its ceiling is the warning
    // the next one needs.
    const used = rssMb();
    if (used > peakRssMbThisRun) peakRssMbThisRun = used;
    void memoryLimitMb;
  } catch {
    /* nothing here may reach the host */
  }
}

/* ─── Reading ───────────────────────────────────────────────────────────── */

export interface DeathCounters {
  /** Runs that came within the reporting slice of being stopped for time. */
  readonly timeNearKills: number;
  /** Runs that came within the watch line of their memory ceiling. */
  readonly memoryNearKills: number;
  /** Warned runs that finished anyway. The platform did not stop them. */
  readonly warnedSurvived: number;
  /** Warned, and we do not yet know how it ended. Never counted as either. */
  readonly warnedUnconfirmed: number;
  /** Warned for time and never came back. */
  readonly timeDeaths: number;
  /** Warned for memory and never came back. */
  readonly memoryDeaths: number;
  /** The class most often blocking a warned run, or null when none was seen. */
  readonly worstWaitingOn: WaitingClass | null;
  readonly lastReport: DeathReport | null;
}

export function deathCounters(): DeathCounters {
  let worst: WaitingClass | null = null;
  let worstN = 0;
  for (const [k, n] of waitingTally) {
    if (n > worstN) {
      worstN = n;
      worst = k;
    }
  }
  return {
    timeNearKills,
    memoryNearKills,
    warnedSurvived,
    warnedUnconfirmed: pendingCause === null ? 0 : 1,
    timeDeaths,
    memoryDeaths,
    worstWaitingOn: worst,
    lastReport,
  };
}

/** Test seam. */
export function _resetDeathWatchForTests(): void {
  if (timeTimer) clearTimeout(timeTimer);
  if (memTimer) clearInterval(memTimer);
  timeTimer = null;
  memTimer = null;
  runActive = false;
  reportedThisRun = false;
  timeNearKills = 0;
  memoryNearKills = 0;
  warnedSurvived = 0;
  pendingCause = null;
  timeDeaths = 0;
  memoryDeaths = 0;
  peakRssMbThisRun = 0;
  waitingTally.clear();
  lastReport = null;
  reporter = null;
  said.clear();
}

/** Test seam: pretend a previous run already ran hot, so the memory sampler
 *  arms at its CLOSE cadence rather than its slow one. (The sampler itself arms
 *  wherever a ceiling is known, including on a first run with no history.) */
export const _deathWatchInternals = {
  setPeakRssMb(mb: number): void {
    peakRssMbThisRun = mb;
  },
  peakRssMb(): number {
    return peakRssMbThisRun;
  },
};
