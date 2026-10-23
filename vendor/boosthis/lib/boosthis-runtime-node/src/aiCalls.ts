/* ─── Boosthis: AI-call meter (Node) ───────────────────────────────────────
 *
 * WHY THIS EXISTS. Every app these builders produce calls an AI provider, and
 * that call is usually the slowest and by far the most expensive thing in the
 * request. Until now the kit saw "an outbound call took 8.2 seconds" and
 * nothing else — outbound calls are deliberately reduced to counts and
 * durations, and the destination never leaves the process — so the one part of
 * an AI-built app a developer most needs to understand was the one part we
 * said nothing about.
 *
 * Streaming made it worse. When an answer is streamed, total duration is close
 * to meaningless: what matters is how long before the first words appeared and
 * whether the stream stalled halfway. Nothing measured either.
 *
 * WHERE IT WATCHES, AND WHY THERE. Global `fetch`. Every modern provider SDK
 * (OpenAI, Anthropic, Google, Mistral, Groq, the Vercel AI SDK …) issues
 * through it, and it is the only observation point in Node that can see the
 * REPLY — the outbound diagnostics channel the other meters use delivers
 * request creation, response HEADERS and errors, but never a body, and the
 * token counts live in the body. A client that does not go through global
 * fetch (axios, node-fetch v2, got) is counted as a blind spot rather than
 * quietly reported as an app with no AI calls.
 *
 * WHAT NEVER HAPPENS HERE:
 *   • No prompt and no answer leaves. Reading of the reply is confined to
 *     `aiUsage.ts`, which can only return numbers; a streamed answer's content
 *     deltas are not even handed to a JSON parser.
 *   • No address leaves. A destination becomes a NUMBER from the maintained
 *     provider list (`aiProviders.ts`) or it is not an AI call at all. A call
 *     that cannot be classified stays ordinary outbound traffic — never a
 *     guess.
 *   • The host's own call is never changed. The wrapper passes its arguments
 *     through untouched, returns the provider's own Response object, and every
 *     observation is individually guarded so a failure in here cannot reach
 *     the app. For a destination that is not a known provider the wrapper is a
 *     single classification and a straight call through.
 *   • Nothing is buffered on the app's behalf. The reply is observed as the
 *     app itself reads it; an app that never reads a body costs no memory.
 *
 * PROMPT IDENTITY, AND WHY IT IS SAFE. "The same prompt sent repeatedly" is
 * one of the fixes this reading is here to name, and repetition is only
 * judgeable if two calls can be told apart. The request body is therefore
 * folded into a 32-bit in-process hash on the stack and dropped — exactly what
 * the database meter already does with SQL text and its arguments. The text is
 * never stored, never logged and NEVER leaves this process; only the count of
 * how many times one identity recurred inside one request is reported.
 *
 * ADDITIVE. Three axes (`aiCalls`, `aiSpend`, `aiHeadroom`), none of which
 * touches the composite Speed score, and none of which moves an existing
 * reading. An AI call is claimed by this meter INSTEAD of the repeated-work
 * meter: two different prompts to one provider endpoint share a method, an
 * origin and a path, so the older meter had to call them a repeat. Here they
 * are told apart properly.
 *
 * HONEST WHEN THERE IS NOTHING TO SAY. An app that calls no AI provider
 * uploads NO axis at all, which every surface reads as "cannot tell" — never a
 * row of zeros. Runtimes without this reading do the same.
 */

import { isBoosthisDisabled } from "./runtimeFlags";
import { isKitLocked } from "./killSwitch";
import { currentRequestScope, type RequestWorkScope } from "./repeatedWork";
import {
  aiProviderCodeOrDeclared,
  declaredAiEndpointCount,
  AI_PROVIDERS,
  DECLARED_PROVIDER_CODE,
} from "./aiProviders";
import {
  estimateCostMicros,
  readAiHeaders,
  readAiOutcome,
  readAiUsage,
  streamLineIsInteresting,
  streamLineIsTerminal,
  type AiUsageRead,
} from "./aiUsage";
import type { AiCallStatsLike } from "./meterAxes";
import type { CrossCuttingFinding } from "./candidateRules";
import { settledFromMs } from "./settleRule";

/* ── Limits (memory can never grow with traffic) ─────────────────────────── */

/** Most distinct prompt identities tracked inside ONE request. */
const MAX_DISTINCT_PROMPTS = 128;
/** Longest slice of a request body folded into a prompt identity. */
const MAX_PROMPT_CHARS = 4096;
/** Ring of call durations kept for the percentile readings. */
const DURATION_RING = 256;
/** Longest partial line held while splitting a streamed reply. A usage event
 *  is a few hundred bytes; past this the carry is dropped rather than grown. */
const MAX_STREAM_CARRY = 8192;
/** Longest error body read back to classify a refusal. */
const MAX_ERROR_BODY_CHARS = 8192;

/**
 * A gap this long between two pieces of a streamed answer is a STALL.
 *
 * Chosen against what a person waiting for words actually experiences: below
 * ten seconds a reader assumes the model is thinking, past it they assume the
 * app is broken. Reported, and used by the caption — never a hidden threshold
 * the dashboard has to re-invent.
 */
export const AI_STREAM_STALL_MS = 10_000;

/**
 * Average input tokens above which a cold prompt cache is worth naming.
 *
 * Below this, prompt caching would save little and its absence is not a
 * finding. Mirrors the smallest cacheable prefix the major providers support.
 */
export const AI_CACHEABLE_INPUT_TOKENS = 2048;

/** AI calls in one request needed before "these ran one after another" is a
 *  finding rather than an app that simply makes one call. */
export const AI_SERIAL_THRESHOLD = 2;

/* ── HTTP clients that can make an AI call and cannot be watched here ────── */

/**
 * Clients that bypass global `fetch` and therefore bypass this meter.
 *
 * Listing them is the honest half of the deal: an app that loaded one of these
 * may be making AI calls this meter cannot see, and the tile must say so
 * rather than report a clean picture built on the calls it happened to catch.
 */
const UNWATCHABLE_HTTP_CLIENTS: readonly string[] = [
  "axios",
  "node-fetch",
  "got",
  "superagent",
  "request",
  "needle",
];

/* ── Per-request tally ───────────────────────────────────────────────────── */

