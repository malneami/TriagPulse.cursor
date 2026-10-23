/* ─── Boosthis: privacy-safe crash reporter (Node) ───────────────────
 *
 * Faithful port of `lib/boosthis-runtime-rn/src/crashReporter.ts`, adapting
 * ONLY the install layer to Node. Captures REAL uncaught crashes from the host
 * process and turns each one into a tiny, scrubbed fingerprint that is safe to
 * send off-process. This is NOT a perf checklist rule — it is a separate
 * always-on channel (for registered apps) that installs once from
 * `enableTelemetry` and reports on its own. Nothing here runs as an import
 * side-effect; `installCrashHandlers()` must be called explicitly.
 *
 * INSTALL LAYER — Node-specific, guest-code-safe:
 * We hook ONLY `process.on('uncaughtExceptionMonitor', (err, origin) => …)`.
 * The `uncaughtExceptionMonitor` event is a passive MONITOR: unlike an
 * `'uncaughtException'` or `'unhandledRejection'` listener, it does NOT suppress
 * Node's default crash behavior — after our monitor runs, Node still prints the
 * stack and exits exactly as it would with no Boosthis present. We therefore
 * NEVER add an `'uncaughtException'` or `'unhandledRejection'` listener, because
 * doing so would silence the host's crash flow (a drop-in library must not change
 * host behavior). `origin` is `'uncaughtException' | 'unhandledRejection'`, which
 * we map into the server's closed crash-kind enum
 * (`uncaught | unhandledRejection | render`).
 *
 * PRIVACY: the DEFAULT payload carries only the error type, a hashed signature,
 * a redacted top frame, and a bucketed count — never source, values, or PII.
 * OPT-IN detailed mode (per app) additionally carries a PII-scrubbed first
 * message line (`summary`) and sanitized stack `frames` (function + file
 * BASENAME + line/col — absolute paths, URLs, query strings and arguments are
 * stripped in-process). `summary` and any frame that trips the PII guard are
 * dropped individually so the rest of the crash still reports. The field names
 * deliberately avoid the PII denylist (no `message`/`text`/`body`).
 *
 * Crash-safety: every entry point is wrapped in try/catch so a bug in the
 * reporter itself can never crash the host, and the monitor handler NEVER
 * throws (Node treats a throw from the monitor as fatal). The capture/flush path
 * persists pending crashes SYNCHRONOUSLY (fs.writeFileSync via storage) so a
 * FATAL crash (which kills the process before the network flush completes) is
 * still reported on the next launch.
 */

import { hostname } from "node:os";

import {
  beginRun,
  endRun,
  hasRunAs,
  noteCarriedCrashes,
  noteCrashDelivered,
  noteCrashDeliveryRefused,
  noteCrashesGivenUp,
  noteCrashKeepFailed,
  noteCrashOccurred,
  noteCrashRefiledUnderSuccessor,
  takeCrashSendRefusal,
  useHeldCrashReader,
} from "./crashDelivery";
import { isBoosthisDisabled } from "./runtimeFlags";
import { currentAction, errorAction } from "./spanScope";
import {
  currentFailurePart,
  FAILURE_PART_UNKNOWN,
  type FailurePartUnknown,
} from "./failurePart";
import { checkNoPII } from "./no-pii";
import {
  eraseCrashState,
  processLiveness,
  processLivenessMark,
  storage,
  storageDurable,
  withCrashGeneration,
} from "./storage";

/** Persisted-pending crash buffer key. Mirrors the RN store key. */
const STORAGE_KEY = "boosthis:crash-pending:v1";
/** Bound the in-memory + persisted crash set so a pathological app that throws
 *  a unique error class on every tick can never grow memory/storage without
 *  limit. Distinct crash SIGNATURES (not crash frequency) are what counts. */
const MAX_CRASHES = 200;
/** Server caps a batch at 50 reports (CrashBatch.maxItems). */
const MAX_BATCH = 50;
/** Server caps a single signature's occurrences at 100000. */
const MAX_OCCURRENCES = 100000;
/** Server caps detailed frames at 20 (CrashReport.frames.maxItems). */
const MAX_FRAMES = 20;
/** The server keeps crash receipts for 30 days (`CRASH_DELIVERY_KEEP_DAYS` in
 *  lib/db/src/schema/crashDeliveries.ts). A kept crash whose latest occurrence
 *  is older than that is removed unsent: a retry the server no longer holds a
 *  receipt for would be counted twice. */
const CRASH_RECEIPT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** Where the kit caught the error.
 *
 *  `job` is a BACKGROUND JOB RUN that threw — a queue consumer, a scheduled
 *  task, a nightly import. It has no request behind it and the queue library
 *  normally swallows it into its own retry bookkeeping, so without this kind a
 *  job that crashes every night would be reported nowhere at all. It is
 *  captured by the job wrapper, exactly as `render` is captured by RN's error
 *  boundary, and is fingerprinted, redacted, bucketed and batched through the
 *  identical path a request crash takes. */
export type CrashKind = "uncaught" | "unhandledRejection" | "render" | "job";

/** One sanitized stack frame (opt-in detailed mode only). */
export interface CrashFrameData {
  func: string;
  file: string;
  line?: number;
  column?: number;
}

/** Privacy-safe crash fingerprint. Shape matches the OpenAPI `CrashReport`
 *  schema (camelCase on the wire). NEVER carries source code, user values, or
 *  PII. */
export interface CrashReportPayload {
  signature: string;
  errorName: string;
  kind: CrashKind;
  redactedFrame: string;
  countBucket: string;
  occurrences: number;
  /** OPT-IN ONLY. PII-scrubbed first message line. */
  summary?: string;
  /** OPT-IN ONLY. Sanitized stack frames. */
  frames?: CrashFrameData[];
  /** The ACTION this crash happened in: the 32-hex trace id, and the 16-hex
   *  id of the call that was open. Both are omitted when the kit held no
   *  action at that moment — an omitted key means "no action recorded", which
   *  is not the same as "happened outside any action", and the server never
   *  invents one. Neither is screen-bearing: both are random correlation tags
   *  and neither can carry a value from the app. */
  traceId?: string;
  spanId?: string;
  /** WHERE it happened — the route the request in flight was being served on,
   *  as `METHOD /template`, through the one part-name rule. Exactly one of
   *  these two is ever set: the part when the kit could name it, the term
   *  when it looked and could not. Both omitted is a third answer this kit no
   *  longer gives; the two ids above answer a different question and never
   *  stand in for either. See `failurePart.ts`. */
  routeLabel?: string;
  partUnknown?: FailurePartUnknown;
  /** The first frame in the app's OWN code, when the top frame is in a
   *  dependency or in Node itself — the line of the app that led there. Same
   *  redacted shape as `redactedFrame` (function, file basename, line), sent in
   *  every mode, omitted when the top frame is the app's or no kept frame is.
   *  Which paths count as the app's is decided on the device from the full
   *  path, which never leaves it. Server cap: 160 characters. */
  appFrame?: string;
  /** WHEN the latest occurrence happened, in epoch ms on this machine's clock.
   *  A crash delivered by a later launch is dated to the death, not to the
   *  delivery; the server ignores a value it cannot believe and dates that
   *  crash by arrival instead. */
  occurredAt?: number;
}

/** WHO A BATCH IS FILED AS.
 *
 *  A crash buffered by a process that then died is replayed by whatever
 *  replaced it — and several kits mint a fresh install id when a service
 *  restarts, so the replaying process may hold a different identity. Sending
 *  the batch under the successor's credential files A's crash against B: the
 *  install that actually crashed keeps a clean record and the one that did not
 *  crash carries it. So the identity a crash was captured under travels with
 *  the crash — the install id AND the credential that authenticates it — and
 *  the replay files it as the install that crashed. */
export interface CrashSendIdentity {
  installId: string;
  credential: string;
}

/** Network submitter wired by the telemetry client (→ `transmitCrashes`).
 *  Registered on `enableTelemetry`, cleared on `forget()`. `as` is set only
 *  when replaying a crash captured under an identity this process no longer
 *  holds. */
export type CrashSubmitter = (
  crashes: readonly CrashReportPayload[],
  as?: CrashSendIdentity,
) => Promise<number>;

