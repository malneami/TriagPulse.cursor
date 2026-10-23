/** The per-invocation lifecycle.
 *
 * A long-running server measures continuously and uploads on a timer. A
 * function cannot: the invocation is frozen the moment it answers, so a timer
 * scheduled during it never fires and everything gathered dies with it. The
 * shape that works is the one the PHP kit already proves — arm on first use,
 * keep what you gather for that invocation, and finish sending BEFORE the
 * invocation ends:
 *
 *     begin  →  the host's own work  →  response  →  flush  →  freeze
 *
 * Two ways to run the flush, in order of preference:
 *
 *   1. **After the response.** Where the platform can keep working once the
 *      visitor has been answered, we use its own mechanism — Vercel's request
 *      context `waitUntil`, the same thing PHP's `fastcgi_finish_request()`
 *      buys. The visitor waits for nothing.
 *   2. **Before returning.** Where no such mechanism exists (AWS Lambda freezes
 *      on return, full stop), the flush runs before the response completes, and
 *      the delay is bounded by a budget and measured on every single run.
 *
 * Nothing here is best-effort-and-hope: the budget is a hard ceiling, the cost
 * is recorded, and whatever did not get out is counted rather than forgotten.
 */

import {
  noteFlushCost,
  noteInvocation,
  noteRowsDiscarded,
  noteRunEnd,
  noteStranded,
  noteTimeRemaining,
  type FlushPlacement,
  type RunMark,
} from "./serverlessMeters";
import { suspendTouchedInterval } from "./suspendSensor";
import { isKitLocked } from "./killSwitch";
import {
  isFrozenBetweenRequests,
  isPerRunBilled,
  isServerlessMode,
  serverlessHost,
} from "./serverless";
import {
  armDeathWatch,
  disarmDeathWatch,
  setDeathReporter,
  settleWarnedRunAtNewRun,
} from "./serverlessDeath";
import {
  chargeRunOverhead,
  closeRunOverhead,
  openKitRun,
  type KitRun,
} from "./kitFootprint";

/* ─── The cost ceiling ─────────────────────────────────────────────────── */

/** Default ceiling on the time our flush may take. On a function that answers
 *  in 200 ms this is already a third of the workload, which is why it is a
 *  ceiling rather than a target — a normal flush is a single small POST. */
export const DEFAULT_FLUSH_BUDGET_MS = 300;
/** Nothing may raise the ceiling past this, whatever the environment says.
 *  A customer cannot accidentally configure us into being their bottleneck. */
export const MAX_FLUSH_BUDGET_MS = 1_000;
const MIN_FLUSH_BUDGET_MS = 50;

/**
 * THE SHORTER CEILING, FOR THE HOST WHERE AN UNFINISHED FLUSH IS NOT A LOSS.
 *
 * A real function's rows die at the freeze: they are in a process the platform
 * may never wake, so the budget there buys the last chance they will ever get.
 * A frozen CONTAINER is different in the one way that decides this number — its
 * process survives its own answer, so rows a flush did not finish sending are
 * stranded, not lost, and travel on the next wake. The visitor should therefore
 * pay for one ordinary upload and not a millisecond more.
 *
 * Two hundred milliseconds is an ordinary flush (ours measures ~66 ms against a
 * receiver on the same machine) with room for a slow network, and it is the
 * worst a visitor can wait on this shape of host. The AVERAGE is held to the
 * much smaller `FLUSH_ADDED_MS_CEILING`, which is what a normal flush actually
 * costs; this is the hard stop that makes a ten-second page load impossible
 * rather than merely unlikely.
 */
export const FROZEN_FLUSH_BUDGET_MS = 200;

/** The budget as configured, before the host's own shape narrows it. */
function configuredFlushBudgetMs(): number {
  const raw = process.env.BOOSTHIS_SERVERLESS_BUDGET_MS;
  if (!raw) return DEFAULT_FLUSH_BUDGET_MS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_FLUSH_BUDGET_MS;
  return Math.min(MAX_FLUSH_BUDGET_MS, Math.max(MIN_FLUSH_BUDGET_MS, Math.round(n)));
}

