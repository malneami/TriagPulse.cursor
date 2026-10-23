/* ─── Boosthis: remote kill-switch / entitlement client (Node) ──────────
 *
 * Faithful port of `lib/boosthis-runtime-rn/src/killSwitch.ts` (Rung 1 of the
 * kit-protection design). The RN doctrine applies verbatim: the VALUE lives on
 * the server and the kit only ever asks "am I still entitled?". When the server
 * says anything other than "active" the kit goes fully INERT: no bubble panel,
 * no measuring, no telemetry of any kind, no fix/community fetch.
 *
 * Node differences from the RN port (kept idiomatic):
 *   - persistence is the Node `storage` file store (async get/set/remove),
 *   - the check-in fetch uses the global `fetch` (Node 18+) bounded by a
 *     `Promise.race` timer — NO AbortController (parity with the RN contract),
 *   - the monotonic clock is `performance.now()` (`node:perf_hooks`),
 *   - there is no React UI: `getEntitlementGateKind()` drives the injected dev
 *     bubble's blocking lock overlay, and `subscribeEntitlement()` lets the
 *     panel endpoint reflect a live flip.
 *
 * Offline policy = GRACE (7 days). Cache the last confirmed-"active" answer and
 * keep working offline for `graceSeconds`; die the moment we (a) learn a
 * non-active status (sticky immediately, across restarts) or (b) the grace
 * window lapses with no successful re-check. No answer may grant more than
 * seven days, whatever it states.
 *
 * THE SHARED LOCK RULE (docs/kit-lock-rule.md). Three answers:
 *   active     measure, upload and show the developer's panel.
 *   locked     revoked, unpaid, tampered, paused, an `active` whose grace ran
 *              out, and ANY word this kit does not know. Every kind of
 *              measurement stops, the listeners the kit added come off, what it
 *              held (including what waited for the first answer) and what our
 *              server handed over is thrown away, nothing is sent, and every
 *              local page and read shows only the renew notice. It asks again
 *              no sooner than the answer's recheckAfterSeconds (and never
 *              sooner than its own interval), so an active answer brings it
 *              back.
 *   dissolved  the project stayed locked past its owner's delay. The kit
 *              erases what it kept on this machine (never the project's history
 *              on our server: the server's forget call is not made), unhooks,
 *              and asks nothing more until the app restarts; then it asks once.
 * Both lock and dissolve are stored, so they survive a restart, and nothing is
 * measured before the stored answer is read.
 *
 * ACTIVATION LOCK (ships locked): a copy that has NEVER completed a successful
 * server handshake is fully inert. "Activated" = the PRESENCE of a persisted
 * entitlement cache (even a revoked one — a registered-but-killed install must
 * keep heartbeating so it can learn it was restored). `forget()`/`clear...`
 * wipes the cache, re-locking the kit.
 *
 * CRITICAL invariants (identical to RN):
 *  - `isRuntimeInert()` is SYNCHRONOUS (transmit hot path + panel endpoint call
 *    it). It reads an in-memory flag hydrated asynchronously from cache.
 *  - The check-in itself MUST bypass the inert gate (it is the recovery path).
 *  - The check-in fetch bounds itself with a Promise.race timer, NEVER an
 *    AbortController signal.
 *  - This module imports ONLY runtimeFlags / no-pii / storage — never
 *    telemetry / transmit (those import IT), so there is no import cycle.
 */

import { performance as perfHooks } from "node:perf_hooks";
import { isBoosthisDisabled } from "./runtimeFlags";
import { readAnswerJson } from "./answerRead";
import { checkNoPII } from "./no-pii";
import { storage, storageDurable } from "./storage";
import { isServerlessMode } from "./serverless";

/** The wire entitlement states. Mirrors the server's `EntitlementCheckResponse`
 *  status enum. "paused" is the calm variant of the owner's dashboard
 *  Disconnect pause; the kit goes inert on it exactly like "revoked".
 *  "dissolved" is the lock rule's third answer (see the header). Any OTHER word
 *  the server sends is kept exactly as it came and read as a lock — an unknown
 *  word is never active. */
export type EntitlementStatus =
  | "active"
  | "revoked"
  | "unpaid"
  | "tampered"
  | "paused"
  | "dissolved"
  | (string & {});

/** Storage key for the cached last-good answer. Versioned so the shape can
 *  evolve without misreading an old record. Byte-equal to the RN key. */
const CACHE_KEY = "boosthis.entitlement.v1";

/** The one answer that lets the kit run. Compared exactly: nothing else is. */
const ACTIVE = "active";

/** The project stayed locked past its owner's delay: erase on this machine and
 *  stay off until the app restarts. */
const DISSOLVED = "dissolved";

/** Sent on every check-in: the answers beyond the old ones this kit acts on. A
 *  kit that does not send it is never told `dissolved`. */
const UNDERSTANDS: readonly string[] = [DISSOLVED];

/** When a dissolved kit may ask again. */
const ASK_AGAIN = "after-restart";

/** Default offline grace if the server answer omits one. 7 days — matches the
 *  server's `GRACE_SECONDS`. Only a fallback; the server is canonical. */
const DEFAULT_GRACE_SECONDS = 7 * 24 * 60 * 60;

/** The longest grace any answer may grant, whatever it states: the shared seven
 *  days. Also clamps a corrupt/tampered cached grace so it can never defeat the
 *  kill-switch. */
const MAX_GRACE_SECONDS = 7 * 24 * 60 * 60;

/** Clock-jitter tolerance for a cache whose `checkedAt` sits in the future. */
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/** Periodic heartbeat interval once started. 6h — unchanged from RN. */
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Network timeout for a single check-in. */
const DEFAULT_TIMEOUT_MS = 8000;

/** Minimum spacing between FORCED on-open entitlement checks. The dev bubble /
 *  panel opening is a user-driven enforcement edge (VAULT contract), but a user
 *  who opens/closes repeatedly must not hammer the server, so a forced on-open
 *  check runs at most once per this window. The periodic 6h heartbeat and the
 *  unconditional launch check are unaffected. */
const FORCE_CHECK_THROTTLE_MS = 60 * 1000;