interface CrashEntry {
  signature: string;
  errorName: string;
  kind: CrashKind;
  redactedFrame: string;
  summary?: string;
  frames?: CrashFrameData[];
  /** The action the LAST occurrence of this signature happened in, when one
   *  was open. Absent means no occurrence has been able to name one. */
  traceId?: string;
  spanId?: string;
  /** Where the LAST occurrence of this signature happened. One or the other,
   *  never both, and a later occurrence that could name a part replaces a
   *  term an earlier one left. */
  routeLabel?: string;
  partUnknown?: FailurePartUnknown;
  /** The app's own frame of the LAST occurrence. Its function and file are part
   *  of the signature, so occurrences of one entry differ at most in its line;
   *  an occurrence that carries none clears it. */
  appFrame?: string;
  /** Lifetime occurrences observed (across restored sessions); drives the
   *  bucketed count. */
  sessionTotal: number;
  /** Occurrences not yet acknowledged by the server (the delta the process
   *  sends; the server ADDS it to the row's lifetime total). */
  unsent: number;
  lastSeen: number;
  /** Set ONLY on a crash claimed from a process that reported under another
   *  install: the identity it must be filed as. Never reaches the payload. */
  sendAs?: CrashSendIdentity;
  /** Restored from an earlier run, so this process's own crash count does not
   *  cover it. Derived at restore; never persisted, never sent. */
  fromEarlierRun?: true;
  /** This occurrence is already written into the durable crash history, so the
   *  verdict keeps answering for it after delivery empties this buffer.
   *  PERSISTED, and absent on a crash buffered by a kit old enough to have kept
   *  no history — that one is imported once, by the launch that adopts it, and
   *  marked here so no later launch counts it twice. Never sent. */
  noted?: true;
  /** Occurrences that were taken off a predecessor's identity because its
   *  credential was refused, and are now waiting to be filed under this
   *  install. Announced when the server ACCEPTS them, never before. */
  refiledPending?: number;
}

/** The buffer's key: the identity a crash must be filed as, then its signature.
 *
 *  A signature alone was not enough, and the case it lost is the one this whole
 *  area exists for. A crash-looping service repeats the SAME error, so the
 *  crash restored from the dead process and the crash this process has just
 *  suffered share a signature — they collided in the buffer, and the merged
 *  entry kept the predecessor's identity. Both occurrences were then filed
 *  against the install that died and the install that is dying right now read
 *  perfectly clean. */
function bufferKey(signature: string, installId?: string | null): string {
  // U+001F (unit separator) can appear in neither an install id nor a
  // signature, so no pair of values can spell another pair's key.
  return installId ? `${installId}\u001f${signature}` : signature;
}

/** The key an entry already in the buffer is stored under. */
function keyOf(e: CrashEntry): string {
  return bufferKey(e.signature, e.sendAs?.installId);
}

/** Is this value one of the three words a kit may use for "we looked and
 *  could not tell"? Asked of anything read back off the customer's disk: a
 *  buffered crash file is a local file, and the closed vocabulary is only
 *  closed if the restore re-checks it rather than trusting what it finds. */
function isRestoredUnknownTerm(v: unknown): v is FailurePartUnknown {
  return (
    v === FAILURE_PART_UNKNOWN.noPartOpen ||
    v === FAILURE_PART_UNKNOWN.notTracked ||
    v === FAILURE_PART_UNKNOWN.refused
  );
}

/** Is this an app frame the kit could have written? Asked of a value read back
 *  off the customer's disk before it can reach the wire: a string within the
 *  server's cap that passes the same privacy screen it met at capture. */
function isRestoredAppFrame(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= 160 &&
    checkNoPII({ appFrame: v }) === null
  );
}

/** The `uncaughtExceptionMonitor` listener signature: `(error, origin)`. We
 *  accept the widest types so a poisoned throw can never break the boundary. */
type MonitorListener = (err: unknown, origin: unknown) => void;

let activeSubmitter: CrashSubmitter | null = null;
let active = false;
let detailedMode = false;
let monitorListener: MonitorListener | null = null;
let restoredOnce = false;
/** Count of crashes captured this session (uncaught / unhandledRejection /
 *  render). Read by the crashFree meter axis; zeroed on forget()/reset. */
let crashTotal = 0;
/** Reads the credential THIS process authenticates with. Registered by the
 *  telemetry client, which owns the token and rotates it; asking rather than
 *  being told means a rotation can never leave a stale copy behind. */
let credentialReader: (() => string | null) | null = null;

const pending = new Map<string, CrashEntry>();

/** Register the crash auto-submitter. Pass `null` to clear (on opt-out). */
export function setCrashSubmitter(submitter: CrashSubmitter | null): void {
  const arrived = submitter !== null && activeSubmitter !== submitter;
  activeSubmitter = submitter;
  // A CRASH MAY ALREADY BE WAITING FOR EXACTLY THIS. A crash restored at boot
  // is offered the moment the handlers go on, which can be before anything is
  // able to upload it at all — and the arrival of a submitter is the first
  // moment delivery becomes possible. Without this the buffer waits for the
  // retry ladder's next rung, and if the ladder was never armed (nothing to
  // send at the time, or no submitter to send it with) it waits for the app to
  // crash again. Guarded by `active`, so a submitter registered before the kit
  // is installed simply arms nothing: there is no buffer yet to send.
  if (arrived && active && pending.size > 0 && !isBoosthisDisabled()) {
    scheduleFlush();
  }
}

/**
 * Register a reader for the credential this process authenticates with.
 *
 * It is stamped on every crash this process persists, so that if this process
 * dies, whatever replaces it can file those crashes AS THIS INSTALL — even when
 * the replacement registered under a new install id. Asked for rather than
 * handed over, so a rotated token is never persisted stale. Pass `null`
 * (forget/opt-out) to stop new crashes carrying one.
 */
export function setCrashCredentialReader(
  read: (() => string | null) | null,
): void {
  credentialReader = read;
}

function ownCredential(): string | null {
  try {
    const v = credentialReader?.();
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

/* ─── Redaction helpers ──────────────────────────────────────────── */

/** Cheap stable djb2 hash. Input is already redacted/non-reversible content;
 *  the output is used purely to GROUP identical crash classes — it carries no
 *  recoverable user data. */
function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (h * 33) ^ input.charCodeAt(i);
  return (h >>> 0).toString(36);
}

/** Coarse, privacy-safe occurrence bucket. Always <= 12 chars (server cap). */
function bucketCount(n: number): string {
  if (n <= 1) return "1";
  if (n <= 5) return "2-5";
  if (n <= 20) return "6-20";
  if (n <= 100) return "21-100";
  return "100+";
}

/** Reduce a possibly-non-Error throw to an Error-like shape. */
function toError(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  if (error && typeof error === "object") {
    const o = error as { name?: unknown; message?: unknown; stack?: unknown };
    return {
      name: typeof o.name === "string" ? o.name : "Error",
      message: typeof o.message === "string" ? o.message : String(error),
      stack: typeof o.stack === "string" ? o.stack : undefined,
    };
  }
  return {
    name: "Error",
    message: typeof error === "string" ? error : String(error),
  };
}

/** Keep only identifier characters so an error NAME can never carry an
 *  email/path/URL/value. Class names are code-defined; anything else is
 *  collapsed to "Error". */
function sanitizeErrorName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_$]/g, "").slice(0, 80);
  return cleaned.length > 0 ? cleaned : "Error";
}

/** Reduce a file path/URL to its bare basename, dropping directories, URL
 *  scheme/host, query strings, and fragments. */
function fileBasename(raw: string): string {
  let s = raw;
  const q = s.search(/[?#]/);
  if (q >= 0) s = s.slice(0, q);
  // Normalize both separators, take the last segment.
  const segs = s.split(/[\\/]/);
  s = segs[segs.length - 1] ?? "";
  s = s.trim().slice(0, 120);
  return s.length > 0 ? s : "<unknown>";
}

interface RawFrame {
  func: string;
  file: string;
  line?: number;
  column?: number;
  /** The location exactly as the stack wrote it, BEFORE it is cut to a
   *  basename. Never sent, never stored, never screened as a value: it only
   *  decides whether the frame is in the app's own code (`isOwnCodePath`). */
  path: string;
}

/** A location that is a file on this machine's disk, written the way a stack
 *  writes one on any operating system: a POSIX absolute path, a Windows drive
 *  path (either letter case, either separator), a UNC share or a `\\?\` long
 *  path, or a `file://` address (which is how an ES module's frames read).
 *  Everything else — `node:` and `internal/` modules, `<anonymous>`, `native`,
 *  `eval at …`, `evalmachine.<anonymous>`, `index 0`, a bare name, any other
 *  scheme — is not a file the app wrote. */
const ON_DISK = /^(?:\/|[A-Za-z]:[\\/]|\\\\|file:\/\/)/i;
/** Code someone else wrote, however the package manager laid it out (npm,
 *  pnpm's `.pnpm` store, Yarn's cache and unplugged folders, a global install
 *  all sit under a `node_modules` segment). */
const DEPENDENCY_SEGMENT = /(?:^|[\\/])node_modules(?:[\\/]|$)/i;
/** This kit's own two packages, at the paths the install guide writes them to.
 *  A `file:` dependency resolves through a symlink to its real path, so these
 *  frames carry no `node_modules` segment and must be named. */
const KIT_SEGMENT = /(?:^|[\\/])(?:boosthis-runtime-node|boosthis-checklist)(?:[\\/]|$)/i;

/** True when the frame's location is a file of the app's own: on disk, and in
 *  neither a dependency nor this kit. Decided here, on the device, because only
 *  here is the full path known; it never leaves the process. */
function isOwnCodePath(path: string): boolean {
  const p = path.trim();
  return ON_DISK.test(p) && !DEPENDENCY_SEGMENT.test(p) && !KIT_SEGMENT.test(p);
}

/** The first frame in the app's own code, when the top frame is not in it — a
 *  crash thrown inside a library, a driver or Node itself. Null when the top
 *  frame IS the app's (there is nothing to add) or when no frame the runtime
 *  kept is (Node keeps ten frames by default; the kit never changes that). The
 *  top frame stays the true top either way. */
function firstAppFrame(frames: readonly RawFrame[]): RawFrame | null {
  const top = frames[0];
  if (!top || isOwnCodePath(top.path)) return null;
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i]!;
    if (isOwnCodePath(f.path)) return f;
  }
  return null;
}

