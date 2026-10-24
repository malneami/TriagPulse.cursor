/**
 * Reading an answer from the Boosthis server — or from whatever answers at the
 * address this kit was configured with — without letting that answer decide
 * how much of the host app's memory or time it takes.
 *
 * WHY THIS EXISTS
 * This kit runs inside somebody else's process. An answer that is huge (a
 * proxy's error page, an endpoint configured to the wrong place streaming a
 * file, a compressed reply that inflates without end) or one that never
 * finishes arriving would, read whole, take the host's memory with it — and
 * an out-of-memory crash is not an exception anybody can catch. So every read
 * of an answer goes through here, and stops AT its ceiling while reading: the
 * size of each piece is compared with what is left of the allowance BEFORE the
 * piece is kept, never after the whole answer is already held. The read has
 * its own clock as well, so a reply that trickles in a byte at a time cannot
 * keep the kit waiting for ever.
 *
 * A refused answer is a failed exchange, never an error in the host app: the
 * caller treats it exactly as it treats an answer it could not parse — no
 * answer this time, asked again on the caller's normal schedule.
 *
 * WHAT IT CANNOT BOUND
 * A transport handed to the kit by the host (`fetchImpl`) that hands back the
 * answer already whole — no stream to read from — has done its reading before
 * the kit sees a byte. The kit still refuses such an answer by size and gives
 * it the same clock; the download itself was the host's transport's to bound.
 */

/** The largest answer the kit will hold from one exchange, in bytes. Every
 *  answer the kit asks for is a few kilobytes of JSON; a reader whose answer
 *  is legitimately larger (the live dashboard read) names its own ceiling. */
export const ANSWER_MAX_BYTES = 1_048_576;

/** How long the kit waits for an answer to finish arriving once the server has
 *  started answering. Separate from the time a caller allows for the server to
 *  start answering at all. */
export const ANSWER_READ_MS = 10_000;

/** Why an answer was refused. A closed list: no server text ever rides it. */
export type AnswerRefusal = "too-large" | "too-slow" | "malformed";

/** Thrown by the readers below, and only by them, for an answer the kit
 *  refused. Its message is the kit's own words, never anything the answer
 *  said. */
export class AnswerRefused extends Error {
  readonly refusal: AnswerRefusal;
  constructor(refusal: AnswerRefusal) {
    super(`boosthis: answer refused (${refusal})`);
    this.name = "AnswerRefused";
    this.refusal = refusal;
  }
}

/** The refusal an error carries, or null when it is not one of ours. */
export function answerRefusal(err: unknown): AnswerRefusal | null {
  return err instanceof AnswerRefused ? err.refusal : null;
}

export interface AnswerReadOptions {
  /** Ceiling in bytes; defaults to {@link ANSWER_MAX_BYTES}. */
  maxBytes?: number;
  /** Clock for the body read, in milliseconds; defaults to {@link ANSWER_READ_MS}. */
  timeoutMs?: number;
}

interface StreamReader {
  read(): Promise<{ done?: boolean; value?: unknown }>;
  cancel(reason?: unknown): Promise<void>;
}

interface AnswerLike {
  headers?: { get?: (name: string) => string | null | undefined } | null;
  body?: unknown;
  text?: () => Promise<unknown>;
  json?: () => Promise<unknown>;
}

/** UTF-8 length of a string, counted only as far as `stopAt` — a string handed
 *  over whole is already in memory, so this measures it without copying it. */
function utf8Length(s: string, stopAt: number): number {
  let n = 0;
  for (let i = 0; i < s.length && n <= stopAt; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** The length the answer declares for itself, or null when it declares none
 *  (or something unreadable). Used only to refuse early; the count taken
 *  while reading is what decides. */
function declaredLength(r: AnswerLike): number | null {
  try {
    const raw = r.headers && typeof r.headers.get === "function"
      ? r.headers.get("content-length")
      : null;
    if (raw === null || raw === undefined) return null;
    const n = Number(String(raw).trim());
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

/** Let go of an answer the kit will not read, so its connection is freed. */
function discard(r: AnswerLike): void {
  try {
    const body = r.body as
      | { cancel?: () => Promise<void>; destroy?: () => void }
      | null
      | undefined;
    if (body && typeof body.cancel === "function") {
      body.cancel().catch(() => {});
    } else if (body && typeof body.destroy === "function") {
      body.destroy();
    }
  } catch {
    /* already gone */
  }
}

/** A clock that rejects with `too-slow`. Never rejects unobserved. */
function startClock(timeoutMs: number): { done: Promise<never>; stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AnswerRefused("too-slow")), timeoutMs);
    (timer as { unref?: () => void }).unref?.();
  });
  done.catch(() => {});
  return { done, stop: () => clearTimeout(timer) };
}

/** Race one step of a read against the clock. A step abandoned at the clock
 *  must never surface later as an unhandled rejection in the host. */
function step<T>(p: Promise<T>, clock: Promise<never>): Promise<T> {
  p.catch(() => {});
  return Promise.race([p, clock]);
}

/**
 * Wait at most `timeoutMs` for a server to START answering (the status line),
 * for a transport that may not honour an abort signal. Rejects with a
 * `too-slow` refusal; the abandoned call can never surface later as an
 * unhandled rejection.
 */
