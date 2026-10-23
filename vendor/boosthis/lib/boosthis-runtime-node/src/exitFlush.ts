/**
 * Getting the last measurements out before the process goes.
 *
 * THE FAILURE THIS ENDS
 * ------------------
 *
 * A back end that boots, does a little work and exits — a worker, a scheduled
 * script, a container being recycled — used to upload NOTHING at all, however
 * much it measured.
 *
 * Every measured request is queued in `reporting.ts` and drained on a throttled
 * tick whose timer is `unref`'d, exactly so the kit can never hold a host
 * process open. That is the right call and it stays: a meter that keeps
 * somebody's program alive has changed what their program does. But it has a
 * consequence nobody had answered — when the event loop empties, the process
 * leaves and the queue leaves with it. Registration, by contrast, goes out
 * immediately. So the install appears on the dashboard, checks in, and reads
 * "never measured", for ever, with nothing anywhere saying why.
 *
 * The span buffer, the meter page and the job-run queue lose their contents the
 * same way, for the same reason.
 *
 * WHAT CLOSES A PROCESS, AND WHAT WE DO ABOUT EACH
 * ------------------
 *
 * `beforeExit` — the ordinary case: the event loop has emptied and Node is
 * about to leave. Async work started here KEEPS THE PROCESS ALIVE until it
 * settles, which is what makes it the right hook: an HTTP upload can actually
 * finish. It does not fire on an explicit `process.exit()`, on an uncaught
 * exception, or on a signal, and nothing here pretends otherwise.
 *
 * `SIGTERM` — a container being recycled, `docker stop`, a process manager
 * cycling a worker. Node's default disposition kills the process outright and
 * `beforeExit` never fires, which is the exact shape of the installs that
 * started this. So we take the signal — but ONLY when the host has not taken
 * it, and having taken it we **own the whole exit**: flush under a short
 * budget, drop our listener, and re-send the signal so the process dies exactly
 * as it would have, with the same status. A listener that flushes and then
 * simply returns would have turned SIGTERM into a signal this app IGNORES,
 * which is a far worse bug than the one being fixed. A second signal while we
 * are flushing means *go now* and takes the same route immediately.
 *
 * `exit` — the last synchronous moment, reached by every ending above AND by
 * an explicit `process.exit()`. Nothing async can run there, so no queue is
 * flushed from it; it exists only to close the kit's run record, which is one
 * synchronous write. Without it a service that ends itself on purpose looks,
 * to the next launch, exactly like one that was killed.
 *
 * `SIGINT` is deliberately left alone. Node's default for it also terminates,
 * but it is the interactive Ctrl-C of somebody at a terminal who wants their
 * prompt back, and adding up to two seconds to that is a worse trade than the
 * measurements are worth. `process.exit()`, `SIGKILL` and a hard crash cannot
 * be helped from inside the process, and nothing here claims they can.
 *
 * RULES THIS MODULE KEEPS
 * ------------------
 *
 * - **Never change what the host does.** We take a signal only when nobody is
 *   listening for it, and we always re-send it. We add no `ref`'d handle, so a
 *   process that would have exited still exits.
 * - **Bounded.** The whole flush shares one wall-clock budget
 *   ({@link EXIT_FLUSH_BUDGET_MS}). An unreachable server delays a shutdown by
 *   that much and no more.
 * - **Silent.** Nothing here throws — an instrumentation library may not turn a
 *   clean exit into a stack trace.
 * - **Once.** `beforeExit` fires again after the async work it started
 *   settles; without a latch this would be an infinite loop that never lets the
 *   process die.
 */

import { endRun } from "./crashDelivery";
import { flushCrashesNow, pendingCrashOccurrences } from "./crashReporter";
import {
  checkEntitlementNow,
  hasCheckinConfig,
  isActivated,
} from "./killSwitch";
import { flushJobRunsNow, pendingJobRunCount } from "./jobReporter";
import { pendingSampleCount, reportNow } from "./reporting";
import { isBoosthisDisabled } from "./runtimeFlags";
import { noteRowsDiscarded } from "./serverlessMeters";
import { uploadPerfSnapshotNow } from "./snapshot";
import { _spanInternals, flushSpansNow } from "./spanEmitter";

/**
 * How long the whole exit flush may take, across every queue. Deliberately
 * short: this is time added to somebody's shutdown, and a process manager that
 * sends SIGTERM usually follows it with SIGKILL a few seconds later.
 */
