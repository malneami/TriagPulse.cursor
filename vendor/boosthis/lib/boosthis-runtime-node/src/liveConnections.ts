/* ─── Boosthis: long-lived connection watcher (Node) ──────────────────────
 *
 * The server half of the Live Connections axis. Everything else this kit
 * measures is a request that STARTED and FINISHED. A chat socket, a live
 * dashboard feed, a presence channel or a streamed AI answer does neither for
 * minutes at a time, so a server holding four thousand dead sockets and a
 * server holding four thousand busy ones look identical in every other reading.
 *
 * TWO KINDS OF CONNECTION ARE SEEN, and they are seen differently:
 *
 *   1. UPGRADED SOCKETS (WebSocket and anything else that upgrades). Caught at
 *      `http.Server`'s own `upgrade` event, so the socket is seen whichever
 *      library goes on to speak the protocol on it. We never read a byte of it:
 *      liveness comes from sampling the socket's own `bytesRead`/`bytesWritten`
 *      counters, which costs nothing and cannot take data away from the library
 *      that owns the stream. Because we watch bytes and not frames, MESSAGE
 *      COUNTS ARE NOT KNOWABLE for these — the axis says so rather than
 *      guessing.
 *   2. SERVER-SENT STREAMS. Caught in the middleware, by content type, on the
 *      first write. Here the app itself marks the boundaries, so messages ARE
 *      countable.
 *
 * GUEST SAFETY: the `upgrade` patch always forwards; no listener is added that
 * could change stream mode; every callback body is guarded; the sampler timer
 * is `unref`-ed so it can never hold a process open; installation is
 * idempotent and fully undone by `clearLiveConnections()`.
 *
 * PRIVACY: counts, byte TOTALS, durations. Never a URL, header, address, frame
 * or payload. The endpoint a connection points at is folded to a 32-bit number
 * in memory purely to group reconnects, and is never uploaded.
 */

import * as nodeHttp from "node:http";
import * as nodeHttps from "node:https";

import { isBoosthisDisabled } from "./runtimeFlags";
import { isHeldOpenContentType, markUpgraded } from "./heldOpen";
import { linearScore, ratingFor } from "./healthAxes";
import type { ExtraAxis } from "./extraMeters";
import type { CrossCuttingFinding } from "./candidateRules";

import { earnedPerHour, earnedPerMin, windowMinOf } from "./rateHonesty";
import { markSettled } from "./settleRule";
/* ── Judgement constants — identical in the browser and phone kits ──────── */

/** Silence past this makes an open connection "quiet" and worth asking about. */
export const LIVECONN_QUIET_MS = 30_000;
/** Activity gaps needed before a connection's rhythm is known well enough to
 *  judge a silence against. Below this the reading abstains. */
export const LIVECONN_CADENCE_MIN_GAPS = 5;
/** Silence beyond this multiple of the connection's own typical gap is a stop,
 *  not a rest. */
export const LIVECONN_DEAD_GAP_MULTIPLE = 6;
/** A new connection to the same endpoint within this of the last one ending is
 *  a reconnect. */
export const LIVECONN_RECONNECT_LINK_MS = 60_000;
/** Window the reconnect-storm test looks back over. */
export const LIVECONN_STORM_WINDOW_MS = 60_000;
/** Reconnects inside that window before it counts as a storm. */
export const LIVECONN_STORM_THRESHOLD = 5;
/** Median reconnect gap below which there is no real back-off. A client that
 *  widens its gaps is behaving and is never faulted for reconnecting often. */
export const LIVECONN_STORM_BACKOFF_MS = 2_000;
/** Minimum observation before the axis reports anything at all. Deliberately
 *  SHORTER than the earned-rate window (rateHonesty.ts): what this axis mostly
 *  reports — sockets open, dropped, quiet, never closed — is counted, not
 *  projected, and a dropped connection must be visible the moment it happens.
 *  Only the per-hour and per-minute fields wait for the longer window. */