/** One request's AI work. Opaque to callers; lives on the shared scope. */
export interface AiRequestTally {
  /** Prompt identity → how many times it was sent in this request. */
  prompts: Map<number, number>;
  /** AI calls that finished inside this request. */
  calls: number;
  /** Ms this request spent on AI calls (wall time of each call). */
  ms: number;
  /** Longest run of AI calls that did NOT overlap each other. */
  serialRun: number;
  /** Current run's high-water mark for {@link serialRun}. */
  runLength: number;
  /** When the previous AI call in this request finished (ms, monotonic). */
  lastEndAt: number;
  /** Micro-USD attributed to this request. */
  costMicros: number;
}

function tallyFor(scope: RequestWorkScope | null): AiRequestTally | null {
  if (!scope) return null;
  if (!scope.ai) {
    scope.ai = {
      prompts: new Map(),
      calls: 0,
      ms: 0,
      serialRun: 0,
      runLength: 0,
      lastEndAt: -1,
      costMicros: 0,
    };
  }
  return scope.ai;
}

/* ── Session totals (the only things that ever leave) ────────────────────── */

let watchedRequests = 0;
let watchedRequestMs = 0;
let aiMs = 0;

let callCount = 0;
let streamCount = 0;
let stallCount = 0;
let failCount = 0;
let rateLimitedCount = 0;
let quotaCount = 0;
let timeoutCount = 0;
let truncatedCount = 0;
let filteredCount = 0;
let noTimeLimitCalls = 0;
let retryNoBackoffCount = 0;

let tokensIn = 0;
let tokensOut = 0;
let cachedIn = 0;
let costMicros = 0;
let reportedCostCalls = 0;
let pricedCalls = 0;
let unpricedCalls = 0;
let worstRequestCostMicros = 0;
let usageMissingCalls = 0;
let streamUsageMissingCalls = 0;

/** Calls that went to an endpoint the app declared as its own. */
let declaredCalls = 0;
/**
 * Of those, the ones whose reply DID report usage and which we still refused
 * to price. Counted separately from {@link unpricedCalls} because the reason
 * is different and the reader deserves the difference: "the provider told us
 * nothing" is a gap, "you host this model, so its price is not ours to state"
 * is a deliberate abstention. Never overlaps the usage-missing count.
 */
let declaredUnpricedCalls = 0;

let promptRepeatWorst = 0;
let promptRepeatRequests = 0;
let serialWorst = 0;
let serialRequests = 0;

let headroomReads = 0;
let worstRequestsPct: number | null = null;
let worstTokensPct: number | null = null;
/* The start-up rule (settleRule.ts): headroom is graded on the TYPICAL
 * settled reading, never the worst one ever seen — a boot-time refusal and a
 * quota window that has since reset stay as context only. Each reading is
 * kept with its time; the meter takes the settled ones of the newest window. */
interface HeadroomSample {
  t: number;
  req: number | null;
  tok: number | null;
}
const HEADROOM_RING = 512;
const HEADROOM_WINDOW_MS = 30 * 60_000;
const headroomSamples: HeadroomSample[] = [];

/** The settled readings of the newest half hour: how many, and the median of
 *  each budget (null where no reading carried it). Numbers only. */
function settledHeadroom(): {
  headroomSettledReads: number;
  typicalRequestsPct: number | null;
  typicalTokensPct: number | null;
} {
  const now = Date.now();
  const edge = Math.max(settledFromMs("startupEvent"), now - HEADROOM_WINDOW_MS);
  const judged = headroomSamples.filter((r) => r.t >= edge && r.t <= now);
  const median = (xs: number[]): number | null => {
    if (xs.length === 0) return null;
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };
  return {
    headroomSettledReads: judged.length,
    typicalRequestsPct: median(judged.flatMap((r) => (r.req === null ? [] : [r.req]))),
    typicalTokensPct: median(judged.flatMap((r) => (r.tok === null ? [] : [r.tok]))),
  };
}
let worstRetryAfterMs = 0;

let serverMsTotal = 0;
let serverMsCalls = 0;

/**
 * Request paths only an AI inference API serves.
 *
 * WHY A PATH AT ALL. A call is classified by its DESTINATION (aiProviders.ts),
 * and a host this kit does not recognise is deliberately not AI: guessing from
 * a hostname would put a CDN, an image resizer and the app's own database
 * proxy into the AI reading. The cost of that rule is silence — an app whose
 * whole AI layer is a self-hosted model, a private gateway or a regional
 * endpoint shows no AI rows at all, which looks exactly like an app with no AI
 * in it, and nothing anywhere says otherwise.
 *
 * This list buys back the difference with POSITIVE EVIDENCE. A POST to
 * `/v1/chat/completions` on an unrecognised host is not a guess: it is the
 * OpenAI-compatible inference shape that vLLM, LiteLLM, LM Studio, llama.cpp
 * and every gateway in front of them speak. Seeing one is grounds for saying
 * "there is AI-shaped traffic here I could not classify", and for nothing
 * else.
 *
 * WHAT IT MUST NOT DO. A matched call is never timed, never scored, never
 * counted as an AI call, and never priced — it cannot be, because the kit does
 * not know whose model it is. It increments one number. The list stays short
 * and closed for the same reason: a shape unrelated services also serve would
 * turn an honest blind-spot note into a false alarm, so the server words the
 * result as a shape that matched, never as a fact about the app's AI.
 */
const AI_SHAPED_PATHS: readonly string[] = [
  // OpenAI-compatible — the shape almost every self-hosted server exposes.
  "/v1/chat/completions",
  "/v1/completions",
  "/v1/responses",
  "/v1/embeddings",
  // Anthropic-compatible.
  "/v1/messages",
  // Ollama's native API.
  "/api/generate",
  "/api/chat",
  "/api/embeddings",
  // Hugging Face text-generation-inference.
  "/generate_stream",
];

/**
 * Calls whose PATH matched {@link AI_SHAPED_PATHS} while their host matched
 * neither the maintained provider list nor anything this app declared.
 *
 * A count and nothing else. The host is compared inside the process and never
 * stored, so this number can say how much AI-shaped traffic went unclassified
 * and can never say where it went.
 */
let unclassifiedAiShaped = 0;

/** Providers seen this session, by wire code. */
const providersSeen = new Set<number>();
/** Calls per provider code, to name the one this app mostly uses. */
const callsByProvider = new Map<number, number>();

/** Ring of total call durations (ms) for the percentile readings. */
const durations: number[] = [];
/** Ring of time-to-first-words (ms) for streamed replies. */
const ttfts: number[] = [];
/* Time to first token from SETTLED streamed calls only: nothing started in
 * the process's first minute, and never a provider's first streamed call,
 * which pays TLS and the model's warm-up (latencyTail). */
const settledTtfts: number[] = [];
const ttftSeenProviders = new Set<number>();

