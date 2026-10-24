/* ─── Boosthis: attaching to the job systems an app already uses ───────────
 *
 * The background-work meter can always be driven by hand, but a developer who
 * has to wrap every job themselves will wrap the three they remember and miss
 * the twelve that matter. This module finds the job systems the app ALREADY
 * loaded and measures their runs without a line of wiring.
 *
 * THE RULE THIS MODULE OBEYS ABOVE ALL OTHERS: never load anything the app did
 * not choose itself. Every check here reads Node's module cache and pulls back
 * an object that is ALREADY there. Nothing is `require`d, nothing is resolved
 * from disk, and an app with no queue library pays nothing but a cache scan.
 * Pulling in a queue library on the customer's behalf would change what their
 * process does, which is not a meter's job.
 *
 * WHAT IT ATTACHES TO, and why those:
 *   • bullmq    — the Redis-backed queue most Node back ends reach for.
 *   • pg-boss   — the same idea on Postgres, for a project that already has one
 *                 database and does not want a second.
 *   • node-cron — the in-process scheduler, for work with no queue at all.
 *
 * WHAT IT REFUSES TO GUESS AT. Several widely used job systems have no single
 * call every run passes through, or invoke the handler in a child process this
 * kit is not inside. Those are listed as blind spots rather than quietly
 * skipped: the count travels with the reading, so a project running everything
 * through one of them shows "cannot tell" instead of a confident, wrong "no
 * background work". Being visibly blind is the whole point — the failure this
 * meter exists to prevent is an empty dashboard read as a healthy one.
 *
 * CRASH SAFETY. Every wrapper calls the host's original function and returns
 * its result untouched, and every line of measurement sits inside its own
 * try/catch. If anything in here throws, the customer's job still runs.
 */

import { createRequire } from "node:module";

import { isBoosthisDisabled } from "./runtimeFlags";
import { isKitLocked } from "./killSwitch";
import {
  beginJob,
  noteJobSystemAttached,
  noteJobSystemUnattached,
  runInsideMeasuredJob,
  type JobRun,
} from "./jobWork";

/** How long before a failed arming attempt is retried. A job library required
 *  lazily on first use should still be caught, without rescanning the module
 *  cache on every run. */
const ARM_RETRY_MS = 30_000;

/**
 * Job systems this kit knows how to watch: the package, and the module-cache
 * entries that prove the host already loaded it.
 *
 * SEVERAL FILES PER SYSTEM, because a library's own layout changes between
 * major versions and a single hard-coded path is a meter that quietly dies on
 * upgrade day. Every candidate below is a real published entry point.
 *
 * AND THE LIMIT THAT MATTERS MOST. Everything here reads the CommonJS module
 * registry, which is the only registry of loaded modules Node exposes. What
 * decides whether a library is in it is not how the library was PUBLISHED but
 * how the app REACHED it:
 *
 *   • An app that reaches a library with `require()` puts it there, and it is
 *     watched. On a recent Node that now includes libraries published as ESM
 *     only, because `require()` of an ESM module is supported and lands it in
 *     the same registry as everything else. Several of the queue libraries
 *     here are in exactly that position.
 *
 *   • An app that reaches it with `import` does not. The module namespace is
 *     frozen and there is no registry to look it up in. That is not a bug to
 *     be worked around: reaching into it would mean installing a loader hook
 *     and changing how the customer's whole program resolves modules, in order
 *     to measure it.
 *
 * So the same library can be watched in one project and invisible in the next.
 * The honest half is that {@link armJobSystems} still NOTICES an unreachable
 * one wherever the package left crumbs in the registry — its package.json, its
 * CommonJS dependencies — and counts it as a visible blind spot, so the
 * developer is told to mark those jobs by hand rather than shown a confident
 * zero. Where even the crumbs are absent, nothing is claimed either way: the
 * project simply has no automatic attachment, and its jobs are whatever it
 * marked by hand.
 */
