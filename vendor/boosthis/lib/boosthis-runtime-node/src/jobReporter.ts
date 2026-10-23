/**
 * Scheduled jobs — what the app tells Boosthis about its own background work.
 *
 * WHY THIS EXISTS. Everything else the kit measures happens while somebody is
 * waiting: a request, a screen, a call out to another service. The work that
 * runs when nobody is looking — a nightly billing run, a queue drain, a
 * reindex — was invisible. An app had no way to say "that ran", so Boosthis had
 * no way to notice that it stopped. A scheduled job that quietly dies is one of
 * the commonest ways a working app stops doing its job.
 *
 * WHAT IS REPORTED, AND NOTHING ELSE. Four facts per run: the job's own name,
 * how long ago it finished, how long it took, and whether it succeeded. There
 * is no field for arguments, payload, input, output or error detail — not here,
 * not on the wire, and nowhere on the server to put them. A job's contents are
 * the customer's business.
 *
 * TIME IS RELATIVE ON PURPOSE. A run reports `finishedAgoMs`, an age, never a
 * wall-clock time. A machine whose clock is a month out can therefore never
 * file a run under the wrong day or make a stale job look fresh.
 *
 * THE KIT IS A GUEST. `reportJobRun` and `trackJob` never throw, never wait on
 * the network, and never change what the host's own code does. `trackJob`
 * re-raises the host's error untouched after recording the failure: the app's
 * error handling is the app's, and a reporting failure must never surface as an
 * application failure. Nothing here can crash, slow or alter the host.
 */

import { jobNameHasPII } from "./no-pii";
import { uploadsReady } from "./uploadRecovery";
import { isBoosthisDisabled } from "./runtimeFlags";
import { getEntitlementGateKind, isKitLocked } from "./killSwitch";
import { uploadPausedUntil } from "./uploadPause";
import {
  clearPromiseDeclarations,
  hasPendingPromiseDeclarations,
  notePromiseDeclarationOutcomes,
  restorePromiseDeclarations,
  takePromiseDeclarationsForSend,
  type PromiseDeclarationOutcome,
  type PromiseDeclarationReport,
} from "./promiseDeclaration";

/** One finished run, exactly as it goes on the wire. */
export interface JobRunReport {
  job: string;
  /** How long BEFORE the upload the run finished. */
  finishedAgoMs: number;
  durationMs: number;
  ok: boolean;
  /** How long the run waited after it became ready to run. Absent — never 0 —
   *  when the queue did not say when it became ready, or the run started
   *  before the process settled. */
  waitMs?: number;
}

/**
 * Many finished runs of one job on one day, counted here and sent as one line.
 *
 * A worker finishing several jobs a second used to lose about four runs in
 * five: one record per run, at most 50 an upload, two uploads a minute and
 * 200 held, the oldest dropped. A line carries exactly what the server's
 * day-memory keeps — how many, how many succeeded, mean and worst duration,
 * when the last finished and whether it succeeded — so the count is complete
 * at any rate and the upload stays one small body every 30 seconds.
 */
export interface JobRunTallyReport {
  job: string;
  runs: number;
  okRuns: number;
  meanMs: number;
  worstMs: number;
  /** How long BEFORE the upload the line's last run finished. */
  lastFinishedAgoMs: number;
  lastOk: boolean;
  /** How many of the line's runs carried a wait, and their mean and worst.
   *  All three absent when none did — a line that knows no wait says so by
   *  saying nothing. */
  waitRuns?: number;
  waitMeanMs?: number;
  waitWorstMs?: number;
}

/** A count line as it is held: absolute times, a running total. One per job
 *  per UTC day (this machine's clock), so a line never spans midnight. */
interface HeldTally {
  job: string;
  day: string;
  runs: number;
  okRuns: number;
  totalMs: number;
  worstMs: number;
  lastFinishedAtMs: number;
  lastOk: boolean;
  /** Runs that carried a wait — never capped, so the mean stays the mean. */
  waitRuns: number;
  waitTotalMs: number;
  waitWorstMs: number;
}

/** What a caller hands in. Time is captured here as an absolute instant and
 *  turned into an age only at flush, so a run that waits in the buffer does not
 *  drift younger. */
interface BufferedRun {
  job: string;
  finishedAtMs: number;
  durationMs: number;
  ok: boolean;
  waitMs?: number;
}

/** Server accepts at most 50 runs per batch. */
export const MAX_JOB_RUN_BATCH = 50;
/** Most runs held ONE BY ONE between uploads. Beyond it the oldest run is
 *  folded into its job's count line ({@link JobRunTallyReport}) — never
 *  dropped — so an app firing jobs faster than the flush cadence keeps every
 *  run's count and timing in bounded memory. */
export const MAX_BUFFERED_JOB_RUNS = 200;
/** Most count lines one upload carries — the server's own bound, the 100
 *  distinct jobs one day can hold. The rest wait for the next upload. */
export const MAX_JOB_RUN_TALLIES = 100;
/** Most (job, day) count lines held while uploads keep failing. Only a long
 *  outage across many jobs and days reaches it; the line whose last run is
 *  oldest then gives way, and its runs are counted as lost. */
export const MAX_HELD_JOB_TALLIES = 500;
/** Most runs one count line may carry — the server's own bound. */
export const MAX_TALLY_RUNS = 100_000_000;
/** `job` name cap — the server's own bound. */
export const MAX_JOB_NAME = 80;
/** Auto-flush cadence. Slower than spans: a background job is not urgent, and
 *  the point is to notice one MISSING over hours, not to be live. */
export const JOB_FLUSH_MS = 30_000;
/** Duration + age hard clamps (match the server's 0..604800000 bounds). */
export const MAX_JOB_MS = 604_800_000;

