/**
 * Whether a crash this kit captured actually SURVIVED — said inside the app.
 *
 * WHY THIS EXISTS. A real Node service crashed, was restarted by its
 * supervisor six seconds later, and Boosthis reported zero crashes. Every step
 * of the fatal path was "best effort" and every failure of it was silent:
 *
 *   - the crash is written to disk synchronously, and a write that fails is
 *     accepted as a lost crash with nothing said anywhere;
 *   - the upload is scheduled asynchronously and the process dies first, so
 *     delivery can only ever happen on a LATER launch;
 *   - that later launch replays the buffer through a server that may refuse it
 *     — unregistered, unauthorised, rate-limited, revoked — and a refusal
 *     collapsed to "accepted nothing", which looks exactly like "nothing to
 *     send";
 *   - and the most common way a service dies runs no code of ours at all.
 *
 * A count of zero was therefore two different answers wearing one face: "your
 * app did not crash" and "we could not tell you that it did".
 *
 * WHAT THIS MODULE KNOWS
 * ------------------
 *
 * 1. **How the previous run of this app ended.** Each run writes an OPEN record
 *    and removes it on the way out (`beforeExit`, an `exit` from
 *    `process.exit()`, the SIGTERM handler in `exitFlush.ts`), or marks it
 *    `uncaught` when the monitor fired — in which case the crash itself is in
 *    the buffer and this record is not news. A record left OPEN by a process
 *    that is gone means the run ended with NO code of ours running: a SIGKILL,
 *    an out-of-memory kill, a hard container reap, a Ctrl-C, the machine going
 *    away. That is the one class of death nothing inside the process can ever
 *    report at the time, and it is the reason a crash-looping service can look
 *    perfectly healthy. It cannot be prevented, but it CAN be noticed
 *    afterwards, and this notices it.
 *
 * 2. **Whether a captured crash could be kept.** Memory-only state (no writable
 *    directory) or a failed write means a fatal crash dies with the process.
 *
 * 3. **Whether a replayed crash was delivered.** The refusal is recorded with
 *    the reason the server gave, so it is visible instead of silent.
 *
 * RULES
 * =====
 *
 * - Everything here is self-guarded and returns a conservative answer on any
 *   error. Telling somebody a crash was lost may never itself break the host.
 * - Nothing is uploaded from here. These are the kit's OWN words, on the host's
 *   error stream (once per cause, ungated — the same contract `dropReport.ts`
 *   keeps), on `/_boosthis/status`, and in the `/_boosthis` answer an AI reads.
 * - Nothing here decides that a crash HAPPENED. An unclean ending is reported
 *   as what it is — a run that ended without a word — and never counted as a
 *   crash class, because we do not know what killed it and we will not invent
 *   a signature for it.
 * - Several processes of one app share one state file, so a run record carries
 *   its owner and a process only ever resolves a record whose owner is gone.
 */

import { statSync } from "node:fs";
import { hostname } from "node:os";
import {
  hostPlatform,
  processLiveness,
  processLivenessMark,
  storage,
  storageDurable,
} from "./storage";

/** Where the run records live. Same store as the crash buffer, own key. */
const STORAGE_KEY = "boosthis:runs:v1";

/** Bound the record list: a machine full of dead workers may not grow the file
 *  without limit. Oldest records past this are dropped unread. */
const MAX_RUN_RECORDS = 16;

/** A record from another host can never be resolved here (we cannot ask
 *  whether its pid is alive), so it is kept only this long before being
 *  forgotten rather than accumulating for ever. */
const FOREIGN_HOST_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** How a run ended, from the inside. `clean` records are removed rather than
 *  stored — the ABSENCE of a record is what a clean ending looks like. */
export type RunEndingReason = "clean" | "signal" | "uncaught";

/** Why a crash this kit captured could not be kept for the next launch. */
export type CrashKeepFailure = "storage-not-durable" | "write-failed";

/** Why the server did not take a crash batch. Closed set: a status we do not
 *  recognise is `unknown` rather than a guess. */
export type CrashRefusalReason =
  | "unreachable"
  | "not-registered"
  | "credential-refused"
  | "rate-limited"
  | "rejected"
  | "server-error"
  | "unknown";

/** Plain words for each refusal — the sentence a human or an AI reads. */
export const CRASH_REFUSAL_TEXT: Record<CrashRefusalReason, string> = {
  unreachable: "Boosthis could not be reached",
  "not-registered": "this install is not registered with Boosthis",
  "credential-refused": "this install's credential was refused",
  "rate-limited": "Boosthis is rate-limiting this install",
  rejected: "Boosthis rejected the report",
  "server-error": "Boosthis answered with an error",
  unknown: "Boosthis did not accept it and gave no reason we recognise",
};

/** Map an HTTP status (0 for "no answer at all") onto the closed set. */
export function crashRefusalFor(status: number): CrashRefusalReason {
  if (!Number.isFinite(status) || status <= 0) return "unreachable";
  if (status === 404) return "not-registered";
  if (status === 401 || status === 403) return "credential-refused";
  if (status === 429) return "rate-limited";
  if (status === 400 || status === 413 || status === 422) return "rejected";
  if (status >= 500) return "server-error";
  return "unknown";
}

/* ─── Process-local state ─────────────────────────────────────────── */

let keepFailures = 0;
let keepFailureCause: CrashKeepFailure | null = null;
let deliveredOccurrences = 0;
let undeliveredOccurrences = 0;
let lastRefusal: { reason: CrashRefusalReason; at: number } | null = null;
/** Unclean endings found in the store at THIS launch (usually 0 or 1). */
let abruptThisLaunch = 0;
/** Unclean endings this app has accumulated, across launches. */
let abruptTotal = 0;
let abruptLastAt: number | null = null;
let runOpened = false;
/** The identity chain, cached. `null` until read — an empty SET is a real
 *  answer (this app has never recorded a launch) and must not re-read. */
