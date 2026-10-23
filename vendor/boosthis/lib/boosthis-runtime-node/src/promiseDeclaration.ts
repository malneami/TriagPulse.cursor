/**
 * Standing promises the app's own code declares.
 *
 * BOOSTHIS_PROMISE_IN_CODE: declarePromise
 *
 * That line is the marker saying this kit ships the in-code promise call, and
 * the name after the colon is the exact call a developer types. It is read off
 * the kit's own served bytes so every guide can state, from what the kit
 * actually contains rather than from a list somebody keeps by hand, whether
 * this call exists here and what it is called. A kit added later is therefore
 * never silently missing the answer.
 *
 * WHY THIS EXISTS. A promise had exactly two doors: the project page, and a
 * connected AI writing one on the developer's behalf. Neither is beside the
 * code the promise is about, neither can be reviewed in the pull request that
 * changes that code, and neither arrives unless somebody remembers the feature
 * exists. `expectEvery()` already had the third door — a declaration in the
 * app's own source, carried up on the job-runs upload — and a promise is the
 * same kind of statement, so it uses the same door.
 *
 * WHAT IT IS NOT. A way to confirm anything. A promise declared here lands
 * REMEMBERED ONLY and stays that way until a human confirms the interpretation
 * on the project page, exactly like an AI-written one. There is no call here
 * to confirm, watch, unwatch or delete a promise, and there is no wire field
 * that could carry one. That line is the whole reason "watched" means
 * something.
 *
 * WHY THERE IS NO RE-ASKING PACE, UNLIKE A JOB RHYTHM. A declared rhythm is
 * re-stated every few minutes because the kit judges its OWN missed-run count
 * against the number the server accepted, so an owner's correction has to
 * reach a process that is already running. Nothing here is judged locally: a
 * promise is stated, answered once, and that is the end of the exchange. Worse
 * than useless, a re-asking pace would raise a promise the owner had just
 * deleted on the project page, over and over, for as long as the process ran.
 * A statement is re-sent when it CHANGES, and at no other time.
 */

import { transmitLabelHasPII } from "./no-pii";
import { isBoosthisDisabled } from "./runtimeFlags";

/** The four subject kinds the project page offers. No new ones: a kit cannot
 *  invent something for the server to measure. */
export type PromiseSubjectKind = "route" | "issue" | "axis" | "job";

/** The ten measurements the project page offers. No new ones. */
export type PromiseMetric =
  | "p50_ms"
  | "p75_ms"
  | "p95_ms"
  | "occurrences"
  | "rate_per_day"
  | "daily_ceiling"
  | "daily_flag"
  | "job_runs_per_day"
  | "job_failures_per_day"
  | "job_typical_ms";

/**
 * What a developer may say about the measurement behind a promise.
 *
 * ALL THREE OR NONE. Naming a subject without a measurement, or a measurement
 * without a line, describes nothing anyone could judge — the server refuses it
 * as `unmeasurable` and says so. A promise with none of them is a sentence the
 * owner can attach a measurement to later on the project page, which is the
 * ordinary case and needs no options at all.
 */
export interface PromiseDeclarationOptions {
  /** What kind of thing it is about. */
  subjectKind?: PromiseSubjectKind;
  /** That subject's own stable label — the route label, crash signature,
   *  reading name or job name the project already reports it under. */
  subjectLabel?: string;
  /** Which measurement of it. */
  metric?: PromiseMetric;
  /** The line it must not cross. Milliseconds for a load time, a count for a
   *  reported problem, a count a day for a daily reading. */
  threshold?: number;
}

/** One declaration, exactly as it goes on the wire. */
export interface PromiseDeclarationReport {
  wording: string;
  subjectKind?: PromiseSubjectKind;
  subjectLabel?: string;
  metric?: PromiseMetric;
  /** Named `threshold`, never `thresholdValue`: a field name carrying `value`
   *  is refused by the server's PII guard, which refuses the WHOLE upload —
   *  the finished job runs in the same body included. */
  threshold?: number;
}

/** What the server said about one declaration, keyed by the wording sent. */
export interface PromiseDeclarationOutcome {
  wording: string;
  stored: boolean;
  reason?: string;
}

/** The server's cap, and the most promises a project may hold. */
export const MAX_PROMISE_DECLARATIONS = 20;
/** The server's own wording cap. */
export const MAX_PROMISE_WORDING = 240;
/** The server's own subject-label cap. */
export const MAX_PROMISE_SUBJECT_LABEL = 200;

