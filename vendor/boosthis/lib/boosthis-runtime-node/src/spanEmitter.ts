/** Full-stack trace — Stage 2: span emission (Node/Express layer).
 *
 * Byte-for-byte the same wire contract as the RN + Python span emitters. Stage 1
 * (see `trace.ts`) only *propagated* a 32-hex correlation id on the
 * `x-boosthis-trace` header; Stage 2 lets the Node layer emit ONE privacy-safe
 * span per handled request so the server can stitch a waterfall
 * (RN → Node → Python) keyed by that id.
 *
 * A span is a tiny, closed, code-derived shape:
 *   { traceId, layer:"node", routeLabel, durationMs, startOffsetMs, rating }
 *
 * Unlike RN (which mints a span at the outbound `traceFetch` call site), the Node
 * layer emits its span from the `boosthis()` middleware's request-finalize hook,
 * reusing the SAME `${METHOD} ${normalizedPath}` label the per-route sampler
 * already builds (ids redacted by `normalizePath`), capped at 100 chars. Nothing
 * here is screen-bearing beyond that code-defined label, and it rides the SAME
 * PII guard as every other transmit (see `telemetry.transmitSpans`).
 *
 * PRIVACY-BY-DEFAULT: `enqueueSpan` is a no-op until a submitter is wired. The
 * telemetry client only wires the span submitter when the snapshot mirror is
 * allowed (full mode, or issues-only after the developer connects an AI), so a
 * private app RETAINS nothing span-shaped until sharing is authorized. The
 * emergency kill-switch (`BOOSTHIS_DISABLED`) and `forget()` both stop and clear
 * it, exactly like the snapshot mirror.
 *
 * Everything here is best-effort: span bookkeeping must NEVER change the host
 * request's behavior or crash the app.
 */

import { rateDuration } from "./thresholds";
import { MAX_PART_NAME } from "./routeInventory";
import { isBoosthisDisabled } from "./runtimeFlags";
import { isKitLocked } from "./killSwitch";
import { noteRowsDiscarded, noteRowsDelivered } from "./serverlessMeters";
import { sanitizeSpanId } from "./spanScope";
import { uploadsReady } from "./uploadRecovery";
import { uploadPausedUntil } from "./uploadPause";
import {
  sanitizeWorkKind,
  sanitizeOutcome,
  type SpanWorkKind,
  type SpanOutcome,
} from "./spanWork";

/** At most one linked step per word per request — the same seven as
 *  linkedSteps.ts (MAX_LINKED_STEPS_PER_REQUEST), held here as a plain number
 *  so this module, which linkedSteps.ts imports, imports nothing back. */
const MAX_LINKED_STEPS_PER_REQUEST = 7;

export type SpanLayer = "rn" | "node" | "py";
export type SpanRating = "good" | "needs-work" | "poor";

/** One privacy-safe root/child span. Wire shape is byte-identical across all
 *  three runtimes and matches the server's `POST /api/spans` schema.
 *
 *  `spanId`/`parentSpanId` are the causality pair (see spanScope.ts). Both are
 *  OPTIONAL on the wire and are omitted entirely when absent, so a runtime that
 *  does not carry parentage sends exactly the bytes it always did and its spans
 *  still read as a valid — merely flat — trace. */
export interface TraceSpan {
  traceId: string;
  layer: SpanLayer;
  routeLabel: string;
  durationMs: number;
  startOffsetMs: number;
  rating: SpanRating;
  spanId?: string | null;
  parentSpanId?: string | null;
  /** What KIND of work this was, and whether it WORKED. Same rules as the
   *  causality pair: optional, drawn from the shared vocabulary in
   *  `spanWork.ts`, and omitted entirely when the kit has nothing to say —
   *  never sent as a placeholder, because an absent field reads as "this kit
   *  does not report it" and a value would read as a measurement. */
  kind?: SpanWorkKind | null;
  outcome?: SpanOutcome | null;
  /** `"declared"` on the step of a route the developer declared as waiting on
   *  purpose (declaredWaits.ts): the trace shows it, and the server keeps its
   *  duration out of every figure it builds from steps. Omitted otherwise. */
  wait?: "declared" | null;
}

