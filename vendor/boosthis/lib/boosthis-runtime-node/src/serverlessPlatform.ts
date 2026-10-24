/** What each function platform will and will not tell the code running on it.
 *
 * ONE SOURCE OF TRUTH. Every surface that decides whether a serverless reading
 * can be taken — the kit's collectors, the kit's own status page, the server's
 * tiles, the AI's answers — asks this table. The point is that an unavailable
 * reading abstains EVERYWHERE at once: without a shared table, one surface says
 * "not available here" while another quietly renders a zero, and the zero is
 * the lie the whole serverless-cost reading exists to stop.
 *
 * It lives in the kit rather than the server because the kit is the only side
 * that can act on it (abstain rather than measure), and the api-server already
 * depends on this package — so the server reads the SAME rows rather than a
 * hand-copied second table that drifts.
 *
 * ── HOW TO READ A ROW ──────────────────────────────────────────────────────
 *
 * Each capability answers one question: can code INSIDE a run learn this? Not
 * "does the platform know it" — platforms know plenty they never pass down. A
 * value the platform publishes only in its own invocation records after the
 * fact is `false` here and is marked `publishedAfterTheRun` instead, because
 * the two are different kinds of silence and a customer deserves to be told
 * which one they are looking at.
 *
 * ── WHY SOME ROWS ARE FOR PLATFORMS THIS KIT CANNOT RUN ON ─────────────────
 *
 * Cloudflare Workers and Supabase Edge Functions run isolates, not Node. This
 * kit will never boot there. Their rows exist anyway because the table is the
 * product's answer to "what can be known where", and the server words
 * abstentions from it; a future isolate kit reads these same rows instead of
 * writing a second table. `nodeKitRuns: false` marks them.
 *
 * ── FRESHNESS ─────────────────────────────────────────────────────────────
 *
 * Every row carries `confirmedOn`. These are vendor-documented behaviours, and
 * vendors change them: the subrequest cap Cloudflare enforced for years was
 * REMOVED in February 2026, which is exactly why a row states when it was last
 * checked rather than pretending to be timeless. A stale row is a wrong
 * abstention, so re-confirm before leaning on one.
 */

import {
  PLATFORM_AWS_LAMBDA,
  PLATFORM_AZURE_FUNCTIONS,
  PLATFORM_CLOUDFLARE_WORKERS,
  PLATFORM_CLOUD_RUN,
  PLATFORM_FIREBASE_APP_HOSTING,
  PLATFORM_GCP_FUNCTIONS,
  PLATFORM_NETLIFY,
  PLATFORM_SUPABASE_EDGE,
  PLATFORM_UNKNOWN,
  PLATFORM_VERCEL,
  type PlatformCode,
} from "./serverless";

/* ─── The reason vocabulary, as this kit uses it ───────────────────────── */

/**
 * The SHARED closed vocabulary every kit already uses to say "this reading
 * cannot be taken here" — declared once in `axisReasons`, because it is not a
 * serverless-only numbering and readings outside this family send it too.
 * Re-exported here so the family's own callers read as one module.
 */
export {
  REASON_PLATFORM_DOES_NOT_EXPOSE,
  REASON_NOTHING_TO_COMPARE,
} from "./axisReasons";
import {
  REASON_NOTHING_TO_COMPARE,
  REASON_PLATFORM_DOES_NOT_EXPOSE,
} from "./axisReasons";

/* ─── The capability shape ─────────────────────────────────────────────── */

export interface PlatformCapabilities {
  readonly code: PlatformCode;
  /** Can this kit boot here at all? False for isolate runtimes. */
  readonly nodeKitRuns: boolean;
  /** Is a run here short-lived and frozen when it answers? */
  readonly isFunction: boolean;

  /* Time */
  /** The platform hands the running code a live remaining-time clock. Only
   *  this makes "warn before the kill" possible from inside. */
  readonly liveCountdown: boolean;
  /** The run can learn its own wall-clock time limit from inside. */
  readonly timeLimitReadable: boolean;
  /** The platform enforces a wall-clock limit at all. */
  readonly timeLimitExists: boolean;

  /* Memory */
  /** The platform states the memory it granted, readable from inside. */
  readonly memoryLimitReadable: boolean;
  /** A fixed ceiling every run on this platform gets, in MB. Null when the
   *  ceiling is per-function rather than platform-wide. */
  readonly fixedMemoryMb: number | null;