interface EntitlementCache {
  /** The word the server sent, kept as it came (an unknown one reads as a lock). */
  status: string;
  /** ms-epoch when the server confirmed this answer. */
  checkedAt: number;
  graceSeconds: number;
  /** High-water mark: the maximum wall-clock time ever OBSERVED for this active
   *  answer, so a clock rollback across a restart can't shrink proven elapsed
   *  time. Absent on legacy caches (treated as `checkedAt`). */
  maxSeenWallMs?: number;
  /** The server's own words for a lock, so a restarted kit can still say why. */
  message?: string | null;
  /** ms-epoch before which a locked kit, having asked once this run, does not
   *  ask again. */
  recheckAt?: number;
  /** Set on a dissolved record only: when this kit may ask again. */
  askAgain?: string;
}

/* ─── In-memory state (the synchronous source of truth for the gate) ──── */

let memStatus: EntitlementStatus = ACTIVE;
let memInert = false;
let memMessage: string | null = null;
let hydrated = false;

/** When a locked kit may ask again (ms-epoch), or null when no lock said. */
let memRecheckAt: number | null = null;

/** Whether this process has sent a check-in yet. The first one always goes out
 *  (a restart asks once); after it, a lock's recheck time is honoured. */
let askedThisRun = false;

/** Set once this process has dissolved: nothing asks, measures or writes again
 *  until the app restarts. A plain boolean, read on every hook call. */
let dissolvedThisRun = false;

/* ─── What the kit does when an answer locks it ───────────────────────── */

/** The steps only the telemetry layer can take, registered by it so this
 *  module never imports it (no import cycle). Every step is best-effort and
 *  must never throw into the host. */
export interface KitLockHandlers {
  /** Take off every listener, patch, sampler and timer the kit added. A patch
   *  that cannot be removed reads `isKitLocked()` and goes straight through. */
  unhook: (why: "locked" | "dissolved") => void;
  /** Throw away what is held: the measurements and the uploads queued for
   *  them, including what waited for the first answer. */
  clearSamples: () => void;
  /** Throw away what our server handed over: its checks and the finished
   *  results it sent. */
  clearChecks: () => void;
  /** The erase on this machine: credentials, kept crashes and run records,
   *  kept findings and the project records. The install id stays. The
   *  server's forget call is never made from here. */
  removeLocal: () => Promise<void>;
  /** Put back what `unhook` took off, after an active answer ends a lock. */
  rearm: () => void;
}

let handlers: KitLockHandlers | null = null;

/** Registered once by `enableTelemetry`; null unregisters (tests). */
export function setKitLockHandlers(next: KitLockHandlers | null): void {
  handlers = next;
}

function runStep(step: () => void): void {
  try {
    step();
  } catch {
    /* a lock step must never break the host */
  }
}

/** ACTIVATION LOCK tri-state: null = pre-hydration (LOCKED, fail-closed),
 *  false = no valid cache (LOCKED), true = handshake proven (normal model). */
let memActivated: boolean | null = null;

const LOCKED_MESSAGE =
  "Boosthis is locked. Connect this app to Boosthis with your project key to activate it.";

/** Serverless: there is nowhere to cache the last answer, so a cold start
 *  begins with no answer AT ALL. That is not the same thing as being locked
 *  out, and it must not read like it — the registration reply that arrives in
 *  this same invocation carries the entitlement and settles it within
 *  milliseconds. Surfaces that would otherwise say "locked" say "waiting for
 *  the first answer" while this is true. */
let awaitingFirstAnswer = false;

const AWAITING_MESSAGE =
  "Boosthis is waiting for its first answer from the server on this function. " +
  "Nothing is uploaded until it arrives.";

/** True when the kit has never had a server answer AND has nowhere to have
 *  cached one — a function's normal first few milliseconds, never a fault. */
export function isAwaitingFirstAnswer(): boolean {
  return awaitingFirstAnswer && memActivated !== true;
}

/** Active-answer grace timing (see RN notes). */
let memCheckedAt: number | null = null;
let memGraceSeconds: number = DEFAULT_GRACE_SECONDS;
let memInitialAgeMs = 0;
let memMonoAt: number | null = null;
let memMaxSeenWall: number | null = null;

/** Monotonic timestamp (ms) of the last forced on-open check dispatched, or
 *  null if none this run. In-memory only. */
let lastForcedCheckAt: number | null = null;

/* ─── Check-in configuration (installed by enableTelemetry) ───────────── */

import { FIRST_VERDICT_SCHEDULE_MS, REGISTRATION_RETRY_SCHEDULE_MS, retryWait } from "./retrySchedule";

export interface EntitlementCheckinConfig {
  onVerdict?: (status: EntitlementStatus) => void;
  /** API origin + base path, e.g. "https://www.boosthis.com/api". */
  endpoint: string;
  installId: string;
  /** Lazy getter — the token (read OR delete) is issued by consent AFTER
   *  enableTelemetry runs, so read the latest value on every check-in. */
  getToken: () => string | null;
  /** The kit RUNTIME_VERSION, reported for admin visibility. */
  kitVersion: string;
  /** Tamper-evidence signal (Rung 2), forwarded from the host config. */
  integrity?: { status?: string; manifestHash?: string | null } | null;
  fetchImpl?: typeof fetch;
  intervalMs?: number;
  timeoutMs?: number;
  /** Renew a credential Boosthis refused because another copy replaced it,
   *  returning the credential to check in with (or null when none came back).
   *  The telemetry client passes its single renewal, shared with the upload
   *  paths, so a check-in never renews on its own. */
  renewCredential?: (stale: string) => Promise<string | null>;
}

let config: EntitlementCheckinConfig | null = null;

let everActive = false;
let timer: ReturnType<typeof setInterval> | null = null;
let firstTimer: ReturnType<typeof setTimeout> | null = null;
let firstStep = 0;

function scheduleFirstVerdict(): void {
  if (!config || !config.getToken() || memActivated === true || firstTimer || isBoosthisDisabled() || isServerlessMode()) return;
  const schedule = [...FIRST_VERDICT_SCHEDULE_MS, ...REGISTRATION_RETRY_SCHEDULE_MS];
  firstTimer = setTimeout(() => {
    firstTimer = null;
    void checkEntitlementNow().catch(() => null).finally(scheduleFirstVerdict);
  }, retryWait(schedule, firstStep++));
  firstTimer.unref?.();
}