export const EXIT_FLUSH_BUDGET_MS = 2_000;

/**
 * How much of that budget the ACTIVATION KNOCK may take.
 *
 * Having an exit hook at all is only half the fix. Until the launch check-in
 * has been ANSWERED, `isRuntimeInert()` is true and every upload path declines
 * to open a socket — so a process short-lived enough to need this module is
 * also short-lived enough to still be locked when it runs. Flushing then sends
 * nothing, which looks exactly like the bug we came here to fix.
 *
 * So the flush knocks first, synchronously, and only then drains. Kept well
 * under the whole budget: an unreachable server must still leave time for the
 * samples themselves, which is the queue a customer can see.
 */
export const EXIT_ACTIVATION_TIMEOUT_MS = 900;

/**
 * How much of the budget the REGISTRATION wait may take.
 *
 * The knock above needs a credential, and a first-run process may not have one
 * yet: registration is a network round-trip started at boot, and a worker that
 * measures and exits can easily beat it. With no token there is nobody to
 * check in as, the activation lock never lifts, and the flush drains into a
 * transport that opens no socket — registered, never measured, which is the
 * exact row this whole module exists to stop appearing.
 *
 * So the exit path settles registration first, then knocks, then drains. Every
 * step comes out of the one budget, and a step that times out simply leaves
 * less for the next: a shutdown is never delayed beyond
 * {@link EXIT_FLUSH_BUDGET_MS} however badly the network behaves.
 */
export const EXIT_REGISTER_TIMEOUT_MS = 800;

/** The signals we take over when nobody else has. See the header for why
 *  SIGINT is not here. */
const OWNED_SIGNALS: readonly NodeJS.Signals[] = ["SIGTERM"];

let armed = false;
let ranOnce = false;
let flushing = false;
const takenSignals = new Set<NodeJS.Signals>();
let lastResult: Record<string, number> = {};
let lastActivationOutcome = "";
let exitReadyHook: ((budgetMs: number) => Promise<void>) | null = null;

/**
 * Register the telemetry client's "make sure we are registered" step.
 *
 * Same shape as the coverage-refresh hook in `reporting.ts`, and for the same
 * reason: this module is a module-level singleton while a telemetry client is
 * a closure, so the client hands in the one thing only it can do. Passing null
 * removes it (`forget()`).
 */
export function setExitReadyHook(
  fn: ((budgetMs: number) => Promise<void>) | null,
): void {
  exitReadyHook = fn;
}

/**
 * Knock once for an answer to the launch check-in, inside `budgetMs`.
 *
 * Returns what happened, for the proof and the tests to read:
 *  - `already`     — already activated; nothing was sent.
 *  - `no-config`   — telemetry is not configured, or nothing has registered
 *                    yet, so there is nobody to ask.
 *  - `no-budget`   — the flush ran out of time before it could ask.
 *  - `unreachable` — asked, no answer arrived in the budget.
 *  - a status word (`active`, `revoked`, `unpaid`, `paused`) — the server
 *    answered, and that answer is now the gate. A "no" is obeyed: the drain
 *    below will decline exactly as it should.
 */
async function activateInline(budgetMs: number): Promise<string> {
  if (isActivated()) return "already";
  if (!hasCheckinConfig()) return "no-config";
  if (budgetMs <= 0) return "no-budget";
  try {
    const status = await checkEntitlementNow(
      Math.min(budgetMs, EXIT_ACTIVATION_TIMEOUT_MS),
    );
    return status ?? "unreachable";
  } catch {
    return "error";
  }
}

/** What the last {@link runExitFlush}'s activation knock resolved to. */
export function lastExitActivationOutcome(): string {
  return lastActivationOutcome;
}

/** Run `work`, but never wait longer than `budgetMs` for it. The work itself is
 *  not cancellable — an in-flight HTTP request will finish or fail on its own —
 *  but the SHUTDOWN stops waiting, which is the promise this module makes. */
