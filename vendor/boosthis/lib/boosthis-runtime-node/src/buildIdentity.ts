/* ─── Boosthis: build-identity + patch-lag axis (Node) ───────────────────
 *
 * The cross-runtime "Patch Lag" meter. It reports how STALE the running build
 * is — the exposure window between when the code was built and now — so the
 * developer's AI can see that a long-running deployment is drifting away from
 * the latest source. It is NOT a security scanner: the axis reports LAG and
 * nothing else. It never implies the app is safe or patched.
 *
 * WIRE (matched byte-for-byte by the parallel server allowlist):
 *   - top-level `build` object: { commit?, buildTimeMs?, buildAgeMs? } — only
 *     the fields that are honestly known; the whole object is omitted when
 *     nothing is known. commit is validated lowercase hex (7..40); buildTimeMs
 *     is epoch ms; buildAgeMs is (now - buildTimeMs) clamped >= 0, frozen at
 *     capture time.
 *   - `patchLag` axis: emitted ONLY when buildTimeMs is known (honest absence
 *     otherwise — never a fake/warming axis). ageDays = buildAgeMs/86400000.
 *     rating: good <7d, needs-work <30d, else poor. score =
 *     round(clamp(100 - (ageDays/60)*100, 0, 100)). Additive + display-only —
 *     it NEVER feeds the Speed/overall score.
 *   - top-level `deps` array (OPT-IN, off by default): the app's dependency
 *     inventory, only when BOOSTHIS_DEP_INVENTORY=1.
 *
 * RESOLUTION PRECEDENCE (no fabrication, first known wins):
 *   a. Env overrides — BOOSTHIS_BUILD_COMMIT (validated hex 7..40, lowercased)
 *      and BOOSTHIS_BUILD_TIME (epoch ms if > 1e12, epoch seconds if numeric
 *      otherwise, or an ISO-8601 date string).
 *   b. Kit platform source — none beyond env for the Node kit.
 *   c. Fallback — buildTimeMs from the mtime of the process entry file.
 *
 * CAPTURE: frozen ONCE at telemetry-enable (like coldStart), so buildAgeMs is
 * the exposure window at capture and never grows into meaningless "uptime".
 *
 * PRIVACY: the axis + build object carry only a commit hash, epoch ms, and a
 * numeric age; deps carry public package names + versions (no PII). All ride
 * inside the existing snapshot upload and clear the same PII guard.
 */

import { statSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { linearScore, ratingFor } from "./healthAxes";
import { type Rating } from "./thresholds";

/** Patch-lag score decays linearly to 0 over 60 days of build age. */
const PATCH_LAG_FULL_DECAY_DAYS = 60;
const MS_PER_DAY = 86_400_000;
/** Rating band edges (build age in days). */
const PATCH_LAG_GOOD_DAYS = 7;
const PATCH_LAG_NEEDS_WORK_DAYS = 30;

/** Threshold above which BOOSTHIS_BUILD_TIME is read as epoch milliseconds
 *  (below, a numeric value is read as epoch seconds). */
const EPOCH_MS_THRESHOLD = 1e12;

/** Dependency inventory caps + validation (server-mirrored). */
const DEP_INVENTORY_CAP = 150;
const DEP_NAME_RE = /^[A-Za-z0-9@/._:-]{1,100}$/;
const DEP_VERSION_RE = /^[0-9][0-9A-Za-z._+-]{0,49}$/;

export interface BuildIdentity {
  commit?: string;
  buildTimeMs?: number;
  /** now - buildTimeMs at capture, clamped >= 0. */
  buildAgeMs?: number;
}

export interface DepEntry {
  name: string;
  version: string;
}

export interface PatchLagAxis {
  score: number | null;
  rating: Rating;
  buildAgeMs: number;
  buildTimeMs: number;
  /** Present only when the dependency-inventory opt-in is ON. */
  depCount?: number;
}

// ── Frozen capture state (set ONCE at enable, like coldStart) ────────────────
let captured = false;
let buildCommit: string | undefined;
let buildTimeMs: number | undefined;
let buildAgeMs: number | undefined;
let deps: DepEntry[] | undefined;

// Test seams (null = read live).
let envReaderOverride: ((key: string) => string | undefined) | null = null;
let entryFileOverride: string | null = null;
let nowOverride: number | null = null;

/** Read one env var through the override (tests) or process.env. Never throws. */
function readEnv(key: string): string | undefined {
  try {
    if (envReaderOverride) return envReaderOverride(key);
    if (typeof process !== "undefined" && process.env) return process.env[key];
  } catch {
    /* best-effort */
  }
  return undefined;
}

/** Current wall time (ms), honouring the test override. */
function nowMs(): number {
  return nowOverride ?? Date.now();
}

/** Validate + normalise a commit hash: lowercase hex, 7..40 chars. Returns the
 *  lowercased hash, or undefined for anything that isn't valid hex in range. */
export function normalizeCommit(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(v)) return undefined;
  return v;
}

