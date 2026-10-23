/* ─── Boosthis: candidate rules (Node port) ──────────────────────────
 *
 * A "candidate rule" is a recurring performance signature that Boosthis has
 * observed but which does NOT map to any rule in the existing rule book. When
 * the same kind of finding fires repeatedly, that's a strong signal there's a
 * real, generalizable perf pattern worth turning into a named rule.
 *
 * Faithful port of `lib/boosthis-runtime-rn/src/candidateRules.ts`. The only
 * difference is storage: RN persists through its platform abstraction; Node
 * persists through `./storage` (a JSON file under ~/.boosthis, like the Python
 * package). The privacy contract is identical:
 *
 *   1. A finding is hashed into a signature — NO route names (which may carry
 *      user data), NO values, NO code. Just kind + bucketed severity + count.
 *   2. If the same signature is seen >= MIN_OCCURRENCES times locally, it
 *      surfaces as a candidate rule.
 *   3. If — and ONLY if — the app has registered telemetry, the signature is
 *      auto-submitted the moment it crosses the threshold. No unreviewed rule
 *      is ever auto-shipped: the maintainer review is what promotes a
 *      candidate into the real rule book. See PRIVACY.md.
 */

import { isProblemKind } from "./problemKinds";
import { findingPart, type FailurePartUnknown } from "./failurePart";
import { isBoosthisDisabled } from "./runtimeFlags";
import { storage } from "./storage";
import { uploadsReady, type QueueAnswer } from "./uploadRecovery";
import { noteRowsDiscarded } from "./serverlessMeters";
import { safeProblemCause, type ProblemCause } from "./problemCause";

/** A cross-cutting performance finding produced by the Node adapter
 *  (`reporting.collectFindings`). The `name` may be a route label and is used
 *  only locally (for dedupe + a generic hint); it is NEVER part of the
 *  signature or any transmitted payload. */
export interface CrossCuttingFinding {
  cause?: ProblemCause;
  kind: string;
  name: string;
  p95: number;
  count: number;
  hint: string;
}

const STORAGE_KEY = "boosthis:candidate-rules:v1";
const MAX_CANDIDATES = 100;
const MIN_OCCURRENCES_TO_SURFACE = 2;

export type CandidateStatus = "new" | "promoted-local" | "submitted" | "refused";

export interface CandidateRule {
  cause?: ProblemCause;
  /** Stable local id derived from the signature. */
  id: string;
  /** Privacy-safe fingerprint: `<kind>:<bucket>:<countBucket>`. No values. */
  signature: string;
  /** Detector kind that produced this finding. */
  kind: string;
  /** Bucketed severity ("low" | "med" | "high") based on p95. */
  severityBucket: "low" | "med" | "high";
  /** First wall-clock time this signature was seen. */
  firstSeenAt: number;
  /** Most recent wall-clock time. */
  lastSeenAt: number;
  /** How many times this exact signature has fired. */
  occurrences: number;
  /** Safe, generic hint pulled from the originating finding. */
  exampleHint: string;
  /** Lifecycle state. Server upload sets `submitted`. */
  status: CandidateStatus;
  /** WHERE the most recent sighting of this signature was: the route, as the
   *  sample path already labels it, when the detector filed the finding under
   *  one. Exactly one of these two is ever set — see `failurePart.ts`. The
   *  part travels; it is still never part of the signature, so grouping is
   *  unchanged and one problem does not split into one row per route. */
  routeLabel?: string;
  partUnknown?: FailurePartUnknown;
}

function bucketSeverity(p95: number): "low" | "med" | "high" {
  if (p95 <= 100) return "low";
  if (p95 <= 500) return "med";
  return "high";
}

function bucketCount(count: number): string {
  if (count < 3) return "<3";
  if (count < 10) return "<10";
  if (count < 50) return "<50";
  return "50+";
}