// ── The rhythm the app's own code declares ──────────────────────────────────
//
// `expectEvery("reindex", 30_000)` used to write the number into a map in this
// process and stop there. The server — which stores declared rhythms and judges
// lateness against them — never heard it, so it answered "nobody declared one"
// about a job the developer had explicitly declared, while this kit counted
// missed runs against the very declaration it had kept to itself. Two answers,
// one job.
//
// So a declaration now rides the runs' own upload: same credential, same
// ladder, same round trip. The rules that keep it honest:
//   • it is a PROMISE, so it is chased until it is answered, and until it is
//     answered nothing here pretends it took effect;
//   • the server's answer is the only thing that makes it real — the kit's
//     local judging reads the accepted value back, never what it asked for;
//   • an undeliverable declaration SAYS SO on stderr, once, ungated. Silence
//     is what let this hide.

/** One rhythm the app's code declared, exactly as it goes on the wire. */
export interface JobExpectationReport {
  job: string;
  everyMs: number;
}

/** What the server said about one declaration. */
export interface JobExpectationOutcome {
  job: string;
  stored: boolean;
  /** The rhythm now IN FORCE, in minutes. Only when `stored`. Not always what
   *  was asked: minutes are the stored unit, and an owner's setting on the
   *  project page outranks the code. */
  everyMinutes?: number;
  graceMinutes?: number;
  reason?: string;
}

/** What an upload answered. A submitter that returns a bare number is a
 *  submitter that only ships runs — still supported, and it means "nothing is
 *  known about the declarations", never "they were accepted". */
export interface JobSubmitOutcome {
  accepted: number;
  expectations?: JobExpectationOutcome[];
  promises?: PromiseDeclarationOutcome[];
  /** Present only when the batch did NOT reach Boosthis. `retry` — a pause,
   *  a server error or no answer — keeps every run it carried for the next
   *  upload; `refused` — the body itself was turned away, and would be again
   *  — lets them go. */
  undelivered?: "retry" | "refused";
}

export type JobRunSubmitter = (
  runs: JobRunReport[],
  expectations: JobExpectationReport[],
  promises: PromiseDeclarationReport[],
  tallies: JobRunTallyReport[],
) => Promise<number | JobSubmitOutcome>;

/** The same 20 the server accepts per upload, and the same ceiling the job
 *  tally itself keeps. */
export const MAX_JOB_EXPECTATIONS = 20;

/**
 * The shortest and longest rhythm Boosthis can STORE, in this kit's own unit.
 *
 * `expectEvery()` takes milliseconds; the server keeps a declared rhythm in
 * whole MINUTES, from one minute to 45 days (`MIN_EVERY_MINUTES` and
 * `MAX_EVERY_MINUTES` in the api-server's `jobRunLimits.ts`, held equal to
 * these two by `job-rhythm-declaration-parity.test.ts`). The two units are why
 * these constants exist here at all: a developer who states thirty seconds is
 * watched at one minute, and the one honest place to say so is the call that
 * stated it — the answer that carries the real number back arrives a flush
 * later, into a handler, where nobody is looking.
 *
 * Nothing here narrows what may be SENT. A rhythm outside the range still
 * travels and still comes back as a named refusal, because the runs in the
 * same upload must not be lost to one bad argument.
 */
export const MIN_STORABLE_EVERY_MS = 60_000;
export const MAX_STORABLE_EVERY_MS = 45 * 24 * 60 * 60_000;

/** Rhythms declared but not yet acknowledged, newest value per job. */
let pendingExpectations = new Map<string, number>();
/** Jobs whose declaration has been sent and not yet answered. Kept apart so a
 *  send that fails puts them back rather than losing them. */
let inFlightExpectations = new Map<string, number>();
/** Jobs the server has told us about, so a re-declaration of the same value is
 *  not re-sent on every flush — with WHEN it last answered, because an answer
 *  goes stale. */
const acknowledgedExpectations = new Map<
  string,
  { everyMs: number; at: number }
>();
/** Acknowledged declarations being re-stated on the current send, and what
 *  their acknowledgement was, so a failed round puts the acknowledgement back
 *  rather than reporting a watched job as unwatched. */
let revalidatingExpectations = new Map<
  string,
  { everyMs: number; at: number }
>();
/**
 * How long an answer about a declaration is trusted before the kit asks again.
 *
 * The declaration is not the only thing that can change: the OWNER can correct
 * the rhythm, lengthen the grace, or switch the watch off entirely from the
 * dashboard, and a kit that asked once at boot would judge against the answer
 * it got months ago while the server judges against the owner's. That is this
 * task's own fault, moved later in time. Re-stating an unchanged value writes
 * nothing server-side — it costs one small array on one upload every five
 * minutes, and it is the only thing that carries an owner's change back to a
 * process that is already running.
 */
export const EXPECTATION_REVALIDATE_MS = 5 * 60_000;
let onExpectationOutcome: ((outcome: JobExpectationOutcome) => void) | null =
  null;
/** How many flushes in a row have failed to get a declaration acknowledged. */
let undeliveredRounds = 0;
/**
 * How many failed rounds before the kit says the declaration is not getting
 * through. Two flushes — one minute — so a single dropped connection on a
 * healthy app is not turned into an accusation, while a real outage is named
 * long before the developer would think to look.
 */
export const UNDELIVERED_ROUNDS_BEFORE_WARNING = 2;