export function flushBudgetMs(): number {
  const configured = configuredFlushBudgetMs();
  // Narrowed, never widened: a customer who raises the budget for their
  // function host does not thereby agree to hold a container's visitors for
  // longer than one upload, on a host where waiting longer wins nothing.
  if (!isServerlessMode() && isFrozenBetweenRequests()) {
    return Math.min(configured, FROZEN_FLUSH_BUDGET_MS);
  }
  return configured;
}

/* ─── The flush, injected ──────────────────────────────────────────────── */

/** Sends everything buffered. Resolves with how many measurements are STILL
 *  buffered afterwards (0 when everything got out). Must never throw. */
/** Shortest gap between whole-meter-page uploads on a function host. The page
 *  is far bigger than a batch of samples and the customer pays for the
 *  bandwidth, so it rides at most once a minute of instance life rather than
 *  once per invocation. */
export const SERVERLESS_SNAPSHOT_MIN_MS = 60_000;

/**
 * The clock the flush itself can read.
 *
 * A budget enforced only by the CALLER stops the caller waiting; it does not
 * stop the work. Our flush is five sequential round trips, so a `Promise.race`
 * that gives up after 300 ms left all five of them running — and the next
 * request started five more on top. Handing the deadline INTO the flush lets it
 * stand down at the next step boundary instead, which is the difference between
 * one bounded upload and an unbounded pile of them.
 */
export interface FlushDeadline {
  /** Is the budget already spent? Checked between steps, never mid-request. */
  expired: () => boolean;
  /** How much of the budget is left, in ms. Never negative. */
  remainingMs: () => number;
}

export type InvocationFlush = (deadline?: FlushDeadline) => Promise<number>;

/** How many measurements are buffered right now. Read when the flush did NOT
 *  get to tell us — it ran out of budget, or it threw. Without it, "we gave up"
 *  would have to be reported as a guess, and a guessed loss number is exactly
 *  the dishonesty this counting exists to remove. */
export type PendingReader = () => number;

let flushImpl: InvocationFlush | null = null;
let pendingImpl: PendingReader | null = null;
let giveUpImpl: BacklogGiveUp | null = null;

/**
 * Throw away everything still held, and say how many rows went. Wired by
 * telemetry, which is the only place that knows what the queues are.
 *
 * WHY A KIT WOULD EVER DO THIS. Held-for-ever is a third outcome that neither
 * "delivered" nor "lost" describes, and it is the worst of the three: the rows
 * are gone from the customer's dashboard exactly as if they had been lost, they
 * are still occupying the buffer that the NEXT measurements need, and nothing
 * anywhere says so. Ending the backlog turns a silent hole into a counted one
 * with a cause attached.
 */
export type BacklogGiveUp = () => number;

/** How long a backlog may sit before the kit gives up on it. Chosen against
 *  what it is protecting: five minutes of failing uploads is long past the
 *  point where the next wake was going to carry them. */
export const BACKLOG_MAX_HOLD_MS = 5 * 60_000;
/** ...and it must also have survived this many flushes, so a single slow
 *  minute on a quiet instance never throws anything away. */
export const BACKLOG_MIN_HELD_FLUSHES = 10;

/** When the current backlog first appeared, and how many flushes have ended
 *  with it still there. Both reset the moment everything gets out. */
let backlogSinceMs: number | null = null;
let backlogHeldFlushes = 0;

/** Wired by telemetry once it knows how to upload. Kept as an injection so this
 *  module never imports the upload paths (they import the kill-switch, which
 *  imports storage, which is exactly the cycle to avoid). */
export function setInvocationFlush(
  fn: InvocationFlush | null,
  pending?: PendingReader | null,
  giveUp?: BacklogGiveUp | null,
): void {
  flushImpl = fn;
  pendingImpl = pending ?? null;
  giveUpImpl = giveUp ?? null;
  backlogSinceMs = null;
  backlogHeldFlushes = 0;
  // A run that is about to be killed cannot wait for the next scheduled
  // upload — there will not be one. It gets the same flush, run inside the
  // slice reserved for exactly this, and bounded the same way so our report of
  // a death never becomes the cause of one.
  // A dying run's last report. Nobody is holding a response open for it — the
  // run is being killed, not answered — so it is charged to the bill, never to
  // a visitor who is no longer there.
  setDeathReporter(fn ? () => startBoundedFlush("after-response").wait : null);
}

