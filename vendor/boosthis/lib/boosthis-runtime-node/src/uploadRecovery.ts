/** Queue submitters distinguish a final payload refusal from a retry. */
export type QueueAnswer = number | { accepted: number; undelivered: "refused" | "retry" };

let readiness: (() => boolean) | null = null;

export function setUploadReadiness(check: (() => boolean) | null): void {
  readiness = check;
}

/** Standalone emitters have no activation gate. A registered client installs
 * its own readiness check before any queue is drained. */
export function uploadsReady(ending = false): boolean {
  // The last flush must try the old register-then-send path.
  if (ending) return true;
  try {
    return readiness ? readiness() : true;
  } catch {
    return false;
  }
}