/** Server accepts at most 50 spans per batch. */
export const MAX_SPAN_BATCH = 50;
/** Hard cap on the in-memory buffer (drop-oldest on overflow) so a burst of
 *  requests between flushes can never grow memory without bound. */
export const MAX_BUFFERED_SPANS = 50;
/**
 * The LINKED STEPS' own share (linkedSteps.ts): how many of them may wait to
 * be sent once the step they belong to has left. Separate from the cap above
 * on purpose — a linked step can never push a request's own step out of the
 * buffer, and a batch always takes the requests' own steps first. A request's
 * linked steps wait beside it until it is sent, and are thrown away with it
 * if it is thrown away.
 */
export const MAX_BUFFERED_LINKED_STEPS = 50;
/** Auto-flush cadence. */
export const SPAN_FLUSH_MS = 15_000;
/** Duration hard clamp (matches the server `durationMs` 0..600000 bound). */
export const MAX_SPAN_DURATION_MS = 600_000;

/** Classify a request duration against the shared TTI band — byte-identical to
 *  RN `rateSpanDuration` and Python `rate_duration`. Delegates to the shared
 *  `rateDuration` so there is exactly one Node threshold source. */
export function rateSpanDuration(ms: number): SpanRating {
  return rateDuration(ms);
}

/** Refuse a code-defined route label over the shared bound. The label itself is
 *  built by the middleware (`${METHOD} ${normalizePath(path)}`). */
export function spanLabel(label: string): string | null {
  return label.length <= MAX_PART_NAME ? label : null;
}

export type SpanSubmitter = (spans: TraceSpan[]) => Promise<number>;

let submitter: SpanSubmitter | null = null;
let buffer: TraceSpan[] = [];
/** Linked steps waiting for the request step they belong to, keyed by that
 *  step's own id. Only ever holds steps whose parent is still in `buffer`. */
let waitingForParent = new Map<string, TraceSpan[]>();
/** Linked steps whose parent has been sent (or that travel as one group with
 *  their job run's own step), in groups, oldest first. */
let linkedReady: TraceSpan[][] = [];
let linkedReadyRows = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let active = false;
let inFlight = false;

/** Wire (or clear) the transport that ships buffered spans. Clearing it makes
 *  `enqueueSpan` inert immediately — the privacy-by-default gate. */
export function setSpanSubmitter(fn: SpanSubmitter | null): void {
  submitter = fn;
}

/** Drop the in-memory span buffer (called by `forget()`). */
export function clearBufferedSpans(): void {
  buffer = [];
  waitingForParent = new Map();
  linkedReady = [];
  linkedReadyRows = 0;
}

/** Rebuild a closed span (never spread unknown keys), clamped. Null when the
 *  label is over the shared bound. */
function closedRow(span: TraceSpan): TraceSpan | null {
  if (span.routeLabel.length > MAX_PART_NAME) {
    noteRowsDiscarded(1, "sendFailed");
    return null;
  }
  const durationMs = Math.max(
    0,
    Math.min(MAX_SPAN_DURATION_MS, Math.round(span.durationMs)),
  );
  const startOffsetMs = Math.max(
    0,
    Math.min(MAX_SPAN_DURATION_MS, Math.round(span.startOffsetMs || 0)),
  );
  // The causality pair is validated here and ADDED ONLY WHEN PRESENT: a
  // malformed id is dropped rather than forwarded, and a span with nothing to
  // say about its caller sends the same six keys it always did.
  const row: TraceSpan = {
    traceId: span.traceId,
    layer: span.layer,
    routeLabel: span.routeLabel,
    durationMs,
    startOffsetMs,
    rating: span.rating,
  };
  const spanId = sanitizeSpanId(span.spanId);
  if (spanId !== null) row.spanId = spanId;
  const parentSpanId = sanitizeSpanId(span.parentSpanId);
  if (parentSpanId !== null) row.parentSpanId = parentSpanId;
  const kind = sanitizeWorkKind(span.kind);
  if (kind !== null) row.kind = kind;
  const outcome = sanitizeOutcome(span.outcome);
  if (outcome !== null) row.outcome = outcome;
  if (span.wait === "declared") row.wait = "declared";
  return row;
}

