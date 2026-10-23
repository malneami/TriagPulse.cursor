/** Express middleware: time every request, normalize the path, record a sample.
 *
 * Duck-typed against Express so this package doesn't hard-require it. Works
 * with `app.use(boosthis())` in any framework whose middleware shape matches.
 */

import { isRouteFirst, recordWithDoor } from "./samples";
import { isKitDissolved, isKitLocked } from "./killSwitch";
import { authorizationPresence, doorWordFor, type DoorWord } from "./routeDoor";
import { routeLabel } from "./routeInventory";
import { rateDuration } from "./thresholds";
import { isBoosthisDisabled } from "./runtimeFlags";
import {
  TRACE_HEADER,
  ELAPSED_HEADER,
  adoptTraceId,
  sanitizeTraceId,
  sanitizeTraceElapsed,
} from "./trace";
import {
  PARENT_HEADER,
  adoptParentSpanId,
  beginSpan,
  markErrorAction,
  runInSpan,
  type SpanHandle,
} from "./spanScope";
import { enqueueSpan, spanLabel } from "./spanEmitter";
import { outcomeForStatus } from "./spanWork";
import { chargeRunOverhead } from "./kitFootprint";
import { noteRequestStart, noteRequestEnd } from "./liveDetectors";
import {
  armRunDeathWatch,
  beginInvocation,
  finishInvocation,
  needsFlushBeforeResponse,
} from "./serverlessLifecycle";
import { noteRunLimits } from "./serverlessMeters";
import { chargeKitInterval, openKitInterval } from "./kitFootprint";
import { recordLatencySample } from "./serverMeters";
import { isHeldOpenCall, noteHeldOpenExcluded } from "./heldOpen";
import { noteDeclaredRouteCall, setDeclaredWaits, type DeclaredWaitsOption } from "./declaredWaits";
import {
  beginRequestWork,
  endRequestWork,
  noteRouteFirst,
  identifiedCallCount,
  runInRequestWork,
  type RequestWorkScope,
} from "./repeatedWork";
import { armDbClients, endDbWork } from "./dbWork";
import { armAiCalls, endAiWork } from "./aiCalls";
import { setDeclaredAiEndpoints } from "./aiProviders";
import { endDependencyWork } from "./dependencyWork";
import { closeLinkedScope, linkedStepSpans, openLinkedScope } from "./linkedSteps";
import { noteRequestContainment } from "./failureContainment";
import { armJobSystems } from "./jobAdapters";
import { noteResponseCacheHeaders } from "./cacheDirectives";
import { noteRequest } from "./runtimeVitals";
import {
  noteResponseBackpressure,
  noteWorkerRequest,
  noteDeflectionStart,
  noteDeflectionEnd,
  noteLeakFromResponse,
  noteCookiesFromResponse,
  classifyCorsAnswer,
  noteCorsAnswer,
  type CorsAnswerShape,
  noteAccessOutcome,
  noteRefusalHonesty,
  leakRouteClass,
  utf8BytePrefix,
} from "./extraMeters";
import { noteResponseForRealtime } from "./liveConnections";
import {
  PULSE_PATH,
  PANEL_PATH,
  resolveBubbleVisibility,
  wrapResponseForInjection,
} from "./bubble";
import { isDirectLoopback } from "./loopback";
import {
  ownerMayHaveBubble,
  settleOwnerRequest,
  type OwnerRes,
  type OwnerVerdict,
} from "./ownerLink";
import {
  KIT_BASE_PATH,
  announceMissingKitAssets,
  answerKitRead,
  answerUnmountedKitRead,
  areKitPathsRegistered,
  kitReadSuffixFor,
  registeredKitBasePaths,
  writeRawKitAnswer,
  type RawResLike,
} from "./kitAnswers";
import { claimRequest } from "./requestOnce";
import {
  announceKitStart,
  beginStartAnnouncement,
  flushHeldRefusals,
  type BadgeState,
} from "./startAnnounce";
import { announceUnreadableSources } from "./sourceNotice";
import { registerApp } from "./routeInventory";
import { resolveProjectKey } from "./projectKey";
import { isBoosthisDisabled as isBoosthisEnvDisabled } from "./runtimeFlags";
import { STATUS_PATH } from "./statusPage";
import { isMcpPath, mcpAutoLabel, recordMcpSample } from "./mcpMeasure";
import { noteRouteOutcome } from "./routeOutcomes";
import { noteQueueStartHeader } from "./cpuSchedulingMeters";

/** The kit-owned suffixes the MIDDLEWARE answers directly. Deliberately a
 *  subset of everything the kit can answer: an Express app reaches the rest
 *  through `mount(app)`, and widening this set would change what an Express
 *  install serves without anyone asking for it.
 *
 *  Held as SUFFIXES rather than whole paths so the trailing-slash spelling of
 *  each one resolves here too — `kitReadSuffixFor` folds `/_boosthis/status/`
 *  onto `/status`, and a set of literal paths would have missed it. */
const MIDDLEWARE_SERVED: ReadonlySet<string> = new Set([
  PULSE_PATH.slice(KIT_BASE_PATH.length),
  PANEL_PATH.slice(KIT_BASE_PATH.length),
  STATUS_PATH.slice(KIT_BASE_PATH.length),
]);

export interface BoosthisOptions {
  /** Route label for paths that don't match a registered Express route. */
  fallbackName?: string;
  /** Override the rating function (default: TTI thresholds). */
  rate?: (durationMs: number) => "good" | "needs-work" | "poor";
  /**
   * Want the floating bubble (true) or not (false). Default: wanted. A wanted
   * bubble is for the app's owner only: it draws only in a browser switched on
   * by opening any page with `?boosthis=on` (`?boosthis=off` forgets it), on a
   * development host as on a live site, so a visitor never sees it.
   * `BOOSTHIS_BUBBLE` env overrides this option (`BOOSTHIS_BUBBLE=0` hides
   * it); `BOOSTHIS_DISABLED` always wins and hides it.
   */
  bubble?: boolean;
  /**
   * The project key this process will register with, when the caller already
   * holds it. Used ONLY to name the key by its last four characters on the
   * startup line — the reporting client still resolves the key it uses
   * independently. Installs that pass the key to `enableTelemetry` instead can
   * leave this unset: the startup line waits one turn of the event loop for
   * that call to supply it.
   */
  projectKey?: string | null;
  /**
   * Model endpoints this app calls that are NOT one of the public providers —
   * a model you host yourself, a private or regional gateway, an
   * OpenAI-compatible server on your own network.
   *
   * Without this, such a call is not measured at all: the AI reading is built
   * on a maintained list of provider hostnames, and an address that is not on
   * it is ordinary outbound traffic. That is not a zero on the dashboard, it
   * is three missing tiles — an app whose entire AI layer is private looks
   * like an app with no AI layer.
   *
   * Hostnames only, matched exactly (`"llm.internal"`, `"ai.example.com"`); a
   * full URL is accepted and reduced to its host. The address is compared
   * inside this process and never leaves it: what reaches Boosthis is the same
   * fixed classification number for every declared endpoint, so a reading can
   * neither name your endpoint nor tell two of them apart.
   *
   * `BOOSTHIS_AI_ENDPOINTS` (comma-separated) does the same thing and is
   * merged with this list, for apps configured by environment.
   *
   * Calls to a declared endpoint are counted and timed, and their tokens are
   * counted, but they are never priced from our table — a model you host has
   * no list price. A cost your own endpoint reports IS used.
   */
  aiEndpoints?: readonly string[];
  /**
   * Waits this app does ON PURPOSE, named exactly, so they are not read as
   * slowness (contract: docs/held-open-calls.md, "Waits declared on purpose").
   *
   * `routes` — routes this app answers that wait on purpose, such as a
   * long-poll that answers only when there is news. Written as the dashboard
   * shows them: `"GET /poll"`, or `"/poll"` for every method of that route.
   * Their durations stay out of every speed reading — the score, Code Health,
   * resilience, the latency floor, load deflection, learned budgets, route
   * timings, slow-route alerts and traces — and are COUNTED instead: how many
   * calls were kept out and the longest wait are sent and shown. Errors and
   * in-flight counts are still recorded.
   *
   * `calls` — calls this app makes that wait on purpose, such as a bot
   * long-polling its messaging service. Written as the full address without
   * the query, with `:name` standing for a part that changes:
   * `"https://api.telegram.org/bot:token/getUpdates"`. Such a call never counts
   * as stalled however long it waits, and its duration stays out of the
   * network and outside-service readings and the traces; its failures still
   * count. The address is compared inside this process and never leaves it:
   * only counts are sent. Only calls made with Node's own `fetch` (undici)
   * are seen at all.
   *
   * Exact names only, at most 10 per list: a wildcard, a prefix, a pattern, a
   * host on its own or one of the kit's own routes is refused, with the reason
   * on the startup line. There is no threshold and no automatic recognition.
   */
  declaredWaits?: DeclaredWaitsOption;
}