let seenIdentities: Set<string> | null = null;

/** How many crash occurrences the buffer is still holding. The crash buffer
 *  imports THIS module, so it hands its own reader in rather than being
 *  imported back. Null until it does — a kit with no crash handlers installed
 *  is holding nothing, not "unknown". */
let heldReader: (() => number) | null = null;
const announced = new Set<string>();

const OWNER_HOST: string = (() => {
  try {
    return hostname();
  } catch {
    return "unknown-host";
  }
})();
const OWNER_STARTED_AT = Math.round(
  Date.now() -
    (typeof process.uptime === "function" ? process.uptime() * 1000 : 0),
);
const OWNER_ID = `${OWNER_HOST}#${process.pid}#${OWNER_STARTED_AT}`;

/** Is that pid still running? `kill(pid, 0)` sends no signal; anything other
 *  than "no such process" reads as alive, because leaving a record alone is
 *  always the safe answer. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code !== "ESRCH";
  }
}

/** How far apart two datings of the SAME process start may be. Ours is
 *  `Date.now() - process.uptime()`, taken when this module loaded; the
 *  kernel's is exact. They differ by milliseconds. */
const PID_INSTANCE_SLACK_MS = 5_000;

/** When did the process now holding this pid actually start?
 *
 *  Linux dates every `/proc/<pid>` entry with the moment its process began,
 *  which is what tells a live sibling worker apart from a stranger that
 *  inherited its number. A platform without procfs cannot answer and says so
 *  rather than guessing. */
function pidStartedAt(pid: number): number | null {
  // Windows has no /proc; a suite standing in for Windows gets its answer.
  if (hostPlatform() === "win32") return null;
  try {
    const st = statSync(`/proc/${pid}`);
    return Number.isFinite(st.ctimeMs) && st.ctimeMs > 0 ? st.ctimeMs : null;
  } catch {
    return null;
  }
}

/**
 * Is the process that recorded this span still running — the SAME process,
 * and not merely something wearing its number?
 *
 * This decides whether a span is credited up to NOW or only as far as it was
 * stamped, and the difference is the denominator of the crash rate. `kill(pid,
 * 0)` answers a different question: pids are reused, and the reuse this file
 * exists for is the ordinary one — a container whose app is pid 1 crashes and
 * the replacement is pid 1 again. Crediting that dead predecessor to now would
 * count the downtime BETWEEN the crash and the restart as time this app was
 * watched, which is the same lie as the one this history was written to end,
 * told from the other side.
 *
 * So: our own span is live by definition; our own pid held by an earlier
 * lifetime is gone whatever `kill(0)` says; another host cannot be probed at
 * all; and a sibling's pid is dated against the span where the platform can
 * date it. Every "cannot tell" here resolves toward crediting LESS observed
 * time, which makes the crash rate read worse rather than better.
 */
function spanStillRunning(sp: HistorySpan): boolean {
  if (sp.o === OWNER_ID) return true;
  if (sp.h !== OWNER_HOST) return false;
  if (sp.p === process.pid) return false;
  if (!pidAlive(sp.p)) return false;
  // Windows: the span's liveness mark answers what /proc answers on Linux.
  if (sp.l !== undefined) {
    const live = processLiveness(sp.l);
    if (live === "gone") return false;
    if (live === "alive") return true;
  }
  const started = pidStartedAt(sp.p);
  return started === null
    ? true
    : Math.abs(started - sp.s) <= PID_INSTANCE_SLACK_MS;
}

interface RunRecord {
  id: string;
  pid: number;
  host: string;
  /** The writer's liveness mark (Windows only; see storage.ts). What tells
   *  that process from a later one given its pid. */
  live?: string;
  installId?: string;
  startedAt: number;
  /** `open` until the run ends; `uncaught` once the monitor has fired, which
   *  says the crash is in the buffer and this record is not a second event. */
  state: "open" | "uncaught";
  at: number;
}

interface RunFile {
  runs: RunRecord[];
  abrupt: { count: number; lastAt: number | null };
  /** Install ids THIS app has run as, most recent last. See `hasRunAs`. */
  seen: string[];
  /** What this app's earlier lifetimes saw. Survives the restart that erases
   *  every in-memory counter. See CRASH_HISTORY_WINDOW_MS. */
  history: History;
}

/** How many identities back the chain reaches. A crash is offered by the very
 *  next launch, so one is almost always enough; this leaves room for a service
 *  that restarts repeatedly while offline. */
const MAX_SEEN_IDENTITIES = 8;

/* ─── The history a restart may not erase ─────────────────────────── */

/**
 * How far back the crash-free verdict looks: 24 hours.
 *
 * The verdict used to be read off a counter in the memory of the running
 * process, which means the one event the axis exists to report — a crash that
 * ENDS that process — also destroyed the only evidence of itself. Six seconds
 * after a fatal crash the replacement process reported "crash-free", with a
 * five-minute window, and it was telling the truth about everything it could
 * still see.
 *
 * A window has to be stated, because both ways of not stating one are wrong. A
 * verdict that only covers the current process vanishes at exactly the moment
 * it matters. A verdict that covers all of history condemns an app for a crash
 * it fixed a month ago and can never read clean again. Twenty-four hours is
 * long enough that a restart cannot outrun it — a crash-looping service
 * restarts in seconds, and even a slow supervisor is minutes — and short
 * enough that a day of health answers for yesterday's crash. Every surface
 * that renders this verdict says which window it covers.
 */
export const CRASH_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Bound the ring: a service restarting in a tight loop may not grow the state
 *  file without limit. Overflow is counted, so the reading says "at least"
 *  rather than quietly under-reporting. */
