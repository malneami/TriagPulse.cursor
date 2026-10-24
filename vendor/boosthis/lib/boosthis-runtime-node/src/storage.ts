/** Tiny persistent key/value store for the Node runtime.
 *
 * The RN runtime persists candidate rules + baselines through a platform
 * storage abstraction (AsyncStorage). Node has no such platform, so we mirror
 * the Ruby, Rust, PHP, .NET and Elixir kits, which keep one directory per
 * application under a base the host can choose. State is kept in a single JSON
 * file so credentials, candidate recurrence and fix baselines survive a process
 * restart (a long-lived server may be restarted on deploy).
 *
 * ## Nothing writable
 *
 * A serverless function has no writable home directory, and on several hosts
 * the whole filesystem except one scratch directory is read-only. The store
 * therefore CHOOSES its backing at first use and says which one it picked:
 *
 *   1. `BOOSTHIS_STATE_DIR` when set (tests, and hosts that hand us a volume)
 *   2. `~/.boosthis` when the home directory is genuinely writable
 *   3. the OS scratch directory (`/tmp/.boosthis`) — survives for the life of
 *      a warm function instance, which is exactly as long as anything else in
 *      that instance survives
 *   4. memory only — the process still works; it simply forgets on exit
 *
 * The choice is probed by WRITING, not by reading a permission bit: a home
 * directory can exist, look writable and still refuse (read-only overlay).
 *
 * ## Several processes, one machine
 *
 * This file used to be ONE fixed path — `<base>/node-runtime-store.json` — for
 * every Node application on the machine, written with a plain whole-file
 * `writeFileSync` and no coordination of any kind. Two services sharing a
 * machine shared their install identity, their consent tokens and their crash
 * buffer; cluster workers of ONE app did the same by design, and each one's
 * whole-file write silently dropped every key the others had written since it
 * last read. A torn write read back as invalid JSON, which the loader treated
 * as "no state at all" — every credential simply gone, quietly.
 *
 * Three decisions replace that, and they are the isolation model the kit
 * documents (README, "Running several processes"):
 *
 *   • SCOPE — state lives in `<base>/boosthis-<scope>/`, where `<scope>` is a
 *     short hash of the application root (`BOOSTHIS_PROJECT_ROOT`, else the
 *     working directory). Two unrelated services on one machine therefore
 *     never meet. Every worker of ONE app resolves the SAME scope and shares
 *     one file on purpose: they are one install, they hold one project key,
 *     and splitting them would mint an install per worker. The naming matches
 *     the Ruby, Rust, PHP, .NET and Elixir kits exactly, so a polyglot app
 *     lands in one directory per application rather than one per language.
 *
 *   • ATOMIC — every write goes to a temp file in the same directory and is
 *     renamed over the target. A reader sees the whole old file or the whole
 *     new one; a half-written file is not a state this store can produce.
 *
 *   • MERGE UNDER A LOCK — a write re-reads what is on disk inside an
 *     interprocess lock and applies its own change to THAT, so a worker with a
 *     stale in-memory view can no longer drop a key another worker wrote. The
 *     lock is advisory and bounded: if it cannot be taken the write still
 *     happens (atomically, on freshly-read state), because losing a credential
 *     is worse than a rare lost update. `updateSync` exposes the whole
 *     read-modify-write to callers that need one, which is how the crash
 *     buffer keeps one process from eating another's crashes.
 *
 * ## An unreadable file is not an empty one
 *
 * Nothing in the kit may treat "the store was unreadable" as a reason to stop
 * measuring — the store is a cache, never an authority. But it must not read as
 * a fresh install either. A file that exists and cannot be parsed is set aside
 * (kept, not deleted) and reported; a file that exists and cannot be READ at
 * all switches durable state off for the run rather than overwriting state we
 * cannot see. Both say so on stderr, once, and through `storageStateLoss()`.
 * `storageDurable()` still exists so the paths that used to fail closed on an
 * unreadable cache can tell "we lost the answer" apart from "there was never
 * anywhere to keep it".
 */

