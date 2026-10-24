/** When this app became ready to serve — the boundary a cold start is measured to.
 *
 * WHY THIS EXISTS
 *
 * The cold-start reading used to end at OUR enable call: process start → the
 * moment the host called `enableTelemetry()`. Everything the app did after that
 * — building a pool, warming a cache, running migrations, binding the port —
 * fell outside the interval, and the number was rated anyway. A service with a
 * deliberate 1.5-second delay planted after the enable call reported 376 ms and
 * was rated *good*. The reading was correct about an interval nobody asked
 * about, under a name that promises the one they did.
 *
 * A Node process can watch the moment that matters without asking the developer
 * for anything: every server in this runtime — Express, Fastify, Hono, Nest,
 * Next, a bare `http.createServer`, an `https` or `http2` server — reaches the
 * network through `net.Server.prototype.listen`, and raises `listening` when the
 * socket is actually accepting connections. That is the one boundary they all
 * share, the same reasoning `serverAttach.ts` uses for the `request` event.
 *
 * WHAT IT DOES
 *
 * Replaces that one prototype method with a wrapper that arms a single
 * `once("listening")` listener per server and then calls straight through. The
 * FIRST such event freezes the process age; nothing is ever re-read. The
 * wrapper adds one function call to a call each server makes once in its life.
 *
 * WHAT IT REFUSES TO DO
 *
 * It never decides anything about a request, never delays a bind, and never
 * lets a failure of its own reach the host: a frozen prototype, a runtime with
 * no `node:net`, or a throw anywhere inside simply leaves the mark unset. An
 * unset mark is not a zero and not a guess — `runtimeVitals` then reports the
 * interval it CAN see (process start → kit switched on) as an explicitly
 * partial, unrated reading. See docs/cold-start-boundary-contract.md.
 */

import { isBoosthisDisabled } from "./runtimeFlags";
import { isKitLocked } from "./killSwitch";

/** Which interval a cold-start reading covers. Closed codes shared by every
 *  kit — the kit sends the code, the server writes the words. Keep in step with
 *  docs/cold-start-boundary-contract.md and the server's `coldStartReading.ts`. */
export const MEASURED_TO_SERVING = 1;
/** Process start → first frame drawn (the UI kits). Not used by this kit; here
 *  so the one place a reader looks holds the whole vocabulary. */
export const MEASURED_TO_FIRST_FRAME = 2;
/** Isolate created → first request finished (the edge kit). */
export const MEASURED_TO_FIRST_RESPONSE = 3;
/** Runtime start → the kit was switched on. PARTIAL: never rated, anywhere. */
export const MEASURED_TO_KIT_ENABLE = 4;

const PATCH_MARK = Symbol.for("boosthis.serverListenPatched");

/** The frozen process age (ms) at the first `listening` event. null = never
 *  seen: the app has not bound a socket yet, bound one before we were armed, or
 *  is not a server at all. */
let readyMs: number | null = null;

/** Undo for the prototype patch — tests and a host that wants its process back
 *  exactly as it found it. */
let undoPatch: (() => void) | null = null;

/** Test seam: the clock the mark is taken from. Live reader is
 *  `process.uptime()`, the same origin `runtimeVitals` uses for the enable-time
 *  capture, so the two intervals are always comparable. */
let clockOverride: (() => number) | null = null;

interface ServerLike {
  once?: (event: string, listener: () => void) => unknown;
}

interface ListenProto {
  listen: (this: ServerLike, ...args: unknown[]) => unknown;
}

function processAgeMs(): number {
  if (clockOverride) return clockOverride();
  return Math.round(process.uptime() * 1000);
}

/**
 * Freeze the readiness mark. Idempotent — the FIRST server to accept
 * connections is the one that made this app ready; a later one (an admin port,
 * a metrics port, a socket bound an hour in) must never move the number.
 *
 * Exported so a runtime surface that learns about readiness another way can say
 * so; nothing outside this kit calls it. Never throws.
 */
export function noteReadyToServe(): void {
  try {
    if (readyMs !== null) return;
    if (isBoosthisDisabled() || isKitLocked()) return;
    const age = processAgeMs();
    if (typeof age === "number" && Number.isFinite(age)) readyMs = Math.round(age);
  } catch {
    /* guest safety outranks a reading */
  }
}