/* ─── Change subscription (lets the panel re-read when the gate flips) ── */

const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* a listener throwing must never break the kit */
    }
  }
}

/**
 * Subscribe to inert-state changes. Returns an unsubscribe function. On first
 * subscription this also kicks a lazy hydrate so a host that serves the bubble
 * panel before `enableTelemetry` still respects a cached kill from a previous
 * launch.
 */
export function subscribeEntitlement(listener: () => void): () => void {
  listeners.add(listener);
  if (!hydrated) void hydrateEntitlement();
  return () => {
    listeners.delete(listener);
  };
}

/* ─── The synchronous gate ────────────────────────────────────────────── */

/**
 * The single combined gate every hot path consults. True ⇒ the kit must do
 * NOTHING. The global env kill-switch always wins; the ACTIVATION LOCK comes
 * next; the server-controlled entitlement state is the lever on top of both.
 */
export function isRuntimeInert(): boolean {
  return (
    isBoosthisDisabled() ||
    dissolvedThisRun ||
    memActivated !== true ||
    memInert ||
    activeGraceExpired()
  );
}

/**
 * LOCKED, in the lock rule's sense: an answer is stored and it is not a live
 * `active` — a named lock, `dissolved`, a word this kit does not know, or an
 * `active` whose grace has run out. Every collector, hook, page and upload
 * reads this at its door. False before the first answer (what is measured then
 * is held for it, and thrown away if the answer is a lock) and when
 * BOOSTHIS_DISABLED is set (that switch is stronger, and every caller already
 * reads it). SYNCHRONOUS: the first read loads the stored answer, so a
 * restarted kit knows it is locked before it measures anything.
 */
export function isKitLocked(): boolean {
  if (isBoosthisDisabled()) return false;
  if (dissolvedThisRun) return true;
  hydrateSync();
  if (memActivated !== true) return false;
  return memStatus !== ACTIVE || memInert || activeGraceExpired();
}

/** Every local page and local read shows only the renew notice while locked:
 *  no numbers, rules, rule lookup or matching, samples or budgets. Who may see
 *  it does not change. */
export function renewOnly(): boolean {
  return isKitLocked();
}

/** The answer word a renew-only read may name: `dissolved` for this process
 *  once it has dissolved, `unregistered` before any answer, `hidden` for an
 *  `active` whose grace ran out, otherwise the stored word as it came. */
export function visibleEntitlementStatus(): string {
  if (dissolvedThisRun) return DISSOLVED;
  hydrateSync();
  if (memActivated !== true) return "unregistered";
  if (memStatus === ACTIVE && (memInert || activeGraceExpired())) return "hidden";
  return memStatus;
}

/** This process dissolved: it asks, measures and writes nothing until the app
 *  restarts. */
export function isDissolvedThisRun(): boolean {
  return dissolvedThisRun;
}

/** The stored answer is `dissolved` and it was written by an EARLIER run: the
 *  one state in which this run must ask once, as a fresh install would. */
export function isAwaitingAskAfterDissolve(): boolean {
  if (isBoosthisDisabled() || dissolvedThisRun) return false;
  hydrateSync();
  return memActivated === true && memStatus === DISSOLVED;
}

/** DISSOLVED: in this run, or by a record an earlier run wrote that no answer
 *  has replaced yet. The kit is unhooked, so every request, page and read
 *  reaches the app exactly as it would without the kit. */
export function isKitDissolved(): boolean {
  return dissolvedThisRun || isAwaitingAskAfterDissolve();
}

/** How the kit UI should present the current gate. Distinct from the boolean
 *  `isRuntimeInert()` measuring gate: measuring/uploads are ALWAYS off when
 *  inert, but the owner's UX requirement is that a REVOKED or UNPAID project is
 *  shown as VISIBLY LOCKED (a blocking overlay in the dev bubble panel), not
 *  silently gone.
 *
 *  - "none"    — not inert (or the env kill-switch, which stays a SILENT total
 *                off-switch): render normally / render nothing.
 *  - "hidden"  — inert, but the kit must vanish rather than show a lock overlay
 *                (env kill-switch, tampered, grace-expired offline). NOT the
 *                never-checked-in case.
 *  - "unregistered" — running, but no check-in has ever succeeded. The bubble
 *                DRAWS and the panel renders its own "Not registered yet"
 *                notice: no lock overlay, nothing measured or uploaded (that
 *                gate is `inert`). See docs/kit-bubble-draw-contract.md.
 *  - "revoked" — the account owner revoked this project's access. Blocking
 *                overlay; the bubble stays visible and opens straight to it.
 *  - "unpaid"  — the account's subscription is unpaid/frozen. Same visible-lock
 *                treatment with payment-oriented copy.
 *  - "paused"  — the owner paused (reversible) — calm blocking notice.
 *  - "dissolved" — the project stayed locked past its owner's delay: the kit
 *                erased what it kept here and stopped until the app restarts.
 *                A plain notice that says exactly that. */
export type EntitlementGateKind =
  | "none"
  | "unregistered"
  | "hidden"
  | "revoked"
  | "unpaid"
  | "paused"
  | "dissolved";

/**
 * Classify how the kit UI should present the gate (see `EntitlementGateKind`).
 * SYNCHRONOUS. The env kill-switch always resolves to "hidden" (it must stay a
 * silent, total off-switch — never a visible overlay).
 */
export function getEntitlementGateKind(): EntitlementGateKind {
  if (isBoosthisDisabled()) return "hidden";
  if (dissolvedThisRun) return "dissolved";
  if (!isRuntimeInert()) return "none";
  // Never handshaken (ACTIVATION LOCK). NOT a silent state: the bubble draws
  // and the panel renders its own "Not registered yet" notice, which is the
  // only readable explanation a developer gets when the check-in cannot
  // complete at all. Measuring/uploading stay gated on `inert`, untouched.
  // See docs/kit-bubble-draw-contract.md.
  if (memActivated !== true) return "unregistered";
  switch (memStatus) {
    case "revoked":
      return "revoked";
    case "unpaid":
      return "unpaid";
    case "paused":
      return "paused";
    case "dissolved":
      return "dissolved";
    // "active" here means the offline grace window lapsed: no server verdict to
    // explain → vanish. "tampered" also hides (no user-facing overlay copy), and
    // so does a word this kit does not know: it is a lock with nothing readable.
    default:
      return "hidden";
  }
}