const MAX_HISTORY_SPANS = 32;
const MAX_HISTORY_CRASHES = 64;

/** One run of this app: when it began, and the last moment it is KNOWN to have
 *  been alive. Owner-stamped, because several workers of one app share this
 *  file and their lifetimes overlap. */
interface HistorySpan {
  o: string;
  h: string;
  p: number;
  s: number;
  e: number;
  /** The writer's liveness mark, as on a run record. Windows only. */
  l?: string;
}

/** A liveness mark's shape. Anything else in a record is ignored. */
const LIVE_MARK = /^[0-9a-f]{16}$/;

/** Has the process that wrote a record ended, though its pid answers? Only a
 *  liveness mark can say so (Windows), and only "gone" counts: a mark that
 *  cannot be read leaves the record alone, the safe answer. */
function markEnded(mark: string | undefined): boolean {
  return mark !== undefined && processLiveness(mark) === "gone";
}

interface History {
  spans: HistorySpan[];
  /** Entries that fell off the RING (not out of the window). */
  spansDropped: number;
  crashes: Array<{ o: string; t: number }>;
  crashesDropped: number;
}

function emptyHistory(): History {
  return { spans: [], spansDropped: 0, crashes: [], crashesDropped: 0 };
}

function historyIsEmpty(h: History): boolean {
  return (
    h.spans.length === 0 &&
    h.crashes.length === 0 &&
    h.spansDropped === 0 &&
    h.crashesDropped === 0
  );
}

/** Drop what the window no longer covers. A span that STARTED before the
 *  window but is still running is kept — it is clipped when it is read, not
 *  discarded, or a long-lived process would report no observed time at all. */
function pruneHistory(h: History, now: number): History {
  const from = now - CRASH_HISTORY_WINDOW_MS;
  const spans = h.spans.filter((sp) => sp.e >= from || sp.o === OWNER_ID);
  const crashes = h.crashes.filter((c) => c.t >= from);
  let spansDropped = h.spansDropped;
  let crashesDropped = h.crashesDropped;
  // Ageing OUT of the window is not an omission — the verdict does not claim
  // to cover it. Falling off the RING is, and is counted.
  if (spans.length > MAX_HISTORY_SPANS) {
    spansDropped += spans.length - MAX_HISTORY_SPANS;
    spans.splice(0, spans.length - MAX_HISTORY_SPANS);
  }
  if (crashes.length > MAX_HISTORY_CRASHES) {
    crashesDropped += crashes.length - MAX_HISTORY_CRASHES;
    crashes.splice(0, crashes.length - MAX_HISTORY_CRASHES);
  }
  return { spans, spansDropped, crashes, crashesDropped };
}

function emptyFile(): RunFile {
  return {
    runs: [],
    abrupt: { count: 0, lastAt: null },
    seen: [],
    history: emptyHistory(),
  };
}

function parseFile(raw: string | null): RunFile {
  if (!raw) return emptyFile();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyFile();
    const rec = parsed as Record<string, unknown>;
    const runs: RunRecord[] = [];
    if (Array.isArray(rec.runs)) {
      for (const r of rec.runs) {
        const o = r as Record<string, unknown>;
        if (
          !o ||
          typeof o.id !== "string" ||
          typeof o.pid !== "number" ||
          typeof o.host !== "string" ||
          (o.state !== "open" && o.state !== "uncaught")
        ) {
          continue;
        }
        runs.push({
          id: o.id,
          pid: o.pid,
          host: o.host,
          ...(typeof o.live === "string" && LIVE_MARK.test(o.live) ? { live: o.live } : {}),
          installId: typeof o.installId === "string" ? o.installId : undefined,
          startedAt: typeof o.startedAt === "number" ? o.startedAt : 0,
          state: o.state,
          at: typeof o.at === "number" ? o.at : 0,
        });
        if (runs.length >= MAX_RUN_RECORDS) break;
      }
    }
    const abruptRaw = rec.abrupt as Record<string, unknown> | undefined;
    const count =
      abruptRaw && typeof abruptRaw.count === "number" && abruptRaw.count > 0
        ? Math.floor(abruptRaw.count)
        : 0;
    const lastAt =
      abruptRaw && typeof abruptRaw.lastAt === "number" ? abruptRaw.lastAt : null;
    const seen = Array.isArray(rec.seen)
      ? rec.seen.filter((v): v is string => typeof v === "string" && v.length > 0)
      : [];
    return {
      runs,
      abrupt: { count, lastAt },
      seen: seen.slice(-MAX_SEEN_IDENTITIES),
      history: parseHistory(rec.history),
    };
  } catch {
    return emptyFile();
  }
}

/** A history written by an older kit is simply absent, which reads as "this
 *  app has no earlier lifetimes on record" — the honest answer, and the one
 *  the axis already knows how to say. */
function parseHistory(raw: unknown): History {
  if (!raw || typeof raw !== "object") return emptyHistory();
  const rec = raw as Record<string, unknown>;
  const spans: HistorySpan[] = [];
  if (Array.isArray(rec.spans)) {
    for (const v of rec.spans) {
      const o = v as Record<string, unknown>;
      if (
        !o ||
        typeof o.o !== "string" ||
        typeof o.h !== "string" ||
        typeof o.p !== "number" ||
        typeof o.s !== "number" ||
        typeof o.e !== "number"
      ) {
        continue;
      }
      spans.push({
        o: o.o,
        h: o.h,
        p: o.p,
        s: o.s,
        e: Math.max(o.s, o.e),
        ...(typeof o.l === "string" && LIVE_MARK.test(o.l) ? { l: o.l } : {}),
      });
      if (spans.length >= MAX_HISTORY_SPANS) break;
    }
  }
  const crashes: Array<{ o: string; t: number }> = [];
  if (Array.isArray(rec.crashes)) {
    for (const v of rec.crashes) {
      const o = v as Record<string, unknown>;
      if (!o || typeof o.o !== "string" || typeof o.t !== "number") continue;
      crashes.push({ o: o.o, t: o.t });
      if (crashes.length >= MAX_HISTORY_CRASHES) break;
    }
  }
  const nonNeg = (v: unknown): number =>
    typeof v === "number" && v > 0 ? Math.floor(v) : 0;
  return {
    spans,
    spansDropped: nonNeg(rec.spansDropped),
    crashes,
    crashesDropped: nonNeg(rec.crashesDropped),
  };
}