/* ─── The platform's after-response mechanism ──────────────────────────── */

type WaitUntil = (p: Promise<unknown>) => void;

/**
 * Vercel exposes a per-request context on a well-known global symbol, and its
 * `@vercel/functions` package is a thin wrapper over exactly this. Reading the
 * symbol directly means the kit gains no dependency and works whether or not
 * the customer has that package installed.
 *
 * Returns null on every platform that has no such mechanism — AWS Lambda,
 * Netlify's Node functions, Azure — and the caller then flushes before
 * returning instead.
 */
export function resolveWaitUntil(): WaitUntil | null {
  try {
    const holder = (globalThis as Record<symbol, unknown>)[
      Symbol.for("@vercel/request-context")
    ] as { get?: () => { waitUntil?: unknown } } | undefined;
    const ctx = typeof holder?.get === "function" ? holder.get() : undefined;
    const w = ctx?.waitUntil;
    return typeof w === "function" ? (w as WaitUntil) : null;
  } catch {
    return null;
  }
}

/* ─── Invocation state ─────────────────────────────────────────────────── */

/**
 * One run's own boundary, handed back when it begins and presented again when
 * it ends.
 *
 * A handle, not module state. A real function serves one run at a time, but the
 * always-on look-alike this same code covers — a container billed per
 * request-second — serves many at once by default. Module state describes the
 * first shape and silently mis-describes the second: overlapping requests
 * overwrite one another's start, the first to finish closes somebody else's
 * boundary, and the rest are never counted at all.
 */
export interface InvocationRun {
  /** The meters' boundary for this run. Null where runs are not billed by the
   *  run — an ordinary server still measures what the kit itself costs. */
  readonly mark: RunMark | null;
  /** What the kit itself cost this run. Filed exactly once, at the end. */
  readonly kit: KitRun;
  /** Set when THIS run armed the death watch, so exactly one run disarms it. */
  watchArmed: boolean;
  /** Guard: a run is finished once, however many host events fire. */
  finished: boolean;
}

/**
 * The promise a caller may await to know the flush is done, and the promise
 * that tracks whether a flush is REALLY still running. They are not the same
 * thing, and merging them was the bug.
 *
 * `startBoundedFlush` gives up waiting after the budget, so the first settles at
 * the budget. The upload it gave up on carries on — five sequential round trips
 * do not stop because we stopped watching — so if the "is one running?" guard
 * reads the first promise, every subsequent request starts another flush on top
 * of the abandoned one. On a container answering a request a second with a
 * ten-second flush that is ten concurrent uploads, each holding a snapshot
 * payload, a set of sockets and a pair of timers. That is a handle churn and a
 * memory profile with no leak anywhere in it.
 */
let inFlight: Promise<void> | null = null;
let reallyRunning: Promise<void> | null = null;
let reallyRunningSinceMs = 0;
/** How long a still-running flush may hold the "one at a time" guard. A flush
 *  frozen mid-way on a host that never wakes again would otherwise silence the
 *  kit for the life of the instance. */
const RUNNING_STALE_MS = 60_000;
/** How many open runs are currently being watched for a kill. The watch is
 *  instance-wide (one memory sampler, one countdown), so it arms on the first
 *  run and is only taken down when the last one has gone. */
let watchingRuns = 0;
/** The last run begun, for a hand-wired caller that finishes without presenting
 *  its handle. Our own boundaries always present one. */
let lastRun: InvocationRun | null = null;

/** The smallest gap between two flushes on a frozen container. Only reachable
 *  where a skipped flush cannot lose anything (the process survives), so this
 *  is purely a bill the customer does not have to pay. */
const FROZEN_FLUSH_MIN_MS = 1_000;
let lastFrozenFlushAtMs = 0;

/** Begin one run. Cheap enough to call on every request, and the handle it
 *  returns is that run's own boundary — hand it back to `finishInvocation`. */