/**
 * @internal Killed-only variant of the gate: TRUE when the env kill-switch, a
 * non-active server answer, or a lapsed grace window silences the kit — but NOT
 * when the kit is merely LOCKED (never activated). Used only by the
 * consent/registration transmit path so a fresh install can still register.
 */
export function _isRuntimeKilledInternal(): boolean {
  if (isBoosthisDisabled()) return true;
  // Dissolved in THIS process: nothing asks again until the app restarts.
  if (dissolvedThisRun) return true;
  // Dissolved by an EARLIER run: this run asks once, as a fresh install would,
  // and the registration reply carries the answer. The erase took the
  // credential, so a registration is the only way to ask.
  if (memStatus === DISSOLVED) return false;
  // A real server answer — revoked / unpaid / paused / tampered, or a word this
  // kit does not know. Sticky, and registration is not a way around it.
  if (memStatus !== ACTIVE) return memInert;
  // Inert under an ACTIVE answer can only be a grace window that ran out. That
  // term is the one that can trap an install for good, because registration is
  // the only way back and this gate stands in front of it: an install holding
  // NO credential cannot check in either (the check-in needs the token it has
  // not got), so refusing its registration leaves nothing that could ever
  // clear the state. So a lapsed grace silences the install that EARNED it,
  // and no other — which is also what the comment above has always claimed.
  if (!(memInert || activeGraceExpired())) return false;
  return hasCheckinConfig();
}

/** True once this copy has proven a completed server handshake. */
export function isActivated(): boolean {
  return memActivated === true;
}

/** Whether a check-in could even be attempted: telemetry configured AND a
 *  registration token on hand. Lets a caller tell "we never asked because
 *  there is nothing to ask with" apart from "we asked and got no answer" —
 *  the difference between an unconfigured app and an unreachable server. */
export function hasCheckinConfig(): boolean {
  if (credentialForTests !== undefined) return credentialForTests !== null;
  const cfg = config;
  if (!cfg) return false;
  try {
    const token = cfg.getToken();
    return typeof token === "string" && token !== "";
  } catch {
    return false; // a throwing getter is treated as "no credential"
  }
}

let credentialForTests: string | null | undefined = undefined;

/** @internal test hook — stand in for a registration that has (not) landed.
 *  The sibling of the same hook in the RN and web kits. */
export function _setInstallCredentialForTests(
  token: string | null | undefined,
): void {
  credentialForTests = token;
}

function clampGrace(graceSeconds: number): number {
  let g = graceSeconds;
  if (!(g > 0)) g = DEFAULT_GRACE_SECONDS;
  if (g > MAX_GRACE_SECONDS) g = MAX_GRACE_SECONDS;
  return g;
}

/** Read a monotonic clock, never throwing — the synchronous gate stays crash-
 *  proof. */
function monoNow(): number {
  try {
    return perfHooks.now();
  } catch {
    return Date.now();
  }
}

function recordActiveTiming(
  checkedAt: number,
  graceSeconds: number,
  maxSeenWallMs?: number,
): void {
  memCheckedAt = checkedAt;
  memGraceSeconds = clampGrace(graceSeconds);
  memInitialAgeMs = Math.max(0, Date.now() - checkedAt);
  memMonoAt = monoNow();
  memMaxSeenWall =
    typeof maxSeenWallMs === "number" && maxSeenWallMs > checkedAt
      ? maxSeenWallMs
      : checkedAt;
}

function clearActiveTiming(): void {
  memCheckedAt = null;
  memMonoAt = null;
  memInitialAgeMs = 0;
  memMaxSeenWall = null;
}

/** True iff we hold an ACTIVE answer whose grace window has now lapsed.
 *  Effective age = MAX(wall delta, monotonic age, high-water age) so rolling
 *  the clock backward can only make the kit expire sooner, never later. */
function activeGraceExpired(): boolean {
  if (memStatus !== "active" || memCheckedAt === null) return false;
  const wallAgeMs = Date.now() - memCheckedAt;
  const monoAgeMs =
    memMonoAt === null
      ? Number.NEGATIVE_INFINITY
      : memInitialAgeMs + (monoNow() - memMonoAt);
  const highWaterAgeMs =
    memMaxSeenWall === null
      ? Number.NEGATIVE_INFINITY
      : memMaxSeenWall - memCheckedAt;
  const ageMs = Math.max(wallAgeMs, monoAgeMs, highWaterAgeMs);
  if (ageMs < 0) return false;
  return ageMs > memGraceSeconds * 1000;
}

function maybeExpireActiveGrace(): void {
  if (!memInert && activeGraceExpired()) {
    memInert = true;
    notify();
  }
}

/** Write the last-good answer to whatever store this host has. Best-effort by
 *  design: on a function with nothing writable there is simply nowhere to put
 *  it, and that is not an error — the next cold start gets its answer on the
 *  registration reply instead. */