const WATCHABLE_JOB_SYSTEMS: ReadonlyArray<{
  name: string;
  files: readonly string[];
}> = [
  { name: "bullmq", files: ["/node_modules/bullmq/dist/cjs/index.js"] },
  {
    name: "pg-boss",
    // v9–v10 ship CommonJS from src/. v11+ publishes ESM only, from dist/ —
    // which a CommonJS app on a recent Node still reaches, because `require()`
    // of an ESM module is supported there and puts the module in the same
    // registry everything else lands in. An app that reaches it with `import`
    // does not, and is counted as a blind spot instead.
    files: [
      "/node_modules/pg-boss/src/index.js",
      "/node_modules/pg-boss/dist/index.js",
    ],
  },
  {
    name: "node-cron",
    // v4 publishes both, and a CommonJS app gets the .cjs build. v3 shipped
    // CommonJS from src/.
    files: [
      "/node_modules/node-cron/dist/node-cron.cjs",
      "/node_modules/node-cron/dist/cjs/index.js",
      "/node_modules/node-cron/src/node-cron.js",
    ],
  },
];

/**
 * Job systems this kit KNOWS about and has no safe funnel for.
 *
 * Each entry is a real blind spot in an app that loaded it, and the honest
 * half of the bargain: the count ships beside the reading so the tile says
 * "some of this app's background work is invisible to us" instead of drawing a
 * clean picture from whatever it happened to catch.
 */
const UNWATCHABLE_JOB_SYSTEMS: readonly string[] = [
  // Runs each job in a CHILD PROCESS. The kit in the parent is not inside the
  // process doing the work, so there is nothing here to time.
  "bree",
  // The handler is registered through several equally valid entry points with
  // no single call every run passes through.
  "agenda",
  "bee-queue",
  "graphile-worker",
  // The scheduler is constructed with the callback already inside it, so by
  // the time anything is on a prototype the function is out of reach.
  "croner",
  "toad-scheduler",
  "node-schedule",
  // The original Bull. Superseded by bullmq, still widely deployed.
  "bull",
];

/* ── Reading the host's module cache (never loading) ─────────────────────── */

let hostRequire: NodeRequire | null | undefined;

function moduleCache(): Record<string, NodeModule> | null {
  if (hostRequire === undefined) {
    hostRequire = null;
    try {
      // STATIC import of node:module, deliberately — this kit ships as ESM,
      // where a lazy require() throws on every real install and leaves the
      // meter silently dead while every unit test passes.
      const cwd = typeof process?.cwd === "function" ? process.cwd() : "";
      if (cwd) hostRequire = createRequire(`${cwd}/boosthis-job-work.cjs`);
    } catch {
      hostRequire = null;
    }
  }
  try {
    const cache = hostRequire?.cache;
    return cache ? (cache as unknown as Record<string, NodeModule>) : null;
  } catch {
    return null;
  }
}

function normalizeKey(key: string): string {
  return key.replace(/\\/g, "/");
}

/** The module-cache paths that could belong to one watchable system. */
function filesFor(name: string): readonly string[] {
  return WATCHABLE_JOB_SYSTEMS.find((s) => s.name === name)?.files ?? [];
}

/** The already-loaded module whose path ends with one of `suffixes`, or null.
 *  Reads the host's cache; never loads anything. */
function cachedExports(
  suffixes: readonly string[],
): Record<string, unknown> | null {
  const cache = moduleCache();
  if (!cache) return null;
  try {
    for (const key of Object.keys(cache)) {
      const norm = normalizeKey(key);
      if (!suffixes.some((s) => norm.endsWith(s))) continue;
      const mod = cache[key];
      const exp = mod?.exports as Record<string, unknown> | undefined;
      return exp && typeof exp === "object" ? exp : null;
    }
  } catch {
    /* a hostile or exotic cache object is simply "not found" */
  }
  return null;
}

/** Has the host loaded any file belonging to package `name`? Directory-segment
 *  match, so `bull` never answers for `bullmq`. */