export function beginInvocation(): InvocationRun {
  // The kit's own cost is measured on EVERY host, function or not: a published
  // ceiling that only applies where the customer is billed by the run would be
  // a ceiling nobody could check on an ordinary server.
  const kit = openKitRun();
  // Deliberately isPerRunBilled(), not isServerlessMode(). A container whose
  // processor is frozen the moment it answers loses a timer-scheduled upload
  // exactly the way a function does, and is billed by the request-second
  // exactly the way a function is — so it needs this shape too. What it does
  // NOT get is a change of identity: it is still not a function, and nothing
  // about how it registers moves.
  const mark = chargeRunOverhead(
    () => (isPerRunBilled() ? noteInvocation() : null),
    kit,
  );
  const run: InvocationRun = { mark, kit, watchArmed: false, finished: false };
  lastRun = run;
  return run;
}

/** The host handed us a Lambda-style context: record how much of the function's
 *  time limit the run actually used. This is the only way any platform tells a
 *  function what its ceiling is. */
export function noteInvocationContext(
  context: { getRemainingTimeInMillis?: () => number } | undefined,
  configuredLimitMs: number | null,
): void {
  try {
    if (typeof context?.getRemainingTimeInMillis !== "function") return;
    const remaining = context.getRemainingTimeInMillis();
    // No platform states the limit in the environment, so it is reconstructed
    // from the first reading of an invocation: at the very start, remaining IS
    // the limit. Callers pass what they learned then.
    const limit = configuredLimitMs ?? remaining;
    noteTimeRemaining(remaining, limit);
  } catch {
    /* a host context that throws is not a reason to fail an invocation */
  }
}

/**
 * Arm the watch that reports a run's death from inside the dying run.
 *
 * Split out from `noteInvocationContext` on purpose: that one is read at the
 * END of a run to record how much of the limit was used, and this one has to
 * happen at the START or there is nothing left to warn about. Passing the live
 * countdown as a plain number keeps the death watch free of any knowledge of
 * what a host context looks like.
 */
export function armRunDeathWatch(
  remainingMsAtStart: number | null,
  run?: InvocationRun | null,
): void {
  try {
    if (!isPerRunBilled()) return;
    if (run?.watchArmed) return;
    if (run) run.watchArmed = true;
    // A warning left open by an earlier run, settled here rather than inside
    // the watch: a run the platform stopped never reached `finishInvocation`,
    // so its slot is still counted as open and the watch below would refuse to
    // arm for its replacement. A confirmed kill closes that leaked slot — the
    // stopped run is not still running.
    if (settleWarnedRunAtNewRun()) watchingRuns = 0;
    watchingRuns++;
    // The watch is instance-wide: one memory sampler, one countdown. A second
    // request arriving while the first is still running must not restart them
    // — that would reset a countdown against the wrong run's deadline and pay
    // twice for the same watching. The first open run arms; the last one out
    // takes it down.
    if (watchingRuns > 1) return;
    armDeathWatch(remainingMsAtStart, serverlessHost().memoryLimitMb);
  } catch {
    /* arming a watch must never break a customer's request */
  }
}

function timeout(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve("timeout"), ms);
    // Never hold the process open for our own deadline.
    (t as unknown as { unref?: () => void }).unref?.();
  });
}

/** Run the flush under the budget, record what it cost and what it left
 *  behind. Never throws, never rejects. */
function readPending(): number {
  try {
    const n = pendingImpl ? pendingImpl() : 0;
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  } catch {
    return 0;
  }
}

function cpuMsNow(): number | null {
  try {
    const u = process.cpuUsage();
    return (u.user + u.system) / 1000;
  } catch {
    return null;
  }
}

/**
 * The backlog has an ending now.
 *
 * Held-for-ever was a third outcome hiding between "delivered" and "lost": the
 * rows are missing from the customer's dashboard either way, but only one of
 * the two is counted, explained and reported. A backlog that has survived both
 * bounds is given up on — counted as lost, with `heldTooLong` as the cause, and
 * announced through the kit's own problem channel like every other loss.
 */
