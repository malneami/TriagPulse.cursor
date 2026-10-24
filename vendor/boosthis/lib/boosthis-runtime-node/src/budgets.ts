/** Auto perf budgets — mirrors `lib/boosthis-py/boosthis/budgets.py`.
 *
 * This is the one Boosthis reading that is LEARNED rather than typed, so it
 * is held to the three conditions docs/decisions/adaptive-anomaly-detection.md
 * names: reproducible from stated inputs, explainable in a sentence, and
 * abstaining when under-sampled. The rule in full is
 * docs/learned-budget-contract.md.
 *
 * Three properties the earlier version did not have:
 *
 *  1. THE TWO WINDOWS CANNOT OVERLAP, AND THE BASELINE DOES NOT DEPEND ON
 *     WHEN IT IS READ. The baseline is the route's FIRST samples, kept by the
 *     ring module as they arrived; the window compared against it takes only
 *     samples stamped strictly later. Re-deriving both slices from the shared
 *     ring meant a busy route's "baseline" was the same few minutes as its
 *     "recent" — the app compared against itself just now — so a regression
 *     that built over an hour never tripped it. Capturing at arrival rather
 *     than freezing on first read is what closes that for a process nobody
 *     reads until the drift has already happened.
 *  2. WARM-UP IS NOT THE YARDSTICK. The first BUDGET_WARMUP_N samples of a
 *     route are JIT-cold and cache-cold. They are excluded from the baseline
 *     on that stated rule, so ordinary running does not read as "improved"
 *     against a cold start.
 *  3. A ROUTE WHOSE HISTORY WAS EVICTED SAYS SO, AND KEEPS ITS ROW. The ring
 *     holds 1000 samples shared by every route; a quiet route can be pushed
 *     below the floor and never climb back. That is a different answer from
 *     "still learning", and it carries what would change it. It is also why
 *     allStatuses() lists routes by what this process has MEASURED rather
 *     than by what the ring still holds — a route whose last sample was
 *     evicted would otherwise vanish from every surface before it could say
 *     anything.
 *
 * Both spans travel with the answer, and so does the name of the algorithm
 * that produced it: the phone and browser kits answer the same question from
 * a server-computed window instead, and a reader must never have to guess
 * which one replied.
 */

import * as samples from "./samples";

/** Samples of a route treated as warm-up and never entered into its baseline.
 *  Small deliberately: it is a stated exclusion, not a tuned one. */
export const BUDGET_WARMUP_N = 5;

/** Samples that form the frozen baseline, after warm-up. */
export const BUDGET_BASELINE_N = 20;

/** Samples taken AFTER the baseline closed that form the compared window. */
export const BUDGET_RECENT_N = 20;

export const REGRESSION_FACTOR = 1.5;
export const IMPROVEMENT_FACTOR = 0.66;

/** A route whose recent p95 is still under the tail floor has not regressed in
 *  any way a caller waits for, whatever the ratio: 2ms → 4ms doubles and is
 *  still instant. The same floor the resilience tail treats as flat. */
export const BUDGET_REGRESSION_FLOOR_MS = 100; // the same floor every kit applies (docs/decisions/meter-settle-rule.md)

/** How many of this route's samples must sit in the ring at once before a
 *  first verdict is possible: warm-up, then the baseline, then a window drawn
 *  from strictly later samples. */
export const BUDGET_SAMPLES_FOR_VERDICT =
  BUDGET_WARMUP_N + BUDGET_BASELINE_N + BUDGET_RECENT_N;

/** The shared ring's capacity, as this module reads it. Named because the
 *  eviction answer below has to say what a route was evicted FROM. */
export const BUDGET_RING_LIMIT = 1000;

/** Back-compatible names. These were the module's public constants from its
 *  first release and are re-exported by index.ts, so they keep their meaning
 *  rather than disappearing under a rename. */
export const BASELINE_N = BUDGET_BASELINE_N;
export const RECENT_N = BUDGET_RECENT_N;

/** Which algorithm produced a budget answer.
 *
 *  `device-ring-frozen-baseline` is this one: computed in the app's own
 *  process from its in-memory sample ring, against a baseline frozen on the
 *  device. The phone and browser kits answer the same question from a window
 *  the Boosthis server computes over uploaded readings, which is a different
 *  algorithm over different data — see docs/learned-budget-contract.md. Named
 *  on every surface so a developer's assistant is never left to infer it. */
export const BUDGET_ALGORITHM = "device-ring-frozen-baseline" as const;
export type BudgetAlgorithm = typeof BUDGET_ALGORITHM;

/**
 * - `learning`  — not enough of this route's samples yet; more traffic fixes it.
 * - `evicted`   — this route HAD more samples and the shared ring dropped them
 *                 before a verdict could be drawn. More traffic on this route
 *                 alone may not fix it; a quieter app or a larger share will.
 * - `stable` / `regressed` / `improved` — judged.
 */
