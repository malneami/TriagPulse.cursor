/** Opt-in telemetry client for the Node runtime.
 *
 * Faithful port of `lib/boosthis-runtime-rn/src/telemetry.ts`. `enableTelemetry`
 * registers an invited Node/Express app with the central Boosthis server so it
 * appears in the maintainer's /admin dashboard, then reports — exactly like the
 * RN and Python runtimes:
 *
 *   - privacy-safe issue signatures (candidates) and fix resolutions:
 *     ALWAYS-ON once registered (not gated by the enable/disable toggle);
 *   - optional full per-route samples: only in full-telemetry mode, stopped by
 *     `disable()` / `issuesOnly`.
 *
 * Node has no production sampler (that is an RN-only concept), so issuesOnly
 * here simply means "never queue or ship full samples". The kill-switch
 * (`BOOSTHIS_DISABLED`) and `forget()` are the only things that stop the
 * always-on issue + fix channel.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { assertNoPII, checkNoPII, transmitLabelHasPII, PIIDetectedError } from "./no-pii";
import { isDoorWord, type DoorWord } from "./routeDoor";
import { readAnswerJson } from "./answerRead";
import {
  REGISTRATION_RETRY_SCHEDULE_MS,
  FIRST_VERDICT_SCHEDULE_MS,
  RENEWAL_RETRY_SCHEDULE_MS,
  RENEWAL_ANSWERED_WAIT_MS,
  retryWait,
  temporaryConsentStatus,
} from "./retrySchedule";
import {
  MAX_PART_NAME,
  warnPartNameRefusal,
} from "./routeInventory";
import { dependencyKindFor, looksLikeAddress } from "./dependencyKinds";
import {
  _safeTransmitInternal,
  _safeTransmitTrustedPayload,
  isNoSendResponse,
  type InternalPostOptions,
} from "./transmit";
import { RUNTIME_VERSION } from "./thresholds";
import { kitRuntimeTag } from "./runtimeTag";
import { isBoosthisDisabled } from "./runtimeFlags";
import {
  startEntitlementCheckin,
  stopEntitlementCheckin,
  clearEntitlementCache,
  forceEntitlementCheck,
  adoptEntitlementAnswer,
  checkEntitlementNow,
  isActivated,
  _isRuntimeKilledInternal,
  isAwaitingAskAfterDissolve,
  isDissolvedThisRun,
  isKitLocked,
  setKitLockHandlers,
  hasBeenActiveInThisRun,
} from "./killSwitch";
import { setUploadReadiness, type QueueAnswer } from "./uploadRecovery";
import {
  clearAllCandidates,
  setCandidateSubmitter,
  setResolutionSubmitter,
} from "./candidateRules";
import { clear as clearSampleRing, setSampleObserver } from "./samples";
import { detectServerKind } from "./serverKind";
import { hostingFacts } from "./hosting";
import { readDropsFromResponse } from "./dropReport";
import { clearDetectors, ignoreHost } from "./liveDetectors";
import { clearAiCalls } from "./aiCalls";
import { startEventLoopLag, clearEventLoopLag } from "./eventLoopLag";
import { armForkChurn, clearCpuSchedulingMeters } from "./cpuSchedulingMeters";
import { armReadyWatch, disarmReadyWatch } from "./readyToServe";
import {
  startVitals,
  clearVitals,
  captureColdStart,
  captureStartupImport,
} from "./runtimeVitals";
import { startExtraMeters, clearExtraMeters } from "./extraMeters";
import { resetRouteOutcomes } from "./routeOutcomes";
import { armJobSystems } from "./jobAdapters";
import { coverageFingerprint, coverageInventory } from "./coverageInventory";
// Leaf module (it imports only serverKind), so reading the attach's verdict
// here closes no import ring: serverAttach imports this file, never the other
// way round.
import { attachWasRefused } from "./attachStatus";
import { clearCommunityCache } from "./community";
import { clear as clearFeedbackLog } from "./feedback";

/** Stable id for one sanitized crash batch. Retrying the same buffered batch
 * must reproduce this value; minting per HTTP attempt would defeat server
 * idempotency after a lost 202 response. */
export function crashDeliveryId(
  installId: string,
  crashes: readonly CrashReportPayload[],
): string {
  return createHash("sha256")
    .update(JSON.stringify({ installId, crashes }))
    .digest("hex");
}
import {
  captureBuildIdentity,
  clearBuildIdentity,
} from "./buildIdentity";
import {
  installExitFlush,
  isExitFlushRunning,
  setExitReadyHook,
  uninstallExitFlush,
} from "./exitFlush";
import {
  clearSampleSink,
  discardPendingSamples,
  onSample,
  pauseSampleQueue,
  pendingSampleCount,
  reportNow,
  resumeSampleQueue,
  setAutoTickEnabled,
  setCoverageRefreshHook,
  setSampleQueueIssuesOnly,
  setSampleSink,
} from "./reporting";
import {
  setSnapshotSubmitter,
  startSnapshotAutoUpload,
  stopSnapshotAutoUpload,
  uploadPerfSnapshotNow,
  type NodeSnapshotPayload,
} from "./snapshot";
import {
  setSpanSubmitter,
  startSpanAutoFlush,
  stopSpanAutoFlush,
  clearBufferedSpans,
  flushSpansNow,
  _spanInternals,
  MAX_SPAN_BATCH,
  type TraceSpan,
} from "./spanEmitter";
import {
  detachCrashHandlers,
  installCrashHandlers,
  setCrashCredentialReader,
  setCrashOwnerInstallId,
  setCrashSubmitter,
  uninstallCrashHandlers,
  type CrashReportPayload,
  type CrashSendIdentity,
} from "./crashReporter";
import { crashRefusalFor, noteCrashSendRefused } from "./crashDelivery";
import {
  clearPromiseDeclarations,
  parsePromiseDeclarationOutcomes as readPromiseOutcomes,
  MAX_PROMISE_DECLARATIONS,
  type PromiseDeclarationOutcome,
  type PromiseDeclarationReport,
} from "./promiseDeclaration";
import {
  clearBufferedJobRuns,
  clearJobRhythmDeclarations,
  flushJobRunsNow,
  parseExpectationOutcomes as readExpectationOutcomes,
  pendingJobRunCount,
  setJobRunSubmitter,
  startJobRunAutoFlush,
  stopJobRunAutoFlush,
  MAX_JOB_EXPECTATIONS,
  MAX_JOB_RUN_BATCH,
  MAX_JOB_RUN_TALLIES,
  type JobExpectationOutcome,
  type JobExpectationReport,
  type JobRunReport,
  type JobRunTallyReport,
  type JobSubmitOutcome,
} from "./jobReporter";
import {
  storage,
  storageBackend,
  storageDurable,
  storageKeyRestored,
} from "./storage";
import {
  deriveServerlessInstallId,
  isPerRunBilled,
  isServerlessMode,
  platformName,
  scopeHashFor,
  serverlessHost,
  serverlessRefusal,
} from "./serverless";
import {
  SERVERLESS_SNAPSHOT_MIN_MS,
  setInvocationFlush,
} from "./serverlessLifecycle";
import { kitShouldReduce, noteKitReduced, noteKitSetupCost } from "./kitFootprint";
import {
  clearKitProject,
  getKitProject,
  parseKitProject,
  serializeKitProject,
  setKitPromises,
  parseKitPromises,
  serializeKitPromises,
  setKitProject,
} from "./projectIdentity";
import {
  resolveProjectKey,
  type ResolvedProjectKey,
} from "./projectKey";
import { announceProjectKey } from "./startAnnounce";
import {
  checkRegistrationOnce,
  markRegistrationConfirmed,
  markRegistrationRefused,
  markRegistrationThrottled,
  markRegistrationUnreachable,
  _resetRegistrationForTests,
} from "./registration";
import {
  isCredentialMismatch,
  noteUploadRefusedOnce,
  readCredentialRefusal,
  type RefusalBody,
} from "./uploadRefusal";
import {
  clearUploadPauses,
  isLocalPauseAnswer,
  pacedUpload,
  type PausedUpload,
} from "./uploadPause";

export const DEFAULT_TELEMETRY_ENDPOINT = "https://www.boosthis.com/api";

/** One-shot guard so a registration that did not go through prints exactly ONE
 *  line per process — never on every consent retry. The Node runtime has no
 *  locked-screen UI (unlike RN), so this console line is the parity hint that
 *  tells the developer WHY Boosthis stayed inactive. It never carries the
 *  invite key, any endpoint, or any server text — only a coarse, code-defined
 *  reason derived from the HTTP status + the `invite_key_revoked` marker (and,
 *  on a transport failure, the runtime's own thrown error string — which is
 *  where a broken certificate store or a blocked egress actually shows up). */
let warnedRegistrationRejected = false;
let warnedProjectKeyOverride = false;
let panelProjectKey: ResolvedProjectKey = {
  key: null,
  source: "none",
  overrodeShared: false,
  display: null,
  declined: false,
};

export function getPanelProjectKey(): ResolvedProjectKey {
  return panelProjectKey;
}

/** The coarse, code-defined reasons a registration can fail to land. Each maps
 *  to a fixed [why, what-to-do] pair below — the ONLY strings this line emits.
 *   - `orphan`: HTTP 200 + `already_registered_no_token`, and rotation has
 *     already happened (or cannot), so the install can never upload.
 *   - `no-answer`: no HTTP answer at all (transport threw / status 0) — the
 *     DNS/TLS/egress case a silent kit turns into hours of guesswork.
 *   - `key-revoked`: 401/403 or an `invite_key_revoked` marker.
 *   - `throttled`: HTTP 429 — a TEMPORARY, self-clearing refusal with a
 *     deadline. Kept out of `refused` because it is the one refusal class
 *     nobody has to act on: it fixes itself, the kit is already waiting, and
 *     telling a developer to "check the project key" would send them to fix
 *     something that is not broken.
 *   - `refused`: any other non-OK status the server returned.
 *   - `attach-refused`: nothing was even asked of the server. `attach()` was
 *     called and said no, this process watches nothing else, so registering
 *     would create an install that can never report. The one reason here that
 *     is OURS rather than the server's.
 *   - `no-install-id` / `bad-install-id` / `no-derivable-install-id`: the kit
 *     could not settle an IDENTITY, so it refused to start. Also ours, and
 *     raised BEFORE anything is asked of the server. */
export type StayedInactiveReason =
  | "orphan"
  | "no-answer"
  | "revoked"
  | "paused"
  // The account's owner asked to close the account, so its keys are paused
  // for the grace window (an `account_closure_pending` marker). Kept apart
  // from "paused": there is no bill to settle, and the billing sentence sent a
  // developer to the wrong place.
  | "closing"
  | "unknown"
  | "key"
  | "no-key-missing"
  | "no-key-chosen"
  | "attach-refused"
  | "no-install-id"
  | "bad-install-id"
  | "no-derivable-install-id"
  | "throttled"
  | "refused";
let registrationRefusalKind: StayedInactiveReason | null = null;

/**
 * What came WITH that refusal — the HTTP code, the transport detail.
 *
 * Kept because every other surface re-renders the same hint from the kind
 * alone, and a hint rendered without its options fills the gap with a default.
 * The status page therefore told a developer "the server refused the
 * registration (HTTP 0)" while the console line, built from the same reason
 * one moment earlier, correctly said 503. Nothing on earth had answered 0: the
 * page invented a number. One sentence, one set of facts, every surface.
 */
let registrationRefusalOpts: {
  revoked?: boolean;
  status?: number;
  detail?: string;
  platform?: string;
  /** How long the server told us to wait, in seconds — only set for
   *  `"throttled"`. Read straight from its `Retry-After`, so the sentence a
   *  developer reads names the server's own deadline, never a guess. */
  retryAfterSeconds?: number;
} = {};
export function getRegistrationRefusalKind(): StayedInactiveReason | null {
  return registrationRefusalKind;
}

/** How long the server told a THROTTLED registration to wait, in seconds, or
 *  null for every other refusal. A number, never text: the panel builds its
 *  own words around it, so nothing a server said reaches a customer's screen
 *  (same contract as the uploads-failing `lost` count). */
export function getRegistrationRefusalRetryAfterSeconds(): number | null {
  if (registrationRefusalKind !== "throttled") return null;
  const s = registrationRefusalOpts.retryAfterSeconds;
  return typeof s === "number" && isFinite(s) && s > 0 ? Math.round(s) : null;
}

export function getRegistrationRefusalSentence(): string | null {
  try {
    if (registrationRefusalKind === null) return null;
    const [why, fix] = stayedInactiveHint(
      registrationRefusalKind,
      registrationRefusalOpts,
    );
    return `Boosthis stayed inactive because ${why}. ${fix}`;
  } catch {
    return null;
  }
}

/** Turn a caught transport error into a FIXED, kit-owned parenthetical for the
 *  no-answer line — never the error's own text. A TLS/proxy/HTTP client error
 *  message is NOT kit-generated: it can embed the request URL, a
 *  credential-bearing URL, or remote-supplied prose, so it must never reach the
 *  console line. We read the message + type name (lowercased) for MATCHING
 *  ONLY, then emit a phrase this kit owns. On no match we fall back to the
 *  error's TYPE/CLASS NAME (sanitised) — never the message. Guest-safe: never
 *  throws, never allocates unboundedly, never touches the network. Returns a
 *  string beginning with " (" and ending ")", or "" for no parenthetical. */
function transportErrorParenthetical(err: unknown): string {
  try {
    const message =
      err && typeof (err as { message?: unknown }).message === "string"
        ? ((err as { message: string }).message as string)
        : "";
    const typeName =
      err &&
      (err as { constructor?: { name?: unknown } }).constructor &&
      typeof (err as { constructor: { name?: unknown } }).constructor.name ===
        "string"
        ? ((err as { constructor: { name: string } }).constructor.name as string)
        : "";
    // Cap EACH input before it is copied or case-converted, so a pathological
    // message can never drive unbounded work inside a host's process.
    const hay = `${message.slice(0, 512)} ${typeName.slice(0, 128)}`.toLowerCase();
    const has = (needle: string): boolean => hay.indexOf(needle) !== -1;

    // First match wins.
    if (
      has("certificate") ||
      has("tls") ||
      has("ssl") ||
      has("x509") ||
      has("self signed") ||
      has("self-signed") ||
      has("unable to verify") ||
      has("certificate_verify_failed") ||
      has("sslhandshake") ||
      has("trust anchor") ||
      has("unable to get local issuer")
    ) {
      return " (the certificate store rejected the connection)";
    }
    if (
      has("getaddrinfo") ||
      has("name or service not known") ||
      has("enotfound") ||
      has("unknownhost") ||
      has("nodename nor servname") ||
      has("no such host") ||
      has("failed to resolve") ||
      has("dns")
    ) {
      return " (the API host name did not resolve)";
    }
    if (has("econnrefused") || has("connection refused")) {
      return " (the connection was refused)";
    }
    if (has("etimedout") || has("timeout") || has("timed out")) {
      return " (the connection timed out)";
    }
    if (has("proxy")) {
      return " (a proxy rejected the connection)";
    }
    if (
      has("enetunreach") ||
      has("network is unreachable") ||
      has("no route to host")
    ) {
      return " (the network was unreachable)";
    }

    // No match: emit the TYPE/CLASS NAME ONLY (never the message), sanitised to
    // [A-Za-z0-9_.] and truncated to 60 chars. Empty name -> no parenthetical.
    const safeType = typeName.replace(/[^A-Za-z0-9_.]/g, "").slice(0, 60);
    return safeType === "" ? "" : ` (${safeType})`;
  } catch {
    // A hostile error object (throwing getters, odd prototypes) yields nothing.
    return "";
  }
}

/** [why, what-to-do] for the one-shot line. Byte-for-byte parity in substance
 *  with the Ruby kit's `registration_failure_hint`. `revoked` distinguishes the
 *  `invite_key_revoked` wording from the plain 401/403 wording; `status` fills
 *  the numeric HTTP code in the generic-refusal case; `detail` is a FIXED,
 *  kit-owned parenthetical (already wrapped in " (...)") classifying the
 *  transport failure on the no-answer case (empty otherwise) — never the
 *  runtime's own error text. */
function stayedInactiveHint(
  reason: StayedInactiveReason,
  opts: {
    revoked?: boolean;
    status?: number;
    detail?: string;
    platform?: string;
    retryAfterSeconds?: number;
  } = {},
): [string, string] {
  switch (reason) {
    case "orphan":
      return [
        "this install id already belongs to another copy of the app, and this copy holds none of its credentials",
        "Unset BOOSTHIS_INSTALL_ID (or give this copy its own fresh UUID) and restart.",
      ];
    case "no-answer": {
      const detail = opts.detail && opts.detail !== "" ? opts.detail : "";
      return [
        `it could not reach the Boosthis API from this process${detail}`,
        "Check outbound HTTPS and certificate trust from this app, then restart.",
      ];
    }
    case "revoked":
      return [
        "its project key has been revoked",
        "A revoked key never works again. Mint a new project key in your Boosthis dashboard, put it in this app, then restart.",
      ];
    case "paused":
      return [
        "its project key is paused by a billing problem on the account",
        "Settle the account in your Boosthis dashboard and the same key starts working again. Nothing has been revoked.",
      ];
    case "closing":
      return [
        "its project key is paused because the account's owner has asked to close the account",
        "Nothing has been revoked or deleted: if the owner stops the closure from the Boosthis dashboard during the grace window, the same key starts working again.",
      ];
    case "unknown":
      return [
        "its project key was not recognised",
        "Check it is the current key, pasted whole, with no stray spaces, and that it belongs to this project.",
      ];
    case "key":
      return [
        "its project key wasn't accepted",
        "Copy a current project key from your Boosthis dashboard into this app, then restart.",
      ];
    case "no-key-missing":
      return [
        "no project key is wired into this app",
        "Without one this app measures itself and never appears on your Boosthis dashboard. Copy a project key from your Boosthis Setup page into this app, then restart.",
      ];
    case "no-key-chosen":
      return [
        "this app is set to run with no project key",
        "That is a deliberate setting: this app measures itself and never appears on your Boosthis dashboard. Nothing is being sent.",
      ];
    case "attach-refused":
      return [
        "it could not attach to this app's server and nothing else here is being watched, so it did not register at all",
        "The attach line above says what stopped it. Registering was withheld deliberately: an install that cannot measure would sit on your dashboard looking healthy and empty. Fix the attach and restart, and this app registers normally.",
      ];
    // ── The three IDENTITY refusals ──────────────────────────────────────
    // Each of these used to be a `throw` out of enableTelemetry, which killed
    // any back end that called it at startup — and, because the identity is
    // environment-shaped, killed it only where the variable was missing, so it
    // read as the customer's own bug. They are refusals now, and this is where
    // they say so. Wording carries the substance the thrown messages had.
    case "no-install-id":
      return [
        "no install id was given to enableTelemetry and there is nothing here to derive one from",
        "Pass a stable UUIDv4 as opts.installId (or set BOOSTHIS_INSTALL_ID) — the SAME value on every restart — then restart. Until then this app runs normally, measures nothing, and never appears on your Boosthis dashboard.",
      ];
    case "bad-install-id":
      return [
        "the install id given to enableTelemetry is not a UUID",
        "Use an 8-4-4-4-12 hex UUID (e.g. crypto.randomUUID()) — the server rejects any other shape at registration, so the install would silently never appear. Fix opts.installId (or BOOSTHIS_INSTALL_ID), then restart.",
      ];
    case "no-derivable-install-id": {
      const where =
        opts.platform && opts.platform !== "" ? opts.platform : "this function host";
      return [
        `it is running on ${where} with nothing to derive a stable identity from`,
        "Set BOOSTHIS_INSTALL_ID to any fixed UUID in the function's environment — the same value on every instance — so every cold start reports as one project. Until then this function runs normally and measures nothing.",
      ];
    }
    case "throttled": {
      // The ONE refusal on this list that clears by itself, so the second half
      // is a description of what the kit is already doing, not an instruction.
      // The number is the server's own Retry-After — never a guess — and the
      // wording says so, because "try again later" with no number is exactly
      // what left the tester staring at an install in an unknown state.
      const wait = describeRetryWait(opts.retryAfterSeconds);
      return [
        "it was rate-limited: Boosthis is capping NEW registrations for this project key right now (HTTP 429)",
        `This is temporary and needs nothing from you: the kit is waiting ${wait} and will register itself, with no restart. If it keeps happening, this deployment is minting more NEW install ids per hour than the cap allows — give each instance an install id that survives its own restarts (a stable UUID per instance, not a fresh one per process) so restarts re-register instead of registering fresh.`,
      ];
    }
    case "refused":
      return [
        `the server refused the registration (HTTP ${opts.status ?? 0})`,
        "Retry later; if it keeps happening, check the project key in your Boosthis dashboard.",
      ];
  }
}

/** Render a wait in words a human reads at a glance. Coarse on purpose — the
 *  developer needs "is this seconds or an hour", not a countdown. Exported so
 *  the console line, the status page and the panel all say the SAME thing
 *  about the same number (the bubble's in-browser snippet mirrors it, because
 *  that code cannot import). */