interface ReqLike {
  method?: string;
  route?: { path?: string };
  baseUrl?: string;
  path?: string;
  originalUrl?: string;
  /** Raw request URL (present on bare `http.IncomingMessage`; Express also
   *  sets it). Used as the fallback label source for non-Express hosts. */
  url?: string;
  /** The Express application handling this request. Express sets it on every
   *  request; read ONCE, only to remember the handle so the framework can be
   *  asked for its whole route list later (see routeInventory.ts). */
  app?: unknown;
  /** Raw incoming headers (Express: values may be string | string[]). */
  headers?: Record<string, unknown> | undefined;
  /** Set by the middleware: the adopted-or-minted full-stack trace id. */
  boosthisTraceId?: string;
  /** Set by the middleware: elapsed-ms base adopted from the incoming request. */
  boosthisTraceElapsedBase?: number;
  /** Set by the middleware: THIS request's own span identity. Request-scoped,
   *  never ambient — see spanScope.ts on why a server cannot read a current
   *  span out of module state. */
  boosthisSpanId?: string;
  /** Set by the middleware: the caller's span identity, adopted from the
   *  incoming `x-boosthis-trace-parent` header. Adopt-or-DROP: absent or
   *  malformed leaves this undefined rather than inventing a caller. */
  boosthisParentSpanId?: string;
  /** Transport socket (bare http / Express). Read ONLY for the peer address,
   *  which is hashed into one anonymous sketch bit and retained nowhere. */
  socket?: { remoteAddress?: string };
  /** Set by the middleware: `performance.now()` at request start. */
  boosthisTraceStart?: number;
}

interface ResLike {
  on(event: "finish" | "close" | "drain", listener: () => void): unknown;
  /** Optional so non-Express carriers still typecheck; probed before use. */
  setHeader?: (name: string, value: string) => unknown;
  /** Read to gate the leakWatch body capture on content-type; probed. */
  getHeader?: (name: string) => unknown;
  statusCode?: number;
  writableEnded?: boolean;
  /** Present on http.ServerResponse / Express; probed before use. */
  end?: (body?: string) => unknown;
  /** Present on http.ServerResponse / Express; chained for leakWatch. */
  write?: (chunk?: unknown, ...rest: unknown[]) => unknown;
}

const NUMERIC_SEGMENT = /^\d+$/;
const UUID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX24 = /^[0-9a-f]{24}$/i;
// PII-shaped segments that must NEVER be recorded as a route label.
// Boosthis's privacy contract says route labels are non-PII; without this
// redaction a path like /users/alice@example.com would surface verbatim
// in /recent and the MCP context.
const EMAIL_LIKE = /@/;
const HANDLE_LIKE = /^[~@][A-Za-z0-9._-]+$/;
const LONG_TOKEN = /^[A-Za-z0-9_-]{24,}$/;
// Slug-like segments: hyphen- or underscore-separated words are almost always
// user- or org-generated identifiers (e.g. "john-smith", "acme-co",
// "my_project") rather than static route keywords.
const SLUG_SEGMENT = /[-_]/;
// Mixed-case segments (PascalCase / camelCase) indicate a developer-chosen
// identifier rather than a lowercase route keyword (e.g. "JaneDoe",
// "myUsername").
const MIXED_CASE_SEGMENT = /^(?=.*[A-Z])(?=.*[a-z])[A-Za-z0-9]+$/;
// Alphanumeric segments that mix letters and digits are typically user-generated
// IDs (e.g. "user123", "abc4def"). Pure-digit segments caught by NUMERIC_SEGMENT.
const ALPHANUM_ID_SEGMENT = /^(?=.*[0-9])(?=.*[A-Za-z])[A-Za-z0-9]+$/;
// Pure lowercase alphabetic (no digits, hyphens, etc.).  This pattern on its
// own covers both safe route keywords ("users", "billing") and opaque short
// usernames ("alice", "bob"). Without the Express route template we cannot
// tell which is which, so we gate on a strict allowlist and redact everything
// else. The allowlist is intentionally conservative: only vocabulary that
// legitimately appears as a *static* URL segment in a REST or HTTP API.
const PURE_LOWER_ALPHA = /^[a-z]+$/;

/**
 * Known-safe pure-lowercase route-keyword segments (3 or more characters).
 * Any pure-lowercase-alpha segment of 3+ chars NOT in this set is treated as
 * a potential user/org identifier and replaced with :id. Segments of 1-2 chars
 * (e.g. "u", "me") are left as-is — they are almost always route namespace
 * abbreviations, not usernames, and the information loss from redacting them
 * outweighs the risk.
 *
 * This is the correct privacy posture: Boosthis's contract requires route
 * labels to be non-PII, and there is no mechanical way to distinguish "alice"
 * (username) from "users" (keyword) without the Express route template.
 */
const SAFE_ROUTE_KEYWORDS = new Set([
  // versioning / top-level
  "api", "app", "web", "www",
  "v1", "v2", "v3", "v4", "v5",
  // health / observability
  "health", "healthz", "status", "ping", "ready", "live", "metrics",
  "stats", "analytics", "logs", "log", "errors", "debug", "trace", "info",
  // auth
  "auth", "oauth", "login", "logout", "signup", "signin", "register",
  "callback", "redirect", "verify", "confirm", "reset", "refresh",
  // common resource collections
  "users", "user", "accounts", "account", "profile", "profiles",
  "orgs", "org", "organizations", "organization",
  "teams", "team", "members", "member",
  "groups", "group", "roles", "role",
  "projects", "project", "workspaces", "workspace",
  "admin", "dashboard", "self",
  "customers", "customer", "clients", "client",
  "patients", "patient",
  "employees", "employee",
  "contacts", "contact",
  "records", "record",
  // commerce / billing
  "billing", "subscriptions", "subscription",
  "invoices", "invoice", "payments", "payment", "charges", "charge",
  "orders", "order", "products", "product",
  "items", "item", "catalog", "inventory",
  "coupons", "coupon", "discounts", "discount",
  // content
  "files", "file", "uploads", "upload", "downloads", "download",
  "attachments", "attachment", "images", "image", "media", "assets",
  "static", "public",
  "messages", "message", "conversations", "conversation", "chat",
  "notifications", "notification",
  "comments", "comment", "posts", "post",
  "pages", "page", "tags", "tag", "categories", "category",
  "labels", "label",
  // actions / generic segments
  "search", "filter", "sort", "index", "list",
  "settings", "config", "preferences",
  "create", "new", "edit", "update", "delete", "view", "show",
  "home", "about", "help", "support", "contact", "docs",
  "documentation", "reports", "report",
  // jobs / queues
  "jobs", "job", "tasks", "task", "queues", "queue", "events", "event",
  "webhooks", "webhook", "integrations", "integration",
  "services", "service", "rules", "rule",
  "policies", "policy", "permissions", "permission",
  "sessions", "session",
  // Boosthis-specific route segments
  "candidates", "resolutions", "installs", "samples",
  "consent", "forget", "mcp", "context", "budgets", "recent", "summary",
  "community", "fix", "fixes", "keys", "privacy", "terms",
]);