function packageIsLoaded(name: string): boolean {
  const cache = moduleCache();
  if (!cache) return false;
  const needle = `/node_modules/${name}/`;
  try {
    for (const key of Object.keys(cache)) {
      if (normalizeKey(key).includes(needle)) return true;
    }
  } catch {
    /* an unreadable cache is "nothing loaded" */
  }
  return false;
}

/* ── Patch bookkeeping ───────────────────────────────────────────────────── */

const installed: Record<string, boolean> = {};
/** [system, owner, attribute, original, wrapper]. The WRAPPER is kept so a
 *  restore can check ours is still the callable in place before putting the
 *  original back — writing over a library that patched on top of us would
 *  silently delete THEIR work. */
const patches: Array<
  [string, Record<string, unknown>, string, unknown, unknown]
> = [];

let armAttempted = false;
let lastArmAt = 0;
let active = false;

/**
 * Every surface of a loaded module that carries a callable `attr`.
 *
 * A library published for both module systems is almost always bundled so that
 * the same function is reachable twice — once on the exports object and once
 * on the `default` the transpiler adds for interop — and WHICH ONE the app
 * calls depends on how the app imported it. Patching only one of them is a
 * meter that works for half its users and dies silently for the other half,
 * with nothing anywhere to say which half a project is in. So both are
 * patched, and the two are deduplicated in case they are the same object.
 */
function surfacesFor(
  exp: Record<string, unknown> | undefined,
  attr: string,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const consider = (o: unknown): void => {
    if (!o || (typeof o !== "object" && typeof o !== "function")) return;
    const owner = o as Record<string, unknown>;
    if (typeof owner[attr] !== "function") return;
    if (out.includes(owner)) return;
    out.push(owner);
  };
  consider(exp);
  consider(exp?.default);
  return out;
}

/**
 * Put the wrapper in place on every surface, and record the attachment — but
 * only where the write actually took.
 *
 * A bundled library can expose its functions through a getter with no setter,
 * and assigning to one of those is silently ignored outside strict mode.
 * Claiming an attachment that did not happen is the worst outcome available
 * here: the tile would say "watched automatically" while nothing was being
 * measured, which is the exact failure this whole meter exists to prevent.
 * Returns false when no surface would take the wrapper, so the caller can fall
 * through to counting it as a blind spot.
 */
function remember(
  system: string,
  owners: Array<Record<string, unknown>>,
  attr: string,
  make: (original: (this: unknown, ...a: unknown[]) => unknown) => unknown,
): boolean {
  let took = false;
  for (const owner of owners) {
    try {
      const original = owner[attr];
      if (typeof original !== "function") continue;
      const wrapper = make(original as (this: unknown, ...a: unknown[]) => unknown);
      owner[attr] = wrapper;
      if (owner[attr] !== wrapper) continue;
      patches.push([system, owner, attr, original, wrapper]);
      took = true;
    } catch {
      /* try the next surface — one refusal is not the whole library */
    }
  }
  if (!took) return false;
  installed[system] = true;
  noteJobSystemAttached(system);
  return true;
}

/** Close a run from whatever the host's function returned: a promise settles
 *  the run when it settles, anything else closes it immediately. The host's
 *  own value is always handed straight back. */
function closeWith<T>(run: JobRun, out: T): T {
  const maybe = out as unknown as { then?: unknown; catch?: unknown };
  if (maybe && typeof maybe.then === "function") {
    return (out as unknown as Promise<unknown>).then(
      (value) => {
        run.done();
        return value;
      },
      (err: unknown) => {
        run.failed(err);
        throw err;
      },
    ) as unknown as T;
  }
  run.done();
  return out;
}

/** Invoke the host while marking nested by-hand measurements as duplicates.
 * A synchronous throw has no return value for closeWith() to observe, so it
 * must be closed here before the exact same host error continues outward. */
function invokeMeasured<T>(run: JobRun | null, fn: () => T): T {
  let out: T;
  try {
    out = runInsideMeasuredJob(fn, run);
  } catch (error) {
    if (run) {
      try {
        run.failed(error);
      } catch {
        /* measurement must not replace the host's error */
      }
    }
    throw error;
  }
  if (!run) return out;
  try {
    return closeWith(run, out);
  } catch {
    return out;
  }
}