/** Parse BOOSTHIS_BUILD_TIME: epoch ms (> 1e12), epoch seconds (numeric else),
 *  or an ISO-8601 date string. Returns epoch ms, or undefined when unparseable
 *  / non-finite / non-positive. */
export function parseBuildTime(raw: string | undefined): number | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  if (v === "") return undefined;
  // Reject a leading +/- sign: an epoch value is a plain positive number, and
  // Date.parse is too lenient about signed strings like "-5" (parses to a real
  // date). ISO-8601 dates never start with a sign.
  if (/^[+-]/.test(v)) return undefined;
  // Numeric — epoch ms if large, else epoch seconds.
  if (/^[0-9]+(\.[0-9]+)?$/.test(v)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    const ms = n > EPOCH_MS_THRESHOLD ? n : n * 1000;
    return Math.round(ms);
  }
  // ISO-8601 date string.
  const parsed = Date.parse(v);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

/** Resolve the process entry file (fallback source), honouring the override. */
function entryFile(): string | undefined {
  if (entryFileOverride !== null) return entryFileOverride || undefined;
  try {
    return require.main?.filename ?? process.argv[1];
  } catch {
    try {
      return process.argv[1];
    } catch {
      return undefined;
    }
  }
}

/** Fallback buildTimeMs: mtime of the process entry file. Never throws. */
function entryFileMtimeMs(): number | undefined {
  const file = entryFile();
  if (!file) return undefined;
  try {
    const st = statSync(file);
    const ms = st.mtimeMs;
    if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) {
      return Math.round(ms);
    }
  } catch {
    /* best-effort — an unreadable entry file leaves the fallback absent */
  }
  return undefined;
}

/** True when the dependency-inventory opt-in is ON (BOOSTHIS_DEP_INVENTORY=1). */
export function depInventoryEnabled(): boolean {
  return readEnv("BOOSTHIS_DEP_INVENTORY") === "1";
}

/** Find the app's nearest package.json walking UP from the entry file's dir.
 *  Returns the parsed manifest + its directory, or null. Never throws. */
