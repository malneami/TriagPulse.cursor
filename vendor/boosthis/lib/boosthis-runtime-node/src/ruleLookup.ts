/** A rule this kit release does not carry, asked of Boosthis.
 *
 * The built-in book is frozen at release, but a person keeps approving rules
 * after it. Boosthis's fix address already serves an approved rule by id, so
 * an id this release does not know is ASKED for instead of refused. Three
 * answers, never two:
 *
 *   - found      the title, when-to-apply line and fix exactly as Boosthis
 *                sent them, labelled as not built into this kit release (with
 *                the approval date only when Boosthis sent one);
 *   - absent     today's unknown-rule refusal, now saying Boosthis was asked;
 *   - unchecked  no key, refused, rate limited, unreachable or unreadable. It
 *                says the rule may still exist, so it never reads as absent.
 *
 * The rule list adds the approved rules for this language the same way, with
 * a short bounded wait so a slow Boosthis never holds the list up.
 *
 * Nothing here is stored: the fix text is returned to the caller and dropped.
 * Wording, wire and reason codes are the same in every kit:
 * lib/kit-rule-lookup-contract.json, held by
 * scripts/src/__tests__/kit-rule-lookup-parity.test.ts.
 */

import { answerRefusal, readAnswerJson } from "./answerRead";
import { endpointBase, inviteKey } from "./community";

export const FOUND_DATED_LEAD = "Approved by a person on ";
export const FOUND_DATED_TAIL = ", not built into this kit release.";
export const FOUND_UNDATED =
  "Served by Boosthis, not built into this kit release. Boosthis sent no approval date with it.";
export const ABSENT_LEAD = "unknown rule id: ";
export const ABSENT_TAIL =
  " (not built into this kit release, and Boosthis has no live rule with this id for this language)";
export const UNCHECKED_NOTE =
  "Not built into this kit release, and Boosthis could not be asked about it, so this rule may still exist: a person may have approved it since this release. lookup_reason says why Boosthis could not be asked.";
export const LIST_LISTED_NOTE =
  "Built-in rules of this kit release first, then the rules a person approved since, as Boosthis listed them just now. Each of those carries built_in false and its own note.";
export const LIST_UNCHECKED_NOTE =
  "Built-in rules of this kit release only. Rules a person approved since this release may be missing, because Boosthis could not be asked for them. approved_rules_reason says why.";
export const LIST_NOT_ASKED_NOTE =
  "Built-in rules of this kit release only. Rules a person approved since this release carry no category, so a category filter never lists them. Ask without one to see them.";

export const FIX_PATH = "/rules/fix";
export const APPROVED_LIST_PATH = "/rules/approved";

/** Why Boosthis could not be asked. A closed list, the same in every kit. */
export type LookupReason =
  | "no-key"
  | "refused"
  | "rate-limited"
  | "unreachable"
  | "unreadable";

const FIX_TIMEOUT_MS = 5000;
const LIST_TIMEOUT_MS = 1500;
const FIX_MAX_BYTES = 100_000;
const LIST_MAX_BYTES = 512_000;
const LIST_MAX_RULES = 200;
const RULE_ID_MAX = 64;

export interface FoundRule {
  id: string;
  title: string | null;
  when_to_apply: string | null;
  fix_available: true;
  fix_template: string;
  built_in: false;
  approved_on: string | null;
  lookup: "found";
  note: string;
}

export interface UncheckedRule {
  id: string;
  built_in: false;
  fix_available: false;
  lookup: "unchecked";
  lookup_reason: LookupReason;
  note: string;
}

export interface ApprovedListEntry {
  id: string;
  title: string | null;
  when_to_apply: string | null;
  built_in: false;
  approved_on: string | null;
  note: string;
}

export interface RuleListAnswer<T> {
  count: number;
  rules: Array<T | ApprovedListEntry>;
  approved_rules: "listed" | "unchecked" | "not-asked";
  approved_rules_reason?: LookupReason;
  note: string;
}

/** The shape every id in the rule book has: lowercase letters and digits in
 *  runs joined by single hyphens, at most 64 characters. An id outside it
 *  cannot be one Boosthis serves, so it is answered without a request. */
export function isRuleIdShape(id: string): boolean {
  if (id.length === 0 || id.length > RULE_ID_MAX) return false;
  if (id.startsWith("-") || id.endsWith("-") || id.includes("--")) return false;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    const lower = c >= 97 && c <= 122;
    const digit = c >= 48 && c <= 57;
    if (!lower && !digit && c !== 45) return false;
  }
  return true;
}

/** The calendar day an approval carries, only when it is written YYYY-MM-DD. */
export function approvalDate(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 10) return null;
  for (let i = 0; i < 10; i++) {
    const c = value.charCodeAt(i);
    if (i === 4 || i === 7) {
      if (c !== 45) return null;
    } else if (c < 48 || c > 57) {
      return null;
    }
  }
  return value.slice(0, 10);
}

/** The label a rule from Boosthis carries. A date is shown only when sent. */
export function approvalNote(date: string | null): string {
  return date === null ? FOUND_UNDATED : FOUND_DATED_LEAD + date + FOUND_DATED_TAIL;
}

/** The refusal for an id Boosthis was asked about and does not hold. */
export function absentMessage(id: string): string {
  return ABSENT_LEAD + id + ABSENT_TAIL;
}

