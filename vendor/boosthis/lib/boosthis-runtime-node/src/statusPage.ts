/**
 * The standalone "is Boosthis working?" page — the one surface a back-end
 * developer can open when their app has no UI at all.
 *
 * WHY THIS EXISTS. The floating bubble proves the kit is alive by riding along
 * on a page the app already serves. An API with no HTML has nowhere to put it,
 * so the developer installs the kit, sees nothing, and reasonably concludes the
 * product is broken. This page is the answer: one self-contained HTML document,
 * served by the kit on the HOST APP'S OWN PORT, that states plainly whether the
 * kit registered, whether anything is being uploaded, and — when the answer is
 * no — why not.
 *
 * CONTRACT (identical in the Node, Python, Go, Java, PHP, .NET and Ruby kits —
 * change it in one, change it in all):
 *   - Path:    `<prefix>/status`, canonically `/_boosthis/status`.
 *   - Guard:   the kit's STRICT loopback guard, the same one `/account` uses
 *              (direct loopback TCP peer AND no proxy/forwarding headers). It
 *              is NOT opened by `allowRemote`, and it is NOT a new auth surface
 *              — a remote request gets 403 and learns nothing.
 *   - Body:    server-rendered HTML with inline CSS, NO JavaScript, NO network
 *              calls, NO external assets. The page has to work in exactly the
 *              situation where everything else is broken.
 *   - Secrets: the install id is shown (it is an opaque identifier the
 *              dashboard also shows); the delete token and read token are
 *              NEVER rendered here. Credentials stay on `/account`.
 *   - Honesty: the headline and explanation come from the SAME ordered state
 *              machine as the bubble's panel notice (rejected -> not
 *              registered -> sharing off -> UPLOADS FAILING -> measuring),
 *              with the same wording, so a developer never gets two different
 *              stories.
 *
 * NOTE ON PARITY: all five states now exist in every kit. `uploads-failing`
 * was the newest and lived here alone for a while: the other thirteen kits
 * reported a refused batch as nothing at all — they kept showing the last
 * SUCCESSFUL upload while every later batch was thrown away — and a customer
 * lost a day of data to exactly that on 22 Aug 2026. The state, its closed
 * four-reason set and both extra rows were carried across to all of them; the
 * shared wording is pinned by scripts/src/__tests__/kit-inactive-honesty.test.ts
 * and scripts/src/__tests__/server-kit-status-page.test.ts.
 *
 * `uploads-paused` is this kit's own for now: it is the kit that waits out a
 * 429's Retry-After on every upload (uploadPause.ts), so it is the kit that can
 * say it is waiting. Another kit that learns to wait adds the same state.
 */

import { RUNTIME_VERSION } from "./thresholds";
import {
  dropSummaryText,
  getDroppedRowCount,
  getUndeliveredRowCount,
  undeliveredSummaryText,
} from "./dropReport";
import {
  crashDeliveryFacts,
  crashDeliveryNote,
  crashReportingVerdict,
  type CrashReportingVerdict,
} from "./crashDelivery";
import {
  getDroppedUploadCount,
  getLastUploadAt,
  getLastUploadFailure,
  getPanelEndpoint,
  getPanelInstallId,
  getPanelProjectKey,
  askRegistration,
  getRegistrationRejection,
  getRegistrationRefusalKind,
  getRegistrationRefusalRetryAfterSeconds,
  getRegistrationRefusalSentence,
  describeRetryWait,
  isFullTelemetryForPanel,
  isLastUploadAttemptFailed,
  isRegisteredForPanel,
  isSharingOnForPanel,
  type UploadFailReason,
} from "./telemetry";
import {
  getRegistrationVerdict,
  type RegistrationVerdict,
} from "./registration";
import { describeProjectKeySource } from "./projectKey";
import {
  getKitProject,
  projectDisplay,
  PROJECT_LABEL,
  PROJECT_UNKNOWN_TEXT,
} from "./projectIdentity";
import * as samples from "./samples";
import { attachState, cannotAttachShort } from "./attachStatus";
import { hostingFacts, hostingLine } from "./hosting";
import { serverKindLabel } from "./serverKind";
import { tracePropagationSummary } from "./tracePropagation";
import { getUploadPause, type UploadPauseScope } from "./uploadPause";
import {
  UPLOAD_PAUSE_ENDS_LABEL,
  UPLOAD_PAUSE_TITLE,
  uploadPauseBody,
  uploadPauseEndsText,
} from "./uploadPauseWords";