/** Parse a JS error stack into frames, handling both the V8/Hermes
 *  ("at fn (file:line:col)" / "at file:line:col") and JSC/Safari
 *  ("fn@file:line:col") formats. File paths are reduced to basenames here so
 *  no absolute path or URL ever reaches a sent field; the raw location rides
 *  beside it only as far as the own-code judgement, and no payload copies it. */
function parseStack(stack: string | undefined): RawFrame[] {
  if (!stack || typeof stack !== "string") return [];
  const frames: RawFrame[] = [];
  const lines = stack.split("\n");
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) continue;
    let func = "<anonymous>";
    let loc = "";
    const v8 = line.match(/^at\s+(.*?)\s+\((.*)\)$/);
    if (v8) {
      func = v8[1] ?? "<anonymous>";
      loc = v8[2] ?? "";
    } else {
      const v8NoFn = line.match(/^at\s+(.*)$/);
      const jsc = line.match(/^(.*?)@(.*)$/);
      if (v8NoFn) {
        loc = v8NoFn[1] ?? "";
      } else if (jsc) {
        func = jsc[1] && jsc[1].length > 0 ? jsc[1] : "<anonymous>";
        loc = jsc[2] ?? "";
      } else {
        continue;
      }
    }
    // loc is "<path>:<line>:<col>" — split trailing :line:col off the path.
    let file = loc;
    let lineNo: number | undefined;
    let colNo: number | undefined;
    const m = loc.match(/^(.*):(\d+):(\d+)$/) ?? loc.match(/^(.*):(\d+)$/);
    if (m) {
      file = m[1] ?? loc;
      lineNo = clampInt(m[2]!);
      colNo = m[3] !== undefined ? clampInt(m[3]) : undefined;
    }
    func = func
      .replace(/[^A-Za-z0-9_$.<>\s]/g, "")
      .trim()
      .slice(0, 120);
    if (func.length === 0) func = "<anonymous>";
    frames.push({
      func,
      file: fileBasename(file),
      line: lineNo,
      column: colNo,
      path: file,
    });
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames;
}

function clampInt(s: string): number | undefined {
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.min(n, 100_000_000);
}

function formatRedactedFrame(top: RawFrame | undefined): string {
  if (!top) return "<unknown>";
  const lineSuffix = top.line !== undefined ? `:${top.line}` : "";
  return `${top.func} (${top.file}${lineSuffix})`.slice(0, 160);
}

/** First line of the error message, scrubbed: dropped entirely if it trips the
 *  PII guard (email/JWT/bearer/IP/phone). Returns undefined when there is
 *  nothing safe to keep. */
function sanitizeSummary(message: string): string | undefined {
  const first = message.split(/\r?\n/)[0]?.trim().slice(0, 300);
  if (!first) return undefined;
  if (checkNoPII(first) !== null) return undefined;
  return first;
}

interface RedactedCrash {
  signature: string;
  errorName: string;
  kind: CrashKind;
  redactedFrame: string;
  /** The first frame in the app's own code, in the top frame's redacted shape,
   *  when the top frame is not the app's. Sent in every mode, like the top. */
  appFrame?: string;
  summary?: string;
  frames?: CrashFrameData[];
}

/** Turn a raw throw into the closed, PII-safe crash shape. Detailed fields are
 *  added only when `detailedMode` is on and they pass the PII guard. */
function redactError(error: unknown, kind: CrashKind): RedactedCrash {
  const err = toError(error);
  const errorName = sanitizeErrorName(err.name);
  const frames = parseStack(err.stack);
  const top = frames[0];
  const redactedFrame = formatRedactedFrame(top);
  // The signature is ALWAYS sent (even in default mode), so its basis must never
  // contain user values. A redacted top frame is code-defined (function + file
  // basename + line) and safe; when there is NO frame (stackless Error or a
  // non-Error throw) we fall back to ONLY code-defined tokens — the sanitized
  // error name, the crash kind, and a constant marker — and NEVER the raw error
  // message, which could carry an email/token/user value that would otherwise
  // leave the process as a deterministic hash.
  let basis = top ? redactedFrame : `${errorName}|${kind}|<no-frame>`;
  // WHICH OF THE APP'S LINES LED HERE, when the top frame is in a dependency or
  // in Node itself. Same redacted shape as the top frame (function, file
  // basename, line), and the same privacy screen every sent string meets: a
  // frame the screen refuses is simply not sent, and the crash is reported
  // exactly as it was before this fact existed. Its function and FILE join the
  // signature only when it is sent — two app lines calling the same library
  // line are two crashes — and its line never does, so an edit that only moves
  // the line keeps the crash (docs/crash-identity.md, "Origin facts").
  const app = firstAppFrame(frames);
  const appFrameText = app ? formatRedactedFrame(app) : undefined;
  const appFrame =
    appFrameText !== undefined && checkNoPII({ appFrame: appFrameText }) === null
      ? appFrameText
      : undefined;
  if (app && appFrame !== undefined) basis = `${basis}|app:${app.func}@${app.file}`;
  const signature = `${errorName}:${hash(basis)}`.slice(0, 120);
  const out: RedactedCrash = { signature, errorName, kind, redactedFrame };
  if (appFrame !== undefined) out.appFrame = appFrame;
  if (detailedMode) {
    const summary = sanitizeSummary(err.message);
    if (summary) out.summary = summary;
    // Drop any individual frame that trips the PII guard rather than the whole
    // crash; func/file are sanitized above, so this is belt-and-braces. The
    // screen reads the frame as it would be SENT — never the raw location kept
    // for the own-code judgement, which no payload carries.
    const safeFrames = frames
      .slice(0, MAX_FRAMES)
      .map((f) => {
        const fr: CrashFrameData = { func: f.func, file: f.file };
        if (f.line !== undefined) fr.line = f.line;
        if (f.column !== undefined) fr.column = f.column;
        return fr;
      })
      .filter((fr) => checkNoPII(fr) === null);
    if (safeFrames.length > 0) out.frames = safeFrames;
  }
  return out;
}

/* ─── Capture + flush ────────────────────────────────────────────── */

/** Record one crash. Idempotent-safe and never throws (fully guarded). No-op
 *  until `installCrashHandlers()` has run, so the reporter has zero effect on
 *  apps that never enabled telemetry, and a no-op under the kill-switch. */