async function persistCache(cache: EntitlementCache): Promise<void> {
  try {
    await storage.set(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* cache write failure is non-fatal */
  }
}

async function bumpAndPersistMaxSeenWall(): Promise<void> {
  if (memStatus !== "active" || memCheckedAt === null) return;
  const now = Date.now();
  if (memMaxSeenWall !== null && now <= memMaxSeenWall) return;
  memMaxSeenWall = now;
  try {
    const cache: EntitlementCache = {
      status: "active",
      checkedAt: memCheckedAt,
      graceSeconds: memGraceSeconds,
      maxSeenWallMs: memMaxSeenWall,
    };
    await storage.set(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* non-fatal — the in-memory high-water mark already advanced */
  }
}

async function onOfflineCheckin(): Promise<void> {
  await bumpAndPersistMaxSeenWall();
  maybeExpireActiveGrace();
}

/** Last known entitlement status (cached). For the panel's inert message. */
export function getEntitlementStatus(): EntitlementStatus {
  return memStatus;
}

/** Human-readable reason for the current non-active status, if any. */
export function getEntitlementMessage(): string | null {
  if (!isBoosthisDisabled() && memActivated !== true && !memInert) {
    return isAwaitingFirstAnswer() ? AWAITING_MESSAGE : LOCKED_MESSAGE;
  }
  return memMessage;
}

/* ─── Hydration from cache ────────────────────────────────────────────── */

function applyCache(cache: EntitlementCache): void {
  memActivated = true;
  memStatus = cache.status;
  memMessage =
    cache.status !== ACTIVE && typeof cache.message === "string" && cache.message
      ? cache.message
      : null;
  memRecheckAt =
    cache.status !== ACTIVE && typeof cache.recheckAt === "number"
      ? cache.recheckAt
      : null;
  if (cache.status !== ACTIVE) {
    memInert = true;
    clearActiveTiming();
    return;
  }
  let checkedAt = cache.checkedAt;
  const ageMs = Date.now() - checkedAt;
  if (ageMs < 0) {
    if (-ageMs <= CLOCK_SKEW_TOLERANCE_MS) {
      checkedAt = Date.now();
    } else {
      memInert = true;
      clearActiveTiming();
      return;
    }
  }
  recordActiveTiming(checkedAt, cache.graceSeconds, cache.maxSeenWallMs);
  memInert = activeGraceExpired();
  // A saved verdict still inside its grace opens the lock from the first
  // moment; an expired one has not opened it, so starting rows still wait.
  if (!memInert) everActive = true;
}

/**
 * Read the cached last-good answer into the in-memory gate. Idempotent — runs
 * its real work at most once. No valid cache ⇒ the ACTIVATION LOCK stays
 * engaged (fail-closed). Never throws.
 */
export function hydrateEntitlement(): Promise<void> {
  try {
    hydrateSync();
  } catch {
    /* never throws into the host */
  }
  return Promise.resolve();
}

/**
 * Read a stored answer into the gate. Any word the server once sent counts
 * (an unknown one reads as a lock, exactly as when it arrived); only a record
 * with no word or no time is no answer at all. Returns whether one was read.
 */
function applyStoredAnswer(raw: string | null): boolean {
  if (!raw) return false;
  const parsed = JSON.parse(raw) as Partial<EntitlementCache>;
  if (
    !parsed ||
    typeof parsed.status !== "string" ||
    parsed.status === "" ||
    typeof parsed.checkedAt !== "number"
  ) {
    return false;
  }
  applyCache({
    status: parsed.status,
    checkedAt: parsed.checkedAt,
    graceSeconds:
      typeof parsed.graceSeconds === "number"
        ? parsed.graceSeconds
        : DEFAULT_GRACE_SECONDS,
    maxSeenWallMs:
      typeof parsed.maxSeenWallMs === "number" ? parsed.maxSeenWallMs : undefined,
    message: typeof parsed.message === "string" ? parsed.message : null,
    recheckAt: typeof parsed.recheckAt === "number" ? parsed.recheckAt : undefined,
  });
  return true;
}

/**
 * The one read of the stored answer, SYNCHRONOUS so `isKitLocked()` can make
 * it too: a hook that fires before the check-in starts must still know a
 * stored lock, or a restarted kit would measure its first requests under one.
 * The store reads synchronously already (the async form was this same read in
 * a promise). Runs its real work at most once, and never throws.
 *
 * NOTHING WRITABLE. On a function host there is no cache and there never was
 * one — reading its absence as "we lost the last answer" is what turns a
 * healthy function into a kit that locks itself and goes quiet. Skip the read,
 * record that we are WAITING for a first answer rather than locked out of one,
 * and let the registration reply (which arrives in this same invocation,
 * carrying the entitlement) settle it.
 */
function hydrateSync(): void {
  if (hydrated) return;
  let activated = false;
  try {
    if (!storageDurable()) {
      awaitingFirstAnswer = true;
    } else {
      activated = applyStoredAnswer(storage.getSync(CACHE_KEY));
    }
  } catch {
    /* storage unreadable ⇒ LOCKED (fail-closed, the activation lock holds) */
  }
  // Never DOWNGRADE a live server answer.
  if (memActivated !== true) memActivated = activated;
  hydrated = true;
  // Told after the caller's read finishes, never inside it: a listener may
  // itself read the gate.
  queueMicrotask(notify);
}

/* ─── The check-in (recovery path — never gated by inert) ──────────────── */

/** The grace an answer may grant: what it stated, held to the shared seven
 *  days; the default when it stated none or a negative one. */
function cappedGrace(value: unknown): number {
  const g =
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : DEFAULT_GRACE_SECONDS;
  return Math.min(g, MAX_GRACE_SECONDS);
}

/** When a locked kit may ask again: what the answer's recheckAfterSeconds
 *  says, and never sooner than this kit's own check-in interval. */
function recheckAt(recheckAfterSeconds: unknown): number {
  const waitMs =
    typeof recheckAfterSeconds === "number" &&
    Number.isFinite(recheckAfterSeconds) &&
    recheckAfterSeconds > 0
      ? recheckAfterSeconds * 1000
      : 0;
  const interval = config?.intervalMs ?? DEFAULT_INTERVAL_MS;
  return Date.now() + Math.max(waitMs, interval);
}

/** A lock named when to ask again, this process has already asked once, and
 *  that time has not come. Only a restart's first check asks sooner. */
function recheckWaiting(): boolean {
  return (
    askedThisRun &&
    memStatus !== ACTIVE &&
    memRecheckAt !== null &&
    Date.now() < memRecheckAt
  );
}

/**
 * Keep a received answer and act on it — the ONE path every answer takes (a
 * check-in, a named cut, a registration reply), so they can never drift apart.
 * The word is kept exactly as it came; only `success` (an exact `active`) lets
 * the kit run, so a word this kit does not know is a lock, never a no-op that
 * leaves an earlier `active` standing.
 *
 * The state flips synchronously, before anything awaits, so every door reads
 * the new answer at once.
 */
async function store(
  status: string,
  message: string | null,
  graceSeconds: number,
  success: boolean,
  recheckAfterSeconds?: unknown,
): Promise<EntitlementStatus> {
  const wasLocked = isKitLocked();
  const wasInert = isRuntimeInert();
  const now = Date.now();
  const grace = clampGrace(graceSeconds);
  awaitingFirstAnswer = false;
  memActivated = true;
  hydrated = true; // this answer IS the truth — never hydrate a cache over it
  memStatus = status;
  memMessage = success ? null : message;
  if (success) {
    everActive = true;
    recordActiveTiming(now, grace);
    memInert = false;
    memRecheckAt = null;
  } else {
    memInert = true;
    clearActiveTiming();
    memRecheckAt = recheckAt(recheckAfterSeconds);
  }
  if (isRuntimeInert() !== wasInert || isKitLocked() !== wasLocked) notify();
  if (status === DISSOLVED) {
    await dissolve(message);
    return DISSOLVED;
  }
  if (!success) {
    lockDown();
  } else if (wasLocked && handlers) {
    // An active answer ends a lock: put back what the lock took off.
    const h = handlers;
    runStep(() => h.rearm());
  }
  await persistCache({
    status,
    checkedAt: now,
    graceSeconds: grace,
    ...(success
      ? { maxSeenWallMs: now }
      : { message, recheckAt: memRecheckAt ?? undefined }),
  });
  return status;
}

/** LOCKED. Every collector already reads `isKitLocked()` at its door; this
 *  takes the kit's listeners off and throws away what it held. */
function lockDown(): void {
  const h = handlers;
  if (!h) return;
  runStep(() => h.unhook("locked"));
  runStep(() => h.clearSamples());
  runStep(() => h.clearChecks());
}

/**
 * DISSOLVED. In this order: stop asking, take the hooks off, throw away what is
 * held, run the kit's built-in erase (the local part only — the server's forget
 * call is never made, so the project's history on Boosthis is kept), and only
 * then write the one record that says so, so a restart knows to ask once. The
 * process flag goes first, so nothing measures or writes while the erase runs.
 */
async function dissolve(message: string | null): Promise<void> {
  dissolvedThisRun = true;
  stopTimer();
  const h = handlers;
  if (h) {
    runStep(() => h.unhook("dissolved"));
    runStep(() => h.clearSamples());
    runStep(() => h.clearChecks());
    try {
      await h.removeLocal();
    } catch {
      /* an erase that failed part-way must not break the host */
    }
  }
  await persistCache({
    status: DISSOLVED,
    checkedAt: Date.now(),
    graceSeconds: DEFAULT_GRACE_SECONDS,
    message,
    askAgain: ASK_AGAIN,
  });
  try {
    console.warn(
      `[boosthis] ${message || "This project stayed locked past its delay."} ` +
        "The kit has erased what it stored on this machine and stopped; it asks again when the app restarts.",
    );
  } catch {
    /* a host that replaced console must not break the stop */
  }
  notify();
}

/**
 * Adopt an entitlement answer that arrived on ANOTHER reply — specifically the
 * registration reply, which a function-hosted kit sends on every cold start
 * anyway.
 *
 * This is what collapses the cold path: the server already knows the
 * entitlement when it answers a registration, so carrying it back costs nothing
 * and saves a whole round trip on a request that may only live 200 ms. The
 * answer is applied through exactly the same path as a check-in answer — same
 * grace clock, same sticky non-active states, same lock and dissolve steps — so
 * there is one verdict, not two. It is also cached, so a warm instance with a
 * scratch directory need not ask again. It counts as this run's ask.
 */
export function adoptEntitlementAnswer(answer: {
  status: EntitlementStatus;
  graceSeconds?: number;
  message?: string | null;
  recheckAfterSeconds?: number;
}): void {
  if (isBoosthisDisabled() || dissolvedThisRun) return;
  const status = answer.status;
  if (typeof status !== "string" || status === "") return; // no word, no answer
  askedThisRun = true;
  void store(
    status,
    typeof answer.message === "string" ? answer.message : null,
    cappedGrace(answer.graceSeconds),
    status === ACTIVE,
    answer.recheckAfterSeconds,
  ).catch(() => {
    /* never throw into the host */
  });
}

/** POST the check-in, bounded by a Promise.race timer (NO AbortController). */
async function postCheckin(
  cfg: EntitlementCheckinConfig,
  token: string,
  timeoutOverrideMs?: number,
): Promise<Response | null> {
  const f =
    cfg.fetchImpl ??
    (typeof fetch === "function" ? (fetch as typeof fetch) : undefined);
  // No usable fetch → return null (no server status to apply), like an offline
  // tick. The check-in must never throw on a transport problem.
  if (!f) return null;
  const url = `${cfg.endpoint.replace(/\/$/, "")}/entitlements/check`;
  const body: {
    installId: string;
    kitVersion: string;
    understands: readonly string[];
    integrity?: { status: "ok" | "mismatch"; manifestHash?: string };
  } = {
    installId: cfg.installId,
    kitVersion: cfg.kitVersion,
    understands: UNDERSTANDS,
  };
  const integ = cfg.integrity;
  if (integ && (integ.status === "ok" || integ.status === "mismatch")) {
    body.integrity = {
      status: integ.status,
      ...(typeof integ.manifestHash === "string" && integ.manifestHash
        ? { manifestHash: integ.manifestHash }
        : {}),
    };
  }
  // Defence-in-depth: the payload is fully code-defined, but run the shared PII
  // guard anyway. A hit means abort the send (never throw).
  if (checkNoPII(body)) return null;
  // An exit flush passes its own, much shorter budget: the ordinary check-in
  // timeout is time a shutting-down process does not have.
  const timeoutMs =
    typeof timeoutOverrideMs === "number" && timeoutOverrideMs > 0
      ? timeoutOverrideMs
      : (cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), timeoutMs).unref?.(),
  );
  const req = Promise.resolve()
    .then(() =>
      f(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      }),
    )
    .catch(() => null);
  return Promise.race([req, timeout]);
}

