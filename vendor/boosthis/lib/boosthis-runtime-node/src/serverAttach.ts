/** Attach to ANY Node server — Next.js, Fastify, Hono, NestJS, plain `http`.
 *
 * WHY THIS EXISTS
 *
 * For its whole life this kit had exactly one way in: `app.use(boosthis())`,
 * the Express middleware shape. Apps built with an AI assistant very often
 * come out as something else, and for those the installing AI had to invent
 * the wiring. What it usually invented registered the project and drew the
 * badge — and measured nothing, forever. The customer saw a panel and believed
 * they were watched.
 *
 * `attach()` removes the guesswork. It watches the ONE boundary every Node
 * server shares: the `request` event a `http.Server` (or `https.Server`)
 * raises for each request, before any framework's router sees it. Whatever
 * runs above that boundary — a Next.js server, a Fastify instance, a Hono
 * handler, a Nest application, a bare listener — is timed the same way, with
 * no framework-specific glue anywhere.
 *
 * THE TWO ARRIVE TOGETHER, OR NEITHER DOES
 *
 * The kit's own page, badge poll and status page are served from THIS SAME
 * patch, above the instrumentation. That is not a convenience: it is the
 * structural answer to the failure this task exists to kill. A project cannot
 * end up with a visible panel and permanently empty readings, because the code
 * that draws the panel is the code that takes the readings. If the patch
 * cannot go on, there is no panel either — and the kit says so out loud, at
 * startup and on the status page.
 *
 * WHAT IT DOES NOT DO
 *
 * Express apps are untouched: they never call this, and the middleware they do
 * call behaves exactly as it always has. Nothing here measures anything new —
 * every reading comes from the same middleware, reached through a different
 * door.
 */

import { boosthis, type BoosthisOptions } from "./middleware";
import { isDirectLoopback } from "./loopback";
import { ownerFromPass, type OwnerReq, type OwnerRes } from "./ownerLink";
import {
  KIT_BASE_PATH,
  answerKitRead,
  kitReadSuffixFor,
  noteKitPathsRegistered,
  writeRawKitAnswer,
  type RawResLike,
} from "./kitAnswers";
import { armReadyWatch } from "./readyToServe";
import { registerApp } from "./routeInventory";
import { isBoosthisDisabled } from "./runtimeFlags";
import { isKitDissolved, isKitLocked } from "./killSwitch";
import { sayAfterStartupLine } from "./startAnnounce";
import {
  detectServerKind,
  noteServerListeners,
  setDeclaredServerKind,
  type ServerKind,
} from "./serverKind";
import { getActiveTelemetryClient, type TelemetryClient } from "./telemetry";
import {
  cannotAttachLine,
  noteAttachOutcome,
  noteAttachedRequest,
  noteKitReadServed,
  _resetAttachStatusForTests,
  type AttachRefusal,
} from "./attachStatus";

// Re-exported so the one door a developer imports (`boosthis-runtime-node`)
// is also the one that tells them whether it is on.
export { attachState, cannotAttachLine } from "./attachStatus";
export type { AttachRefusal, AttachState } from "./attachStatus";

export interface AttachOptions extends BoosthisOptions {
  /** Override the default `/_boosthis` path prefix for the kit's own pages. */
  basePath?: string;
  /**
   * Allow the perf reads (`/dev`, `/summary`, `/recent`, `/budgets`,
   * `/healthz`) from non-loopback addresses. Default false, the same posture
   * as `mount()`. The two credential reads and the status page are ALWAYS
   * loopback-only and this never opens them.
   */
  allowRemote?: boolean;
  /**
   * The live reporting client. Optional — when it is not passed, the kit uses
   * the one `enableTelemetry()` created, so the order of the two calls does
   * not matter.
   */
  telemetry?: TelemetryClient;
  /**
   * Name this app's server yourself when the kit's own detection gets it
   * wrong (or cannot see it, e.g. behind an unusual bundler). One of
   * express, fastify, hono, nest, next, node-http.
   */
  serverKind?: string;
  /**
   * Your application object, handed over so the kit can ask the framework for
   * its whole route list — the routes nobody has visited yet included.
   *
   * Optional, and only needed for a framework the middleware never sees an
   * app handle from: Fastify, Koa and Hapi. An Express app needs nothing here,
   * because `req.app` arrives with the first request on its own.
   *
   * Nothing is read from it here. The handle is remembered, and the route
   * table is walked later, when a snapshot is captured — so this costs the app
   * nothing at startup and never sits in front of a request. Switch the whole
   * reading off with `BOOSTHIS_ROUTE_LIST=0`.
   */
  app?: unknown;
}