import { createHash, randomBytes } from "node:crypto";
import { homedir, hostname, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  fstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";

/* ─── Which operating system is this? ─────────────────────────────────
 *
 * The one switch a suite uses to stand in for Windows or macOS on a Linux
 * machine: the store reads it here, and every reading reads it through
 * systemLimits.ts, so the two always agree about which system they are on.
 * It lives in this module because this module must load on its own — a
 * multi-process test runs it in a bare Node child that resolves no
 * extensionless import — so it imports nothing but Node's own modules. */
let platformForTests: NodeJS.Platform | null = null;

/** The operating system this process runs on. */
export function hostPlatform(): NodeJS.Platform {
  return platformForTests ?? process.platform;
}

/** @internal — simulate another operating system; null restores the real one. */
export function _setHostPlatformForTests(platform: NodeJS.Platform | null): void {
  platformForTests = platform;
}

/** Which backing the store settled on. Reported on the kit's own surfaces so a
 *  developer is never left guessing why a restart forgot everything. */
export type StorageBackend = "configured" | "home" | "scratch" | "memory";

/** Why the state that WAS on disk is not in this process.
 *
 *  `corrupt`    — the file existed and was not valid JSON. Set aside, so the
 *                 bytes are still there for a human, and this process starts
 *                 with nothing.
 *  `unreadable` — the file existed and could not be read at all (permissions,
 *                 a directory in its place). Left untouched: we will not write
 *                 over state we cannot see. */
export interface StorageStateLoss {
  kind: "corrupt" | "unreadable";
  /** The path that could not be used. */
  file: string;
  /** Where the unreadable bytes were moved, when they were moved. */
  setAsideAs?: string;
  /** The OS error code, when there was one. */
  code?: string;
  at: number;
}

const STORE_FILE = "node-runtime-store.json";
const LOCK_FILE = "node-runtime-store.lock";
/** One directory per application, named the same way in every kit that keeps
 *  state on disk. */
const DIR_PREFIX = "boosthis-";

/** How long a write that would rather MISS its update (see `requireLock`)
 *  waits for the interprocess lock. A write is a read plus a rename —
 *  microseconds — so anything near this bound means contention, not slowness. */
const LOCK_WAIT_MS = 500;
/** A lock file older than this is presumed abandoned by a process that died
 *  holding it, and is broken. Must be comfortably longer than any real hold. */
const LOCK_STALE_MS = 3_000;
/** How long every other write waits: until the holder releases, or until its
 *  lock is old enough to be broken as abandoned. Every write replaces the
 *  WHOLE file, so one that went ahead beside a live holder would publish a
 *  copy erasing that holder's change (or have its own erased). Only a sibling
 *  frozen mid-write ever makes a write wait this long. */
const LOCK_WAIT_ORDINARY_MS = LOCK_STALE_MS + 250;

let backend: StorageBackend | null = null;
let resolvedBase: string | null = null;
let resolvedDir: string | null = null;
/** Does the settled backing actually accept a write? Probed once, alongside
 *  the backing itself. `false` for memory, and for a configured directory the
 *  host named but cannot write. */
let backingUsable = false;
/** Set when the state file exists but cannot be read: we then refuse to write
 *  over it for the rest of the process. */
let writesRefused = false;
let stateLoss: StorageStateLoss | null = null;
let lossAnnounced = false;
let appRootMemo: string | null = null;
let scopeMemo: string | null = null;
/** True only when the current view came from an existing on-disk document.
 * Memory fallback must never be reported as a restored install. */
let restoredFromDisk = false;
let restoredKeys = new Set<string>();
let writeDegraded = false;

// The crash lineage has a lock of its own, beside the store lock: the erase
// generation, every crash write and every crash upload are admitted under it,
// and the store writes inside take the store lock as usual.
//
// It used to be taken by running the `flock` program. Windows has no such
// program, and nor do many minimal Linux images, so on those hosts every crash
// was refused and dropped. It is now the same kind of lock the store uses — an
// exclusive create, which works on every system Node and Bun run on — kept
// under its OWN file name, so a kit from before cannot open it and flock it.
// What is the same as before: a bounded wait, a holder broken only when it is
// provably gone (see `holderNamedBy`), and nothing written or uploaded without it.
const CRASH_LOCK_FILE = "node-crash.lock";
const CRASH_GENERATION = "node-crash-generation";
/** How long a crash pass waits for a sibling holding the crash lock. A holder
 *  that is still running when this runs out is never broken: the pass is
 *  skipped, and the caller's next pass tries again. */
const CRASH_LOCK_WAIT_MS = 500;
let crashGeneration: string | undefined;
let crashGuardDepth = 0;
let crashGuardWarned = false;

function crashGuardFailure(): void {
  if (crashGuardWarned) return;
  crashGuardWarned = true;
  console.warn("[boosthis] Crash state refused: the shared crash lock or erase generation could not be used. Crashes are dropped, not written or uploaded without coordination. A writable state directory is required.");
}

/** Synchronous upload admission and spool transactions share this lock.
 * The callback may START an asynchronous request, but must not defer admission.
 * An erased sibling remains revoked until it is restarted. */
export function withCrashGeneration<T>(apply: () => T): T | undefined {
  return crashTransaction(false, apply);
}

function crashTransaction<T>(erase: boolean, apply: () => T): T | undefined {
  if (crashGuardDepth > 0 && !erase) return apply();
  let fd: number | null = null;
  let lockPath: string | null = null;
  try {
    const dir = stateDir();
    if (!dir || !backingUsable || writesRefused) throw new Error("no durable crash state");
    if (crashGuardDepth === 0) {
      lockPath = join(dir, CRASH_LOCK_FILE);
      const got = acquireCrashLock(lockPath, CRASH_LOCK_WAIT_MS);
      // A sibling that is still running holds it past the wait: skip this
      // pass rather than force it. Not a failure of the guard, so no warning;
      // every caller already treats "not applied" as "try again later".
      if (got === "busy") return undefined;
      if (got === null) throw new Error("crash lock unavailable");
      fd = got;
    }
    const generationFile = join(dir, CRASH_GENERATION);
    let generation = "0";
    try {
      generation = readFileSync(generationFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!/^(0|[0-9a-f]{32})$/.test(generation)) throw new Error("invalid generation");
    if (erase) {
      const next = createHash("sha256").update(`${process.pid}:${process.hrtime.bigint()}:${generation}`).digest("hex").slice(0, 32);
      const temp = `${generationFile}.${process.pid}.tmp`;
      try {
        writeFileSync(temp, next, { mode: 0o600 });
        replaceFile(temp, generationFile);
      } catch (error) {
        try {
          unlinkSync(temp);
        } catch {
          /* nothing was left behind */
        }
        throw error;
      }
    } else {
      crashGeneration ??= generation;
      if (crashGeneration !== generation) return undefined;
    }
    crashGuardDepth++;
    try {
      return apply();
    } finally {
      crashGuardDepth--;
    }
  } catch {
    crashGuardFailure();
    return undefined;
  } finally {
    if (lockPath !== null) releaseLock(fd, lockPath);
  }
}

/** Take the crash lock. The descriptor when taken; "busy" when a holder that
 *  is still running kept it for the whole wait; null when no lock can be made
 *  here at all (the caller then refuses — crash state is never written
 *  without it). */
function acquireCrashLock(lockPath: string, waitMs: number): number | null | "busy" {
  const deadline = Date.now() + waitMs;
  for (;;) {
    let code: string | undefined;
    try {
      return writeLockFile(lockPath);
    } catch (err) {
      code = (err as NodeJS.ErrnoException)?.code;
    }
    if (code === "EEXIST") {
      // Held, or abandoned. A holder that is provably gone is broken at once
      // and the create retried; anything else waits.
      if (judgeHeldCrashLock(lockPath) !== "held") continue;
    } else if (!transientCreateRefusal(code)) {
      return null;
    }
    if (Date.now() >= deadline) return "busy";
    // A little uneven, so siblings that stepped back from each other's break
    // (see `breakAbandonedLock`) do not keep meeting on the next pass.
    sleepSync(1 + Math.floor(Math.random() * 3));
  }
}

/**
 * Decide about a crash lock somebody else holds.
 *
 *   - its holder is provably gone (the process ended, or the process now
 *     wearing that id started at a different time) → broken now, whatever its
 *     age: waiting for a dead process gains nothing;
 *   - it names no holder that can be checked (written by another host, or so
 *     new that its holder has not stamped it yet) → its age decides;
 *   - its holder is running → held, however old the lock is.
 */
function judgeHeldCrashLock(lockPath: string): "vanished" | "broken" | "held" {
  const look = lookAtLock(lockPath);
  if (look === null) return "vanished";
  if (!provablyAbandoned(look)) return "held";
  lockBreakPauseForTests?.("judged", look.ino);
  return breakAbandonedLock(lockPath, look.ino, provablyAbandoned);
}

/** The crash lock's rule: a holder provably gone, or one nobody can check
 *  that has not touched the file for longer than any real hold. (A claim to
 *  break a lock is held to a stricter one: only a maker provably gone sets it
 *  aside, never age.) */
function provablyAbandoned(look: LockLook): boolean {
  return (
    look.holder === "gone" ||
    (look.holder === "unknown" && Date.now() - look.mtimeMs > LOCK_STALE_MS)
  );
}

/** What a claim to break a lock adds to the lock's own name. */
const BREAK_CLAIM = ".breaking-";

/** What a claim is written under before it is renamed into place. Not a
 *  claim: nobody counts it, and a later start removes one left behind. */
const CLAIM_DRAFT = ".claiming-";

/** @internal — called at each step of a lock break, so a suite can hold one
 *  breaker there while others race it. `checked` is the last moment before
 *  the removal: the look that allows it has been taken. */
type LockBreakStep = "judged" | "claimed" | "checked" | "broken";
let lockBreakPauseForTests: ((step: LockBreakStep, ino: bigint) => void) | null = null;

/**
 * Remove an abandoned lock: only the one that was judged, and only by one
 * process at a time.
 *
 * Siblings often find the same dead holder together — workers restarted after
 * a crash all meet the lock it left. So a lock never leaves its name except by
 * being removed, and only once nobody else can be removing it. (An earlier
 * version moved the lock aside to look at it, and moved it back if it turned
 * out to be a sibling's fresh lock. Between the two moves the name was free: a
 * third process could take it, and two then held the lock at once.)
 *
 *   1. CLAIM the break, with a file naming this process. It is written under
 *      a draft name and renamed into place, so no claim is ever seen naming
 *      nobody.
 *   2. STEP BACK if any other claim stands. Each claimant makes its claim
 *      before it looks for others, so of two that overlap, at least one sees
 *      the other: never both go on. (Both may step back; the caller's wait
 *      tries again.) A claim stands until its maker is provably gone — not
 *      merely old. Its maker may have taken its last look and be about to
 *      remove the lock: paused, swapped out or stopped in a debugger, for
 *      minutes. Were its claim set aside, another process could break the
 *      lock and take the name, and the first, resuming, would remove that new
 *      holder's lock. So a claim whose maker is running counts however old it
 *      is, and so does one whose maker cannot be checked at all (another
 *      machine, an unreadable file): nothing proves it gone. Such a claim,
 *      left by a breaker that died on another machine, holds every later
 *      break of that lock back: the lock waits, and a pass whose wait runs
 *      out is skipped, never forced.
 *   3. LOOK AGAIN, holding the claim. It must still be the very file judged,
 *      and still abandoned: another process may have broken that one meanwhile
 *      and taken the name with a lock of its own — even under the same file
 *      id, which a system may hand out again at once.
 *   4. REMOVE it. Its holder is gone and every other breaker has stepped back,
 *      or will, for as long as this claim stands: nobody can have taken the
 *      name between that look and the removal, however long apart they are.
 *
 * Whatever cannot be done breaks nothing: the caller goes on waiting, and a
 * crash pass whose wait runs out is skipped, never forced.
 */
function breakAbandonedLock(
  lockPath: string,
  judgedIno: bigint,
  abandoned: (look: LockLook) => boolean,
): "broken" | "held" | "vanished" {
  const tag = randomBytes(8).toString("hex");
  const claim = `${lockPath}${BREAK_CLAIM}${tag}`;
  if (!placeClaim(`${lockPath}${CLAIM_DRAFT}${tag}`, claim)) return "held";
  try {
    if (anotherLiveClaim(lockPath, claim)) return "held";
    lockBreakPauseForTests?.("claimed", judgedIno);
    const now = lookAtLock(lockPath);
    if (now === null) return "vanished";
    if (now.ino !== judgedIno || !abandoned(now)) return "held";
    lockBreakPauseForTests?.("checked", judgedIno);
    unlinkSync(lockPath);
    lockBreakPauseForTests?.("broken", judgedIno);
    return "broken";
  } catch {
    return "held";
  } finally {
    try {
      unlinkSync(claim);
    } catch {
      /* it names this process: a later start removes it once that has ended */
    }
  }
}

/** Put a claim in place already naming this process. False when it could not
 *  be: nothing is left behind, and no break is attempted. */
function placeClaim(draft: string, claim: string): boolean {
  try {
    writeFileSync(draft, lockIdentity(), { flag: "wx", mode: 0o600 });
    renameSync(draft, claim);
    return true;
  } catch {
    try {
      unlinkSync(draft);
    } catch {
      /* never made, or a later start removes it */
    }
    return false;
  }
}

/** Whether another process may be breaking this lock right now: any claim
 *  but one whose maker is provably gone. A folder that cannot be read might
 *  hold one: that counts. */
function anotherLiveClaim(lockPath: string, ours: string): boolean {
  const dir = dirname(lockPath);
  const prefix = basename(lockPath) + BREAK_CLAIM;
  const own = basename(ours);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return true;
  }
  for (const name of names) {
    if (name === own || !name.startsWith(prefix)) continue;
    const look = lookAtLock(join(dir, name));
    if (look !== null && look.holder !== "gone") return true;
  }
  return false;
}

/** A refusal to create a lock file that clears by itself. On Windows a file
 *  still being deleted refuses a new create for a moment (EPERM, EACCES or
 *  EBUSY) — the same wait as a held lock. Elsewhere those mean what they say. */
function transientCreateRefusal(code: string | undefined): boolean {
  return (
    hostPlatform() === "win32" &&
    (code === "EPERM" || code === "EACCES" || code === "EBUSY")
  );
}

/** Bump before removing both crash payloads and crash/run history. Failure is
 * surfaced to forget(), rather than falsely acknowledging local erasure. */
export function eraseCrashState(): void {
  const erased = crashTransaction(true, () => mutate((data) => {
    delete data["boosthis:crash-pending:v1"];
    delete data["boosthis:runs:v1"];
  }, { requireLock: true }));
  if (erased !== true) throw new Error("Boosthis could not erase shared crash state; retry forget when the state lock is available.");
}

/* ─── Which application is this? ──────────────────────────────────── */

function envValue(...names: string[]): string | undefined {
  for (const name of names) {
    const v = process.env[name];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/**
 * The application root this process belongs to.
 *
 * Resolved ONCE per process: a later `chdir` must not silently move a running
 * app's state to a different scope — and therefore away from its own
 * credentials.
 *
 *   1. `BOOSTHIS_PROJECT_ROOT` — the explicit answer, for a host that boots
 *      from somewhere other than its own directory, or that wants two
 *      processes pinned to one scope on purpose.
 *   2. the working directory — the app root for an ordinary `node server.js`,
 *      a cluster worker, a PM2 process or a container entrypoint.
 *   3. the scratch directory, only if the working directory is unusable (it
 *      has been deleted under a running process).
 */
function appRoot(): string {
  if (appRootMemo !== null) return appRootMemo;
  const candidates = [
    envValue("BOOSTHIS_PROJECT_ROOT", "BOOSTEN_PROJECT_ROOT"),
    (() => {
      try {
        return process.cwd();
      } catch {
        return undefined;
      }
    })(),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (statSync(candidate).isDirectory()) {
        appRootMemo = candidate;
        return appRootMemo;
      }
    } catch {
      /* not a usable root — try the next one */
    }
  }
  appRootMemo = tmpdir();
  return appRootMemo;
}

/** How a root is resolved: one seam, so a suite can stand in for Windows'
 *  own answers without a Windows disk. */
export interface SpellingResolver {
  /** Absolute and normalised: no relative part, no `.`/`..`, no trailing
   *  separator. Text only — nothing on disk is consulted. */
  resolve(root: string): string;
  /** The operating system's own resolution of an existing path. */
  realpath(root: string): string;
}

const nativeResolver: SpellingResolver = {
  resolve: (root) => resolve(root),
  realpath: (root) => realpathSync.native(root),
};

let resolverForTests: SpellingResolver | null = null;

/**
 * The app root spelled ONE way, however it was typed.
 *
 * The folder name below is a hash of the root, so two spellings of one folder
 * used to be two installs. Windows gives one folder many spellings — `C:\App`,
 * `c:\app`, `C:\APP\`, a short `APP~1` name — and some terminals start with
 * the drive letter in lower case; the usual macOS disk ignores letter case
 * too; and a root set in the environment can be relative or carry a trailing
 * separator on any system.
 *
 * So the root is first made absolute and normalised, as text. Then, on the
 * systems whose disks ignore letter case, the operating system's own
 * resolution is asked how the path is stored on disk, and its answer is taken
 * when it differs ONLY in spelling: letter case, and on Windows an expanded
 * short name. A drive letter is upper-cased, as Windows' own resolution
 * returns it.
 *
 * Links are deliberately NOT followed. A path through a link names a place
 * somebody chose, and the commonest reason to set `BOOSTHIS_PROJECT_ROOT` to
 * one — a deploy that points it at a `current` link which moves to each new
 * release — is precisely to keep ONE install across releases. Following the
 * link would make every release a new install. Linux disks respect letter
 * case, so there the text form is the whole answer, and a root that was
 * already absolute and normalised (every working folder is) hashes exactly as
 * it did before.
 */
function canonicalSpelling(
  root: string,
  platform: NodeJS.Platform = hostPlatform(),
  resolver: SpellingResolver = resolverForTests ?? nativeResolver,
): string {
  let out = resolver.resolve(root);
  if (platform === "win32" || platform === "darwin") {
    try {
      const real = resolver.realpath(out);
      if (respelledOnly(out, real, platform)) out = real;
    } catch {
      /* cannot be resolved: the text form stands */
    }
  }
  if (platform === "win32" && /^[a-z]:/.test(out)) {
    out = out.charAt(0).toUpperCase() + out.slice(1);
  }
  return out;
}

/** True when `real` is `typed` spelled differently — letter case, and on
 *  Windows an expanded short (8.3) name — rather than a path reached by
 *  following a link somewhere else. Same parts, in the same order. */
function respelledOnly(typed: string, real: string, platform: NodeJS.Platform): boolean {
  const split = platform === "win32" ? /[\\/]+/ : /\/+/;
  const a = typed.split(split).filter(Boolean);
  const b = real.split(split).filter(Boolean);
  if (a.length !== b.length) return false;
  return a.every(
    (part, i) =>
      part.toLowerCase() === b[i]!.toLowerCase() ||
      (platform === "win32" && part.includes("~")),
  );
}

function hashKey(root: string): string {
  return createHash("sha1").update(root).digest("hex").slice(0, 16);
}

/** Short, stable, non-secret name for this application's state directory:
 *  first 16 hex of the SHA-1 of the app root, in its canonical spelling. */
function scopeKey(): string {
  if (scopeMemo !== null) return scopeMemo;
  let key: string;
  try {
    key = hashKey(canonicalSpelling(appRoot()));
  } catch {
    // A runtime without a usable hash still has to land somewhere stable.
    key = "0000000000000000";
  }
  scopeMemo = key;
  return key;
}

/**
 * Spellings an older kit may have hashed for THIS folder, the root as typed
 * this time first.
 *
 * Kits before this one named the folder from the root exactly as typed, and
 * kept no record of which root a store was made from. So an old store can only
 * be found by guessing the spelling it came from:
 *
 *   - the root as typed this time — the name the kit before would use today —
 *     and on Windows the same with its drive letter in the other case (the
 *     spelling that changes most often, between one terminal and the next);
 *   - where the disk ignores letter case (Windows, the usual macOS disk), the
 *     settled spelling with each folder name as the disk records it, in lower
 *     case or in upper case — what typing a path by hand, or completing part
 *     of it, produces — and on Windows the drive letter in either case. The
 *     last six names vary one by one and any before them vary together, so
 *     the guesses stay a few thousand at most.
 *
 * A name in mixed case of its own (`myApp` for `MyApp`) is not guessed: a
 * store kept under such a spelling is not found, and that start registers as
 * a new install, as it would have under the kit before.
 */
function* earlierSpellings(): Generator<string> {
  const seen = new Set<string>();
  const once = function* (spelling: string): Generator<string> {
    if (seen.has(spelling)) return;
    seen.add(spelling);
    yield spelling;
  };
  const typed = appRoot();
  const platform = hostPlatform();
  yield* once(typed);
  if (platform === "win32" && /^[a-zA-Z]:/.test(typed)) {
    yield* once(typed.charAt(0).toLowerCase() + typed.slice(1));
    yield* once(typed.charAt(0).toUpperCase() + typed.slice(1));
  }
  if (platform !== "win32" && platform !== "darwin") return;
  // Names at the even places, the separators between them kept as they are.
  const pieces = canonicalSpelling(typed).split(/([\\/]+)/);
  const cases = (texts: string[]): string[][] => {
    const forms = [texts, texts.map((t) => t.toLowerCase()), texts.map((t) => t.toUpperCase())];
    return forms.filter((f, i) => forms.findIndex((g) => g.join("/") === f.join("/")) === i);
  };
  let names = pieces.flatMap((piece, i) => (i % 2 === 0 && piece !== "" ? [i] : []));
  const units: Array<{ at: number[]; forms: string[][] }> = [];
  if (platform === "win32" && names.length > 0 && /^[a-zA-Z]:$/.test(pieces[names[0]!]!)) {
    units.push({ at: [names[0]!], forms: cases([pieces[names[0]!]!]) });
    names = names.slice(1);
  }
  const tied = names.slice(0, -6);
  if (tied.length > 0) units.push({ at: tied, forms: cases(tied.map((i) => pieces[i]!)) });
  for (const i of names.slice(-6)) units.push({ at: [i], forms: cases([pieces[i]!]) });
  const pick = units.map(() => 0);
  for (;;) {
    const out = pieces.slice();
    units.forEach((unit, u) => unit.at.forEach((at, j) => (out[at] = unit.forms[pick[u]!]![j]!)));
    yield* once(out.join(""));
    let u = units.length - 1;
    for (; u >= 0; u--) {
      if (++pick[u]! < units[u]!.forms.length) break;
      pick[u] = 0;
    }
    if (u < 0) return;
  }
}

/**
 * The earlier name of this application's folder that holds a store, or null.
 *
 * Only folders that are there and hold a store are worth a guess, so nothing
 * is hashed when there are none. A guess counts only when it names THIS folder
 * by the same rules today's name is made by: on a disk that does tell letter
 * case apart, `APP` beside `App` is another folder, and its store another
 * app's.
 */
function earlierStoreKey(): string | null {
  if (resolvedBase === null) return null;
  const current = scopeKey();
  const platform = hostPlatform();
  const typed = appRoot();
  try {
    // Where letter case counts, the root as typed is the only earlier name.
    if (platform !== "win32" && platform !== "darwin" && hashKey(typed) === current) return null;
  } catch {
    return null;
  }
  const held = new Set<string>();
  try {
    for (const name of readdirSync(resolvedBase)) {
      const key = name.startsWith(DIR_PREFIX) ? name.slice(DIR_PREFIX.length) : "";
      if (!/^[0-9a-f]{16}$/.test(key) || key === current) continue;
      if (existsSync(join(resolvedBase, name, STORE_FILE))) held.add(key);
    }
  } catch {
    return null;
  }
  if (held.size === 0) return null;
  const settled = canonicalSpelling(typed);
  for (const spelling of earlierSpellings()) {
    const key = hashKey(spelling);
    if (held.has(key) && canonicalSpelling(spelling) === settled) return key;
  }
  return null;
}

/* ─── Where does it live? ─────────────────────────────────────────── */

/** Can we actually create this directory and write inside it? Probes with a
 *  real write; cleans up after itself. Never throws. */
function dirIsWritable(dir: string): boolean {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    const probe = join(dir, `.probe-${process.pid}`);
    writeFileSync(probe, "1", { mode: 0o600 });
    try {
      unlinkSync(probe);
    } catch {
      /* the write succeeded, which is the only thing being asked */
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * One-time move of state written by a kit that had no scope.
 *
 * Older versions kept `<base>/node-runtime-store.json` — one file for every
 * Node app on the machine. An upgraded install must not read as a fresh one, so
 * the first scoped process to find that file takes it. If two apps really were
 * sharing it, exactly one keeps the old credentials and the other registers
 * again on its next knock; that is the self-heal path, and it is strictly
 * better than both of them continuing to overwrite one identity.
 */
function adoptUnscopedStore(): void {
  if (resolvedBase === null || resolvedDir === null) return;
  const legacy = join(resolvedBase, STORE_FILE);
  const scoped = join(resolvedDir, STORE_FILE);
  try {
    if (!existsSync(legacy) || existsSync(scoped)) return;
    try {
      renameSync(legacy, scoped);
    } catch {
      // Different device, or another worker took it a moment ago.
      if (existsSync(scoped) || !existsSync(legacy)) return;
      writeFileSync(scoped, readFileSync(legacy), { mode: 0o600 });
      try {
        unlinkSync(legacy);
      } catch {
        /* the copy is what matters */
      }
    }
    try {
      chmodSync(scoped, 0o600);
    } catch {
      /* Windows */
    }
  } catch {
    // Never let a migration stop the kit from starting.
  }
}

/**
 * One-time move of state kept under this app's OLD folder name.
 *
 * Kits before this one named the folder from the root exactly as typed, so a
 * root spelled differently today has its store under another name. An
 * upgraded install must not read as a fresh one: when today's folder has no
 * store and an earlier spelling's folder does (see `earlierSpellings` for
 * which spellings can be found, and which cannot), the store moves here, and
 * the crash erase generation that guards it moves with it. Never over a store
 * already here — a sibling that got there first keeps what it has.
 */
function adoptLegacyScopedStore(): void {
  if (resolvedBase === null || resolvedDir === null) return;
  const scoped = join(resolvedDir, STORE_FILE);
  try {
    if (existsSync(scoped)) return;
    const key = earlierStoreKey();
    if (key === null) return;
    const legacyDir = join(resolvedBase, DIR_PREFIX + key);
    if (!moveWithoutReplacing(join(legacyDir, STORE_FILE), scoped)) return;
    moveWithoutReplacing(join(legacyDir, CRASH_GENERATION), join(resolvedDir, CRASH_GENERATION));
    try {
      chmodSync(scoped, 0o600);
    } catch {
      /* Windows */
    }
  } catch {
    // Never let a migration stop the kit from starting.
  }
}

/** Move a file, never over one already at the destination. A plain rename
 *  would replace it; a hard link refuses to (EEXIST), and a copy made with
 *  the exclusive flag does too where links are not supported. */
function moveWithoutReplacing(from: string, to: string): boolean {
  try {
    linkSync(from, to);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EEXIST" || code === "ENOENT") return false;
    try {
      copyFileSync(from, to, fsConstants.COPYFILE_EXCL);
    } catch {
      return false;
    }
  }
  try {
    unlinkSync(from);
  } catch {
    /* the copy at the new name is what is read from now on */
  }
  return true;
}

/** How old a temporary file of ours must be before a later start may remove
 *  it. A write takes milliseconds; one this old was left by a process that
 *  died between writing the new file and renaming it into place. */
const ABANDONED_TEMP_MS = 60_000;

/** Remove what an interrupted write left behind: a temporary copy of the store
 *  or of the erase generation, a lock-break claim's draft, or the claim of a
 *  break whose maker died before it could remove it. Only files old enough
 *  that no live write can still own them — and a claim only once its maker is
 *  provably gone, however old it is (see `breakAbandonedLock`: a claim stands
 *  for as long as its maker may still act on it). A draft is safe to remove:
 *  a maker that resumes after it is gone fails to place its claim, and breaks
 *  nothing. */
function sweepAbandonedTemps(dir: string): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of names) {
    const claim = name.includes(`.lock${BREAK_CLAIM}`);
    const ours =
      claim ||
      name.startsWith(`.${STORE_FILE}.tmp-`) ||
      (name.startsWith(`${CRASH_GENERATION}.`) && name.endsWith(".tmp")) ||
      name.includes(`.lock${CLAIM_DRAFT}`);
    if (!ours) continue;
    const file = join(dir, name);
    try {
      if (now - statSync(file).mtimeMs <= ABANDONED_TEMP_MS) continue;
      if (claim && lookAtLock(file)?.holder !== "gone") continue;
      unlinkSync(file);
    } catch {
      /* gone already, or not ours to remove */
    }
  }
}

/** Everything a usable backing does once, when it is settled. */
function settleBacking(): void {
  adoptLegacyScopedStore();
  adoptUnscopedStore();
  if (resolvedDir !== null) sweepAbandonedTemps(resolvedDir);
}

/** Settle on a backing directory ONCE. */
function resolveBacking(): void {
  if (backend !== null) return;
  const scoped = DIR_PREFIX + scopeKey();
  const configured = envValue("BOOSTHIS_STATE_DIR", "BOOSTEN_STATE_DIR");
  if (configured) {
    // An explicitly configured directory is used even if the probe fails: the
    // host asked for it, and silently writing somewhere else would be worse
    // than not writing at all. Tests depend on this.
    //
    // But the probe still RUNS, because "which directory" and "can anything be
    // kept there" are two different questions. A function host that names a
    // state directory it cannot write to is exactly the case this task exists
    // for: if that counted as durable, an unreadable cache would read as "the
    // last answer is gone" and the kit would lock itself and go quiet — on a
    // configuration we support and ask people to use.
    //
    // The per-application subdirectory applies here too. A host that points
    // several services at one volume is the shared-machine case again, not an
    // exception to it; a host that wants two processes to share one scope says
    // so with BOOSTHIS_PROJECT_ROOT, which is what that setting is for.
    resolvedBase = configured;
    resolvedDir = join(configured, scoped);
    backend = "configured";
    backingUsable = dirIsWritable(resolvedDir);
    if (backingUsable) settleBacking();
    return;
  }
  try {
    const home = join(homedir(), ".boosthis");
    if (dirIsWritable(join(home, scoped))) {
      resolvedBase = home;
      resolvedDir = join(home, scoped);
      backend = "home";
      backingUsable = true;
      settleBacking();
      return;
    }
  } catch {
    /* fall through to scratch */
  }
  try {
    const scratch = join(tmpdir(), ".boosthis");
    if (dirIsWritable(join(scratch, scoped))) {
      resolvedBase = scratch;
      resolvedDir = join(scratch, scoped);
      backend = "scratch";
      backingUsable = true;
      settleBacking();
      return;
    }
  } catch {
    /* fall through to memory */
  }
  resolvedBase = null;
  resolvedDir = null;
  backend = "memory";
  backingUsable = false;
}

/** Which backing the store is using. Resolves it on first call. */
export function storageBackend(): StorageBackend {
  resolveBacking();
  return backend ?? "memory";
}

/** True when what we write here can outlive this process — which needs BOTH a
 *  real directory and the ability to write in it. False on a function host with
 *  nothing but memory, false for a configured directory that cannot be written,
 *  and false once we have found a state file we cannot read (we will not write
 *  over it, so nothing can be kept this run): in every case a caller must not
 *  read "nothing stored" as "the answer was lost". */
export function storageDurable(): boolean {
  storageBackend();
  return backend !== "memory" && backingUsable && !writesRefused && !writeDegraded;
}

/** State that was on disk and is not in this process, or null when nothing was
 *  lost. Read by the kit's own status surfaces: an install whose credentials
 *  went missing must be able to say WHY. */
export function storageStateLoss(): StorageStateLoss | null {
  return stateLoss;
}

function stateDir(): string | null {
  resolveBacking();
  return resolvedDir;
}

function storeFile(): string | null {
  const dir = stateDir();
  return dir === null ? null : join(dir, STORE_FILE);
}

/* ─── Saying what was lost ────────────────────────────────────────── */

/**
 * One ungated line, once per process, naming the file and what happened to it.
 *
 * An install that silently forgets its credentials looks exactly like an
 * install that never had any: the same "not registered" everywhere, with no
 * cause anywhere. This is the only place that difference can be stated at the
 * moment it is discovered.
 */
function noteLoss(loss: StorageStateLoss): void {
  stateLoss = loss;
  if (lossAnnounced) return;
  lossAnnounced = true;
  try {
    const line =
      loss.kind === "corrupt"
        ? `[boosthis] Saved state at ${loss.file} could not be read (not valid JSON) and has been set aside as ${loss.setAsideAs ?? "a copy beside it"}. This process starts with no stored credentials and will register again; measurements already uploaded are unaffected.`
        : `[boosthis] Saved state at ${loss.file} exists but could not be read${loss.code ? ` (${loss.code})` : ""}. Boosthis is keeping state in memory for this process and will NOT write over that file. Fix its ownership, or point BOOSTHIS_STATE_DIR at a directory this process owns.`;
    process.stderr.write(line + "\n");
  } catch {
    // A host that replaced stderr must not turn a lost file into a crash.
  }
}

/* ─── The interprocess lock ───────────────────────────────────────── */

/** Sleep without a timer — the write path is synchronous by contract (the
 *  crash reporter calls it while the process is dying). Falls back to a short
 *  spin where SharedArrayBuffer is unavailable. */
function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      /* spin */
    }
  }
}