/** The status-page path suffix, appended to the mount prefix. */
export const STATUS_SUFFIX = "/status";

/** The standalone status page path. Served by the middleware itself (and by
 *  mount() for parity), so it works with `app.use(boosthis())` alone — the
 *  whole point is that it is reachable in an app that wires up nothing else. */
export const STATUS_PATH = "/_boosthis/status";

/** Human label for this runtime, shown in the page's "Runtime" row. */
const RUNTIME_LABEL = "Node";

/** The kit option a developer flips to turn sharing on from code. Spelled the
 *  way THIS language spells it — the only value in the honesty wording that
 *  legitimately differs between kits. */
const SHARE_OPTION = "shareMeterWithAI: true";

/** The dashboard link used when no telemetry client exists yet (so there is no
 *  endpoint to derive an origin from). */
const DEFAULT_DASHBOARD_URL = "https://www.boosthis.com/dashboard";

/** Shared palette — the kit's dark theme, byte-equal to the bubble's. */
const T = {
  bg: "#0b0c10",
  card: "#15171c",
  br: "#262932",
  fg: "#e6e7eb",
  mut: "#8b8f99",
  pri: "#f97316",
  good: "#4ade80",
  warn: "#fbbf24",
  bad: "#f87171",
};

/** The states the page can report, in the order they are checked.
 *  `uploads-failing` is appended LAST on purpose: it is only reachable by an
 *  install that got past all three earlier problems, and adding it must not
 *  move any of them. `uploads-paused` is appended after it for the same
 *  reason; it is checked just before it (see collectStatusFacts). */
export type StatusState =
  | "install-id-not-uuid"
  | "not-registered"
  | "registration-throttled"
  | "registration-unknown"
  | "sharing-off"
  | "measuring"
  | "uploads-failing"
  | "uploads-paused";

/** Everything the page renders. Collected once, then formatted — so tests can
 *  assert the facts without parsing HTML. */
export interface StatusFacts {
  state: StatusState;
  installId: string | null;
  /** Boosthis's own answer to "is this install on file?" — three outcomes, so
   *  an unanswered question can never be rendered as a definite No. */
  registrationVerdict: RegistrationVerdict;
  registered: boolean;
  sharing: boolean;
  fullTelemetry: boolean;
  lastUploadAt: number | null;
  /** When the most recent upload FAILED, and why. Null when none has. */
  lastUploadFailAt: number | null;
  lastUploadFailReason: UploadFailReason | null;
  /** How many uploads this process has lost. Cumulative — it is the size of
   *  the hole in the dashboard, so a later success does not erase it. */
  uploadsDropped: number;
  /** How many individual rows the SERVER accepted the batch but then refused.
   *  Zero when the server never reported any (an older server, or a healthy
   *  app) — the page then shows nothing at all. */
  rowsDropped: number;
  /** `"6 — route names the privacy guard refused"`. Empty when nothing was
   *  dropped. Same words the project's web page uses. */
  rowsDroppedText: string;
  /** THE OTHER HALF OF THE SAME HOLE: rows that never reached the server at
   *  all, because THIS KIT gave up on them. Different problem, different fix,
   *  so it is never added to the count above. Zero on a healthy app. */
  rowsUndelivered: number;
  /** `"7 — buffer full, oldest measurements dropped"`. Empty when none. */
  rowsUndeliveredText: string;
  /** CAN THIS INSTALL REPORT A CRASH AT ALL? A crash count of zero on the
   *  dashboard means "no crashes" only when this says `reporting`. The other
   *  two answers are why the page has a row of its own: an install that cannot
   *  keep a crash, or whose crashes we are refusing, must not look identical to
   *  one that has never crashed. */
  crashReporting: CrashReportingVerdict;
  /** The kit's own sentence about it. Empty when there is nothing wrong — a
   *  healthy install carries no crash row at all. */
  crashDeliveryNote: string;
  /** Crash occurrences captured and still not accepted by Boosthis. */
  crashesHeld: number;
  requestsMeasured: number;
  kitVersion: string;
  runtime: string;
  /** Which server this app is serving with, in plain words ("Fastify",
   *  "Next.js", "Node http server"). The dashboard shows the same answer, so a
   *  developer and Boosthis are never describing different apps. */
  serverLabel?: string;
  /** WHERE THIS PROJECT RUNS, in the same words the dashboard uses — the
   *  hosting platform, the region the platform declares, and "Preview" when it
   *  says this is not production. Never blank: a place that publishes nothing
   *  about itself says so, which is what an ordinary server looks like. */
  hostingLine: string;
  /** True only when the platform itself declared a non-production deployment.
   *  The page then says so loudly, because a preview's numbers landing on the
   *  dashboard under the real project's name is the confusion this prevents. */
  hostingIsPreview: boolean;
  /** Set ONLY when the framework-free attach was asked for and could not go
   *  on. Null in every healthy install, and null when the attach was never
   *  asked for (an Express app that only uses the middleware). A refusal is
   *  the one thing this page must never leave out: without it a project that
   *  cannot be measured at all reads as perfectly healthy. */
  attachRefusalText?: string | null;
  /** WHERE THIS APP PASSES ITS TRACE ON. The kit attaches the trace headers to
   *  the app's own outgoing calls so a chain across two services reads as one
   *  trace — but only to destinations the customer's setting permits, and the
   *  default permits none that could belong to an outside company. Always
   *  present, because "nothing is being added to my requests" is a fact a
   *  developer is entitled to read rather than infer from an absent row. */
  tracePropagation: string;
  dashboardUrl: string;
  projectKeyDisplay?: string | null;
  projectKeySource?: string;
  /** WHICH PROJECT this install feeds, in the developer's own words — the same
   *  name and short code the AI connection uses. Only the server knows it, so
   *  this is whatever the last registration reply said (restored from disk on a
   *  restart). Falls back to the kit's own "not received yet" wording. */
  projectDisplay?: string;
  refusalSentence?: string | null;
  /** `registration-throttled` only: the server's own `Retry-After`, in
   *  seconds. A number, never text — the page builds the sentence around it. */
  throttleWaitSeconds?: number | null;
  /** A WAIT BOOSTHIS ASKED FOR (a 429 and its Retry-After): when the last
   *  upload it holds may go again, in epoch ms. Null when nothing is held. */
  uploadPausedUntil?: number | null;
  /** Which uploads that wait holds. Null when nothing is held. */
  uploadPauseScope?: UploadPauseScope | null;
}

