/** Community rule book client (dev-only, runs Node-side under the MCP server).
 *
 * Reads a privacy-safe AGGREGATE of fixes proven across ALL projects from the
 * public `GET /rules/community` endpoint and caches it on disk so the matcher
 * can recommend real-world-proven fixes without a network round-trip on the hot
 * path. This is the read side of Boosthis's global self-learning loop.
 *
 * It is strictly read-only and fail-open: it only GETs the public aggregate
 * (rule ids + buckets + counts — no code, no route names, no values, no
 * installId), and ANY error (offline, missing cache, bad JSON, rate limited)
 * silently yields an empty book so the matcher falls back to its static
 * ranking. Nothing here ever transmits OUT.
 */

import { mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { answerRefusal, readAnswerJson, readAnswerText } from "./answerRead";
import { isKitLocked } from "./killSwitch";

export interface CommunityEntry {
  projects: number;
  evidence: number;
  circumstances: string[];
}

interface CommunityRuleRow {
  ruleId?: string;
  severityBucket?: string | null;
  countBucket?: string | null;
  projects?: number;
  evidence?: number;
}

const TTL_MS = 6 * 60 * 60 * 1000;
let refreshing = false;

/** Ceilings on the two answers this module reads, enforced while reading. */
const FIX_ANSWER_MAX_BYTES = 100_000;
const BOOK_ANSWER_MAX_BYTES = 1_000_000;

function env(): Record<string, string | undefined> {
  return process.env;
}

export function endpointBase(): string {
  const e = env();
  // `||` (not `??`) so a blank var never shadows the fallback. Live default
  // points at the maintainer's server; override with BOOSTHIS_ENDPOINT.
  const raw =
    e.BOOSTHIS_ENDPOINT ||
    e.BOOSTEN_ENDPOINT ||
    "https://www.boosthis.com/api";
  return raw.replace(/\/+$/, "");
}

function cacheFile(runtime: string): string {
  return join(homedir(), ".boosthis", `community.${runtime}.json`);
}

function describe(sev?: string | null, ct?: string | null): string {
  const s = sev ? `${sev} severity` : "any severity";
  const c = ct ? `${ct} occurrences` : "any volume";
  return `${s} · ${c}`;
}

/** Synchronously read the cached community book, rolled up per ruleId. Returns
 *  an empty map on any failure (the matcher then uses static ranking only). */
export function readCommunityCache(runtime: string): Map<string, CommunityEntry> {
  const out = new Map<string, CommunityEntry>();
  try {
    const data = JSON.parse(readFileSync(cacheFile(runtime), "utf8")) as {
      rules?: CommunityRuleRow[];
    };
    for (const r of data.rules ?? []) {
      if (!r || typeof r.ruleId !== "string") continue;
      const cur = out.get(r.ruleId) ?? {
        projects: 0,
        evidence: 0,
        circumstances: [],
      };
      // projects is a distinct-project count PER circumstance row, so the
      // strongest single circumstance is the honest per-rule confidence;
      // evidence accumulates across circumstances.
      cur.projects = Math.max(cur.projects, r.projects ?? 0);
      cur.evidence += r.evidence ?? 0;
      const desc = describe(r.severityBucket, r.countBucket);
      if (!cur.circumstances.includes(desc)) cur.circumstances.push(desc);
      out.set(r.ruleId, cur);
    }
  } catch {
    // fail open
  }
  return out;
}

/** Kick off a best-effort cache refresh if the cache is missing or stale.
 *  Fire-and-forget: never awaited, never throws. Skipped under test so unit
 *  tests stay hermetic and never touch the network. */
export function refreshCommunityCacheIfStale(runtime: string): void {
  const e = env();
  if (e.VITEST || e.NODE_ENV === "test" || e.BOOSTHIS_DISABLED) return;
  // LOCKED: no matching, so nothing to fetch it for (docs/kit-lock-rule.md).
  if (isKitLocked()) return;
  if (refreshing) return;
  try {
    const st = statSync(cacheFile(runtime));
    if (Date.now() - st.mtimeMs < TTL_MS) return;
  } catch {
    // missing → refresh below
  }
  refreshing = true;
  void fetchAndWrite(runtime).finally(() => {
    refreshing = false;
  });
}

/** Throw away what Boosthis handed over: the cached community book on this
 *  machine. Called when an answer locks the kit (docs/kit-lock-rule.md); after
 *  an `active` answer the next stale-check fetches it again. Never throws. */
export function clearCommunityCache(runtime: string): void {
  try {
    unlinkSync(cacheFile(runtime));
  } catch {
    /* nothing cached, or not ours to remove — either way nothing is read */
  }
}

/** The single invite key this MCP server may present to the fix endpoint. The
 *  developer sets it once in the MCP server's environment (the same invite key
 *  they registered telemetry with). `||` (not `??`) so a blank var falls
 *  through. The invite key — not a per-install token — is the uniform
 *  credential so the same flow works for RN, Node, and Python. */
export function inviteKey(): string | undefined {
  const e = env();
  return e.BOOSTHIS_INVITE_KEY || e.BOOSTEN_INVITE_KEY || undefined;
}

/** Result of fetching ONE rule's prescriptive fix from the server. The fix
 *  text is deliberately NOT bundled in this package, so it is fetched per-rule
 *  and fails GRACEFULLY: detection (when_to_apply) always works offline; only
 *  the written fix needs an invited app + a connection. */
export interface RuleFixResult {
  fix_available: boolean;
  fix_template?: string;
  fix_note?: string;
  community_proven?: boolean;
  community_projects?: number;
  community_evidence?: number;
  /** Covered same-concept siblings of this rule in OTHER languages, served by
   *  the server from its coverage map. Only rules that actually exist are
   *  ever listed (never gaps or "can't happen here" notes). */
  counterparts?: { runtime: string; rule_id: string; concept: string }[];
}

/** Validate the server's counterparts list into the closed snake_case wire
 *  shape. Untrusted input: anything malformed is dropped, strings are capped,
 *  and at most 5 entries survive (one per other language). */
function sanitizeCounterparts(
  raw: unknown,
): { runtime: string; rule_id: string; concept: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { runtime: string; rule_id: string; concept: string }[] = [];
  for (const item of raw) {
    if (out.length >= 5) break;
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    if (
      typeof c["runtime"] === "string" &&
      typeof c["ruleId"] === "string" &&
      typeof c["concept"] === "string"
    ) {
      out.push({
        runtime: c["runtime"].slice(0, 10),
        rule_id: c["ruleId"].slice(0, 100),
        concept: c["concept"].slice(0, 200),
      });
    }
  }
  return out;
}

const NO_KEY_NOTE =
  "Fix guidance is served per-rule from the Boosthis server and requires a " +
  "registered (invited) app. Set BOOSTHIS_INVITE_KEY in this MCP server's " +
  "environment to receive the fix. Detection (when_to_apply) works fully " +
  "offline without it.";

/** Fetch a single rule's fix from `GET /rules/fix` (invite-key bearer auth).
 *  Never throws — on any failure it returns `fix_available: false` with a note
 *  the agent can act on. The corpus is never fetched in bulk. */
export async function fetchRuleFix(
  ruleId: string,
  runtime: "node" | "rn" | "js" | "py",
): Promise<RuleFixResult> {
  const key = inviteKey();
  if (!key) return { fix_available: false, fix_note: NO_KEY_NOTE };
  try {
    const url = `${endpointBase()}/rules/fix?ruleId=${encodeURIComponent(
      ruleId,
    )}&runtime=${encodeURIComponent(runtime)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${key}` },
        signal: controller.signal,
      });
      if (res.status === 403) {
        return {
          fix_available: false,
          fix_note:
            "The Boosthis server rejected this project key (403). Check " +
            "BOOSTHIS_INVITE_KEY.",
        };
      }
      if (res.status === 404) {
        return {
          fix_available: false,
          fix_note: `The server has no fix for rule '${ruleId}'.`,
        };
      }
      if (res.status === 429) {
        return {
          fix_available: false,
          fix_note: "Fix endpoint is rate limited right now; retry shortly.",
        };
      }
      if (!res.ok) {
        return {
          fix_available: false,
          fix_note: `The Boosthis server returned ${res.status}; retry shortly.`,
        };
      }
      // Bounded while reading. A refused answer says which way it failed, in
      // the kit's own words; it is never "could not reach", because the
      // server was reached.
      let data: {
        fixTemplate?: string;
        community?: { projects?: number; evidence?: number } | null;
        counterparts?: unknown;
      } | null;
      try {
        data = (await readAnswerJson(res, {
          maxBytes: FIX_ANSWER_MAX_BYTES,
          timeoutMs: 5000,
        })) as typeof data;
      } catch (err) {
        const refusal = answerRefusal(err);
        if (refusal === "too-large") {
          return { fix_available: false, fix_note: "Unexpected oversized fix response." };
        }
        if (refusal === "too-slow") {
          return {
            fix_available: false,
            fix_note: "The fix response did not finish arriving in time; retry shortly.",
          };
        }
        if (refusal === "malformed") {
          return { fix_available: false, fix_note: "Malformed fix response." };
        }
        throw err;
      }
      if (!data || typeof data.fixTemplate !== "string") {
        return { fix_available: false, fix_note: "Malformed fix response." };
      }
      const out: RuleFixResult = {
        fix_available: true,
        fix_template: data.fixTemplate,
      };
      if (
        data.community &&
        typeof data.community.projects === "number" &&
        data.community.projects > 0
      ) {
        out.community_proven = true;
        out.community_projects = data.community.projects;
        out.community_evidence =
          typeof data.community.evidence === "number" ? data.community.evidence : 0;
      }
      const counterparts = sanitizeCounterparts(data.counterparts);
      if (counterparts.length > 0) out.counterparts = counterparts;
      return out;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return {
      fix_available: false,
      fix_note:
        "Could not reach the Boosthis server (offline?). Detection still " +
        "works offline; fetch the fix when back online.",
    };
  }
}

async function fetchAndWrite(runtime: string): Promise<void> {
  try {
    const url = `${endpointBase()}/rules/community?runtime=${encodeURIComponent(runtime)}`;
    // The community book is now invite-gated (registered apps only). Present the
    // same invite key used for fix fetches when one is configured; without it the
    // server returns 403 and we keep the last good disk cache (fail-open).
    const key = inviteKey();
    const headers: Record<string, string> = { accept: "application/json" };
    if (key) headers.authorization = `Bearer ${key}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let body: string;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      if (!res.ok) return;
      // Bounded while reading: an oversized or slow book is refused before it
      // is held, and the last good disk cache stays.
      body = await readAnswerText(res, {
        maxBytes: BOOK_ANSWER_MAX_BYTES,
        timeoutMs: 5000,
      });
    } finally {
      clearTimeout(timer);
    }
    JSON.parse(body); // validate before persisting
    // A lock that landed while the book was on its way: keep nothing of it.
    if (isKitLocked()) return;
    mkdirSync(join(homedir(), ".boosthis"), { recursive: true });
    writeFileSync(cacheFile(runtime), body, "utf8");
  } catch {
    // offline / abort / bad JSON → keep last good cache
  }
}
