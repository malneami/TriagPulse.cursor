/** Public barrel for @workspace/boosthis-runtime-node. */

// FIRST, deliberately. A static import graph is evaluated depth-first before
// the importing module's body runs, so the earliest instant the kit can time
// itself is inside a module with no imports of its own — and it only stays the
// earliest instant while this line stays at the top. Everything between this
// import and `noteKitModuleEvalDone()` at the foot of this file is what the kit
// costs a cold start, which on a function is a bill the customer pays on every
// cold start forever. See kitFootprint.ts.
import { noteKitModuleEvalDone } from "./kitFootprint";

export { boosthis, normalizePath } from "./middleware";
export type { BoosthisOptions } from "./middleware";

// Model endpoints this app hosts itself. Exported as well as accepted by
// `boosthis({ aiEndpoints })` so a worker, a queue consumer or any non-Express
// host — which never builds a middleware — can still be measured.
export {
  setDeclaredAiEndpoints,
  declaredAiEndpointCount,
  MAX_DECLARED_AI_ENDPOINTS,
} from "./aiProviders";

// Waits declared on purpose (docs/held-open-calls.md): a long-poll route, or a
// call that long-polls another service. Accepted by `boosthis({ declaredWaits })`
// and exported for the same reason as the line above — a bot or a worker that
// never builds a middleware still makes the calls it would declare.
export {
  setDeclaredWaits,
  DECLARED_WAIT_NAME_CAP,
} from "./declaredWaits";
export type { DeclaredWaitsOption } from "./declaredWaits";

// The ungated startup line, and the refusal of a value that cannot be a
// project key. See .agents/memory/kit-startup-announcement.md.
export {
  announceKitStart,
  announceProjectKey,
  findProjectKeyProblem,
  kitStartupLine,
  projectKeyRefusalLine,
  projectKeyTail,
  warnProjectKeyRefused,
  _resetStartAnnounceForTests,
} from "./startAnnounce";
export type { BadgeState, ProjectKeyProblem } from "./startAnnounce";

// Full-stack trace tag (Stage 1: propagation). The middleware adopts/mints it
// per request; forward it to the next hop with `forwardTraceHeaders(req)`.
export {
  TRACE_HEADER,
  TRACE_ID_RE,
  isValidTraceId,
  newTraceId,
  sanitizeTraceId,
  adoptTraceId,
  traceHeaders,
  getTraceId,
  forwardTraceHeaders,
} from "./trace";

// Full-stack trace causality (Stage 3: span parentage). A span carries its own
// identity and the identity of the call that caused it, so the waterfall nests
// and the view can name the hop RESPONSIBLE for the end-to-end time — not
// merely the longest one. `forwardTraceHeaders(req)` now carries this
// request's identity onward, and the middleware adopts an inbound one.
export {
  PARENT_HEADER,
  SPAN_ID_RE,
  isValidSpanId,
  newSpanId,
  sanitizeSpanId,
  adoptParentSpanId,
  currentSpanId,
  beginSpan,
  runInSpan,
} from "./spanScope";
export type { SpanHandle } from "./spanScope";
export { getSpanId } from "./trace";

// Full-stack trace tag (Stage 2: span emission). The `boosthis()` middleware
// buffers ONE privacy-safe span per handled request; spans ride the same
// allow-gate as the snapshot mirror (nothing span-shaped leaves — or is even
// retained — until an AI is connected).
export {
  flushSpansNow,
  spanLabel,
  rateSpanDuration,
  _spanInternals,
} from "./spanEmitter";
export type {
  TraceSpan,
  SpanLayer,
  SpanRating,
  SpanSubmitter,
} from "./spanEmitter";

// Scheduled jobs. `reportJobRun` is the form for a job whose timing the app
// already keeps for itself; a job the kit should time is marked with
// `trackJob` (exported below, the single measured form). Only the name, the
// outcome and the duration are ever sent.
// `MAX_JOB_NAME` is the ONE bound both of those doors enforce, and it is the
// server's own — a name at or under it is measured whichever way it arrives,
// and a longer one is refused out loud by both rather than shortened. It was
// once true only of `reportJobRun`, while `trackJob` dropped anything past 60.
// See docs/decisions/job-name-length.md.
export {
  reportJobRun,
  flushJobRunsNow,
  jobName,
  MAX_JOB_NAME,
  MAX_JOB_RUN_BATCH,
  _jobInternals,
} from "./jobReporter";
export type { JobRunReport, JobRunSubmitter } from "./jobReporter";