/** When this meter started collecting (ms since epoch) — the cost window. */
let windowStartedAt = 0;

/**
 * Rate-limit refusals, by provider code, with the wait the provider asked for.
 * Used to tell an app that retried too soon apart from one that waited.
 */
const lastRefusal = new Map<number, { at: number; waitMs: number }>();

/* ── Identity (local, non-reversible, never uploaded) ────────────────────── */

/** 32-bit FNV-1a. Fast, allocation-free, stable within one process — which is
 *  all an identity needs to be, since it never leaves. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Fold a request body into a prompt identity, or 0 when there is nothing to
 * fold.
 *
 * Only a STRING body is read — every provider SDK sends JSON text — and only a
 * bounded prefix of it, plus its length so two long prompts sharing a prefix
 * stay distinct. The string is hashed on this stack and dropped.
 */
function promptIdentity(body: unknown): number {
  try {
    if (typeof body !== "string" || !body) return 0;
    const head = body.length > MAX_PROMPT_CHARS
      ? body.slice(0, MAX_PROMPT_CHARS)
      : body;
    return fnv1a(`${body.length}:${head}`) || 1;
  } catch {
    return 0;
  }
}

/* ── One call in flight ──────────────────────────────────────────────────── */

interface AiCallCtx {
  provider: number;
  scope: RequestWorkScope | null;
  startedAt: number;
  headersAt: number;
  firstChunkAt: number;
  lastChunkAt: number;
  worstGapMs: number;
  promptId: number;
  hadTimeLimit: boolean;
  streamed: boolean;
  sawTerminator: boolean;
  usage: AiUsageRead | null;
  /** Set once, so a call can never be counted twice. */
  filed: boolean;
}

/**
 * The clock every AI measurement is taken on.
 *
 * Sub-millisecond and monotonic, which matters for one judgement in
 * particular: "did these calls run one after another, or together?" is decided
 * by comparing when a call started against when the previous one ended, and at
 * whole-millisecond resolution three calls fired in parallel all start and end
 * inside the same tick — so a perfectly parallel fan-out was being reported as
 * serial and handed a fix it did not need.
 */
function nowMs(): number {
  try {
    const p = (globalThis as { performance?: { now?: () => number } })
      .performance;
    if (typeof p?.now === "function") return p.now();
  } catch {
    /* fall through to the wall clock */
  }
  return Date.now();
}

/* ── Filing ──────────────────────────────────────────────────────────────── */

function pushRing(ring: number[], value: number): void {
  ring.push(value);
  if (ring.length > DURATION_RING) ring.shift();
}

/**
 * Finish one AI call: fold it into the session totals and, when the request
 * that ISSUED it is still open, into that request's tally.
 *
 * Called exactly once per call, on every path out (clean finish, refusal,
 * transport error, abandoned stream). Never throws.
 */
function fileCall(ctx: AiCallCtx): void {
  if (ctx.filed) return;
  ctx.filed = true;
  try {
    const end = nowMs();
    const totalMs = Math.max(0, end - ctx.startedAt);
    callCount++;
    providersSeen.add(ctx.provider);
    callsByProvider.set(
      ctx.provider,
      (callsByProvider.get(ctx.provider) ?? 0) + 1,
    );
    pushRing(durations, totalMs);
    if (!ctx.hadTimeLimit) noTimeLimitCalls++;
    if (ctx.streamed) {
      streamCount++;
      if (ctx.firstChunkAt > 0) {
        const ttft = Math.max(0, ctx.firstChunkAt - ctx.startedAt);
        pushRing(ttfts, ttft);
        const firstForProvider = !ttftSeenProviders.has(ctx.provider);
        if (firstForProvider && ttftSeenProviders.size < 1_000) ttftSeenProviders.add(ctx.provider);
        const startedEpochMs = Date.now() - totalMs;
        if (!firstForProvider && startedEpochMs >= settledFromMs("latencyTail")) {
          pushRing(settledTtfts, ttft);
        }
      }
      if (ctx.worstGapMs >= AI_STREAM_STALL_MS) stallCount++;
      // A stream that ended without the provider's own terminal event did not
      // finish its answer — the same failure as a completion cut off by a
      // token cap, and told apart from an ordinary success.
      if (!ctx.sawTerminator) truncatedCount++;
      if (!ctx.usage || ctx.usage.reported === 0) streamUsageMissingCalls++;
    }
    const declared = ctx.provider === DECLARED_PROVIDER_CODE;
    if (declared) declaredCalls++;
    if (!ctx.usage || ctx.usage.reported === 0) {
      usageMissingCalls++;
      unpricedCalls++;
    } else {
      const u = ctx.usage;
      tokensIn += u.tokensIn;
      tokensOut += u.tokensOut;
      cachedIn += u.cachedIn;
      let micros: number | null = u.reportedCostMicros;
      if (micros !== null) {
        // The endpoint stated its own cost. That is true for a declared
        // endpoint as much as for a listed one: it is THEIR number, not our
        // table's guess, so it is taken either way.
        reportedCostCalls++;
        pricedCalls++;
      } else if (declared) {
        // A model the app hosts itself. Our price table describes what a model
        // provider charges on their published page, which says nothing about
        // what this deployment costs its owner — and pricing it from a model
        // NAME would be worse than silence, because a private gateway may
        // answer with a name our table happens to know. Tokens counted, money
        // withheld, and the withholding counted so the tile can say why.
        micros = null;
        unpricedCalls++;
        declaredUnpricedCalls++;
      } else {
        micros = estimateCostMicros(u);
        if (micros !== null) pricedCalls++;
        else unpricedCalls++;
      }
      if (micros !== null && micros > 0) {
        costMicros += micros;
        const t = tallyFor(ctx.scope);
        if (t) t.costMicros += micros;
      }
    }

    // Request-scoped folding — only while the request that issued the call is
    // still open. A call that outlives its request still counts towards the
    // session totals above, but can never move the share-of-a-request reading.
    //
    // The scope was captured when the call was ISSUED, never read here: a
    // reply arrives on whatever async context happens to be current, so
    // reading the ambient scope at completion time files a call against a
    // request that did not make it — the exact fault the database meter hit
    // on a pooled driver.
    const tally = tallyFor(ctx.scope);
    if (tally) {
      tally.calls++;
      tally.ms += totalMs;
      if (ctx.promptId !== 0) {
        if (
          tally.prompts.has(ctx.promptId) ||
          tally.prompts.size < MAX_DISTINCT_PROMPTS
        ) {
          tally.prompts.set(
            ctx.promptId,
            (tally.prompts.get(ctx.promptId) ?? 0) + 1,
          );
        }
      }
      // "Ran one after another" = this call started at or after the previous
      // one in the same request had already finished.
      if (tally.lastEndAt >= 0 && ctx.startedAt >= tally.lastEndAt) {
        tally.runLength = Math.max(2, tally.runLength + 1);
      } else {
        tally.runLength = 1;
      }
      if (tally.runLength > tally.serialRun) tally.serialRun = tally.runLength;
      tally.lastEndAt = end;
      if (tally.costMicros > worstRequestCostMicros) {
        worstRequestCostMicros = tally.costMicros;
      }
    }
  } catch {
    /* a meter must never disturb the host */
  }
}

