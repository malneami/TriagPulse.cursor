/** What this app's OWN replies tell the world about caching.
 *
 * The other half of the repeat-fetch story. `edgeCache.ts` reads what a
 * platform said about replies this app RECEIVED; this module watches the cache
 * instructions this app SENDS, at the finished-response boundary the
 * middleware already has, and names the fix when a whole app is telling every
 * browser and every CDN to fetch everything again, every time.
 *
 * WHAT IS READ
 * ------------
 * Three of this app's own response headers — `Cache-Control`, `ETag`,
 * `Last-Modified` — on finished GET 200 replies only. `Cache-Control` is
 * matched against fixed directive words; `ETag` and `Last-Modified` are read
 * for PRESENCE only, never for their value. Nothing else is read: no address,
 * no path, no route, no body, no other header. Four counters move; every
 * string is discarded on the same stack.
 *
 * WHY THE BUCKETS ARE MUTUALLY EXCLUSIVE
 * --------------------------------------
 * A reply falls into exactly one bucket, so one badly-configured app produces
 * ONE finding naming ONE fix, not three overlapping ones saying the same thing.
 *
 * WHY THE BAR IS HIGH
 * -------------------
 * A finding fires only when a bucket dominates a real sample of replies. A
 * genuinely private app — a dashboard where every reply is personal — SHOULD
 * be sending `no-store`, and must not be nagged for it on the strength of a
 * handful of requests. Hence a minimum sample and a large majority before
 * anything is said at all.
 */

import type { CrossCuttingFinding } from "./candidateRules";

/** Finished GET 200 replies watched. */
let watched = 0;
/** …with no `Cache-Control` header at all. */
let noDirective = 0;
/** …explicitly marked never-cache. */
let neverStore = 0;
/** …cacheable, but with no `ETag`/`Last-Modified` to revalidate against. */
let noRevalidator = 0;

/** Replies needed before any finding may be raised. */
const MIN_WATCHED = 20;
/** Share of watched replies a bucket must reach to be worth naming. */
const DOMINANT_SHARE = 0.6;
/** Stop counting once the picture is settled. */
const MAX_WATCHED = 1_000_000;

function headerText(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const first = v[0];
    return typeof first === "string" ? first : "";
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function isPresent(v: unknown): boolean {
  return headerText(v).trim().length > 0;
}

export interface ResponseCacheHeaders {
  method?: unknown;
  statusCode?: unknown;
  cacheControl?: unknown;
  etag?: unknown;
  lastModified?: unknown;
}

/** File one finished reply. Only a GET that answered 200 is counted: a POST is
 *  not cacheable, and an error page is not the app's caching story. */
export function noteResponseCacheHeaders(input: ResponseCacheHeaders): void {
  try {
    if (watched >= MAX_WATCHED) return;
    const method = String(input.method ?? "").toUpperCase();
    if (method !== "GET") return;
    if (input.statusCode !== 200) return;
    watched++;
    const cc = headerText(input.cacheControl).toLowerCase();
    if (cc.trim().length === 0) {
      noDirective++;
      return;
    }
    if (cc.includes("no-store")) {
      neverStore++;
      return;
    }
    // `no-cache` still allows storing — it just forces revalidation, which is
    // exactly what an ETag makes cheap. So it belongs in the revalidator
    // bucket, not the never-cache one.
    if (!isPresent(input.etag) && !isPresent(input.lastModified)) {
      noRevalidator++;
    }
  } catch {
    /* observing must never disturb the host */
  }
}

export interface CacheDirectiveStats {
  watched: number;
  noDirective: number;
  neverStore: number;
  noRevalidator: number;
}

/** Raw counters (test + diagnostics). */
export function getCacheDirectiveStats(): CacheDirectiveStats {
  return { watched, noDirective, neverStore, noRevalidator };
}

/** Name the fix where one pattern dominates this app's own replies. Each
 *  finding is anchored to a rule in the rule book by the server's finding
 *  catalogue; the hint here is the plain-English half. */
export function collectCacheDirectiveFindings(): CrossCuttingFinding[] {
  const out: CrossCuttingFinding[] = [];
  if (watched < MIN_WATCHED) return out;
  const bar = watched * DOMINANT_SHARE;
  if (noDirective >= bar) {
    out.push({
      kind: "cache-headers-missing",
      name: "responses",
      p95: 0,
      count: noDirective,
      hint: "Most successful GET responses carry no Cache-Control at all, so every browser and CDN fetches them again every time.",
    });
  }
  if (neverStore >= bar) {
    out.push({
      kind: "cache-never-store",
      name: "responses",
      p95: 0,
      count: neverStore,
      hint: "Most successful GET responses are marked no-store, which forbids every cache from reusing them — correct for private data, waste for anything else.",
    });
  }
  if (noRevalidator >= bar) {
    out.push({
      kind: "cache-no-revalidator",
      name: "responses",
      p95: 0,
      count: noRevalidator,
      hint: "Most cacheable GET responses carry no ETag or Last-Modified, so an unchanged resource cannot answer 304 and is re-sent in full.",
    });
  }
  return out;
}

/** Wipe every counter. Wired into the kit's forget path. */
export function clearCacheDirectives(): void {
  watched = 0;
  noDirective = 0;
  neverStore = 0;
  noRevalidator = 0;
}