export function describeRetryWait(seconds: number | undefined): string {
  const s = typeof seconds === "number" && isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
  if (s === 0) return "a short while";
  if (s < 90) return `about ${Math.max(1, s)}s`;
  const mins = Math.round(s / 60);
  if (mins < 90) return `about ${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(s / 3600);
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * Read the server's `Retry-After` off a 429 and turn it into a wait in ms.
 *
 * Both RFC 9110 forms: delta-seconds (`120`) and an HTTP-date. Returns null
 * when the header is absent or unreadable, so the caller can fall back to its
 * own floor rather than treating "no header" as "retry now" — the mistake that
 * makes a rate limit into a refusal storm.
 *
 * Clamped at both ends: at least a second (a `0` must never mean "immediately"),
 * and at most `RETRY_AFTER_MAX_MS`, so a server bug or a wildly skewed clock
 * cannot park an install for a week.
 */
const RETRY_AFTER_MIN_MS = 1_000;
const RETRY_AFTER_MAX_MS = 6 * 60 * 60 * 1000;
function parseRetryAfterMs(res: Response, nowMs: number = Date.now()): number | null {
  let raw: string | null = null;
  try {
    raw = res.headers?.get?.("retry-after") ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  const text = String(raw).trim();
  if (text === "") return null;

  let ms: number | null = null;
  if (/^\d+$/.test(text)) {
    ms = Number(text) * 1000;
  } else {
    const at = Date.parse(text);
    if (!isNaN(at)) ms = at - nowMs;
  }
  if (ms === null || !isFinite(ms)) return null;
  if (ms < RETRY_AFTER_MIN_MS) return RETRY_AFTER_MIN_MS;
  if (ms > RETRY_AFTER_MAX_MS) return RETRY_AFTER_MAX_MS;
  return Math.round(ms);
}

/** What the kit waits after a 429 that carried no readable `Retry-After` — an
 *  older server, or a proxy that ate the header. Long enough that a burst of
 *  fresh instances cannot re-form a storm underneath it, short enough that a
 *  minute-scale bucket is not slept through. */
const THROTTLE_FALLBACK_WAIT_MS = 5 * 60 * 1000;

/** Print the ONE-shot "stayed inactive" line, gated on the per-process guard so
 *  a broken install says WHY exactly once — on stderr (console.warn), NOT
 *  behind a debug flag, because this exists for the developer who does NOT yet
 *  suspect the kit. Never throws into the host. */
function warnStayedInactiveOnce(
  reason: StayedInactiveReason,
  opts: {
    revoked?: boolean;
    status?: number;
    detail?: string;
    platform?: string;
    retryAfterSeconds?: number;
  } = {},
): void {
  if (warnedRegistrationRejected) return;
  warnedRegistrationRejected = true;
  registrationRefusalKind = reason;
  registrationRefusalOpts = opts;
  try {
    const [why, fix] = stayedInactiveHint(reason, opts);
    console.warn(`[boosthis] Boosthis stayed inactive because ${why}. ${fix}`);
  } catch {
    // A host that replaced console must never crash on our hint.
  }
}

/** Entry point for the 401/403 branch: read the body ONLY to tell the
 *  `invite_key_revoked` marker apart from a plain not-accepted key, then defer
 *  to the one-shot printer. No server text ever reaches the line. */
async function warnRegistrationRejectedOnce(res: Response): Promise<void> {
  let reason: StayedInactiveReason = "key";
  try {
    // A copy, bounded while reading: the caller may still read the original.
    const body = (await readAnswerJson(res.clone())) as { error?: unknown } | null;
    // A closing account is told apart from a billing problem: the two are
    // settled by different people doing different things.
    reason =
      body?.error === "invite_key_revoked"
        ? "revoked"
        : body?.error === "plan_required"
          ? "paused"
          : body?.error === "account_closure_pending"
            ? "closing"
            : body?.error === "invite_key_unknown"
              ? "unknown"
              : "key";
  } catch {
    // Non-JSON body — fall back to the generic "not accepted" wording.
  }
  warnStayedInactiveOnce(reason);
}

/** A registration the SERVER refused for a reason the developer must fix in
 *  code (not a credential problem the kit can retry its way out of). Only
 *  code-defined markers are ever stored here — never server text, never the
 *  install id, never any request/response value.
 *
 *  `install-id-not-uuid`: the server answered /installs/consent with 400 +
 *  `{"error":"invalid_install_id"}` because this app registered with an id
 *  that is not a UUID. `enableTelemetry` already validates the shape
 *  client-side, so the happy path never reaches this; it is the BACKSTOP for
 *  hand-wired or older integrations that bypassed that check, which used to
 *  look like "consent recorded, no errors" while the install never appeared. */
export type RegistrationRejection = "install-id-not-uuid";

let registrationRejection: RegistrationRejection | null = null;
let warnedInvalidInstallId = false;

/** Module-level mirrors of the CURRENT install's registration + sharing state,
 *  updated by the live client so the bubble panel (a pure module function with
 *  no client handle) can render the honest "you are silent" notices without any
 *  wiring — the SAME pattern `registrationRejection` above uses. Both false
 *  until a client says otherwise.
 *   - `panelRegistered`: the server has minted a delete token for this install.
 *   - `panelSharingOn`: full telemetry is on (code opt-in OR the dashboard
 *     switch), so meters actually leave this process. */
let panelRegistered = false;
let panelSharingOn = false;

/** True once the current install holds a server-minted delete token. Read by
 *  the bubble's `computePanelNotice`. Never throws. */
export function isRegisteredForPanel(): boolean {
  return panelRegistered;
}

/** True when full telemetry is on for the current install, so its meters are
 *  actually uploaded. Read by the bubble's `computePanelNotice`. Never throws. */
export function isSharingOnForPanel(): boolean {
  return panelSharingOn;
}

/** Let the live client publish its registration + sharing state to the two
 *  module mirrors above. Called wherever the delete token or effective sharing
 *  mode changes. Best-effort — a bad value never destabilizes the client. */
export function _publishPanelState(registered: boolean, sharing: boolean): void {
  panelRegistered = registered === true;
  panelSharingOn = sharing === true;
  // Holding a server-minted delete token IS a confirmed server answer, so the
  // two mirrors are kept consistent by construction: whoever publishes
  // "registered" here can never leave the verdict saying otherwise. The
  // absence of one is NOT the opposite answer — nothing is marked for it.
  if (panelRegistered) markRegistrationConfirmed();
}

/** Module-level mirrors of the CURRENT install's identity + effective mode, and
 *  the moment the server last ACCEPTED an upload. Same pattern (and the same
 *  fail-safe posture) as the panel mirrors above: the standalone status page is
 *  a pure module function with no client handle, so the live client publishes
 *  what it knows here.
 *   - `panelInstallId`: the ACTIVE install id (post-rotation), null until a
 *     client exists.
 *   - `panelEndpoint`: the telemetry endpoint this client talks to — the status
 *     page derives the dashboard link from its origin.
 *   - `panelFullTelemetry`: the mode uploads actually run under right now.
 *   - `lastUploadAtMs`: epoch ms of the last MEASUREMENT upload the server
 *     accepted (2xx). Registration/consent is not an upload and never sets it,
 *     so "last upload" can never claim data arrived when only a handshake did. */
let panelInstallId: string | null = null;

/** The client `enableTelemetry` last handed back, so a door that was never
 *  given one can still find it. Never a second source of truth: it is the
 *  same object, not a copy of its state. */
let activeClient: TelemetryClient | null = null;
/** The developer-facing rejected state, or null when registration has not been
 *  refused for a developer-fixable reason. Read by the bubble/panel so the kit
 *  shows the rejection instead of looking connected/awaiting. Never throws. */
export function getRegistrationRejection(): RegistrationRejection | null {
  return registrationRejection;
}

/** Handle a 400 consent response. Records the rejected state + prints ONE
 *  fixed, code-defined line per process when (and only when) the body carries
 *  the server's `invalid_install_id` marker. Deliberately does NOT arm the
 *  hourly consent retry: re-sending an unchanged bad id can never succeed, so
 *  that loop stays reserved for 401/403 key rejection. Never throws — a
 *  failure here must not destabilize the host app.
 *
 *  Returns TRUE when the body WAS the invalid_install_id marker (handled here),
 *  FALSE otherwise — the caller then falls back to the generic "refused"
 *  one-shot line so a non-marker 400 is never silent. */
async function handleInvalidInstallIdOnce(res: Response): Promise<boolean> {
  let invalid = false;
  try {
    const body = (await readAnswerJson(res.clone())) as { error?: unknown } | null;
    invalid = body?.error === "invalid_install_id";
  } catch {
    // Unreadable / non-JSON body — not the UUID rejection.
  }
  if (!invalid) return false;
  registrationRejection = "install-id-not-uuid";
  // The server refused the identity itself, so it is definitely not on file.
  markRegistrationRefused();
  if (warnedInvalidInstallId) return true;
  warnedInvalidInstallId = true;
  try {
    console.warn(
      "[boosthis] Registration rejected: this app's Boosthis install ID is " +
        "not a valid UUID. Generate a real UUID (e.g. uuidgen / " +
        "crypto.randomUUID()), persist it as the install ID, then restart.",
    );
  } catch {
    // A host that replaced console must never crash on our hint.
  }
  return true;
}

/** Test-only: reset the one-shot registration-warning guard. */
export function _resetRegistrationWarningForTests(): void {
  warnedRegistrationRejected = false;
  warnedInvalidInstallId = false;
  registrationRejection = null;
  _resetRegistrationForTests();
  panelRegistered = false;
  panelSharingOn = false;
  warnedProjectKeyOverride = false;
  registrationRefusalKind = null;
  registrationRefusalOpts = {};
  panelProjectKey = { key: null, source: "none", overrodeShared: false, display: null, declined: false };
}

/** S5 of the silent-failure audit: how long the kit waits before quietly
 *  retrying a REJECTED registration (401/403 — bad/revoked/rotated invite
 *  key). A long-running server process used to try exactly once at boot and
 *  then stay dark forever even after the key was fixed server-side (rekey,
 *  rotation); one quiet retry per hour lets it come back WITHOUT a restart.
 *  Temporary failures use the separate registration schedule. The warning
 *  stays one-shot on both paths. */
let consentRetryMs = 60 * 60 * 1000;

/** Test-only: shrink the consent retry interval. */
export function _setConsentRetryMsForTests(ms: number): void {
  consentRetryMs = ms;
}

/** Longest display name the server stores (matches the `.max(60)` on the
 *  consent schema). Clamp client-side so a long auto-detected name is trimmed
 *  rather than rejected at ingest. */
const APP_NAME_MAX = 60;

/** Strip a leading npm scope so `@acme/api-server` shows as `api-server`. */
function stripScope(name: string): string {
  const at = name.startsWith("@") ? name.indexOf("/") : -1;
  return at >= 0 ? name.slice(at + 1) : name;
}

/**
 * Best-effort detection of the host service's own name so the dashboard shows a
 * friendly name (e.g. "api-server") instead of a churny per-boot install id.
 * Purely optional and never throws: it reads `npm_package_name` (set when the
 * app is launched via `npm`/`pnpm run`) then falls back to the `name` field of
 * the current working directory's `package.json`. Returns `undefined` when
 * neither is available. The value is the app's own package name — not PII — but
 * the caller still clamps + PII-screens it, so detection can never break
 * registration.
 */
export function detectAppName(): string | undefined {
  // 1. npm/pnpm/yarn set this when the process is started via a package script.
  try {
    const env = process.env.npm_package_name;
    if (typeof env === "string" && env.trim()) return stripScope(env.trim());
  } catch {
    // no process.env — fall through
  }
  // 2. Read the name straight from the nearest package.json (cwd).
  try {
    const raw = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown };
    if (typeof parsed.name === "string" && parsed.name.trim()) {
      return stripScope(parsed.name.trim());
    }
  } catch {
    // no readable package.json — fall through
  }
  return undefined;
}

/**
 * Decide the display name sent on consent, friction-first: an explicit
 * `opts.appName` (used verbatim, only clamped) wins; otherwise a best-effort
 * auto-detected name; otherwise `undefined`. The AUTO path clamps to
 * {@link APP_NAME_MAX} and DROPS a name that would trip the PII guard, so
 * auto-detection can never turn a working registration into a rejected one.
 */
export function resolveAppName(explicit: string | undefined): string | undefined {
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.trim().slice(0, APP_NAME_MAX);
  }
  let auto: string | undefined;
  try {
    auto = detectAppName();
  } catch {
    auto = undefined;
  }
  if (!auto) return undefined;
  const clamped = auto.slice(0, APP_NAME_MAX);
  return checkNoPII({ appName: clamped }) === null ? clamped : undefined;
}

export interface TelemetryOptions {
  /** Stable identity for this install.
   *
   *  Required on an ordinary long-running server, exactly as before. Optional
   *  ONLY on a proven function host, where the kit derives one from the project
   *  key and the platform's own project scope so every cold start of every
   *  instance reports as the same project. `BOOSTHIS_INSTALL_ID` is honoured
   *  everywhere — the environment is the only durable configuration a function
   *  has — and explicit code always wins over it. */
  installId?: string;
  endpoint?: string;
  packageVersion?: string;
  /** Optional friendly display name for this service, sent on consent so you
   *  can tell your installs apart in your own Boosthis dashboard. Developer-
   *  authored metadata — never put a user's name, email, or any PII here; the
   *  server screens the value with the same best-effort PII guard as every
   *  other field and shows it only to you. Capped at 60 chars. Omit it and the
   *  dashboard just shows the id. */
  appName?: string;
  fetchOptions?: InternalPostOptions;
  /** Previously-issued bearer token (e.g. restored from disk on boot). When
   *  absent the client calls /installs/consent to get one. */
  deleteToken?: string;
  /** Fired whenever the server issues a delete token whose VALUE differs from
   *  the one currently held — first issuance, or fresh credentials replacing a
   *  stale restored token — so the host app can persist it for the next boot. */
  onTokenIssued?: (token: string) => void;
  /** Previously-issued SELF-scoped read token (e.g. restored from disk on
   *  boot). The server returns it only on the first consent (or a one-time
   *  backfill), so the runtime holds onto it across the session. Unlike RN, the
   *  Node runtime ALSO persists it itself under `node-runtime-store.json`, so
   *  this option is only needed to seed a token the host already has. */
  readToken?: string;
  /** Fired whenever the server issues a read token whose VALUE differs from
   *  the one currently held, so the host app can persist it too. The runtime
   *  already persists it to disk; this callback is purely for hosts that want
   *  their own copy. */
  onReadTokenIssued?: (token: string) => void;
  /** Project key issued from the account dashboard, authorizing this install
   *  to register. Sent as `Authorization: Bearer <inviteKey>` on
   *  /installs/consent. Registration is rejected without a valid key. */
  inviteKey?: string;
  /** Issues-only mode. When true, the client auto-submits privacy-safe issue
   *  signatures + fix resolutions (no route names, no values) but NEVER ships
   *  per-route samples: `transmit()` becomes a no-op and full samples are never
   *  queued. Use this to honor an "issues only" data contract. */
  issuesOnly?: boolean;
  /** Explicit opt-in to mirror the PII-filtered perf SNAPSHOT (the whole meter
   *  page — per-route rows, cross-cutting findings, axes) to the server so the
   *  developer's OWN AI can read the live picture over the hosted MCP live-read
   *  tools. Default false. In full mode the snapshot is shared anyway; this flag
   *  only matters in issues-only mode, where it (or the server directive, set
   *  once the developer connects an AI from the web dashboard) is the ONLY thing
   *  that lets the screen-bearing snapshot leave the process. It never enables
   *  the raw per-route sampler firehose. */
  shareMeterWithAI?: boolean;
  /** Opt-in DETAILED crash mode. When true, uploaded crash fingerprints
   *  additionally carry a PII-scrubbed first message line (`summary`) and
   *  sanitized stack `frames` (function + file BASENAME + line/col). Each of
   *  those is dropped individually if it trips the PII guard. Default false —
   *  the minimal fingerprint (error type + hashed signature + redacted top
   *  frame + bucketed count) only. Crash reporting itself is ALWAYS-ON for a
   *  registered app regardless of this flag. */
  crashDetails?: boolean;
  /** Optional tamper-evidence signal (Rung 2 of the kill-switch), forwarded
   *  verbatim to the server on every entitlement check-in for admin
   *  visibility. `status` is a coarse self-report (e.g. "ok" / "modified");
   *  `manifestHash` is the kit's own manifest hash if the host computed one.
   *  Purely advisory — the server verdict is the sole authority; omit it and
   *  the check-in simply carries no integrity block. */
  integrity?: { status?: string; manifestHash?: string | null } | null;
}

export interface TelemetrySample {
  routeLabel: string;
  durationMs: number;
  rating: "good" | "needs-work" | "poor";
  ruleId?: string;
  metadata?: Record<string, unknown> | null;
}

/** Privacy-safe issue signature. NEVER carries route names or values. */
export interface CandidateSignaturePayload {
  signature: string;
  kind: string;
  severityBucket: "low" | "med" | "high";
  countBucket: string;
  occurrences: number;
}

/** Privacy-safe fix-resolution signal. NEVER carries code, diffs, route names,
 *  or values — only the rule kind + before→after rating. */
export interface ResolutionPayload {
  ruleId: string;
  kind: string;
  beforeRating: "good" | "needs-work" | "poor";
  afterRating: "good" | "needs-work" | "poor";
  occurrences: number;
  // Privacy-safe "circumstances" the fix was proven under (bucketed severity +
  // bucketed count). Optional — older servers ignore them; the community rule
  // book uses them to weight a proven fix toward similar pages. No raw values.
  severityBucket?: "low" | "med" | "high";
  countBucket?: string;
}

export interface TelemetryClient {
  readonly installId: string;
  readonly endpoint: string;
  readonly enabled: boolean;
  readonly deleteToken: string | null;
  /** SELF-scoped read token for this install, or null until consent has issued
   *  one (or it was restored from disk / `opts.readToken`). Read-only: it can
   *  read this install's own uploaded perf data over the hosted MCP live-read
   *  path, but can never delete or ingest. Surfaced so the "Connect your AI"
   *  helper can build a paste-ready MCP config. */
  readonly readToken: string | null;
  /** Effective project key decision, including its safe display and source. */
  readonly projectKey: ResolvedProjectKey;
  /** The EFFECTIVE full-telemetry mode right now: code config (`issuesOnly:
   *  false`) OR the dashboard "Full telemetry" directive learned from consent.
   *  The bubble's signed-in account card reads this so its telemetry toggle can
   *  fall back to the kit's current mode when the claim response omits
   *  `fullTelemetry` (older servers, or a re-claim that doesn't re-echo it). */
  readonly fullTelemetryEffective: boolean;
  consent(): Promise<number>;
  transmit(samples: readonly TelemetrySample[], onRefused?: () => void): Promise<number>;
  transmitCandidates(
    signatures: readonly CandidateSignaturePayload[],
    onRefused?: () => void,
  ): Promise<number>;
  transmitResolutions(
    resolutions: readonly ResolutionPayload[],
    onRefused?: () => void,
  ): Promise<number>;
  /** Upload one PII-filtered perf snapshot (the whole meter page). Gated off in
   *  issues-only mode unless `shareMeterWithAI` (explicit or server directive)
   *  is set; always gated off when disabled or killed. Returns 1 on success. */
  transmitSnapshot(snapshot: NodeSnapshotPayload): Promise<number>;
  /** Upload privacy-safe crash fingerprints. ALWAYS-ON for a registered app —
   *  NOT gated by the enable/disable toggle. Only `forget()` or the kill-switch
   *  (`BOOSTHIS_DISABLED`) stop it. Returns the number of crash classes the
   *  server accepted. Wired automatically to the on-device crash reporter's
   *  submitter; hosts do not normally call it directly. */
  transmitCrashes(
    crashes: readonly CrashReportPayload[],
    /** Replay only: the install a crash was CAPTURED under, when a restart has
     *  since changed this process's identity. The batch is filed as — and
     *  authenticated by — that install, so a crash never moves onto the install
     *  that merely replaced the one which crashed. */
    as?: CrashSendIdentity,
  ): Promise<number>;
  /** Auto-submit privacy-safe full-stack trace spans (one span per handled
   *  request, emitted from the middleware). Like the snapshot mirror they carry
   *  code-defined route labels, so they ride the SAME gate: off in issues-only
   *  mode unless the developer connects an AI, on in full mode. The runtime
   *  flushes them on a cadence; the host never invokes this manually. */
  transmitSpans(spans: readonly TraceSpan[]): Promise<number>;
  /** Upload finished background-job runs. ALWAYS-ON for a registered app, like
   *  crash reporting and unlike the snapshot mirror: a run carries only a
   *  code-defined job name, and a developer must be told a nightly job stopped
   *  whether or not they ever connected an AI. Only `forget()` or the
   *  kill-switch stop it. Wired automatically; hosts do not call it directly. */
  transmitJobRuns(
    runs: readonly JobRunReport[],
    expectations?: readonly JobExpectationReport[],
    promises?: readonly PromiseDeclarationReport[],
    /** Runs counted in the kit, one line per job per day. */
    tallies?: readonly JobRunTallyReport[],
  ): Promise<number | JobSubmitOutcome>;
  disable(): void;
  enable(): void;
  forget(): Promise<number>;
}

/** Mirrors the server's consent-time installId validation (zod `.uuid()` — any
 *  8-4-4-4-12 hex layout, case-insensitive). Consent is fire-safe, so a
 *  wrong-shaped id would otherwise fail SILENTLY server-side (the app runs but
 *  never registers). Validating here fails loud at the one moment the
 *  developer is looking. */
const INSTALL_ID_SHAPE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * UUIDv4 generator for the self-healing reinstall recovery. Prefers the
 * platform's crypto.randomUUID (Node 19+/modern runtimes) and falls back to a
 * Math.random v4 — acceptable HERE because the rotated install id is an
 * IDENTIFIER, not an authenticator ("install ids are identifiers, not
 * authenticators" is a server-side invariant): every capability still rides
 * the server-minted delete/read tokens. Exported for tests.
 */
/**
 * The client handed back when the kit REFUSES to start — today, only on a
 * function host the kit can name, or is told about with `BOOSTHIS_SERVERLESS=1`,
 * and has not proven. Every method is a no-op that reports doing
 * nothing, so the host application behaves exactly as if Boosthis were not
 * installed: no registration, no panel, no uploads, and nothing that could be
 * mistaken for working measurement.
 */
function inertTelemetryClient(
  endpoint: string,
  projectKey: ResolvedProjectKey,
): TelemetryClient {
  const zero = async (): Promise<number> => 0;
  return {
    installId: "",
    endpoint,
    enabled: false,
    deleteToken: null,
    readToken: null,
    projectKey,
    fullTelemetryEffective: false,
    consent: zero,
    transmit: zero,
    transmitCandidates: zero,
    transmitResolutions: zero,
    transmitSnapshot: zero,
    transmitCrashes: zero,
    transmitSpans: zero,
    transmitJobRuns: zero,
    disable: () => {},
    enable: () => {},
    forget: zero,
  };
}
export function generateRotationInstallId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      /* fall through to the dependency-free path */
    }
  }
  let out = "";
  for (const ch of "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx") {
    if (ch === "x") out += ((Math.random() * 16) | 0).toString(16);
    else if (ch === "y") out += (((Math.random() * 4) | 0) + 8).toString(16);
    else out += ch;
  }
  return out;
}

/**
 * Settle this install's identity.
 *
 * On an ordinary long-running server this is unchanged: the host supplies an id
 * and we validate its shape. Two additions, both for hosts that have nowhere to
 * remember one:
 *
 *   • `BOOSTHIS_INSTALL_ID` — the environment is the only durable configuration
 *     a function has, so an id set there is honoured. Explicit code still wins.
 *   • a DERIVED id on a proven function host — a pure function of the project
 *     key and the platform's own project scope, so every cold start of every
 *     instance lands on the SAME install. Without this, a busy serverless
 *     project mints an install per cold start: thousands of siblings under one
 *     key, a polluted dashboard, and counts summed across all of them.
 */
/** Was this install's id DERIVED from the platform's own project scope, or
 *  supplied by the host? Only a derived id may carry the serverless claim on
 *  registration: the claim asks the server to recompute the id from the project
 *  key and the platform scope, so declaring it for an id the host chose would
 *  have the server refuse its own documented fallback as an identity mismatch. */
let identityWasDerived = false;

/** The outcome of settling identity. `refusal` is non-null exactly when no id
 *  could be settled — the three cases that used to THROW out of
 *  `enableTelemetry` and take the host's startup with them. */
function resolveInstallIdentity(
  explicit: string | undefined,
  projectKeyValue: string | null,
): {
  installId: string | null;
  derived: boolean;
  refusal: StayedInactiveReason | null;
  platform?: string;
  /** Set when a freshly minted id did NOT reach disk — the store took it in
   *  memory only (a busy lock, a refused write). The startup line must then
   *  not call the store durable: the next start would mint again. */
  unkept?: true;
} {
  const fromEnv = (process.env.BOOSTHIS_INSTALL_ID ?? "").trim();
  if (explicit !== undefined && explicit !== null && typeof explicit !== "string") {
    return { installId: null, derived: false, refusal: "bad-install-id" };
  }
  if (explicit === null) {
    return { installId: null, derived: false, refusal: "bad-install-id" };
  }
  const supplied =
    typeof explicit === "string" && explicit ? explicit : fromEnv || null;
  if (supplied) {
    if (!INSTALL_ID_SHAPE.test(supplied)) {
      return { installId: null, derived: false, refusal: "bad-install-id" };
    }
    return { installId: supplied, derived: false, refusal: null };
  }
  if (isServerlessMode()) {
    const derived = deriveServerlessInstallId(
      projectKeyValue ?? "",
      serverlessHost(),
    );
    if (derived) return { installId: derived, derived: true, refusal: null };
    let platform = "";
    try {
      platform = platformName(serverlessHost().platform);
    } catch {
      /* an unreadable host name loses the platform, never the refusal */
    }
    return {
      installId: null,
      derived: false,
      refusal: "no-derivable-install-id",
      platform,
    };
  }
  // Ordinary servers own their identity when the host has not pinned one.
  // Restore the id before minting; otherwise every restart becomes a new
  // install even though the storage layer already has an atomic store.
  const restored = storage.getSync("installId");
  if (restored) {
    if (!INSTALL_ID_SHAPE.test(restored)) {
      return { installId: null, derived: false, refusal: "bad-install-id" };
    }
    return { installId: restored, derived: false, refusal: null };
  }
  const minted = generateRotationInstallId();
  // Asked, not assumed: a write the store could only keep in memory returns
  // normally, and a startup line calling that durable would be a promise the
  // next restart breaks.
  const { persisted } = storage.updateSyncPersisted("installId", () => minted);
  return persisted
    ? { installId: minted, derived: false, refusal: null }
    : { installId: minted, derived: false, refusal: null, unkept: true };
}

/**
 * WHAT THIS KIT IS READY TO SEND BEFORE ANYONE HAS DECIDED — the sharing
 * posture of a brand-new install in the window between this process starting
 * and the server's first answer.
 *
 * Declared ONCE for the whole product in lib/telemetry-mode-contract.json.
 * This is the copy this kit reads, and a guard reads the literal back out of
 * this file and fails when the two diverge without a written reason. A NAMED
 * constant rather than a bare literal beside `opts.issuesOnly`, so the
 * pre-contact answer is a stated position somebody can find rather than the
 * same word hardcoded once per kit with nothing holding the copies together.
 *
 * Nothing can actually leave the device in that window regardless — every
 * upload path also needs the delete token the consent answer mints — so this
 * decides what the kit is READY to send, not what it has sent.
 */
export const PRE_CONTACT_FULL_TELEMETRY_DEFAULT = true;
export function enableTelemetry(opts: TelemetryOptions): TelemetryClient {
  // Charge this whole setup to the kit's own published cold-start figure. It
  // is paid once per instance, so it belongs in the cold-start number and not
  // in the per-run one — and it belongs in a number we PUBLISH, because "the
  // agent slows down cold starts" is the complaint every monitoring vendor
  // leaves unanswered by never measuring it. See kitFootprint.ts.
  const kitSetupStart = performance.now();
  try {
    return enableTelemetryInner(opts);
  } finally {
    noteKitSetupCost(performance.now() - kitSetupStart);
  }
}

function enableTelemetryInner(opts: TelemetryOptions): TelemetryClient {
  const endpoint = opts.endpoint ?? DEFAULT_TELEMETRY_ENDPOINT;
  const projectKey = resolveProjectKey(opts.inviteKey);
  panelProjectKey = projectKey;

  // ── A FUNCTION HOST WE HAVE NOT PROVEN ──────────────────────────────────
  // Refuse, out loud, with the platform named. Registering here would render a
  // panel and report almost nothing — a customer believing they are measured
  // when they are not is the worst outcome this kit can produce, and worse than
  // not starting. The refusal never throws: a customer's production site must
  // not fall over because we declined to measure it.
  const refusal = serverlessRefusal();
  if (refusal) {
    try {
      console.warn(`[boosthis] ${refusal}`);
    } catch {
      /* a host that replaced console must not break the refusal */
    }
    return inertTelemetryClient(endpoint, projectKey);
  }

  // ── NO IDENTITY TO REPORT UNDER ─────────────────────────────────────────
  // Refuse, out loud, exactly like the unproven-function-host branch above.
  // This used to THROW. Every other failure mode in this function degrades:
  // a refused runtime returns an inert client, a missing project key warns
  // once and stays inactive. Only the missing identity killed the host — and
  // because the identity is environment-shaped, it killed the copy where the
  // variable was unset while the copy where it was set booted cleanly, which
  // reads from outside as the customer's own bug. A back end is the worst
  // place for that: no degraded mode, no partial page, just a process that
  // exits at startup.
  //
  // The refusal stays a refusal: nothing is invented to fill the gap. An id
  // generated here would register a fresh install on every restart, so the
  // customer would trade a dead process for a dashboard full of siblings.
  const identity = resolveInstallIdentity(opts.installId, projectKey.key);
  if (identity.installId === null) {
    warnStayedInactiveOnce(identity.refusal ?? "no-install-id", {
      platform: identity.platform,
    });
    return inertTelemetryClient(endpoint, projectKey);
  }
  const bakedInstallId = identity.installId;
  identityWasDerived = identity.derived;
  const pinnedIdentity =
    (typeof opts.installId === "string" && opts.installId.trim()) ||
    (process.env.BOOSTHIS_INSTALL_ID ?? "").trim();
  const identitySource = identity.derived
    ? "derived"
    : pinnedIdentity
      ? "host"
      : "store";
  const identityStore =
    identitySource === "store"
      ? storageDurable() && identity.unkept !== true
        ? storageBackend()
        : "memory"
      : undefined;
  const identityRestored =
    identitySource === "store" ? storageKeyRestored("installId") : undefined;
  if (!projectKey.key) {
    warnStayedInactiveOnce(projectKey.declined ? "no-key-chosen" : "no-key-missing");
  }
  // An install that passes the key HERE rather than to boosthis() supplies it
  // one statement after the start call. Hand it to the startup line before it
  // gives up waiting, so the anchor line names the key instead of claiming
  // there is none.
  try {
    announceProjectKey(projectKey.key);
  } catch {
    /* evidence never blocks reporting */
  }
  if (projectKey.overrodeShared && !warnedProjectKeyOverride) {
    warnedProjectKeyOverride = true;
    try {
      console.warn(
        `[boosthis] Node project key overridden by BOOSTHIS_PROJECT_KEY_NODE (${projectKey.display}).`,
      );
    } catch {
      /* a host that replaced console must not break registration */
    }
  }
  // Never let Boosthis's OWN upload flushes self-trigger a retry-storm finding
  // naming our API host (the undici observer watches the same global `fetch`).
  ignoreHost(endpoint);
  // WHAT THE KIT ARMS. Run on start unless a stored answer has locked the kit
  // (docs/kit-lock-rule.md), and again by `rearm` when an `active` answer ends a
  // lock. The lock is read synchronously from the stored answer, so a restarted
  // kit knows it is locked before it hooks or measures anything. The two
  // one-moment captures (cold start, start-up import) are taken on start only:
  // taken after a lock they would measure the lock, not the start.
  function armCollectors(atStart: boolean): void {
    if (isKitLocked()) return;
    // Arm the native event-loop-delay histogram so the loop-lag axis has data by
    // the first snapshot. Idempotent, self-guards the kill-switch, never throws.
    startEventLoopLag();
    armForkChurn();
    // Watch for the moment this app becomes READY TO SERVE (its first socket
    // accepting connections) — the interval a cold start actually names. Armed
    // before anything else so a server that binds during the rest of enable is
    // still seen. Idempotent, kill-switch-guarded, never throws.
    armReadyWatch();
    // Freeze the fallback interval (OS process start -> this call) ONCE, early and
    // best-effort: what a process that never binds a socket can still report, as
    // an explicitly PARTIAL, unrated reading. Idempotent and never throws — a
    // failure here must never break enable; the axis is simply omitted.
    if (atStart) {
      try {
        captureColdStart();
      } catch {
        /* best-effort — a failed capture omits the axis, never blocks enable */
      }
    }
    startVitals();
    // Freeze the startup-import-cost proxy (Node bootstrap done -> this call)
    // ONCE, best-effort — same doctrine as coldStart above.
    if (atStart) {
      try {
        captureStartupImport();
      } catch {
        /* best-effort — a failed capture omits the axis, never blocks enable */
      }
    }
    // 2026-08 extra meters (handle churn, rejection pressure, backpressure,
    // worker imbalance). Idempotent, kill-switch-guarded, never throws.
    startExtraMeters();
    // Background work — attach to the queue library / scheduler this app has
    // ALREADY loaded, if any. Armed HERE as well as at the request boundary
    // because a worker process may never serve a request in its life: for those,
    // this call is the only chance to attach. Never loads anything the app did
    // not choose itself; a project with no job system pays one cache scan.
    armJobSystems();
    // Freeze the build identity (commit + build time -> exposure window) ONCE for
    // the Patch-lag meter — same freeze-at-enable doctrine as coldStart. Best-
    // effort: a failed capture omits the build fields, never blocks enable.
    try {
      captureBuildIdentity();
    } catch {
      /* best-effort — a failed capture omits the build fields, never fatal */
    }
  }
  armCollectors(true);
  const packageVersion = opts.packageVersion ?? RUNTIME_VERSION;
  const fetchOptions = opts.fetchOptions ?? {};
  const issuesOnly = opts.issuesOnly ?? !PRE_CONTACT_FULL_TELEMETRY_DEFAULT;
  // Explicit developer opt-in to mirror the screen-bearing snapshot. In
  // full mode the snapshot ships regardless; this only matters in issues-only
  // mode. `serverShareMeterWithAI` is the rising-edge directive the server sets
  // once the developer connects an AI from the web dashboard.
  const explicitShareMeterWithAI = opts.shareMeterWithAI ?? false;
  let serverShareMeterWithAI = false;
  // Dashboard "Full telemetry" directive — a THREE-STATE value that follows
  // BOTH edges, parsed from every consent response (parity with RN/Web).
  //   • null  = the server has not told us yet — honour the code-configured
  //             mode (`issuesOnly`) until first contact.
  //   • true  = ON  — force full mode for the session (per-route sample upload
  //             + snapshot mirror), even when the host code asked for
  //             issues-only (preserves the documented contract).
  //   • false = OFF — force issues-only for the session, even when the host
  //             code asked for full mode (fixes the defect where a dashboard
  //             "turn it off" was silently ignored).
  // It can never override disable()/forget()/the kill-switch/entitlement locks/
  // BOOSTHIS_DISABLED: every upload path re-checks `enabled` + the kill-switch,
  // and the sample queue's pause state stays owned by disable()/enable().
  // Initialised to null (NOT false) so it never fabricates an OFF the server
  // never sent — before first contact the server has no opinion.
  let serverFullTelemetry: boolean | null = null;

  /** The mode uploads actually run under: before the server has spoken
   *  (`serverFullTelemetry === null`) the code-configured `issuesOnly` wins;
   *  after first contact the server directive wins in BOTH directions. This is
   *  the inverse of effective full mode
   *  (`serverFullTelemetry === null ? !issuesOnly : serverFullTelemetry`),
   *  which is what callers here consume. */
  function effectiveIssuesOnly(): boolean {
    return serverFullTelemetry === null ? issuesOnly : !serverFullTelemetry;
  }

  /** SAY IT ONCE when this project's dashboard directive contradicts what the
   *  installed code asked for.
   *
   *  The server wins in both directions and always has; that is deliberate
   *  and this warning does not dispute it. What it ends is a developer
   *  reading their own source, seeing the mode they set, and believing it
   *  while the switch on their project's page quietly says otherwise. BOTH
   *  values are named, so the line is actionable without first opening the
   *  dashboard to find out what it currently says.
   *
   *  One wording in every kit that warns — see
   *  lib/telemetry-mode-contract.json, which is also where a kit that does
   *  NOT warn has to write down why. */
  let telemetryModeContradictionAnnounced = false;
  function noteTelemetryModeContradiction(): void {
    if (telemetryModeContradictionAnnounced) return;
    // Nothing to contradict until the server has actually answered: before
    // first contact the code's setting is the only one there is.
    if (serverFullTelemetry === null) return;
    const requested = issuesOnly ? "reduced" : "full";
    const effective = effectiveIssuesOnly() ? "reduced" : "full";
    if (requested === effective) return;
    telemetryModeContradictionAnnounced = true;
    try {
      // NAMES THE ANSWER, NEVER THE SWITCH'S POSITION. A disconnected or
      // removed project is answered with the sharing directives withdrawn
      // while its switch may still be ON, so a line quoting that switch
      // would be false exactly where a developer most needs it. The kit
      // knows what it was told; it does not know why.
      console.warn(
        `[boosthis] telemetry mode: your code asked for ${requested} telemetry, but this project's server answer is ${effective}, so ${effective} is what is in force. The server answer wins in both directions: the "Full telemetry" switch on the project's page sets it, and a disconnected or removed project is answered with reduced until it is reconnected. Change it there, or drop the code setting so the two agree.`,
      );
    } catch {
      /* a host that replaced console must not break telemetry */
    }
  }

  let enabled = true;
  // DELETE token — the credential that proves this install is itself (ingest,
  // snapshot upload, forget). Persisted to `node-runtime-store.json` keyed by
  // the BAKED installId (parity with readTokenStoreKey below): before this,
  // the token lived in memory only, so every process restart landed in the
  // `already_registered_no_token` dead end — the install re-consented
  // tokenless forever and uploaded nothing. An opts-provided token always wins
  // over the stored one (hosts that manage persistence themselves, e.g. the
  // prod dogfood's deterministic token, stay authoritative).
  const deleteTokenStoreKey = `deleteToken:${bakedInstallId}`;
  let deleteToken: string | null = opts.deleteToken ?? null;
  // Whether this install has been ERASED since it was last enabled. A consent
  // knock is a round-trip, and `forget()` can start, or finish, in the middle
  // of one: the reply then carries a live delete token for an install that no
  // longer exists here, and adopting it would put that credential back in
  // memory and on disk after the erasure. The flag outlives the call, because
  // the reply can arrive after `forget()` has already returned. `enable()`
  // clears it — a deliberate restart of the kit is how an erased install
  // becomes a registerable one again.
  let forgottenSinceEnable = false;
  let consentGeneration = 0;
  // SELF-scoped read token. The server returns it only on the first consent (or
  // a one-time backfill), so we hold it across the session. Unlike RN (which
  // delegates persistence to the host), the Node runtime persists it itself
  // under `node-runtime-store.json`, keyed by installId so multiple installs
  // sharing one home dir never collide.
  const readTokenStoreKey = `readToken:${bakedInstallId}`;
  let readToken: string | null = opts.readToken ?? null;
  // WHICH PROJECT this install feeds, in the developer's own words. Only the
  // server knows it, so it rides back on consent — and it is persisted beside
  // the tokens for the same reason they are: without it a restarted process
  // shows "not received yet" on every panel until its next registration reply
  // lands, which on a quiet server can be an hour.
  const projectStoreKey = `project:${bakedInstallId}`;
  // The developer's own standing promises, persisted for the same reason and
  // restored the same way: the kit's page is a local view a developer opens
  // while they work, and a restart should not blank it.
  const promisesStoreKey = `promises:${bakedInstallId}`;
  // Best-effort restore of both tokens from disk when the host didn't seed
  // them. postConsent awaits this one-shot promise so the first consent can
  // never race the restore and knock tokenless while a valid credential sits
  // on disk. We never overwrite a token already provided via opts.
  const credsReady: Promise<void> = (async () => {
    try {
      if (!deleteToken) {
        const v = await storage.get(deleteTokenStoreKey);
        if (v && !deleteToken) deleteToken = v;
      }
      if (!readToken) {
        const v = await storage.get(readTokenStoreKey);
        if (v && !readToken) readToken = v;
      }
      const storedProject = parseKitProject(await storage.get(projectStoreKey));
      if (storedProject) setKitProject(storedProject.name, storedProject.code);
      const storedPromises = parseKitPromises(
        await storage.get(promisesStoreKey),
      );
      if (storedPromises) setKitPromises(storedPromises);
    } catch {
      // Best-effort: an unreadable store just means we re-mint via consent.
    }
    // A credential restored from disk means this install IS registered — tell
    // the panel mirror, so a restarted process shows the honest notice.
    publishPanelState();
  })();

  /** Push this install's registration + sharing state to the module-level panel
   *  mirrors so the bubble panel (no client handle) renders the honest silent
   *  notices. Registered == we hold a delete token; sharing == full mode is in
   *  effect. Best-effort — never throws into the client. */
  function publishPanelState(): void {
    try {
      const full = !effectiveIssuesOnly();
      _publishPanelState(!!deleteToken, full);
      // A delete token only exists because the SERVER minted it, so holding
      // one is a confirmed server answer — not a guess from local state. The
      // absence of one is NOT the opposite answer: that is the whole point of
      // the three-outcome verdict, so nothing is marked here when it is gone.
      if (deleteToken) markRegistrationConfirmed();
      // The standalone status page needs the identity too, and it is published
      // from the SAME place so the two mirror sets can never disagree.
      _publishInstallIdentity(activeInstallId, endpoint, full);
    } catch {
      /* never destabilize the client on a mirror write */
    }
  }

  /** Stamp the "last upload" mirror when — and only when — the server accepted
   *  a MEASUREMENT upload. Returns `res.ok` so upload paths keep their original
   *  shape. Consent/registration deliberately does NOT come through here: a
   *  handshake is not data arriving, and the status page must never imply it
   *  was. Best-effort — never throws into an upload path. */
  function noteUpload(res: Response, alsoRead?: (body: unknown) => void): boolean {
    // NOTHING WAS SENT. When the kill-switch or a killed install silences an
    // upload, the transmit helper still has to return a Response, so it
    // invents a 204 — which is `ok`. Judged as a success it would clear a real
    // earlier failure, read "drops" out of a body Boosthis never wrote, and
    // report a delivered-row count for rows that never left this process. A
    // locally-invented answer is evidence about US, never about the server: it
    // delivers nothing and it clears nothing. It is not a refused batch
    // either — the kit is switched off, which it says in its own words
    // elsewhere, so no upload-failure line is invented on top of that.
    if (isNoSendResponse(res)) return false;
    // ASKED TO WAIT. A 429 is not a refused batch: nothing in it was judged,
    // and every upload path keeps what it sent and sends it after the wait
    // (uploadPause.ts). So it is not counted with the batches lost, and the
    // status page says "Paused" from the pause itself, not "failing". A local
    // 429 made while a pause holds the upload is the same answer.
    if (res.status === 429) return false;
    if (!res.ok) {
      // A refused batch is DATA THE DEVELOPER WILL NEVER SEE. Record it so the
      // status page can say so, instead of leaving the last successful upload
      // on screen and letting a broken app read as healthy.
      try {
        _noteUploadRejected(
          res.status === 401 || res.status === 403
            ? "unauthorized"
            : res.status >= 500
              ? "server-error"
              : "rejected",
        );
      } catch {
        /* a mirror write must never fail an upload */
      }
      return false;
    }
    try {
      _noteUploadAccepted();
    } catch {
      /* a mirror write must never fail an upload */
    }
    // A 202 is not unqualified success: the server may have stored fewer rows
    // than we sent. Read the reply's honesty fields WITHOUT awaiting them, so
    // the upload path keeps its exact timing and a slow or unreadable body can
    // never reach the host. A reply without the fields reports nothing.
    try {
      // One read of the body, shared. `alsoRead` is how a caller that needs
      // something else out of the same reply gets it without consuming it.
      // The promise is parked, never awaited here: this path keeps its exact
      // timing, and only a caller who NEEDS the body (see `lastReplyBodyRead`)
      // waits for it.
      lastReplyBodyRead = readDropsFromResponse(res, alsoRead);
      void lastReplyBodyRead;
    } catch {
      /* reading the reply must never fail an upload */
    }
    return true;
  }

  /** The most recent reply-body read started by `noteUpload`. Set
   *  synchronously by it, so a caller reads it immediately after the call with
   *  nothing in between and cannot pick up another upload's. */
  let lastReplyBodyRead: Promise<void> | null = null;

  /** No answer at all — the request threw (timed out, aborted, or the network
   *  refused it). Same honesty rule as a refusal: it must be visible. */
  function noteUploadUnreachable(): void {
    try {
      _noteUploadRejected("unreachable");
    } catch {
      /* a mirror write must never fail an upload */
    }
  }

  // ─── HOURLY CONSENT RETRY AFTER A REJECTED REGISTRATION (S5) ─────────────
  // One pending timer at most; re-armed only by another rejection. `.unref()`
  // so the timer never keeps the host process alive. Stopped on success,
  // disable(), and forget(); the callback re-checks enabled + kill-switch at
  // fire time so a late tick can never resurrect a stopped runtime.
  let consentRetryTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── ON-DEMAND CONSENT SUPPRESSION AFTER A REJECTED REGISTRATION ─────────
  // The hourly timer above is the ONLY thing allowed to re-knock after a
  // 401/403: without this, every upload path's lazy `if (!deleteToken)
  // postConsent()` re-tried consent on EVERY inbound request, so a customer
  // whose key got revoked turned their own traffic into a per-request 403
  // storm against the server. While this deadline is in the future, on-demand
  // consents return without touching the network; the timer's retry (and an
  // explicit `client.consent()` call) bypass it, and a success clears it.
  let consentSuppressedUntil = 0;

  // ─── RENEWING A CREDENTIAL ANOTHER COPY REPLACED ─────────────────────────
  // Every process or replica started with one install id is a copy of the
  // same install, and Boosthis holds one credential for it. When another copy
  // reconnects and is handed a newer credential, this copy's uploads and
  // check-ins start coming back refused, and it used to stay silent until it
  // restarted.
  //
  // Boosthis now says WHY it refused a credential (`credentialRefusal` on the
  // 401), and exactly one answer renews: "mismatch", the credential is not the
  // one on file because it was replaced. The kit then re-reads the shared
  // store first (another process on this host may already hold the renewed
  // credential, and adopting it leaves that process's credential working);
  // otherwise it asks again the ordinary way WITHOUT presenting the dead
  // credential, adopts and persists what comes back, and sends the refused
  // upload once more.
  //
  // Guard rails, the same in every kit:
  //   • never on a 429, a 5xx, a network error, a missing credential, one
  //     Boosthis holds nothing for, or a cut-off install — renewing changes
  //     none of them;
  //   • never mints an install id and never takes the reinstall self-heal;
  //   • concurrent refusals share ONE renewal; the memo gates later attempts
  //     by whether the previous call was answered;
  //   • a credential the server handed back on renewal that is refused again
  //     stops here, reported, rather than looping;
  //   • the held credential is never dropped while asking, so an upload path
  //     running meanwhile cannot register a second time underneath it, and a
  //     renewal that brings nothing back leaves the process exactly as it was;
  //   • never inside an exit flush, whose budget a renewal round trip would
  //     overrun: the next run renews instead;
  //   • never for a crash REPLAY, which authenticates as the install that
  //     crashed, not as this one.
  let renewalInFlight: Promise<string | null> | null = null;
  /** The credential the last renewal started FROM. */
  let renewalAttemptedFor: string | null = null;
  let renewalDue = 0;
  let renewalStep = 0;
  let renewalAnswered = false;
  let renewalFloor = 0;
  /** What the last renewal produced, or null when it produced nothing. */
  let renewalProduced: string | null = null;
  /** The last credential the SERVER handed back on renewal. One adopted from
   *  the shared store (or found already replaced) is not counted: if it is
   *  refused too, it is renewed from once, like any other. */
  let renewalRenewed: string | null = null;

  /** The single-flight renewal. Returns a credential to retry with, or null.
   *  Never throws. */
  async function renewCredentialOnce(stale: string): Promise<string | null> {
    if (!stale) return null;
    while (renewalInFlight) {
      await renewalInFlight.catch(() => null);
    }
    // A credential the server handed back on renewal, refused again: stop.
    if (stale === renewalRenewed) return null;
    if (stale === renewalAttemptedFor && Date.now() < renewalDue) {
      // Already renewed from (perhaps by the renewal this caller just waited
      // for). Retry with its result, but only while it is still the one held.
      const result = renewalProduced;
      return result && result !== stale && deleteToken === result
        ? result
        : null;
    }
    if (stale !== renewalAttemptedFor) renewalStep = 0;
    renewalAttemptedFor = stale;
    renewalAnswered = false;
    renewalFloor = 0;
    const flight = (async (): Promise<string | null> => {
      let fresh: string | null = null;
      let fromServer = false;
      try {
        [fresh, fromServer] = await renewCredentialFrom(stale);
      } catch {
        fresh = null;
        fromServer = false;
      }
      renewalProduced = fresh && fresh !== stale ? fresh : null;
      renewalDue = Date.now() + (renewalAnswered ? RENEWAL_ANSWERED_WAIT_MS : retryWait(RENEWAL_RETRY_SCHEDULE_MS, renewalStep++, renewalFloor));
      if (renewalAnswered) renewalStep = 0;
      if (renewalProduced && fromServer) renewalRenewed = renewalProduced;
      renewalInFlight = null;
      return renewalProduced;
    })();
    renewalInFlight = flight;
    return flight;
  }

  /** Replace a refused credential. Returns the credential now held (or null
   *  when nothing changed) and whether the server itself handed it back. */
  async function renewCredentialFrom(
    stale: string,
  ): Promise<[string | null, boolean]> {
    if (isBoosthisDisabled() || forgottenSinceEnable) return [null, false];
    await credsReady;
    if (!enabled || isBoosthisDisabled() || forgottenSinceEnable) return [null, false];
    // Nothing held means nothing was replaced: the refusal has another cause.
    const held = deleteToken;
    if (!held) return [null, false];
    // Already replaced (a registration reply landed meanwhile): that newer
    // credential is the answer, with no round trip.
    if (held !== stale) return [held, false];
    // The shared store first. Another process sharing it may already have
    // renewed; adopting what it saved costs nothing and, unlike a second
    // renewal, leaves the credential that process holds working.
    try {
      const stored = await storage.get(deleteTokenStoreKey);
      if (!enabled || isBoosthisDisabled() || forgottenSinceEnable) return [null, false];
      if (stored && stored !== stale) {
        if (deleteToken !== stale || forgottenSinceEnable) return [null, false];
        deleteToken = stored;
        opts.onTokenIssued?.(stored);
        const storedRead = await storage.get(readTokenStoreKey);
        if (!enabled || isBoosthisDisabled() || forgottenSinceEnable) return [null, false];
        if (storedRead && storedRead !== readToken) {
          readToken = storedRead;
          opts.onReadTokenIssued?.(storedRead);
        }
        publishPanelState();
        return [stored, false];
      }
    } catch {
      // An unreadable store just means asking Boosthis instead.
    }
    // No project key, nothing to ask with.
    if (!projectKey.key) return [null, false];
    const installId = activeInstallId;
    // The same registration call, made WITHOUT the held credential (presenting
    // the replaced one would be read as a proof attempt), so Boosthis answers
    // it as this known install reconnecting and hands its credential back. The
    // reply is adopted and persisted by the ordinary registration path.
    const status = await postConsent({ withoutHeldCredential: true });
    renewalAnswered = !temporaryConsentStatus(status) && !(status >= 200 && status < 300 && consentUnreadable);
    renewalFloor = retryFloor;
    // Anything else moving meanwhile (a rotation, a forget) wins.
    if (activeInstallId !== installId || forgottenSinceEnable) {
      return [null, false];
    }
    const now = deleteToken;
    return now && now !== stale ? [now, true] : [null, false];
  }

  /** One upload, sent with `held` — and, when Boosthis says another copy
   *  replaced that credential, renewed and sent once more. Hands back the
   *  answer the call site judges (the retry's when one ran) and the refusal
   *  fields of a credential refusal, read once, for the log line.
   *
   *  Every attempt goes through the pause Boosthis can ask for (see
   *  uploadPause.ts): while one holds this kind of upload no request is made
   *  and the call site gets a local 429, which it treats like Boosthis's own —
   *  keep the batch, send it later. */
  async function sendUpload(
    upload: PausedUpload,
    held: string,
    attempt: (credential: string) => Promise<Response>,
  ): Promise<{ res: Response; refusal: RefusalBody | null }> {
    const res = await pacedUpload(upload, () => attempt(held));
    if (isNoSendResponse(res) || isLocalPauseAnswer(res)) {
      return { res, refusal: null };
    }
    const refusal = await readCredentialRefusal(res);
    if (isExitFlushRunning() || !isCredentialMismatch(res.status, refusal)) {
      return { res, refusal };
    }
    const fresh = await renewCredentialOnce(held);
    if (!fresh || fresh === held) return { res, refusal };
    const retried = await pacedUpload(upload, () => attempt(fresh));
    if (isNoSendResponse(retried) || isLocalPauseAnswer(retried)) {
      return { res: retried, refusal: null };
    }
    return { res: retried, refusal: await readCredentialRefusal(retried) };
  }

  /** Judge an upload's answer and, when Boosthis refused it, say which
   *  refusal in the log — once per process and reason. */
  function judgeUpload(
    res: Response,
    refusal: RefusalBody | null,
    alsoRead?: (body: unknown) => void,
  ): boolean {
    const ok = noteUpload(res, alsoRead);
    // A pause held this upload here and no request was made: Boosthis said
    // nothing new, so there is nothing new to say.
    if (!ok && !isNoSendResponse(res) && !isLocalPauseAnswer(res)) {
      noteUploadRefusedOnce(res.status, refusal);
    }
    return ok;
  }

  // ─── COVERAGE FRESHNESS ───────────────────────────────────────────────────
  // Registration happens at start-up. Most of what the coverage inventory has
  // to say does not exist yet at start-up: the database client is armed at the
  // FIRST REQUEST, a job library the app requires lazily is not in the module
  // cache until something needs it, and no request has been timed. An
  // inventory sent once at boot would therefore be systematically incomplete,
  // and — worse — would read on the dashboard as "nothing unwatched here" for
  // the life of the process. That is exactly the false clean bill of health
  // this whole feature exists to prevent.
  //
  // So the answer is re-sent when it CHANGES, and only then. Bounded hard: at
  // most a handful of refreshes per process and never more often than the gap
  // below, because a re-registration is a real round trip and a coverage
  // update is worth far less than the customer's request latency.
  let lastCoverageSent: string | null = null;
  let coverageRefreshes = 0;
  let coverageCheckedAt = 0;
  const MAX_COVERAGE_REFRESHES = 6;
  const COVERAGE_REFRESH_GAP_MS = 60_000;

  /** Re-register when this app's coverage picture has actually changed.
   *  Fire-and-forget, never throws, and a no-op until the answer differs. */
  function maybeRefreshCoverage(): void {
    try {
      if (!enabled || isBoosthisDisabled()) return;
      if (coverageRefreshes >= MAX_COVERAGE_REFRESHES) return;
      const now = Date.now();
      if (now - coverageCheckedAt < COVERAGE_REFRESH_GAP_MS) return;
      coverageCheckedAt = now;
      const fingerprint = coverageFingerprint(coverageInventory());
      // `null` means the first consent has not happened yet — it will carry the
      // inventory itself, so there is nothing to refresh.
      if (lastCoverageSent === null || fingerprint === lastCoverageSent) return;
      void postConsent({ onDemand: true }).then((status) => {
        if (status >= 200 && status < 300) coverageRefreshes++;
      }).catch(() => {
        /* a coverage update is never worth disturbing the host */
      });
    } catch {
      /* observing must never disturb the host */
    }
  }

  function stopConsentRetry(): void {
    if (consentRetryTimer !== null) {
      clearTimeout(consentRetryTimer);
      consentRetryTimer = null;
    }
  }

  /** Arm the quiet re-registration attempt. Defaults to the hourly rhythm the
   *  401/403 branch wants; the throttle branch passes the server's OWN
   *  `Retry-After` instead, so the kit comes back exactly when it was told to
   *  and not an hour after a wait that was over in minutes. */
  function scheduleConsentRetry(afterMs: number = consentRetryMs): void {
    if (isServerlessMode()) return;
    if (consentRetryTimer !== null) return;
    consentRetryTimer = setTimeout(() => {
      consentRetryTimer = null;
      if (!enabled || isBoosthisDisabled()) return;
      // Carries nothing of its own: it retries the REGISTRATION. If the reason
      // there is no install is that we will never measure, retrying is exactly
      // the thing not to do.
      void postConsent({ registrationOnly: true }).catch(() => {
        if (enabled && !isBoosthisDisabled()) scheduleConsentRetry(afterMs);
      });
    }, afterMs);
    const t = consentRetryTimer as { unref?: () => void };
    if (typeof t.unref === "function") t.unref();
  }

  // ─── SELF-HEALING REINSTALL RECOVERY (identity rotation) ──────────────────
  // A redeployed/reprovisioned process keeps its host-baked installId but can
  // lose its stored tokens, so its tokenless re-consent gets the idempotent
  // orphan response ("already_registered_no_token") forever. Because a FRESH
  // registration with a valid invite key is already permitted (that is exactly
  // what a brand-new install does), the kit recovers on its own: mint a fresh
  // random installId, persist the mapping in kit-owned storage (keyed by the
  // baked id so relaunches that re-pass the baked id keep resolving to the
  // rotated identity), and re-register under the new identity. Server
  // capability is UNCHANGED — no new endpoint, no weakened proof rule; the old
  // row's credentials stay dead and the row simply goes dormant.
  //
  // Guard rails (parity with the RN kit):
  //   • fires ONLY on the orphan status, with an invite key in hand, and with
  //     no tokens (a Repair-window response carries tokens and takes the
  //     normal adoption path — rotation can never race an owner's Repair);
  //   • at most ONE rotation per session (no retry loops);
  //   • a persisted mapping is adopted only if it is UUID-shaped;
  //   • forget() erases the mapping (leave nothing Boosthis-shaped behind).
  /** Did a registration reply carry the entitlement with it? When it did, a
   *  function host has no reason to make a second call. */
  let entitlementCameBack = false;
  let activeInstallId = bakedInstallId;
  let rotatedThisSession = false;
  const rotationStoreKey = `rotatedInstallId:${bakedInstallId}`;

  // Adopt a previously-persisted rotation BEFORE the first network call so a
  // rotated install keeps its post-rotation identity across relaunches (the
  // host keeps passing the baked id forever). Node storage is async, so every
  // outbound path awaits this one-shot promise; after it settles the await is
  // a no-op microtask.
  const rotationReady: Promise<void> = (async () => {
    try {
      const stored = await storage.get(rotationStoreKey);
      if (
        typeof stored === "string" &&
        INSTALL_ID_SHAPE.test(stored) &&
        stored !== bakedInstallId
      ) {
        activeInstallId = stored;
      }
    } catch {
      /* storage failure — continue with the baked id (fail-open) */
    }
  })();

  /** (Re)install the server-authority kill-switch heartbeat for the CURRENT
   *  identity. startEntitlementCheckin captures installId by value, so every
   *  identity change (persisted-rotation adoption, in-session rotation) must
   *  repoint it — otherwise the heartbeat knocks with the old id + the new
   *  token and the activation lock never releases. `getToken` is lazy so the
   *  token minted by consent (read OR delete) is picked up on the next check.
   *  This is the VAULT contract's on-launch enforcement edge: the first check
   *  runs a FORCED launch check-in (bypassing any cache-satisfied fast path). */
  function installCheckinConfig(): void {
    startEntitlementCheckin({
      endpoint,
      installId: activeInstallId,
      getToken: () => deleteToken ?? readToken,
      kitVersion: packageVersion,
      integrity: opts.integrity ?? null,
      fetchImpl: fetchOptions.fetchImpl,
      // The one renewal the upload paths share, so a check-in and an upload
      // refused together renew once between them.
      renewCredential: (stale) => renewCredentialOnce(stale),
      onVerdict: (status) => {
        if (status !== "active") stopConsentRetry();
        if (status === "paused") directivesOwed = true;
        if (status === "active" && directivesOwed && enabled && !forgottenSinceEnable) {
          directivesOwed = false;
          void postConsent().catch(() => { directivesOwed = true; });
        }
      },
    });
  }

  // Kick the launch check-in once the persisted-rotation adoption settles so
  // the heartbeat uses the identity that actually owns the data.
  void rotationReady
    .then(async () => {
      if (!enabled || isBoosthisDisabled()) return;
      installCheckinConfig();
      // DISSOLVED BY AN EARLIER RUN (docs/kit-lock-rule.md). The erase took the
      // credentials, so the check-in just started has nothing to ask with. This
      // run asks ONCE, the way a fresh install does — by registering — and the
      // answer that reply carries settles it. Until then every door goes
      // straight through to the app.
      await credsReady;
      if (!enabled || isBoosthisDisabled()) return;
      if (deleteToken || readToken) return;
      // LOCKED BY A STORED ANSWER, WITH NOTHING TO CHECK IN WITH. An `active`
      // answer whose grace ran out locks the kit before it measures anything,
      // and the stored answer is the store's, not this install id's: a new id
      // on the same store holds no credential. Every lazy registration rides an
      // upload the lock refuses, so without this the install would never ask
      // and would stay locked on every restart. It asks once, by registering,
      // as a dissolved install does. A named lock (revoked, paused…) is not
      // asked about: the registration path refuses it.
      const lapsedWithoutCredential = isKitLocked() && !_isRuntimeKilledInternal();
      if (!isAwaitingAskAfterDissolve() && !lapsedWithoutCredential) return;
      await postConsent({ registrationOnly: true });
      // A reply that registered but carried no answer: the check-in asks once
      // with the credential it just received.
      if ((isAwaitingAskAfterDissolve() || isKitLocked()) && (deleteToken || readToken)) {
        installCheckinConfig();
      }
    })
    .catch(() => {
      /* never throw into the host */
    });

  /** The server tag to register with, or null when we have no honest answer.
   *  Never throws: a detection failure registers without the tag rather than
   *  failing consent over a diagnostic label. */
  function serverKindForConsent(): string | null {
    try {
      const kind = detectServerKind();
      return kind === "unknown" ? null : kind;
    } catch {
      return null;
    }
  }

  /**
   * A knock that would CREATE this install, from a process that has already
   * decided it will never measure anything.
   *
   * `attach()` answering no is not "nothing yet" — it is a settled fact about
   * the rest of this process's life. When it is the ONLY way in (no Express
   * middleware timing requests, no wrapped job runner, no watched outbound or
   * database work: `watched` is empty), a registration puts a row on the
   * owner's dashboard that is counted, looks exactly like a healthy quiet
   * install, and is structurally incapable of ever reporting. A Bun service
   * did precisely that to a real project.
   *
   * Deliberately reason-agnostic: Bun's refusal is gone, but Deno's, the edge
   * runtime's and a locked dispatch's are all the same promise broken the same
   * way. Fail-safe in the other direction — anything unreadable here answers
   * "no", because withholding a registration we were not sure about would be a
   * worse failure than the one this prevents.
   */
  function wouldRegisterAnInstallThatCannotReport(): boolean {
    try {
      if (!attachWasRefused()) return false;
      return coverageInventory().watched.length === 0;
    } catch {
      return false;
    }
  }

  /** Register (or re-register) with the server. `onDemand: true` marks the
   *  lazy consent fired from upload paths (`if (!deleteToken) postConsent()`),
   *  which is SUPPRESSED while a backoff window is open — a 401/403 rejection,
   *  a 429 throttle (for as long as the server's own `Retry-After` says), or
   *  the one-minute floor after an unexplained refusal. The retry timer and
   *  explicit `client.consent()` calls bypass the suppression so a key fixed
   *  server-side still brings the app back without a restart.
   *
   *  `registrationOnly: true` marks the knocks that carry NOTHING of their own
   *  — boot, the retry timer, the exit-ready settle — as opposed to the lazy
   *  consent a real upload does first. Only those are withheld when the attach
   *  has been refused: a process that genuinely has something to file (a crash
   *  report, a snapshot, a job run) still registers and still files it, with
   *  the `attach-refused` coverage gap riding along to say what is missing and
   *  why. "Do not register an install that can never report" must not become
   *  "throw away the reports we do have". */
  let consentStep = 0;
  let consentFlight: Promise<number> | null = null;
  let orphanAnswer = false;
  /** This attempt's 2xx carried no JSON object: a captive portal's page, a
   *  proxy's empty success. Nothing in it came from Boosthis, so it answers
   *  nothing and is retried like no answer at all. */
  let consentUnreadable = false;
  /** This attempt was withheld on purpose: the attach was refused and the
   *  knock carried nothing of its own. That is a local decision, not a failed
   *  call, so it arms no retry and no suppression. Above all, a real upload's
   *  lazy consent must still register the install and file what it holds. */
  let consentWithheld = false;
  let retryFloor = 0;
  let directivesOwed = false;
  let functionVerdictDue = 0;
  let functionVerdictStep = 0;
  async function postConsent(callOpts?: { onDemand?: boolean; registrationOnly?: boolean; withoutHeldCredential?: boolean }): Promise<number> {
    if (!enabled || forgottenSinceEnable || isBoosthisDisabled()) return 0;
    if (_isRuntimeKilledInternal()) {
      markRegistrationUnreachable();
      return 0;
    }
    if (consentFlight) return consentFlight;
    if (callOpts?.onDemand && Date.now() < consentSuppressedUntil) return 0;
    const generation = consentGeneration;
    const run = async () => {
      orphanAnswer = false;
      consentUnreadable = false;
      consentWithheld = false;
      retryFloor = 0;
      const status = await postConsentAttempt(callOpts);
      if (generation !== consentGeneration || !enabled || forgottenSinceEnable || isBoosthisDisabled() || _isRuntimeKilledInternal() || callOpts?.withoutHeldCredential) return status;
      if (consentWithheld) return status;
      if (temporaryConsentStatus(status) || (status >= 200 && status < 300 && (consentUnreadable || (!deleteToken && !readToken && !orphanAnswer)))) {
        const wait = retryWait(REGISTRATION_RETRY_SCHEDULE_MS, consentStep++, retryFloor);
        stopConsentRetry();
        consentSuppressedUntil = Date.now() + wait;
        scheduleConsentRetry(wait);
      } else {
        consentStep = 0;
        if (status !== 401 && status !== 403 && !orphanAnswer) stopConsentRetry();
      }
      return status;
    };
    consentFlight = run();
    try { return await consentFlight; } finally { consentFlight = null; }
  }

  async function postConsentAttempt(callOpts?: {
    onDemand?: boolean;
    registrationOnly?: boolean;
    /** Ask WITHOUT presenting the held credential. Only a renewal does: the
     *  replaced credential would be read as a proof attempt. The credential
     *  stays held meanwhile, so nothing else registers underneath it and the
     *  reinstall self-heal (which needs NO credential held) cannot fire. */
    withoutHeldCredential?: boolean;
  }): Promise<number> {
    const generation = consentGeneration;
    if (callOpts?.onDemand && Date.now() < consentSuppressedUntil) return 0;
    // Adopt any persisted rotation before the first network call — a rotated
    // install must knock with its post-rotation identity, not the baked id.
    await rotationReady;
    // And restore any persisted credentials first, so a restarted process
    // re-authenticates instead of knocking tokenless into the orphan path.
    await credsReady;
    if (generation !== consentGeneration || !enabled || forgottenSinceEnable || isBoosthisDisabled()) return 0;
    // Withhold ONLY the knock that would bring a never-reporting install into
    // existence. An install that already exists (either token restored above)
    // keeps re-consenting: the server has the row either way, and the
    // coverage inventory on this very call is what tells it the attach failed.
    if (
      callOpts?.registrationOnly &&
      !deleteToken &&
      !readToken &&
      wouldRegisterAnInstallThatCannotReport()
    ) {
      try {
        // Say it on the kit's own surfaces (status page, panel, worker status)
        // rather than in a second console line — the attach refusal already
        // said this at startup, in one place, ungated.
        registrationRefusalKind = "attach-refused";
        registrationRefusalOpts = {};
        // A definite local negative, not an unanswered question: this process
        // chose not to register, so "cannot tell" would be false.
        markRegistrationRefused();
      } catch {
        /* a notice must never disturb the host */
      }
      consentWithheld = true;
      return 0;
    }
    let res: Response;
    let sentCoverage: string | null = null;
    const displayName = resolveAppName(opts.appName);
    try {
      res = await _safeTransmitInternal(
        `${endpoint}/installs/consent`,
        {
          installId: activeInstallId,
          // The install names its own engine. This kit and the React Native
          // kit both used to register under a shared "js", which left the
          // dashboard unable to tell a customer's back end from a member of
          // the public's phone — same row, same two-letter code. Each now
          // names itself. The server still ACCEPTS "js" forever, so an older
          // kit in the field keeps working untouched.
          //
          // These same bytes also run on Bun, and an install there says so:
          // filing a Bun project as ordinary Node would hide it on the
          // dashboard, and would also promise seven readings Bun cannot take.
          runtime: kitRuntimeTag(),
          packageVersion,
          // WHAT THIS BUILD'S CODE ASKED FOR — never what is in effect. The
          // server's own switch still wins in both directions and nothing here
          // changes that; sending this is what lets the owner's page show the
          // two answers side by side, instead of describing a code setting it
          // has never been told. See lib/telemetry-mode-contract.json.
          telemetryMode: issuesOnly ? "reduced" : "full",
          // WHICH KIND OF SERVER this project runs — express, fastify, hono,
          // nest, next or a plain Node server. Positive evidence only (see
          // serverKind.ts): the tag names a framework that is really loaded or
          // really serving, never one a package.json merely mentions. It is
          // diagnostic, so it is sent only when we HAVE an answer: an omitted
          // tag reads as "not stated" on the dashboard, while sending
          // "unknown" would claim we looked and found nothing.
          ...(serverKindForConsent() ? { serverKind: serverKindForConsent() } : {}),
          // Display name (metadata): an explicit `opts.appName` if the developer
          // set one, else a best-effort auto-detected name (npm_package_name /
          // package.json) so the dashboard shows a friendly name instead of a
          // churny install id with zero wiring. The auto path clamps + drops a
          // guard-tripping name so it can never break consent; the PII guard
          // still screens the value before it leaves.
          ...(displayName ? { appName: displayName } : {}),
          // WHERE THIS PROJECT RUNS. The hosting platform, its region and
          // whether this is production or a throwaway preview, each recognised
          // from what the platform itself publishes and each sent as a word
          // from a fixed list (see hosting.ts). Read fresh on every process, so
          // a project that gets republished somewhere else stops being
          // described by where it used to run.
          //
          // Sent unconditionally, because every one of the three has a real
          // answer for the "nothing declared itself" case: an ordinary server
          // says so rather than going quiet, and only an install from a kit
          // built before this existed leaves the record blank.
          hosting: hostingFacts(),
          identity: {
            source: identitySource,
            ...(identityStore ? { store: identityStore } : {}),
            ...(identityRestored !== undefined
              ? { restored: identityRestored }
              : {}),
          },
          // FUNCTION HOSTS. The platform code (a closed numeric vocabulary —
          // the server owns every word a human reads) and the DIGEST of the
          // platform's own project scope. Together with the project key on the
          // Authorization header these are the exact inputs the kit derived its
          // install id from, so the server can recompute the id and refuse
          // anything that does not match: the identity is verified, not merely
          // asserted, and one project's key can never reach another's install.
          //
          // ONLY for a DERIVED id. A function whose host supplies a fixed id
          // (BOOSTHIS_INSTALL_ID, or an explicit option) is the fallback this
          // kit itself recommends when there is nothing to derive from — and
          // declaring the claim for such an id would have the server recompute
          // a different id and refuse the registration as an identity mismatch,
          // permanently, on the configuration we told the customer to use.
          ...(isServerlessMode() && identityWasDerived
            ? {
                serverless: {
                  platform: serverlessHost().platform,
                  scopeHash: scopeHashFor(serverlessHost()),
                },
              }
            : {}),
          // WHAT WE ARE NOT WATCHING IN THIS APP. Green meters read as full
          // coverage, and this kit is the only thing that knows they are not:
          // that `attach()` was refused, that the app loaded a job library we
          // have no adapter for, that a function handler was never wrapped.
          // Terms from `watchableSurfaces.ts` and counts — never a module,
          // route or library name. Sent as a fact about surfaces, not as a
          // score: there is no percentage here and there must never be one.
          //
          // Re-sent whenever the answer CHANGES (see maybeRefreshCoverage):
          // this fires at start-up, before the app has served a request or
          // lazily required its queue library, so a once-only inventory would
          // read as "nothing unwatched" for the life of the process.
          ...(() => {
            try {
              const inv = coverageInventory();
              sentCoverage = coverageFingerprint(inv);
              return inv.watched.length > 0 || inv.unwatched.length > 0
                ? { coverage: inv }
                : {};
            } catch {
              return {};
            }
          })(),
        },
        // Consent is the step that LEADS to activation, so it must be allowed
        // to send while the kit is merely LOCKED (never handshaken). A KILLED
        // install (revoked / unpaid / grace-expired) is still silenced.
        { ...fetchOptions, allowWhenLocked: true },
        projectKey.key ? `Bearer ${projectKey.key}` : undefined,
        // Proof of control for the one-time read-token backfill. On re-consent
        // of an install created before read tokens existed, the server only
        // mints + returns a self-scoped read token when the caller proves it
        // owns the install by presenting the delete token. The Authorization
        // header carries the invite key, so the delete token rides in this
        // dedicated internal header (applied AFTER the PII guard). Omitted on
        // first consent (no delete token yet) — the fresh-register path mints
        // the read token unconditionally. Omitted on a renewal too: the held
        // credential is the one Boosthis just said was replaced.
        deleteToken && !callOpts?.withoutHeldCredential
          ? { "X-Boosthis-Install-Token": deleteToken }
          : undefined,
      );
    } catch (err) {
      if (generation !== consentGeneration || !enabled || forgottenSinceEnable || isBoosthisDisabled()) return 0;
      // A PII-guard failure is a programming bug, NOT a transport failure — let
      // it propagate exactly as before, so it is never mislabeled as "could not
      // reach the API".
      if (err instanceof Error && err.name === "PIIDetectedError") throw err;
      // No HTTP answer at all — DNS, TLS, egress, a proxy, or a broken
      // certificate store. This is the case that cost a real customer ~19
      // minutes: the kit stayed silent and a healthy-looking process uploaded
      // nothing. Say it ONCE, on stderr, carrying a FIXED, kit-owned
      // classification of the caught error (never the error's own text, which
      // can embed a request URL, a credential-bearing URL, or remote prose) —
      // that classification is where the actual fault (a cert-store or egress
      // failure) shows up. Network/transport failures still return 0 instead of
      // propagating.
      const detail = transportErrorParenthetical(err);
      warnStayedInactiveOnce("no-answer", { detail });
      // We could not reach Boosthis at all, so we do not KNOW whether this
      // install is on file. "Cannot tell", never "not registered".
      markRegistrationUnreachable();
      return 0;
    }
    // NOTHING WAS SENT. A silenced POST is answered with a locally-invented
    // 204, and a 204 is `ok`, so this branch used to publish a registration
    // the server was never asked about. We know only that we did not ask —
    // never that the install is on file — so the verdict is "cannot tell",
    // exactly as it is when the request could not leave the process.
    if (isNoSendResponse(res)) {
      markRegistrationUnreachable();
      return 0;
    }
    // ERASED SINCE THIS WENT OUT. The reply describes an install this process
    // has been told to forget: its credentials, its owner's directives, its
    // project name. Applying any of it would undo part of the erasure — a
    // server-issued delete token would go straight back into memory and on to
    // disk — and saying anything about registration would be a statement
    // about a state this process has left behind. Hand back the status and
    // apply nothing. (`forget()` raises this before its first await, so a
    // knock that lands mid-erasure is caught as surely as one that lands
    // after it.)
    if (generation !== consentGeneration || !enabled || forgottenSinceEnable || isBoosthisDisabled() || _isRuntimeKilledInternal()) return res.status;
    // DISSOLVED SINCE THIS WENT OUT, for the same reason: the local erase has
    // run, and a credential on this reply would go straight back on to disk.
    if (isDissolvedThisRun()) return res.status;
    if (res.ok) {
      // A 2xx is not yet an answer. A captive portal, a hotel's sign-in page
      // or a proxy's own success page all arrive as one, and none of them
      // came from Boosthis. Read the body FIRST: only a JSON object counts as
      // this call answered. Anything else leaves every record of this call
      // as it was (the watched list unsent, the retry still due, no refusal
      // cleared) and the call is retried like one that got no answer.
      // Bounded while reading: an answer over the ceiling or too slow is
      // unreadable in exactly the same way.
      let answer: unknown = null;
      try {
        answer = await readAnswerJson(res);
      } catch {
        answer = null;
      }
      if (generation !== consentGeneration || !enabled || forgottenSinceEnable || isBoosthisDisabled() || _isRuntimeKilledInternal()) return res.status;
      if (answer === null || typeof answer !== "object" || Array.isArray(answer)) {
        consentUnreadable = true;
        markRegistrationUnreachable();
        return res.status;
      }
      lastCoverageSent = sentCoverage;
      // Registration accepted — cancel any pending rejected-registration
      // retry so the timer never fires a redundant consent, and lift the
      // on-demand suppression window (the credential problem is over).
      stopConsentRetry();
      consentSuppressedUntil = 0;
      // A registration the server ACCEPTED proves the install id is valid, so
      // discard any earlier invalid-install-id rejected state (a developer who
      // saw the rejection, minted a real UUID, and re-registered in the same
      // process must get the normal dashboard back, not a stale rejection).
      registrationRejection = null;
      // Same for the "stayed inactive because…" sentence the status page, the
      // panel and the worker's status text read. It describes a registration
      // that did not happen, and one just did — leaving it set is how a
      // recovered install goes on telling its developer it is refused. (Also
      // the case for every server-side reason: a 500 followed by a success
      // used to keep the refusal sentence for the life of the process.)
      registrationRefusalKind = null;
      registrationRefusalOpts = {};
      try {
        const body = answer as {
          deleteToken?: unknown;
          readToken?: unknown;
          shareMeterWithAI?: unknown;
          fullTelemetry?: unknown;
          status?: unknown;
          disconnected?: unknown;
          projectName?: unknown;
          projectCode?: unknown;
          promises?: unknown;
          entitlement?: {
            status?: unknown;
            graceSeconds?: unknown;
            message?: unknown;
            recheckAfterSeconds?: unknown;
          };
        };
        if (generation !== consentGeneration || !enabled || forgottenSinceEnable || isBoosthisDisabled() || _isRuntimeKilledInternal()) return res.status;
        directivesOwed = body?.disconnected === true;
        orphanAnswer = body?.status === "already_registered_no_token";
        // THE COLD PATH, COLLAPSED. The server already knows this project's
        // entitlement when it answers a registration, so it now says so on the
        // same reply. On a function that means being alive costs ONE round trip
        // instead of two — registration and the entitlement check used to be
        // separate calls, and on a 200 ms invocation a second call is not
        // overhead, it is the workload. Applied through the same path as a
        // check-in answer, so there is one verdict everywhere.
        const ent = body?.entitlement;
        if (ent && typeof ent.status === "string") {
          entitlementCameBack = true;
          adoptEntitlementAnswer({
            status: ent.status as never,
            graceSeconds:
              typeof ent.graceSeconds === "number" ? ent.graceSeconds : undefined,
            message: typeof ent.message === "string" ? ent.message : null,
            recheckAfterSeconds:
              typeof ent.recheckAfterSeconds === "number"
                ? ent.recheckAfterSeconds
                : undefined,
          });
          // This very reply dissolved the kit: the local erase is under way,
          // and nothing else on the reply may be kept.
          if (isDissolvedThisRun()) return res.status;
        }
        // WHICH PROJECT this key belongs to. The name is DEVELOPER-authored —
        // the one such string this kit ever renders — so it is re-sanitised on
        // the way in and set as text, never markup, by every surface that draws
        // it. Persisted so a restart still names the project.
        if (body?.projectName != null || body?.projectCode != null) {
          setKitProject(body.projectName, body.projectCode);
          void storage
            .set(projectStoreKey, serializeKitProject(getKitProject()))
            .catch(() => {
              // Best-effort: an unwritable store only means the next boot says
              // "not received yet" until its first consent reply lands.
            });
        }
        // WHAT THE DEVELOPER SAID MUST STAY TRUE. Their own words plus a
        // closed standing token — no sentence of ours travels, and no verdict
        // does either (see projectIdentity). Screened again on the way in and
        // rendered as text. Persisted for the same reason the name is: a
        // restarted process should not blank a page the developer is reading.
        //
        // UNCONDITIONAL, unlike the project name above. The reply is this
        // run's whole answer about the promises: it carries an empty list for
        // a project holding none, and carries nothing when Boosthis could not
        // read them. Applying only the first would leave a deleted promise on
        // the page for the life of the process, and the persisted copy would
        // put it back on the next one.
        setKitPromises(body?.promises);
        void storage
          .set(promisesStoreKey, serializeKitPromises())
          .catch(() => {
            // Best-effort: an unwritable store only means the next boot
            // shows no promises until its first consent reply lands.
          });
        // Adopt any server-issued delete token and — critically — notify the
        // host whenever the VALUE changes, not just the first time one is
        // issued. A process can come back holding a STALE persisted token
        // (redeploy, or a host that regenerated its installId while keeping
        // old storage); the server then mints fresh credentials (fresh
        // registration, or an owner-approved repair re-issue). If the host is
        // only told on first issuance, it keeps re-persisting the stale token
        // and every relaunch is broken again — so fire on change.
        const issued =
          typeof body?.deleteToken === "string" ? body.deleteToken : null;
        if (issued) {
          const changed = issued !== deleteToken;
          deleteToken = issued;
          // Persist it ourselves (parity with the read token below) so a
          // restarted process can re-authenticate — the on-disk store is what
          // stops every restart from landing in the tokenless orphan dead end.
          void storage.set(deleteTokenStoreKey, issued).catch(() => {
            // Best-effort persistence — an unwritable store just means the next
            // boot self-heals via identity rotation instead.
          });
          if (changed) opts.onTokenIssued?.(issued);
        }
        // Read token: minted on fresh registration and returned once, or
        // backfilled on a proof-of-control re-consent / repair re-issue.
        // Persist it ourselves (Node-specific) so the next boot restores it,
        // and fire the optional host callback whenever the value changes
        // (same rationale as the delete token above).
        const readIssued =
          typeof body?.readToken === "string" ? body.readToken : null;
        if (readIssued) {
          const changed = readIssued !== readToken;
          readToken = readIssued;
          void storage.set(readTokenStoreKey, readIssued).catch(() => {
            // Best-effort persistence — an unwritable store just means the next
            // boot re-mints via the backfill path.
          });
          if (changed) opts.onReadTokenIssued?.(readIssued);
        }
        // Server directive: the developer connected an AI from the web
        // dashboard, so auto-enable the PII-filtered snapshot mirror (even in
        // issues-only mode) so their own AI can read the meter. Rising-edge
        // only — it never turns the mirror off and never touches the sample
        // firehose. syncSnapshotUpload() wires the submitter immediately so the
        // next flush ships the snapshot.
        if (body?.shareMeterWithAI === true && !serverShareMeterWithAI) {
          serverShareMeterWithAI = true;
          syncSnapshotUpload();
        }
        // Dashboard "Full telemetry" directive — BOTH edges (parity with RN).
        // ON forces full mode for the session; OFF forces issues-only for the
        // session. The first boolean the server sends flips the three-state
        // `serverFullTelemetry` off its initial null, so from then on the
        // server wins in BOTH directions. The sample queue's issues-only flag
        // is recomputed here, but its PAUSE state stays owned by
        // disable()/enable(), so the directive can never resurrect a disabled
        // runtime; syncSnapshotUpload() self-guards on enabled + kill-switch.
        if (
          typeof body?.fullTelemetry === "boolean" &&
          body.fullTelemetry !== serverFullTelemetry
        ) {
          serverFullTelemetry = body.fullTelemetry;
          setSampleQueueIssuesOnly(effectiveIssuesOnly());
          syncSnapshotUpload();
        }
        // Both answers are known here for the first time — outside the block
        // above, so a response that merely REPEATS a directive we already hold
        // still gets the developer told. The helper self-guards on the
        // pre-contact state and says it once.
        noteTelemetryModeContradiction();
        // SELF-HEALING: the server says this install id is registered but we
        // hold no proof (orphaned identity — reprovision/redeploy lost the
        // stored tokens). If we have an invite key and this response carried
        // NO tokens (a Repair-window response carries tokens and was adopted
        // above — never rotate over a Repair), mint a FRESH identity and
        // re-register under it. Once per session, mapping persisted so every
        // later launch resolves the baked id to the rotated identity.
        //
        // The guard keys on the DELETE token only: a read token is a read-only
        // credential that can never upload, so a stale persisted
        // `readToken:<id>` with no delete token is exactly the restart dead
        // end this path exists to heal (the install would otherwise
        // re-consent tokenless forever while uploading nothing). The stale
        // read token is dropped before re-registering — the fresh
        // registration mints a fresh pair.
        if (
          body?.status === "already_registered_no_token" &&
          !deleteToken &&
          projectKey.key &&
          !rotatedThisSession
        ) {
          rotatedThisSession = true;
          if (readToken) {
            readToken = null;
            void storage.remove(readTokenStoreKey).catch(() => {
              /* best-effort — a fresh consent overwrites the key anyway */
            });
          }
          const rotated = generateRotationInstallId();
          try {
            await storage.set(rotationStoreKey, rotated);
          } catch {
            /* best-effort — an unwritable store means a session-only rotation */
          }
          activeInstallId = rotated;
          // Repoint the kill-switch heartbeat at the rotated identity so it
          // knocks with the id that actually owns the data (and the new token).
          installCheckinConfig();
          // ...and the crash buffer, so crashes this process persists from here
          // on are stamped with the identity that owns them. Without it the
          // next process reads them as another application's and never sends.
          setCrashOwnerInstallId(rotated);
          // Keep the persisted "installId" (used by the separate stdio MCP
          // process) pointing at the identity that actually owns the data.
          void storage.set("installId", rotated).catch(() => {
            /* best-effort */
          });
          // Re-register under the fresh identity — this is a normal fresh
          // registration and mints fresh credentials via the standard path.
          // Inherits the caller's "carries nothing" mark (never its onDemand
          // suppression, which this recovery has always been exempt from), so
          // a rotation cannot be the back door that files the very install the
          // knock above declined to file.
          return postConsentAttempt({ registrationOnly: callOpts?.registrationOnly });
        }
        // The orphan marker rode a 200, and rotation has already happened (or
        // cannot: no invite key to re-register with). This is NOT a working
        // registration — no delete token was issued, so the install can never
        // upload. Letting it read as connected is the exact silent dead end the
        // audit found. Say WHY once and stop; never loop.
        if (body?.status === "already_registered_no_token" && !deleteToken) {
          warnStayedInactiveOnce("orphan");
          // No credential came back, so every upload path would ask again on
          // its next upload and be told the same. Ask once an hour instead,
          // exactly as after a refused key: an owner's repair on the
          // dashboard is what changes this answer.
          consentSuppressedUntil = Date.now() + consentRetryMs;
          if (!callOpts?.withoutHeldCredential) scheduleConsentRetry();
        }
      } catch {
        // ignore malformed body — server health is the source of truth
      }
      // Consent succeeded and (typically) minted a token, so the kit can now
      // learn its true entitlement. Fire a FORCED launch check-in — the id is
      // registered and `getToken()` now returns a credential, so a revoked /
      // unpaid verdict lands immediately (and releases the activation lock for
      // an active project) without waiting for the 6h heartbeat.
      //
      // Not on a function host: the reply we just read CARRIES the entitlement,
      // so a second call would be the extra cold-start round trip this work
      // exists to remove. Only fall back to the separate check when the server
      // did not include one (an older API).
      if (!isServerlessMode()) {
        forceEntitlementCheck(true);
      } else if (!entitlementCameBack && !isActivated()) {
        functionVerdictDue = Date.now() + retryWait(FIRST_VERDICT_SCHEDULE_MS, functionVerdictStep++);
      }
      // Publish the (possibly changed) registration + sharing state to the
      // panel mirror so the bubble's silent-install notice is accurate.
      publishPanelState();
    } else if (res.status === 400) {
      // The server refused the id itself (non-UUID install id). Retrying an
      // UNCHANGED bad id can never succeed, so no consent retry is armed —
      // instead record the rejected state (the bubble renders it) and print
      // ONE fixed line telling the developer to mint a real UUID. A 400 that is
      // NOT the invalid_install_id marker has no specific handler, so it falls
      // back to the generic "refused (HTTP 400)" one-shot line — a broken
      // install must never be silent.
      void handleInvalidInstallIdOnce(res)
        .then((handled) => {
          if (!handled) warnStayedInactiveOnce("refused", { status: 400 });
        })
        .catch(() => {
          /* never throw into the host */
        });
    } else if (res.status === 401 || res.status === 403) {
      // Registration was rejected (bad/revoked invite key). The Node runtime
      // has no locked-screen UI, so surface a one-time plain-English hint —
      // then keep quietly knocking once an hour so a key fixed server-side
      // (rekey / rotation) brings this app back without a process restart.
      void warnRegistrationRejectedOnce(res);
      // The key was refused outright, so this app cannot be on file under it.
      // A definite negative — the one case where "not registered" is honest.
      markRegistrationRefused();
      // Open the on-demand suppression window: until the hourly retry fires,
      // upload-path lazy consents stay quiet instead of knocking once per
      // inbound request (the observed per-request 403 storm).
      consentSuppressedUntil = Date.now() + consentRetryMs;
      if (!callOpts?.withoutHeldCredential) scheduleConsentRetry();
    } else if (res.status === 429) {
      // ── RATE-LIMITED: the one refusal that fixes itself ──────────────────
      // A 429 used to fall into the catch-all below, which arms no timer and
      // opens no suppression window. With no token stored, every upload path
      // re-fires an on-demand registration, so the kit answered "slow down" by
      // knocking once per inbound request, for ever, saying nothing after the
      // first line. Exactly the storm the 401/403 branch above was written to
      // prevent — on the one status code that actually asks for a pause.
      //
      // The polarity was inverted: the permanent, human-blocked failure
      // recovered gracefully and the temporary one never recovered at all.
      // This branch is the 401/403 shape with the wait taken from the SERVER
      // instead of our fixed hour.
      const waitMs = parseRetryAfterMs(res) ?? THROTTLE_FALLBACK_WAIT_MS;
      retryFloor = waitMs;
      warnStayedInactiveOnce("throttled", {
        status: 429,
        retryAfterSeconds: Math.round(waitMs / 1000),
      });
      // "Throttled, waiting" — NOT "we could not reach the server". Same
      // public verdict (nobody looked at our records, so it is still unknown),
      // different recorded state, because the two need opposite reactions.
      markRegistrationThrottled();
      // Shut every on-demand knock until the wait is over. This is what stops
      // the eight upload call sites re-firing underneath the backoff, and it
      // is why honouring Retry-After here is not just politeness: we ship a
      // rule that fires when a customer's app retries a provider sooner than
      // that provider told it to.
      consentSuppressedUntil = Date.now() + waitMs;
      if (!callOpts?.withoutHeldCredential) scheduleConsentRetry(waitMs);
    } else {
      // Any other non-OK status the server returned (e.g. a 5xx). A broken
      // install must never look identical to a healthy one, so name the coarse
      // reason and the next move ONCE — no server text, only the numeric code.
      warnStayedInactiveOnce("refused", { status: res.status });
      // A 5xx (or anything else unexplained) is not an answer about our
      // records — it settles by itself, so the verdict stays "cannot tell".
      markRegistrationUnreachable();
      // The outer consent episode schedules temporary statuses and suppresses
      // on-demand knocks until that same due time.
    }
    return res.status;
  }

  /** Whether the PII-filtered snapshot mirror may upload right now. True in full
   *  mode; in issues-only mode only with the explicit `shareMeterWithAI` opt-in
   *  OR the server directive. Always gated off when disabled or the kill-switch
   *  is set — those win over the directive. */
  function effectiveSnapshotUploadAllowed(): boolean {
    // A lock outranks every share setting (docs/kit-lock-rule.md).
    if (!enabled || isBoosthisDisabled() || isKitLocked()) return false;
    return (
      !effectiveIssuesOnly() ||
      explicitShareMeterWithAI ||
      serverShareMeterWithAI
    );
  }

  /** Single source of truth for wiring the snapshot submitter + auto-upload
   *  timer. Clearing the submitter (not just stopping the timer) matters because
   *  a manual flush calls the submitter directly. Used at init, enable(),
   *  disable(), and when a consent response flips the server directive on. */
  function syncSnapshotUpload(): void {
    if (effectiveSnapshotUploadAllowed()) {
      setSnapshotSubmitter((snap) => client.transmitSnapshot(snap));
      // Trace spans carry code-defined route labels too, so they share the
      // exact same allow-gate as the snapshot mirror: nothing span-shaped is
      // retained or shipped on a private app until sharing is authorized.
      setSpanSubmitter((spans) => client.transmitSpans(spans));
      // BILLED BY THE RUN: submitters yes, TIMERS no. The snapshot cadence (10s
      // ramping to 60s) and the 15s span flush cannot fire in a process that is
      // frozen the moment it answers, and a timer that fires mid-invocation
      // starts an upload that freezes half-sent. The per-invocation flush drives
      // both instead — same submitters, called at a moment we control.
      //
      // isPerRunBilled(), not isServerlessMode(): a container whose processor
      // stops between requests loses a clock-scheduled upload exactly the way a
      // function does. Its timers do not fire while it is frozen, and the one
      // that finally fires when the next request wakes the CPU is as likely as
      // not to be cut off mid-send.
      if (!isPerRunBilled()) {
        startSnapshotAutoUpload();
        startSpanAutoFlush();
      }
    } else {
      setSnapshotSubmitter(null);
      stopSnapshotAutoUpload();
      setSpanSubmitter(null);
      stopSpanAutoFlush();
    }
  }

  // Each queue attempt carries its own verdict callback. Concurrent public
  // sends cannot attach their refusal to another attempt's rows.
  function refuseQueue(onRefused?: () => void): number {
    try { onRefused?.(); } catch { /* the queue's bookkeeping is best-effort */ }
    return 0;
  }
  function failedQueue(error: unknown, onRefused?: () => void): number {
    if (error instanceof PIIDetectedError) {
      _noteUploadRejected("rejected");
      return refuseQueue(onRefused);
    }
    noteUploadUnreachable();
    return 0;
  }
  async function queueSubmit(send: (onRefused: () => void) => Promise<number>): Promise<QueueAnswer> {
    let refused = false;
    const accepted = await send(() => { refused = true; });
    return refused ? { accepted, undelivered: "refused" } : accepted;
  }

  const client: TelemetryClient = {
    get installId() {
      // Post-rotation this is the ACTIVE identity (the one that owns the
      // server-side data), not the host-baked constructor value.
      return activeInstallId;
    },
    get endpoint() {
      return endpoint;
    },
    get enabled() {
      return enabled && !isBoosthisDisabled();
    },
    get deleteToken() {
      return deleteToken;
    },
    get readToken() {
      return readToken;
    },
    get projectKey() {
      return projectKey;
    },
    get fullTelemetryEffective() {
      // The mode uploads actually run under right now: !effectiveIssuesOnly()
      // is full mode (code config OR the server "Full telemetry" grant).
      return !effectiveIssuesOnly();
    },

    async consent() {
      if (!enabled || isBoosthisDisabled()) return 0;
      // A bare "register me" with no payload behind it — same withholding rule
      // as boot and the exit settle. A worker (the one caller in this kit)
      // never attaches, so this only ever bites a process that asked to watch
      // its server and was told no.
      return postConsent({ registrationOnly: true });
    },

    async transmit(samples, onRefused) {
      // Issues-only mode never ships per-route samples — unless the server's
      // dashboard "Full telemetry" grant is on (effectiveIssuesOnly()).
      if (effectiveIssuesOnly()) return 0;
      if (!enabled || isBoosthisDisabled() || samples.length === 0) return 0;
      // Uploads must ride the ACTIVE identity — a host-seeded delete token can
      // skip the lazy consent below, so adopt any persisted rotation first.
      await rotationReady;
      // Lazy consent — retry if the host never captured a delete token.
      if (!deleteToken) {
        await postConsent({ onDemand: true });
      }
      // By now this app has served real traffic, so the surfaces armed at the
      // request boundary (database clients, AI clients, lazily-required job
      // libraries) finally have an honest answer. Re-register if — and only
      // if — that answer differs from the one sent at boot.
      maybeRefreshCoverage();
      // Race re-check: disable() may have flipped while awaiting consent.
      if (!enabled || isBoosthisDisabled()) return 0;
      if (!deleteToken) return 0;
      // Apply route-label hardening + closed metadata schema before assertNoPII,
      // mirroring the RN transmit path:
      //
      // 1. routeLabel is truncated to 100 chars and filtered through
      //    transmitLabelHasPII() — samples with UUID, long numeric ID, email,
      //    JWT, or phone labels are silently dropped.
      //
      // 2. metadata is normalised to ONLY the two privacy-safe enum buckets
      //    (startType + deviceTier). Any host-provided key outside those two
      //    is omitted; values outside the allowed enum sets are coerced to
      //    "unknown" so arbitrary host strings (which may be PII) never leave
      //    the process. This is the Node equivalent of RN's closed-bucket policy.
      //    The one addition is the middleware's door word (routeDoor.ts),
      //    passed only when it is one of the three closed words and otherwise
      //    left out — never coerced, because a guessed word would be counted.
      //
      // The primary label filter lives in onSample() (reporting.ts); this is
      // defence-in-depth for any caller that invokes transmit() directly.
      const ALLOWED_START_TYPES = new Set(["cold", "warm", "hot", "unknown"]);
      const ALLOWED_DEVICE_TIERS = new Set(["low", "mid", "high", "unknown"]);
      const normMeta = (
        meta: Record<string, unknown> | null | undefined,
      ): { startType: string; deviceTier: string; door?: DoorWord } => {
        const raw = meta ?? {};
        return {
          startType:
            typeof raw.startType === "string" && ALLOWED_START_TYPES.has(raw.startType)
              ? raw.startType
              : "unknown",
          deviceTier:
            typeof raw.deviceTier === "string" && ALLOWED_DEVICE_TIERS.has(raw.deviceTier)
              ? raw.deviceTier
              : "unknown",
          ...(isDoorWord(raw.door) ? { door: raw.door } : {}),
        };
      };
      const raw = samples.length > 100 ? samples.slice(0, 100) : samples;
      const batch = raw
        .filter((s) => {
          if (s.routeLabel.length > MAX_PART_NAME) {
            warnPartNameRefusal("too-long");
            return false;
          }
          if (transmitLabelHasPII(s.routeLabel) !== null) {
            warnPartNameRefusal("invalid");
            return false;
          }
          return true;
        })
        .map((s) => ({
          routeLabel: s.routeLabel,
          durationMs: s.durationMs,
          rating: s.rating,
          ...(s.ruleId !== undefined ? { ruleId: s.ruleId } : {}),
          metadata: normMeta(s.metadata),
        }))
        ;
      if (batch.length === 0) {
        _noteUploadRejected("rejected");
        return refuseQueue(onRefused);
      }
      const payload = {
        installId: activeInstallId,
        packageVersion,
        samples: batch,
      };
      try {
        assertNoPII(payload);
      } catch {
        _noteUploadRejected("rejected");
        return refuseQueue(onRefused);
      }
      try {
        const { res, refusal } = await sendUpload("samples", deleteToken, (credential) =>
          _safeTransmitInternal(
            `${endpoint}/samples`,
            payload,
            fetchOptions,
            `Bearer ${credential}`,
          ),
        );
        if (judgeUpload(res, refusal)) {
          if (batch.length < raw.length) refuseQueue(onRefused);
          return batch.length;
        }
        return res.status === 400 || res.status === 413 || res.status === 422
          ? refuseQueue(onRefused) : 0;
      } catch (error) {
        return failedQueue(error, onRefused);
      }
    },

    async transmitCandidates(signatures, onRefused) {
      // Always-on for registered apps: NOT gated by the enable/disable toggle.
      // Only the kill-switch (BOOSTHIS_DISABLED) or forget() can stop it.
      if (isBoosthisDisabled() || signatures.length === 0) return 0;
      await rotationReady;
      if (!deleteToken) {
        await postConsent({ onDemand: true });
      }
      if (isBoosthisDisabled()) return 0;
      if (!deleteToken) return 0;
      const batch =
        signatures.length > 50 ? signatures.slice(0, 50) : signatures;
      const payload = {
        installId: activeInstallId,
        packageVersion,
        signatures: batch,
      };
      // Defense in depth — signatures are built by Boosthis from
      // kind+bucket+count, but the PII guard still runs.
      try {
        assertNoPII(payload);
      } catch {
        _noteUploadRejected("rejected");
        return refuseQueue(onRefused);
      }
      try {
        const { res, refusal } = await sendUpload("candidates", deleteToken, (credential) =>
          _safeTransmitInternal(
            `${endpoint}/candidates`,
            payload,
            fetchOptions,
            `Bearer ${credential}`,
          ),
        );
        if (judgeUpload(res, refusal)) return batch.length;
        return res.status === 400 || res.status === 413 || res.status === 422
          ? refuseQueue(onRefused) : 0;
      } catch (error) {
        return failedQueue(error, onRefused);
      }
    },

    async transmitResolutions(resolutions, onRefused) {
      // Always-on for registered apps, exactly like transmitCandidates.
      if (isBoosthisDisabled() || resolutions.length === 0) return 0;
      await rotationReady;
      if (!deleteToken) {
        await postConsent({ onDemand: true });
      }
      if (isBoosthisDisabled()) return 0;
      if (!deleteToken) return 0;
      const batch =
        resolutions.length > 50 ? resolutions.slice(0, 50) : resolutions;
      const payload = {
        installId: activeInstallId,
        packageVersion,
        resolutions: batch,
      };
      try {
        assertNoPII(payload);
      } catch {
        _noteUploadRejected("rejected");
        return refuseQueue(onRefused);
      }
      try {
        const { res, refusal } = await sendUpload("resolutions", deleteToken, (credential) =>
          _safeTransmitInternal(
            `${endpoint}/resolutions`,
            payload,
            fetchOptions,
            `Bearer ${credential}`,
          ),
        );
        if (judgeUpload(res, refusal)) return batch.length;
        return res.status === 400 || res.status === 413 || res.status === 422
          ? refuseQueue(onRefused) : 0;
      } catch (error) {
        return failedQueue(error, onRefused);
      }
    },

    async transmitSnapshot(snapshot) {
      // The snapshot carries screen labels, so it rides the optional full-detail
      // channel: off in issues-only mode unless the developer opted in via
      // `shareMeterWithAI` OR the server directive fired. Always gated off when
      // disabled or killed. Mirrors RN's transmitSnapshot.
      if (!effectiveSnapshotUploadAllowed()) return 0;
      if (!enabled || isBoosthisDisabled()) return 0;
      await rotationReady;
      // Lazy consent — retry if the host never captured a delete token.
      if (!deleteToken) {
        await postConsent({ onDemand: true });
      }
      // Same reasoning as the sample path: by snapshot time this app has run,
      // so re-register if the coverage answer has actually moved.
      maybeRefreshCoverage();
      // Race re-check: disable()/forget() may have flipped while awaiting.
      if (!effectiveSnapshotUploadAllowed()) return 0;
      if (!deleteToken) return 0;
      // Filter every label field before the PII guard. Route-row keys and
      // cross-cutting finding names are code-defined identifiers, but a caller
      // could accidentally pass a user-derived string — drop any entry whose
      // label carries a PII pattern (UUID, long numeric id, email, JWT, phone).
      const safeRows = snapshot.rows.filter(
        (r) => transmitLabelHasPII(r.key) === null,
      );
      // …and one label the PII guard cannot judge: the retry-storm finding
      // names the outbound HOST it saw hammered. That is the right word on the
      // developer's own screen, inside their own process, and the wrong one on
      // the wire — "hostnames" sit in our published list of what never reaches
      // us. So the address is replaced here by the closed dependency-kind
      // vocabulary the backend-calls reading already ships ("outbound:payments"),
      // which keeps the finding useful without the address leaving the app.
      const safeCrossCutting = snapshot.crossCutting
        .filter((f) => transmitLabelHasPII(f.name) === null)
        .map((f) =>
          looksLikeAddress(f.name)
            ? { ...f, name: `outbound:${dependencyKindFor(f.name)}` }
            : f,
        );
      // The route list is a NEW way for labels to reach the wire, so it is
      // re-audited here rather than trusted from where it was built. Every
      // entry is screened by the same guard the rows go through; an entry that
      // fails is DROPPED, never redacted into something that looks like a
      // route. `total` is left alone deliberately — it states how many the
      // merge held, so a shortened list still reads as "at least".
      const safeRouteList = snapshot.routeList
        ? {
            ...snapshot.routeList,
            entries: snapshot.routeList.entries.filter(
              (e) => transmitLabelHasPII(e.label) === null,
            ),
          }
        : undefined;
      // Routes declared as waiting on purpose are route labels the developer
      // typed, so they pass the same screen at the door, though each was
      // already refused at declaration if it failed it. An entry that fails is
      // dropped, never redacted. The calls direction sends counts only.
      const safeDeclaredWaits = snapshot.declaredWaits
        ? {
            routes: snapshot.declaredWaits.routes.filter(
              (r) => transmitLabelHasPII(r.name) === null,
            ),
          }
        : undefined;
      const sanitizedSnapshot = {
        ...snapshot,
        rows: safeRows,
        crossCutting: safeCrossCutting,
        ...(safeRouteList ? { routeList: safeRouteList } : {}),
        ...(safeDeclaredWaits ? { declaredWaits: safeDeclaredWaits } : {}),
      };
      const payload = {
        installId: activeInstallId,
        packageVersion,
        capturedAt: sanitizedSnapshot.capturedAt,
        snapshot: sanitizedSnapshot,
      };
      try {
        assertNoPII(payload);
      } catch {
        _noteUploadRejected("rejected");
        return 0;
      }
      try {
        const { res, refusal } = await sendUpload("snapshots", deleteToken, (credential) =>
          _safeTransmitInternal(
            `${endpoint}/snapshots`,
            payload,
            fetchOptions,
            `Bearer ${credential}`,
          ),
        );
        return judgeUpload(res, refusal) ? 1 : 0;
      } catch (error) {
        return failedQueue(error);
      }
    },

    async transmitCrashes(crashes, as) {
      // Always-on for registered apps: NOT gated by the enable/disable toggle.
      // Only the kill-switch (BOOSTHIS_DISABLED) or forget() can stop it —
      // mirrors transmitCandidates/transmitResolutions, NOT transmitSnapshot.
      if (isBoosthisDisabled() || crashes.length === 0) return 0;
      await rotationReady;
      // A REPLAY carries its own identity: the install that crashed, and the
      // credential that install authenticates with. This process's own consent
      // is irrelevant to it — asking for one would only mint a credential for
      // the wrong install.
      if (!as) {
        // Lazy consent — retry if the host never captured a delete token.
        if (!deleteToken) {
          await postConsent({ onDemand: true });
        }
      }
      if (isBoosthisDisabled()) return 0;
      const sendAsInstallId = as?.installId ?? activeInstallId;
      const sendCredential = as?.credential ?? deleteToken;
      if (!sendCredential) return 0;
      // Server caps a batch at 50 reports (CrashBatch.maxItems).
      const batch = crashes.length > 50 ? crashes.slice(0, 50) : crashes;
      // A replay must carry the same identity as the original offer. Derive it
      // from the sanitized batch rather than minting per HTTP attempt, so a
      // lost 202 response cannot add the same delta twice. This is a
      // correlation/idempotency key only: it is not an authenticator and never
      // contains raw crash data on the wire.
      const deliveryId = crashDeliveryId(sendAsInstallId, batch);
      const payload = {
        installId: sendAsInstallId,
        packageVersion,
        deliveryId,
        crashes: batch,
      };
      // Defense in depth — every crash fingerprint is code-derived on-device
      // (error name + redacted frame + bucketed count, never the raw message),
      // but the shared PII guard still runs before upload.
      try {
        assertNoPII(payload);
      } catch {
        _noteUploadRejected("rejected");
        noteCrashSendRefused("rejected");
        return 0;
      }
      try {
        const send = (credential: string) =>
          _safeTransmitInternal(
            `${endpoint}/crashes`,
            payload,
            fetchOptions,
            `Bearer ${credential}`,
          );
        // A REPLAY authenticates as the install that crashed, so a refusal of
        // its credential is that install's and nothing this process holds is
        // renewed over it — nor is it worded as this process's refusal.
        let res: Response;
        let ok: boolean;
        if (as) {
          // Held by the same pause: the allowance it would spend is this
          // install's, whichever install crashed.
          res = await pacedUpload("crashes", () => send(sendCredential));
          ok = noteUpload(res);
        } else {
          const sent = await sendUpload("crashes", sendCredential, send);
          res = sent.res;
          // /crashes returns 202 Accepted; res.ok covers 2xx.
          ok = judgeUpload(res, sent.refusal);
        }
        // A crash batch the server DECLINES must not read as "nothing to
        // send": the count that comes back is the same 0 either way, so the
        // reason is left where the crash buffer can pick it up and say so.
        if (!ok) noteCrashSendRefused(crashRefusalFor(res?.status ?? 0));
        return ok ? batch.length : 0;
      } catch (error) {
        if (error instanceof PIIDetectedError) {
          _noteUploadRejected("rejected");
          noteCrashSendRefused("rejected");
          return 0;
        }
        noteUploadUnreachable();
        noteCrashSendRefused("unreachable");
        return 0;
      }
    },

    async transmitSpans(spans) {
      // Trace spans carry code-defined route labels, so they ride the SAME
      // gate as the snapshot mirror: off in issues-only mode unless the
      // developer opted in via `shareMeterWithAI` OR the server directive
      // fired. Always gated off when disabled or killed. Mirrors RN.
      if (!effectiveSnapshotUploadAllowed()) return 0;
      if (!enabled || isBoosthisDisabled() || spans.length === 0) return 0;
      await rotationReady;
      // Lazy consent — retry if the host never captured a delete token.
      if (!deleteToken) {
        await postConsent({ onDemand: true });
      }
      // Race re-check: disable()/forget() may have flipped while awaiting.
      if (!effectiveSnapshotUploadAllowed()) return 0;
      if (!deleteToken) return 0;
      // Drop any span whose label carries a PII pattern. The middleware labels
      // are code-defined ("GET /users/:id", ids redacted by normalizePath), but
      // a caller could pass a user-derived string. Use transmitLabelHasPII —
      // the same guard as sample uploads — which enforces UUID, long numeric
      // id, and whitespace checks while still allowing the structural
      // "HTTP_METHOD /path" space that span labels legitimately carry.
      const safe = spans.filter((s) => transmitLabelHasPII(s.routeLabel) === null);
      const batch =
        safe.length > MAX_SPAN_BATCH ? safe.slice(0, MAX_SPAN_BATCH) : safe;
      if (batch.length === 0) return 0;
      const payload = {
        installId: activeInstallId,
        packageVersion,
        spans: batch,
      };
      // Defense in depth — the per-label filter already dropped any PII-bearing
      // span, but run the whole-payload guard before it leaves.
      try {
        assertNoPII(payload);
      } catch {
        _noteUploadRejected("rejected");
        return 0;
      }
      try {
        const { res, refusal } = await sendUpload("spans", deleteToken, (credential) =>
          _safeTransmitInternal(
            `${endpoint}/spans`,
            payload,
            fetchOptions,
            `Bearer ${credential}`,
          ),
        );
        return judgeUpload(res, refusal) ? batch.length : 0;
      } catch (error) {
        return failedQueue(error);
      }
    },

    async transmitJobRuns(runs, expectations = [], promises = [], tallies = []) {
      // NOT behind the snapshot/AI gate, on purpose. A run carries a
      // code-defined job name and three numbers — the same class of label a
      // route sample already sends in every mode. The whole point of the
      // feature is to tell a developer that a nightly job stopped, and that
      // warning cannot be contingent on them having connected an AI.
      //
      // A DECLARED RHYTHM rides here too, and a batch carrying only
      // declarations is a real upload: the job most worth watching is the one
      // that has been declared and has not run. So does a PROMISE the app's
      // own code declares — an app may hold promises and run no jobs at all,
      // and this upload is the only door that statement has.
      const nothingToSend =
        runs.length === 0 &&
        tallies.length === 0 &&
        expectations.length === 0 &&
        promises.length === 0;
      if (!enabled || isBoosthisDisabled() || nothingToSend) return 0;
      await rotationReady;
      // Lazy consent — retry if the host never captured a delete token.
      if (!deleteToken) {
        await postConsent({ onDemand: true });
      }
      // Race re-check: disable()/forget() may have flipped while awaiting.
      if (!enabled || isBoosthisDisabled()) return 0;
      // Not registered YET — the runs are kept for the next upload rather than
      // spent on a send that never left this machine.
      if (!deleteToken) return { accepted: 0, undelivered: "retry" };
      // Same label guard as every other upload. The emitter already screened
      // each name; this is the second pass, at the edge.
      const safe = runs.filter((r) => transmitLabelHasPII(r.job) === null);
      const safeTallies = tallies
        .filter((t) => transmitLabelHasPII(t.job) === null)
        .slice(0, MAX_JOB_RUN_TALLIES);
      const batch =
        safe.length > MAX_JOB_RUN_BATCH
          ? safe.slice(0, MAX_JOB_RUN_BATCH)
          : safe;
      const declared = expectations
        .filter((e) => transmitLabelHasPII(e.job) === null)
        .slice(0, MAX_JOB_EXPECTATIONS);
      // A promise's SUBJECT LABEL rides the same guard for the same reason —
      // it is a reporting label. Its WORDING deliberately does not: that is a
      // sentence a human wrote, and the transmit guard would refuse the whole
      // upload over a developer's own email address in it, losing the job runs
      // travelling in the same body. The server screens the wording by itself,
      // refuses that one declaration by name, and says why.
      const declaredPromises = promises
        .filter(
          (p) =>
            p.subjectLabel === undefined ||
            transmitLabelHasPII(p.subjectLabel) === null,
        )
        .slice(0, MAX_PROMISE_DECLARATIONS);
      if (
        batch.length === 0 &&
        safeTallies.length === 0 &&
        declared.length === 0 &&
        declaredPromises.length === 0
      )
        return 0;
      const payload: {
        installId: string;
        packageVersion: string;
        runs: JobRunReport[];
        runTallies?: JobRunTallyReport[];
        expectations?: JobExpectationReport[];
        promises?: PromiseDeclarationReport[];
      } = {
        installId: activeInstallId,
        packageVersion,
        runs: batch,
      };
      if (safeTallies.length > 0) payload.runTallies = safeTallies;
      if (declared.length > 0) payload.expectations = declared;
      // Screened WITHOUT the wordings, exactly as the server screens the same
      // body: the guard is for machine-shaped fields, and a sentence a human
      // wrote is the server's job to screen. A body it stops would be stopped
      // the same way every time, so its runs go rather than being kept to
      // block every later upload.
      try {
        assertNoPII({
          ...payload,
          ...(declaredPromises.length > 0
            ? {
                promises: declaredPromises.map(
                  ({ wording: _wording, ...rest }) => rest,
                ),
              }
            : {}),
        });
      } catch {
        _noteUploadRejected("rejected");
        return { accepted: 0, undelivered: "refused" };
      }
      if (declaredPromises.length > 0) payload.promises = declaredPromises;
      try {
        const { res, refusal } = await sendUpload("job-runs", deleteToken, (credential) =>
          _safeTransmitInternal(
            `${endpoint}/job-runs`,
            payload,
            fetchOptions,
            `Bearer ${credential}`,
          ),
        );
        // The reply names what became of each declaration. It is read out of
        // the ONE body read (see noteUpload), and it decides whether the kit
        // may judge this job against the declared rhythm at all — so unlike
        // the drop counts it is awaited before the answer is returned.
        let outcomes: JobExpectationOutcome[] | undefined;
        let promiseOutcomes: PromiseDeclarationOutcome[] | undefined;
        const ok = judgeUpload(res, refusal, (body) => {
          outcomes = readExpectationOutcomes(body);
          promiseOutcomes = readPromiseOutcomes(body);
        });
        const bodyRead = lastReplyBodyRead;
        // Nothing left this machine: the kit is inert or switched off, and a
        // switched-off kit keeps nothing for later.
        if (isNoSendResponse(res)) return 0;
        // Not delivered. A body the server turned away for its SHAPE would be
        // turned away again, so those runs go; anything else — a pause, a
        // server error, a credential being renewed — keeps them for the next
        // upload, as counts.
        if (!ok)
          return {
            accepted: 0,
            undelivered:
              res.status === 400 || res.status === 413 || res.status === 422
                ? "refused"
                : "retry",
          };
        // The reply-body read is fire-and-forget for every other upload. Here
        // it is not optional, so wait for it — after the upload itself has
        // already answered, on the flush's own time, never the host's.
        if ((declared.length > 0 || declaredPromises.length > 0) && bodyRead)
          await bodyRead;
        // ALWAYS the object form once the upload itself succeeded, even when
        // the reply said nothing about the declarations (`expectations`
        // undefined). The object is how the reporter knows the batch REACHED
        // Boosthis: a bare number cannot separate "delivered, and the server
        // never mentioned the rhythm" from "refused, nothing arrived at all",
        // and telling a developer their server is out of date when their
        // upload was actually turned away sends them to fix the wrong thing.
        return {
          accepted:
            batch.length + safeTallies.reduce((n, t) => n + t.runs, 0),
          expectations: outcomes,
          promises: promiseOutcomes,
        };
      } catch (error) {
        if (error instanceof PIIDetectedError) {
          _noteUploadRejected("rejected");
          return { accepted: 0, undelivered: "refused" };
        }
        noteUploadUnreachable();
        return { accepted: 0, undelivered: "retry" };
      }
    },

    disable() {
      // disable() ONLY stops the optional full-detail samples. Issue + fix
      // reporting is always-on for registered apps and is intentionally NOT
      // turned off here — only the kill-switch or forget() can stop it. The
      // candidate + resolution submitters therefore stay registered.
      enabled = false;
      consentGeneration++;
      stopEntitlementCheckin();
      pauseSampleQueue();
      // Cancel any pending rejected-registration retry — the fire-time guard
      // would no-op it anyway, but don't leave a dead timer pending.
      stopConsentRetry();
      // The snapshot mirror is screen-bearing optional data, so stop it too.
      // syncSnapshotUpload() clears the submitter (not just the timer) so a
      // manual flush cannot leak a snapshot after disable().
      syncSnapshotUpload();
      publishPanelState();
    },
    enable() {
      enabled = true;
      installCheckinConfig();
      // A deliberate restart of the kit: an install erased earlier in this
      // process may register again, and a consent reply may be applied again.
      forgottenSinceEnable = false;
      // Re-register submitters (idempotent) and resume the full-sample queue
      // (a no-op in issuesOnly mode).
      setCandidateSubmitter((signatures) =>
        queueSubmit((onRefused) => client.transmitCandidates(signatures, onRefused)),
      );
      setResolutionSubmitter((resolutions) =>
        queueSubmit((onRefused) => client.transmitResolutions(resolutions, onRefused)),
      );
      if (!effectiveIssuesOnly()) resumeSampleQueue();
      // Re-wire the snapshot mirror per the current share policy.
      syncSnapshotUpload();
      publishPanelState();
    },

    async forget() {
      // Say it FIRST, before anything below awaits: a consent already on the
      // wire must not be able to hand its reply — and the live delete token
      // in it — to the state this call is about to wipe, whether it lands
      // during the erasure or after it.
      forgottenSinceEnable = true;
      consentGeneration++;
      // Local state is wiped unconditionally, even without a delete token.
      // Best-effort, with one exception: when another process holds the
      // shared crash state, the crash erase throws and forget() rejects
      // before the server is asked, so the caller retries rather than taking
      // a half-erase for done. What forget() leaves on disk: the project and
      // promise records, the community checks, the feedback log and the
      // crash store's erase counter (a dissolve removes all but the counter).
      setCandidateSubmitter(null);
      setResolutionSubmitter(null);
      setSampleObserver(null);
      clearSampleSink();
      // A wait Boosthis asked for belonged to the install being erased.
      clearUploadPauses();
      // Nothing left to register FOR: an exit flush must not re-consent a
      // forgotten install back into existence on the way out.
      setExitReadyHook(null);
      // Cancel any pending rejected-registration retry — forget() must leave
      // nothing Boosthis-shaped running.
      stopConsentRetry();
      // Stop the server-authority heartbeat and RE-LOCK the kit: erasure must
      // leave no entitlement behind and a copy without a proven
      // handshake must not run (the ACTIVATION LOCK re-engages exactly as on a
      // never-connected install). Best-effort, never throws.
      stopEntitlementCheckin();
      void clearEntitlementCache().catch(() => {
        /* best-effort — the in-memory lock is already engaged */
      });
      // Tear down the snapshot mirror unconditionally — forget() must leave
      // nothing Boosthis-shaped running. Clearing the submitter blocks any
      // manual flush too, not just the timer.
      setSnapshotSubmitter(null);
      stopSnapshotAutoUpload();
      // Tear down the span mirror too: stop the flusher, unwire the submitter
      // (making enqueueSpan inert), and drop any buffered spans.
      setSpanSubmitter(null);
      stopSpanAutoFlush();
      clearBufferedSpans();
      // Crash reporting is ALWAYS-ON for a registered app; forget() (and the
      // kill-switch) are the only things that stop it. Clear the submitter and
      // uninstall the uncaughtExceptionMonitor hook, wiping the in-memory buffer
      // AND the persisted crash key, so no crash is left behind.
      setCrashSubmitter(null);
      await uninstallCrashHandlers();
      // Tear down the job-run reporter too: stop the flusher, unwire the
      // submitter (making reportJobRun inert), and drop anything buffered.
      setJobRunSubmitter(null);
      stopJobRunAutoFlush();
      clearBufferedJobRuns();
      // Including the declared rhythms: a queued declaration is something
      // this app asked Boosthis to remember, and `forget()` drops it.
      clearJobRhythmDeclarations();
      // And the promises this app's code declared. Same reason: a statement
      // waiting to be delivered is something Boosthis is still holding.
      clearPromiseDeclarations();
      // Erase the persisted read token too (privacy parity — no credential
      // survives forget). Best-effort; runs on every exit path below since it
      // precedes the delete-token branching.
      readToken = null;
      void storage.remove(readTokenStoreKey).catch(() => {
        // Best-effort erasure — an unwritable store is not fatal to forget().
      });
      // Erase the persisted delete token too (same doctrine). The in-memory
      // copy is still needed below to authorize /installs/forget itself; wait
      // for the restore first so a just-booted forget() uses the disk token.
      await credsReady;
      void storage.remove(deleteTokenStoreKey).catch(() => {
        // Best-effort erasure.
      });
      // Erase the self-healing rotation mapping too — no identity mapping
      // survives forget(). Await the restore first so the forget request
      // below targets the ACTIVE (possibly rotated) identity.
      await rotationReady;
      void storage.remove(rotationStoreKey).catch(() => {
        // Best-effort erasure.
      });
      await clearAllCandidates();
      // Wipe live-detector state + detach the outbound observer.
      clearDetectors();
      // Stop + drop the event-loop-delay histogram (nothing keeps sampling).
      clearEventLoopLag();
      clearCpuSchedulingMeters();
      clearVitals();
      // Drop the per-route observed/failed counts. They hold nothing but two
      // numbers against a route label, but a count that survives erasure is a
      // count the next snapshot would upload about a period this install has
      // been told to forget.
      resetRouteOutcomes();
      // Tear down the 2026-08 extra-meter hooks/listeners + drop their state.
      clearExtraMeters();
      // Drop the frozen build identity + dependency inventory.
      clearBuildIdentity();
      if (!deleteToken) {
        enabled = false;
        publishPanelState();
        return 0;
      }
      // Kill-switch honors silence even on erasure: when BOOSTHIS_DISABLED is
      // set we never touch the network, but still clear local state.
      if (isBoosthisDisabled()) {
        deleteToken = null;
        enabled = false;
        publishPanelState();
        return 204;
      }
      // Right-to-erasure: the fixed payload legitimately contains the
      // server-issued `deleteToken` field (which the PII guard would otherwise
      // reject by field name). `_safeTransmitTrustedPayload` skips ONLY the
      // payload-body check while still scanning caller-supplied headers + URL
      // and honoring the kill-switch — so no caller PII can ride along.
      const token = deleteToken;
      try {
        const res = await _safeTransmitTrustedPayload(
          `${endpoint}/installs/forget`,
          {
            installId: activeInstallId,
            deleteToken: token,
          },
          fetchOptions,
        );
        deleteToken = null;
        enabled = false;
        publishPanelState();
        return res.status;
      } catch {
        return 0;
      }
    },
  };

  let launchConsentPending = true;
  let startingConsent: Promise<unknown> | null = null;
  setUploadReadiness(() => {
    if (launchConsentPending) return false;
    if (hasBeenActiveInThisRun()) return true;
    // A fresh install still registers lazily, but without spending its rows
    // on the locked transport while that first answer is outstanding. An
    // on-demand knock inside the registration retry wait returns at once, so
    // this never sends sooner than that schedule allows.
    if (!deleteToken && consentFlight === null && !startingConsent && enabled && !isBoosthisDisabled()) {
      startingConsent = postConsent({ onDemand: true })
        .catch(() => {}).finally(() => { startingConsent = null; });
    }
    return false;
  });

  // Self-register the auto-submitters + the sample observer the moment
  // telemetry is enabled. Host apps wire nothing: `ingestFindings` fires the
  // submitters for any signature/resolution that crosses the local threshold,
  // and the observer drives the report scheduler from each recorded sample.
  setCandidateSubmitter((signatures) =>
    queueSubmit((onRefused) => client.transmitCandidates(signatures, onRefused)),
  );
  setResolutionSubmitter((resolutions) =>
    queueSubmit((onRefused) => client.transmitResolutions(resolutions, onRefused)),
  );
  setSampleSink({
    submitter: (samples) => queueSubmit((onRefused) => client.transmit(samples, onRefused)),
    issuesOnly,
  });
  setSampleObserver(onSample);
  // Coverage freshness rides the ALWAYS-ON report tick, not an upload: in the
  // default issues-only mode no sample or snapshot ever ships, so a surface
  // discovered after boot (the database client armed at the first request, a
  // lazily required job library, a refused attach) would otherwise never reach
  // the dashboard and the project would read as "not reporting" forever.
  setCoverageRefreshHook(maybeRefreshCoverage);
  // Wire the snapshot mirror per the initial share policy. In full mode it
  // starts immediately; in issues-only mode it stays off until the explicit
  // `shareMeterWithAI` opt-in or the server directive (parsed in postConsent).
  syncSnapshotUpload();

  // ARM THE WAY OUT. There is now a queue that can be LOST: the report tick's
  // timer is `unref`'d (deliberately — a meter may never hold somebody's
  // process open), so when the event loop empties the process leaves and
  // everything it measured leaves with it. A worker, a scheduled script or a
  // container being recycled never reaches the tick at all. Registration, by
  // contrast, goes out immediately, which is how an install ends up on a
  // dashboard reading "never measured" for ever. Idempotent; adds no `ref`'d
  // handle, so a process that would have exited still exits. Not while a stored
  // answer locks the kit: there is nothing to flush and nothing may be sent, so
  // the listener is not added at all (an `active` answer adds it).
  if (!isKitLocked()) installExitFlush();

  // …and give it the one step only this closure can take. An exit hook is not
  // enough on its own: registration is a boot-time round-trip, and a process
  // that measures once and leaves can beat it. With no token there is nothing
  // to check in as, so the activation lock holds, the transport opens no
  // socket, and the flush drains into nothing — the install appears on the
  // dashboard having "never measured", which is the whole fault. Settling
  // registration here is what turns a coin flip into a certainty.
  setExitReadyHook(async () => {
    if (!enabled || isBoosthisDisabled() || isKitLocked()) return;
    // Already registered: nothing to wait for, and never a second consent.
    if (deleteToken || readToken) return;
    // `onDemand` so a key the server has already rejected is not hammered on
    // the way out — the same suppression every other lazy consent obeys.
    //
    // `registrationOnly` because this knock exists purely to settle the
    // registration: it has no readings behind it. In a process whose attach was
    // refused and which watched nothing else, this hook is the exact line that
    // filed the empty Bun install — measuring nothing all the way to exit, then
    // registering on the way out.
    await postConsent({ onDemand: true, registrationOnly: true });
    // Repoint the heartbeat at the identity consent just settled, so the
    // activation knock that follows has a credential to knock with.
    installCheckinConfig();
  });

  // ─── THE PER-INVOCATION LIFECYCLE (anything billed by the run) ──────────
  // Everything above is built for a process that keeps running. On a function
  // it is frozen the moment it answers, so measuring works and sending does
  // not. This is the replacement: one bounded flush, driven by the end of the
  // invocation rather than by a clock, in the shape the PHP kit already proves.
  //
  // It covers the always-on look-alike too — a container billed per
  // request-second whose processor stops when it answers. That host keeps its
  // ordinary identity and registration (it is not a function and nothing about
  // how it registers moves), but its DELIVERY has the same problem and gets the
  // same answer. Without this the request boundary would hold the response open
  // for a flush that was never installed.
  if (isPerRunBilled()) {
    // The 1s report tick would either never fire or fire mid-invocation and
    // freeze half-sent. Off.
    setAutoTickEnabled(false);
    // Everything gathered and not yet out, across all three queues. One
    // definition, read by the flush's own return value, by the independent
    // reading the lifecycle falls back on when the flush never got to answer,
    // and by the bound that decides a backlog is never leaving — three places
    // that must agree about what "still waiting" means.
    const pendingRowsNow = (): number =>
      pendingSampleCount() + _spanInternals.bufferLen() + pendingJobRunCount();
    // Don't upload the whole meter page on every invocation — it is far larger
    // than a batch of samples, and the customer pays for the bandwidth. Once a
    // minute of instance life after that.
    //
    // But the FIRST flush of an instance always carries it. A function
    // instance is frozen the moment it answers and may never be woken again:
    // on a clock-driven schedule the great majority of instances would be
    // discarded before their first minute, and every reading that only exists
    // on the meter page — what the run cost, how close it came to its limits,
    // what starting up cost, what the kit itself cost — would never leave the
    // machine. The readings would then be missing on exactly the hosts they
    // were built for. One page per instance is the whole price of having them
    // at all.
    let snapshotSent = false;
    let lastSnapshotAt = Date.now();
    setInvocationFlush(async (deadline): Promise<number> => {
      if (!enabled || isBoosthisDisabled()) return 0;
      if (functionVerdictDue > 0 && Date.now() >= functionVerdictDue) {
        functionVerdictDue = 0;
        void checkEntitlementNow().catch(() => null).finally(() => {
          if (enabled && !forgottenSinceEnable && !isBoosthisDisabled() && !isActivated()) {
            functionVerdictDue = Date.now() + retryWait([...FIRST_VERDICT_SCHEDULE_MS, ...REGISTRATION_RETRY_SCHEDULE_MS], functionVerdictStep++);
          }
        });
      }
      // LOCKED: nothing is held (the lock threw it away) and nothing is sent.
      if (isKitLocked()) return 0;
      // THE BUDGET STOPS THE WORK, NOT JUST THE WAITING. Every step below is a
      // round trip; without this the caller's `Promise.race` gave up after the
      // budget and all five of them carried on, so the next invocation started
      // five more on top. Checked between steps only — a request already on the
      // wire is never abandoned half-sent, it is simply the last one.
      const spent = (): boolean => deadline?.expired() === true;
      // Register first — nothing can be stored under an id the server has never
      // seen, and on a cold start this is the one round trip that being alive
      // costs (the reply carries the entitlement with it).
      if (!deleteToken || (consentSuppressedUntil > 0 && Date.now() >= consentSuppressedUntil)) {
        try {
          await postConsent({ onDemand: true });
        } catch {
          /* never throw into the host's response path */
        }
      }
      // The registration reply carries the entitlement: a lock it brought has
      // already thrown the queues away, and nothing after this may be sent.
      if (spent() || isKitLocked()) return pendingRowsNow();
      try {
        await reportNow(true);
      } catch {
        /* best-effort */
      }
      if (spent()) return pendingRowsNow();
      try {
        await flushSpansNow(true);
      } catch {
        /* best-effort */
      }
      if (spent()) return pendingRowsNow();
      // Scheduled-job runs. A function host is exactly where cron work lives,
      // and the 30-second auto-flush timer that carries runs off a long-running
      // server is frozen with the instance the moment it answers — so a run
      // reported during this invocation leaves HERE or never. Skipping it would
      // mean a healthy nightly function reads "never reported a run", which is
      // worse than not watching it at all.
      try {
        await flushJobRunsNow(true);
      } catch {
        /* best-effort */
      }
      // SELF-THROTTLE. The whole meter page is by far the most expensive thing
      // the kit sends, and it is the one piece of our own work that is
      // genuinely optional on any single run. So when the kit is already over
      // the footprint it published, this is what it gives up — its own extra
      // work, not the customer's measurements, which keep flowing in the small
      // batches above. Counted, because a ceiling held by quietly doing less is
      // only honest when the doing-less is visible.
      //
      // The one exception is that first page. Cutting back is meant to spare
      // the customer's run OUR extra work; giving up the only copy of the
      // readings this instance will ever be able to send is not doing less, it
      // is doing nothing — and the reduction is recorded either way, so the
      // ceiling stays honest rather than being met by silence.
      if (!snapshotSent) {
        if (kitShouldReduce()) noteKitReduced();
        snapshotSent = true;
        lastSnapshotAt = Date.now();
        try {
          await uploadPerfSnapshotNow();
        } catch {
          /* best-effort */
        }
      } else if (kitShouldReduce()) {
        noteKitReduced();
      } else if (
        !spent() &&
        Date.now() - lastSnapshotAt >= SERVERLESS_SNAPSHOT_MIN_MS
      ) {
        lastSnapshotAt = Date.now();
        try {
          await uploadPerfSnapshotNow();
        } catch {
          /* best-effort */
        }
      }
      // What is STILL waiting. The lifecycle counts it so a gap in the data can
      // be told apart from a quiet period — job runs included, or a run left
      // behind by an exhausted budget would vanish from the accounting as well
      // as from the wire.
      return pendingRowsNow();
    },
    // The same reading, taken independently — used when the flush ran out of
    // budget or threw and so never got to report what it left behind.
    pendingRowsNow,
    // THE BACKLOG'S ENDING. Called only once the lifecycle has decided these
    // rows are never leaving: five minutes held and ten flushes that could not
    // move them. Emptying the queues is the point — rows that cannot be
    // delivered were still occupying the buffer the next measurements need, so
    // "held for ever" was costing the customer the measurements AFTER it too.
    // The caller counts what comes back as lost, with `heldTooLong` as the
    // cause, and says so on the kit's own problem channel.
    (): number => {
      let rows = 0;
      try {
        rows += discardPendingSamples();
      } catch {
        /* best-effort */
      }
      try {
        rows += _spanInternals.bufferLen();
        clearBufferedSpans();
      } catch {
        /* best-effort */
      }
      try {
        rows += pendingJobRunCount();
        clearBufferedJobRuns();
      } catch {
        /* best-effort */
      }
      return rows;
    });
  }

  // Crash reporting: ALWAYS-ON for a registered app (not gated by disable()).
  // Wire the submitter, then install the passive uncaughtExceptionMonitor hook
  // (which never changes the host's crash behavior). installCrashHandlers also
  // RESTORES any crashes persisted from a previous — possibly fatal — session
  // and flushes them now that a submitter is registered.
  setCrashSubmitter((crashes, as) => client.transmitCrashes(crashes, as));
  // Let the crash buffer read the credential this install authenticates with,
  // so a crash it writes to disk can be filed AS THIS INSTALL by whatever
  // process replaces this one. Read, never copied: a rotated token is current
  // the next time a crash is persisted.
  setCrashCredentialReader(() => deleteToken);
  // Not while a stored answer locks the kit: the listener is not added, and the
  // crashes kept on disk from an earlier run stay there unread and unsent until
  // an `active` answer installs the handler (which restores and sends them).
  const installCrashHandler = (): void =>
    installCrashHandlers({
      detailed: opts.crashDetails ?? false,
      // Stamped on every crash this process buffers to disk. Workers of one app
      // share one state file, so an entry without an owner can be uploaded — or
      // cleared — by a process that did not crash.
      installId: activeInstallId,
    });
  if (!isKitLocked()) installCrashHandler();
  // Background-job runs ride the same always-on doctrine as crash reporting:
  // wired for a registered app, stopped only by forget() or the kill-switch.
  setJobRunSubmitter((runs, expectations, promises, tallies) =>
    client.transmitJobRuns(runs, expectations, promises, tallies),
  );
  // ...but the clock that carries them off a long-running server is no use on a
  // function host: the instance is frozen the moment it answers, so a 30-second
  // timer either never fires or fires half-sent. There, the bounded invocation
  // flush above is the only sender, and starting the loop as well would be a
  // promise the runtime cannot keep.
  if (!isServerlessMode() && !isKitLocked()) startJobRunAutoFlush();

  // ─── WHAT A LOCK TAKES OFF, AND WHAT AN ACTIVE ANSWER PUTS BACK ──────────
  // docs/kit-lock-rule.md. The answer module flips its state before anything
  // awaits, and every collector, hook, page and upload reads `isKitLocked()` at
  // its own door; these are the steps only this closure can take. An answer
  // that repeats the lock runs them again, so every step is idempotent.
  setKitLockHandlers({
    unhook: () => {
      // Every timer the kit added…
      stopConsentRetry();
      setAutoTickEnabled(false);
      setSnapshotSubmitter(null);
      stopSnapshotAutoUpload();
      setSpanSubmitter(null);
      stopSpanAutoFlush();
      stopJobRunAutoFlush();
      // …every listener…
      uninstallExitFlush();
      detachCrashHandlers();
      // …and every patch and sampler. A wrapper on a host object that cannot be
      // taken off reads the lock at its door and goes straight through.
      clearDetectors();
      // The observation on the app's own `fetch` comes off too (it is put back
      // on the next request after an active answer).
      clearAiCalls();
      clearEventLoopLag();
      clearCpuSchedulingMeters();
      clearVitals();
      clearExtraMeters();
      disarmReadyWatch();
    },
    clearSamples: () => {
      clearSampleRing();
      discardPendingSamples();
      clearBufferedSpans();
      // The runs go. The rhythms and promises the app's code DECLARED stay:
      // they are configuration, and an `active` answer delivers them.
      clearBufferedJobRuns();
      resetRouteOutcomes();
      void clearAllCandidates().catch(() => {
        /* best-effort — an unwritable store keeps nothing new either */
      });
    },
    clearChecks: () => {
      clearCommunityCache("js");
    },
    removeLocal: async () => {
      // The dissolve's erase on this machine (the steps before it dropped the
      // meters and held readings): the credentials, kept crashes and run
      // records, kept findings, the project and promise records and the
      // feedback log. Unlike forget(), a crash state another process holds
      // does not stop the rest of it. The server's forget call is never made
      // from here, so the project's history on Boosthis stays. The install id
      // stays as well: it is what the one ask after the restart registers with.
      setCandidateSubmitter(null);
      setResolutionSubmitter(null);
      setCrashSubmitter(null);
      setJobRunSubmitter(null);
      clearUploadPauses();
      try {
        // The crashes kept on disk and this machine's run records.
        await uninstallCrashHandlers();
      } catch {
        /* the shared crash state was busy; everything else still goes */
      }
      clearBufferedJobRuns();
      clearJobRhythmDeclarations();
      clearPromiseDeclarations();
      readToken = null;
      await credsReady;
      deleteToken = null;
      await rotationReady;
      await Promise.all(
        [
          readTokenStoreKey,
          deleteTokenStoreKey,
          rotationStoreKey,
          projectStoreKey,
          promisesStoreKey,
        ].map((key) =>
          storage.remove(key).catch(() => {
            /* best-effort — an unwritable store cannot be emptied either */
          }),
        ),
      );
      clearKitProject();
      await clearAllCandidates();
      clearBuildIdentity();
      clearFeedbackLog();
      publishPanelState();
    },
    rearm: () => {
      // Not after `forget()`: an erased install stays erased until the
      // developer turns the kit back on.
      if (forgottenSinceEnable || isBoosthisDisabled() || isKitLocked()) return;
      armCollectors(false);
      syncSnapshotUpload();
      setAutoTickEnabled(!isPerRunBilled());
      installExitFlush();
      installCrashHandler();
      if (!isServerlessMode()) startJobRunAutoFlush();
      publishPanelState();
    },
  });

  // ─── ONCE-PER-LAUNCH CONSENT REFRESH (server = source of truth) ──────────
  // A long-running server process that already holds credentials (restored
  // from disk, or seeded via opts) used to knock the consent endpoint ONLY
  // lazily — every upload path guards on `if (!deleteToken) postConsent()`, so
  // an install that already had a token NEVER re-consented and could never
  // learn that the owner flipped the dashboard "Full telemetry" switch. Do the
  // one refresh Go/Java/Flutter/Swift already do: on launch, knock consent
  // exactly ONCE so the returned `fullTelemetry` directive is applied this
  // session (in BOTH directions — see the three-state `serverFullTelemetry`).
  //
  // Once ANSWERED per launch: a temporary failure uses the bounded retry
  // schedule independently of traffic. The credential-safe overwrite lives in
  // postConsent (it only replaces a token when the response carries a
  // NON-EMPTY value), so an idempotent tokenless re-consent can never wipe the
  // stored delete/read token and strand the install in a 401 dead end.
  // Kill-switch-guarded; a disabled runtime never touches the network.
  void Promise.all([rotationReady, credsReady])
    .then(() => {
      if (!enabled || isBoosthisDisabled()) return;
      // ONLY for an install that ALREADY holds credentials — that is the whole
      // gap this closes. A tokenless install still consents lazily on its first
      // upload (and a fresh one registers there), so firing here as well would
      // double-consent every new process, race its own token mint, and disturb
      // the rejection-backoff state machine. `credsReady` has resolved above,
      // so the restored-from-disk token is visible by now.
      if (!deleteToken) return;
      return postConsent();
    })
    .catch(() => {
      // postConsent only throws on PII-guard bugs; never crash the host.
    })
    .finally(() => {
      launchConsentPending = false;
    });

  // Persist the install id so a SEPARATE process (the stdio MCP server) can
  // fall back to it — together with the self-scoped read token already persisted
  // under `readToken:<installId>` — to configure the live-read tools without the
  // host having to plumb env vars. Best-effort; never blocks enable. Waits for
  // the rotation restore so a rotated install advertises its ACTIVE identity
  // (the one that owns the server-side data), not the baked constructor value.
  void rotationReady
    .then(() => storage.set("installId", activeInstallId))
    .catch(() => {
      // Best-effort — an unwritable store just means the stdio MCP server needs
      // BOOSTHIS_INSTALL_ID set explicitly.
    });

  activeClient = client;
  return client;
}