/** Linked steps as closed rows, each forced to name `parentSpanId`. */
function closedLinkedRows(
  linked: readonly TraceSpan[],
  parentSpanId: string,
): TraceSpan[] {
  const out: TraceSpan[] = [];
  for (const l of linked.slice(0, MAX_LINKED_STEPS_PER_REQUEST)) {
    const row = closedRow({ ...l, parentSpanId });
    if (row !== null && row.parentSpanId === parentSpanId) out.push(row);
  }
  return out;
}

/** Queue one group of linked steps whose parent has left (or travels with
 *  them), throwing the OLDEST group away whole when the share is full. */
function pushLinkedGroup(group: TraceSpan[]): void {
  if (group.length === 0) return;
  linkedReady.push(group);
  linkedReadyRows += group.length;
  while (linkedReadyRows > MAX_BUFFERED_LINKED_STEPS && linkedReady.length > 0) {
    const dropped = linkedReady.shift()!;
    linkedReadyRows -= dropped.length;
    noteRowsDiscarded(dropped.length);
  }
}

/** Buffer one span for the next flush. No-op unless a submitter is wired
 *  (sharing authorized) and the kill-switch is off — so nothing span-shaped is
 *  even RETAINED on a private app. Clamps duration and drops the oldest span
 *  when the buffer is full.
 *
 *  `linked` are the LINKED STEPS made inside this span's request
 *  (linkedSteps.ts). They are kept only when the span itself is kept and
 *  carries its own id, and they wait beside it: sent after it, or thrown
 *  away with it. Returns whether the span was buffered. */
export function enqueueSpan(
  span: TraceSpan,
  linked?: readonly TraceSpan[],
): boolean {
  if (!submitter || isBoosthisDisabled() || isKitLocked()) return false;
  const row = closedRow(span);
  if (row === null) return false;
  buffer.push(row);
  if (linked && linked.length > 0 && row.spanId) {
    const kids = closedLinkedRows(linked, row.spanId);
    if (kids.length > 0) waitingForParent.set(row.spanId, kids);
  }
  // Overflow: the oldest span is thrown away to make room. On a long-running
  // server that is a rare, self-correcting blip. On a function it is the normal
  // consequence of a frozen invocation — the buffer survives the freeze, fills
  // on the next wake, and quietly loses the difference. Count it, so a gap in a
  // customer's data can never read as a quiet period. Its linked steps go with
  // it: a step whose request never arrives would be a part of nothing.
  while (buffer.length > MAX_BUFFERED_SPANS) {
    const gone = buffer.shift()!;
    let n = 1;
    if (gone.spanId) {
      const kids = waitingForParent.get(gone.spanId);
      if (kids) {
        waitingForParent.delete(gone.spanId);
        n += kids.length;
      }
    }
    noteRowsDiscarded(n);
  }
  return true;
}

/**
 * Buffer one background-job run's own step and the linked steps made inside
 * it, as ONE group in the linked steps' share — so a busy job can never push
 * a request's own step out of the buffer. Same gates as `enqueueSpan`.
 * Returns whether the group was buffered.
 */
export function enqueueJobRunSteps(
  run: TraceSpan,
  linked: readonly TraceSpan[],
): boolean {
  if (!submitter || isBoosthisDisabled()) return false;
  const row = closedRow(run);
  if (row === null || !row.spanId) return false;
  const kids = closedLinkedRows(linked, row.spanId);
  if (kids.length === 0) return false;
  pushLinkedGroup([row, ...kids]);
  return true;
}

/** What one batch took off the buffers: the rows in wire order, and where
 *  each came from, so a batch Boosthis asks to wait can go back. */