function capture(error: unknown, kind: CrashKind): void {
  try {
    if (!active || isBoosthisDisabled()) return;
    if (withCrashGeneration(() => true) !== true) {
      pending.clear();
      noteCrashKeepFailed(storageDurable() ? "write-failed" : "storage-not-durable");
      return;
    }
    crashTotal += 1;
    const r = redactError(error, kind);
    const now = Date.now();
    // WHICH ACTION THIS HAPPENED IN, when the kit actually holds one. Read
    // from the ambient span scope, which is synchronous by design, so it can
    // only ever name a call genuinely open on this stack. Most uncaught
    // exceptions in Node arrive from an async callback with no scope open, and
    // then this is null — reported as "no action recorded", never guessed at
    // from whatever request happened to be in flight.
    //
    // Second source, same fact: an action written ONTO THE ERROR by the
    // request middleware on its way out. A synchronous scope is unwound by
    // the throw itself — every `finally` between the throw site and here has
    // already run — so a handler crash the kit genuinely knew the action for
    // would otherwise arrive with nothing. The error object is what survives
    // that journey. Ambient first (it is the closest frame to the throw); the
    // stamp only fills a gap, and both are shape-checked before use.
    const at = currentAction() ?? errorAction(error);
    // WHERE this crash happened, read NOW, on the same synchronous path as
    // the action above. `at` names an operation and never a place; this names
    // the place and never an operation. Both travel, neither substitutes.
    const where = currentFailurePart();
    // This process's own crash, always under its own identity — never folded
    // into a predecessor's entry of the same shape.
    const existing = pending.get(bufferKey(r.signature));
    if (existing) {
      existing.sessionTotal = Math.min(
        existing.sessionTotal + 1,
        MAX_OCCURRENCES,
      );
      existing.unsent = Math.min(existing.unsent + 1, MAX_OCCURRENCES);
      existing.kind = r.kind;
      existing.errorName = r.errorName;
      existing.redactedFrame = r.redactedFrame;
      // The newest occurrence's own frame, or none: the server overwrites the
      // origin facts together from the newest report, and so does this.
      existing.appFrame = r.appFrame;
      existing.lastSeen = now;
      existing.noted = true;
      if (r.summary !== undefined) existing.summary = r.summary;
      if (r.frames !== undefined) existing.frames = r.frames;
      // A later occurrence that DOES know its action names it; one that does
      // not leaves the last known action alone rather than wiping it. Same
      // rule the server applies when it merges reports of one signature.
      if (at !== null) {
        existing.traceId = at.traceId;
        existing.spanId = at.spanId;
      }
      // WHERE, read at this occurrence's own moment of capture — never the
      // part an earlier occurrence was in. A named part replaces whatever
      // stood before it; a term replaces only another term, so one crash the
      // kit could place is not overwritten by a later one it could not.
      if (where.routeLabel !== undefined) {
        existing.routeLabel = where.routeLabel;
        existing.partUnknown = undefined;
      } else if (existing.routeLabel === undefined) {
        existing.partUnknown = where.partUnknown;
      }
    } else {
      pending.set(bufferKey(r.signature), {
        signature: r.signature,
        errorName: r.errorName,
        kind: r.kind,
        redactedFrame: r.redactedFrame,
        ...(r.appFrame !== undefined ? { appFrame: r.appFrame } : {}),
        summary: r.summary,
        frames: r.frames,
        sessionTotal: 1,
        unsent: 1,
        lastSeen: now,
        noted: true,
        ...(at !== null ? { traceId: at.traceId, spanId: at.spanId } : {}),
        ...where,
      });
      evictIfNeeded();
    }
    // Record it as EVIDENCE FIRST, on the same synchronous path. The buffer
    // above is a delivery queue — it empties the moment the server accepts a
    // crash. The crash-free verdict has to keep answering for that crash for as
    // long as its window says it does, and across the restart that a fatal one
    // causes, so it cannot read the queue and it cannot read a counter this
    // process holds in memory. See CRASH_HISTORY_WINDOW_MS.
    //
    // Evidence before queue, because the entry we are about to persist says the
    // history already holds it: a kill landing between these two writes must
    // leave the verdict over-informed (a crash recorded that was never sent),
    // never under-informed (a crash sent that nothing remembers).
    //
    // And the marker follows what the history ACTUALLY took. Storage writes are
    // best-effort and silent about failing, so an unwritable state directory
    // would otherwise leave a queued crash stamped "the history has this" while
    // no history has it — delivery empties the queue, the next launch skips
    // adoption because of that stamp, and the crash is gone from every reading.
    // A failed write therefore un-marks the entry: the same over-informed
    // direction as above, since a re-adopted occurrence is counted twice at
    // worst, where the alternative loses it entirely.
    if (!noteCrashOccurred(now)) {
      const e = pending.get(bufferKey(r.signature));
      if (e) delete e.noted;
    }
    // Persist SYNCHRONOUSLY so a FATAL crash that kills the process before the
    // network flush completes is still reported on the next launch.
    persist();
    scheduleFlush();
  } catch {
    // The reporter must NEVER throw — a bug here can't be allowed to crash the
    // host process (and, when called from the monitor, a throw would be fatal).
  }
}

/** Public entry for a Boosthis-internal render throw (SDK-internal). Kept for
 *  cross-runtime parity with RN's error boundary; tagged `kind: "render"`. */
export function reportRenderError(error: unknown): void {
  capture(error, "render");
}

/** A background job run threw. Reported exactly as clearly as a crash inside a
 *  request — same signature, same redaction, same bucketed batch — because the
 *  queue library that catches it will otherwise leave it invisible. Called by
 *  the job wrapper; never by the host directly. */
export function reportJobError(error: unknown): void {
  capture(error, "job");
}

/** Keep the crash set bounded: evict the least-recently-seen entries that have
 *  nothing left to send. */
function evictIfNeeded(): void {
  if (pending.size <= MAX_CRASHES) return;
  const sortable = [...pending.values()].sort((a, b) => a.lastSeen - b.lastSeen);
  for (const e of sortable) {
    if (pending.size <= MAX_CRASHES) break;
    if (e.unsent <= 0) pending.delete(keyOf(e));
  }
  // If everything still has unsent work, drop oldest regardless to honor the cap.
  while (pending.size > MAX_CRASHES) {
    const oldest = sortable.shift();
    if (!oldest) break;
    pending.delete(keyOf(oldest));
  }
}

/** The pass currently running, so a second caller can WAIT for it rather than
 *  being handed a resolved promise that means nothing. */
let inFlight: Promise<void> | null = null;
let flushQueued = false;

/**
 * How long to wait before OFFERING A HELD CRASH AGAIN.
 *
 * A crash restored from disk is flushed the moment the handlers go on — which
 * is before registration has answered and while the launch check-in still has
 * the kit locked, so the upload path opens no socket and the flush drains
 * nothing. Nothing then retried: the buffer sat there until the app happened
 * to crash again, which is why a report that survived the crash still never
 * arrived. The same hole swallows every temporary refusal — an unreachable
 * server, a rate limit, a 5xx.
 *
 * So a flush that hands nothing over asks again, on a widening ladder that
 * settles at half-hourly. Every timer is `unref`'d: a kit may never be the
 * reason a process stays alive.
 */
const RETRY_LADDER_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000];
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryStep = 0;

function clearRetry(): void {
  if (retryTimer) {
    try {
      clearTimeout(retryTimer);
    } catch {
      /* nothing to undo */
    }
    retryTimer = null;
  }
}

function scheduleRetry(): void {
  try {
    if (retryTimer || !active || !activeSubmitter || isBoosthisDisabled()) {
      return;
    }
    if (pendingCrashOccurrences() <= 0) return;
    const delay =
      RETRY_LADDER_MS[Math.min(retryStep, RETRY_LADDER_MS.length - 1)]!;
    retryStep += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      scheduleFlush();
    }, delay);
    (retryTimer as unknown as { unref?: () => void }).unref?.();
  } catch {
    /* a retry that cannot be armed is a crash that waits, never a throw */
  }
}

function scheduleFlush(): void {
  void flush().catch(() => {
    // flush() is self-guarded; this is belt-and-braces so a rejected promise
    // never becomes an unhandled rejection.
  });
}

/** Build one batch for ONE identity: the crashes this process must file as
 *  itself (`as === null`), or those it is carrying for a predecessor. Mixing
 *  them in one request is not possible — a request carries one install id and
 *  one credential — and mixing them in one payload would file a dead install's
 *  crash under a live one. */
const refusedCrashKeys = new Set<string>();
function buildBatch(
  as: CrashSendIdentity | null = null,
  excluded = new Set<string>(),
  retrying?: boolean,
): CrashReportPayload[] {
  const batch: CrashReportPayload[] = [];
  for (const e of pending.values()) {
    if (e.unsent <= 0) continue;
    const key = bufferKey(e.signature, as?.installId);
    if (excluded.has(key)) continue;
    if (retrying !== undefined && refusedCrashKeys.has(key) !== retrying) continue;
    if ((e.sendAs?.installId ?? null) !== (as?.installId ?? null)) continue;
    const item: CrashReportPayload = {
      signature: e.signature,
      errorName: e.errorName,
      kind: e.kind,
      redactedFrame: e.redactedFrame,
      countBucket: bucketCount(e.sessionTotal),
      occurrences: Math.min(e.unsent, MAX_OCCURRENCES),
    };
    // Part of the batch's bytes, so the delivery id derived from them stays
    // the same across retries of an unchanged entry.
    if (Number.isFinite(e.lastSeen)) item.occurredAt = Math.floor(e.lastSeen);
    // Only when the kit found one: an omitted key is "the top frame is the
    // app's, or no kept frame was", and the server stores no app frame.
    if (e.appFrame !== undefined) item.appFrame = e.appFrame;
    if (e.summary !== undefined) item.summary = e.summary;
    if (e.frames !== undefined) item.frames = e.frames;
    // Added only when present: a crash the kit could not place in an action
    // sends the keys it always did, and the server reads that as "no action
    // recorded" rather than as an action of its own.
    if (e.traceId !== undefined) item.traceId = e.traceId;
    if (e.spanId !== undefined) item.spanId = e.spanId;
    // WHERE, beside them and never instead of them. One of the two, never
    // both: a named part and a term saying we could not name one are answers
    // to the same question and the name is the better one.
    if (e.routeLabel !== undefined) item.routeLabel = e.routeLabel;
    else if (e.partUnknown !== undefined) item.partUnknown = e.partUnknown;
    batch.push(item);
    if (batch.length >= MAX_BATCH) break;
  }
  return batch;
}

/** Bank an ACCEPTED batch against the identity it was sent under. Returns the
 *  occurrences among them that had been moved off a predecessor's identity, so
 *  that re-filing is announced when it has actually happened. */