function findNearestPackageJson(): { dir: string; manifest: unknown } | null {
  const file = entryFile();
  if (!file) return null;
  let dir: string;
  try {
    dir = dirname(file);
  } catch {
    return null;
  }
  // Bounded walk (a deep tree can't loop forever).
  for (let i = 0; i < 40; i++) {
    const candidate = join(dir, "package.json");
    try {
      const raw = readFileSync(candidate, "utf8");
      return { dir, manifest: JSON.parse(raw) };
    } catch {
      /* not here — walk up */
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  return null;
}

/** Build the dependency inventory: for each declared dependency, resolve its
 *  installed package.json version relative to the entry file. Skips any entry
 *  that fails to resolve/validate. Capped + sorted by name. Never throws. */
export function buildDepInventory(): DepEntry[] {
  const out: DepEntry[] = [];
  try {
    const found = findNearestPackageJson();
    if (!found) return out;
    const m = found.manifest as Record<string, unknown> | null;
    if (!m || typeof m !== "object") return out;
    const names = new Set<string>();
    for (const field of ["dependencies", "optionalDependencies"] as const) {
      const block = m[field];
      if (block && typeof block === "object") {
        for (const name of Object.keys(block as Record<string, unknown>)) {
          names.add(name);
        }
      }
    }
    for (const name of names) {
      if (!DEP_NAME_RE.test(name)) continue;
      let version: string | undefined;
      try {
        const pkgPath = require.resolve(`${name}/package.json`, {
          paths: [found.dir],
        });
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
          version?: unknown;
        };
        if (typeof pkg.version === "string") version = pkg.version.trim();
      } catch {
        continue; // unresolvable — skip silently
      }
      if (!version || !DEP_VERSION_RE.test(version)) continue;
      out.push({ name, version });
    }
  } catch {
    return [];
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out.slice(0, DEP_INVENTORY_CAP);
}

/** Capture the build identity ONCE and FREEZE it (like coldStart). Resolves the
 *  commit + build time by the fixed precedence, freezes buildAgeMs at this
 *  moment, and (when the opt-in is ON) snapshots the dependency inventory.
 *  IDEMPOTENT — a second call is a no-op. Guest-safe: never throws; on any
 *  failure the fields are simply omitted. Called from `enableTelemetry`. */
export function captureBuildIdentity(): void {
  if (captured) return;
  captured = true;
  try {
    // a. Env overrides.
    buildCommit = normalizeCommit(readEnv("BOOSTHIS_BUILD_COMMIT"));
    const envTime = parseBuildTime(readEnv("BOOSTHIS_BUILD_TIME"));
    // b. Platform source — none beyond env for the Node kit.
    // c. Fallback — process entry file mtime.
    buildTimeMs = envTime ?? entryFileMtimeMs();
    if (typeof buildTimeMs === "number") {
      buildAgeMs = Math.max(0, nowMs() - buildTimeMs);
    }
    if (depInventoryEnabled()) {
      deps = buildDepInventory();
    }
  } catch {
    /* best-effort — a failed capture omits the build fields, never fatal */
  }
}

/** The frozen top-level `build` object, or null when nothing is known (the
 *  snapshot then omits the whole object — never fabricates a field). */
export function readBuildIdentity(): BuildIdentity | null {
  const out: BuildIdentity = {};
  if (buildCommit) out.commit = buildCommit;
  if (typeof buildTimeMs === "number") out.buildTimeMs = buildTimeMs;
  if (typeof buildAgeMs === "number") out.buildAgeMs = buildAgeMs;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * A LOCAL name for the build this process is running — never uploaded.
 *
 * What counts as a release here is what already identifies a build to this
 * kit, in the precedence `captureBuildIdentity` already froze: the commit the
 * deploy declared, else the build time (declared, or read from the entry
 * file, which changes when a new build is deployed). The string is used only
 * to notice that it CHANGED, and the caller hashes it before storing it, so
 * neither the commit nor the build time survives anywhere a reading can reach.
 *
 * `null` when nothing identifies this build. A process that cannot name its
 * release counts nothing in releases rather than guessing — the same choice
 * the app-version block makes when a version cannot be read.
 */
export function readReleaseKey(): string | null {
  const build = readBuildIdentity();
  if (!build) return null;
  if (build.commit) return `c:${build.commit}`;
  if (typeof build.buildTimeMs === "number") return `t:${build.buildTimeMs}`;
  return null;
}

/** The frozen dependency inventory, or null when the opt-in is OFF / nothing
 *  was captured (the snapshot then omits the whole `deps` field). */
export function readDepInventory(): DepEntry[] | null {
  return deps ?? null;
}

/** The patch-lag axis, or null when buildTimeMs is unknown (honest absence —
 *  NEVER a fake/warming axis). Additive + display-only; never feeds Speed.
 *  Pure read — never mutates. Never throws. */
export function readPatchLag(): PatchLagAxis | null {
  try {
    if (typeof buildTimeMs !== "number" || typeof buildAgeMs !== "number") {
      return null;
    }
    const ageDays = buildAgeMs / MS_PER_DAY;
    // score = round(clamp(100 - (ageDays/60)*100, 0, 100)) — linearScore maps
    // 0 days -> 100 and PATCH_LAG_FULL_DECAY_DAYS -> 0, clamped, same formula.
    const score = linearScore(ageDays, 0, PATCH_LAG_FULL_DECAY_DAYS);
    const rating: Rating =
      ageDays < PATCH_LAG_GOOD_DAYS
        ? "good"
        : ageDays < PATCH_LAG_NEEDS_WORK_DAYS
          ? "needs-work"
          : "poor";
    const axis: PatchLagAxis = {
      score,
      rating,
      buildAgeMs,
      buildTimeMs,
    };
    if (deps) axis.depCount = deps.length;
    return axis;
  } catch {
    return null;
  }
}

/** Drop all build-identity state (wired into `telemetry.forget()` so nothing
 *  Boosthis-shaped survives erasure). Idempotent. Never throws. */
export function clearBuildIdentity(): void {
  captured = false;
  buildCommit = undefined;
  buildTimeMs = undefined;
  buildAgeMs = undefined;
  deps = undefined;
}

/** @internal test hooks — mirror the kit's _set*ForTests / _reset*ForTests
 *  pattern (env/entry-file/now injection + a hard reset). */
export const _buildIdentityInternals = {
  PATCH_LAG_FULL_DECAY_DAYS,
  PATCH_LAG_GOOD_DAYS,
  PATCH_LAG_NEEDS_WORK_DAYS,
  EPOCH_MS_THRESHOLD,
  DEP_INVENTORY_CAP,
  /** Inject an env reader (tests). null restores process.env. */
  setEnvReaderForTests(fn: ((key: string) => string | undefined) | null): void {
    envReaderOverride = fn;
  },
  /** Force the entry-file path (fallback-source tests). "" = no entry file;
   *  null restores the live require.main/argv resolution. */
  setEntryFileForTests(path: string | null): void {
    entryFileOverride = path;
  },
  /** Force the capture-time clock (deterministic buildAgeMs). null = live. */
  setNowForTests(ms: number | null): void {
    nowOverride = ms;
  },
  /** Trigger the ONCE-only frozen capture (same call enableTelemetry makes). */
  capture(): void {
    captureBuildIdentity();
  },
  get capturedBuildTimeMs(): number | undefined {
    return buildTimeMs;
  },
  get capturedCommit(): string | undefined {
    return buildCommit;
  },
  /** Reset ALL state + seams to hermetic defaults. */
  resetForTests(): void {
    clearBuildIdentity();
    envReaderOverride = null;
    entryFileOverride = null;
    nowOverride = null;
  },
};
