/** What Boosthis itself costs, measured by Boosthis, published, and capped.
 *
 * WHY THIS EXISTS. The loudest public complaint against the big monitoring
 * agents is that they make cold starts worse — and none of them will tell you
 * by how much, because none of them measure it. On an always-on server that
 * argument is academic. On a function it is the bill: every millisecond the
 * agent adds to a cold start is charged to the customer, on every cold start,
 * forever.
 *
 * So this kit measures its own cost, shows it beside everything else it
 * measures, and holds itself under a STATED ceiling. A ceiling nobody checks is
 * marketing; this one is checked on every run, and when the kit is over it the
 * kit cuts back on its own work rather than the customer's.
 *
 * DELIBERATELY IMPORT-FREE. This module is imported FIRST by the kit's entry
 * point, and a static import graph is evaluated depth-first before the
 * importing module's body runs — so a module with no imports of its own is the
 * earliest moment inside the kit that can be timed. One import here and the
 * mark would land after that import's whole subtree had already been paid for,
 * which would under-report exactly the number this file exists to be honest
 * about.
 */

/* ─── The stated ceilings ───────────────────────────────────────────────── */

/**
 * What the kit may add to a COLD START, in milliseconds.
 *
 * Chosen against the thing that actually matters: a function cold start on a
 * modest memory size is tens to hundreds of milliseconds of runtime boot before
 * any customer code runs. A monitoring kit that adds a tenth of that is
 * defensible; one that doubles it is the complaint. 40 ms is the number we are
 * willing to be held to publicly, which is the only kind of ceiling worth
 * stating.
 */
export const KIT_COLD_START_CEILING_MS = 40;

/**
 * What the kit may add to EACH run, in milliseconds — the instrumentation on
 * the request boundary, not the upload (the upload has its own budget and is
 * reported separately, because one is unavoidable work and the other is a
 * network call we choose to make).
 */
export const KIT_PER_RUN_CEILING_MS = 5;

/**
 * The share of a stated ceiling at which the kit calls itself APPROACHING it.
 *
 * A ceiling nobody notices until it is breached is a promise with no warning
 * on it. Our own live server published a 39.99 ms cold start against the 40 ms
 * figure above — a hundredth of a millisecond inside a number we state in
 * public — and the only thing that said so was a red tile a customer reads,
 * not a signal a maintainer does. `overCeiling` is a strict `>`, so it was
 * correctly reporting nothing wrong, which is exactly the problem: there is no
 * distance between "fine" and "we broke our word".
 *
 * 90% rather than something tighter because these figures move with the host's
 * mood by a few percent between instances, and a warning that fires on noise
 * is a warning nobody reads.
 */
export const KIT_CEILING_WARN_PCT = 90;

/* ─── Marks ─────────────────────────────────────────────────────────────── */

const now = (): number => {
  try {
    return performance.now();
  } catch {
    return Date.now();
  }
};

/** Processor time this process has consumed, in milliseconds. Null where the
 *  runtime will not say. Read with a global rather than an import, so this
 *  module stays import-free (see the header). */
