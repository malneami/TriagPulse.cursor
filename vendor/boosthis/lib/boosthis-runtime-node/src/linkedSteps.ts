/**
 * LINKED STEPS — each database call and each outside-service call made INSIDE
 * one measured request (or background-job run), sent as a step of its own
 * whose parent is that request's own step.
 *
 * They are what lets the project map draw a measured line on a project with a
 * single server: route → Database, route → payments. The database and
 * outside-service meters already watch these calls inside the request's own
 * scope, but only TOTAL them across the install, so the map could show a
 * Database box and never which route reached it.
 *
 * Source of truth: `linkedSteps` in lib/span-wire-vocabulary.json (marker
 * BOOSTHIS_LINKED_STEPS_V1). This file, the server's linkedSteps.ts and the
 * Python kit's linked_steps.py are its copies, and
 * scripts/src/__tests__/span-wire-field-parity.test.ts holds them to it.
 *
 * WHAT LEAVES: a kind (`db` or `http`), a timing, an outcome, and ONE word
 * from the closed list below. The word is decided by the meter that already
 * classified the call — `database`, or the outside-service reading's own
 * group — and nothing about the call itself is read here: never the
 * statement, a table, a host, an address, a path or a value.
 *
 * THE FOLD. Repeated calls of the same word inside one request are folded
 * into ONE step: it starts when the first of them started, lasts as long as
 * at least one of them was in flight, and its outcome is `error` when any of
 * them failed. So a request sends at most one step per word — seven at most.
 * A call still in flight when its request ends is not linked to it.
 *
 * Steps are sent only for a request whose own step is sent, and they ride
 * the same upload, the same consent and the same kill-switch as that step
 * (spanEmitter.ts). An AI provider's call is not linked: the AI reading
 * measures it, and it is neither a database nor an outside-service group.
 */

import { currentRequestScope } from "./repeatedWork";
import { isBoosthisDisabled } from "./runtimeFlags";
import { isKitLocked } from "./killSwitch";
import { rateSpanDuration, type SpanLayer, type TraceSpan } from "./spanEmitter";
import { newSpanId } from "./spanScope";
import type { DependencyKind } from "./dependencyKinds";

export const LINKED_STEPS_MARKER = "BOOSTHIS_LINKED_STEPS_V1";

/** The closed words, per kind. */
export const LINKED_STEP_LABELS = {
  db: ["database"],
  http: ["signin", "storage", "payments", "messaging", "search", "other"],
} as const;

/** At most one step per word per request — so seven, by construction. */
export const MAX_LINKED_STEPS_PER_REQUEST = 7;

export type LinkedStepWord = "database" | DependencyKind;

const HTTP_WORDS: ReadonlySet<string> = new Set(LINKED_STEP_LABELS.http);

function kindOfWord(word: string): "db" | "http" | null {
  if (word === "database") return "db";
  return HTTP_WORDS.has(word) ? "http" : null;
}

/** How many separate in-flight windows one word keeps before folding them
 *  together. Bounded so a request that makes ten thousand queries costs the
 *  same few bytes as one that makes ten. */
const MAX_WINDOWS_PER_WORD = 64;

interface WordFold {
  kind: "db" | "http";
  /** In-flight windows on the performance clock, [start, end]. */
  windows: number[][];
  failed: boolean;
}

/** One request's (or one job run's) linked calls, folded by word. Opaque to
 *  every caller but this module. */
export interface LinkedScope {
  /** `performance.now()` when the request or run began — the zero every
   *  step's offset is measured from. */
  openedAt: number;
  words: Map<LinkedStepWord, WordFold> | null;
  /** Set when the request or run ended. A call that finishes after this was
   *  still in flight when its request answered, and is not linked to it. */
  closed: boolean;
}

/** One folded step, ready to become a span. */
export interface LinkedStepFold {
  kind: "db" | "http";
  word: LinkedStepWord;
  /** Ms after the request or run began. */
  startMs: number;
  durationMs: number;
  failed: boolean;
}

/** Open a scope for one request or run, or null under the kill-switch. */
export function openLinkedScope(openedAt: number = performance.now()): LinkedScope | null {
  if (isBoosthisDisabled() || isKitLocked()) return null;
  return { openedAt, words: null, closed: false };
}

let jobScopeReader: (() => LinkedScope | null) | null = null;

/** The job meter's own scope reader, registered by jobWork.ts so a call made
 *  inside a measured job run is linked to that run. Held here, rather than
 *  imported, so this module never loads the job meter. */