async function within<T>(
  budgetMs: number,
  work: () => Promise<T>,
): Promise<T | null> {
  if (budgetMs <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      work(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), budgetMs);
        // Never let the guard timer itself be the reason the process stays up.
        (timer as unknown as { unref?: () => void }).unref?.();
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Ship everything buffered, inside one wall-clock budget. Never throws.
 *
 * Returns what was still waiting AFTER the attempt, per queue — zeros mean the
 * process really did hand everything over, and that is what the live proof
 * reads.
 */
export async function runExitFlush(
  budgetMs: number = EXIT_FLUSH_BUDGET_MS,
): Promise<Record<string, number>> {
  if (isBoosthisDisabled()) return {};
  if (flushing) return {};
  flushing = true;
  const deadline = Date.now() + Math.max(0, budgetMs);
  const left = (): number => Math.max(0, deadline - Date.now());
  try {
    // Settle registration, then the activation knock, and only then drain —
    // both out of this same budget. A process this module exists for may well
    // still be unregistered AND locked, and a locked kit opens no socket, so
    // draining before asking uploads nothing at all.
    if (exitReadyHook) {
      await within(Math.min(left(), EXIT_REGISTER_TIMEOUT_MS), async () => {
        await exitReadyHook!(Math.min(left(), EXIT_REGISTER_TIMEOUT_MS));
        return null;
      });
    }
    lastActivationOutcome = await activateInline(
      Math.min(left(), EXIT_ACTIVATION_TIMEOUT_MS),
    );
    // CRASHES FIRST. Everything else in this list can be measured again on the
    // next run; a crash cannot. The fatal path persists it and then schedules
    // an upload the dying process never completes, so without this call the
    // one crash shape the kit does capture could only ever be delivered by a
    // LATER launch — and every step of that replay is somewhere it can vanish.
    // It is also the smallest payload here, so it costs the queues below
    // almost none of the shared budget.
    await within(left(), () => flushCrashesNow());
    // Samples next. They are the measurements the project page counts, and
    // the only queue whose emptiness is visible to a customer as "never
    // measured", so they get first claim on what is left.
    await within(left(), () => reportNow(true));
    await within(left(), () => flushSpansNow(true));
    // A scheduled job's run is the whole point of the kind of process this
    // module exists for, so it goes before the meter page.
    await within(left(), () => flushJobRunsNow(true));
    // The rolled-up meter page last: it is rebuilt from the same measurements,
    // so a process that got its samples out has already told the truth about
    // itself even if this does not fit in what is left.
    await within(left(), () => uploadPerfSnapshotNow());
  } catch {
    /* an exit flush may never turn a clean shutdown into a stack trace */
  } finally {
    flushing = false;
    try {
      lastResult = {
        samplesLeft: pendingSampleCount(),
        spansLeft: _spanInternals.bufferLen(),
        jobRunsLeft: pendingJobRunCount(),
        crashesLeft: pendingCrashOccurrences(),
      };
    } catch {
      lastResult = {};
    }
  }
  return lastResult;
}

/** What the last {@link runExitFlush} left behind. Test and proof surface. */
export function lastExitFlushResult(): Record<string, number> {
  return { ...lastResult };
}

/** Whether an exit flush is running right now. A step that would add a round
 *  trip the shutdown budget was never sized for (renewing a replaced
 *  credential) stands down while it is: the next run renews instead. */
export function isExitFlushRunning(): boolean {
  return flushing;
}

async function flushOnce(): Promise<void> {
  if (ranOnce) return;
  ranOnce = true;
  const left = await runExitFlush();
  // WHAT IS STILL HERE AT THIS POINT IS GONE. This is the process's last
  // attempt — `ranOnce` guarantees there is no second one — so anything the
  // budget did not get out dies with the process. It was already counted as
  // still-waiting in `lastExitFlushResult`, which is a number for a proof rig
  // to read; the developer was told nothing. Counted here as a real loss with
  // its own cause, so it reaches the same stderr line, status page and panel
  // every other loss does.
  //
  // Only from HERE, never from `runExitFlush` itself: that one is also called
  // by proofs and by tests, where the process carries on afterwards and the
  // rows are simply still waiting.
  try {
    const rows = Object.values(left).reduce(
      (sum, n) => sum + (Number.isFinite(n) && n > 0 ? n : 0),
      0,
    );
    if (rows > 0) noteRowsDiscarded(rows, "processEnded");
  } catch {
    /* counting the loss may never be the thing that hangs a shutdown */
  }
}

function onBeforeExit(): void {
  // `beforeExit` fires again once the async work started here settles, so the
  // latch inside flushOnce is what lets the process actually die.
  void flushOnce();
}

/**
 * Mark this run as having ended in a way we SAW.
 *
 * The kit keeps a record of the run it is in, and a record left open by a
 * process that is gone is how a launch discovers that the previous run was
 * killed with no code of ours running — the one class of death nothing inside
 * a process can report at the time. That inference is only worth anything if
 * every ending we CAN see closes the record, so this runs on the ordinary way
 * out as well as on the signal we take over.
 *
 * `process.on("exit")` is the last synchronous moment there is: it fires after
 * `beforeExit`, after an explicit `process.exit()`, and after Node's own
 * handling of an uncaught exception — none of which `beforeExit` alone covers.
 * Only synchronous work runs there, which is exactly what closing the record
 * is (one locked, synchronous write). Nothing async is attempted, because
 * anything async there is a no-op that looks like a safeguard.
 */
function onExit(): void {
  try {
    endRun("clean");
  } catch {
    /* a shutdown may never become a stack trace */
  }
}

/** Held so a handler can remove ITSELF by identity before re-sending the
 *  signal; a listener we cannot name again could not be taken off. */
const signalHandlers = new Map<NodeJS.Signals, () => void>();

function installSignalFlush(): NodeJS.Signals[] {
  const taken: NodeJS.Signals[] = [];
  for (const signal of OWNED_SIGNALS) {
    if (takenSignals.has(signal)) continue;
    try {
      // The host already listens: theirs almost certainly ends in a clean
      // shutdown (which reaches `beforeExit` anyway), and stacking on top of
      // somebody's shutdown sequence is not ours to do.
      if (process.listenerCount(signal) > 0) continue;
      const handler = (): void => {
        // Whatever listens to a termination signal OWNS the exit. Put the
        // default disposition back and re-send, so the process dies exactly as
        // it would have and with the status it would have had.
        const finish = (): void => {
          try {
            // Seen, and handled: close the run record before we re-send the
            // signal, because the re-send is a default disposition that runs
            // no code of ours at all. A supervisor stopping a service is an
            // ordinary stop, and must never be reported as a disappearance.
            endRun("signal");
            process.removeListener(signal, handler);
            takenSignals.delete(signal);
            signalHandlers.delete(signal);
            process.kill(process.pid, signal);
          } catch {
            /* a process that will not die is worse than a lost measurement */
          }
        };
        // A second signal means go now.
        if (flushing) {
          finish();
          return;
        }
        void flushOnce().then(finish, finish);
      };
      process.on(signal, handler);
      signalHandlers.set(signal, handler);
      takenSignals.add(signal);
      taken.push(signal);
    } catch {
      /* a platform without the signal, or a host that refuses the change: the
         beforeExit half still stands */
    }
  }
  return taken;
}

/**
 * Arm the exit path. Idempotent; safe to call from anywhere; never throws.
 *
 * Called when telemetry is enabled — i.e. the moment there is something that
 * could be lost.
 */
export function installExitFlush(): void {
  if (isBoosthisDisabled()) return;
  try {
    if (!armed) {
      armed = true;
      process.on("beforeExit", onBeforeExit);
      process.on("exit", onExit);
    }
    installSignalFlush();
  } catch {
    /* arming the way out may never break the way in */
  }
}

/** What is actually armed, for the status page and the live proof. A claim
 *  nobody can check is how this kind of fix rots. */
export function exitFlushArmed(): { beforeExit: boolean; signals: string[] } {
  return { beforeExit: armed, signals: [...takenSignals].sort() };
}

/**
 * LOCKED (docs/kit-lock-rule.md): give the way out back. The two process
 * listeners and every signal this module took over come off; a lock throws
 * away everything that could have been lost, so there is nothing left for them
 * to save. `installExitFlush` puts them back after an active answer. Never
 * throws.
 */
export function uninstallExitFlush(): void {
  try {
    if (armed) {
      process.removeListener("beforeExit", onBeforeExit);
      process.removeListener("exit", onExit);
    }
  } catch {
    /* nothing to undo */
  }
  for (const [signal, handler] of signalHandlers) {
    try {
      process.removeListener(signal, handler);
    } catch {
      /* nothing to undo */
    }
  }
  signalHandlers.clear();
  takenSignals.clear();
  armed = false;
}

/** Test helper — unwire everything and forget the latch. */
export function _resetExitFlushForTests(): void {
  uninstallExitFlush();
  ranOnce = false;
  flushing = false;
  lastResult = {};
  lastActivationOutcome = "";
  exitReadyHook = null;
}
