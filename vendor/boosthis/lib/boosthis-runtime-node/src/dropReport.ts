/**
 * "The server stored fewer rows than this app sent" — said inside the app.
 *
 * WHY THIS EXISTS. The three upload endpoints answer `202` and then discard
 * individual rows they cannot store: a route label the shared privacy guard
 * refuses, a span past the per-trace cap, a snapshot entry whose name is
 * rejected. Until now the kit read that `202` as unqualified success, so a
 * developer whose every route label was being thrown away saw a healthy app,
 * no output, and a dashboard that was quietly missing data. The only way to
 * find out was for us to read the database by hand — which is exactly what
 * cost real debugging time during the Flutter live smoke.
 *
 * CONTRACT (identical in every kit — change it in one, change it in
 * all):
 *   - Read `dropped` and `droppedByCause` from an upload reply. Their ABSENCE
 *     (older server, non-JSON body, unreadable body) means "nothing to report":
 *     no warning, no crash, no guessing.
 *   - Warn EXACTLY ONCE per process per cause on the host's error stream,
 *     naming the cause and the fix. Never once per request, never behind a
 *     debug flag — this exists for the developer who does not yet suspect the
 *     kit, the same reason the "stayed inactive" line is ungated.
 *   - Keep a cumulative count + the causes seen, so the kit's own status page
 *     and bubble can show the size of the hole in the same words the web page
 *     uses.
 *   - Nothing here may ever fail an upload or reach the host's request path:
 *     every entry point is self-guarded and the reply is read after the
 *     response is already in hand.
 *   - Nothing is uploaded. The warning is local output only.
 */

import { readAnswerJson } from "./answerRead";

/** Why the server threw a row away. Mirrors the server's `DropCause`; any
 *  cause key this kit does not know is counted in the total and named nowhere
 *  — a kit must never invent an explanation for something it cannot read. */
export type DropCause =
  | "labelRejected"
  | "traceCapReached"
  | "snapshotEntryFiltered";

const CAUSE_KEYS: readonly DropCause[] = [
  "labelRejected",
  "traceCapReached",
  "snapshotEntryFiltered",
];

/** Short cause text — the same words the project's web page uses, so the
 *  in-app view and the dashboard never tell two different stories. */
export const DROP_CAUSE_TEXT: Record<DropCause, string> = {
  labelRejected: "route names the privacy guard refused",
  traceCapReached: "spans past the 20-span limit",
  snapshotEntryFiltered: "snapshot entries the privacy guard refused",
};

/** What the developer changes to stop it. Second sentence of the warning. */
export const DROP_CAUSE_FIX: Record<DropCause, string> = {
  labelRejected: "Name routes in code, the way GET /orders is written.",
  traceCapReached:
    "A trace keeps its first 20 spans — measure fewer steps per request, or split a very long trace.",
  snapshotEntryFiltered:
    "Name screens in code, never from what a person typed or an id.",
};

/** Counts parsed out of one upload reply. */
export interface ParsedDrops {
  /** Total rows the server refused. Always >= 0. */
  total: number;
  /** Per-cause counts for the causes this kit knows, in a fixed order. */
  byCause: Array<{ cause: DropCause; count: number }>;
}

function finiteCount(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return 0;
  return Math.floor(v);
}

/**
 * Read the honesty fields out of a parsed reply body.
 *
 * Returns `null` when the body says nothing about drops — a server that
 * predates the fields, a body that is not an object, or a `dropped` that is
 * not a positive number. `null` means "behave exactly as before".
 */
export function parseDropReply(body: unknown): ParsedDrops | null {
  try {
    if (!body || typeof body !== "object") return null;
    const rec = body as Record<string, unknown>;
    const total = finiteCount(rec.dropped);
    if (total <= 0) return null;
    const raw = rec.droppedByCause;
    const byCause: Array<{ cause: DropCause; count: number }> = [];
    if (raw && typeof raw === "object") {
      const causes = raw as Record<string, unknown>;
      for (const cause of CAUSE_KEYS) {
        const n = finiteCount(causes[cause]);
        if (n > 0) byCause.push({ cause, count: n });
      }
    }
    return { total, byCause };
  } catch {
    return null;
  }
}

// ── Process-local state ─────────────────────────────────────────────────────
//
// Cumulative for the life of the process: it is the size of the hole in the
// dashboard, so a later clean upload does not erase it.