const cpuMs = (): number | null => {
  try {
    const u = process.cpuUsage();
    const total = (u.user + u.system) / 1000;
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
};

/* ─── The second opinion ────────────────────────────────────────────────── */

/**
 * A stretch of the kit's own work, offered to the host-suspend sensor before
 * its wall-clock length is believed.
 *
 * Mirrors the sensor's own `MeasuredInterval`, restated here because this
 * module may not import it — a static import would move the module-evaluation
 * mark this file exists to take.
 */
export interface KitMeasuredInterval {
  readonly endedAtMs: number;
  readonly wallMs: number;
  readonly cpuMs: number | null;
}

/** "Did the host stop running us inside this interval?" */
export type KitSuspendProbe = (interval: KitMeasuredInterval) => boolean;

let suspendProbe: KitSuspendProbe | null = null;

/**
 * Hand this module the host-suspend question.
 *
 * WHY A SEAM RATHER THAN AN IMPORT. Every other host-cost reading in the kit —
 * event-loop lag, worst freeze, CPU throttling, latency floor — consults the
 * shared suspend sensor before charging a wall-clock gap to the code it
 * wrapped. This one could not, because importing anything here would move the
 * earliest-mark this file is built around, so it charged the container's naps
 * to itself: a 6.8-second "synchronous" block published against a 5 ms ceiling
 * (docs/kit-footprint-suspend-2026-09.md). The sensor registers the question
 * from its own side instead.
 *
 * Unset, nothing is discounted and the reading is exactly what it was.
 */
export function setKitFootprintSuspendProbe(fn: KitSuspendProbe | null): void {
  suspendProbe = fn;
}

function hostStoppedRunningUs(interval: KitMeasuredInterval): boolean {
  if (!suspendProbe) return false;
  try {
    return suspendProbe(interval) === true;
  } catch {
    // A sensor that throws must never take the kit's own bookkeeping with it,
    // and must never silently turn every interval into a discount either.
    return false;
  }
}

/** The earliest instant inside the kit's own module graph. */
const KIT_EVAL_START = now();

/** How far into the process's life the kit began loading. Anything before this
 *  is the runtime's own boot and the customer's own imports — never ours. */
const KIT_EVAL_START_UPTIME_MS = (() => {
  try {
    return Math.max(0, process.uptime() * 1000);
  } catch {
    return 0;
  }
})();

let moduleEvalMs: number | null = null;
let setupMs = 0;
let runOverheadTotalMs = 0;
let runOverheadWorstMs = 0;
let runsMeasured = 0;
let reducedSteps = 0;
/** The first run's own instrumentation — a one-time cost, so it is reported
 *  as part of the cold start rather than as part of "each run". */
let firstRunMs: number | null = null;
/** Runs after the first: the ones the per-run average actually describes. */
let steadyRuns = 0;
/** Steady runs (the first excluded) whose OWN cost was over the per-run
 *  ceiling. The average is what the ceiling is stated against, but an average
 *  of 3.81 ms hides a run that cost 97 ms, and "how often" is the difference
 *  between one unlucky collection pause and a cost we are not admitting to. */
let runsOverRunCeiling = 0;
/** Runs thrown away because the host stopped running us inside them. */
let suspendDiscounts = 0;
/** The longest thrown-away run, ms — what the average would have been told. */
let suspendWorstMs = 0;

/** Called at the very END of the kit's entry module body. Everything between
 *  the two marks is the kit's own graph: our modules, and nothing of the
 *  customer's. Idempotent — a second entry point must not restart the clock. */
export function noteKitModuleEvalDone(): void {
  if (moduleEvalMs !== null) return;
  moduleEvalMs = Math.max(0, now() - KIT_EVAL_START);
}

/** Synchronous setup work the kit does when the app wires it up: building the
 *  middleware, arming sensors, starting the heartbeat. Paid once, on the cold
 *  start, so it belongs in the cold-start figure and not the per-run one. */
export function noteKitSetupCost(ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) return;
  setupMs += ms;
}

/** The kit's own work on ONE request boundary, excluding the upload.
 *
 * THE FIRST RUN IS CHARGED TO THE COLD START, not to the per-run average.
 * Not a loophole — the opposite. The first time each of our boundary paths
 * runs it pays for itself: the code is compiled, the shapes are allocated, the
 * clocks are read for the first time. That cost is paid ONCE per instance, at
 * the cold start, which is exactly where a one-time cost belongs and exactly
 * how the customer is billed for it. Smearing it into an average that claims
 * to describe "each run" would misdescribe both figures: it makes the cold
 * start look cheaper than it is and every later run look dearer than it is,
 * and on an instance that served one request it makes a 40 ms cold-start
 * budget be judged against a 5 ms per-run one.
 *
 * Nothing is hidden by this: the first run's cost is published inside the
 * cold-start figure and judged against the cold-start ceiling, and until a
 * second run has happened the per-run figure says "not measured yet" rather
 * than a zero. `runsMeasured` still counts every run, so the denominator of
 * the published average is never quietly inflated.
 */
export function noteKitRunOverhead(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  runsMeasured++;
  if (firstRunMs === null) {
    firstRunMs = ms;
    return;
  }
  steadyRuns++;
  runOverheadTotalMs += ms;
  if (ms > runOverheadWorstMs) runOverheadWorstMs = ms;
  if (ms > KIT_PER_RUN_CEILING_MS) runsOverRunCeiling++;
}