export interface AttachResult {
  /** True when every request through this process is now being timed. */
  attached: boolean;
  /** Why not, when `attached` is false. */
  reason?: AttachRefusal;
  /** What kind of server this process appears to be running. */
  serverKind: ServerKind;
  /** Undo the attach. Exists for tests and for a host that wants its process
   *  back exactly as it found it; a normal app never calls this. */
  detach(): void;
}

const PATCH_MARK = Symbol.for("boosthis.serverEmitPatched");

interface EmitterLike {
  emit(event: string, ...args: unknown[]): boolean;
  listeners?(event: string): unknown[];
}

interface ProtoLike {
  emit: (this: EmitterLike, event: string, ...args: unknown[]) => boolean;
}

let undoPatches: Array<() => void> = [];
let liveResult: AttachResult | null = null;
const serversSeen = new WeakSet<object>();

/** Say it once, after the startup line, the same way every other refusal is
 *  said. Never throws. */
function announceCannotAttach(reason: AttachRefusal): void {
  try {
    sayAfterStartupLine(cannotAttachLine(reason));
  } catch {
    /* guest safety outranks a notice */
  }
}

/**
 * The reasons we can know BEFORE touching anything. Exported for tests.
 *
 * BUN IS NOT ONE OF THEM, and it used to be. This preflight refused every Bun
 * process outright, which meant a Bun back end that wired itself the `attach()`
 * way registered, appeared on its owner's dashboard, and then never timed a
 * single request — the exact "connected but never measured" state, caused by us
 * rather than by anything about their app. It reached a real customer's project.
 *
 * The refusal was a guess about a capability, and the capability is one we can
 * simply ASK FOR: Bun implements `node:http`, its `Server.prototype.emit` takes
 * the same patch Node's does, and a patched Bun server really does see its
 * `request` events (scripts/live-proofs/bun-server-kit proves it against a
 * running server rather than asserting it here). So Bun now goes down the
 * ordinary path, and if the patch does not take — on Bun or on Node — the
 * read-back in `patchPrototype` produces `server-dispatch-locked`, which is a
 * MEASURED refusal rather than an assumed one.
 *
 * Deno stays refused, in its OWN words and for its own reason (`deno-runtime`,
 * never a shared "some other runtime" bucket — sharing one is what let Bun be
 * refused by a sentence written about Deno). Its `node:http` compatibility is a
 * different and much thinner story, no proof rig runs a real Deno app, an
 * isolate host is what the edge kit is for, and refusing something we have not
 * proved is the honest direction to be wrong in. The moment a live Deno proof
 * exists, this line goes the way Bun's did.
 */
export function preflightRefusal(env: {
  hasNodeHttp: boolean;
  runtime?: string | null;
  nextRuntime?: string | null;
}): AttachRefusal | null {
  if (env.runtime === "deno") return "deno-runtime";
  if (env.nextRuntime === "edge") return "edge-runtime";
  if (!env.hasNodeHttp) return "no-node-http";
  return null;
}

/** Which non-Node runtime we are on, if any. Bun is reported the same as
 *  before — the tag still travels with the registration and still drives the
 *  nine readings Bun cannot take (bunLimits.ts) — it simply no longer stops the
 *  attach. */
function foreignRuntime(): string | null {
  const g = globalThis as { Bun?: unknown; Deno?: unknown };
  if (g.Bun) return "bun";
  if (g.Deno) return "deno";
  return null;
}