let droppedRows = 0;
const seenCauses = new Set<DropCause>();
const warnedCauses = new Set<DropCause>();

/** How many rows the server has refused since this process started. */
export function getDroppedRowCount(): number {
  return droppedRows;
}

/** The causes seen so far, in the fixed cause order. Empty when nothing has
 *  been dropped. */
export function getDroppedRowCauses(): DropCause[] {
  return CAUSE_KEYS.filter((c) => seenCauses.has(c));
}

/** The status-page / bubble figure: `"6 — route names the privacy guard
 *  refused; spans past the 20-span limit"`. Empty string when nothing has been
 *  dropped, so a healthy app shows nothing at all. */
export function dropSummaryText(): string {
  if (droppedRows <= 0) return "";
  const causes = getDroppedRowCauses().map((c) => DROP_CAUSE_TEXT[c]);
  return causes.length > 0
    ? `${droppedRows} \u2014 ${causes.join("; ")}`
    : String(droppedRows);
}

/** Emit the one-shot line for a cause. stderr via console.warn, ungated,
 *  never repeated. Never throws — a host that replaced console must not crash
 *  on our warning. */
function warnCauseOnce(cause: DropCause, count: number): void {
  if (warnedCauses.has(cause)) return;
  warnedCauses.add(cause);
  try {
    console.warn(
      `[boosthis] Boosthis dropped ${count} of the measurements this app sent: ` +
        `${DROP_CAUSE_TEXT[cause]}. ${DROP_CAUSE_FIX[cause]}`,
    );
  } catch {
    // A broken console must never take the host down.
  }
}

/**
 * Record what one upload reply said, and warn once per cause.
 *
 * Safe to call with anything: a reply without the fields, a string, null. Only
 * a body that actually reports a positive `dropped` changes any state or
 * prints anything.
 */
export function noteServerDrops(body: unknown): void {
  try {
    const parsed = parseDropReply(body);
    if (!parsed) return;
    droppedRows += parsed.total;
    for (const { cause, count } of parsed.byCause) {
      seenCauses.add(cause);
      warnCauseOnce(cause, count);
    }
  } catch {
    // Telling someone about a dropped row must never break an upload.
  }
}

/** Minimal shape of a fetch Response, so this works with any fetch impl or a
 *  test double without importing DOM types. */
interface JsonReadable {
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}

/**
 * Read an upload reply's body and record what it says. Fire-and-forget: the
 * caller does not await it, so a slow or unreadable body can never slow an
 * upload, let alone the host's own request handling.
 *
 * `also` exists because a body can only be read ONCE. Any other reader that
 * needs the same reply — the job-runs upload has to see what the server said
 * about the rhythms it declared — must be handed the parsed body from here
 * rather than reaching for the response itself, or whichever one runs second
 * silently gets nothing.
 */
export async function readDropsFromResponse(
  res: unknown,
  also?: (body: unknown) => void,
): Promise<void> {
  let body: unknown;
  try {
    const r = res as JsonReadable | null;
    if (!r || (typeof r.json !== "function" && typeof r.text !== "function")) return;
    // Bounded while reading: a reply over the ceiling, too slow or not JSON
    // says nothing, exactly like no reply. The upload's STATUS already decided
    // whether it was delivered.
    body = await readAnswerJson(r);
  } catch {
    // No body, not JSON, already consumed, refused — nothing to report, by
    // contract.
    return;
  }
  try {
    noteServerDrops(body);
  } catch {
    /* reading a reply must never fail an upload */
  }
  try {
    also?.(body);
  } catch {
    /* nor may the other reader */
  }
}

// ── The other half: rows THIS KIT never delivered ───────────────────────────
//
// Everything above is about rows that reached the server and were refused. A
// row can also die on this side of the wire, and until now that was invisible
// to the developer: the counts existed only as fields inside the `serverless`
// meter page, which a reader has to know to expand, and which a long-running
// server does not even publish. An ingest-honesty rule already in force says a
// dropped upload must surface as a real failure with the kit's state attached —
// a number buried in an axis is not that.
//
// Same contract as above, deliberately: a closed cause set, a one-shot warning
// per cause on stderr naming the cause and the fix, a cumulative count for the
// status page and the bubble, and nothing uploaded. Kept in this module rather
// than a new one because a developer asking "what is this app failing to
// deliver?" should not have to find two answers in two places.