/**
 * Count a call that never produced an answer, and tell a deadline apart from
 * an ordinary transport failure.
 *
 * The error's own CLASS is read — its `name` and its `code`, both of which are
 * fixed identifiers from a runtime, never text a provider wrote. The message
 * is not read: it is the one field on an error that can contain a prompt, a
 * URL or a key.
 */
function noteTransportFailure(err: unknown): void {
  try {
    const name = String((err as { name?: unknown })?.name ?? "");
    const code = String((err as { code?: unknown })?.code ?? "");
    failCount++;
    if (
      /timeout/i.test(name) ||
      /timeout/i.test(code) ||
      name === "AbortError" ||
      name === "TimeoutError"
    ) {
      timeoutCount++;
    }
  } catch {
    /* never disturb the host */
  }
}

/**
 * Fold the quiet that ran from the last chunk to now into the worst gap.
 *
 * Called where the SOURCE stopped — the stream ended, or it broke — never
 * where the app stopped reading. A gap is otherwise only noticed when a next
 * chunk arrives, which misses the commonest stall there is: an answer that
 * goes silent half-way and then simply stops.
 */
function noteQuietSinceLastChunk(ctx: AiCallCtx): void {
  try {
    if (ctx.lastChunkAt > 0) {
      ctx.worstGapMs = Math.max(ctx.worstGapMs, nowMs() - ctx.lastChunkAt);
    }
  } catch {
    /* never disturb the host */
  }
}

/* ── Reply observation ───────────────────────────────────────────────────── */

/** Note the rate-limit headroom the provider published on one reply. */
function noteHeadroom(ctx: AiCallCtx, res: Response): void {
  try {
    const read = readAiHeaders((name) => res.headers.get(name));
    let sawAny = false;
    if (read.requestsRemaining !== null && read.requestsLimit) {
      const pct = Math.max(
        0,
        Math.min(100, (read.requestsRemaining / read.requestsLimit) * 100),
      );
      worstRequestsPct =
        worstRequestsPct === null ? pct : Math.min(worstRequestsPct, pct);
      sawAny = true;
    }
    if (read.tokensRemaining !== null && read.tokensLimit) {
      const pct = Math.max(
        0,
        Math.min(100, (read.tokensRemaining / read.tokensLimit) * 100),
      );
      worstTokensPct =
        worstTokensPct === null ? pct : Math.min(worstTokensPct, pct);
      sawAny = true;
    }
    if (read.retryAfterMs !== null) {
      worstRetryAfterMs = Math.max(worstRetryAfterMs, read.retryAfterMs);
      sawAny = true;
    }
    if (sawAny) headroomReads++;
    if (sawAny) {
      headroomSamples.push({
        t: Date.now(),
        req: read.requestsRemaining !== null && read.requestsLimit
          ? Math.max(0, Math.min(100, (read.requestsRemaining / read.requestsLimit) * 100))
          : null,
        tok: read.tokensRemaining !== null && read.tokensLimit
          ? Math.max(0, Math.min(100, (read.tokensRemaining / read.tokensLimit) * 100))
          : null,
      });
      if (headroomSamples.length > HEADROOM_RING) headroomSamples.shift();
    }
    if (read.serverMs !== null) {
      serverMsTotal += read.serverMs;
      serverMsCalls++;
    }
    if (res.status === 429) {
      const prev = lastRefusal.get(ctx.provider);
      const waited = prev ? ctx.startedAt - prev.at : Infinity;
      if (prev && waited < prev.waitMs) retryNoBackoffCount++;
      lastRefusal.set(ctx.provider, {
        at: nowMs(),
        waitMs: read.retryAfterMs ?? 1000,
      });
    }
  } catch {
    /* never disturb the host */
  }
}

/** Read a refused reply's own code so a rate limit, a billing stop and a
 *  content refusal are told apart. Runs on OUR copy of a small error body. */
function classifyRefusal(ctx: AiCallCtx, res: Response): void {
  failCount++;
  if (res.status === 429) rateLimitedCount++;
  if (res.status === 402) quotaCount++;
  let copy: Response | null = null;
  try {
    copy = res.clone();
  } catch {
    copy = null;
  }
  if (!copy) return;
  void copy
    .text()
    .then((text) => {
      try {
        if (!text || text.length > MAX_ERROR_BODY_CHARS) return;
        const parsed: unknown = JSON.parse(text);
        const outcome = readAiOutcome(parsed);
        if (outcome.quota) quotaCount++;
        else if (outcome.rateLimited && res.status !== 429) rateLimitedCount++;
        if (outcome.filtered) filteredCount++;
      } catch {
        /* a refusal we cannot classify stays an ordinary failure */
      }
    })
    .catch(() => {
      /* never disturb the host */
    });
}

/** Fold one parsed reply's usage + ending into the call in flight. */
function noteBody(ctx: AiCallCtx, parsed: unknown): void {
  try {
    const usage = readAiUsage(parsed);
    if (usage.reported === 1) {
      ctx.usage = ctx.usage
        ? {
            reported: 1,
            tokensIn: Math.max(ctx.usage.tokensIn, usage.tokensIn),
            tokensOut: Math.max(ctx.usage.tokensOut, usage.tokensOut),
            cachedIn: Math.max(ctx.usage.cachedIn, usage.cachedIn),
            reportedCostMicros:
              usage.reportedCostMicros ?? ctx.usage.reportedCostMicros,
            priceCode: usage.priceCode || ctx.usage.priceCode,
          }
        : usage;
    }
    const outcome = readAiOutcome(parsed);
    if (outcome.truncated) truncatedCount++;
    if (outcome.filtered) filteredCount++;
    // The provider said how this answer ended. Some providers (Gemini/Vertex)
    // have no terminal event at all and say it only here, so a reply that
    // names its ending is a finished reply — and one already counted as cut
    // off by a token cap must not be counted a second time at EOF.
    if (outcome.ended) ctx.sawTerminator = true;
  } catch {
    /* never disturb the host */
  }
}