/** A process's start, in clock ticks since boot (field 22 of /proc/<pid>/stat)
 *  — the part of its identity a reused pid does not share. Null off Linux. */
function startTicks(pid: number | "self"): string | null {
  // Windows has no /proc. A suite standing in for Windows on Linux must get
  // Windows' answer here too, or it would be testing Linux's rule.
  if (hostPlatform() === "win32") return null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // The command name (field 2) may hold spaces: count from its closing paren.
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch {
    return null;
  }
}

/* ─── Telling a reused process id from the process that held it ──── */

/**
 * WINDOWS HANDS A DEAD PROCESS'S ID TO THE NEXT PROCESS, and nothing in the id
 * says which process it was. On Linux the kit reads each process's start time
 * from /proc and tells the two apart; Windows has no /proc. Without another
 * way, a new process that happened to receive a dead run's id kept that run's
 * crash from ever being sent, and kept its abandoned lock from ever breaking.
 *
 * So on Windows each kit process keeps a mark of its own: a file in its state
 * folder, held open for the whole life of the process with an exclusive share
 * mode. While the process runs, nobody else can open that file. When it ends,
 * Windows closes the handle and the file opens for anyone. Every lock and
 * crash record the process writes carries its mark, so a later reader asks
 * the mark rather than the id:
 *
 *   - refused as in use → the process that wrote the record still runs;
 *   - opens, or is gone → that process has ended, whoever wears its id now.
 *
 * The mark proves itself before it is trusted: right after making it, the
 * process tries to open it a second time. A filesystem that allows that — one
 * that ignores share modes — gets no mark at all, and its records fall back to
 * the id alone, which never breaks a live holder (a reused id there still
 * reads as alive; the safe direction). Linux and macOS never make a mark.
 */