function endBacklogIfStuck(stillHeld: number): void {
  try {
    if (stillHeld <= 0) {
      backlogSinceMs = null;
      backlogHeldFlushes = 0;
      return;
    }
    const now = Date.now();
    if (backlogSinceMs === null) backlogSinceMs = now;
    backlogHeldFlushes++;
    if (
      backlogHeldFlushes < BACKLOG_MIN_HELD_FLUSHES ||
      now - backlogSinceMs < BACKLOG_MAX_HOLD_MS
    ) {
      return;
    }
    backlogSinceMs = null;
    backlogHeldFlushes = 0;
    if (!giveUpImpl) return;
    const discarded = giveUpImpl();
    if (discarded > 0) noteRowsDiscarded(discarded, "heldTooLong");
  } catch {
    /* ending a backlog may never be the thing that ends a request */
  }
}

/**
 * Start a flush, and hand back BOTH promises: what the caller waits for, and
 * what is actually still running.
 *
 * They are not the same promise and treating them as one is the bug this split
 * exists to prevent. `wait` settles at the budget whether the upload finished
 * or not — that is what stops a visitor waiting ten seconds. `work` settles
 * only when the upload itself does, and it is what the "is one already
 * running?" guard has to read: an upload we stopped WAITING for is still
 * holding its payload, its sockets and its timers, and starting another on top
 * of it is how one slow receiver becomes ten concurrent uploads.
 */
function startBoundedFlush(placement: FlushPlacement): {
  wait: Promise<void>;
  work: Promise<void>;
} {
  const budget = flushBudgetMs();
  const started = Date.now();
  const cpuStart = cpuMsNow();
  const deadlineAt = started + budget;
  const deadline: FlushDeadline = {
    expired: () => Date.now() >= deadlineAt,
    remainingMs: () => Math.max(0, deadlineAt - Date.now()),
  };
  // One call of the injected flush, shared by both promises: racing a SECOND
  // call against the timer would upload everything twice.
  const real: Promise<number | "threw"> = (async () => {
    try {
      return flushImpl ? await flushImpl(deadline) : 0;
    } catch {
      return "threw";
    }
  })();
  return {
    wait: accountForFlush(real, { placement, budget, started, cpuStart }),
    // Never rejects: `real` already swallowed its own failure, and a promise
    // nobody awaits must not take the host down.
    work: real.then(
      () => {},
      () => {},
    ),
  };
}

async function accountForFlush(
  real: Promise<number | "threw">,
  ctx: {
    placement: FlushPlacement;
    budget: number;
    started: number;
    cpuStart: number | null;
  },
): Promise<void> {
  const { placement, budget, started, cpuStart } = ctx;
  let stranded = 0;
  try {
    // The deadline goes INTO the flush as well as around it. The race stops us
    // waiting; only the flush itself can stop the work, and an upload nobody is
    // waiting for is exactly the one that piles up.
    const outcome = await Promise.race([real, timeout(budget)]);
    // We ran out of our own budget, or the flush threw. Either way it never got
    // to tell us what it left behind, so we count what is ACTUALLY still
    // buffered rather than inventing a number. It travels on the next wake if
    // there is one — stranded, which is not the same as lost, and is reported
    // separately so neither is overstated.
    stranded =
      typeof outcome === "number" ? outcome : readPending();
  } catch {
    stranded = readPending();
  }
  const endedAtMs = Date.now();
  const wallMs = endedAtMs - started;
  const cpuEnd = cpuMsNow();
  const cpuMs =
    cpuStart !== null && cpuEnd !== null ? Math.max(0, cpuEnd - cpuStart) : null;
  // A FLUSH THAT RAN AFTER THE RESPONSE CAN BE FROZEN HALFWAY THROUGH. On a
  // container whose processor stops the moment it answers, the wall clock
  // across our own upload measures the host's nap far more than it measures us
  // — and that number is published as "what the kit costs a request". Ask the
  // shared suspend sensor the same question every other wall-clock reading in
  // the kit asks, and where it says the host stopped running us, publish the
  // processor time instead: process-wide, so if anything it overstates our
  // share, which is the right direction to be wrong in. Nothing is discarded;
  // every flush still files exactly one cost reading.
  const suspended = suspendTouchedInterval({ endedAtMs, wallMs, cpuMs });
  const costMs = suspended && cpuMs !== null ? cpuMs : wallMs;
  noteFlushCost(costMs, placement);
  if (stranded > 0) noteStranded(stranded);
  endBacklogIfStuck(stranded);
}