function applySent(
  batch: readonly CrashReportPayload[],
  as: CrashSendIdentity | null,
): number {
  let refiled = 0;
  for (const sent of batch) {
    const cur = pending.get(bufferKey(sent.signature, as?.installId));
    if (!cur) continue;
    // Subtract only what we sent; any crashes that arrived while the request
    // was in flight remain queued for the next flush.
    cur.unsent = Math.max(0, cur.unsent - sent.occurrences);
    if (cur.refiledPending) {
      const landed = Math.min(cur.refiledPending, sent.occurrences);
      cur.refiledPending -= landed;
      if (cur.refiledPending <= 0) delete cur.refiledPending;
      refiled += landed;
    }
  }
  return refiled;
}

/** The identities with something waiting: this process's own first, then each
 *  predecessor whose crash it is carrying. Bounded, so a machine full of dead
 *  workers cannot turn one flush into a hundred requests. */
const MAX_IDENTITIES_PER_FLUSH = 3;

function pendingIdentities(): (CrashSendIdentity | null)[] {
  const out: (CrashSendIdentity | null)[] = [];
  const others = new Map<string, CrashSendIdentity>();
  let own = false;
  for (const e of pending.values()) {
    if (e.unsent <= 0) continue;
    if (!e.sendAs) {
      own = true;
      continue;
    }
    if (!others.has(e.sendAs.installId)) others.set(e.sendAs.installId, e.sendAs);
  }
  if (own) out.push(null);
  out.push(...[...others.values()].slice(0, MAX_IDENTITIES_PER_FLUSH));
  return out;
}

/** Offer one identity's batch. Returns what is still unsent for it. */
let stopCrashPass = false;
async function offer(as: CrashSendIdentity | null, batch = buildBatch(as)): Promise<number> {
  const submitter = activeSubmitter;
  if (!submitter) return 0;
  if (batch.length === 0) return 0;
  const occurrences = batch.reduce((n, b) => n + b.occurrences, 0);
  let accepted = 0;
  let unreachable = false;
  try {
    const admitted = withCrashGeneration(() => as ? submitter(batch, as) : submitter(batch));
    if (!admitted) {
      pending.clear();
      return 0;
    }
    accepted = await admitted;
  } catch {
    accepted = 0;
    unreachable = true;
  }
  if (accepted > 0) {
    const refiled = applySent(batch, as);
    persist();
    noteCrashDelivered(occurrences);
    for (const item of batch) refusedCrashKeys.delete(bufferKey(item.signature, as?.installId));
    // Said only now. A crash moved off a dead install's identity has not been
    // filed anywhere until a server accepts it, and announcing the move at the
    // moment of the refusal claimed a filing that might never happen.
    if (refiled > 0) noteCrashRefiledUnderSuccessor(refiled);
    return 0;
  }
  // Zero used to end the story, which is how a REFUSED replay became
  // indistinguishable from having nothing to send. The transport leaves the
  // reason behind when it actually offered the batch; no reason means it never
  // went out (no credential yet, kit still locked), and crashes that were never
  // offered are held, not refused.
  const refusal = takeCrashSendRefusal();
  stopCrashPass = unreachable || refusal === "unreachable" || refusal === "rate-limited";
  if (refusal && !stopCrashPass) {
    for (const item of batch) refusedCrashKeys.add(bufferKey(item.signature, as?.installId));
  }
  if (refusal) noteCrashDeliveryRefused(refusal, occurrences);
  if (
    as &&
    (refusal === "credential-refused" || refusal === "not-registered")
  ) {
    // The install that crashed can no longer be authenticated — its credential
    // was rotated, or it was closed. Filing its crash under the install that
    // replaced it is a worse answer than filing it correctly and a better one
    // than losing it, so it is moved onto this install's identity and re-keyed.
    // Nothing is ANNOUNCED here: the move is not a filing, and until a server
    // accepts it the crash is still held and still says so.
    let moved = 0;
    for (const item of batch) {
      const from = bufferKey(item.signature, as.installId);
      const cur = pending.get(from);
      if (cur?.sendAs?.installId !== as.installId) continue;
      pending.delete(from);
      delete cur.sendAs;
      const to = bufferKey(cur.signature);
      const mine = pending.get(to);
      if (mine) {
        // This process has the same crash of its own. Fold the counts in
        // rather than dropping either, and carry the pending re-file with it.
        mine.sessionTotal = Math.min(
          MAX_OCCURRENCES,
          mine.sessionTotal + cur.sessionTotal,
        );
        mine.unsent = Math.min(MAX_OCCURRENCES, mine.unsent + cur.unsent);
        mine.lastSeen = Math.max(mine.lastSeen, cur.lastSeen);
        mine.refiledPending =
          (mine.refiledPending ?? 0) + (cur.refiledPending ?? 0) + cur.unsent;
        if (cur.fromEarlierRun) mine.fromEarlierRun = true;
      } else {
        cur.refiledPending = (cur.refiledPending ?? 0) + cur.unsent;
        pending.set(to, cur);
      }
      moved += item.occurrences;
    }
    if (moved > 0) persist();
  }
  return occurrences;
}

/** One flush pass: every identity with something waiting, in turn. */
async function flushPass(): Promise<void> {
  let accepted = false;
  let waiting = false;
  const heldKeys = new Set([...pending.values()].map((entry) =>
    bufferKey(entry.signature, entry.sendAs?.installId)));
  for (const key of refusedCrashKeys) if (!heldKeys.has(key)) refusedCrashKeys.delete(key);
  stopCrashPass = false;
  const attempted = new Set<string>();
  for (const as of pendingIdentities()) {
    for (const retrying of [false, true]) {
      for (let pass = 0; pass < Math.ceil(MAX_CRASHES / MAX_BATCH); pass++) {
        const batch = buildBatch(as, attempted, retrying);
        if (batch.length === 0) break;
        for (const item of batch) attempted.add(bufferKey(item.signature, as?.installId));
        const left = await offer(as, batch);
        if (left > 0) waiting = true;
        else accepted = true;
        if (stopCrashPass) break;
      }
      if (stopCrashPass) break;
    }
    if (stopCrashPass) break;
  }
  // Handed over: the ladder starts again from the bottom, and only keeps
  // running while something is still waiting.
  if (accepted) {
    retryStep = 0;
    clearRetry();
  }
  // Held, refused or accepted-in-part: ask again later rather than waiting for
  // the app to crash a second time.
  if (waiting || pendingCrashOccurrences() > 0 || accepted) scheduleRetry();
}

/** Flush pending crashes through the registered submitter. Always-on for
 *  registered apps (not gated by enable/disable) — only `BOOSTHIS_DISABLED`,
 *  `forget()`, or a missing submitter stop it. Never throws.
 *
 *  A call made while a pass is already running WAITS FOR THAT PASS. Returning
 *  at once was the whole defect on the exit path: `capture()` starts an upload
 *  a moment before the shutdown asks for one, so the "flush now" the dying
 *  process awaited resolved immediately and the process left with the request
 *  still in the air. */
/** Remove, unsent, every kept crash whose latest occurrence is older than the
 *  server's receipt window, and say so once. Returns how many occurrences went. */
export function dropCrashesPastReceiptWindow(now: number = Date.now()): number {
  let dropped = 0;
  let oldest = Number.POSITIVE_INFINITY;
  for (const [key, e] of pending) {
    if (e.unsent <= 0 || !(now - e.lastSeen > CRASH_RECEIPT_KEEP_MS)) continue;
    dropped += e.unsent;
    oldest = Math.min(oldest, e.lastSeen);
    pending.delete(key);
  }
  if (dropped > 0) {
    persist();
    noteCrashesGivenUp(dropped, oldest);
  }
  return dropped;
}

async function flush(): Promise<void> {
  if (inFlight) {
    flushQueued = true;
    await inFlight.catch(() => {});
    return;
  }
  try {
    dropCrashesPastReceiptWindow();
  } catch {
    /* the give-up is best effort; the offer still goes */
  }
  if (!activeSubmitter || isBoosthisDisabled() || pending.size === 0) return;
  const pass = flushPass().catch(() => {
    /* a pass that failed is a crash still held, never a rejection */
  });
  inFlight = pass;
  try {
    await pass;
  } finally {
    inFlight = null;
    if (flushQueued) {
      flushQueued = false;
      scheduleFlush();
    }
  }
}

/**
 * Flush now, and WAIT for it — the exit path's entry point.
 *
 * `capture()` writes the crash to disk and then schedules an upload it cannot
 * wait for, which on the fatal path is a promise the dying process never
 * keeps. Every other queue in the kit has an awaitable "flush now" for exactly
 * this reason and the crash buffer did not, so the one shape of death we do
 * capture still had to wait for a LATER launch to be delivered. This is that
 * missing call: `exitFlush.ts` runs it inside its shared budget, so a crash
 * captured by a process on its way out leaves with it.
 *
 * Never throws, and resolves whatever happens — a shutdown may not be held up
 * by an unreachable server beyond the caller's own budget.
 */