/* ── bullmq ──────────────────────────────────────────────────────────────── */

/**
 * BullMQ hands every run through `Worker.prototype.callProcessJob`, which is
 * the one method that actually invokes the app's processor and REJECTS when it
 * throws. Its sibling `processJob` is deliberately not used: it catches the
 * failure itself to drive its retry bookkeeping, so a job measured there would
 * record every crash as a success.
 *
 * The job object carries everything the queue knows and this meter wants:
 * `name` (code-defined), `attemptsMade` (which retry this is), and the two
 * numbers that say when the job became READY — `timestamp` (when it was added)
 * plus `delay` (how long it was deliberately held back; a repeatable job's next
 * slot is set the same way). The queue wait nothing else can show is counted
 * from their sum, so a job asked to wait an hour does not read as an hour
 * behind. A RETRY reports no wait: the job object does not say when its
 * backoff ran out, and counting from the first add would file the backoff as
 * queue wait. The job's DATA is never touched.
 */
/**
 * When a BullMQ job became ready to run, or NaN when that cannot be read.
 *
 * NaN rather than undefined on purpose: a ready time that was looked for and
 * not found must report no wait, never fall back to a creation time.
 */
export function bullmqReadyAtMs(
  j: {
    timestamp?: unknown;
    delay?: unknown;
    opts?: { delay?: unknown } | null;
  } | null,
  attempt: number,
): number {
  if (attempt > 1) return Number.NaN;
  const added = j?.timestamp;
  if (typeof added !== "number" || !Number.isFinite(added)) return Number.NaN;
  const delay =
    typeof j?.delay === "number"
      ? j.delay
      : typeof j?.opts?.delay === "number"
        ? j.opts.delay
        : Number.NaN;
  if (!Number.isFinite(delay) || delay < 0) return Number.NaN;
  return added + delay;
}

function installBullmq(): boolean {
  try {
    const exp = cachedExports(filesFor("bullmq"));
    const Worker = exp?.Worker as { prototype?: Record<string, unknown> } | undefined;
    const proto = Worker?.prototype;
    if (!proto) return false;
    const original = proto.callProcessJob;
    if (typeof original !== "function") return false;

    const call = original as (
      this: unknown,
      job: unknown,
      token: unknown,
    ) => unknown;
    const wrapper = function (
      this: unknown,
      job: unknown,
      token: unknown,
    ): unknown {
      let run: JobRun | null = null;
      try {
        const j = job as
          | {
              name?: unknown;
              timestamp?: unknown;
              delay?: unknown;
              opts?: { delay?: unknown } | null;
              attemptsMade?: unknown;
            }
          | null;
        const name = typeof j?.name === "string" ? j.name : "bullmq";
        const attempt =
          typeof j?.attemptsMade === "number" ? j.attemptsMade + 1 : 1;
        run = beginJob(name, {
          system: "bullmq",
          readyAtMs: bullmqReadyAtMs(j, attempt),
          attempt,
        });
      } catch {
        run = null;
      }
      return invokeMeasured(run, () => call.call(this, job, token));
    };
    return remember("bullmq", [proto], "callProcessJob", () => wrapper);
  } catch {
    return false;
  }
}

/* ── pg-boss ─────────────────────────────────────────────────────────────── */

/**
 * pg-boss registers a handler through `work(name, [options], handler)`. We
 * replace the handler the app passed with one that measures the run around it,
 * so nothing about the registration changes.
 *
 * A batch arrives as an array of jobs. It is measured as ONE run — that is
 * what the app's handler actually is, one invocation — and waited from the
 * EARLIEST moment any member became ready, because the batch waited at least
 * that long. `retryCount` gives the attempt.
 *
 * Ready means `startAfter`, never `createdOn`: pg-boss sets it from a send's
 * deliberate delay, from a schedule's slot, and from a retry's backoff, so it
 * is the one field that excludes every wait the app planned. A batch with ANY
 * member whose `startAfter` cannot be read reports no wait at all — the
 * creation time is not a stand-in, because a delayed member would then count
 * its delay as queue wait.
 */