/** The live client, or null before `enableTelemetry` has been called.
 *
 * The framework-free attach needs it: an app with no Express router never
 * calls `mount(app, { telemetry })`, so the two credential reads (`/connect`,
 * `/account`) would otherwise answer "not connected" forever on exactly the
 * frameworks this attach exists to support. Reading the live client here keeps
 * those two reads honest without asking the developer for a second wiring
 * step, and it holds no state of its own — it IS the client the uploads use.
 */
export function getActiveTelemetryClient(): TelemetryClient | null {
  return activeClient;
}

/** The ACTIVE install id, or null when no client has been created. Read by the
 *  standalone status page. Never throws. */
export function getPanelInstallId(): string | null {
  return panelInstallId;
}

/** Stamp "an upload was just accepted". Called ONLY where the server answered
 *  2xx to a measurement upload. Never throws. */
export function _noteUploadAccepted(): void {
  try {
    lastUploadAtMs = Date.now();
    lastAttemptFailed = false;
  } catch {
    /* a clock read must never destabilize an upload path */
  }
}

/**
 * Why an upload did not land. A CLOSED, code-defined set — never the server's
 * own words, so nothing the kit shows can be steered by a response body.
 *
 *   unauthorized  the server refused the credentials (401/403)
 *   rejected      the server refused the batch itself (any other 4xx)
 *   server-error  the server failed while handling it (5xx)
 *   unreachable   no answer at all — timed out, aborted, or no network
 */