/**
 * What a refused check-in SAYS — read from its frozen machine-readable fields
 * only, never from prose.
 *
 * A refusal that NAMES a deliberate cut is an ANSWER, not an outage. Without
 * this, a revoked install can never learn it was revoked: the only check that
 * would tell it authenticates with the very credential the revoke just cut, so
 * the kit sees a bare 401, treats it exactly like an unreachable server, and
 * goes on reporting itself ACTIVE forever.
 *
 * ONLY the exact `credentials_cut` code counts as a cut. A REPLACED credential
 * — another copy of this install reconnected and took the credential — also
 * answers 401, and that is never an answer about entitlement: it falls through
 * to the offline path, exactly as before. When the refusal says so in its own
 * field (`credentialRefusal: "mismatch"`), the check-in renews the credential
 * once and asks again. A missing credential, one Boosthis holds nothing for,
 * and silence renew nothing. Reading the body can never throw into the host.
 */
async function readCheckinRefusal(
  res: { status: number; json: () => Promise<unknown> } | null,
  readMs?: number,
): Promise<{
  cut: { status: EntitlementStatus; message: string | null } | null;
  mismatch: boolean;
} | null> {
  if (!res || res.status !== 401) return null;
  try {
    // Bounded while reading: an answer over the ceiling, too slow or not JSON
    // is unreadable, and an unreadable refusal is an outage, never an answer.
    const body = (await readAnswerJson(res, { timeoutMs: readMs })) as {
      error?: unknown;
      reason?: unknown;
      detail?: unknown;
      credentialRefusal?: unknown;
    } | null;
    if (!body || typeof body !== "object") return null;
    if (body.error !== "credentials_cut") {
      return { cut: null, mismatch: body.credentialRefusal === "mismatch" };
    }
    const reason = body.reason;
    // A cut is never "active", whatever the body says.
    const status: EntitlementStatus =
      reason === "revoked" ||
      reason === "unpaid" ||
      reason === "tampered" ||
      reason === "paused"
        ? reason
        : "revoked";
    return {
      cut: {
        status,
        message: typeof body.detail === "string" ? body.detail : null,
      },
      mismatch: false,
    };
  } catch {
    return null; // unreadable body ⇒ an outage, never an answer
  }
}