const LIVE_PREFIX = "node-live-";
/** How many old marks one start may look at, so a folder full of them cannot
 *  slow a start down. Each later start tidies the next batch. */
const LIVE_SWEEP_MAX = 32;

/** How a liveness mark is made and read. One seam, so a suite can stand in
 *  for Windows share modes on a system that has none. */
export interface LivenessProbe {
  /** Make this process's mark in `dir`; its name, or null where no mark that
   *  proves anything can be made. */
  create(dir: string): string | null;
  /** Whether the process that made `mark` still holds it. */
  check(dir: string, mark: string): "alive" | "gone" | "unknown";
}

/** libuv's exclusive share mode for an open on Windows (UV_FS_O_EXLOCK). */
const EXCLUSIVE_SHARE_FLAG: number = (() => {
  const named = (fsConstants as unknown as Record<string, number | undefined>).UV_FS_O_EXLOCK;
  if (typeof named === "number" && named !== 0) return named;
  return process.platform === "win32" ? 0x10000000 : 0;
})();

/** Held for the life of the process: closing it would announce our death. */
let ownLiveFd: number | null = null;

const shareModeProbe: LivenessProbe = {
  create(dir) {
    if (process.platform !== "win32" || EXCLUSIVE_SHARE_FLAG === 0) return null;
    const mark = randomBytes(8).toString("hex");
    const file = join(dir, LIVE_PREFIX + mark);
    let fd: number;
    try {
      fd = openSync(
        file,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | EXCLUSIVE_SHARE_FLAG,
        0o600,
      );
    } catch {
      return null;
    }
    let proven = false;
    try {
      closeSync(openSync(file, "r"));
    } catch (err) {
      proven = (err as NodeJS.ErrnoException)?.code === "EBUSY";
    }
    if (!proven) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
      try {
        unlinkSync(file);
      } catch {
        /* left for a later sweep */
      }
      return null;
    }
    ownLiveFd = fd;
    return mark;
  },
  check(dir, mark) {
    const file = join(dir, LIVE_PREFIX + mark);
    try {
      closeSync(openSync(file, "r"));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "EBUSY") return "alive";
      if (code === "ENOENT") return "gone";
      return "unknown";
    }
    // Nobody holds it: the process that made it has ended. Tidy it away.
    try {
      unlinkSync(file);
    } catch {
      /* another reader tidied it first */
    }
    return "gone";
  },
};