/**
 * Watch a streamed reply as the app itself reads it.
 *
 * Content deltas are never parsed: {@link streamLineIsInteresting} skips every
 * line that does not announce usage or an ending, so an answer's words are
 * split on newlines, tested for a handful of marker substrings, and dropped.
 */
function observeStream(ctx: AiCallCtx, res: Response): void {
  let wrapped: ReadableStream<Uint8Array> | null | undefined;
  const original = res.body;
  if (!original) {
    fileCall(ctx);
    return;
  }
  const build = (): ReadableStream<Uint8Array> | null => {
    if (wrapped !== undefined) return wrapped ?? null;
    try {
      const reader = original.getReader();
      const decoder = new TextDecoder();
      let carry = "";
      wrapped = new ReadableStream<Uint8Array>({
        async pull(controller) {
          let out: { done?: boolean; value?: Uint8Array };
          try {
            out = await reader.read();
          } catch (err) {
            // The stream broke part-way. Whatever the cause, this call did not
            // deliver its answer, so it is a failure — and an aborted read is
            // the shape a deadline takes on a stream, told apart from an
            // ordinary transport error the same way it is on a plain call.
            noteQuietSinceLastChunk(ctx);
            noteTransportFailure(err);
            fileCall(ctx);
            controller.error(err);
            return;
          }
          if (out.done) {
            // The quiet BEFORE the end counts. A gap is otherwise only noticed
            // when a next chunk arrives, so the commonest stall of all — an
            // answer that goes silent half-way and then just stops — would be
            // filed as a clean, if slow, stream. Folded here and on the error
            // path, where the source went quiet, and deliberately NOT on
            // cancel, where it was the app that stopped reading.
            noteQuietSinceLastChunk(ctx);
            try {
              controller.close();
            } finally {
              fileCall(ctx);
            }
            return;
          }
          try {
            const at = nowMs();
            if (ctx.firstChunkAt === 0) ctx.firstChunkAt = at;
            else ctx.worstGapMs = Math.max(ctx.worstGapMs, at - ctx.lastChunkAt);
            ctx.lastChunkAt = at;
            carry += decoder.decode(out.value, { stream: true });
            if (carry.length > MAX_STREAM_CARRY && !carry.includes("\n")) {
              // One line longer than any usage event can be — drop it rather
              // than hold an answer's text in memory waiting for a newline.
              carry = "";
            }
            let nl = carry.indexOf("\n");
            while (nl >= 0) {
              const line = carry.slice(0, nl);
              carry = carry.slice(nl + 1);
              if (streamLineIsTerminal(line)) ctx.sawTerminator = true;
              if (streamLineIsInteresting(line)) {
                const brace = line.indexOf("{");
                if (brace >= 0) {
                  try {
                    noteBody(ctx, JSON.parse(line.slice(brace)));
                  } catch {
                    /* not JSON — nothing to read */
                  }
                }
              }
              nl = carry.indexOf("\n");
            }
          } catch {
            /* observation only — the chunk below still reaches the app */
          }
          if (out.value !== undefined) controller.enqueue(out.value);
        },
        cancel(reason) {
          try {
            void reader.cancel(reason);
          } finally {
            fileCall(ctx);
          }
        },
      });
    } catch {
      wrapped = null;
    }
    return wrapped ?? null;
  };
  try {
    Object.defineProperty(res, "body", {
      configurable: true,
      get(): ReadableStream<Uint8Array> | null {
        return build() ?? original;
      },
    });
  } catch {
    // Could not shadow the body — file what is already known rather than leave
    // the call in flight forever.
    fileCall(ctx);
  }
}

/**
 * Watch a plain (non-streamed) reply, by shadowing the two readers an SDK
 * uses. Nothing is read on the app's behalf: if the app never reads the body,
 * the call is filed at header time with no usage, which is the truth.
 */
function observeBody(ctx: AiCallCtx, res: Response): void {
  let done = false;
  /** The app has CALLED a reader. Reading a body is real I/O, so the backstop
   *  below must not fire while one is in flight — filing early would close the
   *  call with no usage and then discard the token counts that arrive a
   *  moment later, which is how a perfectly ordinary `await res.json()` ends
   *  up reported as "this provider told us nothing". */
  let reading = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    fileCall(ctx);
  };
  const shadow = (name: "json" | "text"): void => {
    try {
      const original = (res as unknown as Record<string, unknown>)[name];
      if (typeof original !== "function") return;
      Object.defineProperty(res, name, {
        configurable: true,
        writable: true,
        value: async function (...args: unknown[]): Promise<unknown> {
          reading = true;
          let value: unknown;
          try {
            value = await (original as (...a: unknown[]) => Promise<unknown>).apply(
              res,
              args,
            );
          } catch (err) {
            finish();
            throw err;
          }
          try {
            if (name === "json") noteBody(ctx, value);
            else if (typeof value === "string" && value.length <= MAX_ERROR_BODY_CHARS) {
              noteBody(ctx, JSON.parse(value));
            }
          } catch {
            /* observation only */
          }
          finish();
          return value;
        },
      });
    } catch {
      /* leave the reader alone */
    }
  };
  shadow("json");
  shadow("text");
  // An app that reads neither still gets its call counted — at header time,
  // with no usage, which is exactly what was knowable. An app that HAS begun
  // reading is left alone: its own read files the call, on success or throw.
  queueMicrotask(() => {
    // Give the app a turn to start reading before assuming it never will.
    setTimeout(() => {
      if (!reading) finish();
    }, 0).unref?.();
  });
}

/* ── The wrapper ─────────────────────────────────────────────────────────── */

type FetchLike = (input: unknown, init?: unknown) => Promise<Response>;

let realFetch: FetchLike | null = null;
let installedFetch: FetchLike | null = null;
let armed = false;
let feedOn = false;

/**
 * Is this an AI provider, and if so which one? Reads only the host.
 *
 * "Provider" means the maintained list OR an endpoint this app declared as
 * its own — see `aiProviders.ts`. A declared endpoint classifies to one shared
 * code, so the hostname is compared here and never travels.
 */
function providerFor(input: unknown, init: unknown): number {
  const target = targetOf(input);
  // Same rule as the live wrapper: a relative target's host is a placeholder
  // this kit invented, never something the app declared.
  return target && target.absolute ? aiProviderCodeOrDeclared(target.host) : 0;
  // `init` is deliberately unread here: classification is a hostname question.
  void init;
}