interface TakenBatch {
  rows: TraceSpan[];
  /** The requests' own steps, oldest first. */
  own: TraceSpan[];
  /** Linked steps let go from `waitingForParent` because the request step
   *  they belong to was taken, keyed by that step's id. */
  released: Map<string, TraceSpan[]>;
  /** Groups taken off `linkedReady`, oldest first. */
  groups: TraceSpan[][];
}

/** Take the next batch off the buffers. `linkedOnly` takes linked steps
 *  alone, whole groups at a time. */
function takeBatch(linkedOnly: boolean): TakenBatch {
  // The requests' own steps FIRST, as many as ever: linked steps only fill
  // the room they leave, whole groups at a time, so a linked step can never
  // delay or displace a request's own step.
  const own = linkedOnly ? [] : buffer.splice(0, MAX_SPAN_BATCH);
  const rows = [...own];
  const released = new Map<string, TraceSpan[]>();
  for (const step of own) {
    if (!step.spanId) continue;
    const kids = waitingForParent.get(step.spanId);
    if (kids) {
      waitingForParent.delete(step.spanId);
      released.set(step.spanId, kids);
      pushLinkedGroup(kids);
    }
  }
  const groups: TraceSpan[][] = [];
  while (
    linkedReady.length > 0 &&
    rows.length + linkedReady[0]!.length <= MAX_SPAN_BATCH
  ) {
    const group = linkedReady.shift()!;
    linkedReadyRows -= group.length;
    rows.push(...group);
    groups.push(group);
  }
  return { rows, own, released, groups };
}

/**
 * Put back a batch Boosthis asked this app to wait with, where it came from
 * and ahead of anything newer, inside the same caps.
 *
 * Linked steps let go when their request step was taken wait for it again,
 * whether they had left in the batch or were still queued behind it. Only a
 * group the linked steps' share had already thrown away (and counted) stays
 * gone. Then the caps apply as they always do, oldest first, and anything
 * over them is counted like every other overflow.
 */
function putBack(taken: TakenBatch): void {
  const sent = new Set<TraceSpan[]>(taken.groups);
  const queued = new Set<TraceSpan[]>(linkedReady);
  const waitAgain = new Set<TraceSpan[]>();
  for (const [parentId, kids] of taken.released) {
    if (!sent.has(kids) && !queued.has(kids)) continue;
    waitAgain.add(kids);
    waitingForParent.set(parentId, kids);
  }
  if (waitAgain.size > 0) {
    const kept: TraceSpan[][] = [];
    for (const group of linkedReady) {
      if (waitAgain.has(group)) linkedReadyRows -= group.length;
      else kept.push(group);
    }
    linkedReady = kept;
  }
  const front = taken.groups.filter((group) => !waitAgain.has(group));
  for (const group of front) linkedReadyRows += group.length;
  linkedReady = [...front, ...linkedReady];
  buffer = [...taken.own, ...buffer];
  while (buffer.length > MAX_BUFFERED_SPANS) {
    const gone = buffer.shift()!;
    let n = 1;
    if (gone.spanId) {
      const kids = waitingForParent.get(gone.spanId);
      if (kids) {
        waitingForParent.delete(gone.spanId);
        n += kids.length;
      }
    }
    noteRowsDiscarded(n);
  }
  while (linkedReadyRows > MAX_BUFFERED_LINKED_STEPS && linkedReady.length > 0) {
    const dropped = linkedReady.shift()!;
    linkedReadyRows -= dropped.length;
    noteRowsDiscarded(dropped.length);
  }
}

