/**
 * A wait Boosthis asked for, honoured by every upload this kit sends.
 *
 * Boosthis answers an upload with 429 when this install, its project key or
 * the whole service has used its upload allowance for the moment, and it says
 * in `Retry-After` how long to wait. Every upload path used to ignore that. The
 * sample queue tried again on its next one-second tick, so a busy worker that
 * crossed its install's allowance was refused in every minute of its busy
 * hours, and the job-run report and panel snapshot sent beside it were refused
 * with it.
 *
 * Now a 429 starts a pause here, and every upload goes through
 * {@link pacedUpload}. While a pause holds an upload, no request is made: the
 * caller gets a local 429 instead ({@link localPauseAnswer}), keeps what it was
 * about to send, and sends it after the pause.
 *
 * ## Which uploads a pause holds
 *
 * The server keeps room for some uploads beyond the measurements' allowance.
 * Crash reports may use all of it. Job runs and panel snapshots have a small
 * room of their own. Measurements stop short of both. A 429 on a measurement
 * therefore says nothing about the room kept for a crash report, and pausing
 * every upload would give that room away. So each upload draws on one
 * allowance level, and a 429 at a level holds the uploads at that level and
 * below:
 *
 *   measurements (samples, spans, candidates, resolutions)   level 0
 *   job runs, panel snapshots                                level 1
 *   crash reports                                            level 2
 *
 * A refused crash report holds everything. A refused sample holds only the
 * measurements.
 *
 * ## How long
 *
 * `Retry-After` in seconds or as an HTTP date. When it is missing or cannot be
 * read, the pause lasts the server's own limiter window (60 seconds). Every
 * wait is held within [1 second, 15 minutes], so a wild header cannot silence
 * the kit for a day. A shorter wait never shortens a pause already in force.
 * A held sender tries again at a random moment within two seconds after the
 * end ({@link resumeDelayMs}), so the senders one pause held do not all meet
 * the limit again in the same instant.
 *
 * Kept in memory, per process: a pause is about the allowance in force now,
 * and a restarted process that meets it again is told again.
 *
 * No imports, on purpose: every upload path and the status surfaces read this,
 * and none of them may pull another's module graph in with it.
 */

/** Every upload a pause can hold. Registration and erasure are not here: the
 *  first has its own wait (telemetry.ts), the second must never be held. */
export type PausedUpload =
  | "samples"
  | "spans"
  | "candidates"
  | "resolutions"
  | "snapshots"
  | "job-runs"
  | "crashes";

/** What the pause in force holds, narrowest first. */
export type UploadPauseScope = "measurements" | "all-but-crashes" | "everything";

/** A 429 whose wait is missing or unreadable pauses this long: the length of
 *  the server's own limiter window. */
export const DEFAULT_PAUSE_MS = 60_000;
/** The shortest pause honoured. A past date or `0` still waits a moment. */
export const MIN_PAUSE_MS = 1_000;
/** The longest pause honoured. Longer than any window the server's limiters
 *  use. */
export const MAX_PAUSE_MS = 15 * 60_000;
/** A held sender tries again at a random moment within this long after the
 *  pause ends. */
export const RESUME_SPREAD_MS = 2_000;

/** The allowance level each upload draws on. Mirrors the server's three
 *  ingest kinds: measurement, priority, crash. */
const ALLOWANCE: Readonly<Record<PausedUpload, 0 | 1 | 2>> = {
  samples: 0,
  spans: 0,
  candidates: 0,
  resolutions: 0,
  snapshots: 1,
  "job-runs": 1,
  crashes: 2,
};

const SCOPES: readonly UploadPauseScope[] = [
  "measurements",
  "all-but-crashes",
  "everything",
];

/** When the pause at each allowance level ends, in epoch ms. 0 = no pause. */
const pausedUntilAt: [number, number, number] = [0, 0, 0];

/**
 * How long a `Retry-After` value asks this kit to wait, in ms.
 *
 * Seconds (`"30"`) or an HTTP date. Missing or unreadable values wait
 * {@link DEFAULT_PAUSE_MS}. Every answer is held within
 * [{@link MIN_PAUSE_MS}, {@link MAX_PAUSE_MS}].
 */
export function pauseLengthMs(
  value: string | null | undefined,
  now: number = Date.now(),
): number {
  const clamp = (ms: number): number =>
    Math.min(MAX_PAUSE_MS, Math.max(MIN_PAUSE_MS, Math.round(ms)));
  if (typeof value !== "string") return DEFAULT_PAUSE_MS;
  const text = value.trim();
  if (/^\d+$/.test(text)) return clamp(Number(text) * 1000);
  // Every HTTP-date form names its day or month in letters. A bare "-5" or
  // "2.5" is neither form, however leniently Date.parse reads it.
  if (!/[A-Za-z]/.test(text)) return DEFAULT_PAUSE_MS;
  const at = Date.parse(text);
  if (Number.isFinite(at)) return clamp(at - now);
  return DEFAULT_PAUSE_MS;
}