/** One pg-boss date field as epoch ms, or NaN. */
function pgBossTime(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") return Date.parse(v);
  return Number.NaN;
}

/**
 * When a pg-boss batch became ready to run — its earliest member's
 * `startAfter` — or NaN when any member's cannot be read.
 */
export function pgBossReadyAtMs(jobs: readonly unknown[]): number {
  let ready = Number.NaN;
  if (jobs.length === 0) return ready;
  for (const raw of jobs) {
    const at = pgBossTime((raw as { startAfter?: unknown } | null)?.startAfter);
    if (!Number.isFinite(at)) return Number.NaN;
    if (!(ready <= at)) ready = at;
  }
  return ready;
}

function installPgBoss(): boolean {
  try {
    const exp = cachedExports(filesFor("pg-boss"));
    // The class sits in a different place in each generation: a named export
    // on the current builds, the default export on the transpiled ones, and
    // the module itself on the old CommonJS ones. All three are checked
    // because guessing one and missing is a meter that reports nothing while
    // looking perfectly healthy.
    const Boss = (exp?.PgBoss ?? exp?.default ?? exp) as
      | { prototype?: Record<string, unknown> }
      | undefined;
    const proto = Boss?.prototype;
    if (!proto || typeof proto.work !== "function") return false;

    const make = (call: (this: unknown, ...a: unknown[]) => unknown) =>
      function (this: unknown, ...args: unknown[]): unknown {
      try {
        const last = args.length - 1;
        const handler = args[last];
        const queueName = typeof args[0] === "string" ? args[0] : "pg-boss";
        if (last >= 1 && typeof handler === "function") {
          const fn = handler as (...a: unknown[]) => unknown;
          args[last] = function (this: unknown, ...jobArgs: unknown[]): unknown {
            let run: JobRun | null = null;
            try {
              const first = jobArgs[0];
              const jobs = Array.isArray(first) ? first : [first];
              let attempt = 1;
              for (const raw of jobs) {
                const j = raw as { retryCount?: unknown } | null;
                if (typeof j?.retryCount === "number") {
                  attempt = Math.max(attempt, j.retryCount + 1);
                }
              }
              run = beginJob(queueName, {
                system: "pg-boss",
                readyAtMs: pgBossReadyAtMs(jobs),
                attempt,
              });
            } catch {
              run = null;
            }
            return invokeMeasured(run, () => fn.apply(this, jobArgs));
          };
        }
      } catch {
        /* fall through and register exactly what the app passed */
      }
      return call.apply(this, args);
    };
    return remember("pg-boss", [proto], "work", make);
  } catch {
    return false;
  }
}

/* ── node-cron ───────────────────────────────────────────────────────────── */

/**
 * node-cron schedules through `schedule(expression, task, options)`. We replace
 * the task with a measured one.
 *
 * The NAME: `options.name` when the app gave one, otherwise the task
 * function's own name — both are code-defined. The cron EXPRESSION is
 * deliberately not used as a label; it is unreadable in a list and two
 * different jobs on the same schedule would merge into one row. A job with no
 * name at all is grouped under the scheduler's name, which is honest about the
 * fact that we cannot tell its runs apart.
 *
 * The cadence is not read from the expression: parsing cron syntax to predict
 * the next run is a second implementation of the scheduler, and a wrong one
 * would invent missing runs that never existed. The cadence learner watches
 * what actually happens instead, which for a cron job settles quickly because
 * its gaps are near-identical by construction.
 */