let submitter: JobRunSubmitter | null = null;
let buffer: BufferedRun[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let active = false;
let inFlight = false;
/** Runs taken out of the buffer for a send that has not answered yet. They are
 *  no longer buffered and not yet delivered, so anything counting "what has not
 *  reached Boosthis" has to see them — otherwise a function host whose flush
 *  ran out of budget reports nothing stranded while a run is stranded. */
let inFlightRuns = 0;
/** Count lines, keyed `day\u0000job`. Insertion order is send order. */
let tallies = new Map<string, HeldTally>();
/** Runs that could not be kept: a count line evicted after a long outage, or
 *  the part of one line past {@link MAX_TALLY_RUNS}. */
let lostJobRuns = 0;
/** Bumped by `forget()` and reset. A send that answers after either must not
 *  put its runs back into a buffer that was meant to be empty. */
let generation = 0;

function utcDay(ms: number): string {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "0000-00-00" : d.toISOString().slice(0, 10);
}

function runAsTally(r: BufferedRun): HeldTally {
  return {
    job: r.job,
    day: utcDay(r.finishedAtMs),
    runs: 1,
    okRuns: r.ok ? 1 : 0,
    totalMs: r.durationMs,
    worstMs: r.durationMs,
    lastFinishedAtMs: r.finishedAtMs,
    lastOk: r.ok,
    waitRuns: r.waitMs !== undefined ? 1 : 0,
    waitTotalMs: r.waitMs ?? 0,
    waitWorstMs: r.waitMs ?? 0,
  };
}

/** Add runs to their job's line for the day, making room if it must. */
function addToTally(add: HeldTally): void {
  const key = `${add.day}\u0000${add.job}`;
  const prior = tallies.get(key);
  if (prior) {
    const runs = prior.runs + add.runs;
    const kept = Math.min(MAX_TALLY_RUNS, runs);
    lostJobRuns += runs - kept;
    prior.runs = kept;
    prior.okRuns = Math.min(kept, prior.okRuns + add.okRuns);
    prior.totalMs += add.totalMs;
    if (add.worstMs > prior.worstMs) prior.worstMs = add.worstMs;
    prior.waitRuns += add.waitRuns;
    prior.waitTotalMs += add.waitTotalMs;
    if (add.waitWorstMs > prior.waitWorstMs) prior.waitWorstMs = add.waitWorstMs;
    if (add.lastFinishedAtMs >= prior.lastFinishedAtMs) {
      prior.lastFinishedAtMs = add.lastFinishedAtMs;
      prior.lastOk = add.lastOk;
    }
    return;
  }
  if (tallies.size >= MAX_HELD_JOB_TALLIES) {
    let oldestKey: string | undefined;
    let oldestAt = Infinity;
    for (const [k, t] of tallies) {
      if (t.lastFinishedAtMs < oldestAt) {
        oldestAt = t.lastFinishedAtMs;
        oldestKey = k;
      }
    }
    if (oldestKey !== undefined) {
      lostJobRuns += tallies.get(oldestKey)!.runs;
      tallies.delete(oldestKey);
    }
  }
  tallies.set(key, { ...add });
}

function heldTallyRuns(): number {
  let n = 0;
  for (const t of tallies.values()) n += t.runs;
  return n;
}

/** Wire (or clear) the transport that ships buffered runs. Clearing it makes
 *  `reportJobRun` inert immediately. */
export function setJobRunSubmitter(fn: JobRunSubmitter | null): void {
  submitter = fn;
}

/** Drop the in-memory run buffer (called by `forget()`). */
export function clearBufferedJobRuns(): void {
  buffer = [];
  tallies = new Map();
  generation += 1;
  clearJobNameRefusals();
}

/**
 * Queue a rhythm the app's own code declared, to be delivered with the runs.
 *
 * Buffered UNCONDITIONALLY — even with no transport wired yet. `expectEvery()`
 * is normally called while modules load, which is routinely before the kit has
 * finished starting; dropping it there would recreate the exact fault this
 * exists to fix, in a narrower window.
 *
 * Re-declaring the same value is free: it collapses onto the pending entry, and
 * once the server has acknowledged a value the kit stops re-sending it. The
 * cap is the server's own — a 21st distinct job is refused here, and said out
 * loud, rather than silently taking a slot from another job.
 */
export function declareJobRhythm(job: string, everyMs: number): void {
  try {
    const name = jobName(String(job).trim());
    if (!name) return;
    const ms = Math.round(everyMs);
    if (!Number.isFinite(ms) || ms <= 0) return;
    if (acknowledgedExpectations.get(name)?.everyMs === ms) return;
    if (
      !pendingExpectations.has(name) &&
      !inFlightExpectations.has(name) &&
      distinctExpectationCount() >= MAX_JOB_EXPECTATIONS
    ) {
      warnExpectationOnce(
        "too_many",
        `[boosthis] This app declared a rhythm for more than ${MAX_JOB_EXPECTATIONS} jobs; "${name}" is not being watched. ` +
          `Boosthis watches at most ${MAX_JOB_EXPECTATIONS} named jobs per app — declare the ones that matter, or the names may be built from a value rather than written in code.`,
      );
      return;
    }
    pendingExpectations.set(name, ms);
  } catch {
    // A guest never fails its host.
  }
}

/** Acknowledged declarations whose answer is old enough to ask about again. */
function dueRevalidations(
  now: number,
): Array<[string, { everyMs: number; at: number }]> {
  const due: Array<[string, { everyMs: number; at: number }]> = [];
  for (const [job, ack] of acknowledgedExpectations) {
    if (now - ack.at >= EXPECTATION_REVALIDATE_MS) due.push([job, ack]);
  }
  return due;
}

function distinctExpectationCount(): number {
  const names = new Set<string>([
    ...pendingExpectations.keys(),
    ...inFlightExpectations.keys(),
    ...acknowledgedExpectations.keys(),
  ]);
  return names.size;
}

/**
 * Be told what the server did with a declaration.
 *
 * The tally that counts missed runs registers here and reads the ACCEPTED
 * rhythm back, so its local count and the server's verdict are computed from
 * one number. Without this the two sides can disagree about the same job while
 * both are working exactly as designed.
 */
export function setJobExpectationHandler(
  fn: ((outcome: JobExpectationOutcome) => void) | null,
): void {
  onExpectationOutcome = fn;
}

/** Forget every declared rhythm (called by `forget()` and the test reset). */
export function clearJobRhythmDeclarations(): void {
  pendingExpectations = new Map();
  inFlightExpectations = new Map();
  revalidatingExpectations = new Map();
  acknowledgedExpectations.clear();
}

/** How many declared rhythms have NOT been acknowledged by the server. A
 *  declaration in this count is a job that is NOT being watched yet — kept
 *  apart from the stranded-RUN count, which is a different unit and a
 *  different question. */
export function pendingJobExpectationCount(): number {
  return pendingExpectations.size + inFlightExpectations.size;
}

// ── Saying so, out loud, once ───────────────────────────────────────────────
//
// Same contract as dropReport.ts: one ungated `console.warn` per cause per
// process, naming the cause AND what the developer changes. A declaration that
// silently does nothing is the fault; a silent FAILURE to deliver one would be
// the same fault wearing a different hat.

const warnedExpectationCauses = new Set<string>();

function warnExpectationOnce(cause: string, message: string): void {
  if (warnedExpectationCauses.has(cause)) return;
  warnedExpectationCauses.add(cause);
  try {
    console.warn(message);
  } catch {
    // A broken console must never take the host down.
  }
}

/**
 * Say, once per cause per process, that a declaration did not do what the
 * caller asked — for the causes the SERVER never hears about, because the kit
 * itself stopped the declaration before it could travel.
 *
 * The refusals above cover a declaration Boosthis considered and turned down.
 * This covers the other half: a kit that is switched off, a name the label
 * guard would not take, an interval that is not a number, a job past the name
 * cap, and the one case where the number silently CHANGES on the way — a
 * rhythm finer than the minute the server stores. Each was a silent return,
 * which is the same fault this whole path exists to remove, one step earlier.
 *
 * Shares the one-line-per-cause ledger with the refusals, so an app that
 * states the same bad rhythm in a loop prints one line. Never throws:
 * `expectEvery()` runs in the host's own module scope.
 */
export function sayDeclarationOnce(cause: string, message: string): void {
  warnExpectationOnce(`declared:${cause}`, message);
}

/**
 * Say, once per cause per process, that a job's NAME was refused — so the
 * runs of that job are not being measured at all.
 *
 * This is the other silent drop, and the worse one. A declaration at least
 * had a developer typing `expectEvery` and looking for an effect; a refused
 * RUN name was dropped here, before upload, inside a function that swallows
 * transport errors by design. The job was then not late, not
 * never-reported, and not on the page — it simply never existed, and nothing
 * anywhere said so.
 *
 * Shares the one-line-per-cause ledger with the declaration lines, so a job
 * marked in a loop prints one line however many runs it reports.
 */
export function sayJobNameRefusedOnce(cause: string, message: string): void {
  warnExpectationOnce(`jobName:${cause}`, message);
}

/** How many runs this process refused to report because of their NAME, and
 *  how many distinct names those were. A count the kit can be asked for, so
 *  "what does this screen actually block?" has an answer that is not a guess.
 *  Both halves: a bare count of runs would hide one name refused a thousand
 *  times behind a thousand jobs refused once. */
let jobNameRefusedRuns = 0;
const jobNameRefusedNames = new Set<number>();
/** Bounded for the same reason every other name set here is: a name built
 *  from a value is exactly the input that would grow this without limit. */
const MAX_REFUSED_NAMES_TRACKED = 50;

/** A refused name reduced to a number, for counting distinct ones and nothing
 *  else. The set exists only to answer "how many different names", and the
 *  strings it would otherwise hold are by definition the ones a VALUE rule
 *  matched — an email address, a token, an id. Keeping them in process memory
 *  for the life of the process is a copy of that value nobody asked for, and
 *  one later `console.log` away from being a disclosure. A hash counts just as
 *  well and cannot be read back. */
function refusedNameFingerprint(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i += 1) h = (h * 33) ^ name.charCodeAt(i);
  return h >>> 0;
}