/**
 * Finish the invocation: send everything, using the platform's after-response
 * mechanism when it has one.
 *
 * Returns a promise the CALLER may await. On a platform with `waitUntil` the
 * promise resolves immediately (the work continues past the response, handed to
 * the platform). Without one, awaiting it is what keeps the invocation alive
 * long enough to send — so a Lambda-shaped caller must await, and the express
 * middleware does.
 */
export function finishInvocation(
  failed = false,
  run?: InvocationRun | null,
): Promise<void> {
  // A caller that hands no handle over gets the last run begun. Our own
  // boundaries always present one, which is what keeps overlapping requests
  // apart on a container that serves several at a time.
  const handle = run ?? lastRun;
  const kit = handle?.kit ?? null;
  const frozenContainer = isFrozenBetweenRequests();
  // Close the run's books BEFORE the flush, so the cost readings describe the
  // customer's work rather than the customer's work plus our upload. Both are
  // billed and both are reported — just never as the same number.
  if (handle && !handle.finished) {
    handle.finished = true;
    try {
      chargeRunOverhead(() => {
        noteRunEnd(handle.mark, failed);
        // Only the last run still open takes the watch down: disarming while
        // another request is mid-flight would leave that one unwatched, which
        // is the one case this whole reading exists for.
        if (handle.watchArmed) {
          handle.watchArmed = false;
          watchingRuns = Math.max(0, watchingRuns - 1);
          if (watchingRuns === 0) disarmDeathWatch(serverlessHost().memoryLimitMb);
        }
      }, kit);
    } catch {
      /* a failure to close the books is never a failure of the run */
    }
  }
  // Our own books close here too, on EVERY host and deliberately BEFORE the
  // flush: the per-run ceiling is about what our instrumentation costs the run,
  // and a network call we chose to make is reported separately rather than
  // hidden inside it. Filed exactly once per run — a run counted twice halves
  // the average the kit publishes its own ceiling against.
  try {
    closeRunOverhead(kit);
  } catch {
    /* measuring ourselves may never be the thing that breaks a run */
  }
  // Nothing further to send where runs are not billed by the run, or where this
  // run never opened one (a host that is not a function still measures our own
  // cost above, and stops here).
  if (!isPerRunBilled() || !handle?.mark) return Promise.resolve();
  // Coalesce: a response that fires both `finish` and `close` must flush once.
  if (inFlight) return inFlight;
  // AND: do not start one ON TOP of an upload that is still going. The budget
  // above stops us WAITING; it does not stop the work, so without this a host
  // answering a request a second while a flush takes ten accumulates ten
  // concurrent uploads. The staleness escape is there because a flush can be
  // frozen mid-way on exactly the hosts this file exists for, and a promise
  // that never settles must not silence the kit for the life of the instance.
  if (reallyRunning && Date.now() - reallyRunningSinceMs < RUNNING_STALE_MS) {
    return Promise.resolve();
  }

  // THE ALWAYS-ON LOOK-ALIKE PAYS LESS THAN A FUNCTION DOES, and this is where
  // most of that saving is. A frozen container is not a function in one way
  // that matters here: its process SURVIVES the freeze, so whatever is still
  // buffered simply travels on the next request instead of dying with the run.
  // That makes a SKIPPED flush safe here in a way it never is on a real
  // function — and a container answering many requests would otherwise hold a
  // visitor at the end of every one of them, which is exactly the third of a
  // second our own server was adding to the average request. So it keeps a
  // minimum gap, and nothing is noted: no flush was attempted, so there is no
  // flush cost to charge and nothing was stranded.
  if (frozenContainer) {
    const now = Date.now();
    if (now - lastFrozenFlushAtMs < FROZEN_FLUSH_MIN_MS) return Promise.resolve();
    lastFrozenFlushAtMs = now;
  }

  const waitUntil = resolveWaitUntil();
  if (waitUntil) {
    const { wait, work } = startBoundedFlush("platform");
    track(wait, work);
    try {
      // The PLATFORM is handed the bounded promise: it keeps the instance alive
      // until we have either finished or run out of budget, and no longer.
      waitUntil(wait);
    } catch {
      // The platform refused the handoff — fall back to doing it inline rather
      // than dropping the measurements on the floor.
      return wait;
    }
    // The visitor waits for nothing.
    return Promise.resolve();
  }

  // WHO IS WAITING DECIDES WHAT THIS IS CALLED. With no after-response
  // mechanism the response wrapper is holding the visitor's response open for
  // this — on a function because the rows die otherwise, on a frozen container
  // because nothing would run afterwards to send them. Either way the visitor
  // is waiting, so it is reported as blocking and bounded as blocking: the
  // budget is a hard ceiling and, on the container, the shorter one. Anywhere
  // else (a job runner, a long-running process that is billed per run) we are
  // already past the response, and the upload is charged to the bill rather
  // than to the page load.
  const blocking = needsFlushBeforeResponse();
  const { wait, work } = startBoundedFlush(
    blocking ? "blocking" : "after-response",
  );
  track(wait, work);
  if (blocking) return wait;
  // Nothing is awaiting this, so nothing may reject out of it either.
  wait.catch(() => {});
  return Promise.resolve();
}