/**
 * The host and path of a fetch target, or null when neither can be read.
 *
 * Read once per call and used twice: the host classifies the call, the path
 * decides — only when the host classified to nothing — whether the call had
 * the shape of an AI request. Neither value leaves the process.
 */
function targetOf(
  input: unknown,
): { host: string; path: string; absolute: boolean } | null {
  try {
    let href: string | null = null;
    if (typeof input === "string") href = input;
    else if (input && typeof input === "object") {
      const asUrl = input as { href?: unknown; url?: unknown };
      if (typeof asUrl.href === "string") href = asUrl.href;
      else if (typeof asUrl.url === "string") href = asUrl.url;
    }
    if (!href) return null;
    // A relative target names no destination: this runtime's own fetch
    // rejects it before a byte leaves. Absoluteness is decided by the SAME
    // parse the edge kit uses — a pattern of our own disagrees with it over
    // the inputs a URL parser forgives, such as leading whitespace, and the
    // two kits must answer identically or one app reports differently on two
    // runtimes. Only a relative target falls back to a placeholder host, and
    // the flag rides along so no caller treats that placeholder as a real
    // destination.
    let url: URL;
    let absolute = true;
    try {
      url = new URL(href);
    } catch {
      absolute = false;
      url = new URL(href, "http://localhost");
    }
    return { host: url.hostname, path: url.pathname, absolute };
  } catch {
    return null;
  }
}

/**
 * The method a fetch call will be sent with, as the runtime resolves it:
 * `init.method` wins, then a Request's own, then GET.
 *
 * Read only to decide whether an unclassified call was AI-SHAPED. Never
 * stored, never uploaded.
 */
function methodOf(input: unknown, init: unknown): string {
  try {
    const fromInit = (init as { method?: unknown } | undefined)?.method;
    if (typeof fromInit === "string" && fromInit) return fromInit.toUpperCase();
    const fromInput = (input as { method?: unknown } | null)?.method;
    if (typeof fromInput === "string" && fromInput) {
      return fromInput.toUpperCase();
    }
    return "GET";
  } catch {
    return "GET";
  }
}

/**
 * Tally an unclassified call whose path looked like an AI inference request.
 *
 * Count only — see {@link AI_SHAPED_PATHS}. Never throws: an app's outbound
 * call is worth nothing to disturb.
 */
function noteUnclassifiedAiShape(
  target: { host: string; path: string; absolute: boolean } | null,
  method: string,
): void {
  try {
    if (!target || !target.absolute) return;
    // The evidence is a POST to an inference shape. A GET or a HEAD on the
    // same path is a health check, a probe or a proxy warming itself, and
    // counting one would turn the note into a false alarm on an app with no
    // AI in it at all.
    if (method !== "POST") return;
    const path = target.path.toLowerCase().replace(/\/+$/, "");
    if (!path || !AI_SHAPED_PATHS.includes(path)) return;
    unclassifiedAiShaped++;
  } catch {
    /* never disturb the host */
  }
}

/**
 * Arm the observation. Lazy and idempotent: called from the request boundary
 * so importing the kit costs nothing until the app serves traffic, and never
 * armed under the kill-switch.
 */
export function armAiCalls(): void {
  if (armed || isBoosthisDisabled()) return;
  armed = true;
  feedOn = true;
  if (windowStartedAt === 0) windowStartedAt = nowMs();
  try {
    const current = (globalThis as { fetch?: unknown }).fetch;
    if (typeof current !== "function") return;
    realFetch = current as FetchLike;
    // Held by THIS wrapper, never read back from the module: a wrapper someone
    // else put on top of ours keeps calling ours after `unarmAiCalls` has let
    // go, and it must still reach the real fetch.
    const original = current as FetchLike;
    const wrapper: FetchLike = function (
      this: unknown,
      input: unknown,
      init?: unknown,
    ): Promise<Response> {
      const call = original;
      // Locked (docs/kit-lock-rule.md): straight through, nothing recorded —
      // the same as after the observation was taken off. A wrapper left behind
      // by an earlier arming (someone else's sat on top of it) also goes
      // straight through, so a re-armed kit never records one call twice.
      if (!feedOn || installedFetch !== wrapper || isKitLocked()) {
        return call.call(globalThis, input, init);
      }
      let provider = 0;
      let target: ReturnType<typeof targetOf> = null;
      try {
        target = targetOf(input);
        // Only a target that names its own destination is classified. A
        // relative URL carries a placeholder host, and an app that declared
        // that placeholder as its own model endpoint would otherwise have a
        // call this runtime never sends measured as a real AI call — while
        // the edge kit, which cannot read a relative URL at all, records
        // nothing for the same line of code.
        provider =
          target && target.absolute ? aiProviderCodeOrDeclared(target.host) : 0;
      } catch {
        provider = 0;
        target = null;
      }
      // Not a known provider: one classification, then straight through. The
      // app's call is untouched. The single thing recorded is whether its path
      // had the shape of an AI request — the one honest way to tell a
      // developer that AI traffic went somewhere this kit could not see.
      if (provider === 0) {
        noteUnclassifiedAiShape(target, methodOf(input, init));
        return call.call(globalThis, input, init);
      }
      return observedCall(call, provider, input, init);
    };
    installedFetch = wrapper;
    (globalThis as { fetch?: unknown }).fetch = wrapper;
  } catch {
    realFetch = null;
    installedFetch = null;
  }
}

async function observedCall(
  call: FetchLike,
  provider: number,
  input: unknown,
  init?: unknown,
): Promise<Response> {
  let ctx: AiCallCtx | null = null;
  try {
    const opts = (init ?? null) as { signal?: unknown; body?: unknown } | null;
    ctx = {
      provider,
      scope: currentRequestScope(),
      startedAt: nowMs(),
      headersAt: 0,
      firstChunkAt: 0,
      lastChunkAt: 0,
      worstGapMs: 0,
      promptId: promptIdentity(opts?.body),
      // A `Request` object always carries a signal of its own, so only the
      // options form can honestly answer "did this call have a time limit?".
      hadTimeLimit: !!opts && opts.signal != null,
      streamed: false,
      sawTerminator: false,
      usage: null,
      filed: false,
    };
  } catch {
    ctx = null;
  }
  if (!ctx) return call.call(globalThis, input, init);

  let res: Response;
  try {
    res = await call.call(globalThis, input, init);
  } catch (err) {
    try {
      noteTransportFailure(err);
      fileCall(ctx);
    } catch {
      /* never disturb the host */
    }
    throw err;
  }

  try {
    ctx.headersAt = nowMs();
    noteHeadroom(ctx, res);
    if (res.status >= 400) {
      classifyRefusal(ctx, res);
      fileCall(ctx);
      return res;
    }
    const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
    ctx.streamed = ctype.includes("event-stream") || ctype.includes("x-ndjson");
    if (ctx.streamed) observeStream(ctx, res);
    else observeBody(ctx, res);
  } catch {
    fileCall(ctx);
  }
  return res;
}