/** The frozen mark, or null when this process has not been seen to become
 *  ready. A pure read: it never takes a live measurement, because a live
 *  "now − process start" is uptime, not a cold start. */
export function readyToServeMs(): number | null {
  return readyMs;
}

/** Arm the watch. Idempotent, kill-switch-guarded, never throws. Called from
 *  `enableTelemetry()` and from `attach()` so whichever of the two a project
 *  wires up first is the one that arms it. */
export function armReadyWatch(): void {
  try {
    if (undoPatch) return;
    if (isBoosthisDisabled() || isKitLocked()) return;
    const proto = netServerProto();
    if (!proto || typeof proto.listen !== "function") return;
    const original = proto.listen;
    // Already ours (a second copy of the kit in the same process): leave it be
    // rather than wrapping a wrapper. The first patch already marks readiness.
    if ((original as unknown as Record<symbol, unknown>)[PATCH_MARK] === true) {
      undoPatch = () => {
        /* not ours to undo */
      };
      return;
    }
    const armed = new WeakSet<object>();
    const patched = function boosthisListen(
      this: ServerLike,
      ...args: unknown[]
    ): unknown {
      // The listener goes on BEFORE the bind is asked for, so a host that
      // somehow emits synchronously is still seen. One listener per server
      // object, ever.
      try {
        const self = this as unknown as object;
        if (self && !armed.has(self) && typeof this.once === "function") {
          armed.add(self);
          this.once("listening", () => noteReadyToServe());
        }
      } catch {
        /* a reading must never cost the host its server */
      }
      return original.apply(this, args as []);
    };
    Object.defineProperty(patched, PATCH_MARK, { value: true });
    proto.listen = patched as ListenProto["listen"];
    // A frozen or accessor-guarded prototype accepts the assignment silently
    // and keeps its old value. Read it back rather than trusting the write: an
    // unmarked process reports a partial cold start, which is honest, where a
    // believed-armed one would report nothing at all.
    if (proto.listen !== (patched as unknown as ListenProto["listen"])) return;
    undoPatch = () => {
      try {
        if (proto.listen === (patched as unknown as ListenProto["listen"])) {
          proto.listen = original;
        }
      } catch {
        /* leaving our wrapper in place is safe — it calls straight through */
      }
    };
  } catch {
    /* an unarmed watch is a partial reading, never a broken host */
  }
}

/** Forget the mark. Wired into `clearVitals()` so a `forget()` wipes this the
 *  same way it wipes the enable-time capture; the patch STAYS armed, so a
 *  server that binds afterwards is still seen. */
export function clearReadyMark(): void {
  readyMs = null;
}

/** Take the watch off: put the host's `listen` back and forget the mark. Called
 *  when an answer locks the kit (docs/kit-lock-rule.md). A wrapper that cannot
 *  be taken off reads the lock in `noteReadyToServe` and changes nothing. An
 *  `active` answer may arm it again; a server already bound by then is simply
 *  not seen, so the reading stays absent rather than measuring the lock. */
export function disarmReadyWatch(): void {
  try {
    if (undoPatch) undoPatch();
  } catch {
    /* leaving our wrapper in place is safe — it reads the lock and passes through */
  }
  undoPatch = null;
  readyMs = null;
}

/* ── module loading, kept out of the way ─────────────────────────────────── */

// Imported statically so a bundler can see it; wrapped in a function so a
// runtime without `node:net` refuses cleanly instead of failing at import time.
import * as nodeNetModule from "node:net";

function netServerProto(): ListenProto | undefined {
  try {
    const net = nodeNetModule as unknown as {
      Server?: { prototype?: ListenProto };
    };
    return net.Server?.prototype;
  } catch {
    return undefined;
  }
}

/** @internal test hooks. */
export const _readyToServeInternals = {
  /** Pin the clock the mark is taken from (ms of process age). */
  setClockForTest(fn: (() => number) | null): void {
    clockOverride = fn;
  },
  /** Unpatch and forget — a full reset between tests. */
  reset(): void {
    try {
      if (undoPatch) undoPatch();
    } catch {
      /* nothing to do */
    }
    undoPatch = null;
    readyMs = null;
    clockOverride = null;
  },
  /** True while the prototype patch is in place. */
  get armed(): boolean {
    return undoPatch !== null;
  },
};