/**
 * Run ONE check-in using the installed config. Returns the resolved status, or
 * null when the check couldn't complete. A null result deliberately leaves the
 * cached state intact — only an explicit server answer changes it (fail-open /
 * sticky-kill).
 *
 * NOTE: intentionally NOT gated by `isRuntimeInert()` — this is the path by
 * which a revoked install learns it has been restored.
 */
export async function checkEntitlementNow(
  timeoutOverrideMs?: number,
): Promise<EntitlementStatus | null> {
  // A check-in with its own short budget (an exit flush) never renews: a
  // renewal is a round trip that budget was never sized for, and the next run
  // renews instead.
  return checkEntitlementOnce(timeoutOverrideMs, timeoutOverrideMs === undefined);
}

async function checkEntitlementOnce(
  timeoutOverrideMs: number | undefined,
  mayRenew: boolean,
): Promise<EntitlementStatus | null> {
  if (isBoosthisDisabled()) return null;
  // Dissolved in this process: nothing asks again until the app restarts.
  if (dissolvedThisRun) return DISSOLVED;
  const cfg = config;
  if (!cfg) return null;
  // A lock says when to ask again (recheckAfterSeconds, never sooner than this
  // kit's own interval), so a forced check — the panel opening, an exit flush,
  // the heartbeat — asks no sooner either. A restart's first check always asks.
  if (recheckWaiting()) return memStatus;
  const token = cfg.getToken();
  if (!token) return null; // not registered yet — the kit stays LOCKED
  try {
    askedThisRun = true;
    const res = await postCheckin(cfg, token, timeoutOverrideMs);
    if (config !== cfg || isBoosthisDisabled()) return null;
    // An exit flush's short budget covers reading the answer too.
    const readMs =
      typeof timeoutOverrideMs === "number" && timeoutOverrideMs > 0
        ? timeoutOverrideMs
        : undefined;
    if (!res || !res.ok) {
      const refusal = await readCheckinRefusal(res, readMs);
      if (config !== cfg || isBoosthisDisabled()) return null;
      // A refusal that NAMES a deliberate cut is an ANSWER, not an outage —
      // and never `active`, whatever it says.
      if (refusal?.cut) {
        cfg.onVerdict?.(refusal.cut.status);
        return store(
          refusal.cut.status,
          refusal.cut.message,
          DEFAULT_GRACE_SECONDS,
          false,
        );
      }
      // A CREDENTIAL ANOTHER COPY REPLACED. Renewed once, through the same
      // renewal the upload paths share, and asked again with the fresh one.
      // (The renewal's own registration reply may already have checked in
      // with it; a second answer to the same question changes nothing.)
      if (mayRenew && refusal?.mismatch && cfg.renewCredential) {
        let fresh: string | null = null;
        try {
          fresh = await cfg.renewCredential(token);
        } catch {
          fresh = null;
        }
        if (fresh && fresh !== token) {
          return checkEntitlementOnce(timeoutOverrideMs, false);
        }
      }
      // Unreachable / bare 401 / 429 → keep the cached answer, advance the
      // high-water marker, and let a lapsed active grace expire.
      await onOfflineCheckin();
      return null;
    }
    // Bounded while reading. A refused answer lands in the catch below: kept
    // cache, offline path, asked again on the next check-in.
    const data = (await readAnswerJson(res, { timeoutMs: readMs })) as {
      status?: unknown;
      graceSeconds?: unknown;
      message?: unknown;
      recheckAfterSeconds?: unknown;
    } | null;
    if (config !== cfg || isBoosthisDisabled()) return null;
    // No word at all is no answer (kept cache, asked again later). ANY word is
    // an answer: kept exactly as it came, and only an exact `active` runs.
    const answer = typeof data?.status === "string" ? data.status : "";
    if (answer === "") return null;
    const grace = cappedGrace(data?.graceSeconds);
    const message = typeof data?.message === "string" ? data.message : null;
    const stored = await store(answer, message, grace, answer === ACTIVE, data?.recheckAfterSeconds);
    cfg.onVerdict?.(stored);
    return stored;
  } catch {
    await onOfflineCheckin();
    return null; // never let a check-in throw into the host
  }
}

