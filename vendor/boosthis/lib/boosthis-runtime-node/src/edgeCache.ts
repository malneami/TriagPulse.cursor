/** Upstream cache verdict — what the services THIS APP CALLS said.
 *
 * Every major hosting platform and CDN states, in the reply itself, whether it
 * served that reply from its own cache or fetched it fresh. Nobody looks. This
 * module reads that one verdict off the replies the app's OWN outbound calls
 * receive (observed at the existing undici headers boundary — no new hook, no
 * new traffic) and keeps four counters.
 *
 * WHOSE VERDICT THIS IS — AND WHOSE IT IS NOT
 * -------------------------------------------
 * These verdicts belong to the app's DEPENDENCIES, never to the hosting this
 * project chose. A server never sees its own platform's verdict: the CDN
 * stamps that on the way out, after this process has already replied. So this
 * reading is emitted as `upstreamCache` and worded as the dependency's cache — a
 * project with no CDN of its own must never be shown a dependency's cache
 * performance under the words "your host". This project's own hosting verdict
 * is read by the browser kit, where the reply really is served by this site.
 *
 * WHAT IS READ, EXACTLY
 * ---------------------
 * A fixed, code-defined list of header NAMES (below). Nothing else is read —
 * no address, no path, no other header, no body. The header's value is matched
 * against a fixed table of the platform's own words ("HIT", "MISS", …) and
 * immediately discarded; only a counter moves. An unrecognised word counts as
 * nothing at all, so a platform we do not know cannot be turned into a
 * confident verdict.
 *
 * WHY THE COUNTERS ARE SPLIT THE WAY THEY ARE
 * -------------------------------------------
 * A reply the platform deliberately refuses to cache (`BYPASS`, `DYNAMIC`) is
 * not waste — a personalised page SHOULD be served fresh. So bypasses are
 * counted and shown but kept OUT of the share: the share is "of the replies
 * the platform treated as cacheable, how many did it actually serve from
 * cache". A miss there is a reply fetched fresh that need not have been, which
 * is exactly the money story.
 *
 * ABSTENTION
 * ----------
 * No verdict header, an unknown platform, a plain origin with no CDN in front
 * of it — all produce nothing. The reading is absent (never a zero) until
 * enough cacheable replies have actually declared themselves.
 *
 * Twin of `lib/boosthis-runtime-web/src/edgeCache.ts`: same verdict
 * vocabulary, same thresholds, same emitted field shape. Duplicated rather
 * than shared because each kit ships with zero runtime dependencies.
 */

import { isSettling } from "./settleRule";

/** What the platform said about one reply, in our own closed vocabulary. */
export type EdgeVerdict = "hit" | "miss" | "stale" | "bypass";

/** Header names we read, in priority order. Code-defined and closed. */
export const EDGE_CACHE_HEADERS = [
  "x-vercel-cache",
  "cf-cache-status",
  "x-nextjs-cache",
  "cache-status",
  "x-cache",
] as const;

/** Longest header value we will even look at. A verdict is one short word; a
 *  longer value is some other header we have no business parsing. */
const MAX_VERDICT_LEN = 120;

const VERCEL: Readonly<Record<string, EdgeVerdict>> = {
  HIT: "hit",
  PRERENDER: "hit",
  STALE: "stale",
  REVALIDATED: "stale",
  MISS: "miss",
  BYPASS: "bypass",
};

const CLOUDFLARE: Readonly<Record<string, EdgeVerdict>> = {
  HIT: "hit",
  MISS: "miss",
  EXPIRED: "stale",
  STALE: "stale",
  UPDATING: "stale",
  REVALIDATED: "stale",
  BYPASS: "bypass",
  DYNAMIC: "bypass",
  IGNORED: "bypass",
};

const NEXTJS: Readonly<Record<string, EdgeVerdict>> = {
  HIT: "hit",
  MISS: "miss",
  STALE: "stale",
};

const XCACHE_FIRST_WORD: Readonly<Record<string, EdgeVerdict>> = {
  HIT: "hit",
  MISS: "miss",
  REFRESHHIT: "stale",
  ERROR: "bypass",
};

/** RFC 9211 `Cache-Status`: `"Netlify Edge"; hit` or
 *  `"Netlify Edge"; fwd=miss; stored`. Only the member closest to the user —
 *  the first — is read. */
function fromCacheStatus(raw: string): EdgeVerdict | null {
  const first = raw.split(",")[0];
  if (first === undefined) return null;
  const params = first.split(";").slice(1);
  let sawFwd = false;
  let fwdReason = "";
  for (const p of params) {
    const key = p.trim().toLowerCase();
    if (key === "hit") return "hit";
    if (key.startsWith("fwd=")) {
      sawFwd = true;
      fwdReason = key.slice(4).trim();
    }
  }
  if (!sawFwd) return null;
  if (fwdReason === "stale" || fwdReason === "request") return "stale";
  if (fwdReason === "bypass" || fwdReason === "method") return "bypass";
  if (fwdReason === "uri-miss" || fwdReason === "vary-miss" || fwdReason === "miss") {
    return "miss";
  }
  return null;
}

/** Read one reply's verdict. `read` returns a header's value or null; it is
 *  called only with the fixed names above. Returns null whenever the platform
 *  said nothing we recognise — never a guess. */