function writeFile(next: RunFile): string | null {
  if (
    next.runs.length === 0 &&
    next.abrupt.count === 0 &&
    next.seen.length === 0 &&
    historyIsEmpty(next.history)
  ) {
    return null;
  }
  return JSON.stringify({
    runs: next.runs.slice(-MAX_RUN_RECORDS),
    abrupt: next.abrupt,
    seen: next.seen.slice(-MAX_SEEN_IDENTITIES),
    ...(historyIsEmpty(next.history) ? {} : { history: next.history }),
  });
}

/**
 * Open this run's record, and resolve what the previous ones did.
 *
 * Called once, when the crash handlers go on. Every record whose owner is a
 * DEAD process on this host is resolved and removed:
 *
 *   - `open`     — the run ended with nothing of ours running. Counted as an
 *                  unclean ending and said out loud, once.
 *   - `uncaught` — the run died of an error it had already captured. The crash
 *                  buffer speaks for it; the record is just cleared.
 *
 * A record owned by a LIVE process is another worker's and is put back
 * untouched. A record from another host cannot be judged from here at all, so
 * it is left alone until it ages out.
 */
export function beginRun(installId?: string | null): void {
  try {
    if (runOpened) return;
    runOpened = true;
    const now = Date.now();
    let foundAbrupt = 0;
    let total = 0;
    let lastAt: number | null = null;
    // Made before the locked update: making it may touch the state folder.
    const mark = processLivenessMark();
    storage.updateSync(STORAGE_KEY, (current) => {
      const file = parseFile(current);
      const keep: RunRecord[] = [];
      for (const r of file.runs) {
        if (r.id === OWNER_ID) continue;
        if (r.host !== OWNER_HOST) {
          // Not ours to judge — but not ours to hoard either.
          if (now - Math.max(r.at, r.startedAt) < FOREIGN_HOST_RETENTION_MS) {
            keep.push(r);
          }
          continue;
        }
        // Our own pid held by an earlier process instance (the ordinary
        // restart-in-place case: a container whose app is pid 1 gets pid 1
        // again) resolves too — that holder is gone whatever `kill(0)` says.
        // On Windows a reused pid is told apart by the run's liveness mark.
        const gone =
          r.pid === process.pid || !pidAlive(r.pid) || markEnded(r.live);
        if (!gone) {
          keep.push(r);
          continue;
        }
        if (r.state === "open") {
          foundAbrupt += 1;
          lastAt = Math.max(lastAt ?? 0, r.at, r.startedAt) || now;
        }
      }
      keep.push({
        id: OWNER_ID,
        pid: process.pid,
        host: OWNER_HOST,
        ...(mark !== null ? { live: mark } : {}),
        ...(installId ? { installId } : {}),
        startedAt: OWNER_STARTED_AT,
        state: "open",
        at: now,
      });
      total = file.abrupt.count + foundAbrupt;
      if (foundAbrupt === 0) lastAt = file.abrupt.lastAt;
      // The identity chain: every id THIS app has launched under, in order.
      // It is what lets a crash buffered under a previous id be recognised as
      // ours after a restart minted a new one — without that, either the
      // crash is dropped or every stranger's crash in a shared file is
      // claimed. Kept even when no run record is (a clean stop removes the
      // record; the chain is what the NEXT crash will be judged against).
      const seen = installId
        ? [...file.seen.filter((id) => id !== installId), installId]
        : file.seen;
      seenIdentities = new Set(seen.slice(-MAX_SEEN_IDENTITIES));
      // Open this lifetime's span in the durable history. It is what makes the
      // crash-free verdict survive the restart: without it the replacement
      // process starts its observation window at zero and reports the app
      // clean, having thrown away the evidence of the crash that made it.
      const history = pruneHistory(
        {
          ...file.history,
          spans: [
            ...file.history.spans.filter((sp) => sp.o !== OWNER_ID),
            {
              o: OWNER_ID,
              h: OWNER_HOST,
              p: process.pid,
              s: OWNER_STARTED_AT,
              e: now,
              ...(mark !== null ? { l: mark } : {}),
            },
          ],
        },
        now,
      );
      return writeFile({
        runs: keep,
        abrupt: { count: total, lastAt },
        seen,
        history,
      });
    });
    abruptThisLaunch = foundAbrupt;
    abruptTotal = total;
    abruptLastAt = lastAt;
    if (foundAbrupt > 0) announceAbruptEnding(foundAbrupt);
  } catch {
    /* never let bookkeeping about crashes break the host's start-up */
  }
}

/**
 * Close this run's record.
 *
 * `clean` and `signal` remove it: the process is going away in a way we saw,
 * and the flush that goes with it has already run. `uncaught` leaves a marked
 * record behind so a launch that finds it knows the death is already described
 * by a crash in the buffer, and does not report it a second time as a silent
 * disappearance.
 */