/** Replace one prototype's `emit`, or answer null when it will not take. */
function patchPrototype(
  proto: ProtoLike | undefined,
  handle: (
    server: EmitterLike,
    req: unknown,
    res: unknown,
    forward: () => boolean,
  ) => boolean,
): (() => void) | null {
  try {
    if (!proto || typeof proto.emit !== "function") return null;
    const original = proto.emit;
    // Already ours (a second attach, or a duplicate copy of the kit): leave it
    // alone rather than wrapping a wrapper.
    if ((original as unknown as Record<symbol, unknown>)[PATCH_MARK] === true) {
      return () => {
        /* not ours to undo */
      };
    }
    const patched = function boosthisServerEmit(
      this: EmitterLike,
      event: string,
      ...args: unknown[]
    ): boolean {
      if (event !== "request") return original.call(this, event, ...args);
      const self = this;
      return handle(self, args[0], args[1], () =>
        original.call(self, "request", ...args),
      );
    };
    Object.defineProperty(patched, PATCH_MARK, { value: true });
    proto.emit = patched as ProtoLike["emit"];
    // A frozen or accessor-guarded prototype accepts the assignment silently
    // and keeps its old value. Read it back rather than trusting the write.
    if (proto.emit !== (patched as unknown as ProtoLike["emit"])) return null;
    return () => {
      try {
        if (proto.emit === (patched as unknown as ProtoLike["emit"])) {
          proto.emit = original;
        }
      } catch {
        /* leaving our wrapper in place is safe — it forwards everything */
      }
    };
  } catch {
    return null;
  }
}

/**
 * Watch every request this process serves.
 *
 * Call it ONCE, as early as your server starts. Safe to call twice — the
 * second call returns the first one's answer without patching anything again.
 */