// The whole route list, asked of the running framework — so the map can draw
// every route the app has, not only the ones somebody has already opened.
// Express needs no call at all (the middleware picks the app up off the first
// request); Fastify, Koa and Hapi hand their app over via `attach({ app })` or
// `registerApp(app)`. `registerRoutes()` still declares routes by hand, and
// the two lists merge.
export {
  registerApp,
  registerRoutes,
  getDeclaredRoutes,
  routeListReport,
  routeListEnabled,
  readFrameworkRoutes,
  MAX_ROUTE_LIST_ENTRIES,
  ROUTE_SOURCE_WORDS,
  _resetRouteInventoryForTests,
} from "./routeInventory";
export type {
  RouteListEntry,
  RouteListOrigin,
  RouteListReport,
  RouteListStatus,
} from "./routeInventory";

export { mount } from "./mount";
export type { MountOptions } from "./mount";

// Attach to ANY Node server — Next.js, Fastify, Hono, NestJS, plain `http`.
// Express apps keep using `app.use(boosthis())`; everything else calls this
// once at startup and gets the same measurements, the same in-app page and the
// same badge with no framework glue.
export { attach, attachState, cannotAttachLine } from "./serverAttach";
export type {
  AttachOptions,
  AttachResult,
  AttachState,
  AttachRefusal,
} from "./serverAttach";
export {
  detectServerKind,
  serverKindLabel,
  SERVER_KINDS,
  isServerKind,
} from "./serverKind";
export type { ServerKind } from "./serverKind";

export {
  PULSE_PATH,
  PANEL_PATH,
  computePulse,
  computePanel,
  computePanelNotice,
  resolveBubbleVisibility,
  isDevProcess,
  injectIntoHtml,
  wrapResponseForInjection,
  bubbleSnippet,
  BUBBLE_SNIPPET,
  FIRST_REPORT_WAIT_TEXT,
} from "./bubble";
export type { PagePulse, PagePanel, PanelAxis, PanelNotice } from "./bubble";

export { trackPerf, perf } from "./trackPerf";

/* The BY-HAND mark for an outbound call made with a client this kit does not
 * watch. The coverage answer names this call as the way out of that gap, so it
 * has to be importable from the package — a next step naming an export that is
 * not there is the dead end that answer exists to remove. Counts the
 * destination host only; never the path, the query or the body. */
export { recordOutboundAttempt } from "./liveDetectors";

/* Background work — jobs, queues and schedules. `trackJob`/`beginJob` are the
 * ONE obvious way to mark a job by hand where the kit cannot attach on its own;
 * `expectEvery` states how often a recurring job is supposed to run, so a run
 * that never happens is visible from the very first miss instead of after the
 * cadence has been learned. A rhythm stated there is SENT to Boosthis and
 * remembered, because only Boosthis can notice that this process is the thing
 * that stopped — a declaration that never left the process could not raise an
 * alert and made the kit and the dashboard answer differently about the same
 * job. None of these ever start or schedule anything.
 * A mark nested inside `trackJob` (or inside a run an adapter is already
 * measuring) is handed through rather than counted again, so old by-hand
 * marks left in place after the kit attaches to the queue itself cannot
 * double a project's numbers. */
export { trackJob, beginJob, expectEvery, JOB_PREFIX } from "./jobWork";
export type { JobRun, JobRunOptions } from "./jobWork";