export function endRun(reason: RunEndingReason): void {
  try {
    if (!runOpened) return;
    storage.updateSync(STORAGE_KEY, (current) => {
      const file = parseFile(current);
      const keep: RunRecord[] = [];
      for (const r of file.runs) {
        if (r.id !== OWNER_ID) {
          keep.push(r);
          continue;
        }
        if (reason === "uncaught") keep.push({ ...r, state: "uncaught" });
      }
      // Close this lifetime's span whatever ended it. The observed time it
      // covers is the denominator of the crash rate the NEXT lifetime will
      // report, so a run whose end is never stamped is credited only up to the
      // last moment we can prove it was alive — the safe direction.
      const now = Date.now();
      const history = pruneHistory(
        {
          ...file.history,
          spans: file.history.spans.map((sp) =>
            sp.o === OWNER_ID ? { ...sp, e: Math.max(sp.e, now) } : sp,
          ),
        },
        now,
      );
      return writeFile({
        runs: keep,
        abrupt: file.abrupt,
        seen: file.seen,
        history,
      });
    });
    if (reason !== "uncaught") runOpened = false;
  } catch {
    /* a shutdown may never become a stack trace */
  }
}

/**
 * Has this application ever launched under this install id?
 *
 * A crash left in the buffer carries the identity of the process that captured
 * it, and the launch that finds it may be running under a different one: a
 * service that restarts can mint a fresh install id, and a crash-looping
 * service is exactly the one whose identity moves. Two wrong answers are
 * available here. Refuse the crash and the death that caused the restart is
 * the one death guaranteed never to be reported. Claim it on the strength of
 * "the process that wrote it is dead" alone and a state file shared by two
 * applications lets one of them send — and delete — the other's crashes.
 *
 * So the question asked is neither. It is whether the id on the crash is one
 * THIS app has itself launched under, from a chain it wrote at its own
 * start-up. A stranger's id was never in it, and a predecessor's always is.
 *
 * `false` for an id we have no record of, which is the safe direction: the
 * crash stays on disk for whoever owns it.
 */
export function hasRunAs(installId: string): boolean {
  if (!installId) return false;
  if (seenIdentities === null) {
    try {
      seenIdentities = new Set(parseFile(storage.getSync(STORAGE_KEY)).seen);
    } catch {
      seenIdentities = new Set();
    }
  }
  return seenIdentities.has(installId);
}

/* ─── The crash-free verdict's own evidence ───────────────────────── */

/**
 * A crash happened. Write it where a restart cannot reach it.
 *
 * Called by the crash buffer for every crash it captures, on the same
 * synchronous path that persists the crash itself, so a fatal one is recorded
 * before the process dies. Stamped with the run that suffered it, so the
 * lifetime that reads this back can tell its OWN crashes (already in its
 * in-memory count) from its predecessors' (which nothing else remembers).
 *
 * This is deliberately NOT the upload queue. A crash is delivered once and
 * then removed from the buffer; the verdict has to keep answering for it for
 * as long as its window says it does, and the two therefore cannot share a
 * record. Nor is it the server's copy: the axis has to answer inside the app,
 * offline, on the bubble and on `/_boosthis`, and it has to answer about
 * crashes the server has not been told about — which is precisely the state
 * this whole area exists to stop hiding.
 */
export function noteCrashOccurred(at?: number): boolean {
  try {
    const now = Date.now();
    const t = typeof at === "number" && Number.isFinite(at) ? at : now;
    const { persisted } = storage.updateSyncPersisted(STORAGE_KEY, (current) => {
      const file = parseFile(current);
      const history = pruneHistory(
        {
          ...file.history,
          crashes: [...file.history.crashes, { o: OWNER_ID, t }],
          // A crash proves this run was alive at least until now, whatever the
          // span last recorded.
          spans: file.history.spans.map((sp) =>
            sp.o === OWNER_ID ? { ...sp, e: Math.max(sp.e, t) } : sp,
          ),
        },
        now,
      );
      return writeFile({
        runs: file.runs,
        abrupt: file.abrupt,
        seen: file.seen,
        history,
      });
    });
    // A WRITE THAT DID NOT REACH DISK IS NOT A RECORD. Every write in this
    // store is best-effort and throws nothing when there is nowhere to put it,
    // so a full disk or a read-only directory would leave this crash in the
    // memory of a process that is, very often, about to die — while the caller
    // marked its queued copy as "the history has this". Say so instead: the
    // reporting verdict turns to `cannot-keep`, which is what stops the axis
    // rendering a confident zero, and the caller keeps the queue as the only
    // surviving evidence.
    if (!persisted) noteCrashKeepFailed("write-failed");
    return persisted;
  } catch {
    /* recording a crash may never itself break the host */
    noteCrashKeepFailed("write-failed");
    return false;
  }
}

/**
 * A crash learned from a BUFFER rather than from watching it happen.
 *
 * Every kit released before this history kept a crash in one place only: the
 * upload queue. On the launch that upgrades such an app, that queue is the
 * ONLY surviving evidence the crash ever happened — and the queue is emptied
 * the instant the server accepts it. Deliver, empty, and the very next reading
 * of an app that crashed minutes ago is a confident 100/good, which is the
 * whole failure this area exists to end, reappearing at the upgrade boundary.
 *
 * So the launch that adopts a queued crash writes it into the history BEFORE
 * offering it. Stamped with the moment the buffer last saw the crash — never
 * with now, or a crash from three days ago would be re-dated into today's
 * window — and owned by whoever buffered it, so it counts as carried and ages
 * out exactly like every other. Adopted once: the entry is marked in the buffer
 * as it is imported, so a later launch that finds it still undelivered does not
 * count it a second time.
 */