export function attach(opts: AttachOptions = {}): AttachResult {
  if (liveResult) return liveResult;
  try {
    setDeclaredServerKind(opts.serverKind);
  } catch {
    /* a bad hint must never stop the attach */
  }
  // Remember the app handle, if one was passed. Nothing is read from it now —
  // the route table is walked at snapshot time, off the request path.
  registerApp(opts.app);

  // The anchor line first, exactly as an Express install gets it: the kit was
  // switched on. Anything the attach cannot do is said AFTER it, so the
  // developer reads the two in the order they happened. Building the
  // middleware here is also what the attach will run per request.
  const middleware = boosthis(opts);

  // Cold start is measured to the moment this app starts accepting connections,
  // and an attach()-style install may run before `enableTelemetry()` — arm the
  // watch from whichever of the two comes first. Idempotent, never throws.
  armReadyWatch();

  let http: { Server?: { prototype?: ProtoLike } } | undefined;
  let https: { Server?: { prototype?: ProtoLike } } | undefined;
  try {
    http = nodeHttp();
    https = nodeHttps();
  } catch {
    http = undefined;
    https = undefined;
  }

  const pre = preflightRefusal({
    hasNodeHttp: typeof http?.Server?.prototype?.emit === "function",
    runtime: foreignRuntime(),
    nextRuntime: typeof process !== "undefined" ? process.env?.NEXT_RUNTIME ?? null : null,
  });
  if (pre) {
    noteAttachOutcome({ attached: false, reason: pre });
    announceCannotAttach(pre);
    liveResult = {
      attached: false,
      reason: pre,
      serverKind: detectServerKind(),
      detach: () => {
        /* nothing was changed */
      },
    };
    return liveResult;
  }

  const base = (opts.basePath ?? KIT_BASE_PATH).replace(/\/$/, "");
  const allowRemote = opts.allowRemote ?? false;

  const handle = (
    server: EmitterLike,
    req: unknown,
    res: unknown,
    forward: () => boolean,
  ): boolean => {
    // Kill-switch: pure pass-through, exactly like the middleware. Nothing is
    // served, nothing is counted, nothing is marked.
    try {
      if (isBoosthisDisabled()) return forward();
      // DISSOLVED (docs/kit-lock-rule.md): the app answers exactly as it would
      // without the kit — no page, no read, nothing counted.
      if (isKitDissolved()) return forward();
    } catch {
      return forward();
    }
    // LOCKED: the kit's own reads below still answer the renew notice, and the
    // middleware hands everything else straight to the app. Nothing is noted.
    let locked = false;
    try {
      locked = isKitLocked();
    } catch {
      locked = false;
    }

    // Learn what this app is serving with, from the server that is actually
    // serving. Once per server object, never per request.
    try {
      if (!locked && !serversSeen.has(server as object)) {
        serversSeen.add(server as object);
        noteServerListeners(server.listeners?.("request") ?? []);
      }
    } catch {
      /* evidence never blocks a request */
    }

    // Measure, then hand the request on. `forwardOnce` guarantees the host
    // sees it exactly once even if the middleware fails after forwarding.
    let forwarded = false;
    const forwardOnce = (): boolean => {
      if (forwarded) return true;
      forwarded = true;
      return forward();
    };
    const measureAndForward = (): boolean => {
      try {
        if (!locked) noteAttachedRequest();
        middleware(
          req as Parameters<typeof middleware>[0],
          res as Parameters<typeof middleware>[1],
          forwardOnce,
        );
      } catch {
        // The middleware guards itself, but a guest must never be the reason a
        // request goes unanswered.
        forwardOnce();
      }
      return true;
    };

    // The kit's own reads, answered ABOVE the instrumentation so a badge poll
    // never pollutes the meters it is displaying — and so a framework with no
    // Express-style routing still gets the page, the badge and the status
    // page without registering a single route.
    try {
      const rawPath = String(
        (req as { url?: unknown })?.url ?? "",
      ).split("?")[0] as string;
      const method = String(
        (req as { method?: unknown })?.method ?? "GET",
      ).toUpperCase();
      const suffix = kitReadSuffixFor(rawPath, base);
      if (suffix !== null && method === "GET") {
        // Owners only: a confirmed owner pass, the machine itself or the
        // developer's allowRemote opt-in. Anyone else is measured and handed
        // to the host like any other request, so the app answers as it would
        // for any unknown address.
        const serveKitRead = (owner: boolean): boolean => {
          const answer = answerKitRead(suffix, {
            loopback: isDirectLoopback(req as Parameters<typeof isDirectLoopback>[0]),
            owner,
            allowRemote,
            telemetry: opts.telemetry ?? getActiveTelemetryClient() ?? undefined,
          });
          if (answer && writeRawKitAnswer(res as RawResLike, answer)) {
            noteKitReadServed();
            return true;
          }
          return false;
        };
        const owner = ownerFromPass(req as OwnerReq, res as OwnerRes);
        if (typeof owner === "boolean") {
          if (serveKitRead(owner)) return true;
        } else {
          owner
            .then((o) => {
              if (!serveKitRead(o)) measureAndForward();
            }, () => measureAndForward())
            .catch(() => measureAndForward());
          return true;
        }
      }
    } catch {
      /* fall through: the host still gets its request */
    }
    return measureAndForward();
  };

  const undo: Array<() => void> = [];
  const httpUndo = patchPrototype(http?.Server?.prototype, handle);
  if (httpUndo) undo.push(httpUndo);
  // https.Server does NOT inherit from http.Server — it extends tls.Server —
  // so patching one leaves the other's dispatch untouched. An app served over
  // TLS in-process is exactly the app that would otherwise look attached and
  // measure nothing.
  const httpsUndo = patchPrototype(https?.Server?.prototype, handle);
  if (httpsUndo) undo.push(httpsUndo);

  if (!httpUndo) {
    const locked: AttachRefusal = "server-dispatch-locked";
    for (const u of undo) u();
    noteAttachOutcome({ attached: false, reason: locked });
    announceCannotAttach(locked);
    liveResult = {
      attached: false,
      reason: locked,
      serverKind: detectServerKind(),
      detach: () => {
        /* nothing was changed */
      },
    };
    return liveResult;
  }

  undoPatches = undo;
  // Every kit-owned path under this base is now answered at the raw boundary,
  // above the middleware. Recorded so the middleware's "this surface needs
  // mount(app)" reply — true only for an Express app that skipped the mount —
  // can never appear in an attached app, which needs no mount call at all.
  noteKitPathsRegistered(base);
  noteAttachOutcome({ attached: true });
  liveResult = {
    attached: true,
    serverKind: detectServerKind(),
    detach: () => {
      for (const u of undoPatches) u();
      undoPatches = [];
      _resetAttachStatusForTests();
      liveResult = null;
    },
  };
  return liveResult;
}

/* ── module loading, kept out of the way ───────────────────────────────── */

// Imported statically so a bundler can see them; wrapped in a function so a
// runtime without them refuses cleanly instead of failing at import time.
import * as nodeHttpModule from "node:http";
import * as nodeHttpsModule from "node:https";

function nodeHttp(): { Server?: { prototype?: ProtoLike } } | undefined {
  return nodeHttpModule as unknown as { Server?: { prototype?: ProtoLike } };
}

function nodeHttps(): { Server?: { prototype?: ProtoLike } } | undefined {
  return nodeHttpsModule as unknown as { Server?: { prototype?: ProtoLike } };
}

/** @internal test hook */
export function _resetAttachForTests(): void {
  for (const u of undoPatches) u();
  undoPatches = [];
  _resetAttachStatusForTests();
  liveResult = null;
}