export const LIVECONN_MIN_WINDOW_MS = 30_000;
/** How old an open connection must be to count toward "never closed". */
export const LIVECONN_LEAK_AGE_MS = 5 * 60_000;
/** How many such connections make "never closed" the likelier story. */
export const LIVECONN_LEAK_MIN_OPEN = 8;
/** The shared decision (liveConnections): a pool that opens its connections
 *  once and keeps them is intentional persistence, not a leak. Aged
 *  connections count as never closed only while the open count GREW by
 *  LIVECONN_LEAK_MIN_OPEN since the reference point: the start of this
 *  window, never earlier than one leak age after the first connection. The
 *  Python kit draws the same line over the same window. */
export const LIVECONN_GROWTH_WINDOW_MS = 30 * 60_000;
/** Unexpected disconnects per hour at or below which connections are behaving
 *  normally — clients come and go, and one that reopens straight away is not a
 *  fault. The score and the wording of the caption read this one number, so the
 *  words can never name a fault the rating forgives. */
export const LIVECONN_DROPS_OK_PER_HOUR = 0.5;
/** How often the byte counters of upgraded sockets are read. */
export const LIVECONN_SAMPLE_MS = 5_000;

/** Bounded memory: a server with more simultaneous connections than this is
 *  measured on a sample of them rather than growing our bookkeeping. */
const MAX_TRACKED = 500;
const MAX_GAPS = 64;
const MAX_REOPEN_STAMPS = 32;

const PATCH_MARK = Symbol.for("boosthis.liveConnections.upgrade");

type Transport = "socket" | "stream";

interface Conn {
  endpoint: number;
  transport: Transport;
  openedAt: number;
  lastSeenAt: number;
  gaps: number[];
  /** Messages, for streams only. A socket never sets this. */
  messages: number;
  closedAt: number | null;
  clean: boolean;
  /** Last observed byte total, for the socket sampler. */
  bytes: number;
  /** The live object, released the moment the connection ends. */
  handle: Record<string, unknown> | null;
}

let started = false;
let observedAny = false;
let firstSeenAt = 0;
let sampler: ReturnType<typeof setInterval> | null = null;
const conns: Conn[] = [];
const reopens = new Map<number, number[]>();
const lastEnd = new Map<number, number>();

let opened = 0;
let closed = 0;
let drops = 0;
let reconnects = 0;
let streamMessages = 0;
let peakOpen = 0;
let stormPeak = 0;
/** Set once an upgraded socket is tracked: message counts stop being knowable
 *  for the connection set as a whole. */
let anyOpaque = false;

const undo: Array<() => void> = [];
let now: () => number = () => Date.now();