/** The `Retry-After` header of a response, or null. Never throws. */
export function retryAfterOf(res: unknown): string | null {
  try {
    const headers = (res as { headers?: { get?: (n: string) => string | null } })
      ?.headers;
    const v = headers?.get?.("retry-after");
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Boosthis answered an upload of this kind with 429: hold it, and every upload
 * on the same or a smaller allowance, until the stated wait is over. Returns
 * when the pause holding this upload ends. Never throws.
 */
export function recordUploadPause(
  upload: PausedUpload,
  retryAfter: string | null | undefined,
  now: number = Date.now(),
): number {
  const level = ALLOWANCE[upload];
  const until = now + pauseLengthMs(retryAfter, now);
  if (pausedUntilAt[level] < until) pausedUntilAt[level] = until;
  return uploadPausedUntil(upload, now) ?? until;
}

/** When the pause holding this upload ends, or null when it may go now. A
 *  pause at this upload's level or any wider one holds it. */
export function uploadPausedUntil(
  upload: PausedUpload,
  now: number = Date.now(),
): number | null {
  let until = 0;
  for (let level = ALLOWANCE[upload]; level < pausedUntilAt.length; level++) {
    if (pausedUntilAt[level]! > until) until = pausedUntilAt[level]!;
  }
  return until > now ? until : null;
}

/**
 * The pause in force, for the status surfaces: what it holds now and when the
 * last upload it holds may go again. Null when nothing is held.
 */
export function getUploadPause(
  now: number = Date.now(),
): { until: number; scope: UploadPauseScope } | null {
  let until = 0;
  let widest = -1;
  for (let level = 0; level < pausedUntilAt.length; level++) {
    const end = pausedUntilAt[level]!;
    if (end <= now) continue;
    widest = level;
    if (end > until) until = end;
  }
  return widest < 0 ? null : { until, scope: SCOPES[widest]! };
}

/** How long a held sender waits before it tries again: to the end of the
 *  pause holding it, plus a random moment within {@link RESUME_SPREAD_MS}.
 *  0 when nothing holds it. */
export function resumeDelayMs(
  upload: PausedUpload,
  now: number = Date.now(),
): number {
  const until = uploadPausedUntil(upload, now);
  if (until === null) return 0;
  return until - now + Math.round(Math.random() * RESUME_SPREAD_MS);
}

/** The status text of every answer this module makes up. */
export const LOCAL_PAUSE_STATUS_TEXT = "Boosthis paused";

/** Answers this module made up, so no caller takes one for the server's. */
const localAnswers = new WeakSet<object>();

/**
 * What an upload held by a pause gets instead of a request: a 429 like the one
 * that started the pause, carrying the wait that remains. No request was made,
 * and nothing about the batch was judged.
 */
export function localPauseAnswer(
  until: number,
  now: number = Date.now(),
): Response {
  const seconds = Math.max(1, Math.ceil((until - now) / 1000));
  const res = new Response(null, {
    status: 429,
    statusText: LOCAL_PAUSE_STATUS_TEXT,
    headers: { "Retry-After": String(seconds) },
  });
  try {
    localAnswers.add(res as unknown as object);
  } catch {
    // A polyfilled Response that cannot be held weakly still carries the
    // status text, which the check below also reads.
  }
  return res;
}

/** True when this answer was made up here and no request was made. Never
 *  throws. */
export function isLocalPauseAnswer(res: unknown): boolean {
  try {
    if (!res || typeof res !== "object") return false;
    if (localAnswers.has(res as object)) return true;
    const r = res as { status?: unknown; statusText?: unknown };
    return r.status === 429 && r.statusText === LOCAL_PAUSE_STATUS_TEXT;
  } catch {
    return false;
  }
}

/** True when Boosthis itself asked this upload to wait: a 429 that crossed
 *  the network. Never throws. */
export function isAskedToWait(res: unknown): boolean {
  try {
    if (!res || typeof res !== "object") return false;
    return (res as { status?: unknown }).status === 429 && !isLocalPauseAnswer(res);
  } catch {
    return false;
  }
}

/**
 * Send one upload through the pause. While a pause holds it, `attempt` is not
 * called and the local answer comes back instead. A 429 from Boosthis starts
 * a pause, or lengthens the one in force.
 */
export async function pacedUpload(
  upload: PausedUpload,
  attempt: () => Promise<Response>,
): Promise<Response> {
  const held = uploadPausedUntil(upload);
  if (held !== null) return localPauseAnswer(held);
  const res = await attempt();
  if (isAskedToWait(res)) {
    try {
      recordUploadPause(upload, retryAfterOf(res));
    } catch {
      /* a pause that cannot be recorded leaves the upload path as it was */
    }
  }
  return res;
}

/** Forget every pause: erasure, and tests. */
export function clearUploadPauses(): void {
  pausedUntilAt[0] = 0;
  pausedUntilAt[1] = 0;
  pausedUntilAt[2] = 0;
}