/** Derive the project dashboard URL from the telemetry endpoint's origin, so a
 *  self-hosted or staging endpoint links to ITS dashboard rather than lying
 *  about where this install's data went. Falls back to the public dashboard. */
export function dashboardUrlFor(endpoint: string | null): string {
  try {
    if (!endpoint) return DEFAULT_DASHBOARD_URL;
    return `${new URL(endpoint).origin}/dashboard`;
  } catch {
    return DEFAULT_DASHBOARD_URL;
  }
}

/** Read the kit's live state. Fail-safe: any readout error degrades to the
 *  most conservative honest answer (nothing registered, nothing uploaded)
 *  rather than throwing into the host's request handling. */
export function collectStatusFacts(): StatusFacts {
  let installId: string | null = null;
  let registered = false;
  let sharing = false;
  let fullTelemetry = false;
  let lastUploadAt: number | null = null;
  let lastUploadFailAt: number | null = null;
  let lastUploadFailReason: UploadFailReason | null = null;
  let uploadsDropped = 0;
  let rowsDropped = 0;
  let rowsDroppedText = "";
  let rowsUndelivered = 0;
  let rowsUndeliveredText = "";
  let crashReporting: CrashReportingVerdict = "reporting";
  let crashNote = "";
  let crashesHeld = 0;
  let lastAttemptFailed = false;
  let requestsMeasured = 0;
  let rejected = false;
  let verdict: RegistrationVerdict = "unknown";
  let endpoint: string | null = null;
  let projectKeyDisplay: string | null = null;
  let projectKeySource = "no project key configured";
  let projectText = projectDisplay(null);
  let refusalSentence: string | null = null;
  let throttled = false;
  let throttleWaitSeconds: number | null = null;
  // Read outside the big try below: the propagation policy is pure and cannot
  // reach the network, so a readout failure anywhere else on this page must
  // not cost the developer the one row that says what the kit is adding to
  // their outgoing requests.
  let propagationSummary = "Off — no trace headers are attached to outgoing calls";
  try {
    propagationSummary = tracePropagationSummary();
  } catch {
    // keep the conservative sentence
  }

  try {
    // Ask Boosthis whether this install is on file. Fire-and-forget and
    // self-throttled, so a page load never waits on it — the verdict read
    // below is whatever answer has landed, and says "cannot tell" until one
    // has. This page is rendered by the HOST app's own server, so it must
    // never block on a call to us.
    askRegistration();
    verdict = getRegistrationVerdict();
    installId = getPanelInstallId();
    endpoint = getPanelEndpoint();
    registered = isRegisteredForPanel();
    sharing = isSharingOnForPanel();
    fullTelemetry = isFullTelemetryForPanel();
    lastUploadAt = getLastUploadAt();
    const fail = getLastUploadFailure();
    lastUploadFailAt = fail ? fail.at : null;
    lastUploadFailReason = fail ? fail.reason : null;
    uploadsDropped = getDroppedUploadCount();
    rowsDropped = getDroppedRowCount();
    rowsDroppedText = dropSummaryText();
    rowsUndelivered = getUndeliveredRowCount();
    rowsUndeliveredText = undeliveredSummaryText();
    lastAttemptFailed = isLastUploadAttemptFailed();
    rejected = getRegistrationRejection() === "install-id-not-uuid";
    // Local state may fill the gap ONLY while the question is unanswered — a
    // process holding a server-minted delete token knows something real. It
    // can never turn "cannot tell" into "not registered".
    if (verdict === "unknown" && registered) verdict = "registered";
    const projectKey = getPanelProjectKey();
    projectKeyDisplay = projectKey.display;
    projectKeySource = describeProjectKeySource(projectKey.source);
    projectText = projectDisplay(getKitProject());
    refusalSentence = getRegistrationRefusalSentence();
    // A rate-limited registration is its own state, not a failed one and not
    // an unreachable server. Read the kind, not just the sentence.
    throttled = getRegistrationRefusalKind() === "throttled";
    throttleWaitSeconds = getRegistrationRefusalRetryAfterSeconds();
  } catch {
    /* keep the conservative defaults above */
  }
  try {
    requestsMeasured = samples.summary().total;
  } catch {
    requestsMeasured = 0;
  }
  try {
    crashReporting = crashReportingVerdict();
    crashNote = crashDeliveryNote();
    // Everything still waiting, not just what a refusal counted: a crash that
    // has never been OFFERED is exactly as absent from the dashboard as one
    // that was turned away.
    crashesHeld = crashDeliveryFacts().held;
  } catch {
    // Unreadable is not "fine": the page says it cannot tell rather than
    // rendering the healthy answer by default.
    crashReporting = "cannot-keep";
    crashNote = "Boosthis could not read its own crash-delivery record";
    crashesHeld = 0;
  }

  // What this app is serving with, and whether the attach that watches it
  // actually went on. Both fail safe: an unreadable answer says "unknown"
  // rather than inventing a framework, and a page that cannot tell whether
  // the attach worked says nothing rather than claiming it did.
  let serverLabel = "Unknown";
  let attachRefusalText: string | null = null;
  try {
    const attach = attachState();
    serverLabel = serverKindLabel(attach.serverKind);
    attachRefusalText =
      attach.called && !attach.attached && attach.reason
        ? cannotAttachShort(attach.reason)
        : null;
  } catch {
    serverLabel = "Unknown";
    attachRefusalText = null;
  }

  // Where this project runs, read from what the platform publishes about
  // itself. Fail-safe like everything else on this page: an unreadable answer
  // says "we could not tell" rather than naming a platform we are not sure of.
  let whereItRuns = "Could not be read";
  let hostingIsPreview = false;
  try {
    const facts = hostingFacts();
    whereItRuns = hostingLine(facts);
    hostingIsPreview =
      facts.environment === "preview" || facts.environment === "development";
  } catch {
    whereItRuns = "Could not be read";
    hostingIsPreview = false;
  }

  // A wait Boosthis asked for. Read on its own: a readout failure elsewhere
  // must not hide it, and an unreadable pause is reported as none, which is
  // what the uploads themselves will find out on their next attempt.
  let pausedUntil: number | null = null;
  let pauseScope: UploadPauseScope | null = null;
  try {
    const pause = getUploadPause();
    pausedUntil = pause ? pause.until : null;
    pauseScope = pause ? pause.scope : null;
  } catch {
    pausedUntil = null;
    pauseScope = null;
  }

  // An install whose uploads are being dropped is only interesting once the
  // three earlier problems are ruled out — an app that never registered has
  // no uploads to fail. So the check goes LAST, and only counts while the most
  // recent attempt is the FAILED one: a success after a failure means the pipe
  // is working again and the page must go back to green rather than stay
  // permanently red over an old blip. Deliberately NOT a comparison of the two
  // timestamps — a burst puts both in the same millisecond.
  const uploadsFailing = lastAttemptFailed && lastUploadFailAt !== null;

  // Same order as the bubble's computePanelNotice: a server-refused id first,
  // then a kit that never registered, then a registered-but-silent install.
  //
  // The registration step reads BOOSTHIS'S ANSWER, not this process's tokens:
  // a restarted worker that could not read its store holds no credential and
  // used to declare the install unregistered, which is how a developer (or an
  // assisting AI) gets told to change an id that was working perfectly.
  const state: StatusState = rejected
    ? "install-id-not-uuid"
    : throttled && verdict !== "registered"
      ? // BEFORE "not-registered", which a throttled install would otherwise
        // reach on the strength of its refusal sentence alone. It is not a
        // failed registration; it is one that has not been allowed to happen
        // yet, and it needs no action.
        "registration-throttled"
    : refusalSentence !== null && verdict !== "registered"
      ? "not-registered"
    : verdict === "unregistered"
      ? "not-registered"
      : verdict === "unknown"
        ? "registration-unknown"
        : !sharing
          ? "sharing-off"
          : pausedUntil !== null
            ? // BEFORE "uploads-failing": the uploads are waiting because
              // Boosthis asked, nothing is wrong with the pipe, and the wait
              // is the one fact a reader needs.
              "uploads-paused"
            : uploadsFailing
              ? "uploads-failing"
              : "measuring";

  return {
    state,
    installId,
    registrationVerdict: verdict,
    registered,
    sharing,
    fullTelemetry,
    lastUploadAt,
    lastUploadFailAt,
    lastUploadFailReason,
    uploadsDropped,
    rowsDropped,
    rowsDroppedText,
    rowsUndelivered,
    rowsUndeliveredText,
    crashReporting,
    crashDeliveryNote: crashNote,
    crashesHeld,
    requestsMeasured,
    kitVersion: RUNTIME_VERSION,
    runtime: RUNTIME_LABEL,
    serverLabel,
    hostingLine: whereItRuns,
    hostingIsPreview,
    attachRefusalText,
    tracePropagation: propagationSummary,
    dashboardUrl: dashboardUrlFor(endpoint),
    projectKeyDisplay,
    projectKeySource,
    projectDisplay: projectText,
    refusalSentence,
    throttleWaitSeconds,
    uploadPausedUntil: pausedUntil,
    uploadPauseScope: pauseScope,
  };
}