/** Record one run refused for its name. Stores a fingerprint, never the name:
 *  see {@link refusedNameFingerprint}. */
export function noteJobNameRefused(name: string, runs = 1): void {
  jobNameRefusedRuns += runs;
  if (jobNameRefusedNames.size < MAX_REFUSED_NAMES_TRACKED)
    jobNameRefusedNames.add(refusedNameFingerprint(name));
}

/** What this process has refused by name. Callable by the host app and by the
 *  kit's own tests; never a wire field of its own, and — today — read by no
 *  surface the kit draws. The channel a developer actually meets a refusal on
 *  is the one line on stderr {@link jobName} prints, once per cause per
 *  process; this is the exact count behind it. */
export function jobNameRefusals(): { runs: number; names: number } {
  return { runs: jobNameRefusedRuns, names: jobNameRefusedNames.size };
}

/** Wipe the refusal tally. Wired into the same reset the buffers use. */
export function clearJobNameRefusals(): void {
  jobNameRefusedRuns = 0;
  jobNameRefusedNames.clear();
}

/**
 * Say, once, that a rhythm is outside the range Boosthis can store — the ONE
 * cause both halves can see.
 *
 * The kit knows it at the call, from its own copy of the bounds; the server
 * names it `rhythm` in the reply a flush later. Written as one cause with one
 * ledger key rather than two, because a developer who reads the same sentence
 * twice learns nothing the second time and starts wondering whether two
 * different things went wrong. Whichever half gets there first is the line
 * they read.
 */
export function sayRhythmRefusedOnce(message: string): void {
  warnExpectationOnce("refused:rhythm", message);
}

/**
 * Why an upload could not leave, when the reason is this kit's OWN gate rather
 * than the network. `null` when nothing local is stopping it — only then is
 * "check this app can reach Boosthis" honest advice.
 *
 * A locked, unpaid, revoked or never-activated project drops every upload
 * inside the transmit gate without a request ever being made, so the plain
 * undelivered wording sends the developer to inspect a network that is working
 * perfectly. The kinds are killSwitch's own closed set, plus `asked-to-wait`
 * (a 429: Boosthis answered, so the network is fine); the env kill-switch
 * cannot appear here because `tick()` returns before any of this when it is on.
 */