/**
 * A run the host suspended in the middle of, thrown away rather than averaged
 * in — and COUNTED, so a discounted reading can be told from an untouched one.
 *
 * Thrown away whole, not trimmed. The kit's boundary work on one request is a
 * single synchronous stretch, so once the clock has jumped inside it there is
 * no honest remainder to keep: charging what is left would file a
 * near-zero-millisecond run and drag the published average DOWN, which is the
 * same lie in the other direction. `runsMeasured` does not count it either —
 * it was not measured. The two numbers side by side say how many runs happened
 * and how many of them the host ruined.
 */
export function noteKitRunDiscounted(ms: number): void {
  suspendDiscounts++;
  if (Number.isFinite(ms) && ms > suspendWorstMs) suspendWorstMs = ms;
}

/** The kit cut back on its own work to stay under a ceiling. Counted and
 *  published: a ceiling held by quietly doing less is only honest if the doing
 *  less is visible. */
export function noteKitReduced(): void {
  reducedSteps++;
}

/* ─── Reading the footprint ─────────────────────────────────────────────── */

export interface KitFootprint {
  /** Everything the kit added before the app served its first request. */
  readonly coldAddMs: number;
  /** Of that, the kit's own module loading. */
  readonly moduleEvalMs: number;
  /** Of that, the kit's own setup work. */
  readonly setupMs: number;
  /** How far into process boot the kit started loading. Context for a reader
   *  wondering whether a slow cold start is ours or the runtime's. */
  readonly startedAtUptimeMs: number;
  /** Of the cold-start figure, the first run's own boundary work — the part
   *  paid once, on the run that warmed our code paths. Null until a run has
   *  been measured. */
  readonly firstRunMs: number | null;
  /** The average run AFTER the first. Null — never zero — until a second run
   *  has happened, because one run measures the warm-up, not the steady cost. */
  readonly runAddAvgMs: number | null;
  /** The worst run after the first, on the same footing as the average. */
  readonly runAddWorstMs: number | null;
  readonly runsMeasured: number;
  /** Of the runs after the first, how many cost more than the per-run ceiling
   *  on their own. Published beside the worst so a single 97 ms run behind a
   *  garbage collection can be told from a cost we pay all the time. */
  readonly runsOverRunCeiling: number;
  readonly reducedSteps: number;
  /** Runs the host suspended inside, discounted rather than charged to us.
   *  Reported the way every other suspend-aware reading reports its own. */
  readonly suspendDiscounts: number;
  /** The longest discounted run, ms — what the average would have been told
   *  had the discount not happened. Null when nothing was discounted. */
  readonly suspendWorstMs: number | null;
  /** True while the kit is over one of its own stated ceilings. */
  readonly overCeiling: boolean;
  /** How much of the nearest stated ceiling is used, as a percentage of it —
   *  the worst of cold-start-against-40ms and per-run-against-5ms. This is the
   *  number the score is derived from, published so the tile can say the score
   *  measures PROXIMITY rather than leaving "0 over ceiling" beside "poor"
   *  for a reader to reconcile. */
  readonly ceilingUsePct: number;
  /** At or past the warning share of a ceiling, but not over it. The state
   *  that had no name: not a breach, not fine either. */
  readonly nearCeiling: boolean;
}

const round2 = (ms: number): number => Math.round(ms * 100) / 100;