let livenessProbe: LivenessProbe = shareModeProbe;
/** undefined until decided; null when this process has no mark. */
let ownLiveMark: string | null | undefined;

/**
 * This process's liveness mark, made on first use — Windows only, and only
 * where it proves itself. Null everywhere else.
 */
export function processLivenessMark(): string | null {
  if (ownLiveMark !== undefined) return ownLiveMark;
  ownLiveMark = null;
  if (hostPlatform() !== "win32") return null;
  const dir = stateDir();
  if (dir === null || !backingUsable) return null;
  try {
    ownLiveMark = livenessProbe.create(dir);
  } catch {
    ownLiveMark = null;
  }
  if (ownLiveMark !== null) sweepEndedMarks(dir);
  return ownLiveMark;
}

/** Whether the process that made `mark` still runs. "unknown" when it cannot
 *  be told — which every caller treats as alive. */
export function processLiveness(mark: string): "alive" | "gone" | "unknown" {
  if (!/^[0-9a-f]{16}$/.test(mark)) return "unknown";
  if (mark === ownLiveMark) return "alive";
  const dir = stateDir();
  if (dir === null) return "unknown";
  try {
    return livenessProbe.check(dir, mark);
  } catch {
    return "unknown";
  }
}

/** Marks left by processes that have ended are removed as they are found, so
 *  the folder does not collect one per start. */
