/* ─── Boosthis: database-work meter (Node) ─────────────────────────────────
 *
 * WHY THIS EXISTS. A project on Express + Postgres could already see how long
 * each request took, and nothing told it how much of that time was spent
 * WAITING ON THE DATABASE — or that one request ran the same statement twenty
 * times. The rule book has always told developers to fix both (`n-plus-one-
 * orm-node`, `unbounded-result-set`, `db-write-in-loop`); no reading ever
 * found them, because the kit only watched calls a developer had wrapped by
 * hand plus outbound HTTP. A driver talking Postgres over its own socket was
 * completely invisible.
 *
 * TWO SHAPES OF DATABASE, AND THEY FAIL DIFFERENTLY.
 *
 *  1. A TRADITIONAL DRIVER (`pg`) opens its own connection and never touches
 *     the HTTP stack, so nothing here saw it at all. This module watches its
 *     round-trip layer — `Client.prototype.query` — which is the single point
 *     every plain query AND every ORM query (Drizzle, Knex, Sequelize,
 *     TypeORM) passes through, because they all issue through a `pg` client.
 *     `Pool.query` is deliberately NOT patched: it delegates to a client, so
 *     patching both would count every pooled query twice.
 *
 *  2. A HOSTED DATABASE REACHED OVER THE WEB (Supabase, Firebase, Neon's HTTP
 *     driver, Turso, PlanetScale, Prisma Accelerate …) rides the same undici
 *     observation point the outbound-call meter already uses — but it arrived
 *     there as a destination name and looked exactly like any other API call.
 *     {@link isHostedDatabaseCall} classifies it as database work instead, so
 *     the reading covers a project that mixes both (very common in AI-built
 *     apps) rather than silently reporting on half of it.
 *
 * NEVER LOADS A CLIENT THE HOST DID NOT CHOOSE. A library is observed only if
 * the app ALREADY loaded it: the check is a lookup in the CommonJS module
 * cache, and the module object is taken FROM that cache. This kit never
 * imports a database driver, never resolves one into existence, and an app
 * with no Postgres client is untouched.
 *
 * PRIVACY — the whole point of counting in here. A statement's SHAPE plus its
 * ARGUMENTS are a visible input, which is exactly what makes repetition
 * judgeable; both are folded into a 32-bit in-process hash on the stack and
 * dropped. No SQL text, no parameter value, no table or column name, no
 * database host and no connection string is stored, logged, or uploaded. Only
 * counts, durations and shares ever leave — the same numbers-only contract the
 * repeated-work meter already ships under.
 *
 * HONEST WHEN BLIND. A client this kit cannot watch must never read as an app
 * with no database work. {@link unwatchedDbClientCount} counts the database
 * libraries this process loaded that have no safe round-trip layer to observe
 * (Prisma's queries run inside a Rust engine; postgres.js, mysql2, mongodb and
 * the SQLite bindings have no single JS funnel yet), and that count ships
 * beside the reading so the tile can say "cannot tell" instead of "none".
 * A kit that watched nothing at all reports NO axis, which the dashboard reads
 * as "cannot tell" — never a confident zero.
 *
 * ADDITIVE. This never touches the composite Speed score, and it never files
 * into the repeated-work meter: database repetition is reported here, HTTP and
 * hand-wrapped repetition stays there, and neither reading moves because the
 * other shipped.
 *
 * LATER WORK — the remaining server kits. Node first. Go, Java, Python, PHP,
 * .NET, Ruby, Rust and Elixir each need their own driver funnel located before
 * this can be honest there; until then they simply do not upload the axis,
 * which reads as "cannot tell". The phone and browser kits make no database
 * calls of this shape and are out of scope forever.
 */

import { requestSettled } from "./repeatedWork";
import { createRequire } from "node:module";
import { callFailure, dbFailure, countDbFailure, emptyDbFailures, type DbFailureCounts } from "./callFailures";

import { isBoosthisDisabled } from "./runtimeFlags";
import { isKitLocked } from "./killSwitch";
import {
  callIdentity,
  currentRequestScope,
  type RequestWorkScope,
} from "./repeatedWork";
import {
  currentLinkedScope,
  noteLinkedCall,
  type LinkedScope,
} from "./linkedSteps";
import type {
  DbPoolPressureStatsLike,
  DbRowVolumeStatsLike,
  DbSequencingStatsLike,
  DbWorkStatsLike,
} from "./meterAxes";

/** Most distinct statement identities tracked inside ONE request. Past this
 *  the request stops learning new ones (repeats of the ones it already knows
 *  still count), so a pathological request can never grow memory. */
const MAX_DISTINCT_STATEMENTS = 512;

/** Most round-trip INTERVALS kept for one request's sequencing sweep. A
 *  request that issues more than this is left out of the sequencing reading
 *  altogether rather than judged on a truncated buffer — see
 *  docs/db-round-trip-waves.md. Every other database number still counts it in
 *  full. */
export const DB_WAVE_MAX_CALLS = 256;

/** Longest SQL text folded into an identity. A statement's shape is settled
 *  long before this; the cap keeps a generated mega-query cheap to hash. */
const MAX_SQL_CHARS = 512;

/**
 * Postgres clients this kit knows how to watch, with the module-cache entry
 * that proves the host already loaded one.
 *
 * `file` is matched as a SUFFIX of a CommonJS cache key so it works under npm,
 * yarn and pnpm's virtual store alike, and it points at the package ENTRY (not
 * an inner file) so the cached exports really are the package's own.
 */
const WATCHABLE_DB_CLIENTS: ReadonlyArray<{ name: string; file: string }> = [
  { name: "pg", file: "/node_modules/pg/lib/index.js" },
];

/**
 * Database clients this kit KNOWS about but has no safe round-trip layer for
 * yet. Listing them is the honest half of the deal: an app that loaded one of
 * these has database calls this meter cannot see, and the tile must say so
 * rather than report a clean picture built on the calls it happened to catch.
 *
 * Deliberately NOT here: query builders and ORMs (Drizzle, Knex, Sequelize,
 * TypeORM, Mongoose). They do not talk to a database themselves — they issue
 * through a driver, and the driver is what decides whether the work is
 * visible. Counting them would double-report one blind spot. Cache clients
 * (Redis) are also out: this meter is about the database a request waits on,
 * and calling a cache an unwatched database would overstate the gap.
 */