export async function flushCrashesNow(): Promise<void> {
  try {
    // Two waits at most. The first joins whatever is already in the air (the
    // fatal path always has an upload in flight — `capture()` started one). The
    // second drains what queued up behind it, which is where a crash captured
    // DURING the shutdown lands. Anything still refused after that waits for
    // the retry ladder: a stop may not be held open by an unreachable server
    // beyond the caller's own budget.
    await flush();
    if (pendingCrashOccurrences() > 0) await flush();
  } catch {
    /* a flush on the way out may never become a stack trace */
  }
}

/** How many crash occurrences are still waiting to be accepted. Zero from a
 *  process that got everything out; read by the exit path's result and by the
 *  kit's own status surfaces. */
export function pendingCrashOccurrences(): number {
  try {
    let n = 0;
    for (const e of pending.values()) n += Math.max(0, e.unsent);
    return n;
  } catch {
    return 0;
  }
}

/** Of those, the ones captured by an EARLIER RUN and restored from disk.
 *
 *  They are in NO local crash count — this process never saw them happen — so
 *  while they wait, a zero on any surface is a statement about our silence and
 *  not about the application's health. A crash captured HERE is deliberately
 *  excluded: it is already counted, so nothing reads zero on its account. */
function carriedOverCrashOccurrences(): number {
  try {
    let n = 0;
    for (const e of pending.values()) {
      if (e.fromEarlierRun) n += Math.max(0, e.unsent);
    }
    return n;
  } catch {
    return 0;
  }
}

/* ─── Whose crash is this? ───────────────────────────────────────── */

/**
 * Several processes of one application share one state file — cluster workers
 * do it by design — and the pending crash buffer lives in it under a single
 * key. With no owner on an entry, process B restores the buffer A wrote,
 * uploads it through B's submitter and then persists the deletion: A's crash is
 * filed against B, or cleared without ever being filed at all.
 *
 * So every PERSISTED entry carries the process that captured it (the in-memory
 * entry is untouched, so nothing here can reach an upload payload). The rules
 * are deliberately narrow:
 *
 *   • a process writes only its OWN entries and puts back every other entry in
 *     the file exactly as it found it;
 *   • it may CLAIM another process's entries only when that process is gone —
 *     same host, pid dead or now reused by us — and the install id agrees,
 *     because a dead process will never flush them itself;
 *   • anything else — a live sibling, another host, another install — is not
 *     ours to send and not ours to delete.
 *
 * A pid can be reused by an unrelated process, in which case the owner looks
 * alive and its crashes simply wait for a later boot. Waiting is the safe
 * failure: the alternative is filing one app's crash against another.
 */
interface CrashOwner {
  /** Unique per process instance: host, pid, and the moment it started. */
  id: string;
  pid: number;
  host: string;
  /** The writer's liveness mark (Windows only; see storage.ts) — what tells
   *  that process from a later one handed its pid. */
  live?: string;
  /** The install the process was registered under, when it knew one. */
  installId?: string;
  /** The credential that install authenticates with, so a later process can
   *  file this crash AS that install instead of as itself. Written only into
   *  the kit's own state file (owner-only 0700 directory), never uploaded. */
  credential?: string;
}

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
/** The install id this process reports under. Handed in at install time so a
 *  claim can tell one application's crashes from another's. */
let ownInstallId: string | null = null;
/** `${ownerId}|${signature}` for every entry this process has taken over, so
 *  the next write does not put back the copy it replaced. */
const claimed = new Set<string>();

function ownerOf(entry: unknown): CrashOwner | null {
  const raw = (entry as { owner?: unknown })?.owner as
    | Record<string, unknown>
    | undefined;
  if (!raw || typeof raw.id !== "string" || typeof raw.pid !== "number") {
    return null;
  }
  return {
    id: raw.id,
    pid: raw.pid,
    host: typeof raw.host === "string" ? raw.host : OWNER_HOST,
    ...(typeof raw.live === "string" && /^[0-9a-f]{16}$/.test(raw.live)
      ? { live: raw.live }
      : {}),
    installId: typeof raw.installId === "string" ? raw.installId : undefined,
    credential:
      typeof raw.credential === "string" && raw.credential
        ? raw.credential
        : undefined,
  };
}

function claimKey(owner: CrashOwner | null, signature: string): string {
  return `${owner?.id ?? "unowned"}|${signature}`;
}

/** The filed-as identity a persisted entry already carries, from an earlier
 *  launch that claimed it from a predecessor. Ignored once this app is
 *  registered under that same id again — then the crash is simply ours. */
function identityOn(entry: unknown): CrashSendIdentity | null {
  const raw = (entry as { sendAs?: unknown })?.sendAs as
    | Record<string, unknown>
    | undefined;
  if (!raw) return null;
  const installId = typeof raw.installId === "string" ? raw.installId : "";
  const credential = typeof raw.credential === "string" ? raw.credential : "";
  if (!installId || !credential || installId === ownInstallId) return null;
  return { installId, credential };
}

/** Is that pid still running? `kill(pid, 0)` sends no signal; EPERM means the
 *  process exists and belongs to someone else. Anything other than "no such
 *  process" reads as alive, because not claiming is the safe answer. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code !== "ESRCH";
  }
}

function isOwn(owner: CrashOwner | null): boolean {
  return owner !== null && owner.id === OWNER_ID;
}

/** May this process take over an entry it did not write? */
function isClaimable(owner: CrashOwner | null): boolean {
  // No owner at all: written by a kit from before crashes carried one, when
  // there was a single buffer per state file. Adopt it once, and it gains an
  // owner on the next write.
  if (owner === null) return true;
  if (owner.id === OWNER_ID) return false;
  if (owner.host !== OWNER_HOST) return false;
  // Our own pid held by a different process instance: the previous holder is
  // gone and we are what replaced it. This is the ordinary restart-in-place
  // case — a container whose app is pid 1 gets pid 1 again — and without it a
  // fatal crash would never be reported on the next launch.
  //
  // On Windows a dead owner's pid is often handed to some unrelated process,
  // which answers `kill(0)` for it. The owner's liveness mark tells them
  // apart: only a mark that reads "gone" frees the crash, so a mark that
  // cannot be read holds it back, the safe answer.
  const gone =
    owner.pid === process.pid ||
    !pidAlive(owner.pid) ||
    (owner.live !== undefined && processLiveness(owner.live) === "gone");
  // A LIVE sibling's crashes are its own to send, whoever it registered as.
  if (!gone) return false;
  // Ours, under the id we hold now.
  if (owner.installId === ownInstallId) return true;
  // A DEAD process's crashes are claimable under a DIFFERENT install id too —
  // but only one this application has itself launched under before. Several
  // kits mint a fresh install id when a service restarts, which is precisely
  // the case where a crash is buffered by one identity and can only ever be
  // replayed by the next: refusing every differing id meant the crash of a
  // restarting service, the one most worth reporting, was the one guaranteed
  // to be dropped. Asking the identity chain rather than adopting anything
  // dead keeps a state file shared by two applications honest — a stranger's
  // id was never in our chain. It is filed under the install this app is
  // registered as NOW; when the restart-identity work lands and the id is
  // stable across a restart, that becomes the same id that crashed.
  //
  // A dead owner that recorded no install id at all is from a kit before
  // crashes carried one: there is no identity to disagree with, so the
  // pre-existing dead-owner rule stands and it is adopted.
  if (owner.installId === undefined) return true;
  return hasRunAs(owner.installId);
}

/** The entries already in the file that this process must put back untouched.
 *  `alsoDropClaimable` is for `forget()`: erasure covers this install's crashes
 *  left behind by a process that has since died, but never another app's. */
function foreignEntries(
  raw: string | null,
  opts?: { alsoDropClaimable?: boolean },
): unknown[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const keep: unknown[] = [];
  for (const entry of parsed) {
    const signature = (entry as { signature?: unknown })?.signature;
    if (typeof signature !== "string") continue;
    const owner = ownerOf(entry);
    if (isOwn(owner)) continue;
    if (claimed.has(claimKey(owner, signature))) continue;
    if (opts?.alsoDropClaimable && isClaimable(owner)) continue;
    keep.push(entry);
    // Bound what one process will carry on another's behalf, so a machine full
    // of dead workers cannot grow the file without limit.
    if (keep.length >= MAX_CRASHES) break;
  }
  return keep;
}

/* ─── Persistence (synchronous — see storage.setSync) ─────────────── */

