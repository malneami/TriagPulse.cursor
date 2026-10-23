/* ─── What this kit reached, and what it found and cannot watch ───────────
 *
 * A developer looking at a page of green meters reasonably assumes we are
 * watching their whole app. We are not, and this kit already KNOWS where it is
 * blind: the attach either took or refused, a job library either has an adapter
 * or does not, a database client either accepted our patch or is one we have
 * never written one for. Every one of those facts used to die inside the
 * process that learned it.
 *
 * This module adds them up into one small inventory that rides the existing
 * registration. It is a READER: it starts nothing, patches nothing and asks
 * nothing to arm. Everything here is already being counted for some other
 * reason.
 *
 * Three rules it exists to keep:
 *
 *   1. POSITIVE EVIDENCE BOTH WAYS. A surface is reported as WATCHED only once
 *      something has actually come through it — arming subscribes to a channel,
 *      and a channel nothing publishes on looks exactly like an app that makes
 *      no calls. A surface is reported as UNWATCHED only when this kit really
 *      found the thing present. An app with no queue system has no queue gap,
 *      and a surface we simply have no evidence about is left OUT of both
 *      lists, where the server renders it as "we have not looked", never as
 *      "clean".
 *
 *   2. NO CUSTOMER NAMES. What leaves this process is a term from
 *      `watchableSurfaces.ts` and a small count. Never a module, class, route
 *      or function name — not even the name of the library we cannot watch.
 *
 *   3. NO PERCENTAGES. We do not know the denominator. There is no "83%
 *      instrumented" here and there must never be one: that is precisely the
 *      self-flattering meter we tell customers not to trust.
 */

import { attachState } from "./attachStatus";
import { unwatchedAiClientCount } from "./aiCalls";
import { getCacheDirectiveStats } from "./cacheDirectives";
import { getDbWorkStats, unwatchedDbClientCount } from "./dbWork";
import {
  attachedJobSystemCount,
  getJobWorkStats,
  unattachedJobSystemCount,
} from "./jobWork";
import { outboundAttemptsObserved } from "./liveDetectors";
import { isBoosthisDisabled } from "./runtimeFlags";
import { summary } from "./samples";
import { isServerlessMode } from "./serverless";
import { serverlessCounters } from "./serverlessMeters";
import type {
  CoverageInventory,
  SurfaceGap,
  WatchableSurface,
} from "./watchableSurfaces";

export type { CoverageInventory, SurfaceGap } from "./watchableSurfaces";