function uploadGateReason(): { kind: string; sentence: string } | null {
  if (uploadPausedUntil("job-runs") !== null) {
    return {
      kind: "asked-to-wait",
      sentence:
        "Boosthis asked this app to wait before uploading again (its upload allowance for the moment is used up), so there is nothing to fix; the declaration is kept and re-sent when the wait is over.",
    };
  }
  switch (getEntitlementGateKind()) {
    case "unregistered":
      return {
        kind: "unregistered",
        sentence:
          "This app has not completed its first check-in with Boosthis, so nothing leaves it yet; the declaration is kept and sent as soon as it registers.",
      };
    case "unpaid":
      return {
        kind: "unpaid",
        sentence:
          "This project's plan is not active, so Boosthis is measuring and watching nothing; the declaration is kept and re-sent the moment the plan is active again.",
      };
    case "revoked":
      return {
        kind: "revoked",
        sentence:
          "This project's access was revoked, so Boosthis is watching nothing; the declaration is kept in case access is restored.",
      };
    case "paused":
      return {
        kind: "paused",
        sentence:
          "This project is paused, so Boosthis is watching nothing; the declaration is kept and re-sent when it resumes.",
      };
    case "hidden":
      return {
        kind: "hidden",
        sentence:
          "Boosthis is not active in this app right now, so nothing leaves it; the declaration is kept and re-sent if it becomes active.",
      };
    case "dissolved":
      return {
        kind: "dissolved",
        sentence:
          "This project stayed locked past its owner's delay, so Boosthis erased what it kept on this machine and stopped; nothing leaves this app until it restarts and asks again.",
      };
    default:
      return null;
  }
}

/** What the developer is told for each refusal the server can name. */
function refusalMessage(job: string, reason: string): string {
  switch (reason) {
    case "name":
      return (
        `[boosthis] Boosthis will not watch the job "${job}": its name did not pass the privacy guard, so the declared rhythm was not stored. ` +
        `Name jobs in code, the way nightly-billing is written — never from a value.`
      );
    case "rhythm":
      return (
        `[boosthis] Boosthis could not keep the rhythm this app declared for "${job}" — it is outside the storable range (1 minute to 45 days), so the job is NOT being watched. ` +
        `Check the interval passed to expectEvery().`
      );
    case "too_many":
      return (
        `[boosthis] Boosthis is already watching the most jobs it can for this project, so the rhythm declared for "${job}" was not stored and the job is NOT being watched. ` +
        `Stop watching a job on the project's page to free a slot.`
      );
    case "not_watched":
      return (
        `[boosthis] Watching was switched off for the job "${job}" on its project page, so the rhythm this app declares in code is not in force. ` +
        `Only that page can switch it back on — otherwise pressing "stop watching" would be undone at this app's next restart.`
      );
    default:
      return (
        `[boosthis] Boosthis did not store the rhythm this app declared for "${job}", so the job is NOT being watched. ` +
        `Its project page says why.`
      );
  }
}

/**
 * Read the declaration outcomes out of an upload reply body.
 *
 * `undefined` means the reply said NOTHING about declarations — an older
 * server, a body that is not an object, a missing field. That is deliberately
 * different from `[]`, which is a server that answered about none of them:
 * both leave the declarations open, but only one of them is a server that
 * knows what a declaration is.
 */
export function parseExpectationOutcomes(
  body: unknown,
): JobExpectationOutcome[] | undefined {
  try {
    if (!body || typeof body !== "object") return undefined;
    const raw = (body as Record<string, unknown>).expectations;
    if (!Array.isArray(raw)) return undefined;
    const out: JobExpectationOutcome[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      if (typeof rec.job !== "string" || rec.job.length === 0) continue;
      const outcome: JobExpectationOutcome = {
        job: rec.job,
        stored: rec.stored === true,
      };
      if (typeof rec.everyMinutes === "number" && Number.isFinite(rec.everyMinutes)) {
        outcome.everyMinutes = rec.everyMinutes;
      }
      if (typeof rec.graceMinutes === "number" && Number.isFinite(rec.graceMinutes)) {
        outcome.graceMinutes = rec.graceMinutes;
      }
      if (typeof rec.reason === "string") outcome.reason = rec.reason;
      out.push(outcome);
    }
    return out;
  } catch {
    return undefined;
  }
}

/**
 * Record what one upload answered about the declarations it carried.
 *
 * A job the server did not mention is deliberately NOT treated as accepted: it
 * goes back on the pending queue and is asked about again. An older server that
 * knows nothing of declarations answers nothing, so its silence keeps the
 * promise open and eventually says so, rather than being read as a yes.
 */
export function noteJobExpectationOutcomes(
  outcomes: readonly JobExpectationOutcome[],
): void {
  try {
    for (const o of outcomes) {
      if (!o || typeof o.job !== "string") continue;
      const asked = inFlightExpectations.get(o.job);
      if (o.stored === true) {
        if (asked !== undefined)
          acknowledgedExpectations.set(o.job, {
            everyMs: asked,
            at: Date.now(),
          });
        inFlightExpectations.delete(o.job);
        revalidatingExpectations.delete(o.job);
        // Only accept a rhythm back that the server actually stated. Its value
        // is the one in force, which is not always what was asked for.
        if (
          typeof o.everyMinutes === "number" &&
          Number.isFinite(o.everyMinutes) &&
          o.everyMinutes > 0
        ) {
          onExpectationOutcome?.(o);
        }
        continue;
      }
      // Refused, by name and for a stated reason. Not retried: asking again
      // every 30 seconds would neither change the answer nor stop being wrong.
      // It IS asked again at the ordinary revalidation pace, because a refusal
      // can be lifted — an owner who switches a watch back on has no other way
      // to tell a running process.
      if (asked !== undefined)
        acknowledgedExpectations.set(o.job, { everyMs: asked, at: Date.now() });
      inFlightExpectations.delete(o.job);
      revalidatingExpectations.delete(o.job);
      warnExpectationOnce(
        `refused:${typeof o.reason === "string" ? o.reason : "unknown"}`,
        refusalMessage(o.job, typeof o.reason === "string" ? o.reason : ""),
      );
      onExpectationOutcome?.(o);
    }
  } catch {
    // Reading an answer must never break an upload.
  }
}