/** Remove the observation, restoring the host's own `fetch` when ours is still
 *  the one in place. A wrapper someone else installed on top of ours is left
 *  alone — putting back what we captured would silently delete their work. */
export function unarmAiCalls(): void {
  feedOn = false;
  try {
    const g = globalThis as { fetch?: unknown };
    if (realFetch && g.fetch === installedFetch) g.fetch = realFetch;
  } catch {
    /* best effort */
  }
  realFetch = null;
  installedFetch = null;
  armed = false;
}

/* ── Request fold ────────────────────────────────────────────────────────── */

/**
 * Close one request's AI tally, folding it into the session totals.
 *
 * Called from the middleware's guaranteed-exit path, beside the repeated-work
 * and database-work folds. A request that made no AI call is ignored entirely,
 * so a project that calls no provider never builds a denominator.
 */
export function endAiWork(
  scope: RequestWorkScope | null,
  requestMs: number,
): void {
  try {
    if (!scope) return;
    const tally = scope.ai;
    scope.ai = undefined;
    if (!tally || tally.calls === 0) return;
    const wall = Number.isFinite(requestMs) && requestMs > 0 ? requestMs : 0;
    watchedRequests++;
    watchedRequestMs += wall;
    // Concurrency can make the summed call time exceed the request's own wall
    // time; clamping keeps the share honest rather than past 100%.
    aiMs += wall > 0 ? Math.min(tally.ms, wall) : tally.ms;
    let worst = 0;
    for (const n of tally.prompts.values()) if (n > worst) worst = n;
    if (worst > promptRepeatWorst) promptRepeatWorst = worst;
    if (worst > 1) promptRepeatRequests++;
    if (tally.serialRun > serialWorst) serialWorst = tally.serialRun;
    if (tally.serialRun >= AI_SERIAL_THRESHOLD) serialRequests++;
  } catch {
    /* never disturb the host */
  }
}

/* ── Blind spots ─────────────────────────────────────────────────────────── */

let cachedUnwatched = -1;
let cachedUnwatchedAt = 0;

/**
 * How long one reading of the module cache may be reused.
 *
 * Short on purpose. The count has to be allowed to GROW: a client required
 * lazily inside the first handler that needs it enters the cache minutes after
 * boot, and a reading frozen at startup would go on publishing `0` — "nothing
 * loaded here can bypass me" — for the rest of the process's life. Re-reading
 * is a walk of the cache's keys, so it is bounded to once per window rather
 * than once per snapshot field.
 */
const UNWATCHED_RECHECK_MS = 10_000;

/**
 * HTTP clients this app loaded that could carry an AI call past this meter.
 *
 * Read from the CommonJS module cache — this kit never imports a client the
 * host did not choose. `0` when nothing unwatchable is loaded.
 */
export function unwatchedAiClientCount(): number {
  if (!armed) return 0;
  const now = Date.now();
  if (cachedUnwatched >= 0 && now - cachedUnwatchedAt < UNWATCHED_RECHECK_MS) {
    return cachedUnwatched;
  }
  let n = 0;
  try {
    const cache = (
      globalThis as { require?: { cache?: Record<string, unknown> } }
    ).require?.cache;
    const keys = cache
      ? Object.keys(cache)
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Object.keys(((globalThis as any).__boosthisModuleCache as object) ?? {});
    for (const name of UNWATCHABLE_HTTP_CLIENTS) {
      const needle = `/node_modules/${name}/`;
      if (keys.some((k) => k.includes(needle))) n++;
    }
  } catch {
    n = 0;
  }
  cachedUnwatched = n;
  cachedUnwatchedAt = Date.now();
  return n;
}

/* ── Readers ─────────────────────────────────────────────────────────────── */

function percentile(ring: readonly number[], p: number): number {
  if (ring.length === 0) return 0;
  const sorted = [...ring].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return Math.round(sorted[idx]!);
}

/** The label-free aggregate the scorers consume. Numbers only. */
export function getAiCallStats(): AiCallStatsLike {
  let topProvider = 0;
  let topCalls = 0;
  for (const [code, n] of callsByProvider) {
    if (n > topCalls) {
      topCalls = n;
      topProvider = code;
    }
  }
  return {
    watchedRequests,
    watchedRequestMs,
    aiMs,
    callCount,
    providerCount: providersSeen.size,
    topProvider,
    p75Ms: percentile(durations, 75),
    worstMs: durations.length ? Math.max(...durations) : 0,
    streamCount,
    ttftP75Ms: percentile(settledTtfts, 75),
    ttftSettledCount: settledTtfts.length,
    stallCount,
    failCount,
    rateLimitedCount,
    quotaCount,
    timeoutCount,
    truncatedCount,
    filteredCount,
    serverMsP75: serverMsCalls > 0 ? Math.round(serverMsTotal / serverMsCalls) : 0,
    serverMsCalls,
    unwatchedClients: unwatchedAiClientCount(),
    unclassifiedCalls: unclassifiedAiShaped,
    tokensIn,
    tokensOut,
    cachedIn,
    costMicros,
    reportedCostCalls,
    pricedCalls,
    unpricedCalls,
    worstRequestCostMicros,
    windowMs: windowStartedAt > 0 ? Math.max(0, nowMs() - windowStartedAt) : 0,
    usageMissingCalls,
    streamUsageMissingCalls,
    declaredCalls,
    declaredUnpricedCalls,
    declaredEndpoints: declaredAiEndpointCount(),
    promptRepeatWorst,
    promptRepeatRequests,
    serialWorst,
    serialRequests,
    noTimeLimitCalls,
    retryNoBackoffCount,
    headroomReads,
    ...settledHeadroom(),
    worstRequestsPct,
    worstTokensPct,
    worstRetryAfterMs,
  };
}