function persist(): void {
  try {
    const cred = ownCredential();
    const mark = processLivenessMark();
    const owner: CrashOwner = {
      id: OWNER_ID,
      pid: process.pid,
      host: OWNER_HOST,
      ...(mark !== null ? { live: mark } : {}),
      ...(ownInstallId ? { installId: ownInstallId } : {}),
      // Kept WITH the crash so the process that replaces this one can file it
      // as the install that crashed, not as itself.
      ...(ownInstallId && cred ? { credential: cred } : {}),
    };
    const mine = [...pending.values()]
      .slice(0, MAX_CRASHES)
      .map((entry) => ({ ...entry, owner }));
    // ONE locked read-modify-write. Whatever a sibling worker wrote between our
    // last read and now is still in the file after ours goes back into it.
    //
    // The store NEVER THROWS on a write it could not do: a full disk, a
    // read-only directory, or no writable directory at all leaves the value in
    // memory and returns normally. For every other caller that is the right
    // kindness; for this one it was the whole defect, because a crash that
    // lives only in the memory of a process that is about to die has not been
    // kept at all. So the outcome is asked for, not inferred from an exception.
    const { persisted } = storage.updateSyncPersisted(STORAGE_KEY, (current) => {
      const others = foreignEntries(current);
      if (mine.length === 0 && others.length === 0) return null;
      return JSON.stringify([...mine, ...others]);
    });
    // Nothing of ours to keep (a flush emptied the buffer) is not a failure to
    // keep it. Only a crash we are holding can be lost. The two causes read
    // differently to whoever has to fix it: there was nowhere to write at all,
    // or there was and the write did not land.
    if (!persisted && mine.length > 0) {
      noteCrashKeepFailed(
        storageDurable() ? "write-failed" : "storage-not-durable",
      );
    }
  } catch {
    // A failed write means a fatal crash before the next successful flush
    // cannot be reported at all — so it is SAID, once, in the kit's own words
    // rather than accepted in silence. Never throws.
    noteCrashKeepFailed("write-failed");
  }
}

function restore(): void {
  if (restoredOnce) return;
  if (withCrashGeneration(() => true) !== true) return;
  restoredOnce = true;
  /** Crashes adopted from a buffer that is the ONLY record of them — written by
   *  a kit that kept no durable history. Imported after the loop, so one
   *  malformed entry cannot cost the others their evidence. */
  const toAdopt: Array<{
    occurrences: number;
    at: number;
    owner: string;
    /** The buffer entry these occurrences came from, marked as imported only
     *  once the history has actually taken them. */
    key: string;
  }> = [];
  /** True once anything in the buffer has been marked as imported, so the
   *  marker is written back and no later launch counts these again. */
  let adopted = false;
  try {
    const raw = storage.getSync(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const c of parsed) {
      if (
        c &&
        typeof c.signature === "string" &&
        typeof c.errorName === "string" &&
        typeof c.redactedFrame === "string" &&
        (c.kind === "uncaught" ||
          c.kind === "unhandledRejection" ||
          c.kind === "render" ||
          // A background job's crash persists exactly like every other kind
          // and used to be dropped here on the way back in, so a job that
          // threw as the process died was written to disk and then silently
          // discarded by the launch that was meant to report it.
          c.kind === "job") &&
        typeof c.sessionTotal === "number" &&
        typeof c.unsent === "number"
      ) {
        const owner = ownerOf(c);
        // Ours, or a dead process's on this machine under this install.
        // Anyone else's stays in the file, unread and unsent.
        if (!isOwn(owner) && !isClaimable(owner)) continue;
        claimed.add(claimKey(owner, c.signature));
        // The identity this crash must be FILED as, when that is not the one
        // this process holds. An entry that has already travelled carries its
        // own; otherwise it is the dead owner's, and only when that owner left
        // a credential to authenticate with.
        const restoredIdentity: CrashSendIdentity | null =
          identityOn(c) ??
          (owner &&
          owner.installId &&
          owner.credential &&
          owner.installId !== ownInstallId
            ? { installId: owner.installId, credential: owner.credential }
            : null);
        const already = pending.get(
          bufferKey(c.signature, restoredIdentity?.installId),
        );
        if (already) {
          // Two owners of the SAME identity buffered the same crash — two
          // processes of one install. Fold the counts rather than dropping
          // one, so no occurrence is lost. Two different identities never fold
          // here: they are two keys, filed as the installs they belong to.
          already.sessionTotal = Math.min(
            MAX_OCCURRENCES,
            already.sessionTotal + c.sessionTotal,
          );
          already.unsent = Math.min(
            MAX_OCCURRENCES,
            already.unsent + c.unsent,
          );
          // Their identity is the same by construction — it is part of the key
          // — so nothing has to choose between two of them. A service
          // crash-looping through fresh install ids leaves the same crash under
          // several dead identities, and each is now carried and filed as
          // itself instead of the newest one speaking for all of them.
          //
          // The app's own frame: one key means one function and file, so the
          // two can differ only in its line, and the newer occurrence's line
          // speaks. Read before the newest-occurrence clock moves below.
          if (
            isRestoredAppFrame(c.appFrame) &&
            (already.appFrame === undefined ||
              (typeof c.lastSeen === "number" && c.lastSeen > already.lastSeen))
          ) {
            already.appFrame = c.appFrame;
          }
          if (
            typeof c.lastSeen === "number" &&
            c.lastSeen > already.lastSeen
          ) {
            already.lastSeen = c.lastSeen;
            // The action travels with the newest occurrence, and only when
            // that occurrence has one: an older report that knew its action
            // keeps speaking for the class rather than being overwritten by a
            // newer one that did not.
            if (typeof c.traceId === "string") {
              already.traceId = c.traceId;
              already.spanId =
                typeof c.spanId === "string" ? c.spanId : undefined;
            }
          } else if (already.traceId === undefined) {
            if (typeof c.traceId === "string") {
              already.traceId = c.traceId;
              if (typeof c.spanId === "string") already.spanId = c.spanId;
            }
          }
          // WHERE, on the same terms: a restored occurrence that could name
          // its part speaks for the class; one that only carries a term does
          // not overwrite a name already held.
          if (typeof c.routeLabel === "string") {
            already.routeLabel = c.routeLabel;
            already.partUnknown = undefined;
          } else if (
            already.routeLabel === undefined &&
            already.partUnknown === undefined &&
            isRestoredUnknownTerm(c.partUnknown)
          ) {
            already.partUnknown = c.partUnknown;
          }
          if (c.noted !== true) {
            toAdopt.push({
              ...adoptionOf(c, owner),
              key: bufferKey(c.signature, restoredIdentity?.installId),
            });
          }
          continue;
        }
        pending.set(bufferKey(c.signature, restoredIdentity?.installId), {
          signature: c.signature,
          errorName: c.errorName,
          kind: c.kind,
          redactedFrame: c.redactedFrame,
          // The fatal crash is the one most likely to have been thrown inside a
          // library, and it reaches the server only through this restore — so
          // the line of the app that led there comes back with it, re-checked
          // on the way in like every other value read off the customer's disk.
          ...(isRestoredAppFrame(c.appFrame) ? { appFrame: c.appFrame } : {}),
          summary: typeof c.summary === "string" ? c.summary : undefined,
          frames: Array.isArray(c.frames)
            ? (c.frames as CrashFrameData[])
            : undefined,
          // The action the dead run placed this crash in, carried back with
          // it. A restore that dropped these would turn a crash that knew its
          // action into one that never did — and the fatal crash, the one the
          // restore exists for, is exactly the crash worth placing.
          ...(typeof c.traceId === "string" ? { traceId: c.traceId } : {}),
          ...(typeof c.spanId === "string" ? { spanId: c.spanId } : {}),
          // And WHERE it happened, for exactly the same reason: the fatal
          // crash is the one a developer most needs placed, and it is the one
          // that can only arrive through this restore. Re-checked against the
          // closed vocabulary on the way back in — the file is on the
          // customer's disk and nothing reaches the wire on the strength of a
          // value something else could have written there.
          ...(typeof c.routeLabel === "string"
            ? { routeLabel: c.routeLabel }
            : isRestoredUnknownTerm(c.partUnknown)
              ? { partUnknown: c.partUnknown }
              : {}),
          sessionTotal: c.sessionTotal,
          unsent: c.unsent,
          lastSeen: typeof c.lastSeen === "number" ? c.lastSeen : Date.now(),
          // WHOSE CRASH THIS IS STAYS WHOSE CRASH THIS IS. A crash claimed
          // from a process that reported under another install is replayed as
          // that install, using the credential it left with the crash —
          // otherwise the restart that mints a new id moves the crash onto an
          // install that never crashed and leaves the one that did looking
          // clean. Already-travelled entries carry the identity forward.
          ...(restoredIdentity ? { sendAs: restoredIdentity } : {}),
          // Not this process's crash: it is in no local count, so while it
          // waits, "zero crashes" here is our silence and not the app's health.
          fromEarlierRun: true,
          // Whether the dead run also wrote this crash into the durable
          // history. A kit old enough not to have kept one leaves it out, and
          // the buffer below is then the only thing that remembers the crash —
          // so it is adopted into the history before anything can deliver and
          // empty it.
          ...(c.noted === true ? { noted: true as const } : {}),
        });
        if (c.noted !== true) {
          toAdopt.push({
            ...adoptionOf(c, owner),
            key: bufferKey(c.signature, restoredIdentity?.installId),
          });
        }
      }
    }
    evictIfNeeded();
  } catch {
    // Corrupt/absent store — start clean.
  }
  // Outside the parse guard: a buffer that failed halfway through still hands
  // over the evidence it did read, and the marker is written back so the next
  // launch cannot count these occurrences a second time.
  try {
    for (const a of toAdopt) {
      // Mark the buffer only for evidence the history REALLY took. A write that
      // never reached disk leaves the queue the sole record of this crash, and
      // a marker written anyway would tell the next launch not to bother — so
      // it stays unmarked, is offered to the history again next time, and until
      // then the reporting verdict says the reading cannot be trusted.
      if (!noteCarriedCrashes(a.occurrences, a.at, a.owner)) continue;
      const e = pending.get(a.key);
      if (e) e.noted = true;
      adopted = true;
    }
    if (adopted) persist();
  } catch {
    /* best effort — adoption may never break the launch */
  }
}