/**
 * Take a job name at the server's bound, or refuse it.
 *
 * REFUSED, never shortened. This used to truncate, on the reading that a name
 * is a fixed label so cutting it still names the same job. Two things are
 * wrong with that. Two different jobs whose names agree for their first
 * {@link MAX_JOB_NAME} characters are filed as one, silently. And — the worse
 * one — the VALUE screen runs AFTER this, so it would be reading a string the
 * value had already been cut out of: a name carrying a token past the bound
 * passed the screen and travelled. A screen can only answer for the string it
 * was shown, so the whole name has to be short enough to keep.
 *
 * Returns `""` for a name that cannot be used, which every caller already
 * treats as nothing to report, and the refusal is counted and said once so it
 * is never the silent drop this replaced.
 */
export function jobName(name: string): string {
  if (name.length <= MAX_JOB_NAME) return name;
  noteJobNameRefused(name);
  sayJobNameRefusedOnce(
    "length",
    `[boosthis] Boosthis is not measuring a background job whose name is ${name.length} characters: a job name must be ${MAX_JOB_NAME} or fewer. ` +
      `It is refused rather than shortened, because two names cut to the same ${MAX_JOB_NAME} characters would be filed as one job, and a shortened name would be screened with its tail already gone. ` +
      `The name is not printed here — an over-long name is the likeliest of all to have been built out of a value, and your logs are somewhere that value would travel to.`,
  );
  return "";
}

function clampMs(v: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(MAX_JOB_MS, Math.round(v)));
}

/**
 * Record that a named background job finished a run.
 *
 * Best-effort and synchronous: it buffers and returns. Nothing is awaited, no
 * network call is made on the caller's thread, and every failure path is
 * swallowed — reporting a run must never be a reason the job itself fails.
 *
 * `finishedAt` defaults to now; pass it when reporting a run that finished
 * earlier (a job whose own bookkeeping is written after the fact).
 */
export function reportJobRun(run: {
  job: string;
  durationMs: number;
  ok: boolean;
  finishedAt?: number | Date;
  /** How long the run waited after it became ready, when that is known. */
  waitMs?: number;
}): void {
  try {
    if (!submitter || isBoosthisDisabled() || isKitLocked()) return;
    const name = typeof run?.job === "string" ? jobName(run.job.trim()) : "";
    if (!name) return;
    const finishedAt =
      run.finishedAt instanceof Date
        ? run.finishedAt.getTime()
        : typeof run.finishedAt === "number" && Number.isFinite(run.finishedAt)
          ? run.finishedAt
          : Date.now();
    const waited =
      typeof run.waitMs === "number" && Number.isFinite(run.waitMs) && run.waitMs >= 0
        ? clampMs(run.waitMs)
        : undefined;
    buffer.push({
      job: name,
      finishedAtMs: finishedAt,
      durationMs: clampMs(run.durationMs),
      ok: run.ok === true,
      ...(waited !== undefined ? { waitMs: waited } : {}),
    });
    // Past the cap the OLDEST run is folded into its job's count line rather
    // than dropped: its count and timing still arrive, only not one by one.
    while (buffer.length > MAX_BUFFERED_JOB_RUNS) addToTally(runAsTally(buffer.shift()!));
  } catch {
    // A guest never fails its host.
  }
}

/* THERE IS ONE `trackJob`, AND IT IS `jobWork`'s.
 *
 * A second one lived here: same name, same shape, its own reporting path, and
 * a different length rule on the way in (this module's 80 against jobWork's
 * 60). Only one of them was ever exported, so which rule applied to a name
 * depended on which module it happened to reach — and the exported constant
 * beside it documented the rule of the one that was NOT public. Deleting it
 * removes the question rather than answering it: `jobWork.trackJob` is the
 * measured form, it reports through `reportJobRun` above, and both doors now
 * bound a name by the same {@link MAX_JOB_NAME}.
 * See docs/decisions/job-name-length.md.
 */

/** Flush up to one batch. Guarded against re-entrancy + the kill-switch;
 *  swallows any transport error (returns 0).
 *
 *  A pending DECLARATION is reason enough to send on its own. A job that has
 *  been declared and has not run yet is precisely the job most worth watching,
 *  and waiting for a run before delivering its rhythm would keep the promise
 *  unkept for exactly as long as the job stays broken. */