function sweepEndedMarks(dir: string): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  let looked = 0;
  for (const name of names) {
    if (!name.startsWith(LIVE_PREFIX)) continue;
    const mark = name.slice(LIVE_PREFIX.length);
    if (mark === ownLiveMark || !/^[0-9a-f]{16}$/.test(mark)) continue;
    if (looked++ >= LIVE_SWEEP_MAX) break;
    try {
      livenessProbe.check(dir, mark);
    } catch {
      /* left for a later start */
    }
  }
}

/** @internal — stand in for Windows share modes; null restores the real probe
 *  and forgets this process's mark so the next use makes a new one. */
export function _setLivenessProbeForTests(probe: LivenessProbe | null): void {
  livenessProbe = probe ?? shareModeProbe;
  ownLiveMark = undefined;
  if (ownLiveFd !== null) {
    try {
      closeSync(ownLiveFd);
    } catch {
      /* already closed */
    }
    ownLiveFd = null;
  }
}

let ownStart: string | null | undefined;

/** What the lock file says about its holder: pid, host, and what tells this
 *  process from a later one given its pid — its start on Linux, its liveness
 *  mark on Windows (`w` + the mark), nothing where neither exists. */
function lockIdentity(): string {
  const mark = processLivenessMark();
  if (mark !== null) return `${process.pid}@${hostname()}@w${mark}`;
  if (ownStart === undefined) ownStart = startTicks("self");
  return `${process.pid}@${hostname()}${ownStart === null ? "" : `@${ownStart}`}`;
}

/**
 * What can be said about the process a lock file names.
 *
 *   - `alive`   — a process on THIS host that is still running: the same
 *                 process, where its start or its liveness mark can be read,
 *                 not a later one given its pid. Never broken on age.
 *   - `gone`    — that process has ended, or the process now wearing its id
 *                 started at a different time.
 *   - `unknown` — it names nobody we can check: another host, a kit from
 *                 before, or a lock so new it has not been stamped yet. Its
 *                 age alone decides.
 */
type LockHolder = "alive" | "gone" | "unknown";

/** One look at a lock file: which file it is, when it was last written, and
 *  who it names — all through ONE open, so the three describe the same file
 *  even when the name is taken over meanwhile. Null when it is not there. */
interface LockLook {
  ino: bigint;
  mtimeMs: number;
  holder: LockHolder;
}

function lookAtLock(file: string): LockLook | null {
  let fd: number | null = null;
  try {
    fd = openSync(file, "r");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    // There but unreadable: it names nobody, and its age still decides.
  }
  try {
    // Compared exactly later: a Windows file id can exceed a plain number.
    const st = fd !== null ? fstatSync(fd, { bigint: true }) : statSync(file, { bigint: true });
    let text = "";
    if (fd !== null) {
      try {
        text = readFileSync(fd, "utf8");
      } catch {
        /* names nobody */
      }
    }
    return { ino: st.ino, mtimeMs: Number(st.mtimeMs), holder: holderNamedBy(text) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    // There, but nothing about it can be read: treated as just taken, so
    // nobody breaks it and the caller's bounded wait decides.
    return { ino: -1n, mtimeMs: Date.now(), holder: "unknown" };
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

function holderNamedBy(text: string): LockHolder {
  const m = /^(\d+)@([^@]+)(?:@(\d+|w[0-9a-f]{16}))?$/.exec(text.trim());
  if (m === null || m[2] !== hostname()) return "unknown";
  const pid = Number(m[1]);
  // This very pid included: a worker thread of this process shares it, and
  // its start identity matches ours while that thread still holds the lock.
  if (!Number.isSafeInteger(pid) || pid <= 0) return "unknown";
  try {
    process.kill(pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "EPERM") return "gone";
  }
  const named = m[3];
  if (named === undefined) return "alive";
  if (named.startsWith("w")) {
    return processLiveness(named.slice(1)) === "gone" ? "gone" : "alive";
  }
  const now = startTicks(pid);
  return now === null || now === named ? "alive" : "gone";
}

/** The store lock's rule: old enough that no real hold lasts that long, and
 *  not naming a process on THIS host that is still running. A confirmed-live
 *  holder's lock is never broken on age: a write waits for it or stays in
 *  memory. */
function storeLockAbandoned(look: LockLook): boolean {
  return Date.now() - look.mtimeMs > LOCK_STALE_MS && look.holder !== "alive";
}

/** Take the lock. Null when no lock can be made here (a read-only directory:
 *  the caller writes anyway, atomically, and learns it could not); "busy" when
 *  a live holder still has it at the end of the budget. */
function acquireLock(lockPath: string, waitMs: number): number | null | "busy" {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = writeLockFile(lockPath);
      return fd;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") {
        // A lock file still being deleted on Windows refuses a create for a
        // moment: wait for it like a held lock. Anything else is a directory
        // that cannot take a lock at all — nothing to wait for.
        if (!transientCreateRefusal(code)) return null;
        if (Date.now() >= deadline) return "busy";
        sleepSync(2);
        continue;
      }
      const look = lookAtLock(lockPath);
      // It vanished between the failed create and the look — retry at once.
      if (look === null) continue;
      if (storeLockAbandoned(look)) {
        // The holder died. Break it — that lock and no newer one, the same
        // way the crash lock is broken — and try again.
        if (breakAbandonedLock(lockPath, look.ino, storeLockAbandoned) !== "held") continue;
        // Stepped back from another breaker: wait a little unevenly, so the
        // two do not keep meeting on the next pass.
        if (Date.now() >= deadline) return "busy";
        sleepSync(1 + Math.floor(Math.random() * 3));
        continue;
      }
      if (Date.now() >= deadline) return "busy";
      sleepSync(2);
    }
  }
}

/** Exclusive create — `wx` fails with EEXIST when the file is already there,
 *  which IS the lock. The pid inside is only a hint for a human reading it. */
function writeLockFile(lockPath: string): number {
  const fd = openSync(lockPath, "wx", 0o600);
  try {
    writeSync(fd, lockIdentity());
  } catch {
    /* the file is the lock; its contents are only a hint for a human */
  }
  return fd;
}

function releaseLock(fd: number | null, lockPath: string): void {
  if (fd === null) return;
  // Only OUR lock comes off: if ours was broken as abandoned, the file there
  // now is another writer's, and removing it would let a third one in.
  let ours = false;
  try {
    // Compared exactly: a Windows file id can exceed what a plain number
    // holds, and two ids rounded to one would make a sibling's lock "ours".
    ours =
      fstatSync(fd, { bigint: true }).ino ===
      statSync(lockPath, { bigint: true }).ino;
  } catch {
    ours = false;
  }
  try {
    closeSync(fd);
  } catch {
    /* already closed */
  }
  if (!ours) return;
  try {
    unlinkSync(lockPath);
  } catch {
    /* broken as stale by someone else */
  }
}

/* ─── Reading ─────────────────────────────────────────────────────── */