/* A standing promise, written beside the code it is about.
 *
 * Until this existed a promise could only be typed on the project's promises
 * page or written there by a connected AI — never reviewed in the pull request
 * that changes the code it describes, and never arriving unless somebody
 * remembered the feature existed. `declarePromise` gives it the same door
 * `expectEvery` already uses: stated in the app's own source, carried up on
 * the job upload the kit already makes.
 *
 * It states an intention and nothing more. A promise declared here lands
 * REMEMBERED ONLY and stays that way until a human confirms the interpretation
 * on the project page, exactly like an AI-written one — and a promise that
 * page has since edited or confirmed is never overwritten by this call. There
 * is deliberately no way to confirm, watch, unwatch or delete one from code:
 * that line is what makes "watched" mean something. Anything Boosthis refuses
 * is named on stderr, once, rather than failing silently. */
export { declarePromise } from "./promiseDeclaration";
export type {
  PromiseDeclarationOptions,
  PromiseSubjectKind as PromiseSubject,
  PromiseMetric,
} from "./promiseDeclaration";

/* A process with no web server — a queue consumer, a scheduled worker — is a
 * project in its own right: it registers, measures and uploads exactly like
 * any other install. `boosthisWorker()` replaces `boosthis()` there (there is
 * no framework to add middleware to), and because there is no port to serve
 * the kit's status page on, the same facts print as text instead. */
export { boosthisWorker, workerStatusText } from "./worker";
export type { WorkerOptions } from "./worker";
export { mcpTool, registerMcpTools } from "./mcpMeasure";

export {
  record,
  recent,
  summary,
  clear,
} from "./samples";
export type { Sample, Summary, PerRouteSummary } from "./samples";

export {
  statusFor as budgetStatusFor,
  allStatuses as allBudgetStatuses,
  regressions as budgetRegressions,
  isJudgedBudget,
  BASELINE_N,
  RECENT_N,
  BUDGET_WARMUP_N,
  BUDGET_BASELINE_N,
  BUDGET_RECENT_N,
  BUDGET_SAMPLES_FOR_VERDICT,
  BUDGET_ALGORITHM,
  REGRESSION_FACTOR,
  IMPROVEMENT_FACTOR,
} from "./budgets";
export type {
  BudgetState,
  BudgetStatus,
  BudgetWindow,
  BudgetAlgorithm,
} from "./budgets";

export {
  PII_DENYLIST,
  PIIDetectedError,
  assertNoPII,
  checkNoPII,
} from "./no-pii";

export { safeTransmit } from "./transmit";
export type { SafeTransmitOptions } from "./transmit";

export {
  SCORE_THRESHOLDS,
  RUNTIME_VERSION,
  rateDuration,
} from "./thresholds";
export type { Rating } from "./thresholds";

export { isBoosthisDisabled } from "./runtimeFlags";
export {
  resolveProjectKey,
  maskProjectKey,
  describeProjectKeySource,
} from "./projectKey";
export type { ProjectKeySource, ResolvedProjectKey } from "./projectKey";

export {
  isRuntimeInert,
  isActivated,
  getEntitlementStatus,
  getEntitlementMessage,
  getEntitlementGateKind,
  subscribeEntitlement,
  checkEntitlementNow,
  forceEntitlementCheck,
  startEntitlementCheckin,
  stopEntitlementCheckin,
  type EntitlementStatus,
  type EntitlementGateKind,
  type EntitlementCheckinConfig,
} from "./killSwitch";

export {
  enableTelemetry,
  getRegistrationRejection,
  DEFAULT_TELEMETRY_ENDPOINT,
} from "./telemetry";
export {
  capturePerfSnapshot,
  uploadPerfSnapshotNow,
  readNow,
  READING_TRIGGER_ON_DEMAND,
  nextSnapshotDelayMs,
  SNAPSHOT_FLUSH_MS,
  type ReadNowResult,
  type ReadingTrigger,
  type NodeSnapshotPayload,
  type NodeSnapshotRow,
  type NodeSnapshotFinding,
  type NodeAxisResult,
} from "./snapshot";
export type {
  TelemetryOptions,
  TelemetryClient,
  TelemetrySample,
  CandidateSignaturePayload,
  ResolutionPayload,
  RegistrationRejection,
} from "./telemetry";
export type {
  CrashReportPayload,
  CrashFrameData,
  CrashKind,
} from "./crashReporter";