  /* Computing time (as opposed to waiting time) */
  /** The platform caps COMPUTING time separately from wall time. */
  readonly cpuTimeCapped: boolean;
  /** …and the run can learn that cap from inside. */
  readonly cpuTimeLimitReadable: boolean;

  /* The other limits */
  /** The platform caps how many onward calls one run may make. */
  readonly onwardCallsCapped: boolean;
  /** The platform caps how many connections may be open at once. */
  readonly openConnectionsCapped: boolean;
  /** …and that cap, when it exists. */
  readonly openConnectionLimit: number | null;

  /* Delivery */
  /** An official mechanism for working after the response has been sent. */
  readonly afterResponseMechanism: boolean;

  /* Kills and refusals */
  /** The platform tells the RUNNING CODE what it refused or killed. No
   *  platform does; kept explicit so the answer is stated, not assumed. */
  readonly refusalsReadableInside: boolean;
  /** The platform publishes refusals/kills/billed duration in its own records
   *  after the run. Not something we can read from inside, and we do not build
   *  a collector — so this marks "ask your platform", not "zero". */
  readonly publishedAfterTheRun: boolean;

  /* The always-on look-alike */
  /** The processor is frozen between requests even though the host looks like
   *  an ordinary long-running server. */
  readonly cpuFrozenBetweenRequests: boolean;

  /** ISO date this row was last confirmed against vendor documentation. */
  readonly confirmedOn: string;
}

/* ─── The table ────────────────────────────────────────────────────────── */

const CONFIRMED = "2026-08-26";

/**
 * Every platform in the closed vocabulary, and what a run can learn there.
 *
 * The unknown row is deliberately the most pessimistic one: a host we have not
 * recognised gets nothing but the readings that need no platform cooperation.
 */