/**
 * What a buffered crash is worth as EVIDENCE, when the buffer is all there is.
 *
 * The occurrences still owed is the honest floor: those demonstrably happened
 * and nothing else records them. An entry with nothing owed was already
 * delivered by the run that died, so the server has it — but the verdict is the
 * kit's to answer (docs/decisions/crash-free-verdict-source.md) and it must not
 * read clean beside a crash list that shows one, so it still counts as one.
 */
function adoptionOf(
  c: { unsent?: unknown; sessionTotal?: unknown; lastSeen?: unknown },
  owner: CrashOwner | null,
): { occurrences: number; at: number; owner: string } {
  const owed = typeof c.unsent === "number" && c.unsent > 0 ? c.unsent : 0;
  const total =
    typeof c.sessionTotal === "number" && c.sessionTotal > 0
      ? c.sessionTotal
      : 0;
  return {
    occurrences: Math.max(1, Math.min(owed || total || 1, MAX_OCCURRENCES)),
    at: typeof c.lastSeen === "number" ? c.lastSeen : Date.now(),
    owner: owner?.id ?? "carried",
  };
}

/* ─── Install / uninstall ────────────────────────────────────────── */

/**
 * Install the global crash handler. Called once from `enableTelemetry`.
 * Idempotent: calling again only updates `detailed` and never re-registers the
 * monitor listener (which would otherwise double-report).
 *
 * Guest-code invariant: we register ONLY on `uncaughtExceptionMonitor` — a
 * passive monitor that never suppresses Node's default crash behavior. We NEVER
 * add an `'uncaughtException'` or `'unhandledRejection'` listener.
 */
export function installCrashHandlers(opts: {
  detailed: boolean;
  /** The install this process reports under. Stamped on every persisted crash
   *  so a sibling process cannot claim it — see "Whose crash is this?". */
  installId?: string | null;
}): void {
  try {
    detailedMode = opts.detailed === true;
    if (typeof opts.installId === "string" && opts.installId) {
      ownInstallId = opts.installId;
    }
    if (active) return;
    active = true;

    monitorListener = (err: unknown, origin: unknown) => {
      // The whole monitor body is guarded: `uncaughtExceptionMonitor` runs
      // during Node's crash handling and a throw here would be fatal.
      try {
        // origin is 'uncaughtException' | 'unhandledRejection'; map into the
        // server's closed crash-kind enum.
        const kind: CrashKind =
          origin === "unhandledRejection" ? "unhandledRejection" : "uncaught";
        capture(err, kind);
        // Mark this run as having died of an error it captured, so the next
        // launch reads the leftover run record as "already described by a
        // crash in the buffer" rather than as a silent disappearance.
        endRun("uncaught");
      } catch {
        // never throw from the monitor
      }
    };
    // Only ever the passive monitor — never 'uncaughtException'/'unhandledRejection'.
    process.on("uncaughtExceptionMonitor", monitorListener);

    // Hand the delivery record a reader for what this buffer is holding FROM
    // AN EARLIER RUN. It is registered here rather than imported the other way
    // round (this module imports the record, so the record cannot import it
    // back), and nothing in this file may run as an import side-effect.
    //
    // Carried-over occurrences only, never this process's own: a crash that
    // happened here is already in `crashCount()`, so nothing reads zero while
    // it waits. A crash restored from a dead process is in nobody's count —
    // this process never saw it happen and the server has not been told — so
    // without this a crash-looping service reads as a clean 100.
    useHeldCrashReader(carriedOverCrashOccurrences);

    // Open this run's record FIRST, so a launch that follows a kill knows the
    // previous run vanished — the class of death no code inside the process
    // can ever report at the time it happens.
    beginRun(ownInstallId);

    // Restore any crashes persisted from a previous (possibly fatal) session
    // and flush them now that a submitter is registered.
    try {
      restore();
      scheduleFlush();
    } catch {
      // Best-effort restore — a corrupt store just starts clean.
    }
  } catch {
    // installation must never throw into the host's enableTelemetry call.
  }
}

/**
 * LOCKED (docs/kit-lock-rule.md): take the monitor off and stop delivering,
 * but leave the crash file on disk. What this process held in memory is
 * dropped; the file waits for an active answer (the next launch restores it)
 * or for a dissolve's erase. This run's record is closed here, so the time
 * spent locked is never counted as watched time and a later death under the
 * lock is never reported as a disappearance. Never throws.
 */
export function detachCrashHandlers(): void {
  active = false;
  detailedMode = false;
  try {
    if (monitorListener) {
      process.removeListener("uncaughtExceptionMonitor", monitorListener);
    }
  } catch {
    // Best-effort.
  }
  monitorListener = null;
  pending.clear();
  crashTotal = 0;
  clearRetry();
  retryStep = 0;
  endRun("clean");
}

/**
 * Tear down the handler and clear all pending crash state, including the
 * persisted store. Called by `telemetry.forget()` so nothing Boosthis-shaped is
 * left in the process or on disk. Removes ONLY the monitor listener we added.
 */
export async function uninstallCrashHandlers(): Promise<void> {
  active = false;
  detailedMode = false;
  try {
    if (monitorListener) {
      process.removeListener("uncaughtExceptionMonitor", monitorListener);
    }
  } catch {
    // Best-effort.
  }
  monitorListener = null;
  pending.clear();
  crashTotal = 0;
  // An install that was asked to forget stops carrying a credential too: no
  // crash captured after this may be stamped with one.
  credentialReader = null;
  clearRetry();
  retryStep = 0;
  refusedCrashKeys.clear();
  // Close this run's record: an install that was asked to forget must not
  // leave a marker behind that a later launch reads as a disappearance.
  endRun("clean");
  eraseCrashState();
}

/**
 * Follow an install-id rotation.
 *
 * A redeployed process keeps its crashes but is re-registered under a new
 * install id. Without this, the crashes it buffers are stamped with the id it
 * booted with, and the next process — which knows only the rotated id — reads
 * them as another application's and never sends them.
 */
export function setCrashOwnerInstallId(installId: string | null): void {
  if (typeof installId === "string" && installId) ownInstallId = installId;
}

/* ─── Test/debug helpers ─────────────────────────────────────────── */

/** Crashes captured since telemetry started (crashFree axis input). */
export function crashCount(): number {
  return crashTotal;
}

export const _crashInternals = {
  STORAGE_KEY,
  MAX_CRASHES,
  MAX_BATCH,
  redactError,
  parseStack,
  fileBasename,
  isOwnCodePath,
  firstAppFrame,
  sanitizeErrorName,
  sanitizeSummary,
  bucketCount,
  capture,
  flush,
  buildBatch,
  isActive: () => active,
  isDetailed: () => detailedMode,
  pendingSize: () => pending.size,
  getPending: () => [...pending.values()].map((e) => ({ ...e })),
  getMonitorListener: () => monitorListener,
  ownerId: () => OWNER_ID,
  ownerOf,
  isClaimable,
  foreignEntries,
  setOwnInstallIdForTests: (id: string | null) => {
    ownInstallId = id;
  },
  reset: () => {
    refusedCrashKeys.clear();
    pending.clear();
    active = false;
    detailedMode = false;
    monitorListener = null;
    restoredOnce = false;
    inFlight = null;
    flushQueued = false;
    activeSubmitter = null;
    crashTotal = 0;
    credentialReader = null;
    claimed.clear();
    ownInstallId = null;
    clearRetry();
    retryStep = 0;
  },
  retryPending: () => retryTimer !== null,
  retryStep: () => retryStep,
  RETRY_LADDER_MS,
  setCrashCountForTests: (n: number) => {
    crashTotal = n;
  },
  setDetailedForTests: (d: boolean) => {
    detailedMode = d;
  },
  setActiveForTests: (a: boolean) => {
    active = a;
  },
};