function statusReason(status: number): LookupReason {
  if (status === 401 || status === 403) return "refused";
  if (status === 429) return "rate-limited";
  return "unreadable";
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Asked =
  | { kind: "body"; body: unknown }
  | { kind: "status"; status: number }
  | { kind: "failed"; reason: LookupReason };

/** One bounded GET with the project key. Never throws. */
async function ask(
  url: string,
  key: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<Asked> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${key}` },
        signal: controller.signal,
      });
    } catch {
      return { kind: "failed", reason: "unreachable" };
    }
    if (res.status !== 200) return { kind: "status", status: res.status };
    try {
      const left = Math.max(1, timeoutMs - (Date.now() - started));
      return { kind: "body", body: await readAnswerJson(res, { maxBytes, timeoutMs: left }) };
    } catch (err) {
      // Over the ceiling or not JSON is "unreadable". The time limit, whichever
      // clock noticed it first, and a connection lost partway through the
      // answer are "unreachable": Boosthis's answer never reached the kit.
      const refusal = answerRefusal(err);
      return {
        kind: "failed",
        reason: refusal === "too-large" || refusal === "malformed" ? "unreadable" : "unreachable",
      };
    }
  } finally {
    clearTimeout(timer);
  }
}

function unchecked(id: string, reason: LookupReason): UncheckedRule {
  return {
    id,
    built_in: false,
    fix_available: false,
    lookup: "unchecked",
    lookup_reason: reason,
    note: UNCHECKED_NOTE,
  };
}

/**
 * get_rule for an id this kit release does not carry. Resolves to the found
 * or unchecked answer; throws an Error carrying the absent wording when
 * Boosthis was asked and holds no live rule with this id for this language.
 */
export async function lookupUnbuiltRule(
  id: string,
  runtime: string,
): Promise<FoundRule | UncheckedRule> {
  if (!isRuleIdShape(id)) throw new Error(absentMessage(id));
  const key = inviteKey();
  if (!key) return unchecked(id, "no-key");
  const url =
    `${endpointBase()}${FIX_PATH}?ruleId=${encodeURIComponent(id)}` +
    `&runtime=${encodeURIComponent(runtime)}`;
  const got = await ask(url, key, FIX_TIMEOUT_MS, FIX_MAX_BYTES);
  if (got.kind === "failed") return unchecked(id, got.reason);
  if (got.kind === "status") {
    if (got.status === 404 || got.status === 410) throw new Error(absentMessage(id));
    return unchecked(id, statusReason(got.status));
  }
  const body = got.body;
  if (!isRecord(body) || typeof body.fixTemplate !== "string") {
    return unchecked(id, "unreadable");
  }
  // The when-to-apply line and the approval date ride in the answer's
  // `approved` block, which only a rule a person approved carries. A rule a
  // later kit release ships comes back without one, so it reads undated.
  const approved = isRecord(body.approved) ? body.approved : {};
  const date = approvalDate(approved.approvedAt);
  return {
    id,
    title: text(body.title),
    when_to_apply: text(approved.whenToApply),
    fix_available: true,
    fix_template: body.fixTemplate,
    built_in: false,
    approved_on: date,
    lookup: "found",
    note: approvalNote(date),
  };
}

function uncheckedList<T>(builtIn: T[], reason: LookupReason): RuleListAnswer<T> {
  return {
    count: builtIn.length,
    rules: builtIn,
    approved_rules: "unchecked",
    approved_rules_reason: reason,
    note: LIST_UNCHECKED_NOTE,
  };
}

/**
 * list_rules: the built-in entries, unchanged and first, then the rules a
 * person approved since this release for this language when Boosthis lists
 * them within a short wait. A category filter is answered without asking,
 * because approved rules carry no category.
 */
export async function listWithApprovedRules<T>(
  builtIn: T[],
  opts: { runtime: string; builtInIds: Iterable<string>; filtered: boolean },
): Promise<RuleListAnswer<T>> {
  if (opts.filtered) {
    return {
      count: builtIn.length,
      rules: builtIn,
      approved_rules: "not-asked",
      note: LIST_NOT_ASKED_NOTE,
    };
  }
  const key = inviteKey();
  if (!key) return uncheckedList(builtIn, "no-key");
  const url = `${endpointBase()}${APPROVED_LIST_PATH}?runtime=${encodeURIComponent(opts.runtime)}`;
  const got = await ask(url, key, LIST_TIMEOUT_MS, LIST_MAX_BYTES);
  if (got.kind === "failed") return uncheckedList(builtIn, got.reason);
  if (got.kind === "status") return uncheckedList(builtIn, statusReason(got.status));
  const listed = isRecord(got.body) ? got.body.rules : undefined;
  if (!Array.isArray(listed)) return uncheckedList(builtIn, "unreadable");
  const seen = new Set<string>(opts.builtInIds);
  const approved: ApprovedListEntry[] = [];
  for (const item of listed) {
    if (approved.length >= LIST_MAX_RULES) break;
    if (!isRecord(item)) continue;
    const id = item.ruleId;
    if (typeof id !== "string" || !isRuleIdShape(id) || seen.has(id)) continue;
    seen.add(id);
    const date = approvalDate(item.approvedAt);
    approved.push({
      id,
      title: text(item.title),
      when_to_apply: text(item.whenToApply),
      built_in: false,
      approved_on: date,
      note: approvalNote(date),
    });
  }
  const rules: Array<T | ApprovedListEntry> = [...builtIn, ...approved];
  return { count: rules.length, rules, approved_rules: "listed", note: LIST_LISTED_NOTE };
}