export const PLATFORM_CAPABILITIES: Record<PlatformCode, PlatformCapabilities> = {
  [PLATFORM_UNKNOWN]: {
    code: PLATFORM_UNKNOWN,
    nodeKitRuns: true,
    isFunction: false,
    liveCountdown: false,
    timeLimitReadable: false,
    timeLimitExists: false,
    memoryLimitReadable: false,
    fixedMemoryMb: null,
    cpuTimeCapped: false,
    cpuTimeLimitReadable: false,
    onwardCallsCapped: false,
    openConnectionsCapped: false,
    openConnectionLimit: null,
    afterResponseMechanism: false,
    refusalsReadableInside: false,
    publishedAfterTheRun: false,
    cpuFrozenBetweenRequests: false,
    confirmedOn: CONFIRMED,
  },

  // Vercel Functions run ON Lambda but do NOT pass the context down, so the
  // countdown Lambda offers is not reachable here. The time limit is a project
  // setting the customer configures; nothing in the environment states it.
  [PLATFORM_VERCEL]: {
    code: PLATFORM_VERCEL,
    nodeKitRuns: true,
    isFunction: true,
    liveCountdown: false,
    timeLimitReadable: false,
    timeLimitExists: true,
    // The underlying Lambda's granted memory IS in the environment, and Vercel
    // does not strip it — which is why memory headroom works here and time
    // headroom does not.
    memoryLimitReadable: true,
    fixedMemoryMb: null,
    cpuTimeCapped: false,
    cpuTimeLimitReadable: false,
    onwardCallsCapped: false,
    openConnectionsCapped: false,
    openConnectionLimit: null,
    afterResponseMechanism: true,
    refusalsReadableInside: false,
    publishedAfterTheRun: true,
    cpuFrozenBetweenRequests: false,
    confirmedOn: CONFIRMED,
  },

  // The only platform here that hands the run a live clock. Everything the
  // "warn before the kill" work can do, it can do because of this row.
  [PLATFORM_AWS_LAMBDA]: {
    code: PLATFORM_AWS_LAMBDA,
    nodeKitRuns: true,
    isFunction: true,
    liveCountdown: true,
    timeLimitReadable: true,
    timeLimitExists: true,
    memoryLimitReadable: true,
    fixedMemoryMb: null,
    cpuTimeCapped: false,
    cpuTimeLimitReadable: false,
    onwardCallsCapped: false,
    openConnectionsCapped: false,
    openConnectionLimit: null,
    // Lambda freezes on return, full stop. There is no waitUntil.
    afterResponseMechanism: false,
    refusalsReadableInside: false,
    // Billed duration, throttles and the kill itself live in the platform's own
    // records, never in the run.
    publishedAfterTheRun: true,
    cpuFrozenBetweenRequests: false,
    confirmedOn: CONFIRMED,
  },

  [PLATFORM_NETLIFY]: {
    code: PLATFORM_NETLIFY,
    nodeKitRuns: true,
    isFunction: true,
    liveCountdown: false,
    timeLimitReadable: false,
    timeLimitExists: true,
    memoryLimitReadable: true,
    fixedMemoryMb: null,
    cpuTimeCapped: false,
    cpuTimeLimitReadable: false,
    onwardCallsCapped: false,
    openConnectionsCapped: false,
    openConnectionLimit: null,
    afterResponseMechanism: true,
    refusalsReadableInside: false,
    publishedAfterTheRun: true,
    cpuFrozenBetweenRequests: false,
    confirmedOn: CONFIRMED,
  },

  [PLATFORM_GCP_FUNCTIONS]: {
    code: PLATFORM_GCP_FUNCTIONS,
    nodeKitRuns: true,
    isFunction: true,
    liveCountdown: false,
    timeLimitReadable: false,
    timeLimitExists: true,
    memoryLimitReadable: true,
    fixedMemoryMb: null,
    cpuTimeCapped: false,
    cpuTimeLimitReadable: false,
    onwardCallsCapped: false,
    openConnectionsCapped: false,
    openConnectionLimit: null,
    afterResponseMechanism: false,
    refusalsReadableInside: false,
    publishedAfterTheRun: true,
    cpuFrozenBetweenRequests: false,
    confirmedOn: CONFIRMED,
  },

  [PLATFORM_AZURE_FUNCTIONS]: {
    code: PLATFORM_AZURE_FUNCTIONS,
    nodeKitRuns: true,
    isFunction: true,
    liveCountdown: false,
    timeLimitReadable: false,
    timeLimitExists: true,
    // Azure states no per-function memory grant in the environment.
    memoryLimitReadable: false,
    fixedMemoryMb: null,
    cpuTimeCapped: false,
    cpuTimeLimitReadable: false,
    onwardCallsCapped: false,
    openConnectionsCapped: false,
    openConnectionLimit: null,
    afterResponseMechanism: false,
    refusalsReadableInside: false,
    publishedAfterTheRun: true,
    cpuFrozenBetweenRequests: false,
    confirmedOn: CONFIRMED,
  },

  // ── The always-on look-alikes ────────────────────────────────────────────
  // A container that looks long-lived and is billed like one, except the
  // processor is frozen between requests unless the customer pays to keep it
  // awake. Everything a function-shaped design fixes — timers that never fire,
  // sends that die mid-flight — happens here too, which is why these rows
  // exist rather than being waved off as "not serverless".
  [PLATFORM_CLOUD_RUN]: {
    code: PLATFORM_CLOUD_RUN,
    nodeKitRuns: true,
    // Not a function: the process really does survive between requests, keeps
    // its identity, and registers once. Only the FREEZE is function-shaped.
    isFunction: false,
    liveCountdown: false,
    timeLimitReadable: false,
    timeLimitExists: true,
    memoryLimitReadable: false,
    fixedMemoryMb: null,
    cpuTimeCapped: false,
    cpuTimeLimitReadable: false,
    onwardCallsCapped: false,
    openConnectionsCapped: false,
    openConnectionLimit: null,
    afterResponseMechanism: false,
    refusalsReadableInside: false,
    publishedAfterTheRun: true,
    cpuFrozenBetweenRequests: true,
    confirmedOn: CONFIRMED,
  },

  [PLATFORM_FIREBASE_APP_HOSTING]: {
    code: PLATFORM_FIREBASE_APP_HOSTING,
    nodeKitRuns: true,
    isFunction: false,
    liveCountdown: false,
    timeLimitReadable: false,
    timeLimitExists: true,
    memoryLimitReadable: false,
    fixedMemoryMb: null,
    cpuTimeCapped: false,
    cpuTimeLimitReadable: false,
    onwardCallsCapped: false,
    openConnectionsCapped: false,
    openConnectionLimit: null,
    afterResponseMechanism: false,
    refusalsReadableInside: false,
    publishedAfterTheRun: true,
    cpuFrozenBetweenRequests: true,
    confirmedOn: CONFIRMED,
  },

  // ── Isolate runtimes: rows only, no Node kit ─────────────────────────────
  // Workers cap THINKING time rather than waiting time, and the isolate will
  // not let code time itself — so nothing here is measurable from inside and
  // everything comes from Cloudflare's own invocation records.
  //
  // NOTE, and the reason every row carries a date: the 1000-subrequest cap
  // that stood for years was REMOVED in February 2026. Inheriting it would
  // have had us render headroom against a limit that no longer exists.
  [PLATFORM_CLOUDFLARE_WORKERS]: {
    code: PLATFORM_CLOUDFLARE_WORKERS,
    nodeKitRuns: false,
    isFunction: true,
    liveCountdown: false,
    timeLimitReadable: false,
    timeLimitExists: true,
    memoryLimitReadable: false,
    fixedMemoryMb: 128,
    cpuTimeCapped: true,
    // The isolate deliberately does not advance a clock for the code, so a
    // Worker cannot time itself against its own CPU cap.
    cpuTimeLimitReadable: false,
    onwardCallsCapped: false,
    openConnectionsCapped: true,
    openConnectionLimit: 6,
    afterResponseMechanism: true,
    refusalsReadableInside: false,
    publishedAfterTheRun: true,
    cpuFrozenBetweenRequests: false,
    confirmedOn: CONFIRMED,
  },

  // A worker stays alive for a known wall-clock period and serves many
  // requests during it; a supervisor enforces soft and hard computing-time
  // limits and may retire the worker early.
  [PLATFORM_SUPABASE_EDGE]: {
    code: PLATFORM_SUPABASE_EDGE,
    nodeKitRuns: false,
    isFunction: true,
    liveCountdown: false,
    timeLimitReadable: false,
    timeLimitExists: true,
    memoryLimitReadable: false,
    fixedMemoryMb: 256,
    cpuTimeCapped: true,
    cpuTimeLimitReadable: false,
    onwardCallsCapped: false,
    openConnectionsCapped: false,
    openConnectionLimit: null,
    afterResponseMechanism: true,
    refusalsReadableInside: false,
    publishedAfterTheRun: true,
    cpuFrozenBetweenRequests: false,
    confirmedOn: CONFIRMED,
  },
};