/**
 * Remember both halves: what a second caller may join, and what is really
 * still running.
 *
 * `inFlight` coalesces the two events one response fires (`finish` and
 * `close`) into one flush. `reallyRunning` is the guard against stacking a new
 * upload on an abandoned one, so it must follow the WORK — a flush we stopped
 * waiting for at the budget has not stopped uploading, and reading the
 * budgeted promise here is what would let ten of them run at once.
 */
function track(wait: Promise<void>, work: Promise<void>): void {
  const waited = wait.finally(() => {
    if (inFlight === waited) inFlight = null;
  });
  inFlight = waited;
  // Nothing awaits this copy; it exists only to clear the marker.
  waited.catch(() => {});
  const running = work.finally(() => {
    if (reallyRunning === running) reallyRunning = null;
  });
  reallyRunning = running;
  reallyRunningSinceMs = Date.now();
  running.catch(() => {});
}

/** Is there a platform mechanism for working after the response? Reported on
 *  the kit's own surfaces so a developer can see which of the two shapes they
 *  are getting. */
export function hasAfterResponseMechanism(): boolean {
  return resolveWaitUntil() !== null;
}

/**
 * Must the request boundary HOLD the response open until the flush has run?
 *
 * On a platform WITH an after-response mechanism, no: the work is handed over
 * and the visitor waits for nothing. That is the only answer that costs a
 * visitor nothing, and it is taken wherever the platform offers it.
 *
 * Without one, the answer is yes on both shapes of per-run host, for the same
 * reason and with two different bounds.
 *
 * A REAL FUNCTION freezes at the completion of the response: an adapter that
 * turns an HTTP app into a function handler resolves on the response's own
 * `finish` event, the handler returns, and the platform freezes the invocation
 * with our upload still in flight. A flush hung off `finish` is already too
 * late, however carefully it is awaited, and the rows in it are gone with the
 * instance.
 *
 * A FROZEN CONTAINER stops getting processor at the same instant. Its rows are
 * better off — the process survives, so an unfinished upload is stranded rather
 * than lost — but a continuation scheduled at the response boundary does not
 * run: there is no processor to run it on until something wakes the container,
 * and on the harshest version of this host there is no afterwards at all. We
 * tried the other way and measured it: with the flush deferred, a frozen
 * container delivered NOTHING, and every row it had gathered sat waiting on a
 * timer that cannot fire.
 *
 * So the placement is not what was wrong on our own server. What was wrong was
 * the absence of a bound: 345 blocking flushes, an average of 329 ms added to
 * every request and one visitor who waited 10.3 seconds. A flush now runs under
 * a hard wall-clock ceiling that the deadline enforces INSIDE the upload as
 * well as around it; on a frozen container that ceiling is the shorter
 * `FROZEN_FLUSH_BUDGET_MS`, because there an overrun costs a delay and not a
 * row; and a container answering steadily flushes at most once a second rather
 * than once a request. Ten seconds is no longer reachable, the average is held
 * to a published figure, and what a flush could not finish is counted.
 */