/** Convert /users/42/orders/acme-co → /users/:id/orders/:id, and redact
 * PII-shaped segments (emails, @handles, long tokens, hyphen/underscore slugs,
 * mixed-case identifiers, alphanumeric IDs, and any pure-lowercase word of 3+
 * characters not in the known-safe keyword allowlist).
 *
 * The allowlist fast-path fires first so version strings ("v1", "v2") and
 * other explicitly-safe keywords are always preserved, even if their shape
 * (e.g. mixing digits and letters) would otherwise match one of the redaction
 * patterns below.
 *
 * The allowlist approach for pure-lowercase segments is intentionally
 * conservative: Boosthis's privacy contract requires route labels to be
 * non-PII, and there is no mechanical way to distinguish a short username
 * ("alice") from a route keyword ("users") without the Express route template.
 * When the matched-route branch is used the template already supplies correct
 * `:param` placeholders; the fallback branch applies these rules to the raw
 * request path. Segments of 1-2 characters are left as-is (they are almost
 * always route namespace abbreviations, not usernames). */
export function normalizePath(path: string): string {
  return path
    .split("/")
    .map((seg) => {
      if (!seg) return seg;
      // Allowlist fast-path: known-safe route keywords are always preserved
      // regardless of their shape (e.g. "v1" contains a digit but must not be
      // redacted). This check fires before any pattern-based redaction.
      if (SAFE_ROUTE_KEYWORDS.has(seg)) return seg;
      if (NUMERIC_SEGMENT.test(seg)) return ":id";
      if (UUID_SEGMENT.test(seg)) return ":id";
      if (HEX24.test(seg)) return ":id";
      if (EMAIL_LIKE.test(seg)) return ":id";
      if (HANDLE_LIKE.test(seg)) return ":id";
      if (LONG_TOKEN.test(seg)) return ":id";
      if (SLUG_SEGMENT.test(seg)) return ":id";
      if (MIXED_CASE_SEGMENT.test(seg)) return ":id";
      if (ALPHANUM_ID_SEGMENT.test(seg)) return ":id";
      // Pure lowercase alpha, 3+ chars, not in allowlist → potential identifier.
      // Short segments (1-2 chars, e.g. "u", "s") are preserved: they are
      // overwhelmingly route namespace abbreviations, not usernames.
      if (PURE_LOWER_ALPHA.test(seg) && seg.length >= 3) return ":id";
      return seg;
    })
    .join("/");
}

/** Which of the three badge states the startup line should report. Read from
 *  the same resolver the badge injection uses, so the line and the badge can
 *  never tell different stories. Never throws. */
function badgeStateForStartupLine(option?: boolean): BadgeState {
  try {
    if (isBoosthisEnvDisabled()) return "switched-off";
  } catch {
    return "switched-off";
  }
  try {
    return resolveBubbleVisibility(option) ? "owner-only" : "hidden-by-setting";
  } catch {
    return "owner-only";
  }
}