export function capabilitiesFor(code: PlatformCode): PlatformCapabilities {
  return (
    PLATFORM_CAPABILITIES[code] ?? PLATFORM_CAPABILITIES[PLATFORM_UNKNOWN]
  );
}

/* ─── What KIND of host is this? ───────────────────────────────────────── */

/**
 * The one fact every reading in this family must state about the host it
 * judged.
 *
 * A red function-cost tile sitting beside five tiles that say "there is nothing
 * to compare" is a page a reader cannot reconcile — and it happened because the
 * cost reading asked only "is this billed by the run?" while its neighbours
 * asked the capability table. They were answering questions about two different
 * kinds of host and neither said which.
 *
 * A CODE, never a name: the kit sends the number, the server writes the words.
 * Numbers are permanent — never re-use or renumber one.
 */
export const HOST_KIND_UNKNOWN = 0 as const;
/** A real function: short-lived, frozen the moment it answers, hard per-run
 *  ceilings the platform enforces. */
export const HOST_KIND_FUNCTION = 1 as const;
/** The always-on look-alike: a container that keeps its process between
 *  requests and has its PROCESSOR frozen the moment it answers. Billed by the
 *  run, but with a bill and no cliffs. */
export const HOST_KIND_FROZEN_CONTAINER = 2 as const;
/** An ordinary long-running server: nothing here is billed by the run and
 *  nothing freezes between requests. */
export const HOST_KIND_ALWAYS_ON = 3 as const;

export type HostKind = 0 | 1 | 2 | 3;

/**
 * Which kind of host is this, according to the shared capability table?
 *
 * Read from the table rather than from a detector, so every reading in the
 * family reaches the same answer by the same route. An unrecognised platform is
 * UNKNOWN and never quietly rounded up to "ordinary server": we do not know
 * what it is, and saying so is the whole point of having a code for it.
 */