let mem: Record<string, string> | null = null;
/** Identity of the file `mem` was read from — inode, size and mtime. Every
 *  write lands a NEW inode (temp file + rename), so this changes whenever any
 *  process writes, including within the same millisecond. */
let memStamp: string | null = null;

function stampOf(file: string): string | null {
  try {
    const st = statSync(file);
    return `${st.ino}:${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
}

type DiskRead =
  | { ok: true; data: Record<string, string> }
  | { ok: false; reason: "missing" }
  | { ok: false; reason: "corrupt"; raw: string }
  | { ok: false; reason: "unreadable"; code?: string };

function readDisk(file: string): DiskRead {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return { ok: false, reason: "missing" };
    return { ok: false, reason: "unreadable", code };
  }
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return { ok: false, reason: "corrupt", raw };
    }
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "string") data[k] = v;
    }
    return { ok: true, data };
  } catch {
    return { ok: false, reason: "corrupt", raw };
  }
}

/** Move a file we cannot parse out of the way, keeping the bytes. Returns where
 *  it went, or null if it could not be moved (in which case it is overwritten
 *  by the next write, which is still better than reading nothing forever). */
function setAside(file: string): string | null {
  const target = `${file}.unreadable-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    renameSync(file, target);
    return target;
  } catch {
    return null;
  }
}

/** Turn a failed read into the in-memory view this process will use, recording
 *  what was lost. Returns the (empty) map. */
function handleFailedRead(file: string, read: DiskRead): Record<string, string> {
  if (read.ok || read.reason === "missing") return {};
  if (read.reason === "corrupt") {
    const setAsideAs = setAside(file);
    noteLoss({
      kind: "corrupt",
      file,
      ...(setAsideAs ? { setAsideAs } : {}),
      at: Date.now(),
    });
    return {};
  }
  // Exists, cannot be read. Do not write over what we cannot see.
  writesRefused = true;
  noteLoss({
    kind: "unreadable",
    file,
    ...(read.code ? { code: read.code } : {}),
    at: Date.now(),
  });
  return {};
}

/**
 * The current view of the store.
 *
 * The in-memory map is a CACHE of the file, not the truth: another worker of
 * the same app writes to the same file, so the cache is revalidated against the
 * file's identity (a stat) on every read. A stat is cheap; reading another
 * process's consent token as absent is not.
 */
function load(): Record<string, string> {
  const file = storeFile();
  if (file === null) {
    if (!mem) mem = {};
    return mem;
  }
  const stamp = stampOf(file);
  if (mem && stamp === memStamp) return mem;
  const read = readDisk(file);
  const data = read.ok ? read.data : handleFailedRead(file, read);
  mem = data;
  memStamp = read.ok ? stamp : stampOf(file);
  if (read.ok && Object.keys(data).length > 0) {
    restoredFromDisk = true;
    for (const key of Object.keys(data)) restoredKeys.add(key);
  }
  return data;
}

/* ─── Writing ─────────────────────────────────────────────────────── */

let tmpCounter = 0;

/** How long a replace Windows refused is retried, by the clock: about a
 *  second, as in the kit's other languages. Until 1.0.0-alpha.220 it was about
 *  a quarter of a second, and a holder of 0.3 s, seen in a Windows emulator,
 *  cost forget() its erase of the entitlement record while forget reported the
 *  erase as done. An ordinary write in a sibling waits for the store lock far
 *  longer than this; one that would rather miss its update may skip while a
 *  holder rides a refusal out, and re-applies it on its next pass. */
const REPLACE_RETRY_BUDGET_MS = 1_000;
/** The pauses between those attempts: short at first, then steady. */
const REPLACE_RETRY_DELAYS_MS = [5, 10, 20, 40, 80, 120];

/**
 * Rename `tmp` over `file` — the only way this store replaces a file. The old
 * file is never deleted first, so a reader always finds one whole copy.
 *
 * On Windows a rename onto a file another process has open — a sibling
 * reading it, a virus scanner, a search indexer — is refused for a moment
 * with EPERM, EACCES or EBUSY. That refusal is retried on the bounded budget
 * above. One that outlasts it is thrown to the caller, which keeps the
 * previous file as it was and removes its own temporary copy; nothing here
 * ever reaches the host app. Elsewhere those codes mean what they say and are
 * not retried.
 */
function replaceFile(tmp: string, file: string): void {
  // A steady clock: a wall clock set back mid-wait must not stretch it.
  const deadline = performance.now() + REPLACE_RETRY_BUDGET_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      const brief =
        hostPlatform() === "win32" &&
        (code === "EPERM" || code === "EACCES" || code === "EBUSY");
      const left = deadline - performance.now();
      if (!brief || left <= 0) throw err;
      const pause = REPLACE_RETRY_DELAYS_MS[Math.min(attempt, REPLACE_RETRY_DELAYS_MS.length - 1)]!;
      sleepSync(Math.max(1, Math.min(pause, Math.ceil(left))));
    }
  }
}

function writeAtomic(dir: string, file: string, data: Record<string, string>): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Harden directory permissions even if it pre-existed without them (e.g.
  // created by an older version of the runtime before this fix shipped).
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Best-effort: ignore on platforms that don't support chmod (Windows).
  }
  const tmp = join(dir, `.${STORE_FILE}.tmp-${process.pid}-${tmpCounter++}`);
  try {
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    try {
      chmodSync(tmp, 0o600);
    } catch {
      // Best-effort: ignore on platforms that don't support chmod (Windows).
    }
    // The replace itself. A reader either sees the whole previous file or the
    // whole new one; there is no moment at which it sees half of either, which
    // is what made a concurrent writer able to erase every credential.
    replaceFile(tmp, file);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* nothing to clean up */
    }
    throw err;
  }
  // Harden the file even if it already existed with permissive permissions
  // (e.g. written by an older runtime version before this fix shipped).
  try {
    chmodSync(file, 0o600);
  } catch {
    // Best-effort: ignore on platforms that don't support chmod (Windows).
  }
}

/**
 * Apply one change to the store: lock, re-read, mutate what is on DISK, write
 * atomically, and adopt the result as the in-memory view.
 *
 * Starting from the disk state rather than from `mem` is the whole point. A
 * worker that read the file ten minutes ago and writes its own view back is how
 * a sibling's freshly-minted token disappeared.
 */
/** Options for a write whose caller would rather MISS an update than LOSE one. */
interface MutateOptions {
  /** Refuse to publish without the interprocess lock. */
  requireLock?: boolean;
  /** Set by `mutate` when `requireLock` met a lock still contended at the end
   *  of its budget: nothing was applied, on disk or in memory. */
  skipped?: boolean;
}

function mutate(
  apply: (data: Record<string, string>) => void | boolean,
  opts?: MutateOptions,
): boolean {
  const dir = stateDir();
  const file = storeFile();
  if (dir === null || file === null || !backingUsable || writesRefused) {
    // Memory-only: still apply, so the process behaves normally for its own
    // lifetime. It simply forgets on exit, which `storageDurable()` reports.
    apply(load());
    return false;
  }
  const lockPath = join(dir, LOCK_FILE);
  let fd: number | null = null;
  try {
    const got = acquireLock(
      lockPath,
      opts?.requireLock === true ? LOCK_WAIT_MS : LOCK_WAIT_ORDINARY_MS,
    );
    fd = got === "busy" ? null : got;
    if (got === null && opts?.requireLock === true) {
      opts.skipped = true;
      return false;
    }
    if (got === "busy" && opts?.requireLock !== true) {
      // A live sibling has held the lock past the whole budget — frozen, not
      // slow. Publishing beside it would erase its write or have ours erased,
      // so this change stays in memory for this process and reports so.
      apply(load());
      return false;
    }
    if (got === "busy" && opts?.requireLock === true) {
      // The budget ran out with a sibling still holding the lock. Writing now
      // could replace the record that sibling is about to publish, so this
      // caller's change is dropped whole instead — not applied in memory
      // either, or this process would read a state no file holds and the next
      // ordinary write would silently discard it. The caller's next pass
      // re-reads what the holder left and applies its change to THAT.
      opts.skipped = true;
      return false;
    }
    // Stamped BEFORE the read: a write landing in between makes the check
    // below re-read once for nothing, never miss a change.
    let seen = stampOf(file);
    const read = readDisk(file);
    if (!read.ok && read.reason === "unreadable") {
      // We cannot see what is there, so we must not replace it.
      handleFailedRead(file, read);
      apply(load());
      return false;
    }
    let data = read.ok ? read.data : handleFailedRead(file, read);
    if (apply(data) === false) {
      mem = data;
      memStamp = stampOf(file);
      return true;
    }
    // A sibling's write can still land between this read and the rename: one
    // frozen so long that its lock was broken as abandoned, resuming now.
    // Publishing the copy read above would erase that write, so re-read and
    // re-apply this change to what is there now.
    for (let tries = 0; tries < 3; tries++) {
      const current = stampOf(file);
      if (current === seen) break;
      const again = readDisk(file);
      if (!again.ok) {
        // What is there now cannot be read, so it must not be replaced with
        // the copy read before it — the same refusal as an unreadable first
        // read. Memory keeps the change for this process.
        apply(load());
        return false;
      }
      seen = current;
      data = again.data;
      if (apply(data) === false) {
        mem = data;
        memStamp = stampOf(file);
        return true;
      }
    }
    writeAtomic(dir, file, data);
    mem = data;
    memStamp = stampOf(file);
    return true;
  } catch {
    // Best-effort: an unwritable directory just means no cross-restart cache.
    writeDegraded = true;
    return false;
  } finally {
    releaseLock(fd, lockPath);
  }
}