export type UploadFailReason =
  | "unauthorized"
  | "rejected"
  | "server-error"
  | "unreachable";

let lastUploadFailAtMs: number | null = null;
let lastUploadFailReason: UploadFailReason | null = null;
let droppedUploads = 0;
/**
 * Did the MOST RECENT attempt fail? An explicit flag rather than a comparison
 * of the two timestamps: uploads flush in bursts, so a success and a failure
 * routinely land in the same millisecond and the clock cannot order them. A
 * flag is exact by construction — whichever note ran last wins, which is
 * precisely the question the status page asks.
 */
let lastAttemptFailed = false;

/**
 * Stamp "an upload did NOT land".
 *
 * Every upload path used to answer a failure with a bare `0` that nothing
 * read: a refusal, a server error and a five-second timeout were all
 * indistinguishable from "nothing to send". The status page kept showing the
 * last SUCCESSFUL upload, so an app whose batches were all being dropped still
 * read as healthy — the silent success this exists to end.
 *
 * Never throws.
 */
export function _noteUploadRejected(reason: UploadFailReason): void {
  try {
    lastUploadFailAtMs = Date.now();
    lastUploadFailReason = reason;
    lastAttemptFailed = true;
    droppedUploads += 1;
  } catch {
    /* a mirror write must never destabilize an upload path */
  }
}