const UNWATCHABLE_DB_CLIENTS: readonly string[] = [
  // Queries execute inside a Rust query engine; there is no JS call site every
  // query passes through.
  "@prisma/client",
  // postgres.js writes to its own socket with no single JS round-trip funnel.
  "postgres",
  // Not Postgres, and no funnel located yet — but still database work a
  // request waits on, so the blind spot is real and must be counted.
  "mysql2",
  "mysql",
  "mongodb",
  "better-sqlite3",
  "sqlite3",
  "oracledb",
  "tedious",
  "@libsql/client",
];

/* ── Hosted-database classification (over HTTP) ──────────────────────────── */

/**
 * Hostname suffixes that identify a hosted database reached over the web.
 *
 * Matched against the bare hostname the outbound observer already computed —
 * nothing else about the call is read to make this decision. The list is
 * deliberately made of vendor-owned data-plane names, never a generic API
 * host: mistaking an ordinary API for a database would move real API traffic
 * into a database reading, which is the exact confusion this is here to end.
 */
export const HOSTED_DB_HOST_SUFFIXES: readonly string[] = [
  ".supabase.co",
  ".supabase.in",
  ".supabase.net",
  ".firebaseio.com",
  ".firebasedatabase.app",
  "firestore.googleapis.com",
  ".neon.tech",
  ".upstash.io",
  ".turso.io",
  ".turso.tech",
  ".planetscale.com",
  ".psdb.cloud",
  ".cockroachlabs.cloud",
  ".mongodb-api.com",
  ".fauna.com",
  ".xata.sh",
  ".prisma-data.net",
];

/**
 * Path prefixes that identify a hosted database on a host we cannot recognise
 * — a self-hosted Supabase / PostgREST behind the project's own domain. Only
 * consulted when the hostname did not already answer, and only the prefix is
 * examined: the rest of the path (which is where a PostgREST filter carries
 * its column names and values) is never read here.
 */
export const HOSTED_DB_PATH_PREFIXES: readonly string[] = ["/rest/v1/"];

/**
 * Is this outbound call database work rather than ordinary API traffic?
 *
 * `host` is the bare hostname the outbound observer already normalised; `path`
 * is the request path. Pure, total, and cheap — it runs on every outbound
 * call. Never throws.
 */