export function readKitFootprint(): KitFootprint {
  const modEval = moduleEvalMs ?? 0;
  const first = firstRunMs ?? 0;
  // The first run's warm-up sits with the other once-per-instance costs, and
  // is judged against the cold-start ceiling it is actually part of.
  const coldAdd = modEval + setupMs + first;
  const runAvg = steadyRuns > 0 ? runOverheadTotalMs / steadyRuns : null;
  // Each figure as a share of the ceiling it is judged against, and the worst
  // of the two — the same quantity the server scores, computed here so one
  // number decides the score, the warning and the words on the tile.
  const coldUsePct = (coldAdd / KIT_COLD_START_CEILING_MS) * 100;
  const runUsePct =
    runAvg === null ? null : (runAvg / KIT_PER_RUN_CEILING_MS) * 100;
  const usePct = runUsePct === null ? coldUsePct : Math.max(coldUsePct, runUsePct);
  const over =
    coldAdd > KIT_COLD_START_CEILING_MS ||
    (runAvg !== null && runAvg > KIT_PER_RUN_CEILING_MS);
  return {
    coldAddMs: round2(coldAdd),
    moduleEvalMs: round2(modEval),
    setupMs: round2(setupMs),
    startedAtUptimeMs: Math.round(KIT_EVAL_START_UPTIME_MS),
    firstRunMs: firstRunMs === null ? null : round2(firstRunMs),
    runAddAvgMs: runAvg === null ? null : round2(runAvg),
    runAddWorstMs: steadyRuns > 0 ? round2(runOverheadWorstMs) : null,
    runsMeasured,
    runsOverRunCeiling,
    reducedSteps,
    suspendDiscounts,
    suspendWorstMs: suspendDiscounts > 0 ? round2(suspendWorstMs) : null,
    overCeiling: over,
    ceilingUsePct: Math.round(usePct * 10) / 10,
    // Approaching is a state of its own, and it is only approaching while it
    // is not yet a breach — the two must never both be true, or a surface has
    // to guess which one to say.
    nearCeiling: !over && usePct >= KIT_CEILING_WARN_PCT,
  };
}

/**
 * Should the kit do LESS right now?
 *
 * Read at the two places the kit's own cost is discretionary — the extra
 * memory sampling, and pushing a whole meter page rather than a small batch.
 * The contract is that the kit gives up its own optional work before it goes
 * past a ceiling it published, so the stated number stays true rather than
 * becoming an aspiration with an asterisk.
 *
 * Deliberately reads the AVERAGE per-run cost, not the worst: one unlucky run
 * behind a garbage collection is not a reason to blind the customer's
 * measurements for the rest of the instance's life.
 *
 * APPROACHING COUNTS, AND ONLY FOR THE PER-RUN FIGURE. Waiting for a strict
 * breach means the promise is already broken before anything defends it, so
 * the per-run ceiling is defended from the warning share up. The cold start is
 * deliberately NOT part of this question: it has already been paid by the time
 * anything can read it, so cutting back later work does not reclaim a
 * millisecond of it — it would only blind the customer's measurements to
 * apologise for a cost that is already spent. The cold start's warning goes to
 * a maintainer (see `nearCeiling`) rather than changing what the kit does.
 */
export function kitShouldReduce(): boolean {
  const f = readKitFootprint();
  if (f.overCeiling) return true;
  return (
    f.runAddAvgMs !== null &&
    (f.runAddAvgMs / KIT_PER_RUN_CEILING_MS) * 100 >= KIT_CEILING_WARN_PCT
  );
}

/**
 * The kit's own boundary work for ONE run.
 *
 * A handle rather than a module variable, for the same reason a run's own
 * boundary is: a host may have several requests in flight at once, and a single
 * shared accumulator would charge one request's work to whichever request
 * happened to close first — then file nothing at all for the others, dividing
 * the published average by a denominator that undercounts.
 */
export interface KitRun {
  ms: number;
  filed: boolean;
  /** The host stopped running us inside at least one stretch charged to this
   *  run, so the run's wall-clock total describes the platform's nap and not
   *  our work. Filed as a discount instead of an average. */
  suspendTouched: boolean;
}

/** Open a fresh accumulator for one run. */
export function openKitRun(): KitRun {
  return { ms: 0, filed: false, suspendTouched: false };
}

/** The accumulator used by callers that hand no handle over. Hand-wired
 *  adapters exist and must keep working; a host that overlaps requests is
 *  exactly why our own two boundaries carry a handle. */
let looseRun: KitRun | null = null;

function targetRun(run?: KitRun | null): KitRun {
  if (run) return run;
  if (!looseRun) looseRun = openKitRun();
  return looseRun;
}

/** Time a synchronous block and charge it to a run. Returns whatever the block
 *  returns; a throw is re-thrown after the cost is still recorded, because work
 *  that failed halfway was still paid for.
 *
 *  Charging ACCUMULATES rather than files: the kit touches a run's boundary in
 *  more than one place, and filing each of those separately would count one run
 *  as several and quietly divide the published average by however many hooks
 *  the kit happens to have. `closeRunOverhead` files the run exactly once. */