async function tick(ending = false): Promise<number> {
  if (
    !submitter ||
    isBoosthisDisabled() ||
    inFlight ||
    (buffer.length === 0 &&
      tallies.size === 0 &&
      pendingExpectations.size === 0 &&
      // A promise declared by an app that reports no job runs at all must
      // still travel: this upload is the only door it has.
      !hasPendingPromiseDeclarations() &&
      dueRevalidations(Date.now()).length === 0)
  ) {
    return 0;
  }
  // A wait Boosthis asked for (uploadPause.ts): nothing is taken, so nothing
  // is put back or re-counted, and the first loop after the wait sends it all.
  if (uploadPausedUntil("job-runs") !== null) return 0;
  if (!uploadsReady(ending)) return 0;
  inFlight = true;
  const taken = buffer.splice(0, MAX_JOB_RUN_BATCH);
  const myGeneration = generation;
  // Count lines ride along when the transport can carry them — a fourth
  // argument. One that cannot leaves them held rather than spending them.
  const takenTallies: HeldTally[] = [];
  if (submitter.length >= 4) {
    // Every run still held one by one past this batch rides THIS upload too,
    // as its job's count — a busy worker's backlog never waits a round.
    for (const r of buffer) addToTally(runAsTally(r));
    buffer = [];
    for (const [key, t] of tallies) {
      if (takenTallies.length >= MAX_JOB_RUN_TALLIES) break;
      takenTallies.push(t);
      tallies.delete(key);
    }
  }
  inFlightRuns = taken.length + takenTallies.reduce((n, t) => n + t.runs, 0);
  const now = Date.now();
  // Taken out of pending for the duration of the send. A failure puts them
  // back: a declaration is a promise, and a dropped connection must not be
  // able to close it.
  const sending = pendingExpectations;
  pendingExpectations = new Map();
  for (const [job, ms] of sending) inFlightExpectations.set(job, ms);
  // Then the ones whose answer has gone stale, newest question first. They ride
  // the same array and the same answer handling; the only difference is that a
  // round that fails restores the acknowledgement rather than calling a watched
  // job unwatched.
  for (const [job, ack] of dueRevalidations(now)) {
    if (inFlightExpectations.size >= MAX_JOB_EXPECTATIONS) break;
    if (inFlightExpectations.has(job)) continue;
    inFlightExpectations.set(job, ack.everyMs);
    revalidatingExpectations.set(job, ack);
    acknowledgedExpectations.delete(job);
  }
  // Did this batch REACH Boosthis? Not "did the submitter return" — a refused
  // upload returns too, and reading that as delivery is how a kit ends up
  // blaming an out-of-date server for a batch the server never saw.
  let delivered = false;
  /** Set when the send did not arrive for a reason that can pass — a pause, a
   *  server error, no answer at all. The runs it carried are then kept. */
  let putBack = false;
  const sentRuns: BufferedRun[] = [];
  const sentTallies: HeldTally[] = [];
  /** How many code-declared promises this send carried, read in the `finally`
   *  where the in-flight ones are put back. */
  let promisesSent = 0;
  try {
    // Drop any run whose NAME carries a VALUE — the job-name guard, not the
    // route-label one: a job name is written by hand beside a schedule, so a
    // space in one means it is a name, while an email, a token or a long
    // identifier in one means it was built out of a value
    // ("sync-user-4482113"), and that must not travel.
    //
    // Counted and SAID, once. A run dropped here is a job that does not
    // exist on any surface — not late, not never-reported, not listed — and
    // for a long time nothing anywhere said why.
    const refuseNameAtFlush = (job: string, runs: number): boolean => {
      const refused = jobNameHasPII(job);
      if (refused === null) return false;
      noteJobNameRefused(job, runs);
      sayJobNameRefusedOnce(
        refused,
        `[boosthis] Boosthis is not measuring a background job whose name matched ${refused}: its runs are dropped before upload and the job will not appear at all. ` +
          `The name is deliberately not printed — the rule that fired is a rule about a VALUE, so echoing the name would copy that email address, token or id into your logs to explain that it must not travel. It was ${job.length} characters. ` +
          `Name jobs in code, the way nightly-billing is written — never out of a value such as an id, an email address or a customer reference.`,
      );
      return true;
    };
    const batch: JobRunReport[] = [];
    for (const r of taken) {
      if (refuseNameAtFlush(r.job, 1)) continue;
      sentRuns.push(r);
      batch.push({
        job: r.job,
        finishedAgoMs: clampMs(now - r.finishedAtMs),
        durationMs: r.durationMs,
        ok: r.ok,
        ...(r.waitMs !== undefined ? { waitMs: r.waitMs } : {}),
      });
    }
    const wireTallies: JobRunTallyReport[] = [];
    for (const t of takenTallies) {
      if (refuseNameAtFlush(t.job, t.runs)) continue;
      sentTallies.push(t);
      wireTallies.push({
        job: t.job,
        runs: t.runs,
        okRuns: t.okRuns,
        meanMs: clampMs(t.totalMs / t.runs),
        worstMs: clampMs(t.worstMs),
        lastFinishedAgoMs: clampMs(now - t.lastFinishedAtMs),
        lastOk: t.lastOk,
        ...(t.waitRuns > 0
          ? {
              waitRuns: Math.min(t.runs, t.waitRuns),
              waitMeanMs: clampMs(t.waitTotalMs / t.waitRuns),
              waitWorstMs: clampMs(t.waitWorstMs),
            }
          : {}),
      });
    }
    // The same guard on a declared name, for the same reason.
    const expectations: JobExpectationReport[] = [];
    for (const [job, everyMs] of inFlightExpectations) {
      if (jobNameHasPII(job) !== null) {
        inFlightExpectations.delete(job);
        revalidatingExpectations.delete(job);
        // Closed for good, not merely answered: this name can never be sent, so
        // it must never come round again on the revalidation pace either.
        acknowledgedExpectations.set(job, {
          everyMs,
          at: Number.MAX_SAFE_INTEGER,
        });
        warnExpectationOnce(
          "localName",
          `[boosthis] Boosthis will not watch the job "${job}": its name looks like it was built from a value, so the declared rhythm was not sent. ` +
            `Name jobs in code, the way nightly-billing is written.`,
        );
        continue;
      }
      expectations.push({ job, everyMs });
    }
    // Promises declared in code ride the same upload. Their own module owns
    // the buffering, the cap and the guards; it hands back exactly what goes
    // on the wire.
    //
    // A submitter registered before this kit could carry declarations takes
    // runs alone, and JavaScript would let us hand it three arguments and
    // throw two away without a word. The declaration would then be reported
    // as unanswered — "the Boosthis server is older than this kit" — which is
    // the wrong thing to go and fix. So an older transport is recognised here
    // and named for what it is, and the declaration is not spent on a send
    // that cannot carry it.
    const carriesPromises = submitter.length >= 3;
    const promises = carriesPromises ? takePromiseDeclarationsForSend() : [];
    promisesSent = promises.length;
    if (!carriesPromises && hasPendingPromiseDeclarations()) {
      warnExpectationOnce(
        "noTransportPromises",
        `[boosthis] This app declares a promise in its code, but the installed kit cannot send promises to Boosthis. That promise is NOT saved. ` +
          `Update the Boosthis kit, or write the promise on the project's promises page.`,
      );
    }
    if (
      batch.length === 0 &&
      wireTallies.length === 0 &&
      expectations.length === 0 &&
      promises.length === 0
    )
      return 0;
    const out = await submitter(batch, expectations, promises, wireTallies);
    if (typeof out === "number") {
      // A transport that only ships runs. Its silence about declarations is
      // not consent: they stay open and are asked about again. Accepted rows
      // are the one thing a bare number does prove, so they are the only
      // evidence of delivery it can offer.
      delivered = out > 0;
      return out;
    }
    // A transport that can tell says so when the batch did NOT arrive. Every
    // other object answer is the proof it did: the transport builds one only
    // after an upload the server accepted.
    if (out.undelivered !== undefined) {
      putBack = out.undelivered === "retry";
      return 0;
    }
    delivered = true;
    noteJobExpectationOutcomes(out.expectations ?? []);
    notePromiseDeclarationOutcomes(out.promises ?? []);
    return out.accepted;
  } catch {
    // No answer at all. The runs are kept for the next upload.
    putBack = true;
    return 0;
  } finally {
    inFlight = false;
    inFlightRuns = 0;
    // Kept as counts: a run that waited through a failed send has its count
    // and timing folded into its job's line, so whatever arrived meanwhile and
    // however many sends fail, nothing is sent twice and nothing is lost.
    if (putBack && myGeneration === generation && !isBoosthisDisabled()) {
      for (const r of sentRuns) addToTally(runAsTally(r));
      for (const t of sentTallies) addToTally(t);
    }
    // Anything still in flight was never answered for — a failed send, or a
    // server that said nothing about it. Back on the queue, and once the
    // silence has gone on long enough the kit says so rather than waiting
    // forever in the belief the job is watched.
    if (inFlightExpectations.size > 0) {
      // A re-statement of an ALREADY acknowledged rhythm is put back where it
      // came from, dated now so the next attempt is one interval away. The job
      // is still watched — reporting it as an undelivered promise would be the
      // opposite lie to the one this whole path exists to prevent.
      for (const [job, ack] of revalidatingExpectations) {
        inFlightExpectations.delete(job);
        if (!pendingExpectations.has(job))
          acknowledgedExpectations.set(job, { everyMs: ack.everyMs, at: now });
      }
      revalidatingExpectations = new Map();
    }
    if (inFlightExpectations.size > 0) {
      for (const [job, ms] of inFlightExpectations)
        if (!pendingExpectations.has(job)) pendingExpectations.set(job, ms);
      inFlightExpectations = new Map();
      undeliveredRounds += 1;
      if (delivered && undeliveredRounds === 1) {
        warnExpectationOnce(
          "unanswered",
          `[boosthis] Boosthis accepted this app's job runs but said nothing about the ${pendingExpectations.size === 1 ? "rhythm" : "rhythms"} declared with expectEvery() — ${pendingExpectations.size === 1 ? "that job is" : "those jobs are"} NOT being watched yet. ` +
            `This usually means the Boosthis server is older than this kit; updating it fixes it, and the declaration keeps being re-sent meanwhile.`,
        );
      } else if (!delivered && undeliveredRounds >= UNDELIVERED_ROUNDS_BEFORE_WARNING) {
        const gate = uploadGateReason();
        warnExpectationOnce(
          gate ? `undelivered:${gate.kind}` : "undelivered",
          `[boosthis] Boosthis could not deliver the ${pendingExpectations.size === 1 ? "job rhythm" : "job rhythms"} this app declared with expectEvery(), after ${undeliveredRounds} attempts — ${pendingExpectations.size === 1 ? "that job is" : "those jobs are"} NOT being watched. ` +
            (gate
              ? gate.sentence
              : `Check this app can reach Boosthis; the declaration keeps being re-sent.`),
        );
      }
    } else if (sending.size > 0) {
      undeliveredRounds = 0;
    }
    // The promise half, told the same two stories apart: an upload that
    // arrived and said nothing is an old server, an upload that never arrived
    // is a delivery problem — and this kit's own gate, when it is the thing
    // in the way, is named rather than leaving a developer inspecting a
    // healthy network.
    const gate = uploadGateReason();
    restorePromiseDeclarations({
      delivered,
      sentCount: promisesSent,
      roundsBeforeWarning: UNDELIVERED_ROUNDS_BEFORE_WARNING,
      gateKind: gate?.kind ?? null,
      gateSentence: gate?.sentence ?? null,
    });
  }
}


