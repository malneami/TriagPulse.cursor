/** Wrap any async function so its latency lands in the sample buffer.
 *
 * Mirrors the Python `@track_perf("label")` decorator for non-HTTP code
 * paths (background jobs, queue handlers, CLI tools).
 */

import { record } from "./samples";
import { rateDuration } from "./thresholds";
import { routeLabelHasPII } from "./no-pii";
import { callIdentity, noteWatchedCall } from "./repeatedWork";

export function trackPerf<TArgs extends unknown[], TResult>(
  name: string,
  fn: (...args: TArgs) => Promise<TResult> | TResult,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const start = performance.now();
    try {
      return await fn(...args);
    } finally {
      const dur = performance.now() - start;
      // Route-label PII guard: manual labels are developer-provided code-defined
      // keys ("processOrder", "syncInventory"). Any label with whitespace, a UUID,
      // a long numeric ID, an email, JWT, or phone number signals user-derived
      // content and is silently dropped before reaching the sample buffer or logs.
      if (routeLabelHasPII(name) === null) {
        record(name, dur, rateDuration(dur));
      }
      // Repeated-work detector: this is the one wrapper that sees BOTH the call
      // target and its arguments, so it is where "the same call twice in one
      // request" can honestly be recognised. The name + arguments are hashed on
      // this stack and dropped; only the resulting count leaves. Runs whatever
      // the label guard decided — a label we refuse to RECORD is still a real
      // call, and the hash carries no text either way. Never throws.
      noteWatchedCall(callIdentity(name, args), dur);
    }
  };
}

/** Context-manager-style timer for ad-hoc scopes.
 *
 * NOTE: deliberately invisible to the repeated-work detector. `perf()` has no
 * visible inputs — two `perf("db.load_user")` blocks in one request may be two
 * DIFFERENT users — so counting them as identical work would be a guess. Use
 * `trackPerf(name, fn)` where the arguments matter.
 */
export async function perf<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const dur = performance.now() - start;
    // Route-label PII guard: same as trackPerf — silently skip if the label
    // contains whitespace or other PII-risk patterns.
    if (routeLabelHasPII(name) === null) {
      record(name, dur, rateDuration(dur));
    }
  }
}