/** Never let one blind reader's throw cost us the whole inventory. */
function safeNumber(read: () => number): number {
  try {
    const n = read();
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function safeFlag(read: () => boolean): boolean {
  try {
    return read() === true;
  } catch {
    return false;
  }
}

/**
 * What this kit is attached to right now, and what it found and cannot watch.
 *
 * Cheap enough to call at every registration: every number here is already
 * being kept for a meter, and reading them is a handful of property reads and
 * one throttled module-cache scan that the request boundary runs anyway.
 *
 * Never throws. Under the kill-switch it reports nothing at all — a switched-off
 * kit has neither reached anything nor found anything, and saying otherwise
 * would be a claim about an app we stopped looking at.
 */
export function coverageInventory(): CoverageInventory {
  if (safeFlag(isBoosthisDisabled)) return { watched: [], unwatched: [] };

  const watched: WatchableSurface[] = [];
  const unwatched: SurfaceGap[] = [];
  const gap = (
    surface: WatchableSurface,
    reason: SurfaceGap["reason"],
    detected: number,
  ): void => {
    if (detected > 0) unwatched.push({ surface, reason, detected });
  };

  /* ── Request handling ──────────────────────────────────────────────────
   * Two wirings reach the same boundary: `boosthis()` as middleware, and
   * `attach()` for every other Node server. Either one counts as watched the
   * moment a real request has gone through it. A refusal is the one thing this
   * kit can state as a gap without waiting: `attach()` was called, and this
   * process would not let it on. */
  const attach = (() => {
    try {
      return attachState();
    } catch {
      return null;
    }
  })();
  const timedRequests =
    safeNumber(() => summary().total) +
    safeNumber(() => attach?.requestsObserved ?? 0);
  if (timedRequests > 0) watched.push("request-handling");
  else if (attach?.called === true && attach.attached !== true) {
    gap("request-handling", "attach-refused", 1);
  }

  /* ── Outbound calls ────────────────────────────────────────────────────
   * Watched once a call has actually arrived at the observer. The gap is the
   * count of HTTP clients this app loaded that open their own sockets past it —
   * a count, never which ones. */
  if (safeNumber(outboundAttemptsObserved) > 0) watched.push("outbound-calls");
  gap("outbound-calls", "no-adapter-yet", safeNumber(unwatchedAiClientCount));

  /* ── Database work ─────────────────────────────────────────────────────
   * `callCount` only moves when a query really went through our patch, so it
   * is read-back evidence rather than "we armed something". The gap counts
   * drivers this app loaded that we cannot watch; it self-reports zero unless
   * observation is actually running, so it cannot manufacture a gap in an app
   * that never touched a database. */
  if (safeNumber(() => getDbWorkStats().callCount) > 0)
    watched.push("database-work");
  gap("database-work", "no-adapter-yet", safeNumber(unwatchedDbClientCount));

  /* ── Background jobs and schedules ─────────────────────────────────────
   * Attached job systems and hand-marked runs both count. The gap is the job
   * libraries this app really loaded that have no adapter — bree runs each job
   * in a child process we are not inside, agenda registers handlers through
   * several equally valid entry points, and so on. */
  if (
    safeNumber(attachedJobSystemCount) > 0 ||
    safeNumber(() => getJobWorkStats().runs) > 0
  ) {
    watched.push("background-jobs");
  }
  gap("background-jobs", "no-adapter-yet", safeNumber(unattachedJobSystemCount));

  /* ── Response caching ──────────────────────────────────────────────────
   * Watched once a cacheable reply has been read. No gap: wherever this kit
   * sits on the request boundary it can see the headers. */
  if (safeNumber(() => getCacheDirectiveStats().watched) > 0)
    watched.push("response-caching");

  /* ── Serverless handlers ───────────────────────────────────────────────
   * Only asked on a host we positively recognised as a function platform, so
   * an ordinary long-running server never reports a serverless gap. There,
   * an invocation that went through `withBoosthis` is the read-back evidence.
   * Without one, the handler was never wrapped — which is exactly why timeout
   * headroom abstains rather than guessing, and the developer deserves to be
   * told why rather than left with a blank tile. */
  if (safeFlag(isServerlessMode)) {
    if (safeNumber(() => serverlessCounters().invocations) > 0)
      watched.push("serverless-handlers");
    else gap("serverless-handlers", "not-wrapped", 1);
  }

  return { watched: watched.sort(), unwatched: sortGaps(unwatched) };
}

/** Stable order, so an unchanged app produces an unchanged fingerprint. */
export function sortGaps(gaps: SurfaceGap[]): SurfaceGap[] {
  return gaps
    .slice()
    .sort((a, b) =>
      a.surface === b.surface
        ? a.reason.localeCompare(b.reason)
        : a.surface.localeCompare(b.surface),
    );
}

/**
 * A short, comparable string for one inventory.
 *
 * Registration happens at startup, and most of this app's surfaces do not
 * exist yet at startup: the database client is armed at the first request, a
 * job library required lazily is not in the module cache until something needs
 * it. An inventory sent once would therefore be systematically incomplete and
 * would read as "nothing unwatched here" for the life of the process. The
 * fingerprint is what lets the kit re-register when — and only when — the
 * answer has actually changed.
 */
export function coverageFingerprint(inv: CoverageInventory): string {
  return [
    inv.watched.join(","),
    inv.unwatched.map((g) => `${g.surface}:${g.reason}:${g.detected}`).join(","),
  ].join("|");
}