export function chargeRunOverhead<T>(fn: () => T, run?: KitRun | null): T {
  const target = targetRun(run);
  const open = openKitInterval();
  try {
    return fn();
  } finally {
    chargeKitInterval(open, target);
  }
}

/**
 * The two ends of one measured stretch of the kit's own work, for a caller that
 * times a block it cannot wrap in a callback.
 *
 * Both clocks are read at each end: the wall clock the ceiling is judged
 * against, and the processor clock that says whether the host was actually
 * running us for that wall time. The processor read is deliberately taken
 * OUTSIDE the wall window at each end (before `t0`, after `t1`), so asking the
 * question never adds to the answer.
 */
export interface KitInterval {
  readonly cpu0: number | null;
  readonly t0: number;
}

/** Begin timing a stretch of the kit's own boundary work. */
export function openKitInterval(): KitInterval {
  const cpu0 = cpuMs();
  return { cpu0, t0: now() };
}

/**
 * End it and charge it to a run — unless the host stopped running us inside it,
 * in which case the whole run is marked for discount instead.
 *
 * Marking the RUN rather than dropping the stretch is the honest choice: a run
 * whose boundary work straddled a suspend has no trustworthy remainder, and
 * filing what is left would report a run that cost us almost nothing.
 */
export function chargeKitInterval(
  interval: KitInterval,
  run?: KitRun | null,
): void {
  const t1 = now();
  const cpu1 = cpuMs();
  const target = targetRun(run);
  const wallMs = Math.max(0, t1 - interval.t0);
  const consumed =
    interval.cpu0 !== null && cpu1 !== null
      ? Math.max(0, cpu1 - interval.cpu0)
      : null;
  if (
    hostStoppedRunningUs({
      endedAtMs: Date.now(),
      wallMs,
      cpuMs: consumed,
    })
  ) {
    target.suspendTouched = true;
  }
  target.ms += wallMs;
}

/** Charge time already measured elsewhere to a run — for a hand-wired adapter
 *  that times its own work and hands over only a duration.
 *
 *  Judged on what a bare duration can be judged on: a stretch that overlapped a
 *  wake window, or one longer than the host's own suspicious-idle floor, is
 *  still discounted. The processor clause cannot apply — there is no processor
 *  reading to compare against — so a caller that can use `openKitInterval` /
 *  `chargeKitInterval` should, and our own two boundaries do. */
export function addRunOverheadMs(ms: number, run?: KitRun | null): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const target = targetRun(run);
  if (hostStoppedRunningUs({ endedAtMs: Date.now(), wallMs: ms, cpuMs: null })) {
    target.suspendTouched = true;
  }
  target.ms += ms;
}

/** File everything charged to this run as ONE run. Called when the run's books
 *  are closed, BEFORE the upload — the upload has its own budget and its own
 *  published number, and mixing the two would put a network call inside a
 *  ceiling that is about instrumentation.
 *
 *  Idempotent per run: the host fires more than one end-of-response event and
 *  both reach us, and a run counted twice halves the average the kit publishes
 *  a ceiling against. */
export function closeRunOverhead(run?: KitRun | null): void {
  const target = run ?? looseRun;
  if (!target || target.filed) return;
  target.filed = true;
  if (target.suspendTouched) noteKitRunDiscounted(target.ms);
  else noteKitRunOverhead(target.ms);
  target.ms = 0;
  target.suspendTouched = false;
  if (target === looseRun) looseRun = null;
}

/** Test seam. `moduleEvalMs` is deliberately resettable to null so a test can
 *  assert the once-only contract. */
export function _resetKitFootprintForTests(): void {
  moduleEvalMs = null;
  setupMs = 0;
  runOverheadTotalMs = 0;
  runOverheadWorstMs = 0;
  runsMeasured = 0;
  runsOverRunCeiling = 0;
  reducedSteps = 0;
  firstRunMs = null;
  steadyRuns = 0;
  suspendDiscounts = 0;
  suspendWorstMs = 0;
  looseRun = null;
}