/** Send one batch, counting both outcomes. Never throws. */
async function sendBatch(send: SpanSubmitter, taken: TakenBatch): Promise<number> {
  const batch = taken.rows;
  try {
    const accepted = await send(batch);
    noteRowsDelivered(accepted);
    // ASKED TO WAIT (uploadPause.ts): nothing in the batch was judged, so
    // nothing in it is lost. It goes back for the first flush after the
    // pause. Not when the kit was switched off or forgotten meanwhile, which
    // keeps nothing.
    if (
      accepted === 0 &&
      batch.length > 0 &&
      submitter === send &&
      !isBoosthisDisabled() &&
      uploadPausedUntil("spans") !== null
    ) {
      putBack(taken);
      return 0;
    }
    if (accepted < batch.length) {
      noteRowsDiscarded(batch.length - accepted, "sendFailed");
    }
    return accepted;
  } catch {
    noteRowsDiscarded(batch.length, "sendFailed");
    return 0;
  }
}

/** Flush up to one batch — and, when the requests' own steps filled it, one
 *  more batch of linked steps alone. Guarded against re-entrancy + the
 *  kill-switch; swallows any transport error (returns 0). */
async function tick(ending = false): Promise<number> {
  const send = submitter;
  if (
    !send ||
    isBoosthisDisabled() ||
    inFlight ||
    (buffer.length === 0 && linkedReady.length === 0)
  ) {
    return 0;
  }
  // A wait Boosthis asked for: everything stays buffered, inside the same
  // caps, for the first flush after it.
  if (uploadPausedUntil("spans") !== null) return 0;
  if (!uploadsReady(ending)) return 0;
  inFlight = true;
  try {
    // The batch leaves the buffer BEFORE it is sent, so a failed send loses
    // it. That has always been true; what is new is that it is no longer
    // silent — both outcomes are counted, so a gap in a customer's data has a
    // number beside it instead of looking like a quiet period. The one
    // exception is a 429: Boosthis asked this app to wait, and the batch goes
    // back (see sendBatch).
    const batch = takeBatch(false);
    if (batch.rows.length === 0) return 0;
    let accepted = await sendBatch(send, batch);
    // Linked steps still waiting here did not fit beside the requests' own
    // steps. On a busy app that is EVERY batch, and they would never leave:
    // the map would draw no lines for exactly the projects with the most
    // traffic. So one more batch of them alone, once per flush, and only
    // after the first one was taken.
    if (
      accepted > 0 &&
      linkedReady.length > 0 &&
      submitter === send &&
      !isBoosthisDisabled()
    ) {
      const extra = takeBatch(true);
      if (extra.rows.length > 0) accepted += await sendBatch(send, extra);
    }
    return accepted;
  } finally {
    inFlight = false;
  }
}

/** Manually flush the span buffer now (best-effort). */
export function flushSpansNow(ending = false): Promise<number> {
  return tick(ending);
}

/** Start the periodic auto-flush loop. Idempotent. Does NOT fire an immediate
 *  flush (the buffer is empty at wire time). The timer is `unref`'d so it never
 *  keeps a Node process alive on its own. */
export function startSpanAutoFlush(): void {
  if (active) return;
  active = true;
  const loop = (): void => {
    if (!active) return;
    timer = setTimeout(() => {
      void tick().catch(() => {}).finally(() => {
        if (active) loop();
      });
    }, SPAN_FLUSH_MS);
    // Never hold the event loop open just to flush spans.
    (timer as { unref?: () => void } | null)?.unref?.();
  };
  loop();
}

/** Stop the auto-flush loop. */
export function stopSpanAutoFlush(): void {
  active = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Test/introspection hooks (mirrors the RN `_spanInternals`). */
export const _spanInternals = {
  hasSubmitter: (): boolean => submitter !== null,
  bufferLen: (): number => buffer.length,
  /** Linked steps held: waiting for their request, and ready to send. */
  linkedLen: (): number => {
    let n = linkedReadyRows;
    for (const kids of waitingForParent.values()) n += kids.length;
    return n;
  },
  isAutoRunning: (): boolean => active,
  flushMs: (): number => SPAN_FLUSH_MS,
  reset: (): void => {
    stopSpanAutoFlush();
    submitter = null;
    buffer = [];
    waitingForParent = new Map();
    linkedReady = [];
    linkedReadyRows = 0;
    inFlight = false;
  },
};