export function answerWithin<T>(p: Promise<T>, timeoutMs: number): Promise<T> {
  const clock = startClock(timeoutMs);
  return step(p, clock.done).finally(clock.stop);
}

function chunkBytes(value: unknown, maxBytes: number): number {
  if (typeof value === "string") return utf8Length(value, maxBytes);
  const v = value as { byteLength?: unknown } | null | undefined;
  return v && typeof v.byteLength === "number" ? v.byteLength : 0;
}

async function readChunks(
  next: () => Promise<{ done?: boolean; value?: unknown }>,
  stop: () => void,
  maxBytes: number,
  timeoutMs: number,
): Promise<string> {
  const clock = startClock(timeoutMs);
  const decoder = new TextDecoder("utf-8");
  const parts: string[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await step(next(), clock.done);
      if (done) break;
      const n = chunkBytes(value, maxBytes);
      // The ceiling is checked BEFORE the piece is kept.
      if (total + n > maxBytes) throw new AnswerRefused("too-large");
      total += n;
      parts.push(
        typeof value === "string"
          ? value
          : decoder.decode(value as Uint8Array, { stream: true }),
      );
    }
    parts.push(decoder.decode());
    return parts.join("");
  } catch (err) {
    stop();
    throw err;
  } finally {
    clock.stop();
  }
}

async function readWhole(
  r: AnswerLike,
  maxBytes: number,
  timeoutMs: number,
): Promise<string> {
  if (typeof r.text !== "function") throw new AnswerRefused("malformed");
  const clock = startClock(timeoutMs);
  try {
    const text = await step(Promise.resolve().then(() => r.text!()), clock.done);
    if (typeof text !== "string") throw new AnswerRefused("malformed");
    if (utf8Length(text, maxBytes) > maxBytes) throw new AnswerRefused("too-large");
    return text;
  } finally {
    clock.stop();
  }
}

/**
 * Read an answer's body as text, stopping at the ceiling and the clock.
 *
 * Throws {@link AnswerRefused} for an answer that is too large or too slow;
 * any other failure (the connection dropping part-way) is thrown as it came.
 * Never reads past the ceiling: a stream is cancelled the moment the next
 * piece would cross it.
 */
export async function readAnswerText(
  res: unknown,
  opts: AnswerReadOptions = {},
): Promise<string> {
  const maxBytes = opts.maxBytes ?? ANSWER_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? ANSWER_READ_MS;
  const r = res as AnswerLike | null;
  if (!r || typeof r !== "object") throw new AnswerRefused("malformed");
  const declared = declaredLength(r);
  if (declared !== null && declared > maxBytes) {
    discard(r);
    throw new AnswerRefused("too-large");
  }
  const body = r.body as
    | { getReader?: () => StreamReader; [Symbol.asyncIterator]?: () => AsyncIterator<unknown> }
    | null
    | undefined;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    return readChunks(
      () => reader.read(),
      () => {
        reader.cancel().catch(() => {});
      },
      maxBytes,
      timeoutMs,
    );
  }
  if (body && typeof body[Symbol.asyncIterator] === "function") {
    // A Node stream body (a host transport such as node-fetch).
    const it = body[Symbol.asyncIterator]!();
    return readChunks(
      () => it.next(),
      () => {
        try {
          const ended = it.return?.();
          if (ended && typeof (ended as Promise<unknown>).catch === "function") {
            (ended as Promise<unknown>).catch(() => {});
          }
        } catch {
          /* already closed */
        }
        discard(r);
      },
      maxBytes,
      timeoutMs,
    );
  }
  return readWhole(r, maxBytes, timeoutMs);
}

/**
 * Read an answer's body as JSON, stopping at the ceiling and the clock.
 *
 * An answer that is not JSON is refused as `malformed`, so a caller needs one
 * catch for every answer it could not use.
 */
export async function readAnswerJson(
  res: unknown,
  opts: AnswerReadOptions = {},
): Promise<unknown> {
  const r = res as AnswerLike | null;
  if (
    r &&
    typeof r === "object" &&
    !r.body &&
    typeof r.text !== "function" &&
    typeof r.json === "function"
  ) {
    // A response-shaped object that only knows how to hand over parsed JSON
    // (a test double, a minimal transport). Same clock, same ceiling, measured
    // on what it handed over.
    const maxBytes = opts.maxBytes ?? ANSWER_MAX_BYTES;
    const clock = startClock(opts.timeoutMs ?? ANSWER_READ_MS);
    try {
      let value: unknown;
      try {
        value = await step(Promise.resolve().then(() => r.json!()), clock.done);
      } catch (err) {
        if (err instanceof AnswerRefused) throw err;
        throw new AnswerRefused("malformed");
      }
      let size = 0;
      try {
        const s = JSON.stringify(value);
        size = typeof s === "string" ? utf8Length(s, maxBytes) : 0;
      } catch {
        throw new AnswerRefused("malformed");
      }
      if (size > maxBytes) throw new AnswerRefused("too-large");
      return value;
    } finally {
      clock.stop();
    }
  }
  const text = await readAnswerText(res, opts);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AnswerRefused("malformed");
  }
}