/** Headline + explanation for a state. The wording is the panel notice's,
 *  word for word, except that the sharing-off line says "stay inside this
 *  process" instead of "stay on this screen" — this page shows no meters, and
 *  it must not describe something the reader cannot see. */
export function statusHeadline(
  state: StatusState,
  refusalSentence?: string | null,
  throttleWaitSeconds?: number | null,
  pauseScope?: UploadPauseScope | null,
): {
  title: string;
  body: string;
  tone: "good" | "warn" | "bad";
} {
  if (state === "install-id-not-uuid") {
    return {
      title: "Registration rejected",
      body: "Install ID must be a UUID. Mint a real UUID and restart.",
      tone: "bad",
    };
  }
  if (state === "not-registered") {
    return {
      title: "Not registered yet",
      body: refusalSentence ?? "This app has not registered with Boosthis, so nothing is being sent. Check the project key and this app's outbound network access, then restart.",
      tone: "bad",
    };
  }
  if (state === "registration-throttled") {
    return {
      title: "Waiting — too many new registrations",
      body:
        "Boosthis is rate-limiting new registrations for this project key, " +
        "so this app is not on file yet. It is temporary and needs nothing " +
        "from you: the kit is waiting " +
        describeRetryWait(throttleWaitSeconds ?? undefined) +
        " and will register itself, with no restart. Do not change the " +
        "install line's id while this is showing — a new id is a new " +
        "registration and makes the wait longer.",
      tone: "warn",
    };
  }
  if (state === "registration-unknown") {
    return {
      title: "Can't check right now",
      body:
        "Boosthis could not be reached to confirm whether this app is " +
        "registered, so this page cannot say either way yet. This is not a " +
        "failed install and it does not mean anything stopped — it settles " +
        "by itself once the check goes through. Do not change the install " +
        "line's id while this is showing.",
      tone: "warn",
    };
  }
  if (state === "sharing-off") {
    return {
      title: "Nothing is being uploaded",
      body:
        "This app is registered, but sharing is off: measurements stay " +
        "inside this process and your Boosthis dashboard stays empty. Turn " +
        `sharing on there, or start the kit with ${SHARE_OPTION}.`,
      tone: "warn",
    };
  }
  if (state === "uploads-paused") {
    return {
      title: UPLOAD_PAUSE_TITLE,
      body: uploadPauseBody(pauseScope ?? "measurements"),
      tone: "warn",
    };
  }
  if (state === "uploads-failing") {
    return {
      title: "Uploads are not getting through",
      body:
        "This app is registered and sharing is on, but the last batch of " +
        "measurements did not reach Boosthis, so your dashboard is missing " +
        "the most recent data. The rows below say what happened and how " +
        "much has been lost.",
      tone: "bad",
    };
  }
  return {
    title: "Registered and measuring",
    body:
      "This app is registered with Boosthis and its measurements are being " +
      "uploaded. Open the dashboard below to see them.",
    tone: "good",
  };
}