function installNodeCron(): boolean {
  try {
    const exp = cachedExports(filesFor("node-cron"));
    const owners = surfacesFor(exp ?? undefined, "schedule");
    if (owners.length === 0) return false;

    const make = (call: (this: unknown, ...a: unknown[]) => unknown) =>
      function (this: unknown, ...args: unknown[]): unknown {
      try {
        const task = args[1];
        if (typeof task === "function") {
          const fn = task as (...a: unknown[]) => unknown;
          const opts = args[2] as { name?: unknown } | undefined;
          const name =
            typeof opts?.name === "string" && opts.name.length > 0
              ? opts.name
              : typeof fn.name === "string" && fn.name.length > 0
                ? fn.name
                : "node-cron";
          args[1] = function (this: unknown, ...taskArgs: unknown[]): unknown {
            let run: JobRun | null = null;
            try {
              run = beginJob(name, { system: "node-cron" });
            } catch {
              run = null;
            }
            return invokeMeasured(run, () => fn.apply(this, taskArgs));
          };
        }
      } catch {
        /* fall through and schedule exactly what the app passed */
      }
      return call.apply(this, args);
    };
    return remember("node-cron", owners, "schedule", make);
  } catch {
    return false;
  }
}

/* ── Arming ──────────────────────────────────────────────────────────────── */

/**
 * Attach to whichever job systems this app has already loaded.
 *
 * Safe to call repeatedly and cheap after the first pass: the module-cache
 * scan is throttled, and a system already watched is skipped. Called both from
 * the request boundary and at kit start-up, because a worker process may never
 * serve a request at all. Never throws.
 */
export function armJobSystems(): void {
  if (isBoosthisDisabled() || isKitLocked()) return;
  try {
    const now = Date.now();
    if (armAttempted && now - lastArmAt < ARM_RETRY_MS) return;
    lastArmAt = now;
    armAttempted = true;
    active = true;
    for (const system of WATCHABLE_JOB_SYSTEMS) {
      if (installed[system.name]) continue;
      if (!cachedExports(system.files)) continue;
      if (system.name === "bullmq") installBullmq();
      else if (system.name === "pg-boss") installPgBoss();
      else if (system.name === "node-cron") installNodeCron();
    }
    // Recount blind spots on every pass: a library loaded lazily after the
    // first scan is a blind spot from the moment it appears.
    //
    // The test is PRESENCE, not reachability, and that difference is the whole
    // point. A library the app loaded as ESM leaves crumbs in the CommonJS
    // cache — its package.json, its CommonJS dependencies — but its own
    // exports are not there and cannot be patched. Asking only "could we get
    // at it?" would have counted that as nothing at all: no attachment, no
    // blind spot, and a project running every one of its jobs through it would
    // read as a project with no background work. Asking "is it here?" turns
    // the same situation into a visible "some of this is invisible to us".
    for (const system of WATCHABLE_JOB_SYSTEMS) {
      if (!installed[system.name] && packageIsLoaded(system.name)) {
        noteJobSystemUnattached(system.name);
      }
    }
    for (const name of UNWATCHABLE_JOB_SYSTEMS) {
      if (packageIsLoaded(name)) noteJobSystemUnattached(name);
    }
  } catch {
    /* arming must never disturb the host */
  }
}

/**
 * Put back every function we replaced and switch attachment off.
 *
 * A function is restored only while OUR wrapper is still the one in place, so
 * a library that patched on top of us keeps its work. Never throws.
 */
export function unpatchJobSystems(): void {
  active = false;
  try {
    for (const [name, owner, attr, original, wrapper] of patches.splice(0)) {
      try {
        if (owner[attr] === wrapper) owner[attr] = original;
      } catch {
        /* best-effort */
      }
      installed[name] = false;
    }
  } catch {
    /* best-effort */
  }
  armAttempted = false;
  lastArmAt = 0;
}

/** Is this kit currently attached to at least one job system on its own? Drives
 *  the kit's own "which situation is this project in" sentence. */
export function jobSystemsAttached(): boolean {
  if (!active) return false;
  for (const system of WATCHABLE_JOB_SYSTEMS) {
    if (installed[system.name]) return true;
  }
  return false;
}

/** @internal test hooks. */
export const _jobAdapterInternals = {
  WATCHABLE_JOB_SYSTEMS,
  UNWATCHABLE_JOB_SYSTEMS,
  installBullmq,
  installPgBoss,
  installNodeCron,
  closeWith,
  packageIsLoaded,
  cachedExports,
};