export function noteCarriedCrashes(
  occurrences: number,
  at: number,
  owner: string,
): boolean {
  try {
    const n = Math.min(
      Math.floor(Number.isFinite(occurrences) ? occurrences : 0),
      MAX_HISTORY_CRASHES,
    );
    if (n <= 0) return false;
    const now = Date.now();
    const t = Number.isFinite(at) && at > 0 ? Math.min(at, now) : now;
    // Already outside the window this verdict answers for: nothing to add, and
    // pruning would drop it on the next write anyway. Nothing was adopted, so
    // the buffer keeps its copy — but this is not a failure to keep evidence
    // either: the window this verdict answers for simply does not reach back
    // that far.
    if (t < now - CRASH_HISTORY_WINDOW_MS) return true;
    // Never this run's own id: this process did not see these happen, so they
    // are carried evidence and the reading must say so.
    const o = owner && owner !== OWNER_ID ? owner : "carried";
    const rows = Array.from({ length: n }, () => ({ o, t }));
    const { persisted } = storage.updateSyncPersisted(STORAGE_KEY, (current) => {
      const file = parseFile(current);
      const history = pruneHistory(
        { ...file.history, crashes: [...file.history.crashes, ...rows] },
        now,
      );
      return writeFile({
        runs: file.runs,
        abrupt: file.abrupt,
        seen: file.seen,
        history,
      });
    });
    // As above: an adoption that stayed in memory is not an adoption. The
    // buffer must stay unmarked so the next launch tries again, and the axis
    // must not read a zero it has not earned — this is the upgrade boundary,
    // where the queue is the ONLY copy of the crash and delivery is about to
    // empty it.
    if (!persisted) noteCrashKeepFailed("write-failed");
    return persisted;
  } catch {
    /* adopting evidence may never itself break the host */
    noteCrashKeepFailed("write-failed");
    return false;
  }
}

/** What the crash-free verdict's window actually contains. */
export interface CrashHistoryWindow {
  /** The window this describes, in ms (CRASH_HISTORY_WINDOW_MS). */
  windowMs: number;
  /** Crash occurrences inside the window suffered by EARLIER lifetimes of this
   *  app — the ones no in-memory counter remembers. This run's own crashes are
   *  excluded; they are counted separately as `own`. */
  carried: number;
  /** Crash occurrences inside the window suffered by THIS run.
   *
   *  The in-memory counter is a lifetime total: a process that has been up for
   *  three days still counts a crash it survived on day one, and the window
   *  this verdict names would then be a window in name only. These are the same
   *  occurrences, stamped, so the current run ages out of the window exactly as
   *  every earlier one does. */
  own: number;
  /** True when older occurrences fell off the bounded ring, so `carried` is a
   *  floor rather than a count. */
  carriedAtLeast: boolean;
  /** Milliseconds of this app's life the window covers, merged across
   *  overlapping sibling runs and clipped to the window. */
  observedMs: number;
  /** Runs of this app the window covers, this one included. More than one
   *  means the window spans a restart — the thing a per-process reading can
   *  never show. */
  runs: number;
  /** True when older spans fell off the ring, so `runs` is a floor. */
  runsAtLeast: boolean;
  /** False when no history could be read at all (memory-only state, an older
   *  kit's file, a first launch). The caller then has only what it can see
   *  itself, and must not pretend otherwise. */
  recorded: boolean;
}

/**
 * Read the window back.
 *
 * A span belonging to a process that is still running is credited up to NOW,
 * not up to its last stamp: a live worker's lifetime is ongoing, and reading
 * its stale end would under-report the observed time of a fleet that has been
 * up for hours. "Still running" means the same process instance and not just
 * the same pid — see `spanStillRunning`, which is what stops the gap between a
 * crash and the restart that followed it being credited as watched time. A
 * span whose liveness cannot be established is credited only as far as it was
 * stamped — under-crediting the denominator, which makes the crash rate read
 * WORSE rather than better.
 */