/** Build the privacy-safe signature. We intentionally drop the `name` field of
 *  the finding (which might be a route label carrying user-supplied content)
 *  and keep only the kind + severity + count bucket. */
export function signatureFor(finding: CrossCuttingFinding): string {
  const sev = bucketSeverity(finding.p95);
  const ct = bucketCount(finding.count);
  return `${finding.kind}:${sev}:${ct}`;
}

function safeHashId(input: string): string {
  // Cheap stable hash — no crypto dep, no PII risk because input is already
  // the signature (no user values). Used purely as a stable map key.
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (h * 33) ^ input.charCodeAt(i);
  return "cr_" + (h >>> 0).toString(36);
}

/** Replace the persisted candidate set with the given list. Bounded. */
async function writeAll(list: CandidateRule[]): Promise<void> {
  try {
    const trimmed = list.slice(0, MAX_CANDIDATES);
    await storage.set(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage is best-effort.
  }
}

/** Read the persisted candidate set. Safe — returns [] on any error. */
export async function listCandidateRules(): Promise<CandidateRule[]> {
  try {
    const raw = await storage.get(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is CandidateRule =>
        c &&
        typeof c.id === "string" &&
        typeof c.signature === "string" &&
        typeof c.occurrences === "number",
    );
  } catch {
    return [];
  }
}

/** Network submitter registered by the telemetry client when an app has
 *  registered. When telemetry is off, no submitter is registered and nothing
 *  leaves the process. */
export type CandidateSubmitter = (
  signatures: readonly {
    signature: string;
    kind: string;
    severityBucket: "low" | "med" | "high";
    countBucket: string;
    occurrences: number;
    cause?: ProblemCause;
  }[],
) => Promise<QueueAnswer>;

let activeSubmitter: CandidateSubmitter | null = null;
let sendLimit = 50;

/** Register an auto-submitter. Pass `null` to clear (e.g. on erasure). */
export function setCandidateSubmitter(
  submitter: CandidateSubmitter | null,
): void {
  activeSubmitter = submitter;
}

/* ─── Fix-resolution detection ──────────────────────────────────────
 *
 * Boosthis reports not just issues but fixes: when a rule kind that was
 * previously firing at a worse severity is later observed only at a better
 * severity, a fix was applied. We emit a privacy-safe resolution signal — the
 * rule kind plus the bucketed before→after rating. NEVER the code, diff, route
 * names, or raw values.
 */

const BASELINE_STORAGE_KEY = "boosthis:rule-baselines:v1";

type SeverityBucket = "low" | "med" | "high";
const SEV_RANK: Record<SeverityBucket, number> = { low: 0, med: 1, high: 2 };

type SampleRating = "good" | "needs-work" | "poor";
function severityToRating(sev: SeverityBucket): SampleRating {
  return sev === "high" ? "poor" : sev === "med" ? "needs-work" : "good";
}

/** Network submitter for fix-resolution signals. Wired by the telemetry client
 *  exactly like {@link CandidateSubmitter}. Payload carries only rule kind +
 *  bucketed before→after rating. */
export type ResolutionSubmitter = (
  resolutions: readonly {
    ruleId: string;
    kind: string;
    beforeRating: SampleRating;
    afterRating: SampleRating;
    occurrences: number;
    severityBucket?: SeverityBucket;
    countBucket?: string;
  }[],
) => Promise<QueueAnswer>;

let activeResolutionSubmitter: ResolutionSubmitter | null = null;

/** Register the resolution auto-submitter. Pass `null` to clear. */
export function setResolutionSubmitter(
  submitter: ResolutionSubmitter | null,
): void {
  activeResolutionSubmitter = submitter;
}

/** Per-kind worst severity ever observed. Used only to detect when a rule's
 *  severity later improves. Contains no user data — just rule kinds mapped to
 *  a low/med/high bucket. */
async function readBaselines(): Promise<Record<string, SeverityBucket>> {
  try {
    const raw = await storage.get(BASELINE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, SeverityBucket> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === "low" || v === "med" || v === "high") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

async function writeBaselines(
  baselines: Record<string, SeverityBucket>,
): Promise<void> {
  try {
    await storage.set(BASELINE_STORAGE_KEY, JSON.stringify(baselines));
  } catch {
    // Best-effort, same policy as the candidate store.
  }
}

/** Module-level dedupe: a poller may feed an identical finding set repeatedly.
 *  We must NOT increment occurrences each time — otherwise "recurrence"
 *  reflects polling cadence, not real recurrence. We hash the finding set and
 *  skip if unchanged. */
let lastIngestKey: string | null = null;

/** Test-only: clear the dedupe key so successive ingests behave as independent
 *  observations. */
export function _resetIngestDedupeForTests(): void {
  lastIngestKey = null;
  sendLimit = 50;
}

function fingerprintFindings(findings: CrossCuttingFinding[]): string {
  return findings
    .map((f) => `${f.kind}|${f.name}|${Math.round(f.p95)}|${f.count}`)
    .sort()
    .join("\n");
}

/**
 * Ingest the latest findings: increment counts for known signatures, create
 * new candidates for unseen ones, detect fix resolutions, persist, and (if an
 * app has registered telemetry) auto-submit new surfaceable candidates +
 * resolutions. Returns the updated surfaceable list.
 *
 * Polling-safe: consecutive calls with an identical finding set are treated as
 * the same observation and do NOT inflate occurrence counts.
 */
export async function ingestFindings(
  observed: CrossCuttingFinding[],
  ending = false,
): Promise<CandidateRule[]> {
  // Only the shared vocabulary travels. A kind nobody else spells the same way
  // could never group with the same problem found by another language, so it is
  // dropped here rather than accumulated and uploaded. Dropping (not throwing)
  // is deliberate: bookkeeping must never break the host. The build guard in
  // scripts/src/__tests__/kitProblemReporting.test.ts is what stops an off-list
  // detector going unnoticed. See docs/kit-problem-reporting-contract.md.
  const findings = observed.filter((f) => isProblemKind(f.kind));
  const key = fingerprintFindings(findings);
  const unchanged = key === lastIngestKey;
  lastIngestKey = key;
  const now = Date.now();
  const existing = await listCandidateRules();
  const byId = new Map(existing.map((c) => [c.id, c]));

  for (const f of unchanged ? [] : findings) {
    const sig = signatureFor(f);
    const id = safeHashId(sig);
    const prev = byId.get(id);
    // WHERE this sighting was. Read from the name the detector already filed
    // the finding under, never from whatever route happens to be in flight
    // while this bookkeeping pass runs.
    const where = findingPart(f.name);
    if (prev) {
      byId.set(id, {
        ...prev,
        lastSeenAt: now,
        occurrences: prev.occurrences + 1,
        // The LATEST sighting's answer, whichever of the two it is. Keeping a
        // part named by an earlier sighting beside a newer "could not tell"
        // would leave one record asserting both, and every reader prefers the
        // name — so the store would keep showing a route this problem is no
        // longer being seen on. One answer, always the freshest.
        routeLabel: where.routeLabel,
        partUnknown: where.partUnknown,
        cause: safeProblemCause(f.cause, f.kind, f.count),
      });
    } else {
      byId.set(id, {
        id,
        signature: sig,
        kind: f.kind,
        severityBucket: bucketSeverity(f.p95),
        firstSeenAt: now,
        lastSeenAt: now,
        occurrences: 1,
        exampleHint: f.hint,
        status: "new",
        cause: safeProblemCause(f.cause, f.kind, f.count),
        ...where,
      });
    }
  }

  const merged = [...byId.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  await writeAll(merged);

  // ── Fix-resolution detection ──────────────────────────────────────
  const baselines = await readBaselines();
  let baselinesChanged = false;
  const currentWorst: Record<string, SeverityBucket> = {};
  const currentCount: Record<string, number> = {};
  for (const f of findings) {
    const sev = bucketSeverity(f.p95);
    const prev = currentWorst[f.kind];
    if (!prev || SEV_RANK[sev] > SEV_RANK[prev]) currentWorst[f.kind] = sev;
    currentCount[f.kind] = Math.max(currentCount[f.kind] ?? 0, f.count);
  }
  const resolved: {
    ruleId: string;
    kind: string;
    beforeRating: SampleRating;
    afterRating: SampleRating;
    occurrences: number;
    severityBucket: SeverityBucket;
    countBucket: string;
  }[] = [];
  for (const [kind, sev] of Object.entries(currentWorst)) {
    const worst = baselines[kind];
    if (worst && SEV_RANK[sev] < SEV_RANK[worst]) {
      // Improvement — defer baseline lowering until the submit succeeds.
      resolved.push({
        ruleId: kind,
        kind,
        beforeRating: severityToRating(worst),
        afterRating: severityToRating(sev),
        occurrences: 1,
        // Privacy-safe "circumstances" so the community matcher can weight this
        // proven fix toward similar pages: the severity the issue held BEFORE
        // the fix, plus the bucketed occurrence count. No raw values, no code.
        severityBucket: worst,
        countBucket: bucketCount(currentCount[kind] ?? 0),
      });
    } else if (!worst || SEV_RANK[sev] > SEV_RANK[worst]) {
      // New or worsened — record/raise the worst-ever baseline now.
      baselines[kind] = sev;
      baselinesChanged = true;
    }
  }
  if (resolved.length > 0 && activeResolutionSubmitter && uploadsReady(ending)) {
    try {
      const answer = await activeResolutionSubmitter(resolved);
      const accepted = typeof answer === "number" ? answer : answer.accepted;
      const refused = typeof answer !== "number" && answer.undelivered === "refused";
      if (accepted > 0 || refused) {
        if (refused) noteRowsDiscarded(resolved.length - accepted, "sendFailed");
        for (const r of resolved.slice(0, refused ? resolved.length : accepted)) {
          baselines[r.ruleId] = currentWorst[r.ruleId]!;
          baselinesChanged = true;
        }
      }
    } catch {
      // Best-effort. Baseline untouched so the improvement retries next pass.
    }
  }
  if (baselinesChanged) await writeBaselines(baselines);

  // Auto-submit: any surfaceable candidate still `new` just crossed the local
  // threshold. If an app has registered (submitter set), upload it now and
  // mark as submitted. If not, activeSubmitter is null and nothing leaves.
  if (
    activeSubmitter &&
    listSurfaceable(merged).some((c) => c.status === "new") &&
    uploadsReady(ending)
  ) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const toSubmit = listSurfaceable(merged)
        .filter((c) => c.status === "new").slice(0, sendLimit);
      if (toSubmit.length === 0) break;
      const payload = toSubmit.map((c) => ({
        signature: c.signature,
        kind: c.kind,
        severityBucket: c.severityBucket,
        countBucket: c.signature.split(":")[2] ?? "<3",
        occurrences: c.occurrences,
        ...(safeProblemCause(c.cause, c.kind) ? { cause: safeProblemCause(c.cause, c.kind) } : {}),
        // A part travels beside the signature, never folded into it.
        ...(c.routeLabel !== undefined
          ? { routeLabel: c.routeLabel }
          : c.partUnknown !== undefined
            ? { partUnknown: c.partUnknown }
            : {}),
      }));
      try {
        const answer = await activeSubmitter(payload);
        const accepted = typeof answer === "number" ? answer : answer.accepted;
        if (accepted > 0) {
          const submittedIds = new Set(toSubmit.slice(0, accepted).map((c) => c.id));
          for (const c of merged) if (submittedIds.has(c.id)) c.status = "submitted";
          await writeAll(merged);
          continue;
        }
        if (typeof answer !== "number" && answer.undelivered === "refused") {
          if (toSubmit.length === 1) {
            toSubmit[0]!.status = "refused";
            noteRowsDiscarded(1, "sendFailed");
            sendLimit = 50;
            await writeAll(merged);
          } else {
            sendLimit = Math.ceil(toSubmit.length / 2);
          }
          continue;
        }
      } catch {
        // Keep unsent rows for the next pass, including unchanged findings.
      }
      break;
    }
  }

  return listSurfaceable(merged);
}

/** Filter to candidates that have hit the minimum recurrence threshold. */
export function listSurfaceable(all: CandidateRule[]): CandidateRule[] {
  return all.filter((c) => c.occurrences >= MIN_OCCURRENCES_TO_SURFACE);
}

/** User accepted a candidate — mark it locally promoted. Does not edit the
 *  shipped rule book (that's a maintainer release step). */
export async function promoteCandidateLocal(id: string): Promise<void> {
  const all = await listCandidateRules();
  const next = all.map((c) =>
    c.id === id ? { ...c, status: "promoted-local" as const } : c,
  );
  await writeAll(next);
}

/** Mark candidate as submitted (call after successful server POST). */
export async function markCandidateSubmitted(id: string): Promise<void> {
  const all = await listCandidateRules();
  const next = all.map((c) =>
    c.id === id ? { ...c, status: "submitted" as const } : c,
  );
  await writeAll(next);
}

/** Wipe all candidates AND the rule-severity baselines. Used by
 *  `telemetry.forget()` and a dissolve, so no finding is left behind. */
export async function clearAllCandidates(): Promise<void> {
  try {
    await storage.remove(STORAGE_KEY);
  } catch {
    // Best-effort.
  }
  try {
    await storage.remove(BASELINE_STORAGE_KEY);
  } catch {
    // Best-effort.
  }
  // The recurrence record is part of the same local memory of findings, so it
  // leaves on the same path. Erasure that left "we have seen this in four
  // releases" behind would be an erasure in name only.
  try {
    await storage.remove(RECURRENCE_STORAGE_KEY);
  } catch {
    // Best-effort.
  }
  recurrenceMirror = null;
}

/* ─── What this app keeps doing, across restarts ─────────────────────────
 *
 * A finding computed in the process and forgotten when the process ends
 * arrives fresh on every deploy, and nothing can tell a one-off from the
 * fourth release running. The measurement is already taken; what was missing
 * was the memory of having taken it before.
 *
 * WHAT IS REMEMBERED. The finding's KIND, and nothing else. Not the route (an
 * AI finding is filed under a fixed literal anyway), not the prompt, not the
 * host, not the model, not the release string — the release is folded into a
 * local hash and a local ordinal that never leave the process. What leaves is
 * counts: how many separate runs, how many separate releases, how long ago.
 *
 * WHY IT LIVES HERE. This is the store findings already live in: the same
 * bounded list, the same best-effort writes, the same worst-ever severity
 * idea, and above all the same erase path — `clearAllCandidates()`, which
 * `telemetry.forget()` and a withdrawn consent already call.
 */

const RECURRENCE_STORAGE_KEY = "boosthis:finding-recurrence:v1";
/** Bounded like the candidate list. There are six AI kinds today; the ceiling
 *  is what stops a future vocabulary from growing the file without limit. */
const MAX_REMEMBERED_PATTERNS = 24;
const MAX_RECENT_RELEASES = 32;
const MS_PER_DAY = 86_400_000;
/** How stale "last seen" may get before a tick that saw nothing new is still
 *  worth a write. Without it, a pattern firing on every tick would rewrite the
 *  store on every tick, which is a write loop on the host's disk in exchange
 *  for a few seconds of precision on a day-grained reading. */
const RECURRENCE_TOUCH_MS = 60_000;

/** One remembered pattern. Counts and buckets only — every field here is
 *  either a number we produced or a word from the shared vocabulary. */
export interface RememberedPattern {
  /** Shared-vocabulary problem kind. */
  kind: string;
  /** Separate process runs this pattern has been seen in. */
  runs: number;
  /** Separate releases it has been seen in. 0 means no run that saw it could
   *  name its release — never rendered as "zero releases". */
  releases: number;
  /** First and most recent wall-clock sighting. */
  firstSeenAt: number;
  lastSeenAt: number;
  /** The run and the release ordinal of the most recent sighting. Local only:
   *  the run id is minted per process and the ordinal counts releases this
   *  install has observed. Neither is ever uploaded. */
  lastRun: string;
  lastOrdinal: number;
  /** Bounded local hashes, to avoid counting a rollback twice. */
  releaseHashes: string[];
  /** Worst severity ever bucketed for this kind — the same idea, and the same
   *  buckets, as the rule baselines above. */
  worst: SeverityBucket;
}

interface RecurrenceRecord {
  /** Hash of the release key most recently observed. "" when this install has
   *  never been able to name a release. */
  releaseHash: string;
  /** How many DIFFERENT releases this install has observed, ever. 0 when none
   *  could be named. */
  releaseOrdinal: number;
  releaseHashes: string[];
  patterns: RememberedPattern[];
}

/** Minted once per process. A restart is a new run; nothing else is. */
const RUN_ID = safeHashId(
  `${Date.now()}:${Math.random()}:${typeof process !== "undefined" ? (process.pid ?? 0) : 0}`,
);
let runIdOverride: string | null = null;
function currentRunId(): string {
  return runIdOverride ?? RUN_ID;
}

/** The last written record, kept in memory so the snapshot — which is built
 *  synchronously — can read it without a disk round trip. `null` means the
 *  store has not been read yet in this process, which is a different thing
 *  from an empty record and is reported as silence, not as "nothing recurs". */
let recurrenceMirror: RecurrenceRecord | null = null;

function emptyRecurrence(): RecurrenceRecord {
  return { releaseHash: "", releaseOrdinal: 0, releaseHashes: [], patterns: [] };
}

/** Only the kinds this channel is for. A kind outside the shared vocabulary is
 *  dropped for the same reason `ingestFindings` drops it: a spelling no other
 *  kit and no server surface can read. */
export function isRecurrenceKind(kind: string): boolean {
  return isProblemKind(kind) && kind.startsWith("ai-");
}

function readRecurrenceRecord(raw: string | null | undefined): RecurrenceRecord {
  try {
    if (!raw) return emptyRecurrence();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyRecurrence();
    const obj = parsed as Record<string, unknown>;
    const patterns: RememberedPattern[] = [];
    if (Array.isArray(obj.patterns)) {
      for (const p of obj.patterns as unknown[]) {
        if (!p || typeof p !== "object") continue;
        const r = p as Record<string, unknown>;
        if (typeof r.kind !== "string" || !isRecurrenceKind(r.kind)) continue;
        if (typeof r.runs !== "number" || typeof r.firstSeenAt !== "number") continue;
        patterns.push({
          kind: r.kind,
          runs: Math.max(1, Math.floor(r.runs)),
          releases:
            typeof r.releases === "number" ? Math.max(0, Math.floor(r.releases)) : 0,
          firstSeenAt: r.firstSeenAt,
          lastSeenAt:
            typeof r.lastSeenAt === "number" ? r.lastSeenAt : r.firstSeenAt,
          lastRun: typeof r.lastRun === "string" ? r.lastRun : "",
          lastOrdinal:
            typeof r.lastOrdinal === "number" ? Math.max(0, Math.floor(r.lastOrdinal)) : 0,
          releaseHashes: Array.isArray(r.releaseHashes)
            ? r.releaseHashes.filter((h): h is string => typeof h === "string").slice(-MAX_RECENT_RELEASES)
            : r.lastOrdinal === obj.releaseOrdinal && typeof obj.releaseHash === "string" && obj.releaseHash
              ? [obj.releaseHash] : [],
          worst:
            r.worst === "low" || r.worst === "med" || r.worst === "high"
              ? r.worst
              : "low",
        });
      }
    }
    return {
      releaseHash: typeof obj.releaseHash === "string" ? obj.releaseHash : "",
      releaseOrdinal:
        typeof obj.releaseOrdinal === "number"
          ? Math.max(0, Math.floor(obj.releaseOrdinal))
          : 0,
      releaseHashes: Array.isArray(obj.releaseHashes)
        ? obj.releaseHashes.filter((h): h is string => typeof h === "string").slice(-MAX_RECENT_RELEASES)
        : typeof obj.releaseHash === "string" && obj.releaseHash ? [obj.releaseHash] : [],
      patterns,
    };
  } catch {
    return emptyRecurrence();
  }
}

/**
 * Remember the AI findings this tick produced.
 *
 * `releaseKey` is whatever identifies the running build to THIS process — a
 * commit, a build time, an app version. It is hashed immediately and the hash
 * never leaves; an empty or missing key means this run cannot name its
 * release, and the release counts simply do not move (they are never
 * incremented on a guess, and never reported as zero releases).
 */
export async function noteRecurringFindings(
  findings: readonly CrossCuttingFinding[],
  opts?: { releaseKey?: string | null; now?: number },
): Promise<void> {
  try {
    if (isBoosthisDisabled()) return;
    const now = opts?.now ?? Date.now();
    // Exclusive: a sibling worker that holds the lock past its budget makes
    // this tick skip rather than publish over the record it is writing. The
    // skip loses nothing counted — a release, run or kind is counted when the
    // record does not hold it yet, so the next tick re-reads and adds it then.
    storage.updateSyncExclusive(RECURRENCE_STORAGE_KEY, (raw) => {
    const record = readRecurrenceRecord(raw);

    // A release this install has not observed before advances the ordinal
    // ONCE. Every later tick under the same build leaves it alone, so the
    // count is releases, not restarts and not ticks.
    // Something genuinely new: a release never observed, a kind never seen, a
    // new run, a worse severity. A tick that only moves "last seen" forward by
    // a second is not new, and writing on every one of those would turn
    // bookkeeping into a write loop on the host's disk.
    let changed = false;
    let touched = false;
    const key = (opts?.releaseKey ?? "").trim();
    if (key.length > 0) {
      const hash = safeHashId(`release:${key}`);
      if (!record.releaseHashes.includes(hash)) {
        record.releaseHashes = [...record.releaseHashes, hash].slice(-MAX_RECENT_RELEASES);
        record.releaseHash = hash;
        record.releaseOrdinal += 1;
        // The ordinal has to survive the restart even when this run sees no
        // findings at all, or a release nothing happened in is counted again
        // the next time one does.
        changed = true;
      }
    }
    const hash = key.length > 0 ? safeHashId(`release:${key}`) : "";
    const ordinal = key.length > 0 ? record.releaseOrdinal : 0;

    const run = currentRunId();
    const byKind = new Map(record.patterns.map((p) => [p.kind, p]));
    for (const f of findings) {
      if (!isRecurrenceKind(f.kind)) continue;
      const sev = bucketSeverity(f.p95);
      const prev = byKind.get(f.kind);
      if (!prev) {
        byKind.set(f.kind, {
          kind: f.kind,
          runs: 1,
          releases: ordinal > 0 ? 1 : 0,
          firstSeenAt: now,
          lastSeenAt: now,
          lastRun: run,
          lastOrdinal: ordinal,
          releaseHashes: hash ? [hash] : [],
          worst: sev,
        });
        changed = true;
        continue;
      }
      if (prev.lastRun !== run) {
        prev.runs += 1;
        changed = true;
      }
      if (ordinal > 0 && !prev.releaseHashes.includes(hash)) {
        prev.releases += 1;
        prev.releaseHashes = [...prev.releaseHashes, hash].slice(-MAX_RECENT_RELEASES);
        changed = true;
      }
      if (ordinal > 0) prev.lastOrdinal = ordinal;
      if (now - prev.lastSeenAt >= RECURRENCE_TOUCH_MS) touched = true;
      prev.lastRun = run;
      prev.lastSeenAt = now;
      if (SEV_RANK[sev] > SEV_RANK[prev.worst]) {
        prev.worst = sev;
        changed = true;
      }
    }

    const merged = [...byKind.values()]
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, MAX_REMEMBERED_PATTERNS);
    record.patterns = merged;
    // The mirror is refreshed even when nothing moved: a process that has read
    // the store now KNOWS what stopped, which is half of what this channel is
    // for.
    recurrenceMirror = record;
    return changed || touched ? JSON.stringify(record) : raw ?? JSON.stringify(record);
    });
  } catch {
    // Bookkeeping never disturbs the host.
  }
}

/** One row as it rides the AI axis. Counts and a shared-vocabulary kind —
 *  nothing else is derivable from it. */
export interface RecurrenceRow {
  kind: string;
  runs: number;
  releases?: number;
  /** 1 when this run has seen it too, 0 when it has not been seen since an
   *  earlier run. The server turns this into words; the kit never does. */
  seenNow: number;
  firstSeenDaysAgo: number;
  lastSeenDaysAgo: number;
  /** Releases observed since the last sighting. Present only when both the
   *  last sighting and the current build could be keyed to a release. */
  releasesSince?: number;
}

/**
 * The remembered patterns, as counts, for the axis.
 *
 * Returns `null` when this process has not read the store yet — silence, not
 * an empty list, because "we have not looked" and "nothing recurs" are
 * different answers.
 *
 * A pattern seen only in THIS run and never before says nothing the finding
 * itself does not already say, so it is held back by the same threshold the
 * candidate list uses. A pattern that has stopped is always worth a row.
 */
export function readRecurrenceRows(now?: number): RecurrenceRow[] | null {
  const record = recurrenceMirror;
  if (!record) return null;
  const at = now ?? Date.now();
  const run = currentRunId();
  const out: RecurrenceRow[] = [];
  for (const p of record.patterns) {
    const seenNow = p.lastRun === run ? 1 : 0;
    if (seenNow === 1 && p.runs < MIN_OCCURRENCES_TO_SURFACE) continue;
    const row: RecurrenceRow = {
      kind: p.kind,
      runs: p.runs,
      seenNow,
      firstSeenDaysAgo: Math.max(0, Math.floor((at - p.firstSeenAt) / MS_PER_DAY)),
      lastSeenDaysAgo: Math.max(0, Math.floor((at - p.lastSeenAt) / MS_PER_DAY)),
    };
    if (p.releases > 0) row.releases = p.releases;
    if (p.lastOrdinal > 0 && record.releaseOrdinal > 0) {
      row.releasesSince = Math.max(0, record.releaseOrdinal - p.lastOrdinal);
    }
    out.push(row);
  }
  return out;
}

/** Test/debug helper. */
export const _candidateInternals = {
  STORAGE_KEY,
  BASELINE_STORAGE_KEY,
  RECURRENCE_STORAGE_KEY,
  MAX_CANDIDATES,
  MAX_REMEMBERED_PATTERNS,
  MIN_OCCURRENCES_TO_SURFACE,
  bucketSeverity,
  bucketCount,
  safeHashId,
  /** Stand in for a process restart: a different run id is the only thing
   *  that makes a sighting a new RUN. `null` restores this process's own. */
  setRunIdForTests(id: string | null): void {
    runIdOverride = id;
  },
  /** Drop the in-memory mirror without touching the store — what a fresh
   *  process sees before its first tick. */
  resetRecurrenceMirrorForTests(): void {
    recurrenceMirror = null;
  },
};