/**
 * Trigger a FRESH server entitlement check — the on-open / cold-start
 * enforcement edge of the VAULT contract. Unlike the cached synchronous gate,
 * this always attempts to reconfirm with the server (subject to the throttle);
 * it does NOT short-circuit on a cache-satisfied "active" answer.
 *
 * Non-blocking, fully self-guarded (never throws into the host, no
 * AbortController, Promise.race-bounded fetch). The verdict is applied by
 * `checkEntitlementNow()` when it lands, flipping the synchronous gate +
 * notifying subscribers so the open panel re-reads (a revoked verdict arriving
 * while the panel is open swaps it to the blocking lock overlay).
 *
 * Offline / unreachable stays UNCHANGED: a network failure keeps the cached
 * answer + grace window, so a transient outage can never brick a paying app —
 * EXCEPT a sticky revoked/killed answer, which the cache holds inert.
 *
 * @param force When true (cold start / init), bypass the throttle. When
 *   false/omitted (on-open), dispatch at most once per FORCE_CHECK_THROTTLE_MS.
 */
export function forceEntitlementCheck(force = false): void {
  if (isBoosthisDisabled()) return;
  if (!config) return;
  if (!force) {
    const now = monoNow();
    if (
      lastForcedCheckAt !== null &&
      now - lastForcedCheckAt < FORCE_CHECK_THROTTLE_MS
    ) {
      return; // throttled — a forced check ran within the window
    }
    lastForcedCheckAt = now;
  } else {
    // A forced (launch) check resets the throttle window so an on-open check
    // immediately after cold start doesn't fire a redundant second knock.
    lastForcedCheckAt = monoNow();
  }
  void checkEntitlementNow().catch(() => null).finally(scheduleFirstVerdict);
}

/* ─── Lifecycle (called by enableTelemetry / forget) ──────────────────── */

/**
 * Install the check-in config and start the heartbeat: hydrate the cache, run
 * an immediate FORCED launch check-in, then poll on an interval. Safe to call
 * repeatedly — it replaces any prior config and timer. All async work is fire-
 * and-forget and self-guarded so it can never crash the host.
 */
export function startEntitlementCheckin(cfg: EntitlementCheckinConfig): void {
  config = cfg;
  stopTimer();
  firstStep = 0;
  // Dissolved in this process: nothing asks again until the app restarts.
  if (dissolvedThisRun) return;

  // SERVERLESS. "Start-up" happens on every cold start, so a launch check here
  // would put a blocking network call in front of every cold request — on a
  // function that answers in 200 ms, that is not overhead, that is the
  // workload. And a six-hourly heartbeat cannot fire in a process that is
  // frozen the moment it answers. So neither runs: the entitlement rides back
  // on the registration reply the kit was already going to send
  // (`adoptEntitlementAnswer`), which is why being alive costs one round trip
  // rather than two.
  if (isServerlessMode()) {
    void hydrateEntitlement().catch(() => {
      /* never throw into the host */
    });
    return;
  }

  void (async () => {
    try {
      await hydrateEntitlement();
      if (config !== cfg || isBoosthisDisabled()) return;
      // Cold-start / init enforcement edge (VAULT contract): a FORCED launch
      // check that bypasses the cache-satisfied fast path.
      await checkEntitlementNow();
      scheduleFirstVerdict();
    } catch {
      /* never throw into the host */
    }
  })();
  // A launch check just ran — seed the throttle so an immediate on-open check
  // doesn't fire a redundant second knock.
  lastForcedCheckAt = monoNow();
  const interval = cfg.intervalMs ?? DEFAULT_INTERVAL_MS;
  timer = setInterval(() => {
    void checkEntitlementNow().catch(() => null).finally(scheduleFirstVerdict);
  }, interval);
  // Don't keep the process alive just for the heartbeat.
  (timer as unknown as { unref?: () => void }).unref?.();
}

function stopTimer(): void {
  if (firstTimer) clearTimeout(firstTimer);
  firstTimer = null;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Stop the heartbeat and drop the config. Called from `forget()`. */
export function stopEntitlementCheckin(): void {
  stopTimer();
  config = null;
}

/**
 * Erase the persisted entitlement cache and RE-LOCK the kit. Called from
 * `forget()`. Best-effort, never throws.
 */
export async function clearEntitlementCache(): Promise<void> {
  const wasInert = isRuntimeInert();
  memActivated = false;
  memStatus = ACTIVE;
  memInert = false;
  memMessage = null;
  memRecheckAt = null;
  clearActiveTiming();
  memGraceSeconds = DEFAULT_GRACE_SECONDS;
  hydrated = true; // the (now empty) state IS the truth — don't rehydrate over it
  try {
    await storage.remove(CACHE_KEY);
  } catch {
    /* storage failure is non-fatal — the in-memory lock is already engaged */
  }
  if (isRuntimeInert() !== wasInert) notify();
}

/* ─── Test helpers ────────────────────────────────────────────────────── */

/** Reset ALL module state to first-run defaults (pre-hydration ⇒ LOCKED). */
export function _resetEntitlementForTests(): void {
  everActive = false;
  stopTimer();
  config = null;
  memActivated = null;
  memStatus = ACTIVE;
  memInert = false;
  memMessage = null;
  memCheckedAt = null;
  memGraceSeconds = DEFAULT_GRACE_SECONDS;
  memInitialAgeMs = 0;
  memMonoAt = null;
  memMaxSeenWall = null;
  memRecheckAt = null;
  askedThisRun = false;
  dissolvedThisRun = false;
  lastForcedCheckAt = null;
  hydrated = false;
  listeners.clear();
}

/** Stand in for a process restart: forget everything this run knew (the
 *  dissolve flag, the asked-once flag, the in-memory answer) but keep what is
 *  stored, so the next read loads it the way a restarted app would. */
export function _restartEntitlementForTests(): void {
  const keptHandlers = handlers;
  _resetEntitlementForTests();
  handlers = keptHandlers;
}

/** Force the in-memory gate (bypasses cache/network) for assertions. */
export function _setEntitlementStateForTests(
  status: EntitlementStatus,
  inert: boolean,
  message: string | null = null,
): void {
  if (status === "active" && !inert) everActive = true;
  memActivated = true;
  memStatus = status;
  memInert = inert;
  memMessage = message;
  memRecheckAt = null;
  memCheckedAt = null;
  memGraceSeconds = DEFAULT_GRACE_SECONDS;
  memInitialAgeMs = 0;
  memMonoAt = null;
  memMaxSeenWall = null;
  hydrated = true;
  notify();
}

export function hasBeenActiveInThisRun(): boolean {
  return everActive;
}