export {
  signatureFor,
  ingestFindings,
  listCandidateRules,
  listSurfaceable,
  promoteCandidateLocal,
  clearAllCandidates,
} from "./candidateRules";
export type { CandidateRule, CrossCuttingFinding } from "./candidateRules";

export { collectFindings, reportNow } from "./reporting";

/* ─── Getting the last measurements out before the process goes ────────── */

export {
  EXIT_ACTIVATION_TIMEOUT_MS,
  EXIT_FLUSH_BUDGET_MS,
  exitFlushArmed,
  lastExitActivationOutcome,
  installExitFlush,
  lastExitFlushResult,
  runExitFlush,
} from "./exitFlush";

/* ─── Serverless (function) hosting ────────────────────────────────────── */

export {
  isServerlessMode,
  serverlessHost,
  serverlessRefusal,
  platformName,
  deriveServerlessInstallId,
  scopeHashFor,
  isProvenPlatform,
  PROVEN_PLATFORMS,
  PLATFORM_UNKNOWN,
  PLATFORM_VERCEL,
  PLATFORM_AWS_LAMBDA,
  PLATFORM_NETLIFY,
  PLATFORM_GCP_FUNCTIONS,
  PLATFORM_AZURE_FUNCTIONS,
  PLATFORM_CLOUD_RUN,
  PLATFORM_FIREBASE_APP_HOSTING,
  PLATFORM_CLOUDFLARE_WORKERS,
  PLATFORM_SUPABASE_EDGE,
  isFrozenBetweenRequests,
  isPerRunBilled,
} from "./serverless";
export type { PlatformCode, ServerlessHost } from "./serverless";

// The one source of truth for what a run can and cannot learn about itself on
// each platform. Exported because the server reads the SAME rows rather than
// keeping a second copy that would drift the first time a vendor changed a
// limit — and a drifted copy is how a reading starts abstaining on one surface
// and answering on another.
export {
  PLATFORM_CAPABILITIES,
  capabilitiesFor,
  availabilityOf,
  REASON_PLATFORM_DOES_NOT_EXPOSE,
  REASON_NOTHING_TO_COMPARE,
} from "./serverlessPlatform";
export type {
  PlatformCapabilities,
  ServerlessReading,
  ReadingAvailability,
} from "./serverlessPlatform";

export {
  withBoosthis,
  finishInvocation,
  hasAfterResponseMechanism,
  needsFlushBeforeResponse,
  flushBudgetMs,
  DEFAULT_FLUSH_BUDGET_MS,
  MAX_FLUSH_BUDGET_MS,
  FROZEN_FLUSH_BUDGET_MS,
} from "./serverlessLifecycle";
export type { FunctionContext } from "./serverlessLifecycle";

// `readServerlessMeters` is the whole per-run section exactly as the snapshot
// carries it. Exported for the same reason as the capability rows above: the
// server's cost verdict is tested against what the kit REALLY emits rather than
// against a hand-written copy of it, which is how a surface starts rendering a
// shape no kit has produced for months.
export { serverlessCounters, readServerlessMeters } from "./serverlessMeters";

// What Boosthis costs, measured by Boosthis and capped by Boosthis.
export {
  readKitFootprint,
  kitShouldReduce,
  KIT_COLD_START_CEILING_MS,
  KIT_PER_RUN_CEILING_MS,
  KIT_CEILING_WARN_PCT,
} from "./kitFootprint";
export type { KitFootprint } from "./kitFootprint";

// Reporting a run's death from inside the dying run.
export {
  deathCounters,
  waitingText,
  DEATH_SLICE_MS,
  MEMORY_NEAR_KILL_PCT,
  WAITING_UNKNOWN,
  WAITING_NETWORK,
  WAITING_DISK,
  WAITING_TIMER,
  WAITING_CHILD_PROCESS,
  WAITING_OWN_CODE,
} from "./serverlessDeath";
export type { WaitingClass, DeathReport, DeathCause } from "./serverlessDeath";

export { renderMarkdownContext } from "./context";

// LAST, deliberately — the closing half of the cold-start measurement opened by
// the kitFootprint import at the top of this file. Everything between the two
// marks is the kit's own module graph and none of the customer's.
noteKitModuleEvalDone();