export function needsFlushBeforeResponse(): boolean {
  if (resolveWaitUntil() !== null) return false;
  return isServerlessMode() || isFrozenBetweenRequests();
}

/* ─── The bare-handler wrapper ─────────────────────────────────────────── */

/** Anything Lambda-shaped hands a handler as its second argument. Only one
 *  method is read, and only to learn how close the run came to its ceiling. */
export interface FunctionContext {
  getRemainingTimeInMillis?: () => number;
}

/**
 * Wrap a bare function handler so Boosthis arms on entry and finishes sending
 * before the invocation ends.
 *
 * Express apps need none of this — `boosthis()` already sits on the request
 * boundary. This is for the handler-shaped world (`export const handler = ...`),
 * where there is no middleware to hook and where the platform hands the handler
 * a context. That context is the ONLY way any platform tells a function how
 * long it may run, which is why timeout headroom is measurable here and
 * abstains everywhere else.
 *
 * The wrapper never changes the handler's answer and never lets a Boosthis
 * failure reach the caller: a throw from our side is swallowed, and a throw
 * from the handler is re-thrown untouched after we have flushed.
 */
export function withBoosthis<A extends unknown[], R>(
  handler: (...args: A) => R | Promise<R>,
): (...args: A) => Promise<R> {
  return async function boosthisHandler(...args: A): Promise<R> {
    // LOCKED (docs/kit-lock-rule.md): the handler runs exactly as it would
    // without the kit. Nothing is armed, measured or sent for this run.
    let locked = false;
    try {
      locked = isKitLocked();
    } catch {
      locked = false;
    }
    if (locked) return await handler(...args);
    let limitAtStart: number | null = null;
    let failed = false;
    const context = args[1] as FunctionContext | undefined;
    // This run's own boundary, held in the handler's own scope. Two invocations
    // of the same wrapped handler in the same process never share it.
    let run: InvocationRun | null = null;
    try {
      run = beginInvocation();
      // Charged to our own footprint: everything in this block is work the
      // customer's run pays for because we are in it, so it is measured by the
      // same clock we publish a ceiling against.
      chargeRunOverhead(() => {
        // At the very start of an invocation the remaining time IS the limit —
        // the only moment a function can learn its own ceiling.
        if (typeof context?.getRemainingTimeInMillis === "function") {
          limitAtStart = context.getRemainingTimeInMillis();
        }
        // The live countdown is also the only thing that makes a kill visible
        // before it happens. Armed here, at the start, because by the time the
        // handler returns there is nothing left to warn anybody about.
        armRunDeathWatch(limitAtStart, run);
      }, run.kit);
    } catch {
      /* arming must never break the customer's handler */
    }
    try {
      return await handler(...args);
    } catch (err) {
      // A failed run costs exactly what a successful one costs. Counted, then
      // re-thrown completely untouched.
      failed = true;
      throw err;
    } finally {
      try {
        chargeRunOverhead(
          () => noteInvocationContext(context, limitAtStart),
          run?.kit,
        );
      } catch {
        /* never disturb the handler's result or its throw */
      }
      // AWAITED on purpose. Without a platform mechanism for working after the
      // response, this await is the only thing keeping the invocation alive
      // long enough to send. With one, it resolves immediately and the visitor
      // waits for nothing.
      await finishInvocation(failed, run);
    }
  };
}

/** Test seam. */
export function _resetLifecycleForTests(): void {
  inFlight = null;
  // A flush that never settles holds the "one at a time" guard for a real
  // minute — which is the point of it, and which would otherwise leak from one
  // test into the next.
  reallyRunning = null;
  reallyRunningSinceMs = 0;
  watchingRuns = 0;
  lastRun = null;
  lastFrozenFlushAtMs = 0;
  flushImpl = null;
  pendingImpl = null;
  setDeathReporter(null);
}