const SUBJECT_KINDS: readonly string[] = ["route", "issue", "axis", "job"];
const METRICS: readonly string[] = [
  "p50_ms",
  "p75_ms",
  "p95_ms",
  "occurrences",
  "rate_per_day",
  "daily_ceiling",
  "daily_flag",
  "job_runs_per_day",
  "job_failures_per_day",
  "job_typical_ms",
];

/** Declared and not yet sent. Keyed on the identity the server matches on, so
 *  restating one sentence collapses rather than filling the buffer. */
let pending = new Map<string, PromiseDeclarationReport>();
/** Sent and not yet answered. Kept apart so a failed send puts them back
 *  rather than losing them. */
let inFlight = new Map<string, PromiseDeclarationReport>();
/** Answered, with the fingerprint of WHAT was answered. A restatement of the
 *  same thing is never re-sent; a changed one is. This is what keeps a restart
 *  quiet within a process, and what makes an edited sentence travel. */
const acknowledged = new Map<string, string>();
/** How many flushes in a row have failed to get a declaration answered. */
let undeliveredRounds = 0;

/**
 * The identity the server matches a re-declaration on.
 *
 * The same normalisation the store uses, so the kit and the server agree about
 * which sentences are one promise without the kit having to be told.
 */
export function promiseIdentity(wording: string): string {
  return wording
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Everything a statement says, as one comparable string, so a declaration
 *  that moves only the LINE still counts as a change. */
function fingerprint(d: PromiseDeclarationReport): string {
  return [
    promiseIdentity(d.wording),
    d.subjectKind ?? "",
    d.subjectLabel ?? "",
    d.metric ?? "",
    d.threshold === undefined ? "" : String(d.threshold),
  ].join("|");
}

// ── Saying so, out loud, once ───────────────────────────────────────────────
//
// Same contract as the declared rhythms: one ungated `console.warn` per cause
// per process, naming the cause AND what the developer changes. A declaration
// API that validates and never reports back is worse than none.

const warnedCauses = new Set<string>();

function warnOnce(cause: string, message: string): void {
  if (warnedCauses.has(cause)) return;
  warnedCauses.add(cause);
  try {
    console.warn(message);
  } catch {
    // A broken console must never take the host down.
  }
}

/** What the developer is told for each refusal the server can name. */
export function promiseRefusalMessage(wording: string, reason: string): string {
  const quoted = `“${wording}”`;
  switch (reason) {
    case "cap":
      return (
        `[boosthis] This project already holds the most promises it can (${MAX_PROMISE_DECLARATIONS}), so the promise ${quoted} declared in this app's code was NOT saved. ` +
        `Delete one on the project's promises page to free a slot.`
      );
    case "screened":
      return (
        `[boosthis] Boosthis will not store the promise ${quoted} declared in this app's code: its wording did not pass the privacy guard, so nothing was saved. ` +
        `Write the promise without an address, a token or anyone's personal details in it.`
      );
    case "unmeasurable":
      return (
        `[boosthis] Boosthis cannot measure the promise ${quoted} as this app's code describes it, so nothing was saved. ` +
        `Give subjectKind, subjectLabel, metric and threshold together or leave all four out — and check the measurement suits the subject (a load time is not something a reported problem has).`
      );
    case "superseded":
      return (
        `[boosthis] The promise ${quoted} was edited or confirmed on this project's promises page, so THAT version is in force and this app's code did not overwrite it. ` +
        `What the code now says is recorded beside it — change it on that page if the code's wording is the one you want.`
      );
    default:
      return (
        `[boosthis] Boosthis did not save the promise ${quoted} declared in this app's code. ` +
        `Its project page says why.`
      );
  }
}

/**
 * Declare a standing promise from the app's own code.
 *
 * Buffered UNCONDITIONALLY — even with no transport wired yet. This is
 * normally called while modules load, routinely before the kit has finished
 * starting, and dropping it there would recreate the exact fault it exists to
 * fix.
 *
 * Restating the same promise is free: it collapses onto the pending entry, and
 * once the server has answered it the kit stops re-sending it. The cap is the
 * server's own — a 21st distinct promise is refused here, and said out loud,
 * rather than silently taking a slot from another one.
 */
export function declarePromise(
  wording: string,
  options?: PromiseDeclarationOptions,
): void {
  try {
    const words = typeof wording === "string" ? wording.trim() : "";
    if (!words) return;
    if (words.length > MAX_PROMISE_WORDING) {
      warnOnce(
        "tooLong",
        `[boosthis] A promise declared in this app's code is longer than the ${MAX_PROMISE_WORDING} characters Boosthis stores, so it was NOT sent. ` +
          `Shorten it to one plain sentence.`,
      );
      return;
    }
    const declaration: PromiseDeclarationReport = { wording: words };

    const kind = options?.subjectKind;
    const label =
      typeof options?.subjectLabel === "string"
        ? options.subjectLabel.trim()
        : undefined;
    const metric = options?.metric;
    const line = options?.threshold;
    const anyGiven =
      kind !== undefined ||
      (label !== undefined && label !== "") ||
      metric !== undefined ||
      line !== undefined;
    if (anyGiven) {
      // Refused HERE rather than sent and refused there, because the kit can
      // name the field: the server only knows the shape did not add up.
      if (
        kind === undefined ||
        label === undefined ||
        label === "" ||
        metric === undefined ||
        typeof line !== "number" ||
        !Number.isFinite(line)
      ) {
        warnOnce(
          "partialMeasure",
          `[boosthis] The promise “${words}” declared in this app's code names only part of a measurement, so it was NOT sent. ` +
            `Give subjectKind, subjectLabel, metric and threshold together, or leave all four out and attach the measurement on the project's promises page.`,
        );
        return;
      }
      if (!SUBJECT_KINDS.includes(kind) || !METRICS.includes(metric)) {
        warnOnce(
          "unknownMeasure",
          `[boosthis] The promise “${words}” declared in this app's code names a subject kind or measurement Boosthis does not have, so it was NOT sent. ` +
            `subjectKind is one of ${SUBJECT_KINDS.join(", ")}; the project's promises page lists the measurements each one takes.`,
        );
        return;
      }
      // A subject label is a reporting label, and rides the same guard every
      // route and screen name does. Dropping the WHOLE declaration is the
      // honest answer: sending the sentence without its measurement would
      // store a promise the developer did not write.
      if (transmitLabelHasPII(label) !== null) {
        warnOnce(
          "localLabel",
          `[boosthis] The promise “${words}” declared in this app's code names a subject that looks like it was built from a value, so it was NOT sent. ` +
            `Name routes, readings and jobs in code, the way /checkout and nightly-billing are written.`,
        );
        return;
      }
      declaration.subjectKind = kind;
      declaration.subjectLabel =
        label.length > MAX_PROMISE_SUBJECT_LABEL
          ? label.slice(0, MAX_PROMISE_SUBJECT_LABEL)
          : label;
      declaration.metric = metric;
      declaration.threshold = Math.max(0, Math.round(line));
    }

    const key = promiseIdentity(words);
    if (!key) return;
    if (acknowledged.get(key) === fingerprint(declaration)) return;
    if (
      !pending.has(key) &&
      !inFlight.has(key) &&
      distinctCount() >= MAX_PROMISE_DECLARATIONS
    ) {
      warnOnce(
        "tooMany",
        `[boosthis] This app declared more than ${MAX_PROMISE_DECLARATIONS} promises in code; “${words}” was not sent. ` +
          `A project holds at most ${MAX_PROMISE_DECLARATIONS} promises — declare the ones that matter.`,
      );
      return;
    }
    pending.set(key, declaration);
  } catch {
    // A guest never fails its host.
  }
}

function distinctCount(): number {
  const keys = new Set<string>([
    ...pending.keys(),
    ...inFlight.keys(),
    ...acknowledged.keys(),
  ]);
  return keys.size;
}

/** Whether there is a declaration worth making an upload for. A promise
 *  declared by an app that never reports a job run must still travel. */
export function hasPendingPromiseDeclarations(): boolean {
  return pending.size > 0;
}

/** How many declarations have NOT been answered by the server. One in this
 *  count is a promise the project does NOT hold yet. */
export function pendingPromiseDeclarationCount(): number {
  return pending.size + inFlight.size;
}

/**
 * Take the declarations for one send, moving them out of pending.
 *
 * A name that would fail the label guard has already been refused at
 * declaration time, so what comes out of here is exactly what goes on the
 * wire.
 */
export function takePromiseDeclarationsForSend(): PromiseDeclarationReport[] {
  if (isBoosthisDisabled()) return [];
  const sending: PromiseDeclarationReport[] = [];
  for (const [key, declaration] of pending) {
    if (inFlight.size >= MAX_PROMISE_DECLARATIONS) break;
    inFlight.set(key, declaration);
    sending.push(declaration);
  }
  pending = new Map();
  return sending;
}

/**
 * Record what one upload answered.
 *
 * A promise the server did not mention is deliberately NOT treated as
 * accepted: it goes back on the pending queue and is asked about again. An
 * older server that knows nothing of code-declared promises answers nothing,
 * so its silence keeps the statement open and eventually says so, rather than
 * being read as a yes.
 *
 * A REFUSAL is answered all the same — it is a definitive answer, so the
 * statement is closed and printed once. Re-sending a refused declaration every
 * 30 seconds would turn one refusal into a permanent stream of uploads about a
 * promise that is never going to be stored.
 */
export function notePromiseDeclarationOutcomes(
  outcomes: readonly PromiseDeclarationOutcome[],
): void {
  try {
    for (const o of outcomes) {
      if (!o || typeof o.wording !== "string") continue;
      const key = promiseIdentity(o.wording);
      const asked = inFlight.get(key);
      if (asked !== undefined) acknowledged.set(key, fingerprint(asked));
      inFlight.delete(key);
      if (o.stored === true) continue;
      const reason = typeof o.reason === "string" ? o.reason : "";
      warnOnce(
        `refused:${reason || "unknown"}`,
        promiseRefusalMessage(o.wording, reason),
      );
    }
  } catch {
    // Reading an answer must never break an upload.
  }
}

/**
 * Put back anything the send did not get an answer for, and say so once when
 * it keeps happening.
 *
 * `delivered` separates the two stories a developer needs told apart: an
 * upload that ARRIVED and said nothing about the declarations is an older
 * server, and an upload that never arrived is a delivery problem — with
 * `gateSentence` naming this kit's own gate when it is the thing stopping it,
 * so nobody is sent to inspect a network that is working perfectly.
 */
export function restorePromiseDeclarations(input: {
  delivered: boolean;
  sentCount: number;
  roundsBeforeWarning: number;
  gateKind?: string | null;
  gateSentence?: string | null;
}): void {
  if (inFlight.size === 0) {
    if (input.sentCount > 0) undeliveredRounds = 0;
    return;
  }
  for (const [key, declaration] of inFlight) {
    if (!pending.has(key)) pending.set(key, declaration);
  }
  inFlight = new Map();
  undeliveredRounds += 1;
  const one = pending.size === 1;
  if (input.delivered && undeliveredRounds === 1) {
    warnOnce(
      "unanswered",
      `[boosthis] Boosthis accepted this app's upload but said nothing about the ${one ? "promise" : "promises"} declared in its code — ${one ? "it is" : "they are"} NOT saved yet. ` +
        `This usually means the Boosthis server is older than this kit; updating it fixes it, and the declaration keeps being re-sent meanwhile.`,
    );
  } else if (!input.delivered && undeliveredRounds >= input.roundsBeforeWarning) {
    warnOnce(
      input.gateKind ? `undelivered:${input.gateKind}` : "undelivered",
      `[boosthis] Boosthis could not deliver the ${one ? "promise" : "promises"} this app declares in code, after ${undeliveredRounds} attempts — ${one ? "it is" : "they are"} NOT saved. ` +
        (input.gateSentence ??
          `Check this app can reach Boosthis; the declaration keeps being re-sent.`),
    );
  }
}

/**
 * Read the outcomes out of an upload reply body.
 *
 * `undefined` means the reply said NOTHING about declarations — an older
 * server, a body that is not an object, a missing field. That is deliberately
 * different from `[]`, which is a server that answered about none of them.
 */
export function parsePromiseDeclarationOutcomes(
  body: unknown,
): PromiseDeclarationOutcome[] | undefined {
  try {
    if (!body || typeof body !== "object") return undefined;
    const raw = (body as Record<string, unknown>).promises;
    if (!Array.isArray(raw)) return undefined;
    const out: PromiseDeclarationOutcome[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      if (typeof rec.wording !== "string" || rec.wording.length === 0) continue;
      const outcome: PromiseDeclarationOutcome = {
        wording: rec.wording,
        stored: rec.stored === true,
      };
      if (typeof rec.reason === "string") outcome.reason = rec.reason;
      out.push(outcome);
    }
    return out;
  } catch {
    return undefined;
  }
}

/** Forget every declared promise (called by `forget()` and the test reset). */
export function clearPromiseDeclarations(): void {
  pending = new Map();
  inFlight = new Map();
  acknowledged.clear();
  undeliveredRounds = 0;
  warnedCauses.clear();
}

/** Test/introspection hooks. */
export const _promiseDeclarationInternals = {
  pending: (): number => pending.size,
  inFlight: (): number => inFlight.size,
  acknowledged: (): number => acknowledged.size,
  undeliveredRounds: (): number => undeliveredRounds,
  reset: clearPromiseDeclarations,
};