export function crashHistoryWindow(now: number = Date.now()): CrashHistoryWindow {
  const empty: CrashHistoryWindow = {
    windowMs: CRASH_HISTORY_WINDOW_MS,
    carried: 0,
    own: 0,
    carriedAtLeast: false,
    observedMs: 0,
    runs: 0,
    runsAtLeast: false,
    recorded: false,
  };
  try {
    const raw = storage.getSync(STORAGE_KEY);
    if (raw === null) return empty;
    const h = parseFile(raw).history;
    if (historyIsEmpty(h)) return empty;
    const from = now - CRASH_HISTORY_WINDOW_MS;
    const inWindow = h.crashes.filter((c) => c.t >= from && c.t <= now);
    const carried = inWindow.filter((c) => c.o !== OWNER_ID).length;
    const own = inWindow.length - carried;

    const intervals: Array<[number, number]> = [];
    for (const sp of h.spans) {
      const end = Math.min(now, spanStillRunning(sp) ? now : sp.e);
      const start = Math.max(sp.s, from);
      if (end > start) intervals.push([start, end]);
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let observedMs = 0;
    let cursor = -1;
    for (const [s, e] of intervals) {
      const from2 = Math.max(s, cursor);
      if (e > from2) observedMs += e - from2;
      cursor = Math.max(cursor, e);
    }

    return {
      windowMs: CRASH_HISTORY_WINDOW_MS,
      carried,
      own,
      carriedAtLeast: h.crashesDropped > 0,
      observedMs,
      runs: intervals.length,
      runsAtLeast: h.spansDropped > 0,
      recorded: true,
    };
  } catch {
    return empty;
  }
}

/* ─── What happened to a captured crash ───────────────────────────── */

/**
 * The transport's verdict on the batch it just tried to send, waiting to be
 * read by the flush that asked for it.
 *
 * The crash buffer only ever learns a NUMBER back ("the server took this
 * many"), and zero is three different things: refused, unreachable, or never
 * offered at all because the kit holds no credential yet. The transport is the
 * only place that knows which, so it leaves the reason here and the flush
 * takes it. Nothing set means "not offered" — the crashes are simply still
 * held, which is not a refusal and must never be announced as one.
 */
let pendingRefusal: CrashRefusalReason | null = null;

/** Called by the transport when a crash batch was offered and not taken. */
export function noteCrashSendRefused(reason: CrashRefusalReason): void {
  pendingRefusal = reason;
}

/** Read and clear the transport's verdict. A stale reason may never be
 *  attached to a later batch, so this consumes it. */
export function takeCrashSendRefusal(): CrashRefusalReason | null {
  const r = pendingRefusal;
  pendingRefusal = null;
  return r;
}

/**
 * The crash buffer hands over its own "how much am I still holding?" reader.
 *
 * A crash captured but NOT YET OFFERED is neither kept-and-failed nor refused,
 * and used to read as nothing at all: a restored crash waiting for registration
 * to answer left the verdict at `reporting` while this process's own crash
 * count was zero, which is exactly the "we told them they were fine" shape this
 * work exists to remove.
 */
export function useHeldCrashReader(read: () => number): void {
  heldReader = read;
}
/** The synchronous write that keeps a crash for the next launch failed. */
export function noteCrashKeepFailed(
  cause: CrashKeepFailure = "write-failed",
): void {
  try {
    keepFailures += 1;
    keepFailureCause = cause;
    announceKeepFailure(cause);
  } catch {
    /* best effort */
  }
}

/** The server took `occurrences` crash occurrences. */
export function noteCrashDelivered(occurrences: number): void {
  try {
    if (!Number.isFinite(occurrences) || occurrences <= 0) return;
    deliveredOccurrences += Math.floor(occurrences);
    // A success does not erase the record of what was refused before it: the
    // hole in the dashboard is still there. It does clear the LIVE refusal,
    // because the pipe is demonstrably working again.
    lastRefusal = null;
    undeliveredOccurrences = 0;
    pendingRefusal = null;
  } catch {
    /* best effort */
  }
}

/**
 * The server did not take the batch. `occurrences` is how much was in it, so
 * the size of what is still waiting is the truth rather than a batch count.
 */
export function noteCrashDeliveryRefused(
  reason: CrashRefusalReason,
  occurrences: number,
): void {
  try {
    const n =
      Number.isFinite(occurrences) && occurrences > 0
        ? Math.floor(occurrences)
        : 0;
    undeliveredOccurrences = n;
    lastRefusal = { reason, at: Date.now() };
    announceRefusal(reason, n);
  } catch {
    /* best effort */
  }
}

/* ─── The kit's own words ─────────────────────────────────────────── */

function say(key: string, line: string): void {
  if (announced.has(key)) return;
  announced.add(key);
  try {
    console.warn(`[boosthis] ${line}`);
  } catch {
    /* a broken console must never take the host down */
  }
}

/**
 * Kept crashes dropped unsent because their latest occurrence is older than the
 * 30 days the server keeps crash receipts for (`CRASH_DELIVERY_KEEP_DAYS`).
 * Past that, a retried batch would be counted a second time, so offering it is
 * worse than saying plainly that it was not sent. Said once per drop.
 */
export function noteCrashesGivenUp(occurrences: number, oldestAt: number): void {
  try {
    const n =
      Number.isFinite(occurrences) && occurrences > 0 ? Math.floor(occurrences) : 0;
    if (n === 0) return;
    const day = Number.isFinite(oldestAt)
      ? new Date(oldestAt).toISOString().slice(0, 10)
      : "an unknown day";
    say(
      `given-up:${oldestAt}:${n}`,
      n === 1
        ? `1 crash occurrence this app kept was older than the 30 days Boosthis keeps crash receipts for, so it was not sent and has been removed. It happened on ${day}.`
        : `${n} crash occurrences this app kept were older than the 30 days Boosthis keeps crash receipts for, so they were not sent and have been removed. The oldest happened on ${day}.`,
    );
  } catch {
    /* best effort */
  }
}

function announceKeepFailure(cause: CrashKeepFailure): void {
  say(
    `keep:${cause}`,
    cause === "storage-not-durable"
      ? "This app has nowhere to write, so a crash that kills the process " +
          "cannot be kept for the next launch and will not be reported. Give " +
          "the process a writable HOME or set BOOSTHIS_STATE_DIR."
      : "A crash was captured but could not be written to disk, so it will " +
          "not survive this process. Check that the Boosthis state directory " +
          "is writable.",
  );
}

function announceRefusal(reason: CrashRefusalReason, occurrences: number): void {
  say(
    `refused:${reason}`,
    `Boosthis did not accept ${occurrences} crash occurrence${
      occurrences === 1 ? "" : "s"
    } this app reported: ${CRASH_REFUSAL_TEXT[reason]}. They are still held ` +
      "and will be offered again; until they are accepted this project's " +
      "crash count is lower than the truth.",
  );
}

function announceAbruptEnding(found: number): void {
  say(
    "abrupt",
    `The previous run of this app ended without a word — no error and no ` +
      `shutdown we could see${found > 1 ? ` (${found} runs)` : ""}. That is ` +
      "what a SIGKILL, an out-of-memory kill or an interrupted terminal " +
      "looks like from inside: no code of ours runs, so nothing about that " +
      "ending can be reported at the time it happens. Anything that run had " +
      "captured is being offered again now.",
  );
}

/* ─── What every surface reads ────────────────────────────────────── */

export interface CrashDeliveryFacts {
  /** Can a captured crash survive this process at all? */
  canKeep: boolean;
  /** Why not, when it cannot. Null while nothing has gone wrong. */
  keepFailure: CrashKeepFailure | null;
  /** Failed synchronous writes this run. */
  keepFailures: number;
  /** Crash occurrences the server has accepted from this process. */
  delivered: number;
  /** Crash occurrences held after the most recent refusal. */
  undelivered: number;
  /** Crash occurrences captured and NOT YET accepted — refused, or simply not
   *  offered yet (no credential, kit still locked, server unreachable). A
   *  backlog is not a zero, whatever this process's own crash count says. */
  held: number;
  /** Occurrences filed under the install that replaced the one that crashed. */
  refiledUnderSuccessor: number;
  /** The most recent refusal, or null when the last attempt was accepted. */
  lastRefusal: { reason: CrashRefusalReason; at: number } | null;
  /** Runs of this app that ended with nothing of ours running — found at this
   *  launch, and in total across launches. */
  abruptEndingsThisLaunch: number;
  abruptEndingsTotal: number;
  abruptEndingLastAt: number | null;
}

export function crashDeliveryFacts(): CrashDeliveryFacts {
  let canKeep = true;
  try {
    canKeep = storageDurable() && keepFailures === 0;
  } catch {
    canKeep = keepFailures === 0;
  }
  return {
    canKeep,
    keepFailure: canKeep
      ? null
      : (keepFailureCause ?? "storage-not-durable"),
    keepFailures,
    delivered: deliveredOccurrences,
    undelivered: undeliveredOccurrences,
    held: heldOccurrences(),
    refiledUnderSuccessor,
    lastRefusal,
    abruptEndingsThisLaunch: abruptThisLaunch,
    abruptEndingsTotal: abruptTotal,
    abruptEndingLastAt: abruptLastAt,
  };
}

/**
 * One word for "can this install report a crash?", for every surface that
 * shows a crash count. A zero next to `reporting` is a zero somebody earned;
 * a zero next to anything else is not a zero at all.
 */
export type CrashReportingVerdict =
  | "reporting"
  | "cannot-keep"
  | "not-delivering"
  | "holding";

export function crashReportingVerdict(): CrashReportingVerdict {
  const f = crashDeliveryFacts();
  if (!f.canKeep) return "cannot-keep";
  if (f.lastRefusal !== null) return "not-delivering";
  // Captured, kept, never yet accepted. A restored crash waiting for
  // registration to answer belongs to nobody's crash count yet — this
  // process never saw it happen, and the server has not been told — so
  // "reporting" here is the shape that lets a crashing app read as healthy.
  if (f.held > 0) return "holding";
  return "reporting";
}

/** One sentence for a status page or an AI answer. Empty when there is nothing
 *  wrong to say, so a healthy install shows nothing at all. */
export function crashDeliveryNote(): string {
  const f = crashDeliveryFacts();
  const parts: string[] = [];
  if (!f.canKeep) {
    parts.push(
      f.keepFailure === "storage-not-durable"
        ? "a crash that kills this process cannot be kept (nothing writable to keep it in)"
        : "a captured crash could not be written to disk",
    );
  }
  if (f.lastRefusal) {
    parts.push(
      `${f.undelivered} crash occurrence${f.undelivered === 1 ? "" : "s"} not accepted — ${
        CRASH_REFUSAL_TEXT[f.lastRefusal.reason]
      }`,
    );
  } else if (f.held > 0) {
    // Held, with nothing refused: captured and waiting to be offered. Said as
    // plainly as a refusal, because to whoever is reading a crash count they
    // amount to the same thing — a crash that has not been counted.
    parts.push(
      `${f.held} crash occurrence${f.held === 1 ? "" : "s"} captured and not yet delivered to Boosthis`,
    );
  }
  if (f.refiledUnderSuccessor > 0) {
    parts.push(
      `${f.refiledUnderSuccessor} crash occurrence${
        f.refiledUnderSuccessor === 1 ? " is" : "s are"
      } filed under this install rather than the earlier install that crashed`,
    );
  }
  if (f.abruptEndingsThisLaunch > 0) {
    parts.push(
      `the previous run ended with no code of ours running (a kill, an out-of-memory stop or an interrupt)`,
    );
  }
  return parts.join("; ");
}

/** @internal Test hook — forget everything, including the once-per-cause
 *  latches. Does not touch the store; a test that needs a clean store clears
 *  the key itself. */
export function _resetCrashDeliveryForTests(): void {
  seenIdentities = null;
  heldReader = null;
  refiledUnderSuccessor = 0;
  keepFailures = 0;
  keepFailureCause = null;
  deliveredOccurrences = 0;
  undeliveredOccurrences = 0;
  lastRefusal = null;
  pendingRefusal = null;
  abruptThisLaunch = 0;
  abruptTotal = 0;
  abruptLastAt = null;
  runOpened = false;
  announced.clear();
}

/** @internal The store key and owner id, for tests and the live proof. */
export const _crashDeliveryInternals = {
  STORAGE_KEY,
  OWNER_ID,
  ownerHost: () => OWNER_HOST,
  runOpened: () => runOpened,
};

function heldOccurrences(): number {
  try {
    const n = heldReader?.() ?? 0;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/**
 * A crash of a PREVIOUS install could not be filed as that install — its
 * credential is no longer accepted — so it was filed under the install that
 * replaced it. Better than losing it, worse than filing it correctly, and
 * never silent.
 */
export function noteCrashRefiledUnderSuccessor(occurrences: number): void {
  try {
    const n =
      Number.isFinite(occurrences) && occurrences > 0
        ? Math.floor(occurrences)
        : 1;
    refiledUnderSuccessor += n;
    say(
      "refiled",
      "A crash from an earlier run of this app could not be filed under the " +
        "install that crashed — that install's credential is no longer " +
        "accepted — so it is filed under the install running now. The crash " +
        "is reported; the install it is attached to is the successor.",
    );
  } catch {
    /* best effort */
  }
}

/** Crash occurrences re-filed under the install that REPLACED the one that
 *  crashed, because the crashing install's credential was no longer accepted.
 *  Counted so the misattribution is stated rather than assumed. */
let refiledUnderSuccessor = 0;