/** Plain-English reason text. Code-defined per reason — the server's own words
 *  are never shown, so nothing here can be steered by a response body. */
export function uploadFailText(reason: UploadFailReason): string {
  if (reason === "unauthorized") {
    return "Refused — credentials rejected";
  }
  if (reason === "rejected") {
    return "Refused — batch rejected";
  }
  if (reason === "server-error") {
    return "Boosthis failed to store it";
  }
  return "No answer — timed out or unreachable";
}

/** Escape every dynamic value before it reaches the document. */
function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `2026-08-20 09:12:44 UTC (34s ago)` — absolute so it can be compared with a
 *  server-side log, relative so "is it alive right now?" needs no arithmetic.
 *  Formatted identically in every kit. */
export function formatLastUpload(at: number | null, now: number): string {
  if (at === null || !Number.isFinite(at)) return "Nothing uploaded yet";
  const d = new Date(at);
  const stamp =
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC`;
  const secs = Math.max(0, Math.floor((now - at) / 1000));
  const age =
    secs < 60
      ? `${secs}s ago`
      : secs < 3600
        ? `${Math.floor(secs / 60)}m ago`
        : `${Math.floor(secs / 3600)}h ago`;
  return `${stamp} (${age})`;
}

function row(label: string, value: string, color?: string): string {
  return (
    `<div class="r"><span class="k">${esc(label)}</span>` +
    `<span class="v"${color ? ` style="color:${color}"` : ""}>${esc(value)}</span></div>`
  );
}

/** Render the page. Pure: everything it shows comes from `facts` + `now`. */
export function renderStatusPage(facts: StatusFacts, now: number = Date.now()): string {
  const h = statusHeadline(
    facts.state,
    facts.refusalSentence,
    facts.throttleWaitSeconds,
    facts.uploadPauseScope,
  );
  const toneColor = h.tone === "good" ? T.good : h.tone === "warn" ? T.warn : T.bad;
  return (
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow">' +
    "<title>Boosthis status</title><style>" +
    `:root{color-scheme:dark}body{margin:0;background:${T.bg};color:${T.fg};` +
    "font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;" +
    "padding:32px 20px}main{max-width:620px;margin:0 auto}" +
    `.kick{color:${T.pri};font-size:11px;letter-spacing:.16em;font-weight:700}` +
    "h1{font-size:22px;margin:10px 0 8px;font-weight:650}" +
    `p.lead{color:${T.mut};margin:0 0 22px}` +
    `.card{background:${T.card};border:1px solid ${T.br};border-radius:16px;padding:6px 16px}` +
    `.r{display:flex;justify-content:space-between;gap:16px;padding:11px 0;` +
    `border-bottom:1px solid ${T.br};margin-bottom:0}` +
    ".r:last-child{border-bottom:none}" +
    `.k{color:${T.mut}}.v{font-variant-numeric:tabular-nums;text-align:right;word-break:break-all}` +
    `a.dash{display:inline-block;margin-top:20px;background:${T.pri};color:#0b0c10;` +
    "font-weight:650;text-decoration:none;padding:11px 18px;border-radius:12px}" +
    `footer{color:${T.mut};font-size:12px;margin-top:22px}` +
    "</style></head><body><main>" +
    '<div class="kick">BOOSTHIS</div>' +
    `<h1 style="color:${toneColor}">${esc(h.title)}</h1>` +
    `<p class="lead">${esc(h.body)}</p>` +
    '<div class="card">' +
    // WHICH PROJECT first: a developer holding two projects in one codebase has
    // to be able to answer "which one am I looking at?" before anything else on
    // this page means much. Same name and short code the AI connection uses.
    row(PROJECT_LABEL, facts.projectDisplay ?? PROJECT_UNKNOWN_TEXT) +
    row("Install ID", facts.installId ?? "Not assigned yet") +
    // Three outcomes, never two: "No" is only printed when Boosthis SAID no.
    row(
      "Registered",
      facts.registrationVerdict === "registered"
        ? "Yes"
        : facts.registrationVerdict === "unregistered"
          ? "No"
          : "Can't tell right now",
      facts.registrationVerdict === "registered"
        ? T.good
        : facts.registrationVerdict === "unregistered"
          ? T.bad
          : T.warn,
    ) +
    row("Sharing", facts.sharing ? "On" : "Off", facts.sharing ? T.good : T.warn) +
    row("Telemetry mode", facts.fullTelemetry ? "Full telemetry" : "Private (issues only)") +
    // WHAT THE KIT ADDS TO THIS APP'S OWN OUTGOING REQUESTS. The one thing on
    // this page that is not about data leaving for Boosthis: it is about the
    // app's own calls to its own next service, and it is here because a
    // developer must be able to READ what is being attached to their traffic
    // rather than discover it in a packet capture.
    row("Trace passed on to", facts.tracePropagation) +
    row(
      "Project key",
      facts.projectKeyDisplay
        ? `${facts.projectKeyDisplay} — ${facts.projectKeySource ?? "no project key configured"}`
        : (facts.projectKeySource ?? "no project key configured"),
    ) +
    row("Last upload", formatLastUpload(facts.lastUploadAt, now)) +
    // Only while Boosthis has asked this app to wait: when the wait ends.
    (facts.uploadPausedUntil != null && facts.uploadPausedUntil > now
      ? row(
          UPLOAD_PAUSE_ENDS_LABEL,
          uploadPauseEndsText(facts.uploadPausedUntil, now),
          T.warn,
        )
      : "") +
    // Only shown once something HAS failed — a clean install must not carry a
    // permanent "Last failure: never" row implying failures are expected.
    (facts.lastUploadFailAt !== null && facts.lastUploadFailReason !== null
      ? row(
          "Last upload failed",
          `${formatLastUpload(facts.lastUploadFailAt, now)} — ` +
            uploadFailText(facts.lastUploadFailReason),
          T.bad,
        ) +
        row("Uploads lost", String(facts.uploadsDropped), T.bad)
      : "") +
    // Rows the server ACCEPTED the batch for and then refused. Shown only when
    // the server actually reported some: an older server says nothing, and a
    // healthy app must not carry a permanent "0 dropped" row implying loss is
    // normal.
    (facts.rowsDropped > 0 && facts.rowsDroppedText !== ""
      ? row("Measurements dropped", facts.rowsDroppedText, T.warn)
      : "") +
    // Rows this kit NEVER GOT OUT. The other half of the same hole, and until
    // now the invisible half: the counts existed only as fields inside the
    // `serverless` meter page, which a reader has to know to expand and which
    // a long-running server does not even publish. Its own row, never added to
    // the one above — "the server refused what we sent" and "we never sent it"
    // ask for different fixes. Red rather than amber: these rows are confirmed
    // gone, not delayed.
    (facts.rowsUndelivered > 0 && facts.rowsUndeliveredText !== ""
      ? row("Measurements never delivered", facts.rowsUndeliveredText, T.bad)
      : "") +
    // CRASH REPORTING, in the kit's own words, and only when there is
    // something wrong to say. A healthy install shows no row: what this
    // catches is the opposite case, where the dashboard's crash count reads
    // zero because nothing could be kept or nothing was accepted — a silence
    // that otherwise looks exactly like a well-behaved app.
    (facts.crashReporting !== "reporting" && facts.crashDeliveryNote !== ""
      ? row(
          "Crash reporting",
          `${facts.crashDeliveryNote}. Until this clears, a crash count of zero for this project is not proof it has not crashed.`,
          facts.crashReporting === "cannot-keep" ? T.bad : T.warn,
        )
      : "") +
    // WHERE SCHEDULED JOBS LIVE. Always shown, never conditional: a page that
    // simply omits jobs reads as a page reporting there are none, and an AI
    // agent read three healthy jobs as absent that way. Same answer as the
    // in-app page's jobs card; see
    // docs/decisions/kit-page-says-where-jobs-live.md.
    row(
      "Scheduled jobs",
      "Not listed here. This kit reports named job runs to Boosthis, so they appear on your dashboard — this page showing none is not evidence there are none.",
    ) +
    row("Requests measured", String(facts.requestsMeasured)) +
    row("Kit version", facts.kitVersion) +
    row("Runtime", facts.runtime) +
    row("Server", facts.serverLabel ?? "Unknown") +
    // Where this project runs. Always shown, because every answer here is
    // worth reading — including "nothing here declares a platform", which is
    // what an ordinary server looks like and must not be mistaken for a
    // missing row. Amber when the platform says this is NOT production: these
    // numbers then describe a throwaway copy, and a reader has to know that
    // before the numbers above mean anything.
    row(
      "Where it runs",
      facts.hostingLine,
      facts.hostingIsPreview ? T.warn : undefined,
    ) +
    // Shown only when the attach was asked for and refused. A healthy install
    // carries no "Attached: yes" row — a page full of green confirmations for
    // things that never go wrong is how the one that did goes unnoticed.
    (facts.attachRefusalText
      ? row("Watching this server", facts.attachRefusalText, T.bad)
      : "") +
    "</div>" +
    `<a class="dash" href="${esc(facts.dashboardUrl)}" target="_blank" rel="noopener">` +
    "Open your Boosthis dashboard</a>" +
    "<footer>This page is served by the Boosthis kit inside your own app, on " +
    "your own port. It is only reachable from the machine running this app, " +
    "and it never shows your install token.</footer>" +
    "</main></body></html>"
  );
}

/** Convenience: collect + render in one call. Never throws. */
export function statusPageHtml(now: number = Date.now()): string {
  try {
    return renderStatusPage(collectStatusFacts(), now);
  } catch {
    // Every readout failed, so we know NOTHING about this install — least of
    // all that it is unregistered. The honest fallback is "cannot tell".
    return renderStatusPage(
      {
        state: "registration-unknown",
        installId: null,
        registrationVerdict: "unknown",
        registered: false,
        tracePropagation: tracePropagationSummary(),
        sharing: false,
        fullTelemetry: false,
        lastUploadAt: null,
        lastUploadFailAt: null,
        lastUploadFailReason: null,
        uploadsDropped: 0,
        rowsDropped: 0,
        rowsDroppedText: "",
        rowsUndelivered: 0,
        rowsUndeliveredText: "",
        // Every readout failed, so we cannot claim crash reporting works
        // either — and this is the one place where the healthy answer would be
        // a promise we cannot stand behind.
        crashReporting: "cannot-keep",
        crashDeliveryNote:
          "Boosthis could not read its own crash-delivery record",
        crashesHeld: 0,
        requestsMeasured: 0,
        kitVersion: RUNTIME_VERSION,
        runtime: RUNTIME_LABEL,
        // Every readout failed, so we cannot claim a framework and cannot
        // claim the attach refused either — say only what is knowable.
        serverLabel: "Unknown",
        // Same rule for where it runs: a failed readout is not evidence that
        // nothing declared a platform, so this must not say "no hosting
        // platform declared". And nothing may be called production here.
        hostingLine: "Could not be read",
        hostingIsPreview: false,
        attachRefusalText: null,
        dashboardUrl: DEFAULT_DASHBOARD_URL,
        projectDisplay: PROJECT_UNKNOWN_TEXT,
        projectKeyDisplay: null,
        projectKeySource: "no project key configured",
      },
      now,
    );
  }
}

/** The body served to a request that did not come from this machine. Same
 *  local-only posture as `/account`, and it discloses nothing about the
 *  install. */
/**
 * The ONE page every local page shows while the kit is locked
 * (docs/kit-lock-rule.md): the renew notice and nothing else — no numbers,
 * rules, samples or budgets. Who may open it does not change. Pure.
 */
export function renewOnlyHtml(notice: { title: string; body: string }): string {
  return (
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow">' +
    "<title>Boosthis</title><style>" +
    `:root{color-scheme:dark}body{margin:0;background:${T.bg};color:${T.fg};` +
    "font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:32px 20px}" +
    `main{max-width:620px;margin:0 auto}h1{font-size:20px;margin:0 0 8px}p{color:${T.mut};margin:0}` +
    "</style></head><body><main>" +
    `<h1>${esc(notice.title)}</h1>` +
    `<p>${esc(notice.body)}</p>` +
    "</main></body></html>"
  );
}

export const STATUS_FORBIDDEN_HTML: string =
  "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
  '<meta name="robots" content="noindex,nofollow">' +
  "<title>Boosthis status</title><style>" +
  `body{margin:0;background:${T.bg};color:${T.fg};` +
  "font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:32px 20px}" +
  `main{max-width:620px;margin:0 auto}h1{font-size:20px;margin:0 0 8px}p{color:${T.mut};margin:0}` +
  "</style></head><body><main>" +
  "<h1>Boosthis status is local-only</h1>" +
  "<p>This page is served only to requests from the machine running this app. " +
  "Open it from that machine.</p>" +
  "</main></body></html>";