/** Reset everything and remove the observation. Test + kill-switch path. */
export function clearAiCalls(): void {
  unarmAiCalls();
  watchedRequests = 0;
  watchedRequestMs = 0;
  aiMs = 0;
  callCount = 0;
  streamCount = 0;
  stallCount = 0;
  failCount = 0;
  rateLimitedCount = 0;
  quotaCount = 0;
  timeoutCount = 0;
  truncatedCount = 0;
  filteredCount = 0;
  noTimeLimitCalls = 0;
  retryNoBackoffCount = 0;
  tokensIn = 0;
  tokensOut = 0;
  cachedIn = 0;
  costMicros = 0;
  reportedCostCalls = 0;
  pricedCalls = 0;
  unpricedCalls = 0;
  worstRequestCostMicros = 0;
  usageMissingCalls = 0;
  streamUsageMissingCalls = 0;
  declaredCalls = 0;
  declaredUnpricedCalls = 0;
  promptRepeatWorst = 0;
  promptRepeatRequests = 0;
  serialWorst = 0;
  serialRequests = 0;
  headroomReads = 0;
  headroomSamples.length = 0;
  settledTtfts.length = 0;
  ttftSeenProviders.clear();
  worstRequestsPct = null;
  worstTokensPct = null;
  worstRetryAfterMs = 0;
  serverMsTotal = 0;
  serverMsCalls = 0;
  unclassifiedAiShaped = 0;
  providersSeen.clear();
  callsByProvider.clear();
  lastRefusal.clear();
  durations.length = 0;
  ttfts.length = 0;
  windowStartedAt = 0;
  cachedUnwatched = -1;
  cachedUnwatchedAt = 0;
}

/* ── Findings: every problem names its fix ───────────────────────────────── */

/**
 * The problems this meter can name, each one anchored to a rule with a written
 * fix behind it.
 *
 * Shape rules, inherited from the existing cross-cutting detectors:
 *   • `name` is a FIXED literal, never a host, a route or a provider. The
 *     server sanitises it anyway; sending nothing that needs sanitising is the
 *     stronger promise.
 *   • `p95` carries the finding's own evidence number (a wait, a count, a
 *     share), NOT a fabricated latency.
 *   • Nothing is raised on zero evidence, and nothing is raised before the
 *     shared sample gate — one unlucky request must not name a fix.
 */
export function collectAiFindings(): CrossCuttingFinding[] {
  if (isBoosthisDisabled()) return [];
  const out: CrossCuttingFinding[] = [];
  try {
    if (callCount === 0) return out;
    if (noTimeLimitCalls > 0) {
      out.push({
        kind: "ai-no-timeout",
        name: "AI call",
        p95: worstRing(durations),
        count: noTimeLimitCalls,
        hint: "AI calls were made with no time limit, so one slow answer can hold a request open indefinitely.",
      });
    }
    if (retryNoBackoffCount > 0) {
      out.push({
        kind: "ai-retry-no-backoff",
        name: "AI call",
        p95: worstRetryAfterMs,
        count: retryNoBackoffCount,
        hint: "A refused AI call was retried sooner than the provider asked, which extends the refusal instead of clearing it.",
      });
    }
    if (serialRequests > 0 && serialWorst >= AI_SERIAL_THRESHOLD) {
      out.push({
        kind: "ai-serial-calls",
        name: "AI call",
        p95: serialWorst,
        count: serialRequests,
        hint: "Several AI calls ran one after another inside one request when they could have run together.",
      });
    }
    if (promptRepeatWorst > 1) {
      out.push({
        kind: "ai-duplicate-prompt",
        name: "AI call",
        p95: promptRepeatWorst,
        count: promptRepeatRequests,
        hint: "The same prompt was sent more than once inside one request, so the same tokens were paid for twice.",
      });
    }
    // A cold prompt cache is a FINDING and never a score: an app whose prompts
    // have no big shared prefix has nothing here to fix, and marking it poor
    // would be the meter misreading the product. Raised only where caching
    // would actually save something.
    // Averaged over the calls that ACTUALLY REPORTED input tokens, never over
    // every call. A refused call carries no prompt, so counting it in the
    // denominator shrinks the apparent prompt size and can hide the finding
    // from exactly the app that needs it — one that is being rate-limited AND
    // paying for an uncached prefix.
    const usageCalls = Math.max(0, callCount - usageMissingCalls);
    if (
      cachedIn === 0 &&
      tokensIn > 0 &&
      usageCalls >= 2 &&
      tokensIn / usageCalls >= AI_CACHEABLE_INPUT_TOKENS
    ) {
      out.push({
        kind: "ai-cache-cold",
        name: "AI call",
        p95: Math.round(tokensIn / usageCalls),
        count: usageCalls,
        hint: "Large prompts are being sent with the provider's prompt cache never hit, so the shared prefix is paid for in full every time.",
      });
    }
    if (streamUsageMissingCalls > 0) {
      out.push({
        kind: "ai-stream-usage-missing",
        name: "AI call",
        p95: streamCount,
        count: streamUsageMissingCalls,
        hint: "Streamed answers reported no usage because the call never asked for it, so their cost cannot be seen.",
      });
    }
  } catch {
    /* a finding is never worth disturbing the host for */
  }
  return out;
}

function worstRing(ring: readonly number[]): number {
  return ring.length ? Math.max(...ring) : 0;
}

/* ── Test seams ──────────────────────────────────────────────────────────── */

export const __aiCallsInternals = {
  promptIdentity,
  providerFor,
  fileCall,
  tallyFor,
  isArmed: () => armed,
  providerCount: () => AI_PROVIDERS.length,
  /** File one already-measured call without going through `fetch`. Used by the
   *  tests and by the Python-parity fixtures; never on a live path. */
  /** Fold one reply's published rate-limit headers, as a reply would (the
   *  start-up rule's pair tests). */
  noteHeadroomHeaders(provider: number, headers: Record<string, string>, status = 200): void {
    noteHeadroom(
      { provider, startedAt: nowMs() } as AiCallCtx,
      { status, headers: new Headers(headers) } as unknown as Response,
    );
  },
  fileSynthetic(ctx: Partial<AiCallCtx> & { provider: number }): void {
    fileCall({
      provider: ctx.provider,
      scope: ctx.scope ?? currentRequestScope(),
      startedAt: ctx.startedAt ?? nowMs(),
      headersAt: ctx.headersAt ?? 0,
      firstChunkAt: ctx.firstChunkAt ?? 0,
      lastChunkAt: ctx.lastChunkAt ?? 0,
      worstGapMs: ctx.worstGapMs ?? 0,
      promptId: ctx.promptId ?? 0,
      hadTimeLimit: ctx.hadTimeLimit ?? true,
      streamed: ctx.streamed ?? false,
      sawTerminator: ctx.sawTerminator ?? true,
      usage: ctx.usage ?? null,
      filed: false,
    });
  },
};