/** The most recent upload failure, or null when nothing has failed in this
 *  process. Read by the standalone status page. Never throws. */
export function getLastUploadFailure(): {
  at: number;
  reason: UploadFailReason;
} | null {
  if (lastUploadFailAtMs === null || lastUploadFailReason === null) return null;
  return { at: lastUploadFailAtMs, reason: lastUploadFailReason };
}

/** How many uploads this process has had refused or lost. Cumulative — it is
 *  the size of the hole in the dashboard, so it is never reset by a later
 *  success. Never throws. */
export function getDroppedUploadCount(): number {
  return droppedUploads;
}

/** True when the LAST upload this process attempted did not land. Goes back to
 *  false the moment one succeeds, so a single blip cannot leave the status
 *  page permanently red. Never throws. */
export function isLastUploadAttemptFailed(): boolean {
  return lastAttemptFailed;
}

let panelFullTelemetry = false;

let panelEndpoint: string | null = null;

/** True when full telemetry is the mode uploads currently run under. Distinct
 *  from {@link isSharingOnForPanel} only in intent: the status page shows the
 *  upload gate and the telemetry mode as two separate, separately-honest rows.
 *  Never throws. */
export function isFullTelemetryForPanel(): boolean {
  return panelFullTelemetry;
}

/** Let the live client publish its identity + effective telemetry mode to the
 *  module mirrors above. Best-effort — never throws into the client. */