/**
 * Why a gathered measurement never left this process. Four ways, and a
 * developer's answer differs for each.
 *
 * Deliberately NOT one "lost" total: "the buffer overflowed while the server
 * was unreachable" and "we gave up on a backlog that never drained" ask for
 * different fixes, and a total that merges them asks for none.
 */
export type UndeliveredCause =
  | "bufferFull"
  | "sendFailed"
  | "heldTooLong"
  | "processEnded";

const UNDELIVERED_KEYS: readonly UndeliveredCause[] = [
  "bufferFull",
  "sendFailed",
  "heldTooLong",
  "processEnded",
];

/** Short cause text — used by the kit's own status page and bubble. */
export const UNDELIVERED_CAUSE_TEXT: Record<UndeliveredCause, string> = {
  bufferFull: "buffer full, oldest measurements dropped",
  sendFailed: "an upload failed and its rows were already out of the buffer",
  heldTooLong: "held too long without reaching Boosthis, then given up on",
  processEnded: "the process ended with measurements still waiting",
};

/** What the developer changes to stop it. Second sentence of the warning. */
export const UNDELIVERED_CAUSE_FIX: Record<UndeliveredCause, string> = {
  bufferFull:
    "Measurements are arriving faster than they can be sent — check this app can reach Boosthis.",
  sendFailed:
    "Check this app can reach Boosthis; uploads are being started and not completing.",
  heldTooLong:
    "Uploads have not succeeded for several minutes — check this app can reach Boosthis.",
  processEnded:
    "The process exited before its last upload finished. On a function host this is normal at the end of an instance's life.",
};

let undeliveredRows = 0;
const seenUndelivered = new Set<UndeliveredCause>();
const warnedUndelivered = new Set<UndeliveredCause>();
const undeliveredByCause = new Map<UndeliveredCause, number>();

/** How many gathered measurements this kit failed to deliver, since the process
 *  started. Cumulative: a later clean upload does not erase the hole. */
export function getUndeliveredRowCount(): number {
  return undeliveredRows;
}

/** The causes seen so far, in the fixed cause order. */
export function getUndeliveredCauses(): UndeliveredCause[] {
  return UNDELIVERED_KEYS.filter((c) => seenUndelivered.has(c));
}

/** Per-cause counts, fixed order, only the causes actually seen. */
export function getUndeliveredByCause(): Array<{
  cause: UndeliveredCause;
  count: number;
}> {
  return getUndeliveredCauses().map((cause) => ({
    cause,
    count: undeliveredByCause.get(cause) ?? 0,
  }));
}

/** The status-page / bubble figure for rows this kit never delivered:
 *  `"7 — buffer full, oldest measurements dropped"`. Empty when none. */
export function undeliveredSummaryText(): string {
  if (undeliveredRows <= 0) return "";
  const causes = getUndeliveredCauses().map((c) => UNDELIVERED_CAUSE_TEXT[c]);
  return causes.length > 0
    ? `${undeliveredRows} \u2014 ${causes.join("; ")}`
    : String(undeliveredRows);
}

/**
 * Record measurements this kit could not deliver, and warn once per cause.
 *
 * Called from the meters' own loss counter, so every path that already counts a
 * lost row reports it here too — there is no second list of call sites to keep
 * in step. Never throws: losing a row must not also crash the host.
 */
export function noteUndeliveredRows(
  cause: UndeliveredCause,
  rows: number,
): void {
  try {
    if (!Number.isFinite(rows) || rows <= 0) return;
    const n = Math.floor(rows);
    undeliveredRows += n;
    seenUndelivered.add(cause);
    undeliveredByCause.set(cause, (undeliveredByCause.get(cause) ?? 0) + n);
    if (warnedUndelivered.has(cause)) return;
    warnedUndelivered.add(cause);
    try {
      console.warn(
        `[boosthis] Boosthis could not deliver ${n} of the measurements this app gathered: ` +
          `${UNDELIVERED_CAUSE_TEXT[cause]}. ${UNDELIVERED_CAUSE_FIX[cause]}`,
      );
    } catch {
      // A broken console must never take the host down.
    }
  } catch {
    // Counting a loss may never break the path that lost it.
  }
}

/** @internal Test hook — forget every drop and every warn-once latch. */
export function _resetDropReportForTests(): void {
  droppedRows = 0;
  seenCauses.clear();
  warnedCauses.clear();
  undeliveredRows = 0;
  seenUndelivered.clear();
  warnedUndelivered.clear();
  undeliveredByCause.clear();
}
