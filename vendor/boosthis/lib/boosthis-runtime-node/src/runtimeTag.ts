/**
 * WHICH ENGINE IS THIS, AND WHAT DOES THE INSTALL CALL ITSELF?
 *
 * This kit is the Node server kit, and it now also runs on Bun. Bun runs Node
 * code, so the same bytes work in both places — which is exactly why the
 * install has to say which one it is on. Two things depend on the answer, and
 * both of them are things a customer sees:
 *
 *   - Their project page names the runtime. An install that says "node" while
 *     running on Bun quietly files a Bun project as an ordinary Node one, and
 *     nobody looking at the dashboard could tell.
 *   - Nine readings cannot be taken on Bun at all — see bunLimits.ts, which
 *     lists each one with its reason. The server shows those as not
 *     measurable rather than promising they are warming up, but it can only
 *     do that if it knows the install is on Bun.
 *
 * WHY THE TAGS ARE CONSTANTS
 *
 * These two strings must match the runtime names the server accepts, and
 * nothing at compile time can check a string in one repo against a list in
 * another. A guard test reads these two declarations out of this file BY NAME
 * and compares them with the server's list, so this stays a leaf module with
 * no imports and no cleverness: the moment the tag becomes computed, the guard
 * that keeps the two ends in step stops being able to read it.
 */

/** What an install on ordinary Node calls itself. */
export const NODE_RUNTIME_TAG = "node";

/** What an install on Bun calls itself. */
export const BUN_RUNTIME_TAG = "bun";

/**
 * Is this process Bun?
 *
 * Asked of `process.versions.bun`, which Bun sets and Node does not. Not
 * guessed from a user agent, an environment variable, or the presence of some
 * Bun-only global that a polyfill could also provide — the version table is
 * the engine describing itself, and it is the same place Bun's own
 * documentation points at.
 *
 * Wrapped, like everything else this kit asks of its host: a kit may never be
 * the reason an app fails to start, and an engine that answers strangely
 * should leave the install filed as plain Node rather than crash it.
 */
export function isBunRuntime(): boolean {
  try {
    const versions = (process as { versions?: Record<string, unknown> })
      .versions;
    const bun = versions?.bun;
    return typeof bun === "string" && bun.length > 0;
  } catch {
    return false;
  }
}

/** Bun's version, or null on anything else. Metadata only — nothing branches
 *  on the number, because a capability this kit needs is asked for directly
 *  rather than inferred from a version. */
export function bunVersion(): string | null {
  try {
    const bun = (process as { versions?: Record<string, unknown> }).versions
      ?.bun;
    return typeof bun === "string" && bun.length > 0 ? bun : null;
  } catch {
    return null;
  }
}

/** The runtime tag this install registers under. */
export function kitRuntimeTag(): string {
  return isBunRuntime() ? BUN_RUNTIME_TAG : NODE_RUNTIME_TAG;
}