export function hostKindFor(code: PlatformCode): HostKind {
  const c = capabilitiesFor(code);
  if (c.isFunction) return HOST_KIND_FUNCTION;
  if (c.cpuFrozenBetweenRequests) return HOST_KIND_FROZEN_CONTAINER;
  if (code === PLATFORM_UNKNOWN) return HOST_KIND_UNKNOWN;
  return HOST_KIND_ALWAYS_ON;
}

/* ─── Readings, and whether they can be taken ──────────────────────────── */

/** The readings whose availability this table decides. Named for what a
 *  customer asks, not for the axis key that carries them. */
export type ServerlessReading =
  | "timeHeadroom"
  | "platformMemoryHeadroom"
  | "cpuTimeHeadroom"
  | "onwardCallHeadroom"
  | "openConnectionHeadroom"
  | "refusalsAndKills"
  | "imminentKillWarning"
  | "perRunCost"
  | "kitCost";

export interface ReadingAvailability {
  /** Can this reading be taken here? */
  readonly measurable: boolean;
  /** The shared closed reason code when it cannot. Null when it can. */
  readonly reasonCode: number | null;
}

const CAN: ReadingAvailability = { measurable: true, reasonCode: null };
const HIDDEN: ReadingAvailability = {
  measurable: false,
  reasonCode: REASON_PLATFORM_DOES_NOT_EXPOSE,
};
const NO_LIMIT: ReadingAvailability = {
  measurable: false,
  reasonCode: REASON_NOTHING_TO_COMPARE,
};

/**
 * Can this reading be taken on this platform, and if not, why not?
 *
 * The two refusals are genuinely different and must never be collapsed:
 *
 *   HIDDEN   — the platform HAS this limit and will not tell the code what it
 *              is. There is an edge; we cannot see how close you are to it.
 *   NO_LIMIT — the platform sets no such limit at all. There is no edge, so
 *              "how close are you" has no answer, and inventing a ceiling to
 *              measure against would be the invented number this whole reading
 *              exists to refuse.
 */
export function availabilityOf(
  code: PlatformCode,
  reading: ServerlessReading,
): ReadingAvailability {
  const c = capabilitiesFor(code);
  switch (reading) {
    case "timeHeadroom":
      if (!c.timeLimitExists) return NO_LIMIT;
      return c.timeLimitReadable ? CAN : HIDDEN;
    case "platformMemoryHeadroom":
      if (c.fixedMemoryMb !== null) return CAN;
      return c.memoryLimitReadable ? CAN : HIDDEN;
    case "cpuTimeHeadroom":
      if (!c.cpuTimeCapped) return NO_LIMIT;
      return c.cpuTimeLimitReadable ? CAN : HIDDEN;
    case "onwardCallHeadroom":
      return c.onwardCallsCapped ? CAN : NO_LIMIT;
    case "openConnectionHeadroom":
      if (!c.openConnectionsCapped) return NO_LIMIT;
      return c.openConnectionLimit === null ? HIDDEN : CAN;
    case "refusalsAndKills":
      return c.refusalsReadableInside ? CAN : HIDDEN;
    case "imminentKillWarning":
      // Warning before a kill needs a live clock. Nothing else substitutes:
      // guessing from elapsed time against a limit we were never told is how
      // a monitoring agent starts inventing deaths.
      return c.liveCountdown ? CAN : HIDDEN;
    case "perRunCost":
      // "What did the runs cost?" has an answer wherever the platform charges
      // by the run — a real function, or a container billed per request-second
      // whose processor freezes when it answers. It is asked of the TABLE and
      // not of a billing flag alone, so the cost reading and the five headroom
      // readings beside it are answering about the same host; and where it CAN
      // be taken, the reading still has to say WHICH of the two kinds it
      // judged, because a bill with no cliffs is not a function's bill.
      return c.isFunction || c.cpuFrozenBetweenRequests ? CAN : NO_LIMIT;
    case "kitCost":
      // What BOOSTHIS costs the host. Measurable wherever this kit boots at
      // all; it is only PUBLISHED on a host billed by the run, because that is
      // where a millisecond of ours is money rather than noise.
      return c.nodeKitRuns ? CAN : NO_LIMIT;
    default:
      return HIDDEN;
  }
}
