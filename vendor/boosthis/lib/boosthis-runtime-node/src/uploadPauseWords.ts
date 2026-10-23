/**
 * The words for a wait Boosthis asked for. One source for the status page and
 * the worker's status text, so the two can never tell it differently.
 *
 * A 429 is not a refusal. Nothing about the batch was judged: this app's
 * uploads reached Boosthis's allowance for the moment, and Boosthis said how
 * long to wait. The kit keeps what it was about to send and sends it after the
 * wait (uploadPause.ts). So the refusal words ("Refused — batch rejected",
 * "Uploads lost") never describe it, and neither do the network-failure words:
 * Boosthis answered.
 *
 * What the kit drops itself while it waits (more than its queues hold) is
 * counted where every other kit-side drop is, in the kit's own words, and is
 * never folded into Boosthis's refusals.
 *
 * Every byte is written here: no server text, no install id, no developer
 * string. The end time is worked out in this process from the wait Boosthis
 * stated, never quoted from a reply.
 */

import type { UploadPauseScope } from "./uploadPause";

export const UPLOAD_PAUSE_TITLE = "Paused \u2014 Boosthis asked this app to wait";

/** The status page's row label for when the pause ends. */
export const UPLOAD_PAUSE_ENDS_LABEL = "Pause ends";

/** What the pause holds, said plainly. */
function heldText(scope: UploadPauseScope): string {
  switch (scope) {
    case "everything":
      return "nothing is sent to Boosthis until the wait is over";
    case "all-but-crashes":
      return (
        "measurements, job runs and panel snapshots wait until it is over; " +
        "crash reports still go, in the room Boosthis keeps for them"
      );
    default:
      return (
        "measurements wait until it is over; crash reports, job runs and " +
        "panel snapshots still go, in the room Boosthis keeps for them"
      );
  }
}

/** The explanation under the headline. */
export function uploadPauseBody(scope: UploadPauseScope): string {
  return (
    "This is a pause Boosthis asked for, not a refusal: this app's uploads " +
    `reached Boosthis's allowance for the moment, so ${heldText(scope)}. ` +
    "Nothing was rejected \u2014 what this app was about to send stays in " +
    "this process, as much as the kit's queues hold, and goes out by itself " +
    "when the pause ends. Anything over that is counted, never lost silently."
  );
}

/** "14:03:05 UTC (in about 45 seconds)": UTC, the way the page's other times
 *  read. */
export function uploadPauseEndsText(until: number, now: number = Date.now()): string {
  const at = new Date(until);
  const clock = [at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  return `${clock} UTC (${inAbout(until - now)})`;
}

function inAbout(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 90) return `in about ${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.round(seconds / 60);
  return `in about ${minutes} minute${minutes === 1 ? "" : "s"}`;
}