export function _publishInstallIdentity(
  installId: string | null,
  endpoint: string | null,
  fullTelemetry: boolean,
): void {
  panelInstallId = typeof installId === "string" && installId ? installId : null;
  panelEndpoint = typeof endpoint === "string" && endpoint ? endpoint : null;
  panelFullTelemetry = fullTelemetry === true;
}

let lastUploadAtMs: number | null = null;

/** The telemetry endpoint the live client talks to, or null when no client has
 *  been created. Read by the standalone status page. Never throws. */
export function getPanelEndpoint(): string | null {
  return panelEndpoint;
}

/** Kick the "is this install on file?" probe using whatever identity this
 *  process is currently holding. Called by the two display surfaces (the
 *  bubble panel's `/panel` read and the standalone status page) so the verdict
 *  they render is the SERVER's answer rather than a guess from the tokens this
 *  process happens to hold. Fire-and-forget, self-throttled to once every 30s
 *  while the answer is still missing, and never throws into the host. */
export function askRegistration(): void {
  try {
    void checkRegistrationOnce({
      endpoint: panelEndpoint,
      installId: panelInstallId,
      projectKey: panelProjectKey.key,
    });
  } catch {
    /* a probe must never destabilize a page render */
  }
}

/** Epoch ms of the last upload the SERVER accepted, or null when this process
 *  has never had one accepted. Read by the standalone status page. Never
 *  throws. */
export function getLastUploadAt(): number | null {
  return lastUploadAtMs;
}

/** @internal Test hook — clear the status mirrors between suites. */
export function _resetStatusMirrorsForTests(): void {
  // The registration verdict is one of these mirrors: it is published from the
  // same places, so it has to be forgotten with them or a confirmed answer
  // leaks between tests.
  _resetRegistrationForTests();
  panelInstallId = null;
  panelEndpoint = null;
  panelFullTelemetry = false;
  lastUploadAtMs = null;
  lastUploadFailAtMs = null;
  lastUploadFailReason = null;
  lastAttemptFailed = false;
  droppedUploads = 0;
  clearUploadPauses();
}