export function setJobLinkedScopeReader(fn: (() => LinkedScope | null) | null): void {
  jobScopeReader = fn;
}

/**
 * The scope a call issued RIGHT NOW belongs to: the job run it is inside,
 * else the request it is inside, else none. Read at the moment a call is
 * issued and carried to its completion — a pooled connection answers on a
 * socket some earlier request opened, so the ambient scope at completion
 * time is the wrong one (see dbWork.noteDbCallIn).
 */
export function currentLinkedScope(): LinkedScope | null {
  try {
    const job = jobScopeReader ? jobScopeReader() : null;
    if (job) return job;
    return currentRequestScope()?.linked ?? null;
  } catch {
    return null;
  }
}

/**
 * One finished call, filed into the scope captured when it was issued.
 * `start` and `end` are on the performance clock. Never throws.
 */
export function noteLinkedCall(
  scope: LinkedScope | null | undefined,
  word: LinkedStepWord,
  start: number,
  end: number,
  failed: boolean,
): void {
  try {
    if (!scope || scope.closed || isBoosthisDisabled() || isKitLocked()) return;
    const kind = kindOfWord(word);
    if (kind === null) return;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    const s = start;
    const e = end > start ? end : start;
    if (scope.words === null) scope.words = new Map();
    let fold = scope.words.get(word);
    if (!fold) {
      fold = { kind, windows: [], failed: false };
      scope.words.set(word, fold);
    }
    if (failed) fold.failed = true;
    if (fold.windows.length >= MAX_WINDOWS_PER_WORD) {
      fold.windows = mergeWindows(fold.windows);
    }
    if (fold.windows.length >= MAX_WINDOWS_PER_WORD) {
      // Still full of separate windows: widen the last one to cover this
      // call. The step can read slightly longer than the union, never shorter
      // than the time a call was really in flight.
      const last = fold.windows[fold.windows.length - 1]!;
      last[0] = Math.min(last[0]!, s);
      last[1] = Math.max(last[1]!, e);
      return;
    }
    fold.windows.push([s, e]);
  } catch {
    /* instrumentation must never disturb the host */
  }
}

function mergeWindows(windows: number[][]): number[][] {
  const sorted = windows.map((w) => [w[0]!, w[1]!]).sort((a, b) => a[0]! - b[0]!);
  const out: number[][] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w[0]! <= last[1]!) {
      if (w[1]! > last[1]!) last[1] = w[1]!;
    } else {
      out.push(w);
    }
  }
  return out;
}

/**
 * Close a scope and fold what it collected: one step per word, oldest first.
 * Every later call into it is ignored. Never throws; an absent scope folds
 * nothing.
 */
export function closeLinkedScope(scope: LinkedScope | null | undefined): LinkedStepFold[] {
  try {
    if (!scope || scope.closed) return [];
    scope.closed = true;
    const words = scope.words;
    scope.words = null;
    if (words === null) return [];
    const out: LinkedStepFold[] = [];
    for (const [word, fold] of words) {
      if (fold.windows.length === 0) continue;
      const merged = mergeWindows(fold.windows);
      let busy = 0;
      for (const w of merged) busy += w[1]! - w[0]!;
      out.push({
        kind: fold.kind,
        word,
        startMs: Math.max(0, merged[0]![0]! - scope.openedAt),
        durationMs: busy,
        failed: fold.failed,
      });
    }
    out.sort((a, b) => a.startMs - b.startMs);
    return out.slice(0, MAX_LINKED_STEPS_PER_REQUEST);
  } catch {
    return [];
  }
}

/** The folded steps as spans, each naming `parentSpanId` as its parent. */
export function linkedStepSpans(
  folds: readonly LinkedStepFold[],
  at: { traceId: string; layer: SpanLayer; parentSpanId: string; baseOffsetMs: number },
): TraceSpan[] {
  const out: TraceSpan[] = [];
  for (const f of folds.slice(0, MAX_LINKED_STEPS_PER_REQUEST)) {
    out.push({
      traceId: at.traceId,
      layer: at.layer,
      routeLabel: f.word,
      durationMs: f.durationMs,
      startOffsetMs: at.baseOffsetMs + f.startMs,
      rating: rateSpanDuration(f.durationMs),
      spanId: newSpanId(),
      parentSpanId: at.parentSpanId,
      kind: f.kind,
      outcome: f.failed ? "error" : "ok",
    });
  }
  return out;
}

/** @internal test hooks. */
export const _linkedStepsInternals = {
  MAX_WINDOWS_PER_WORD,
  mergeWindows,
  hasJobScopeReader: (): boolean => jobScopeReader !== null,
};