export const storage = {
  async get(key: string): Promise<string | null> {
    return load()[key] ?? null;
  },
  async set(key: string, value: string): Promise<void> {
    mutate((data) => {
      data[key] = value;
    });
  },
  async remove(key: string): Promise<void> {
    mutate((data) => {
      delete data[key];
    });
  },
  // Synchronous variants. The backing store is a single JSON file whose read
  // and write are already synchronous (readFileSync / renameSync), so these are
  // the SAME operations without the async wrapper. The crash reporter uses
  // setSync at capture time so a FATAL crash that kills the process before a
  // network flush completes still persists the pending buffer to disk — it
  // cannot await an async write mid-crash.
  getSync(key: string): string | null {
    return load()[key] ?? null;
  },
  setSync(key: string, value: string): void {
    mutate((data) => {
      data[key] = value;
    });
  },
  removeSync(key: string): void {
    mutate((data) => {
      delete data[key];
    });
  },
  /**
   * Read-modify-write ONE key with the file locked for the whole span.
   *
   * `getSync` then `setSync` is two separate locks with a gap in the middle,
   * and anything a sibling worker wrote in that gap is lost. A caller whose
   * value is a collection — the crash buffer is the one that matters — must use
   * this instead, so its merge sees what the other workers actually left.
   *
   * `update` receives the value on disk (null when absent) and returns the new
   * value, or null to remove the key. It must not throw; if it does, the store
   * is left exactly as it was. Returns what was stored.
   */
  updateSync(
    key: string,
    update: (current: string | null) => string | null,
  ): string | null {
    return storage.updateSyncPersisted(key, update).value;
  },
  /**
   * `updateSync`, and whether the new value actually reached DISK.
   *
   * Every write in this store is best-effort: a full disk, a directory that
   * turned read-only, or no writable directory at all leaves the value in
   * memory and returns quietly, because losing a cached token is not worth
   * crashing somebody's server over. For ONE caller that silence is the bug
   * rather than the kindness — the crash buffer, whose entire purpose is to
   * outlive the process. It cannot infer failure from an exception, because
   * there is none, so it asks here instead and says, in the kit's own words,
   * that the crash it caught will not survive.
   *
   * `persisted: false` means exactly "this value is in memory only". It is not
   * an error and nothing else need react to it.
   */
  updateSyncPersisted(
    key: string,
    update: (current: string | null) => string | null,
  ): { value: string | null; persisted: boolean } {
    const { value, persisted } = updateKey(key, update);
    return { value, persisted };
  },
  /**
   * `updateSyncPersisted` for a caller that would rather MISS an update than
   * LOSE one.
   *
   * The ordinary write waits for a live holder until it releases or its lock
   * is old enough to break as abandoned, because a credential must land. A
   * record of COUNTS would rather not hold the host's thread that long:
   * skipping costs one pass that the caller re-applies next time. So when the
   * lock is still contended after a short wait, nothing is applied — not on
   * disk and not in memory — and `skipped` is true.
   *
   * A store with no durable backing has no siblings to race; there the update
   * applies to memory exactly as `updateSyncPersisted` would.
   */
  updateSyncExclusive(
    key: string,
    update: (current: string | null) => string | null,
  ): { value: string | null; persisted: boolean; skipped: boolean } {
    return updateKey(key, update, { requireLock: true });
  },
};

/** The read-modify-write both update methods share. */
function updateKey(
  key: string,
  update: (current: string | null) => string | null,
  opts?: MutateOptions,
): { value: string | null; persisted: boolean; skipped: boolean } {
  if (crashGuardDepth === 0 && (key === "boosthis:crash-pending:v1" || key === "boosthis:runs:v1")) {
    return withCrashGeneration(() => updateKey(key, update, { requireLock: true })) ??
      { value: null, persisted: false, skipped: true };
  }
  let result: string | null = null;
  const persisted = mutate((data) => {
    const previous = data[key] ?? null;
    const next = update(previous);
    result = next;
    if (next === previous) return false;
    if (next === null) delete data[key];
    else data[key] = next;
    return true;
  }, opts);
  return { value: result, persisted, skipped: opts?.skipped === true };
}

/** Test helper — drop the in-memory view, any on-disk file, and the settled
 *  backing choice. */
export function _resetStorageForTests(): void {
  crashGeneration = undefined;
  crashGuardWarned = false;
  const dir = resolvedDir;
  const base = resolvedBase;
  mem = null;
  memStamp = null;
  try {
    const file = storeFile();
    if (file !== null) rmSync(file);
  } catch {
    // ignore — file may not exist
  }
  try {
    if (dir !== null) rmSync(join(dir, LOCK_FILE));
  } catch {
    // ignore — no lock held
  }
  try {
    if (base !== null) rmSync(join(base, STORE_FILE));
  } catch {
    // ignore — no unscoped leftover
  }
  backend = null;
  resolvedBase = null;
  resolvedDir = null;
  backingUsable = false;
  writesRefused = false;
  stateLoss = null;
  lossAnnounced = false;
  restoredFromDisk = false;
  restoredKeys = new Set<string>();
  writeDegraded = false;
  appRootMemo = null;
  scopeMemo = null;
  ownStart = undefined;
  lockBreakPauseForTests = null;
  _setLivenessProbeForTests(livenessProbe === shareModeProbe ? null : livenessProbe);
}

/** @internal — run `pause` at each step of a lock break: once it is judged
 *  abandoned, once the break is claimed, once the last look allows the
 *  removal, once the lock is removed. */
export function _setLockBreakPauseForTests(
  pause: ((step: LockBreakStep, ino: bigint) => void) | null,
): void {
  lockBreakPauseForTests = pause;
}

/** @internal — stand in for the operating system's path resolution (Windows'
 *  answers on a Linux test machine); null restores the real one. */
export function _setPathResolutionForTests(resolver: SpellingResolver | null): void {
  resolverForTests = resolver;
}

/** Where this process's state actually lives, for tests and for the kit's own
 *  status surfaces. Resolving the backing is a side effect of asking. */
export const _storageInternals = {
  STORE_FILE,
  LOCK_FILE,
  CRASH_LOCK_FILE,
  DIR_PREFIX,
  LIVE_PREFIX,
  appRoot,
  scopeKey,
  canonicalSpelling,
  earlierSpellings: (): string[] => [...earlierSpellings()],
  dir: (): string | null => stateDir(),
  file: (): string | null => storeFile(),
  base: (): string | null => {
    resolveBacking();
    return resolvedBase;
  },
  /** Break the crash lock as a sibling would that judged it abandoned when
   *  it was the file `ino`. */
  breakCrashLock: (ino: bigint): "broken" | "held" | "vanished" => {
    const dir = stateDir();
    if (dir === null) throw new Error("no state folder");
    return breakAbandonedLock(join(dir, CRASH_LOCK_FILE), ino, provablyAbandoned);
  },
  /** Clear the state folder of what interrupted writes left, as a later
   *  start does. */
  sweep: (): void => {
    const dir = stateDir();
    if (dir === null) throw new Error("no state folder");
    sweepAbandonedTemps(dir);
  },
};

/** Whether a particular value was restored from the on-disk document. */
export function storageKeyRestored(key: string): boolean {
  load();
  return restoredKeys.has(key);
}

/** Whether this process found an existing persisted state document. */
export function storageRestored(): boolean {
  load();
  return restoredFromDisk;
}