export function boosthis(opts: BoosthisOptions = {}) {
  // Say ONE ungated line the moment the kit is switched on — before any key is
  // read and before any registration. It is the anchor for every diagnosis: no
  // line means this call never ran, and nothing about keys, networks or
  // previews matters until it does. Never silenced by a quiet mode, a privacy
  // setting or a switched-off badge; it reveals only a four-character tail of
  // a key the developer already holds.
  try {
    // Claim the line BEFORE a single key is read, so any refusal the resolve
    // below produces is held back and printed after it. The anchor line is
    // always the first thing a developer sees.
    beginStartAnnouncement();
    // Resolve through the SAME function registration uses, so the key the line
    // names is the key that will actually be registered — and so a value that
    // cannot be a key is refused out loud here, at the point it was supplied,
    // rather than silently coming to nothing.
    announceKitStart(
      resolveProjectKey(opts.projectKey).key,
      badgeStateForStartupLine(opts.bubble),
    );
    announceUnreadableSources();
    // ...and say so when the kit cannot find its own page markup. That failure
    // used to be swallowed by the `catch` around the file read, so a developer
    // saw an apology page with no explanation anywhere in their logs.
    announceMissingKitAssets();
  } catch {
    // evidence is never allowed to block measurement — but never swallow a
    // refusal that was only waiting for a line that is no longer coming.
    try {
      flushHeldRefusals();
    } catch {
      /* nothing more can be said */
    }
  }
  // Take the declared model endpoints before a single request is served, so
  // the very first AI call this app makes is already classified. Total by
  // construction: a bad entry is dropped, not thrown, and an app that declares
  // nothing is left exactly as it was.
  try {
    if (opts.aiEndpoints !== undefined) setDeclaredAiEndpoints(opts.aiEndpoints);
  } catch {
    /* a declaration can never stop the middleware being built */
  }
  // …and the waits declared on purpose, for the same reason: the very first
  // long-poll must already be kept out. Total, like the line above — a refused
  // name is said on the startup line and dropped, never thrown.
  try {
    if (opts.declaredWaits !== undefined) setDeclaredWaits(opts.declaredWaits);
  } catch {
    /* a declaration can never stop the middleware being built */
  }
  const rate = opts.rate ?? rateDuration;
  const fallback = opts.fallbackName ?? "unknown";
  // One property read, on the first request only. See the call site below.
  let appSeen = false;

  return function boosthisMiddleware(
    req: ReqLike,
    res: ResLike,
    next: () => void,
  ): void {
    // Kill-switch: pure pass-through. Never mint, echo, or record when the
    // whole runtime is silenced from outside the process.
    if (isBoosthisDisabled()) {
      next();
      return;
    }
    // DISSOLVED (docs/kit-lock-rule.md): the kit erased what it kept on this
    // machine and is gone. Every request reaches the app exactly as it would
    // without the kit: no owner link, no kit page or read, no bubble, nothing
    // measured. After a restart the kit asks once, from `enableTelemetry`, and
    // stays out of the way until the answer.
    if (isKitDissolved()) {
      next();
      return;
    }
    // Owner links and owner passes come first (ownerLink.ts): a link or an
    // address switch is answered with a redirect before the app sees it, and
    // only a browser holding a pass Boosthis confirmed counts as the owner's.
    // A request without a pass cookie settles at once, with no network call.
    let owner: OwnerVerdict | Promise<OwnerVerdict>;
    try {
      owner = settleOwnerRequest(req, res as OwnerRes);
    } catch {
      owner = false;
    }
    if (owner === "answered") return;
    if (typeof owner === "boolean") {
      serveRequest(req, res, next, owner);
      return;
    }
    owner.then(
      (o) => {
        if (o !== "answered") serveRequest(req, res, next, o);
      },
      () => serveRequest(req, res, next, false),
    );
  };

  function serveRequest(
    req: ReqLike,
    res: ResLike,
    next: () => void,
    owner: boolean,
  ): void {
    // Read once for this request. A lock never changes what the app answers:
    // it only takes the kit out of the way (below, after the kit's own reads,
    // which answer the renew notice to the people who could open them before).
    const locked = isKitLocked();
    if (!locked) {
      noteQueueStartHeader(
        req.headers?.["x-request-start"] ?? req.headers?.["x-queue-start"],
      );
    }

    // Bubble pulse endpoint — served directly by the middleware so the
    // injected badge works with `app.use(boosthis())` alone (no mount()
    // required). Deliberately ungated: the shape is closed and coarse
    // ({score, rating, sampleCount} — never route labels or durations).
    // Answered BEFORE the sampler wires up, so bubble polling never pollutes
    // the meters it displays.
    try {
      const rawPath = (req.url ?? req.originalUrl ?? "").split("?")[0];
      const isGet = (req.method ?? "GET").toUpperCase() === "GET";
      // The three paths THIS door has always answered. What each one returns
      // — status, body and gate — is decided in kitAnswers.ts, the one place
      // every door dispatches to, so the mounted route and the framework-free
      // attach can never answer the same read differently.
      //
      //   /pulse and /panel are closed, coarse, ungated reads for the bubble.
      //   /panel adds the dashboard-first meter rows (scores, ratings, labels,
      //   captions — never routes, URLs, or raw samples).
      //
      //   /status is the standalone "is Boosthis working?" page, served here
      //   (not only from mount()) because the app this exists for — a back-end
      //   API with no UI — typically wires up `app.use(boosthis())` and
      //   nothing else. STRICT loopback only, so installing the kit never adds
      //   a publicly readable surface.
      //
      // Answered BEFORE the sampler wires up, so bubble polling never pollutes
      // the meters it displays.
      const suffix =
        isGet && typeof res.end === "function"
          ? kitReadSuffixFor(rawPath)
          : null;
      // Owners only (owner decision, 4 Oct 2026): every kit read answers a
      // browser holding a confirmed owner pass or the machine itself; anyone
      // else gets the app's own answer for an unknown address.
      const ownerOrMachine = owner || isDirectLoopback(req);
      if (suffix !== null && MIDDLEWARE_SERVED.has(suffix)) {
        const answer = answerKitRead(suffix, {
          loopback: isDirectLoopback(req),
          owner,
        });
        if (answer && writeRawKitAnswer(res as RawResLike, answer)) return;
      } else if (suffix !== null && ownerOrMachine && !areKitPathsRegistered()) {
        // A kit-owned path that NO door in this process serves. Until now this
        // fell through to the host's own 404 — byte-identical to having no kit
        // installed at all — for every read `mount(app)` registers, the
        // advertised `/_boosthis` page included. The kit is here, it is
        // measuring, and it can say so; what it must not do is claim a page it
        // does not have, so the reply is still a 404, with our body and the
        // real reason in it.
        //
        // Never reached once mount() or attach() has run: both record their
        // base, and the branch above answers the three paths this door owns.
        const answer = answerUnmountedKitRead(suffix, {
          elsewhere: registeredKitBasePaths()[0],
        });
        if (answer && writeRawKitAnswer(res as RawResLike, answer)) return;
      }
    } catch {
      // swallow — fall through to normal handling.
    }

    // One request, one set of numbers. When the framework-free attach is in
    // play it has ALREADY observed this request at the Node boundary and is
    // holding the meters open for it; an Express app that also calls
    // `app.use(boosthis())` must not start a second measurement of the same
    // visit. The claim is process-wide, so a duplicate copy of the kit in the
    // dependency tree defers here too.
    if (claimRequest(req) === "already") {
      next();
      return;
    }

    // Bubble injection — wrap write/end so HTML pages carry the floating
    // badge's script, ONLY for a browser holding a confirmed owner pass or the
    // machine itself after `?boosthis=on`. A visitor's page is never touched.
    // Fail-open by construction (see bubble.ts); never crashes the host and
    // never touches non-HTML/compressed/streamed responses.
    if (resolveBubbleVisibility(opts.bubble) && ownerMayHaveBubble(req, owner)) {
      try {
        wrapResponseForInjection(res as Parameters<typeof wrapResponseForInjection>[0]);
      } catch {
        // swallow — instrumentation must never take down the host.
      }
    }

    // LOCKED (docs/kit-lock-rule.md): the owner's bubble above still carries the
    // renew notice, and nothing else happens. No trace header is added, no
    // listener is put on the response, nothing is counted: the app answers
    // exactly as it would without the kit.
    if (locked) {
      next();
      return;
    }

    // Adopt-or-mint the full-stack trace id and echo it back synchronously —
    // BEFORE next() — so the header is set while it's still legal to write
    // headers (setting it in the finish/close listener throws
    // ERR_HTTP_HEADERS_SENT). All of this is best-effort: a bad header or a
    // non-Express carrier must never crash the host.
    // The action this request IS, held for the downstream call below so a
    // crash can name it. Null when the block after this failed to mint one.
    let requestAction: SpanHandle | null = null;
    try {
      const traceId = adoptTraceId(req.headers?.[TRACE_HEADER]);
      req.boosthisTraceId = traceId;
      // Adopt the elapsed base (how long after the trace root started this hop
      // was reached). A malformed/missing value degrades to 0 — never re-mints.
      req.boosthisTraceElapsedBase = sanitizeTraceElapsed(
        req.headers?.[ELAPSED_HEADER],
      );
      // Causality: adopt the CALLER's span id (adopt-or-drop — a malformed one
      // is discarded rather than re-minted, because a re-minted parent would
      // name a call that never happened), and mint this request's own identity
      // so anything it calls onward can point back at it. Both live on the
      // request object, never in module state: this process may be handling a
      // hundred other requests at the same moment.
      const parentSpanId = adoptParentSpanId(req.headers?.[PARENT_HEADER]);
      // Carries the trace id as well as the causality pair, so the scope
      // opened around the downstream call below can answer "which ACTION am
      // I in" — the question a crash asks.
      const requestSpan = beginSpan({ parentSpanId, traceId });
      requestAction = requestSpan;
      req.boosthisSpanId = requestSpan.spanId;
      if (parentSpanId !== null) req.boosthisParentSpanId = parentSpanId;
      if (typeof res.setHeader === "function") {
        res.setHeader(TRACE_HEADER, traceId);
      }
    } catch {
      // swallow — instrumentation must never take down the host.
    }

    // Idle-burn boundary: mark that a request is now in flight. Detects any
    // event-loop burn that happened during the just-ended idle window.
    noteRequestStart();
    // FUNCTION HOSTS: arm on first use. There is no "start-up" on a platform
    // that freezes the process the moment it answers — the first request IS the
    // start-up, and this is the only moment we are certain the runtime is
    // thawed. A no-op on an ordinary long-running server.
    // Charged to our own footprint, on the same clock the published per-run
    // ceiling is judged against. Nothing of the customer's is inside the block.
    // THIS REQUEST'S own boundary, held in the request's own scope. A container
    // billed like a function serves many requests at once by default, so a run
    // boundary kept in a module variable would be overwritten by whichever
    // request arrived next and closed by whichever answered first.
    const run = beginInvocation();
    chargeRunOverhead(() => {
      // FUNCTION HOSTS: watch for a kill we can see coming. Express hands us no
      // platform context, so there is no live countdown here and only the memory
      // half arms — the time half needs a handler-shaped host and gets it from
      // `withBoosthis`. Passing null rather than an elapsed-time guess is the
      // point: a warning invented from a limit nobody told us is how a
      // monitoring agent starts reporting deaths that never happened.
      armRunDeathWatch(null, run);
    }, run.kit);
    // Load-deflection boundary: reuse this SAME request boundary (no second
    // hook) to note how many requests are in flight AT START. One integer
    // increment; the matching end files this request's duration by that count.
    const deflectionStartInFlight = noteDeflectionStart();
    // Repeated-work boundary: open the scope every watched call inside this
    // request files into. The TOKEN is held here so the close always pairs
    // with the open (the finish/close listener runs outside the async
    // context); a declined open returns null and makes the close a no-op.
    const workScope: RequestWorkScope | null = beginRequestWork();
    // Trace propagation: hand this request to the scope every watched outbound
    // call already looks into, so the outbound observer can forward THIS hop's
    // trace headers to the next service without the developer attaching them by
    // hand at every call site. The observer decides whether the destination is
    // allowed to receive them (see tracePropagation.ts) and, if the answer is
    // no, nothing about the outgoing request changes.
    if (workScope) workScope.trace = req;
    // Linked steps: the database and outside-service calls made inside this
    // request, folded by word and sent beside its own step (linkedSteps.ts).
    // Opened on the same scope, so the same one async context carries them.
    if (workScope) workScope.linked = openLinkedScope();
    // Database-work boundary: arm observation of the Postgres client the app
    // ALREADY loaded. Done here, not at import, for two reasons — importing the
    // kit then costs nothing until the app actually serves traffic, and a
    // driver the app requires lazily on its first request is still caught.
    // Self-guarded, throttled, and a no-op once the client is watched.
    armDbClients();
    // AI-call boundary: arm observation of the AI provider calls this app
    // makes. Armed here for the same two reasons as the database clients —
    // importing the kit costs nothing until the app actually serves traffic,
    // and an SDK the app loads lazily on its first request is still caught.
    // Self-guarded, idempotent, and a no-op under the kill-switch. A call to
    // anything that is not on the kit's maintained provider list is passed
    // straight through, untouched and unrecorded.
    armAiCalls();

    // Realtime boundary: offer this response to the long-lived-connection
    // watcher. Only a server-sent stream is adopted, and only on its first
    // write, so an ordinary request pays one property read. WebSocket upgrades
    // never reach here — they are caught at the server's own upgrade event.
    noteResponseForRealtime(req, res);
    // Same boundary, same reasoning, for the job systems: a queue library or
    // scheduler the app required lazily is caught here. A worker process that
    // never serves a request arms at start-up instead (see enableTelemetry).
    armJobSystems();
    // backpressure meter — a 'drain' event on the response means its socket
    // write buffer filled at least once (the receiver couldn't keep up).
    // Purely passive listener; boolean only, nothing about the payload.
    let sawBackpressure = false;
    try {
      res.on("drain", () => {
        sawBackpressure = true;
      });
    } catch {
      /* never let meter wiring disturb the host response */
    }

    // leakWatch response path (2026-08): piggyback the EXISTING response
    // wrapper — chain res.write/res.end to buffer AT MOST the first 8192 bytes
    // of the body so a finish-time scan can detect the CUSTOMER app leaking a
    // stack trace / secret / personal detail to its own users. The buffer is a
    // bounded local that is DISCARDED immediately after the finish scan; the
    // body text, the matched value, and the path NAME are NEVER stored, logged,
    // or put in any field. Monitor-only, fully self-guarded, never alters host
    // output. Only the coarse route CLASS (closed {api,page,asset,other}) and
    // counters/timestamps ever survive the scan.
    // cookieExposure (2026-08): the outgoing Set-Cookie header, captured on
    // the SAME response wrapper the leak scan already installs (never a second
    // wrapper). Captured at end() because that is the last moment the header
    // map is guaranteed readable; the value lives only in this local and is
    // handed straight to the counter, which retains nothing.
    let cookieHeader: string | number | string[] | undefined | null = null;
    // corsExposure: the cross-origin answer on this SAME response, decided at
    // the same moment and from the same header map. Only the four booleans of
    // its shape survive the comparison — the request's Origin and both header
    // values stay on classifyCorsAnswer's stack. `undefined` = not looked yet;
    // `null` = this host gave no header map to look at.
    let corsShape: CorsAnswerShape | null | undefined = undefined;
    const captureCookieHeader = (): void => {
      try {
        if (corsShape === undefined) {
          corsShape =
            typeof res.getHeader === "function"
              ? classifyCorsAnswer(
                  req.headers?.origin,
                  res.getHeader("access-control-allow-origin"),
                  res.getHeader("access-control-allow-credentials"),
                )
              : null;
        }
      } catch {
        corsShape = null;
      }
      try {
        if (cookieHeader !== null) return;
        cookieHeader =
          typeof res.getHeader === "function"
            ? (res.getHeader("set-cookie") as
                | string
                | number
                | string[]
                | undefined)
            : undefined;
      } catch {
        cookieHeader = undefined;
      }
    };
    // THE CAP IS IN BYTES, AND IT IS APPLIED BEFORE THE BODY IS DECODED.
    // We publish "up to the first 8,192 bytes of an error response", which is
    // two promises: how much is looked at, and how much is taken out of the
    // host's response to look at it. Counting characters kept neither — a
    // page of three-byte characters put 24 KB through the classifier, and a
    // whole multi-megabyte Buffer was decoded into a string before anything
    // was cut off it. Both are now bounded the way the Go and Java kits bound
    // them: the bytes are cut first, and `leakBufLen` counts bytes.
    const LEAK_BODY_CAP = 8192;
    let leakChunks: string[] | null = [];
    let leakBufLen = 0; // BYTES taken so far — never characters
    // AND IT IS A BOUND ON ERROR RESPONSES ONLY, DECIDED BEFORE THE FIRST BYTE.
    // We publish that this reads an ERROR response. Buffering every response
    // and throwing the healthy ones away at finish keeps the FINDING inside
    // that sentence but not the READ, which is the half the claim is about:
    // a 200 page was copied 8 KB at a time for a scan that never ran. The
    // status is settled by the time a body is written — writing it commits
    // the status line — so the decision is made once, here, the way the Go
    // kit has always made it.
    let leakDecided = false;
    const appendLeakChunk = (chunk: unknown): void => {
      try {
        if (leakChunks === null || leakBufLen >= LEAK_BODY_CAP) return;
        if (!leakDecided) {
          leakDecided = true;
          const status =
            typeof res.statusCode === "number" ? res.statusCode : 0;
          if (status < 400) {
            leakChunks = null; // a healthy response is never read at all
            return;
          }
        }
        if (chunk == null) return;
        const remaining = LEAK_BODY_CAP - leakBufLen;
        let s: string;
        let taken: number;
        if (typeof chunk === "string") {
          if (chunk === "") return;
          s = utf8BytePrefix(chunk, remaining);
          taken = Buffer.byteLength(s, "utf8");
          if (taken === 0) {
            // What is left of the allowance cannot hold another whole
            // character, so there is nothing further of this response we are
            // allowed to read. Close the buffer instead of offering the same
            // few bytes to every chunk that follows — that is how a read
            // bounded at 8,192 bytes ends up allocating a little more.
            leakBufLen = LEAK_BODY_CAP;
            return;
          }
        } else if (chunk instanceof Uint8Array || Buffer.isBuffer(chunk)) {
          // Cut the BYTES, then decode: a 4 MB error page must not become a
          // 4 MB string on the way to reading 8 KB of it.
          const view = chunk as Uint8Array;
          taken = Math.min(view.byteLength, remaining);
          s = Buffer.from(view.subarray(0, taken)).toString("utf8");
        } else return; // unknown chunk shape — skip (never guess)
        leakChunks.push(s);
        leakBufLen += taken;
      } catch {
        /* buffering must never disturb the host response */
      }
    };
    try {
      const origWrite = res.write;
      if (typeof origWrite === "function") {
        res.write = function boosthisLeakWrite(
          this: unknown,
          chunk?: unknown,
          ...rest: unknown[]
        ): unknown {
          appendLeakChunk(chunk);
          return (origWrite as (...a: unknown[]) => unknown).call(
            res,
            chunk,
            ...rest,
          );
        };
      }
      const origEnd = res.end;
      if (typeof origEnd === "function") {
        res.end = function boosthisLeakEnd(
          this: unknown,
          chunk?: unknown,
          ...rest: unknown[]
        ): unknown {
          // A string/Buffer first arg is body; a function first arg is the
          // callback (no body) — only buffer real body chunks.
          if (typeof chunk !== "function") appendLeakChunk(chunk);
          captureCookieHeader();
          // FUNCTION HOST WITH NO AFTER-RESPONSE MECHANISM: this is the last
          // moment that still exists. Record this request and finish sending
          // BEFORE the response completes, because a function adapter resolves
          // on the response's own completion and the platform freezes the
          // invocation there — a flush started on `finish` would be racing a
          // freeze it cannot win. Deliberately reusing this wrapper rather than
          // adding a second one: one wrapper, one ordering, no chance of two
          // wrappers disagreeing about which runs first.
          if (!heldForFlush && needsFlushBeforeResponse()) {
            heldForFlush = true;
            // `end()` was called: this response is being sent, which is the
            // completion `finish` would otherwise announce. On a function
            // host that announcement may never arrive, so it is taken here.
            responseCompleted = true;
            const done = (): unknown =>
              (origEnd as (...a: unknown[]) => unknown).call(
                res,
                chunk,
                ...rest,
              );
            // finalize() records the request and returns the bounded flush.
            // Both halves are self-guarded and neither can throw, but the
            // response is released even if something impossible happens.
            void Promise.resolve()
              .then(() => finalize())
              .catch(() => {})
              .then(done);
            // The host's `end()` contract is synchronous in its return value:
            // hand back the response object, as Node and Express both do.
            return res;
          }
          return (origEnd as (...a: unknown[]) => unknown).call(
            res,
            chunk,
            ...rest,
          );
        };
      }
    } catch {
      /* never let leak-scan wiring disturb the host response */
    }

    const start = performance.now();
    // The one line that makes an Express app's whole route list readable with
    // no developer work at all: Express hands its own application object to
    // every request, so the first request tells us where the route table is.
    // This is a property read and a null check — nothing is walked here; the
    // table is read later, when a snapshot is captured, off the request path.
    if (!appSeen) {
      appSeen = true;
      try {
        registerApp(req.app);
      } catch {
        /* never let route-list wiring disturb the host response */
      }
    }
    // Record request-start so forwardTraceHeaders can advance the elapsed chain
    // to the next hop (base + time-in-this-process).
    req.boosthisTraceStart = start;
    // The linked steps measure their offsets from the same instant the
    // request's own duration is measured from.
    if (workScope?.linked) workScope.linked.openedAt = start;
    const method = req.method ?? "GET";
    let recorded = false;
    // Set once the `res.end` wrapper below has already recorded this request
    // and run the flush, so the `finish`/`close` listeners do not repeat it.
    let heldForFlush = false;
    // Did a response actually COMPLETE? `finalize()` runs on `finish` and on
    // `close`, and a client that hangs up mid-request fires only `close` —
    // with `res.statusCode` still at Node's default 200. Timing still counts
    // that request (the work happened), but the failure reading may not: an
    // answer nobody received is not an answer this app gave, and filing it as
    // a 2xx would dilute the rate of a route that really is failing.
    let responseCompleted = false;

    const finalize = () => {
      // Listen on both `finish` (normal response) and `close` (client
      // aborted / socket closed before flush). Either can fire first, and
      // sometimes both fire — we only record once so aborted requests
      // count exactly once and successful requests don't double-count.
      if (recorded) return;
      recorded = true;
      // What the KIT costs this request, charged to our own published
      // footprint. Deliberately measured here and not around the upload: the
      // upload has its own budget and is reported separately, because one is
      // unavoidable instrumentation and the other is a network call we chose
      // to make. Conflating them would let us hide behind the smaller number.
      // Timed with BOTH clocks. A container billed per request-second has its
      // processor frozen the moment the response is sent — which is exactly
      // when this listener runs — so a wall-clock delta here charges the
      // platform's nap to us unless the processor clock is read alongside it
      // (docs/kit-footprint-suspend-2026-09.md).
      const kitWork = openKitInterval();
      // Duration is computed up-front (outside the recording try) so the
      // guaranteed-exit `finally` can hand it to the load-deflection end even
      // if anything in the body throws.
      const duration = performance.now() - start;
      // Held-open stream? A server-sent-events response (or a replacing frame
      // feed) stays open for as long as the client wants it, so its "duration"
      // is the client's patience, not the app's speed. Decided ONCE here, from
      // the same predicate liveConnections uses to adopt a stream, and applied
      // to all three latency-family consumers below. Contract:
      // docs/held-open-calls.md.
      const heldOpen = isHeldOpenCall(req, res);
      if (heldOpen) noteHeldOpenExcluded(duration);
      // A route the developer DECLARED as waiting on purpose — a long-poll
      // that answers only when there is news (declaredWaits.ts, contract in
      // docs/held-open-calls.md). Given exactly the held-open treatment
      // wherever a duration would be read, and decided below, once the route
      // label is known. A stream is counted once, as a stream. Unlike a
      // stream, its answer is an answer: its status still counts.
      let declaredWait = false;
      // Whether the request carried an Authorization header — presence only,
      // read once below and shared by the refusal-honesty count and the
      // sample's door word (routeDoor.ts). Null until read, and left null
      // when the request has no readable header table: "cannot tell".
      let authPresence: boolean | null = null;
      // Wrap the whole body: a custom `rate()` or a downstream `record()`
      // implementation must never crash the host app via a `finish`/`close`
      // listener. Boosthis is opt-in instrumentation; failure here should
      // be silent, not fatal.
      try {
        // Runtime-vitals boundary: bump reliability counters + sample
        // memory once per finished request. Best-effort in the guard.
        noteRequest(
          typeof res.statusCode === "number" ? res.statusCode : undefined,
        );
        // accessPressure (2026-08): count this response's OUTCOME class
        // (rejected / not-found / server-error) plus the per-minute rate on
        // the SAME boundary — no second hook. The peer address is handed
        // straight to the counter, which hashes it into one anonymous sketch
        // bit inside its own stack and retains it nowhere (see extraMeters).
        //
        // Third argument (2026-09): did the app's OWN routing choose this
        // answer? `req.route` is filled by Express when a registered route
        // handled the request, so a 404 or 403 coming back through it is the
        // app's protocol vocabulary rather than someone trying doors. Three
        // states, not two — `undefined` where the host has no route table at
        // all (a bare `http.createServer` handler), which the counter files
        // apart and publishes rather than guessing. The value is read below
        // anyway for the sample label; nothing extra is walked here.
        try {
          const routeMatched =
            typeof (req as { route?: unknown }).route === "object" &&
            (req as { route?: unknown }).route !== null
              ? true
              : typeof (req as { app?: unknown }).app === "function" ||
                  (typeof (req as { app?: unknown }).app === "object" &&
                    (req as { app?: unknown }).app !== null)
                ? false
                : null;
          noteAccessOutcome(
            typeof res.statusCode === "number" ? res.statusCode : undefined,
            req.socket?.remoteAddress,
            routeMatched,
          );
        } catch {
          /* meters must never disturb the host */
        }
        // refusalHonesty: presence-only reads at this SAME finished-response
        // boundary. No header value is retained, logged, hashed, or emitted.
        try {
          authPresence = authorizationPresence(req);
          const authorizationPresent = authPresence === true;
          let canReadResponseHeaders = typeof res.getHeader === "function";
          let challengeHeader: unknown;
          if (canReadResponseHeaders) {
            try {
              challengeHeader = res.getHeader!("www-authenticate");
            } catch {
              canReadResponseHeaders = false;
            }
          }
          const challengePresent = Array.isArray(challengeHeader)
            ? challengeHeader.some((v) => typeof v === "string" && v.length > 0)
            : (typeof challengeHeader === "string" && challengeHeader.length > 0) ||
              (typeof challengeHeader === "number" && Number.isFinite(challengeHeader));
          noteRefusalHonesty(
            typeof res.statusCode === "number" ? res.statusCode : undefined,
            authorizationPresent,
            challengePresent,
            canReadResponseHeaders,
          );
        } catch {
          /* presence-only refusal counting must never disturb the host */
        }
        // Prefer the matched Express route pattern (e.g. "/users/:id");
        // fall back to a normalized request path so we still bucket samples
        // even when the route wasn't registered or 404'd. The fallback path
        // is also PII-redacted (emails, @handles, long tokens → :id).
        const matched = req.route?.path;
        // baseUrl is the resolved mount path of the parent router. When the
        // host app mounts a sub-router at a parameterised path like
        // `/org/:orgId`, Express fills `req.baseUrl` with the *concrete*
        // value (e.g. `/org/alice@example.com`). Without normalization that
        // PII would land in samples + MCP context, defeating the same
        // contract the fallback branch enforces. Normalize both halves.
        const baseUrl = normalizePath(req.baseUrl ?? "");
        let pathLabel: string;
        if (matched) {
          pathLabel = `${baseUrl}${matched}`;
        } else {
          // Bare `http.createServer` hosts have no Express `req.path` /
          // `req.originalUrl`, but they DO have `req.url` — prefer it over the
          // configured fallback name so plain-Node apps keep real (redacted)
          // route buckets instead of collapsing everything into one label.
          const raw = req.path ?? req.originalUrl ?? req.url ?? fallback;
          const noQuery = raw.split("?")[0];
          let normalized = normalizePath(noQuery);
          // The server's route-label guard only exempts the canonical
          // "METHOD /path" shape (leading slash required) from its
          // space-contains heuristic. A fallback label without a leading "/"
          // (e.g. a fallbackName like "worker") would be silently dropped
          // server-side, so force the path half into the canonical shape.
          if (!normalized.startsWith("/")) normalized = `/${normalized}`;
          pathLabel = normalized;
        }
        // The request path may be derived differently for matched and
        // unmatched requests, but the resulting part name uses the inventory's
        // one bound/refusal rule.
        const label = routeLabel(method, pathLabel);
        // Matched against the route as the dashboard shows it — the label, or
        // the path alone where no label could be formed (the latency floor and
        // load deflection below read the duration either way) — and against
        // the request's own path, for a server with no route table, whose
        // shown route is redacted (`/poll` shows as `/:id`). The path is
        // compared there and never kept.
        declaredWait =
          !heldOpen &&
          noteDeclaredRouteCall(
            method,
            label ?? pathLabel,
            duration,
            req.originalUrl ?? req.url,
          );
        // A held-open stream is not a request, so it is never filed as one:
        // no sample, therefore nothing reaching the summary that resilience
        // reads. It is counted instead (noteHeldOpenExcluded above) and the
        // count rides the axis, so the exclusion is visible, not silent. A
        // declared wait is counted the same way (noteDeclaredRouteCall), and
        // its count rides the snapshot's declaredWaits block.
        if (!heldOpen && !declaredWait && label !== null) {
          // The start-up rule: the request-scoped meters (database, outside
          // services, repeated work) never grade a route's first request.
          // How the app answered a request with no credentials (routeDoor.ts):
          // one closed word riding this sample's upload, or none. Read inside
          // its own guard — `res.statusCode` is the host's property.
          let door: DoorWord | null = null;
          try {
            door = doorWordFor(method, authPresence, responseCompleted, res.statusCode);
          } catch {
            door = null;
          }
          noteRouteFirst(
            workScope,
            isRouteFirst(recordWithDoor(label, duration, rate(duration), door)),
          );
        }
        // The SAME label, beside the status this function already read. No new
        // observation: the pair was in hand and used to be discarded, which is
        // why every colour on the project map could only ever mean "slow".
        // 5xx is the only class counted as a failure here (see routeOutcomes.ts).
        // The status read is inside the try: `res.statusCode` is the HOST's
        // property and a host is entitled to define it as a throwing getter.
        // A kit must never take down the app it measures for want of a count.
        // Only a response that COMPLETED is an answer this app gave: a
        // client that hung up mid-request reaches here through `close`
        // alone, carrying Node's default 200, and counting it would credit
        // the route with an answer nobody received.
        try {
          if (!heldOpen && responseCompleted && label !== null) {
            noteRouteOutcome(label, res.statusCode);
          }
        } catch {
          // swallow — instrumentation must never take down the host.
        }
        // MCP per-tool breakdown (auto for HTTP): a `POST <any-path>/mcp` request also
        // records ONE bounded `mcp.*` sample when a parsed JSON-RPC body is
        // available on the request (e.g. express.json ran). Labels are a
        // CLOSED set — protocol allowlist + the developer-registered tool
        // roster; everything else buckets to `other` (see mcpMeasure.ts).
        // Tool ARGUMENTS are never read. 5xx responses land under the
        // `.error` label so per-tool error rate is visible.
        //
        // Held-open responses are excluded here too. This sample carries the
        // RESPONSE's lifetime and lands in the same buffer the summary and
        // resilience read, so an SSE reply to POST /mcp would be counted as
        // excluded on the route label and still contaminate the tail through
        // its `mcp.*` twin. A tool timed by hand (measureMcpTool) times the
        // tool's own work, not the stream, and is unaffected.
        try {
          if (!heldOpen && !declaredWait && method.toUpperCase() === "POST") {
            const mcpPath = (
              req.path ?? req.originalUrl ?? req.url ?? ""
            ).split("?")[0];
            if (isMcpPath(mcpPath)) {
              const body = (req as { body?: unknown }).body;
              const mcpLabel = mcpAutoLabel(body);
              if (mcpLabel) {
                const failed =
                  typeof res.statusCode === "number" && res.statusCode >= 500;
                recordMcpSample(mcpLabel, duration, failed);
              }
            }
          }
        } catch {
          // swallow — instrumentation must never take down the host.
        }
        // Latency-floor meter: fold this request's duration into the current
        // fixed-length window so the worst window's p95 is never averaged away.
        if (!heldOpen && !declaredWait) recordLatencySample(duration, label);
        // backpressure + cluster worker-imbalance meters (counts only). The
        // load-deflection END is handled in the finally below — NOT here — so
        // its in-flight decrement pairs with the start on EVERY exit path,
        // including a throw anywhere above in this try.
        try {
          noteResponseBackpressure(sawBackpressure, duration);
          noteWorkerRequest();
        } catch {
          /* meters must never disturb the host */
        }
        // cookieExposure: hand the outgoing Set-Cookie header to the
        // counter ONCE per finished response. Counts flags only — the cookie
        // name, its value and the route are never stored (see extraMeters).
        try {
          captureCookieHeader();
          noteCookiesFromResponse(cookieHeader);
          cookieHeader = null;
        } catch {
          /* cookie counting must never disturb the host */
        }
        // corsExposure: the shape captured beside the cookie header, counted
        // ONCE per finished response. Booleans in, counts out — never an
        // origin, a host or a route (see extraMeters).
        try {
          noteCorsAnswer(corsShape ?? null);
          corsShape = undefined;
        } catch {
          /* cross-origin counting must never disturb the host */
        }
        // Cache instructions on this app's OWN reply — the repeat-fetch story
        // from the sending side. Three headers on a finished GET 200:
        // `Cache-Control` matched against fixed directive words, `ETag` and
        // `Last-Modified` read for PRESENCE only. No value is retained, and
        // the route, path and body are never consulted (see cacheDirectives).
        try {
          if (typeof res.getHeader === "function") {
            noteResponseCacheHeaders({
              method: req.method,
              statusCode: res.statusCode,
              cacheControl: res.getHeader("cache-control"),
              etag: res.getHeader("etag"),
              lastModified: res.getHeader("last-modified"),
            });
          }
        } catch {
          /* cache-directive counting must never disturb the host */
        }
        // leakWatch finish-time scan: ONLY when the response is an error
        // (status >= 400) and the content-type is text/html, text/plain,
        // application/json, or ABSENT — exactly the error pages a customer app
        // renders to its own users. Scan the bounded buffer, record only a
        // category + coarse route class, then DISCARD the buffer immediately.
        try {
          const chunks = leakChunks;
          leakChunks = null; // stop buffering + drop the reference right away
          const status =
            typeof res.statusCode === "number" ? res.statusCode : 0;
          if (chunks && chunks.length > 0 && status >= 400) {
            let ctype = "";
            try {
              const raw =
                typeof res.getHeader === "function"
                  ? res.getHeader("content-type")
                  : undefined;
              ctype = (Array.isArray(raw) ? raw[0] : String(raw ?? ""))
                .toLowerCase();
            } catch {
              ctype = "";
            }
            const ctOk =
              ctype === "" ||
              ctype.includes("text/html") ||
              ctype.includes("text/plain") ||
              ctype.includes("application/json");
            if (ctOk) {
              // Body slice lives ONLY on this stack; discarded on return.
              // The buffer was already bounded to LEAK_BODY_CAP BYTES as it
              // was written, so this prefix takes nothing further off it in
              // practice; it is kept as the last line of defence, in the same
              // unit as the published bound.
              const body = utf8BytePrefix(chunks.join(""), LEAK_BODY_CAP);
              const acceptRaw = req.headers?.["accept"];
              const accept = Array.isArray(acceptRaw)
                ? String(acceptRaw[0] ?? "")
                : typeof acceptRaw === "string"
                  ? acceptRaw
                  : undefined;
              const rc = leakRouteClass(
                (req.path ?? req.originalUrl ?? req.url ?? "").split("?")[0],
                accept,
              );
              noteLeakFromResponse(body, rc);
            }
          }
        } catch {
          /* leak scan must never disturb the host */
        }
        // Full-stack trace (Stage 2): emit ONE privacy-safe span keyed by the
        // request's trace id, reusing the SAME code-defined label the sampler
        // just recorded (ids already redacted by normalizePath). enqueueSpan is
        // inert until the span submitter is wired (sharing authorized) and is a
        // no-op under the kill-switch, so a private app buffers nothing.
        const traceRouteLabel = label === null ? null : spanLabel(label);
        // The request's LINKED STEPS (linkedSteps.ts), closed here whether or
        // not its own step is sent, so a call still in flight is never linked
        // to a request that has already answered. They travel only with
        // their request's own step, and never without one.
        const linkedFolds = closeLinkedScope(workScope?.linked);
        const traceIdForSpan = sanitizeTraceId(req.boosthisTraceId);
        const linkedSpans =
          traceRouteLabel !== null && linkedFolds.length > 0 && req.boosthisSpanId
            ? linkedStepSpans(linkedFolds, {
                traceId: traceIdForSpan,
                layer: "node",
                parentSpanId: req.boosthisSpanId,
                baseOffsetMs: req.boosthisTraceElapsedBase ?? 0,
              })
            : undefined;
        if (traceRouteLabel !== null) enqueueSpan({
          traceId: traceIdForSpan,
          layer: "node",
          routeLabel: traceRouteLabel,
          durationMs: Math.round(duration),
          // Offset from the trace root = the elapsed base adopted on receive
          // (this hop began when the caller sent, per the chained deltas).
          startOffsetMs: req.boosthisTraceElapsedBase ?? 0,
          rating: rate(duration),
          // Causality pair, both set above. `parentSpanId` is undefined when
          // the caller sent none — the span is then top-level, which is a
          // different (and honest) thing from detached.
          spanId: req.boosthisSpanId,
          parentSpanId: req.boosthisParentSpanId,
          // What kind of work this leg was, and whether it worked. The Node
          // kit emits exactly one span per handled request, so the kind is
          // always `handler`: the app's own code answering something. The
          // outcome is read from the status the host actually sent — a 404 or
          // a 401 is the app doing what it was asked, only a 5xx (or a throw
          // the framework turned into one) is the work itself failing. It is
          // NOT the rating: a fast 500 is `poor`-free and still an error.
          kind: "handler",
          outcome: outcomeForStatus(
            typeof res.statusCode === "number" ? res.statusCode : null,
          ),
          // A declared wait still sends its step, marked, so the trace page
          // shows the route waited on purpose instead of drawing it as the
          // slow part of the request (the server keeps it out of every
          // duration figure it builds from steps).
          wait: declaredWait ? "declared" : undefined,
        }, linkedSpans);
      } catch {
        // swallow — instrumentation must never take down the host.
      } finally {
        // GUARANTEED-EXIT: the load-deflection end runs on EVERY path out of
        // the recording body (normal completion, early return, or a throw
        // caught above), so its in-flight decrement always pairs with the
        // start counted in this request. It is itself fully self-guarded and
        // decrements unconditionally for a counted start.
        noteDeflectionEnd(deflectionStartInFlight, duration, heldOpen || declaredWait);
        // GUARANTEED-EXIT (same reasoning): close the repeated-work scope on
        // every path out, folding this request's identical-call counts into
        // the session totals. Self-guarded, and a no-op when the open was
        // declined — the pair can never half-run.
        //
        // Read the run's onward-call count FIRST: closing the scope clears it.
        // Only meaningful on a per-run-billed host, where a platform may cap
        // how many calls one run is allowed to make.
        noteRunLimits(identifiedCallCount(workScope));
        endRequestWork(workScope, duration);
        // GUARANTEED-EXIT (same reasoning): classify this request for the
        // containment reading — did one failed read take the whole response
        // with it, or did the app answer anyway?
        //
        // ORDER MATTERS, AND FOR THE SAME REASON AS THE CLOSE BELOW. This is
        // the one place that can read the request's database and
        // outside-service tallies TOGETHER WITH the status the host actually
        // sent, and both of the closes below clear their tally. Running after
        // either would read zero calls on every request and report a
        // permanently clean tile — precisely the blindness this reading exists
        // to remove. A test asserts this order rather than trusting the
        // comment. It reads a status code and keeps a boolean; nothing else.
        noteRequestContainment(workScope, (res as { statusCode?: unknown }).statusCode);
        // GUARANTEED-EXIT (same reasoning): fold this request's OUTSIDE-SERVICE
        // work — sign-in, uploads, payments, messaging, stored-knowledge search
        // — into its own session totals, grouped by the KIND of service.
        //
        // ORDER MATTERS, AND IT IS THE ONLY ORDERING CONSTRAINT IN THIS BLOCK.
        // This close is the one place that can read all three waits off the
        // SAME request scope, which is what makes "outside services / database
        // / AI / your own code" four shares of one denominator that actually
        // add up. The two closes below CLEAR their tallies, so running after
        // either of them would silently read zero for it — the numbers would
        // stop adding up without anything looking broken. A test asserts this
        // order rather than trusting the comment.
        endDependencyWork(workScope, duration);
        // GUARANTEED-EXIT (same reasoning): fold this request's DATABASE work
        // into its own session totals. Separate from the repeated-work close
        // above and deliberately so — database repetition is reported by the
        // dbWork axis and never mixed into repeatedWork's numbers, so neither
        // reading moves because the other shipped.
        endDbWork(workScope, duration);
        // GUARANTEED-EXIT (same reasoning): fold this request's AI-PROVIDER
        // work into its own session totals. Separate again, and deliberately
        // so — the AI share of a request is reported beside the database
        // share, never mixed into it, so neither reading moves because the
        // other shipped. A request that called no AI provider is ignored
        // entirely, so an app with no AI never builds a denominator.
        endAiWork(workScope, duration);
      }
      // Idle-burn boundary: request finished. When nothing else is in flight
      // this snapshots the ELU baseline so the next idle window can be measured.
      noteRequestEnd();
      // Everything above this line was ours. Charged to THIS run before the
      // flush starts, so the published per-run figure is instrumentation only.
      //
      // Charged, not filed. The run is filed exactly once, by the finish below
      // — filing here as well would count one request as two runs and halve the
      // average the kit publishes its own ceiling against.
      chargeKitInterval(kitWork, run.kit);
      // FUNCTION HOSTS: send before the invocation ends. Where the platform can
      // keep working after the response has gone out we hand the flush to it,
      // so the visitor never waits for us; where it cannot, the flush runs
      // inline under a hard time budget. Self-coalescing (finish AND close both
      // fire on some hosts), never throws, and a no-op on an ordinary server.
      //
      // Returned rather than fired-and-forgotten: on a host with no
      // after-response mechanism the `res.end` wrapper AWAITS this, holding the
      // response open until the send is done. Hanging it off `finish` would be
      // too late — that event is exactly where a function adapter resolves and
      // the platform freezes the invocation.
      // A failed run costs the customer exactly what a successful one costs,
      // which is why it is counted rather than dropped as noise. Judged from
      // the status the host actually sent: 5xx is our side falling over.
      return finishInvocation(Number(res.statusCode) >= 500, run);
    };

    // The listeners are the ordinary path: on a long-running server, and on a
    // host that can work after the response, there is nothing to wait for.
    const finalizeListener = () => {
      void finalize();
    };
    // `finish` is the only one of these two that means the response was
    // fully written. The flag is set BEFORE finalize runs, because finalize
    // records at most once and whichever event arrives first does the
    // recording.
    res.on("finish", () => {
      responseCompleted = true;
      finalizeListener();
    });
    res.on("close", finalizeListener);

    // Run the rest of the request INSIDE the repeated-work scope, so a wrapped
    // call (or an outbound HTTP call) anywhere down the stack knows which
    // request it belongs to. With no scope this is a plain `next()`.
    const continueDownstream = () => runInRequestWork(workScope, next);
    if (requestAction === null) {
      continueDownstream();
      return;
    }
    // …and inside THIS REQUEST'S action, so anything measured while the
    // handler is still on the stack can say which action it belongs to, and
    // so a crash thrown out of the handler can be given the action it
    // happened in. The scope is synchronous and closes the moment the call
    // returns — a handler that awaits is off the stack by then, and the
    // coverage record says so rather than guessing at whichever request was
    // most recent.
    try {
      runInSpan(requestAction, continueDownstream);
    } catch (err) {
      // A throw that reaches us is on its way to the process's crash flow
      // (the framework-free attach, and any host that lets it propagate).
      // Every scope between here and the top unwinds before Node's monitor
      // runs, so the action is written onto the ERROR while we still know it.
      // Best-effort, and the error is re-thrown untouched either way: the
      // host's crash behaviour must be exactly what it is without us.
      try {
        const traceId = requestAction.traceId;
        markErrorAction(
          err,
          typeof traceId === "string"
            ? { traceId, spanId: requestAction.spanId }
            : null,
        );
      } catch {
        /* never let attribution change how a crash behaves */
      }
      throw err;
    }
  };
}