export type BudgetState =
  | "learning"
  | "evicted"
  | "stable"
  | "regressed"
  | "improved";

/** The three states that mean a verdict was actually reached. A caller
 *  counting "routes carrying a budget" must use this rather than testing for
 *  `!== "learning"`, or an evicted route is counted as judged. */
const JUDGED_STATES: ReadonlySet<BudgetState> = new Set<BudgetState>([
  "stable",
  "regressed",
  "improved",
]);

export function isJudgedBudget(b: { state: BudgetState }): boolean {
  return JUDGED_STATES.has(b.state);
}

/** One of the two spans a verdict was drawn over. `from_ms`/`to_ms` are the
 *  wall-clock stamps of the oldest and newest sample IN the window, so a
 *  reader can see how far apart the two windows really were. */
export interface BudgetWindow {
  samples: number;
  from_ms: number;
  to_ms: number;
  p95_ms: number;
}

export interface BudgetStatus {
  route: string;
  state: BudgetState;
  /** Which algorithm answered. Constant here; the server-window kits say so
   *  with their own value. */
  algorithm: BudgetAlgorithm;
  /** One sentence stating the rule this answer was derived under, or what is
   *  missing and what would change it. Carries no route label, no host and
   *  nothing a customer typed — only this module's own constants. */
  explanation: string;
  baseline_p95_ms?: number;
  recent_p95_ms?: number;
  /** The frozen baseline's span. Never overlaps `recent_window`. */
  baseline_window?: BudgetWindow;
  /** The compared window's span — samples stamped strictly after the baseline
   *  closed. */
  recent_window?: BudgetWindow;
  /** This route's samples currently in the ring. */
  samples_seen: number;
  /** How many must sit in the ring at once before a verdict is possible. */
  samples_needed?: number;
  /** Samples excluded from the baseline as warm-up, on the stated rule. */
  warmup_excluded?: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

interface FrozenBaseline {
  p95Ms: number;
  samples: number;
  fromMs: number;
  toMs: number;
  warmupExcluded: number;
}

/** The baseline is drawn from the route's arrival record — the first samples
 *  the process ever recorded for it, kept by the ring module as they arrived
 *  (samples.routeHead). Nothing here is frozen at READ time.
 *
 *  Freezing on the first read looks equivalent and is not: a process that
 *  serves traffic for an hour before anything reads a budget hands that first
 *  read a ring holding only the last few minutes of the route, so the
 *  "frozen" baseline is once again the app measured against itself just now.
 *  The arrival record has no such dependence on when it is read — it is the
 *  same twenty samples whether the first read comes after a minute or after a
 *  day, which is also what makes the verdict reproducible from stated inputs.
 *
 *  Returns null until the route has warm-up plus a full baseline behind it. */
function baselineFor(name: string): FrozenBaseline | null {
  const rec = samples.routeHead(name);
  if (!rec) return null;
  if (rec.head.length < BUDGET_WARMUP_N + BUDGET_BASELINE_N) return null;
  const slice = rec.head.slice(
    BUDGET_WARMUP_N,
    BUDGET_WARMUP_N + BUDGET_BASELINE_N,
  );
  return {
    p95Ms: percentile(
      slice.map((s) => s.duration_ms),
      0.95,
    ),
    samples: slice.length,
    fromMs: slice[0].timestamp_ms,
    toMs: slice[slice.length - 1].timestamp_ms,
    warmupExcluded: BUDGET_WARMUP_N,
  };
}

function windowOf(slice: samples.Sample[], p95: number): BudgetWindow {
  return {
    samples: slice.length,
    from_ms: slice[0].timestamp_ms,
    to_ms: slice[slice.length - 1].timestamp_ms,
    p95_ms: p95,
  };
}

const LEARNING_NO_BASELINE =
  `Still learning — a baseline needs ${BUDGET_WARMUP_N} warm-up samples of ` +
  `this route followed by ${BUDGET_BASELINE_N} more, and a verdict needs ` +
  `${BUDGET_RECENT_N} taken after that baseline closes ` +
  `(${BUDGET_SAMPLES_FOR_VERDICT} in the ring at once). More traffic on this ` +
  "route is all it takes.";

const LEARNING_AWAITING_RECENT =
  `Baseline frozen and closed; still learning — a verdict needs ` +
  `${BUDGET_RECENT_N} samples taken strictly after it, so the two windows ` +
  "share none. More traffic on this route is all it takes.";

const EVICTED =
  `Not judged — this route's samples were dropped from the ${BUDGET_RING_LIMIT}-` +
  "sample ring, shared by every route, before a verdict could be drawn. It " +
  `is judged again once ${BUDGET_SAMPLES_FOR_VERDICT} of its samples sit in ` +
  "the ring at once: a larger share of this app's traffic, or a quieter app.";

function judgedExplanation(base: FrozenBaseline, recent: BudgetWindow): string {
  return (
    `Baseline p95 ${base.p95Ms}ms from ${base.samples} samples, against ` +
    `${recent.p95_ms}ms from ${recent.samples} taken strictly after that ` +
    `baseline closed — the two windows share no sample. The route's first ` +
    `${base.warmupExcluded} samples are warm-up and are not in the baseline. ` +
    `Regression at ${REGRESSION_FACTOR}× the baseline once the recent p95 is ` +
    `${BUDGET_REGRESSION_FLOOR_MS}ms or more, improvement at ` +
    `${IMPROVEMENT_FACTOR}×. Both windows are settled samples: nothing from ` +
    `the process's first minute.`
  );
}

export function statusFor(name: string): BudgetStatus {
  const history = samples.recent({ limit: BUDGET_RING_LIMIT, name });
  // recent() returns newest-first; reverse for chronological order.
  const ordered = history.slice().reverse();
  const base = baselineFor(name);

  // Eviction is claimed only on positive evidence: more samples of this route
  // have arrived than the ring still holds. A route that has simply never
  // been busy has never had any dropped, and is still learning.
  const arrived = samples.routeHead(name)?.total ?? 0;
  const lostHistory = arrived > history.length;

  if (!base) {
    return {
      route: name,
      state: lostHistory ? "evicted" : "learning",
      algorithm: BUDGET_ALGORITHM,
      explanation: lostHistory ? EVICTED : LEARNING_NO_BASELINE,
      samples_seen: history.length,
      samples_needed: BUDGET_SAMPLES_FOR_VERDICT,
      warmup_excluded: BUDGET_WARMUP_N,
    };
  }

  const after = ordered.filter((s) => s.timestamp_ms > base.toMs);
  if (after.length < BUDGET_RECENT_N) {
    return {
      route: name,
      state: lostHistory ? "evicted" : "learning",
      algorithm: BUDGET_ALGORITHM,
      explanation: lostHistory ? EVICTED : LEARNING_AWAITING_RECENT,
      baseline_p95_ms: base.p95Ms,
      baseline_window: {
        samples: base.samples,
        from_ms: base.fromMs,
        to_ms: base.toMs,
        p95_ms: base.p95Ms,
      },
      samples_seen: history.length,
      samples_needed: BUDGET_SAMPLES_FOR_VERDICT,
      warmup_excluded: base.warmupExcluded,
    };
  }

  const recentSlice = after.slice(-BUDGET_RECENT_N);
  const recentP95 = percentile(
    recentSlice.map((s) => s.duration_ms),
    0.95,
  );
  const recentWindow = windowOf(recentSlice, recentP95);
  const baselineP95 = base.p95Ms;
  let state: BudgetState = "stable";
  if (baselineP95 === 0) state = "stable";
  else if (
    recentP95 >= baselineP95 * REGRESSION_FACTOR &&
    recentP95 >= BUDGET_REGRESSION_FLOOR_MS
  )
    state = "regressed";
  else if (recentP95 <= baselineP95 * IMPROVEMENT_FACTOR) state = "improved";
  return {
    route: name,
    state,
    algorithm: BUDGET_ALGORITHM,
    explanation: judgedExplanation(base, recentWindow),
    baseline_p95_ms: baselineP95,
    recent_p95_ms: recentP95,
    baseline_window: {
      samples: base.samples,
      from_ms: base.fromMs,
      to_ms: base.toMs,
      p95_ms: baselineP95,
    },
    recent_window: recentWindow,
    samples_seen: history.length,
    warmup_excluded: base.warmupExcluded,
  };
}

/** Every route this process has measured — not only the ones the ring still
 *  holds a sample of.
 *
 *  Listing the ring's names alone is what made the `evicted` answer
 *  unreachable in practice: the moment a quiet route's last sample was pushed
 *  out, the route vanished from the panel, the budgets answer, the CLI, the
 *  MCP tool, the snapshot and the resilience input — so the one surface that
 *  would have said "this route was dropped before it could be judged" had
 *  already stopped mentioning the route at all. The arrival record outlives
 *  eviction, so the route keeps its row and states why it is unjudged. */
export function allStatuses(): BudgetStatus[] {
  const seen = new Set<string>(samples.trackedRoutes());
  for (const s of samples.recent({ limit: BUDGET_RING_LIMIT })) seen.add(s.name);
  return [...seen].sort().map(statusFor);
}

export function regressions(): BudgetStatus[] {
  return allStatuses().filter((b) => b.state === "regressed");
}

/** Drop every frozen baseline. Tests only.
 *
 *  Nothing is cached here any more: a baseline is derived from the route's
 *  arrival record, which samples.clear() resets along with the ring. Kept as
 *  a no-op so a caller written against the earlier module keeps working, and
 *  so the intent has one obvious name. */
export function resetBaselines(): void {
  samples.clear();
}