/** How many reported runs have NOT reached Boosthis: still buffered, plus any
 *  taken for a send that has not answered. Read by the function-host lifecycle,
 *  which has to say what an exhausted flush budget left behind. */
export function pendingJobRunCount(): number {
  return buffer.length + heldTallyRuns() + inFlightRuns;
}

/** Manually flush the buffered runs now (best-effort). */
export function flushJobRunsNow(ending = false): Promise<number> {
  return tick(ending);
}

/** Start the periodic auto-flush loop. Idempotent. The timer is `unref`'d so it
 *  never keeps a Node process alive on its own. */
export function startJobRunAutoFlush(): void {
  if (active) return;
  active = true;
  const loop = (): void => {
    if (!active) return;
    timer = setTimeout(() => {
      void tick().catch(() => {}).finally(() => {
        if (active) loop();
      });
    }, JOB_FLUSH_MS);
    (timer as { unref?: () => void } | null)?.unref?.();
  };
  loop();
}

/** Stop the auto-flush loop. */
export function stopJobRunAutoFlush(): void {
  active = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Test/introspection hooks (mirrors `_spanInternals`). */
export const _jobInternals = {
  hasSubmitter: (): boolean => submitter !== null,
  bufferLen: (): number => buffer.length,
  /** Count lines held, and the runs they carry. */
  tallyLen: (): number => tallies.size,
  heldTallyRuns: (): number => heldTallyRuns(),
  lostRuns: (): number => lostJobRuns,
  isAutoRunning: (): boolean => active,
  flushMs: (): number => JOB_FLUSH_MS,
  pendingExpectations: (): number => pendingJobExpectationCount(),
  reset: (): void => {
    stopJobRunAutoFlush();
    submitter = null;
    buffer = [];
    tallies = new Map();
    lostJobRuns = 0;
    generation += 1;
    inFlight = false;
    inFlightRuns = 0;
    clearJobRhythmDeclarations();
    clearJobNameRefusals();
    clearPromiseDeclarations();
    // The outcome handler is NOT cleared. It is registered once when the job
    // tally module loads, so clearing it here would leave the kit permanently
    // unable to hear the server's answer, in tests only.
    undeliveredRounds = 0;
    warnedExpectationCauses.clear();
  },
};