export function classifyCacheVerdict(
  read: (name: string) => string | null | undefined,
): EdgeVerdict | null {
  for (const name of EDGE_CACHE_HEADERS) {
    let raw: string | null | undefined;
    try {
      raw = read(name);
    } catch {
      continue;
    }
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_VERDICT_LEN) continue;
    if (name === "cache-status") {
      const v = fromCacheStatus(trimmed);
      if (v !== null) return v;
      continue;
    }
    if (name === "x-cache") {
      const word = trimmed.split(/[\s,]+/)[0];
      const v = word ? XCACHE_FIRST_WORD[word.toUpperCase()] : undefined;
      if (v !== undefined) return v;
      continue;
    }
    const upper = trimmed.toUpperCase();
    const table =
      name === "x-vercel-cache"
        ? VERCEL
        : name === "cf-cache-status"
          ? CLOUDFLARE
          : NEXTJS;
    const v = table[upper];
    if (v !== undefined) return v;
  }
  return null;
}

/** Pull ONLY the verdict headers out of undici's raw header list (a flat array
 *  of `name, value, name, value…` buffers) or a plain header object. One pass,
 *  and nothing outside the closed name list is even converted to a string. */
function readVerdictHeaders(headers: unknown): Map<string, string> {
  const found = new Map<string, string>();
  const wanted = new Set<string>(EDGE_CACHE_HEADERS);
  try {
    if (Array.isArray(headers)) {
      for (let i = 0; i + 1 < headers.length; i += 2) {
        const rawName = headers[i];
        const name = String(
          typeof rawName === "string" ? rawName : (rawName?.toString?.() ?? ""),
        ).toLowerCase();
        if (!wanted.has(name) || found.has(name)) continue;
        const rawValue = headers[i + 1];
        const value =
          typeof rawValue === "string"
            ? rawValue
            : (rawValue?.toString?.() ?? "");
        if (value.length > 0 && value.length <= MAX_VERDICT_LEN) {
          found.set(name, value);
        }
      }
      return found;
    }
    if (headers && typeof headers === "object") {
      const obj = headers as Record<string, unknown>;
      for (const name of wanted) {
        const raw = obj[name] ?? obj[name.toUpperCase()];
        const value = Array.isArray(raw) ? raw[0] : raw;
        if (typeof value === "string" && value.length > 0 && value.length <= MAX_VERDICT_LEN) {
          found.set(name, value);
        }
      }
    }
  } catch {
    /* an unreadable header list is simply no verdict */
  }
  return found;
}

/* ── Counters ─────────────────────────────────────────────────────────────*/

let hits = 0;
let misses = 0;
let staleServed = 0;
let bypassed = 0;

/** Stop the counters growing without bound in a long-lived server. */
const MAX_COUNTED = 1_000_000;

/** File one reply's verdict from a header source. Safe to call for every
 *  reply: one with no verdict header files nothing at all. */
export function noteEdgeCacheReply(
  read: (name: string) => string | null | undefined,
): void {
  try {
    if (hits + misses + staleServed + bypassed >= MAX_COUNTED) return;
    const verdict = classifyCacheVerdict(read);
    if (verdict === null) return;
    // The start-up rule (startupEvent): every first request misses, so the
    // counters start at the first verdict after the process settled; the
    // verdicts before it are counted apart and never graded.
    if (isSettling("startupEvent")) {
      settlingVerdicts++;
      return;
    }
    if (verdict === "hit") hits++;
    else if (verdict === "miss") misses++;
    else if (verdict === "stale") staleServed++;
    else bypassed++;
  } catch {
    /* observing must never disturb the host */
  }
}

/** File one reply's verdict straight from undici's raw header list. */
export function noteEdgeCacheHeaders(headers: unknown): void {
  try {
    const found = readVerdictHeaders(headers);
    if (found.size === 0) return;
    noteEdgeCacheReply((name) => found.get(name) ?? null);
  } catch {
    /* observing must never disturb the host */
  }
}

export interface EdgeCacheStats {
  /** Replies that declared a verdict at all. */
  checked: number;
  /** Served from the platform's cache. */
  hits: number;
  /** The platform could have cached it and did not. */
  misses: number;
  /** Served from cache while being refreshed behind the scenes. */
  stale: number;
  /** The platform deliberately does not cache this — counted, never scored. */
  bypass: number;
  /** Of the replies the platform treated as cacheable, the share it served
   *  from cache (hits + stale). Bypasses are excluded from both sides. */
  hitPct: number;
}

/** Cacheable replies needed before the share means anything. */
const EDGE_CACHE_MIN = 20;

let settlingVerdicts = 0;

/** Verdicts declared before the process settled: counted apart, never graded. */
export function edgeCacheSettlingVerdicts(): number {
  return settlingVerdicts;
}

/** The platform's verdict so far, or null when too few cacheable replies have
 *  declared themselves — an honest "we cannot tell", never a zero. */
export function getEdgeCacheStats(): EdgeCacheStats | null {
  const cacheable = hits + misses + staleServed;
  if (cacheable < EDGE_CACHE_MIN) return null;
  return {
    checked: cacheable + bypassed,
    hits,
    misses,
    stale: staleServed,
    bypass: bypassed,
    hitPct: Math.round(((hits + staleServed) / cacheable) * 100),
  };
}

/** Wipe every counter. Wired into the kit's forget path. */
export function clearEdgeCache(): void {
  settlingVerdicts = 0;
  hits = 0;
  misses = 0;
  staleServed = 0;
  bypassed = 0;
}

/** @internal test hook — file a verdict directly, without a reply. Goes
 *  through the real classifier so a test can never record a verdict the
 *  header vocabulary would not actually produce. */
export function _noteEdgeVerdictForTests(verdict: EdgeVerdict): void {
  noteEdgeCacheReply((name) =>
    name === "x-vercel-cache"
      ? verdict === "hit"
        ? "HIT"
        : verdict === "miss"
          ? "MISS"
          : verdict === "stale"
            ? "STALE"
            : "BYPASS"
      : null,
  );
}