export function isHostedDatabaseCall(host: unknown, path: unknown): boolean {
  try {
    const h = typeof host === "string" ? host.toLowerCase() : "";
    if (h) {
      for (const suffix of HOSTED_DB_HOST_SUFFIXES) {
        if (h === suffix || h.endsWith(suffix)) return true;
        // A suffix written with a leading dot also matches the bare apex.
        if (suffix.startsWith(".") && h === suffix.slice(1)) return true;
      }
    }
    const p = typeof path === "string" ? path : "";
    if (p) {
      for (const prefix of HOSTED_DB_PATH_PREFIXES) {
        if (p.startsWith(prefix)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/* ── Per-request tally ───────────────────────────────────────────────────── */

interface StatementTally {
  /** How many times this statement identity ran in this request. */
  n: number;
  /** Total ms spent across those runs. */
  ms: number;
}

/** One request's database work. Lives on the request scope the middleware
 *  already opens, so no second async-context carrier is needed. */
export interface DbRequestTally {
  failures: DbFailureCounts;
  statements: Map<number, StatementTally>;
  /** Database round trips watched in this request. */
  count: number;
  /**
   * Of `count`, how many came back an ERROR rather than a result — the driver
   * threw, rejected, or emitted `error`; for a hosted database reached over
   * the web, the reply was a 5xx/429 or the call never got one.
   *
   * Kept per REQUEST because one reading needs both halves of the same request
   * at once: how much of its data arrived, and what the response finally
   * carried. See docs/failure-containment.md. The database-work,
   * sequencing and row readings do not use this field and do not move because
   * it exists — a failed round trip is still a round trip that happened, and
   * they keep counting it exactly as they did.
   */
  failed: number;
  /** Total ms waited on the database in this request (calls may overlap). */
  ms: number;
  /** Of `count`, how many were a hosted database reached over the web. */
  hosted: number;
  /**
   * The largest number of ROWS a single statement handed back in this request.
   *
   * A row COUNT, never a row: no value, no column name and no table name is
   * read to obtain it. It is the one thing this meter can honestly say about
   * an unbounded result set — the rule book's advice to cap a query with LIMIT
   * and pagination describes exactly this, and without the count there would
   * be no measurement to anchor it to. A cursor or query stream reports none,
   * and reports it as "unknown" rather than as zero.
   */
  rowsWorst: number;
  /**
   * Every watched round trip as a flat [start, end, start, end, …] buffer on
   * this process's monotonic clock, in COMPLETION order.
   *
   * Two timestamps per call and nothing else: this is what makes "did these
   * queries run together or one after another?" answerable without reading a
   * single statement, table or column name. Swept once when the request ends
   * (see {@link sweepWaves}) and never uploaded — only the counts that come
   * off the sweep leave.
   */
  spans: number[];
  /** This request issued more calls than {@link DB_WAVE_MAX_CALLS}, so its
   *  buffer is incomplete and it takes no part in the sequencing reading. */
  spansOver: boolean;
  /** Rows handed back by the calls that reported a count, summed. A COUNT of
   *  rows, never a row. */
  rowsSum: number;
  /** How many calls reported a row count at all — a cursor or a stream
   *  reports none, and must not read as "returned nothing". */
  rowsCalls: number;
}

function tallyFor(scope: RequestWorkScope): DbRequestTally {
  let t = scope.db;
  if (!t) {
    t = {
      statements: new Map(),
      failures: emptyDbFailures(),
      count: 0,
      failed: 0,
      ms: 0,
      hosted: 0,
      rowsWorst: 0,
      spans: [],
      spansOver: false,
      rowsSum: 0,
      rowsCalls: 0,
    };
    scope.db = t;
  }
  return t;
}

/* ── Sequencing: waves, and the time that could not overlap ──────────────── */

/**
 * Record one round trip's in-flight window against a request.
 *
 * `start` is the instant the call was ISSUED and `end` the instant it
 * finished, both from this process's monotonic clock. Past the cap the buffer
 * stops growing and the request is marked over — a truncated buffer would
 * understate both its waves and its span, and a request that busy is exactly
 * the one a wrong answer would mislead about.
 */
function noteSpanAt(t: DbRequestTally, start: number, end: number): void {
  if (t.spansOver) return;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return;
  if (t.spans.length >= DB_WAVE_MAX_CALLS * 2) {
    t.spansOver = true;
    return;
  }
  t.spans.push(start, end);
}

/** Sort a flat [start, end, …] buffer by START then END, in place. Insertion
 *  sort on pairs: the buffer arrives in completion order, which is very nearly
 *  start order, and it is capped at {@link DB_WAVE_MAX_CALLS}.
 *
 *  The end-time tie-break is the ORDER the shared rule names (start, then end,
 *  then arrival) and it is not cosmetic: an instantaneous call is never in
 *  flight for anybody, so [5,9] swept before [5,5] would absorb the instant
 *  call into the long one's wave and report one wave where the rule says two.
 *  Sorting the shorter interval first makes the sweep read the same as every
 *  other kit. Stable on a full tie, so calls that both started and finished in
 *  the same instant keep the order they arrived in. */
function sortSpansByStart(spans: number[]): void {
  for (let i = 2; i < spans.length; i += 2) {
    const s = spans[i] as number;
    const e = spans[i + 1] as number;
    let j = i - 2;
    while (
      j >= 0 &&
      ((spans[j] as number) > s ||
        ((spans[j] as number) === s && (spans[j + 1] as number) > e))
    ) {
      spans[j + 2] = spans[j] as number;
      spans[j + 3] = spans[j + 1] as number;
      j -= 2;
    }
    spans[j + 2] = s;
    spans[j + 3] = e;
  }
}

/** What one request's sequencing sweep produced. */
export interface WaveSweep {
  /** Maximal chains of overlapping calls — 1 when everything overlapped, one
   *  per call when nothing did. */
  waves: number;
  /** Wall ms this request had at least one call outstanding (the union). */
  spanMs: number;
  /** Sum of the call durations. `spanMs` <= `sumMs`, always. */
  sumMs: number;
}

/**
 * Sweep one request's intervals into waves, union time and summed time.
 *
 * THE RULE, defined once for every kit in docs/db-round-trip-waves.md: a call
 * is in flight at instant `t` when `start <= t < end`; a call OPENS a wave
 * when nothing else is in flight at its start, otherwise it JOINS the wave
 * already running. Half-open deliberately — a call that ends exactly as the
 * next one starts was not in flight for it, so ten instant queries run back to
 * back read as ten waves rather than one.
 *
 * Mutates `spans` (sorts it in place) and never throws.
 */
export function sweepWaves(spans: number[]): WaveSweep {
  sortSpansByStart(spans);
  let waves = 0;
  let spanMs = 0;
  let sumMs = 0;
  let segStart = 0;
  let segEnd = 0;
  let open = false;
  for (let i = 0; i < spans.length; i += 2) {
    const s = spans[i] as number;
    const e = spans[i + 1] as number;
    sumMs += e - s;
    if (!open) {
      open = true;
      waves += 1;
      segStart = s;
      segEnd = e;
      continue;
    }
    if (s < segEnd) {
      // Something was still in flight when this call started: same wave.
      if (e > segEnd) segEnd = e;
      continue;
    }
    spanMs += segEnd - segStart;
    waves += 1;
    segStart = s;
    segEnd = e;
  }
  if (open) spanMs += segEnd - segStart;
  return { waves, spanMs, sumMs };
}

/* ── Session totals (the only things that ever leave) ────────────────────── */

/** Requests in which at least one database call was watched. */
let watchedRequests = 0;
/** Wall ms of those requests (the share denominator). */
let watchedRequestMs = 0;
/** Ms spent waiting on the database, clamped per request to that request's
 *  own wall time so overlapping queries can never push the share past 100%. */
let dbMs = 0;
/** Database round trips watched. */
let callCount = 0;
/** Of those, how many were a hosted database reached over the web. */
let hostedCalls = 0;
/** Worst number of identical statements inside a SINGLE request. */
let repeatWorst = 0;
/** Watched requests that ran the same statement more than once. */
let repeatRequests = 0;
/** Ms attributable to the redundant runs, clamped per request. */
let repeatMs = 0;
/** Largest single-statement row count seen in any watched request. */
let rowsWorst = 0;
/** Rows handed back by every call that reported a count, summed. */
let rowsSum = 0;
/** How many calls reported a row count at all. */
let rowsCalls = 0;
/** Requests whose sequencing was judged (see {@link DB_WAVE_MAX_CALLS}). */
let waveRequests = 0;
/** Round-trip waves across those requests. */
let wavesTotal = 0;
/** Most waves any single request took. */
let wavesWorst = 0;
/** Wall ms those requests spent with at least one call outstanding. */
let waveSpanMs = 0;
/** Sum of the call durations over the same requests — the denominator that
 *  turns the span into "how much of the database time could not overlap". */
let waveSumMs = 0;

/* ── Recording ───────────────────────────────────────────────────────────── */

/**
 * File one finished database round trip against a request scope CAPTURED WHEN
 * THE QUERY WAS ISSUED.
 *
 * Why the scope is passed in rather than read here: a pooled driver answers
 * on a socket it opened during some EARLIER request, and the async context a
 * completion callback runs in belongs to whoever created that socket. Reading
 * the ambient scope at completion time therefore files every query after the
 * first against a long-finished request — the tally is built, and then thrown
 * away unread when nothing folds it. A live install looks exactly like an app
 * that runs one query and stops. So the caller captures the scope at issue
 * time, where it is unambiguously right, and hands it here.
 *
 * `identity` is the in-process hash of the statement plus its arguments — it
 * never leaves this process, and the text it was built from was already
 * dropped. Never throws.
 */
export function noteDbCallIn(
  scope: RequestWorkScope | null,
  identity: number,
  durationMs: number,
  hosted: boolean,
  rows?: number,
  failed?: boolean,
  error?: unknown,
): void {
  if (isBoosthisDisabled() || isKitLocked()) return;
  try {
    if (!scope) return;
    const t = tallyFor(scope);
    const ms = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
    t.count += 1;
    if (failed === true) {
      t.failed += 1;
      countDbFailure(t.failures, dbFailure(error));
    }
    t.ms += ms;
    if (hosted) t.hosted += 1;
    // The in-flight window. The call is filed the moment it finishes, so
    // `now` IS its end instant and the issue instant is `end - duration` —
    // the same instant to the precision this kit already measures.
    const finishedAt = performance.now();
    noteSpanAt(t, finishedAt - ms, finishedAt);
    // A count, not the rows. Absent (a cursor, a stream, a failed call) leaves
    // the high-water mark alone rather than pushing a zero into it.
    if (typeof rows === "number" && Number.isFinite(rows) && rows >= 0) {
      const n = Math.floor(rows);
      if (n > t.rowsWorst) t.rowsWorst = n;
      t.rowsSum += n;
      t.rowsCalls += 1;
    }
    const seen = t.statements.get(identity);
    if (seen) {
      seen.n += 1;
      seen.ms += ms;
      return;
    }
    // Bounded: past the cap we stop LEARNING statements but keep counting the
    // ones already known, so a loop already spotted is still measured right.
    if (t.statements.size >= MAX_DISTINCT_STATEMENTS) return;
    t.statements.set(identity, { n: 1, ms });
  } catch {
    /* instrumentation must never disturb the host */
  }
}

/**
 * File a round trip against whatever request is in scope RIGHT NOW.
 *
 * Only safe where the caller is still standing in the issuing request's async
 * context. The driver wrapper deliberately does NOT use this — see
 * {@link noteDbCallIn} for why a completion callback is the wrong place to
 * ask. Work outside any request (a startup migration, a background job) finds
 * no scope and is not counted: it cannot be attributed to a request, so it
 * cannot honestly contribute to a per-request share. Never throws.
 */
export function noteDbCall(
  identity: number,
  durationMs: number,
  hosted: boolean,
  rows?: number,
  failed?: boolean,
  error?: unknown,
): void {
  noteDbCallIn(
    currentRequestScope(),
    identity,
    durationMs,
    hosted,
    rows,
    failed,
    error,
  );
}

/* ── Hosted-database pairing (undici create → headers/error) ─────────────── */

interface PendingHostedDb {
  /** Null for a call made outside a request — inside a job run, say. It is
   *  still linked to that run, and still never filed into a request tally. */
  scope: RequestWorkScope | null;
  /** The linked-step scope captured with it (linkedSteps.ts). */
  linked: LinkedScope | null;
  identity: number;
  start: number;
}

/** Keyed by undici's own per-call request object, so a call that never
 *  completes is collected with it — no unbounded map, no timers. */
const pendingHosted = new WeakMap<object, PendingHostedDb>();

/**
 * A hosted-database call started inside the current request. `target` is a
 * code-level description of the call (method + origin + path); it is hashed
 * immediately and never retained. Never throws.
 */
export function noteHostedDbStart(token: object, target: string): void {
  if (isBoosthisDisabled() || isKitLocked()) return;
  try {
    const scope = currentRequestScope();
    const linked = currentLinkedScope();
    if (!scope && !linked) return;
    pendingHosted.set(token, {
      scope,
      linked,
      identity: callIdentity(target, []),
      start: performance.now(),
    });
  } catch {
    /* instrumentation must never disturb the host */
  }
}

/** The paired end of {@link noteHostedDbStart} — files the call into the
 *  request that STARTED it, not whichever request is in scope when the
 *  response lands. `failed` is the reply's own verdict (5xx/429, or no reply at
 *  all); a boolean is all that is kept of it. Never throws. */
export function noteHostedDbEnd(token: object, failed?: boolean, detail?: { status?: number; error?: unknown }): void {
  if (isBoosthisDisabled() || isKitLocked()) return;
  try {
    const p = pendingHosted.get(token);
    if (!p) return;
    pendingHosted.delete(token);
    const ms = performance.now() - p.start;
    // The linked step first: it is the only filing a call made outside a
    // request gets (linkedSteps.ts). Only the same boolean travels.
    noteLinkedCall(p.linked, "database", p.start, p.start + (ms > 0 ? ms : 0), failed === true);
    if (!p.scope) return;
    const t = tallyFor(p.scope);
    t.count += 1;
    if (failed === true) {
      t.failed += 1;
      countDbFailure(t.failures, callFailure(detail?.status, detail?.error));
    }
    t.ms += ms > 0 ? ms : 0;
    t.hosted += 1;
    // This path holds the issue instant itself — nothing is reconstructed.
    noteSpanAt(t, p.start, p.start + (ms > 0 ? ms : 0));
    const seen = t.statements.get(p.identity);
    if (seen) {
      seen.n += 1;
      seen.ms += ms > 0 ? ms : 0;
      return;
    }
    if (t.statements.size >= MAX_DISTINCT_STATEMENTS) return;
    t.statements.set(p.identity, { n: 1, ms: ms > 0 ? ms : 0 });
  } catch {
    /* instrumentation must never disturb the host */
  }
}

/* ── Request lifecycle ───────────────────────────────────────────────────── */

/**
 * Fold one finished request's database work into the session totals.
 * `requestMs` is the request's own wall time — the denominator for both
 * shares. Called from the middleware's guaranteed-exit path, next to the
 * repeated-work close. Never throws; a request with no database work teaches
 * this meter nothing and is not counted as watched.
 */
export function endDbWork(
  scope: RequestWorkScope | null,
  requestMs: number,
): void {
  if (!scope) return;
  try {
    const t = scope.db;
    if (!t) return;
    scope.db = undefined;
    if (t.count === 0) return;
    if (isBoosthisDisabled() || isKitLocked()) return;
    // The start-up rule (latencyTail): first-connection setup, an ORM's first
    // schema reflection and migration checks ride the requests before the
    // process settled and each route's first request. Those are counted apart
    // and never folded into a graded figure.
    if (!requestSettled(scope, "latencyTail")) {
      settlingRequestCount += 1;
      t.statements.clear();
      t.spans.length = 0;
      return;
    }
    const wall = Number.isFinite(requestMs) && requestMs > 0 ? requestMs : 0;
    let worst = 0;
    let redundant = 0;
    for (const s of t.statements.values()) {
      if (s.n > worst) worst = s.n;
      // Mean duration × the redundant runs: we keep a total, not a list.
      if (s.n > 1) redundant += (s.ms / s.n) * (s.n - 1);
    }
    t.statements.clear();
    watchedRequests += 1;
    watchedRequestMs += wall;
    // Clamp to this request's own wall time: parallel queries can add up to
    // more than the request lasted, and a share above 100% is not a fact.
    dbMs += wall > 0 ? Math.min(t.ms, wall) : 0;
    callCount += t.count;
    for (const key of Object.keys(dbFailures) as (keyof DbFailureCounts)[]) dbFailures[key] += t.failures[key];
    hostedCalls += t.hosted;
    if (worst > repeatWorst) repeatWorst = worst;
    if (t.rowsWorst > rowsWorst) rowsWorst = t.rowsWorst;
    rowsSum += t.rowsSum;
    rowsCalls += t.rowsCalls;
    if (worst > 1) {
      repeatRequests += 1;
      repeatMs += wall > 0 ? Math.min(redundant, wall) : 0;
    }
    // Sequencing: one sweep, then the buffer is dropped. A request that blew
    // the cap is not judged here at all — every number above still counts it.
    if (!t.spansOver && t.spans.length > 0) {
      const sweep = sweepWaves(t.spans);
      waveRequests += 1;
      wavesTotal += sweep.waves;
      if (sweep.waves > wavesWorst) wavesWorst = sweep.waves;
      // A union cannot outlast the request that contained it.
      waveSpanMs += wall > 0 ? Math.min(sweep.spanMs, wall) : sweep.spanMs;
      waveSumMs += sweep.sumMs;
    }
    t.spans.length = 0;
  } catch {
    /* instrumentation must never disturb the host */
  }
}

/* ── Watching the client the app already loaded ──────────────────────────── */

/** Our own require handle into the host's CommonJS module cache. Built once,
 *  from the app's working directory, and used ONLY to read the cache and pull
 *  an ALREADY-CACHED module object back out. */
let hostRequire: NodeRequire | null | undefined;

function moduleCache(): Record<string, NodeModule> | null {
  if (hostRequire === undefined) {
    hostRequire = null;
    try {
      // STATIC import of node:module, deliberately — this kit ships as ESM
      // (`"type": "module"`), where a lazy `require("node:module")` throws into
      // a catch on every real install and leaves the meter silently dead while
      // every unit test passes (the test runner provides a `require` shim).
      const cwd = typeof process?.cwd === "function" ? process.cwd() : "";
      if (cwd) hostRequire = createRequire(`${cwd}/boosthis-db-work.cjs`);
    } catch {
      hostRequire = null;
    }
  }
  try {
    const cache = hostRequire?.cache;
    return cache ? (cache as unknown as Record<string, NodeModule>) : null;
  } catch {
    return null;
  }
}

function normalizeKey(key: string): string {
  return key.replace(/\\/g, "/");
}

/** The cache key of an already-loaded module whose path ends with `suffix`,
 *  or null. Reads the host's module cache; never loads anything. */
function cachedKeyEndingWith(suffix: string): string | null {
  const cache = moduleCache();
  if (!cache) return null;
  try {
    for (const key of Object.keys(cache)) {
      if (normalizeKey(key).endsWith(suffix)) return key;
    }
  } catch {
    /* a hostile or exotic cache object is simply "not found" */
  }
  return null;
}

/** Has the host loaded any file belonging to package `name`? Directory-segment
 *  match, so `mysql` never answers for `mysql2`.
 *
 *  Exported (as {@link hostPackageIsLoaded}) so the outside-dependency meter can
 *  ask the same question about a sign-in library without opening a SECOND
 *  handle into the host's module cache — and without a second copy of this
 *  walk drifting away from this one. It reads the cache and nothing else: no
 *  module is ever loaded, resolved or imported to answer it. */
function packageIsLoaded(name: string): boolean {
  const cache = moduleCache();
  if (!cache) return false;
  const needle = `/node_modules/${name}/`;
  try {
    for (const key of Object.keys(cache)) {
      if (normalizeKey(key).includes(needle)) return true;
    }
  } catch {
    /* treat an unreadable cache as "nothing loaded" */
  }
  return false;
}

/** library → our observation is currently in place. */
const installed: Record<string, boolean> = {};
/** Every method we replaced: [library, owner, attribute, original, wrapper].
 *  The WRAPPER is kept so a restore can check ours is still the callable in
 *  place before putting the original back. */
const patches: Array<
  [string, Record<string, unknown>, string, unknown, unknown]
> = [];

interface PgPoolLike {
  totalCount?: unknown;
  idleCount?: unknown;
  waitingCount?: unknown;
  options?: { max?: unknown };
  ended?: unknown;
}

/** Pools created after observation is armed. Weak references are essential:
 * telemetry must never keep a host pool alive. A pool constructed before the
 * kit armed cannot be discovered from pg's public API, so it is deliberately
 * absent rather than guessed. */
const observedPools = new Set<WeakRef<object>>();
/** Pools already registered. One pool must be observed ONCE: a Set of
 *  WeakRefs cannot spot a duplicate (every `new WeakRef` is a different
 *  object), so a pool re-offered on every query counted its capacity again
 *  each time — a two-connection pool read as a pool of 232 after 116 calls,
 *  and the occupancy share it feeds became meaningless. */
let observedPoolSeen = new WeakSet<object>();
const poolFinalizer =
  typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry<WeakRef<object>>((ref) =>
        observedPools.delete(ref),
      )
    : null;

function observePgPool(pool: object): void {
  try {
    if (observedPoolSeen.has(pool)) return;
    observedPoolSeen.add(pool);
    const ref = new WeakRef(pool);
    observedPools.add(ref);
    poolFinalizer?.register(pool, ref, ref);
  } catch {
    /* observing a pool must never disturb its constructor */
  }
}
/** Whether arming has ever been ATTEMPTED. Before that the kit claims nothing
 *  and the honesty report stays silent: an axis that has not started is not a
 *  blind spot. */
let armAttempted = false;
/** Live switch: a disarm that cannot restore a method still stops the feed. */
let active = false;
/** Throttle: the module cache is scanned at most this often while a watchable
 *  client is still missing, so arming costs nothing on a hot request path. */
const ARM_RETRY_MS = 1_000;
let lastArmAt = 0;

/** Pull the statement text and its arguments out of whatever `client.query`
 *  was handed. Both are read on this stack, folded into a hash, and dropped. */
function statementIdentity(args: readonly unknown[]): number | null {
  try {
    const first = args[0];
    let text = "";
    let values: readonly unknown[] = [];
    if (typeof first === "string") {
      text = first;
      if (Array.isArray(args[1])) values = args[1] as unknown[];
    } else if (first && typeof first === "object") {
      const cfg = first as { text?: unknown; values?: unknown; name?: unknown };
      if (typeof cfg.text === "string") text = cfg.text;
      else if (typeof cfg.name === "string") text = cfg.name;
      if (Array.isArray(cfg.values)) values = cfg.values as unknown[];
    }
    if (!text) return null;
    if (text.length > MAX_SQL_CHARS) text = text.slice(0, MAX_SQL_CHARS);
    return callIdentity(text, values);
  } catch {
    return null;
  }
}

/**
 * How many rows a finished query handed back, or undefined when the shape does
 * not say.
 *
 * Reads a COUNT and nothing else — never a row, a value, a column name or a
 * table name. `rowCount` is null for a statement that returns no rows (a
 * DDL), which is honestly "no result set" rather than a large one, so the
 * array length is the fallback and an unrecognised shape reports nothing at
 * all instead of a zero.
 */
function rowCountOf(result: unknown): number | undefined {
  try {
    if (!result || typeof result !== "object") return undefined;
    const r = result as { rowCount?: unknown; rows?: unknown };
    if (typeof r.rowCount === "number" && Number.isFinite(r.rowCount)) {
      return r.rowCount;
    }
    if (Array.isArray(r.rows)) return r.rows.length;
    return undefined;
  } catch {
    return undefined;
  }
}

/** Watch `pg`'s round-trip layer, if the app already loaded it. */
function installPg(entryKey: string): boolean {
  const req = hostRequire;
  if (!req) return false;
  let mod: unknown;
  try {
    // Already in the cache (that is how we found the key), so this hands back
    // the module the host loaded. Nothing new is ever loaded here.
    mod = req(entryKey);
  } catch {
    return false;
  }
  const pkg = (
    mod && typeof mod === "object"
      ? ((mod as { default?: unknown }).default ?? mod)
      : null
  ) as {
    Client?: { prototype?: Record<string, unknown> };
    Pool?: new (...args: unknown[]) => object;
  } | null;
  const proto = pkg?.Client?.prototype;
  if (!proto) return false;
  const original = proto.query;
  if (typeof original !== "function") return false;
  const real = original as (...a: unknown[]) => unknown;
  const observed = makeObservedQuery(real);
  patches.push(["pg", proto, "query", original, observed]);
  proto.query = observed;

  // Pool.query delegates to Client.query and remains intentionally unpatched.
  // Replacing only the cached package's constructor observes pools created
  // from now on without loading pg or asking the app to register them.
  const RealPool = pkg?.Pool;
  if (pkg && typeof RealPool === "function") {
    try {
      const ObservedPool = class extends RealPool {
        constructor(...args: unknown[]) {
          super(...args);
          observePgPool(this);
        }
      };
      patches.push([
        "pg",
        pkg as unknown as Record<string, unknown>,
        "Pool",
        RealPool,
        ObservedPool,
      ]);
      pkg.Pool = ObservedPool;
    } catch {
      /* query observation remains useful if this export cannot be replaced */
    }

    // A pool built from a binding taken BEFORE arming never passes through the
    // replaced constructor. An ESM app that wrote `import { Pool } from "pg"`
    // holds the original class itself, and nothing assigned to the package
    // object can reach it — the pool then reported no occupancy at all, which
    // reads exactly like an app with no pool. Remembering the receiver on the
    // pool's own methods catches those too.
    //
    // NEITHER wrapper counts a query. `Pool.query` still delegates to the
    // patched `Client.query`, so counting here would count one round trip
    // twice; all these do is note which pool is in use.
    const poolProto = (RealPool as { prototype?: Record<string, unknown> })
      .prototype;
    if (poolProto) {
      for (const name of ["connect", "query"]) {
        try {
          const originalMethod = poolProto[name];
          if (typeof originalMethod !== "function") continue;
          const realMethod = originalMethod as (...a: unknown[]) => unknown;
          const remembered = function (
            this: object,
            ...args: unknown[]
          ): unknown {
            observePgPool(this);
            return realMethod.apply(this, args);
          };
          patches.push(["pg", poolProto, name, originalMethod, remembered]);
          poolProto[name] = remembered;
        } catch {
          /* a pool method we cannot replace is one pool we cannot read */
        }
      }
    }
  }
  return true;
}

/**
 * Build the wrapper that goes around a client's own `query`.
 *
 * Separated from the module lookup so the host-safety rules it has to keep can
 * be exercised directly against a stand-in client — above all that the host's
 * `query` is invoked EXACTLY once however it fails, which a wrapper that
 * guards its own call site cannot promise.
 */
function makeObservedQuery(
  real: (...a: unknown[]) => unknown,
): (this: unknown, ...args: unknown[]) => unknown {
  return function observed(this: unknown, ...args: unknown[]): unknown {
    if (!active) return real.apply(this, args);
    const started = performance.now();
    // Capture the issuing request HERE, on the host's own stack, while the
    // answer is still unambiguous. A pooled driver replies on a socket it
    // opened during an earlier request, so by the time the completion runs the
    // ambient scope is that earlier request's — see noteDbCallIn.
    const scope = currentRequestScope();
    // …and the linked-step scope, for the same reason and at the same moment:
    // the request (or job run) this round trip is a step of (linkedSteps.ts).
    const linked = currentLinkedScope();
    let identity: number | null = null;
    try {
      identity = statementIdentity(args);
    } catch {
      identity = null;
    }
    // One round trip is one filing. Every path below (callback, promise,
    // stream, synchronous throw) goes through here, and a driver that both
    // calls the callback AND throws still counts once.
    let filed = false;
    // `failed` is the driver's own verdict on THIS round trip, taken from the
    // path the call came back on (threw / rejected / emitted `error`) and never
    // from anything inside the error. No message, code, statement or value is
    // read: a boolean leaves this closure and nothing else.
    const file = (rows?: number, failed?: boolean, error?: unknown): void => {
      if (filed) return;
      filed = true;
      // The linked step carries no statement, so it needs no identity: a
      // round trip whose text could not be hashed was still a step of its
      // request. Only the word `database`, the timing and the boolean leave.
      noteLinkedCall(linked, "database", started, performance.now(), failed === true);
      if (identity === null) return;
      noteDbCallIn(
        scope,
        identity,
        performance.now() - started,
        false,
        rows,
        failed,
        error,
      );
    };
    // Callback style: `query(text, values, cb)`. The host's callback is
    // wrapped so the round trip is timed without changing what it receives.
    //
    // The wrapping is the only thing guarded here. The host's own call is made
    // BELOW, outside this try — a guard around it would swallow a synchronous
    // driver error and fall through to the plain branch, running the host's
    // query a second time.
    let wrapped = false;
    try {
      const last = args.length > 0 ? args[args.length - 1] : undefined;
      if (typeof last === "function") {
        const cb = last as (...cbArgs: unknown[]) => unknown;
        args[args.length - 1] = function (this: unknown, ...cbArgs: unknown[]) {
          try {
            // node-style (err, result): the row COUNT only, and only when
            // the call succeeded. A non-null first argument IS the driver
            // saying this round trip failed — the only thing read off it.
            file(
              cbArgs[0] == null ? rowCountOf(cbArgs[1]) : undefined,
              cbArgs[0] != null,
              cbArgs[0],
            );
          } catch {
            /* never disturb the host callback */
          }
          return cb.apply(this, cbArgs);
        };
        wrapped = true;
      }
    } catch {
      /* wrapping failed — the host's arguments are untouched, so the call
         below is made exactly as it was written */
    }
    if (wrapped) {
      try {
        return real.apply(this, args);
      } catch (err) {
        // The wrapped callback will never run now, so this is the round trip's
        // only chance to be counted. The host's throw is re-thrown untouched.
        try {
          file(undefined, true, err);
        } catch {
          /* never disturb the host's own throw */
        }
        throw err;
      }
    }
    let out: unknown;
    try {
      out = real.apply(this, args);
    } catch (err) {
      try {
        file(undefined, true, err);
      } catch {
        /* never disturb the host's own throw */
      }
      throw err;
    }
    try {
      const thenable = out as { then?: unknown } | null;
      if (thenable && typeof thenable.then === "function") {
        // Return the DERIVED promise, not the original. Attaching a rejection
        // handler to a promise marks it handled, so observing the original and
        // returning it would silently suppress an unhandled rejection the host
        // would otherwise have seen. Re-throwing here keeps the host's failure
        // semantics exactly as they were.
        return (out as Promise<unknown>).then(
          (v) => {
            try {
              file(rowCountOf(v));
            } catch {
              /* never disturb the host's value */
            }
            return v;
          },
          (err) => {
            try {
              file(undefined, true, err);
            } catch {
              /* never disturb the host's error */
            }
            throw err;
          },
        );
      }
      // A Submittable (a cursor or a query stream) — the host gets it back
      // untouched and we listen for its own completion events. A shape with
      // neither a promise nor events is left uncounted rather than timed at
      // zero, which would quietly deflate the share.
      const emitter = out as { once?: unknown } | null;
      if (emitter && typeof emitter.once === "function") {
        let done = false;
        const finish = (failed: boolean, error?: unknown): void => {
          if (done) return;
          done = true;
          try {
            file(undefined, failed, error);
          } catch {
            /* never disturb the host stream */
          }
        };
        const once = emitter.once as (ev: string, fn: (error?: unknown) => void) => unknown;
        // Wrapped rather than handed `finish` directly: a listener is called
        // with the event's own arguments, and only the `error` event means
        // this round trip failed. Passing the same function to all three would
        // read a stream's payload as the failure flag.
        once.call(emitter, "end", () => finish(false));
        once.call(emitter, "error", (error) => finish(true, error));
        once.call(emitter, "close", () => finish(false));
      }
    } catch {
      /* observation failed — the host's own result is already on its way back */
    }
    return out;
  };
}

/**
 * Arm database observation, if the host has loaded a client we can watch.
 *
 * Called from the request boundary (the same place the outbound observer arms)
 * so importing the kit costs nothing until the app actually serves traffic,
 * and so a driver required lazily on the first request is still caught. The
 * module-cache scan is throttled, and the whole thing is a no-op once the
 * client is watched. Never throws.
 */
export function armDbClients(): void {
  if (isBoosthisDisabled() || isKitLocked()) return;
  try {
    const now = Date.now();
    if (armAttempted && now - lastArmAt < ARM_RETRY_MS) return;
    lastArmAt = now;
    armAttempted = true;
    active = true;
    for (const client of WATCHABLE_DB_CLIENTS) {
      if (installed[client.name]) continue;
      const key = cachedKeyEndingWith(client.file);
      if (!key) continue;
      if (client.name === "pg") installed[client.name] = installPg(key);
    }
  } catch {
    /* arming must never disturb the host */
  }
}

/**
 * Put back every method we replaced and switch the feed off.
 *
 * A method is restored only while OUR wrapper is still the one in place: if a
 * host library patched on top of us since, writing back what we captured at
 * arming time would silently delete THEIR work, so our wrapper stays where it
 * is instead — inert, because the feed is switched off first. Never throws.
 */
export function unpatchDbClients(): void {
  active = false;
  try {
    for (const [name, owner, attr, original, wrapper] of patches.splice(0)) {
      try {
        if (owner[attr] === wrapper) owner[attr] = original;
      } catch {
        /* best-effort */
      }
      installed[name] = false;
    }
  } catch {
    /* best-effort */
  }
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

/**
 * How many database libraries this app loaded that the kit cannot watch.
 *
 * A blind spot only exists while the kit is actually watching: it means "we
 * are reporting on this app's database work, and some of it we cannot see". So
 * whenever observation is not running this reports ZERO rather than a blind
 * spot — the axis is then simply absent, which is the honest, pre-existing
 * answer.
 *
 * Counts only: a library NAME never leaves this process. Never throws.
 */
export function unwatchedDbClientCount(): number {
  if (!armAttempted || !active || isBoosthisDisabled()) return 0;
  let n = 0;
  try {
    for (const client of WATCHABLE_DB_CLIENTS) {
      // Loaded but our patch did not take — a watchable client we are blind to.
      if (!installed[client.name] && cachedKeyEndingWith(client.file)) n += 1;
    }
    for (const name of UNWATCHABLE_DB_CLIENTS) {
      if (packageIsLoaded(name)) n += 1;
    }
  } catch {
    return 0;
  }
  return n;
}

/**
 * Has the host already loaded package `name`? A read of the host's CommonJS
 * module cache and nothing more — no module is loaded, resolved or imported to
 * answer it, and the answer is a boolean, never a name.
 *
 * Shared with the outside-dependency meter, which uses it to recognise a
 * sign-in library that runs INSIDE the app and therefore makes no outbound
 * call to classify.
 */
export function hostPackageIsLoaded(name: string): boolean {
  return packageIsLoaded(name);
}

/** Session totals for the `dbWork` axis. Numbers only. */
let settlingRequestCount = 0;
let dbFailures = emptyDbFailures();
export function getDbFailures(): DbFailureCounts { return { ...dbFailures }; }

/** Requests with database work that the start-up rule kept out of the graded
 *  figures (before the process settled, or a route's first request). */
export function dbWorkSettlingRequests(): number {
  return settlingRequestCount;
}

export function getDbWorkStats(): DbWorkStatsLike {
  return {
    watchedRequests,
    watchedRequestMs,
    dbMs,
    callCount,
    hostedCalls,
    repeatWorst,
    repeatRequests,
    repeatMs,
    rowsWorst,
    unwatchedClients: unwatchedDbClientCount(),
  };
}

/**
 * The sequencing reading's numbers: how many round-trip waves requests took,
 * and how much of the database time could not overlap with anything.
 *
 * Separate from {@link getDbWorkStats} on purpose — that reading's shape is
 * matched field for field by the edge kit and asserted by a parity guard, and
 * this one must not move it.
 */
export function getDbSequencingStats(): DbSequencingStatsLike {
  return {
    waveRequests,
    wavesTotal,
    wavesWorst,
    spanMs: waveSpanMs,
    sumMs: waveSumMs,
    unwatchedClients: unwatchedDbClientCount(),
  };
}

/** The row-volume reading's numbers: how much a query handed back, as counts
 *  only. No row, value, column name or table name is read to obtain them. */
export function getDbRowVolumeStats(): DbRowVolumeStatsLike {
  return {
    watchedRequests,
    rowsWorst,
    rowsSum,
    rowsCalls,
    unwatchedClients: unwatchedDbClientCount(),
  };
}

/** Aggregate live pg pools. Occupancy is additive, so busy/idle/capacity are
 * summed. Waiting is simultaneous queue depth, so MAX is the honest aggregate:
 * summing unrelated queues would imply they contend for one resource. */
export function getDbPoolPressureStats(): DbPoolPressureStatsLike | null {
  if (!active || isBoosthisDisabled()) return null;
  let busy = 0;
  let idle = 0;
  let waiting = 0;
  let size = 0;
  let read = false;
  try {
    for (const ref of [...observedPools]) {
      const pool = ref.deref() as PgPoolLike | undefined;
      if (!pool) {
        observedPools.delete(ref);
        continue;
      }
      if (pool.ended === true) continue;
      const totalN = Number(pool.totalCount);
      const idleN = Number(pool.idleCount);
      const waitingN = Number(pool.waitingCount);
      const sizeN = Number(pool.options?.max);
      if (
        !Number.isFinite(totalN) ||
        !Number.isFinite(idleN) ||
        !Number.isFinite(waitingN) ||
        !Number.isFinite(sizeN) ||
        sizeN <= 0
      ) {
        continue;
      }
      busy += Math.max(0, Math.round(totalN - idleN));
      idle += Math.max(0, Math.round(idleN));
      size += Math.max(1, Math.round(sizeN));
      waiting = Math.max(waiting, Math.max(0, Math.round(waitingN)));
      read = true;
    }
  } catch {
    return null;
  }
  return read ? { busy, idle, waiting, size } : null;
}

/** Wipe all state and detach every observation (wired into `forget()` so
 *  nothing Boosthis-shaped keeps counting after erasure). Idempotent. */
export function clearDbWork(): void {
  dbFailures = emptyDbFailures();
  settlingRequestCount = 0;
  unpatchDbClients();
  armAttempted = false;
  lastArmAt = 0;
  watchedRequests = 0;
  watchedRequestMs = 0;
  dbMs = 0;
  callCount = 0;
  hostedCalls = 0;
  repeatWorst = 0;
  repeatRequests = 0;
  repeatMs = 0;
  rowsWorst = 0;
  rowsSum = 0;
  rowsCalls = 0;
  waveRequests = 0;
  wavesTotal = 0;
  wavesWorst = 0;
  waveSpanMs = 0;
  waveSumMs = 0;
  for (const ref of observedPools) {
    const pool = ref.deref();
    if (pool) poolFinalizer?.unregister(ref);
  }
  observedPools.clear();
  // Forget must leave no pool half-registered: the de-duplication set is
  // dropped WITH the refs, so a pool still in use is observed again the next
  // time the app touches it rather than silently never again.
  observedPoolSeen = new WeakSet<object>();
}

/** @internal test hooks. */
export const _dbWorkInternals = {
  MAX_DISTINCT_STATEMENTS,
  MAX_SQL_CHARS,
  DB_WAVE_MAX_CALLS,
  sweepWaves,
  WATCHABLE_DB_CLIENTS,
  UNWATCHABLE_DB_CLIENTS,
  statementIdentity,
  makeObservedQuery,
  observePgPool,
  isArmed: (): boolean => active,
  isInstalled: (name: string): boolean => installed[name] === true,
};