function fold(input: unknown): number {
  let h = 0x811c9dc5;
  try {
    const s = String(input ?? "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
  } catch {
    return 0;
  }
  return h >>> 0;
}

function med(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

function medGap(ascending: number[]): number {
  if (ascending.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < ascending.length; i++) {
    gaps.push(ascending[i]! - ascending[i - 1]!);
  }
  return med(gaps);
}

function openCount(): number {
  let n = 0;
  for (const c of conns) if (c.closedAt === null) n++;
  return n;
}

function noteReopen(endpoint: number, at: number): void {
  let stamps = reopens.get(endpoint);
  if (!stamps) {
    if (reopens.size >= MAX_TRACKED) return;
    stamps = [];
    reopens.set(endpoint, stamps);
  }
  stamps.push(at);
  const cutoff = at - LIVECONN_STORM_WINDOW_MS;
  while (stamps.length > 0 && stamps[0]! < cutoff) stamps.shift();
  while (stamps.length > MAX_REOPEN_STAMPS) stamps.shift();
  if (
    stamps.length >= LIVECONN_STORM_THRESHOLD &&
    medGap(stamps) < LIVECONN_STORM_BACKOFF_MS &&
    stamps.length > stormPeak
  ) {
    stormPeak = stamps.length;
  }
}

function open(
  endpoint: number,
  transport: Transport,
  handle: Record<string, unknown> | null,
): Conn | null {
  const at = now();
  if (!observedAny) {
    observedAny = true;
    firstSeenAt = at;
  }
  opened++;
  if (transport === "socket") anyOpaque = true;
  const prev = lastEnd.get(endpoint);
  if (prev !== undefined && at - prev <= LIVECONN_RECONNECT_LINK_MS) {
    reconnects++;
    noteReopen(endpoint, at);
  }
  if (conns.length >= MAX_TRACKED) {
    const idx = conns.findIndex((c) => c.closedAt !== null);
    if (idx >= 0) conns.splice(idx, 1);
    else return null;
  }
  const conn: Conn = {
    endpoint,
    transport,
    openedAt: at,
    lastSeenAt: at,
    gaps: [],
    messages: 0,
    closedAt: null,
    clean: false,
    bytes: 0,
    handle,
  };
  conns.push(conn);
  const live = openCount();
  if (live > peakOpen) peakOpen = live;
  ensureSampler();
  return conn;
}

function activity(conn: Conn, at: number): void {
  const gap = at - conn.lastSeenAt;
  if (gap > 0) {
    conn.gaps.push(gap);
    if (conn.gaps.length > MAX_GAPS) conn.gaps.shift();
  }
  conn.lastSeenAt = at;
}

function close(conn: Conn, clean: boolean): void {
  try {
    if (conn.closedAt !== null) return;
    const at = now();
    conn.closedAt = at;
    conn.clean = clean;
    conn.handle = null;
    closed++;
    if (!clean) drops++;
    lastEnd.set(conn.endpoint, at);
    if (openCount() === 0) stopSampler();
  } catch {
    /* bookkeeping never disturbs the host */
  }
}

/* ── The byte sampler ─────────────────────────────────────────────────────
 * An upgraded socket's traffic is owned by whichever library speaks the
 * protocol on it. Reading `bytesRead`/`bytesWritten` observes that traffic
 * without touching the stream — no listener, no mode change, nothing removed
 * from the library's own flow. */

function ensureSampler(): void {
  if (sampler) return;
  try {
    sampler = setInterval(sampleSockets, LIVECONN_SAMPLE_MS);
    (sampler as unknown as { unref?: () => void }).unref?.();
  } catch {
    sampler = null;
  }
}

function stopSampler(): void {
  try {
    if (sampler) clearInterval(sampler);
  } catch {
    /* ignore */
  }
  sampler = null;
}

/** Read every open socket's byte totals once and record a change as activity.
 *  Exported for tests and for the live-proof rig, which drives the clock. */
export function sampleSockets(): void {
  try {
    const at = now();
    for (const conn of conns) {
      if (conn.closedAt !== null || conn.transport !== "socket") continue;
      const h = conn.handle;
      if (!h) continue;
      const read = typeof h.bytesRead === "number" ? h.bytesRead : 0;
      const written = typeof h.bytesWritten === "number" ? h.bytesWritten : 0;
      const total = read + written;
      if (total > conn.bytes) {
        conn.bytes = total;
        activity(conn, at);
      }
    }
  } catch {
    /* a socket that refuses to answer is simply not sampled */
  }
}

/* ── Wiring ───────────────────────────────────────────────────────────────*/

interface ProtoLike {
  emit?: (event: string, ...args: unknown[]) => boolean;
}

function watchUpgrade(proto: ProtoLike | undefined): (() => void) | null {
  try {
    if (!proto || typeof proto.emit !== "function") return null;
    const original = proto.emit;
    if ((original as unknown as Record<symbol, unknown>)[PATCH_MARK] === true) {
      return () => {
        /* someone else's copy of the kit owns this */
      };
    }
    const patched = function boosthisUpgradeEmit(
      this: unknown,
      event: string,
      ...args: unknown[]
    ): boolean {
      if (event === "upgrade") {
        try {
          noteUpgrade(args[0], args[1]);
        } catch {
          /* the upgrade always proceeds */
        }
      }
      return original.call(this as never, event, ...args);
    };
    Object.defineProperty(patched, PATCH_MARK, { value: true });
    proto.emit = patched as ProtoLike["emit"];
    if (proto.emit !== (patched as unknown as ProtoLike["emit"])) return null;
    return () => {
      try {
        if (proto.emit === (patched as unknown as ProtoLike["emit"])) {
          proto.emit = original;
        }
      } catch {
        /* our wrapper forwards everything, so leaving it is safe */
      }
    };
  } catch {
    return null;
  }
}

/** Register one upgraded socket. Exported so a host that terminates upgrades
 *  somewhere we cannot see (a proxy layer, a framework that swallows the
 *  event) can hand its socket over explicitly. Counts only — the socket is
 *  never read from. */
export function noteUpgrade(req: unknown, socket: unknown): void {
  if (isBoosthisDisabled()) return;
  // Tell the request boundary, whatever happens to the bookkeeping below: a
  // framework that also runs its middleware stack over an upgraded request
  // (express-ws and kin) would otherwise time the socket's whole lifetime as
  // one request, because the handshake was written to the socket and the
  // response object it is timing never carried a 101. ONE definition of "held
  // open", shared with the latency family (docs/held-open-calls.md).
  markUpgraded(req);
  if (!started) return;
  try {
    const url = (req as { url?: unknown } | null)?.url;
    const conn = open(fold(url), "socket", socket as Record<string, unknown>);
    if (!conn) return;
    const s = socket as {
      once?: (e: string, f: (...a: unknown[]) => void) => unknown;
      readableEnded?: boolean;
    };
    if (typeof s.once === "function") {
      s.once("close", (hadError?: unknown) => {
        // A client that says goodbye sends a FIN, so the readable side ends
        // first. A cable pulled, a phone that slept, a proxy that gave up:
        // no FIN, or an error. That is the difference between "they left" and
        // "it dropped", and it is the only honest one available here.
        const errored = hadError === true;
        const finished = s.readableEnded === true;
        close(conn, !errored && finished);
      });
    }
  } catch {
    /* never disturb the upgrade */
  }
}

/**
 * Offer one response to the watcher. Called from the middleware for every
 * request; only server-sent streams are adopted, and only on their first
 * write, so an ordinary request costs one property read.
 */
export function noteResponseForRealtime(req: unknown, res: unknown): void {
  if (isBoosthisDisabled() || !started) return;
  try {
    const r = res as {
      write?: (...a: unknown[]) => unknown;
      end?: (...a: unknown[]) => unknown;
      getHeader?: (n: string) => unknown;
      on?: (e: string, f: (...a: unknown[]) => void) => unknown;
    };
    if (typeof r.write !== "function" || typeof r.getHeader !== "function") {
      return;
    }
    const endpoint = fold((req as { url?: unknown } | null)?.url);
    let conn: Conn | null = null;
    const origWrite = r.write;
    r.write = function boosthisLiveWrite(
      this: unknown,
      ...args: unknown[]
    ): unknown {
      try {
        if (!conn) {
          // ONE definition of "held open", shared with the latency family so
          // the two readings can never disagree about the same response
          // (docs/held-open-calls.md).
          if (isHeldOpenContentType(r.getHeader?.("content-type"))) {
            conn = open(endpoint, "stream", r as Record<string, unknown>);
            if (conn && typeof r.on === "function") {
              // The client walking away from a stream is ordinary — a user
              // changed page. It ends the connection; it is not a fault, and
              // counting it as one would make every healthy feed look broken.
              r.on("close", () => {
                if (conn) close(conn, true);
              });
            }
          }
        }
        if (conn) {
          conn.messages++;
          streamMessages++;
          activity(conn, now());
        }
      } catch {
        /* the write always happens */
      }
      return (origWrite as (...a: unknown[]) => unknown).apply(this, args);
    };
  } catch {
    /* never disturb the response */
  }
}

/** Start watching. Idempotent; never throws. */
export function startLiveConnections(): void {
  if (started) return;
  started = true;
  try {
    // Imported directly rather than fished out of `globalThis.require`.
    // `require` does not exist in an app published as an ES module, which is
    // most of them now — and the old lookup did not fail there, it silently
    // watched nothing, so a realtime app would have shown no connections at
    // all while every other reading stayed green.
    //
    // Node's built-ins are one shared instance per process, so patching the
    // prototype here is the same object the host's own server was built from,
    // whichever way either side was published.
    const load = (mod: {
      Server?: { prototype?: unknown };
    }): ProtoLike | undefined => {
      try {
        return mod?.Server?.prototype as ProtoLike | undefined;
      } catch {
        return undefined;
      }
    };
    const httpUndo = watchUpgrade(load(nodeHttp));
    if (httpUndo) undo.push(httpUndo);
    // https.Server extends tls.Server, not http.Server — patching one leaves
    // the other untouched, and a TLS app is exactly the one that would look
    // watched while nothing was watched.
    const httpsUndo = watchUpgrade(load(nodeHttps));
    if (httpsUndo) undo.push(httpsUndo);
  } catch {
    /* no upgrade watching available; streams still work */
  }
}

/** Stop, restore and forget. Idempotent; never throws. */
export function clearLiveConnections(): void {
  started = false;
  stopSampler();
  for (const u of undo) {
    try {
      u();
    } catch {
      /* ignore */
    }
  }
  undo.length = 0;
  conns.length = 0;
  reopens.clear();
  lastEnd.clear();
  observedAny = false;
  firstSeenAt = 0;
  opened = 0;
  closed = 0;
  drops = 0;
  reconnects = 0;
  streamMessages = 0;
  peakOpen = 0;
  stormPeak = 0;
  anyOpaque = false;
}

/* ── Reading ──────────────────────────────────────────────────────────────*/

interface Verdict {
  quiet: number;
  stalled: number;
  undecided: number;
}

function judge(at: number): Verdict {
  let quiet = 0;
  let stalled = 0;
  let undecided = 0;
  for (const c of conns) {
    if (c.closedAt !== null) continue;
    const silence = at - c.lastSeenAt;
    if (silence < LIVECONN_QUIET_MS) continue;
    quiet++;
    if (c.gaps.length < LIVECONN_CADENCE_MIN_GAPS) {
      // No rhythm was ever established, which is exactly what an app with no
      // heartbeat gives us. Calling it dead here would be a guess wearing a
      // measurement's clothes.
      undecided++;
      continue;
    }
    const typical = med(c.gaps);
    if (typical <= 0) {
      undecided++;
      continue;
    }
    if (silence > typical * LIVECONN_DEAD_GAP_MULTIPLE) stalled++;
  }
  return { quiet, stalled, undecided };
}

function caption(s: {
  open: number;
  drops: number;
  dropsNamed: boolean;
  dropsUnjudged: boolean;
  stalled: number;
  undecided: number;
  storm: number;
  neverClosed: number;
}): string {
  if (s.storm > 0) {
    return `${s.storm} reconnects in a minute with no widening gap \u2014 add back-off`;
  }
  if (s.stalled > 0) {
    return `${s.stalled} open but silent past its own rhythm \u2014 likely dead`;
  }
  if (s.neverClosed > 0) {
    return `${s.neverClosed} connections open for minutes and never closed`;
  }
  if (s.undecided > 0) {
    return `${s.undecided} quiet, and nothing arrives regularly enough to tell dead from resting`;
  }
  if (s.dropsNamed) {
    return `${s.open} open \u00b7 ${s.drops} dropped without a goodbye`;
  }
  if (s.dropsUnjudged) {
    // The drops are named; the verdict on them is not, because the window has
    // not earned the rate that verdict would rest on.
    return `${s.open} open \u00b7 ${s.drops} dropped \u2014 too early to say whether that is a normal rate`;
  }
  if (s.drops > 0) {
    // Stated, and NOT as a fault: this is the rate the score gives full marks
    // to, so calling it a fault would leave the words and the rating at odds.
    return `${s.open} open \u00b7 ${s.drops} brief drops, within the normal rate`;
  }
  return `${s.open} open \u00b7 none dropped`;
}

/**
 * The current reading, or null when there is nothing honest to say — this
 * process holds no long-lived connections, or the first one is younger than
 * the minimum window. An app that never opens one shows NOTHING here; a row of
 * zeros would claim we looked at a chat feature that does not exist.
 */
export function readLiveConnections(): ExtraAxis | null {
  if (isBoosthisDisabled() || !started || !observedAny) return null;
  try {
    const at = now();
    const elapsed = Math.max(0, at - firstSeenAt);
    if (elapsed < LIVECONN_MIN_WINDOW_MS) return null;
    sampleSockets();
    // The window as it really is. Rounding thirty seconds up to "1m observed"
    // would put a minute we never watched into the caption and the payload.
    const windowMin = windowMinOf(elapsed);
    const hours = elapsed / 3_600_000;

    const live = conns.filter((c) => c.closedAt === null);
    const ended = conns.filter((c) => c.closedAt !== null);
    const lives = ended.map((c) => (c.closedAt as number) - c.openedAt);
    let longestMs = 0;
    for (const c of conns) {
      const life = (c.closedAt ?? at) - c.openedAt;
      if (life > longestMs) longestMs = life;
    }

    const v = judge(at);
    const storm = stormPeak >= LIVECONN_STORM_THRESHOLD ? stormPeak : 0;
    const aged = live.filter(
      (c) => at - c.openedAt >= LIVECONN_LEAK_AGE_MS,
    ).length;
    // How many were open at the reference point, so a pool kept since boot
    // (the same count then and now) is never read as a pile nobody closes.
    const ref = Math.max(at - LIVECONN_GROWTH_WINDOW_MS, firstSeenAt + LIVECONN_LEAK_AGE_MS);
    let liveAtRef = 0;
    for (const c of conns) {
      if (c.openedAt <= ref && (c.closedAt === null || c.closedAt > ref)) liveAtRef++;
    }
    const grewBy = live.length - liveAtRef;
    // All three required. One socket held open all day is what a chat server
    // is FOR, and a pool of them kept from boot is what a database client is
    // for; a pile that keeps growing and that nothing ever closes is the leak.
    const neverClosed =
      live.length >= LIVECONN_LEAK_MIN_OPEN &&
      aged >= LIVECONN_LEAK_MIN_OPEN &&
      grewBy >= LIVECONN_LEAK_MIN_OPEN
        ? aged
        : 0;

    let backlog = 0;
    for (const c of live) {
      const h = c.handle;
      if (!h) continue;
      const queued = h.writableLength;
      if (typeof queued === "number" && Number.isFinite(queued)) {
        backlog += queued;
      }
    }

    // A quarter of this score is a per-hour drop rate, so until the window
    // has earned that projection there is no honest score to publish: a
    // substituted zero would rate a short look with real drops as healthy.
    // The counts, the window and every directly observed fault below are
    // reported either way — only the judgement waits.
    const dropsPerHour = earnedPerHour(drops, elapsed);
    // Drops are the one fault with an honest tolerance, so the caption and the
    // rating have to agree about where that tolerance ends: below the line the
    // words say the disconnects were within the normal rate, above it they name
    // them and the rating stops being "good".
    const dropsNamed =
      dropsPerHour !== null && drops > 0 && dropsPerHour > LIVECONN_DROPS_OK_PER_HOUR;
    const dropsUnjudged = dropsPerHour === null && drops > 0;
    const score =
      dropsPerHour === null
        ? null
        : Math.round(
            0.35 * linearScore(dropsPerHour, LIVECONN_DROPS_OK_PER_HOUR, 12) +
              0.3 * (v.stalled === 0 ? 100 : v.stalled === 1 ? 40 : 0) +
              0.2 * (storm === 0 ? 100 : 0) +
              0.15 * (neverClosed === 0 ? 100 : 0),
          );

    // A reading that NAMES a problem may not also rate "good". The score is a
    // weighted average, so one real fault beside three clean terms still lands
    // in the good band — and every surface that reads the rating rather than
    // the caption (the account overview's attention rows, an AI asked whether
    // the chat is healthy) would report a clean bill of health directly beside
    // a sentence describing the fault. Identical rule, and identical wording of
    // it, in the browser and phone kits.
    const namesAProblem =
      storm > 0 || v.stalled > 0 || neverClosed > 0 || dropsNamed;
    const banded = score === null ? "pending" : ratingFor(score);

    const axis: ExtraAxis = {
      score,
      rating: namesAProblem && banded === "good" ? "needs-work" : banded,
      caption: caption({
        open: live.length,
        drops,
        dropsNamed,
        dropsUnjudged,
        stalled: v.stalled,
        undecided: v.undecided,
        storm,
        neverClosed,
      }),
      open: live.length,
      peakOpen,
      opened,
      closed,
      drops,
      reconnects,
      reconnectsPerHour: earnedPerHour(reconnects, elapsed),
      medianLifeMs: Math.round(med(lives)),
      longestMs: Math.round(longestMs),
      stormCount: storm,
      quiet: v.quiet,
      stalled: v.stalled,
      undecided: v.undecided,
      neverClosed,
      backlog,
      windowMin,
      measurable: 1,
      // Message counts are knowable only while every watched connection marks
      // its own boundaries. One upgraded socket in the set and the honest
      // answer for the set is "the transport does not say".
      flowMeasurable: anyOpaque ? 0 : 1,
    };
    if (!anyOpaque) {
      axis.msgsPerMin = earnedPerMin(streamMessages, elapsed);
    }
    return markSettled(axis);
  } catch {
    return null;
  }
}

/** Whether a reconnect storm is currently on the record, and how big. Read by
 *  the detector layer so the finding and the axis can never disagree. */
export function liveConnectionStorm(): number {
  return stormPeak >= LIVECONN_STORM_THRESHOLD ? stormPeak : 0;
}

/**
 * The findings this watcher can raise, each of which names a DIFFERENT fix.
 * Derived from the same counters the axis reports, so the tile and the issue
 * list can never tell a developer two different stories.
 *
 * `name` is a fixed word, never an address: a reconnect storm's destination is
 * exactly the thing we promised never to send.
 */
export function collectLiveConnectionFindings(): CrossCuttingFinding[] {
  if (isBoosthisDisabled() || !started || !observedAny) return [];
  const out: CrossCuttingFinding[] = [];
  try {
    const at = now();
    const storm = liveConnectionStorm();
    if (storm > 0) {
      out.push({
        kind: "reconnect-storm",
        name: "realtime",
        p95: LIVECONN_STORM_WINDOW_MS,
        count: storm,
        hint: "A client reconnected repeatedly with no widening gap between attempts.",
      });
    }
    const v = judge(at);
    if (v.stalled > 0) {
      out.push({
        kind: "connection-stalled",
        name: "realtime",
        p95: LIVECONN_QUIET_MS,
        count: v.stalled,
        hint: "A connection is open but has gone silent far past its own rhythm.",
      });
    }
    const live = conns.filter((c) => c.closedAt === null);
    const aged = live.filter(
      (c) => at - c.openedAt >= LIVECONN_LEAK_AGE_MS,
    ).length;
    if (live.length >= LIVECONN_LEAK_MIN_OPEN && aged >= LIVECONN_LEAK_MIN_OPEN) {
      out.push({
        kind: "connection-leak",
        name: "realtime",
        p95: LIVECONN_LEAK_AGE_MS,
        count: aged,
        hint: "Long-lived connections are piling up and nothing is closing them.",
      });
    }
  } catch {
    return out;
  }
  return out;
}

/* ── Test seams ───────────────────────────────────────────────────────────*/

export function _setLiveConnectionsClockForTests(fn: (() => number) | null): void {
  now = fn ?? (() => Date.now());
}

export const _liveConnectionsInternals = {
  open,
  close,
  activity,
  judge,
  markStarted(on: boolean): void {
    started = on;
  },
};
