/* ─── Boosthis: a process with no web server is still a project ────────────
 *
 * Everything this kit offers used to hang off a web server. `boosthis()` is
 * middleware, so it needs a framework; the kit's own status page is served on
 * the app's port, so it needs a port; and the whole shape of the thing assumed
 * a request would eventually arrive.
 *
 * A queue consumer has none of that. It listens on nothing, it answers nobody,
 * and it can run for months doing the most important work in the system. Until
 * now such a process could not be measured at all — and worse, a customer who
 * split their back end into "the web app" and "the workers" saw only half of
 * it and had no way to tell that the other half was missing rather than idle.
 *
 * `boosthisWorker()` is that half. It is the whole kit minus the middleware:
 *
 *   • IDENTITY — the same install id and project key as any other install, so
 *     a worker is a project in its own right on the dashboard, not an
 *     appendage of the web app. Two processes sharing one project key are two
 *     installs of one project, which is exactly what they are.
 *   • REGISTRATION — the ordinary handshake. It was never request-driven;
 *     nothing had to change.
 *   • UPLOADING — the ordinary timer-driven mirror, which likewise never
 *     needed a request. What DID need saying is that a worker has no reason to
 *     ever call the middleware, so the meters that arm at the request boundary
 *     are armed here instead.
 *   • THE KIT'S OWN STATUS SURFACE — the part that genuinely could not work.
 *     With no port there is nothing to serve a page on, so the same facts the
 *     page shows are rendered as TEXT and printed. A developer who cannot see
 *     their worker on the dashboard needs the same answers as everyone else,
 *     and "open the status page" is not one of them here.
 *
 * WHAT IT DOES NOT DO. It never starts, schedules or triggers any work. It
 * does not create a queue, connect to Redis, or hold the process open: every
 * timer it owns is unreferenced, so a worker that finishes its work still
 * exits when it always did.
 */

import {
  enableTelemetry,
  type TelemetryClient,
  type TelemetryOptions,
} from "./telemetry";
import { setDeclaredServerKind } from "./serverKind";
import { armJobSystems } from "./jobAdapters";
import { isBoosthisDisabled } from "./runtimeFlags";
import { collectStatusFacts, type StatusFacts } from "./statusPage";
import { serverKindLabel } from "./serverKind";
import {
  announceKitStart,
  beginStartAnnouncement,
  flushHeldRefusals,
} from "./startAnnounce";
import { resolveProjectKey } from "./projectKey";
import { uploadPauseEndsText } from "./uploadPauseWords";

export interface WorkerOptions extends TelemetryOptions {
  /**
   * Print the kit's status as text once, shortly after start-up.
   *
   * ON by default, and deliberately so. A worker has no status page, no
   * bubble, and no browser tab — if the kit cannot register, the ONLY place a
   * developer would ever find out is a line like this one. Set it to false in
   * a process whose logs must stay silent; the same text is always available
   * on demand from {@link workerStatusText}.
   */
  announceStatus?: boolean;
  /**
   * How long to wait before printing that status, in ms. The default gives
   * registration a chance to complete first, so the line reports what actually
   * happened rather than "not registered yet" on every healthy start.
   */
  announceAfterMs?: number;
}

/** Default delay before the status line. Long enough for the handshake on a
 *  cold start, short enough that a developer watching the logs sees it. */
const DEFAULT_ANNOUNCE_MS = 5_000;

/**
 * The kit's own status, as plain text.
 *
 * The same facts the status page renders, for a process that has nowhere to
 * serve a page. Multi-line, no colour, no escaping — meant for a log.
 *
 * Never throws: every reading it cannot take is reported as not known rather
 * than left out, because a worker with nothing to show is precisely the case
 * this text exists for.
 */
export function workerStatusText(facts?: StatusFacts): string {
  let f: StatusFacts;
  try {
    f = facts ?? collectStatusFacts();
  } catch {
    return (
      "[boosthis] Worker status: cannot tell. The kit could not read its own " +
      "state, so nothing here should be taken as either working or broken."
    );
  }
  const lines: string[] = [];
  const say = (k: string, v: string): void => {
    lines.push(`[boosthis]   ${k}: ${v}`);
  };

  // The headline first, in the same three-outcome shape every other surface
  // uses: a question we could not answer is never printed as a No.
  const verdict =
    f.registrationVerdict === "registered"
      ? "registered"
      : f.registrationVerdict === "unregistered"
        ? "NOT registered"
        : "cannot tell right now";
  lines.push(`[boosthis] Worker status: ${verdict}.`);

  say("Project", f.projectDisplay ?? "not received yet");
  say("Install ID", f.installId ?? "not assigned yet");
  say(
    "Project key",
    f.projectKeyDisplay
      ? `${f.projectKeyDisplay} — ${f.projectKeySource ?? "source unknown"}`
      : (f.projectKeySource ?? "no project key configured"),
  );
  say("Sharing", f.sharing ? "on" : "off");
  say("Mode", f.fullTelemetry ? "full telemetry" : "private (issues only)");
  say(
    "Last upload",
    f.lastUploadAt === null
      ? "none yet"
      : new Date(f.lastUploadAt).toISOString(),
  );
  // Only while Boosthis has asked this process to wait (a 429): a wait, not a
  // failure, and the one line that says when uploads start again.
  const now = Date.now();
  if (f.uploadPausedUntil != null && f.uploadPausedUntil > now) {
    say(
      "Uploads paused",
      `until ${uploadPauseEndsText(f.uploadPausedUntil, now)} — Boosthis asked ` +
        "this app to wait; nothing was rejected, and what is waiting goes " +
        "out by itself",
    );
  }
  // Only printed once something HAS failed. A permanent "failures: 0" line
  // teaches a reader to skip the place the real failure will appear.
  if (f.lastUploadFailAt !== null && f.lastUploadFailReason !== null) {
    say(
      "Last upload FAILED",
      `${new Date(f.lastUploadFailAt).toISOString()} — ${f.lastUploadFailReason}` +
        ` (${f.uploadsDropped} lost so far)`,
    );
  }
  if (f.rowsDropped > 0 && f.rowsDroppedText !== "") {
    say("Measurements dropped", f.rowsDroppedText);
  }
  say("Kit version", f.kitVersion);
  say("Runtime", `${f.runtime} · ${f.serverLabel ?? serverKindLabel("worker")}`);
  // A portless worker has no page to open, so the text printout is the only
  // place it can be told where it runs — and whether these numbers came from a
  // preview.
  say(
    "Where it runs",
    f.hostingIsPreview ? `${f.hostingLine} — NOT production` : f.hostingLine,
  );
  say("Dashboard", f.dashboardUrl);
  if (f.refusalSentence) say("Refused", f.refusalSentence);
  return lines.join("\n");
}

/**
 * Start Boosthis in a process with no web server.
 *
 * Everything `enableTelemetry` gives an ordinary install, plus the three
 * things a portless process needs: the job systems armed (the request boundary
 * that normally does it will never run), the server kind declared as a worker
 * (nothing can DETECT the absence of a server, so it has to be said), and the
 * kit's status printed as text since there is no page to open.
 *
 * Returns the same client an ordinary install gets.
 */
export function boosthisWorker(opts: WorkerOptions): TelemetryClient {
  // The same ungated anchor line every other entry point prints, for the same
  // reason: no line means this call never ran, and nothing about keys or
  // networks matters until it does. A worker needs it MORE than a web app —
  // there is no preview to look at and no badge to notice missing.
  try {
    beginStartAnnouncement();
    announceKitStart(
      resolveProjectKey(opts.inviteKey).key,
      // A worker has no page to draw a badge on. Reporting it as visible would
      // send a developer looking for something that can never appear.
      "hidden-by-setting",
    );
  } catch {
    try {
      flushHeldRefusals();
    } catch {
      /* nothing more can be said */
    }
  }

  // Say what this process IS. Detection cannot do it: no framework in the
  // module cache is equally consistent with a worker and with a plain Node
  // server that has not loaded one yet, and guessing would file every worker
  // under "unrecognised server".
  try {
    setDeclaredServerKind("worker");
  } catch {
    /* a diagnostic label never blocks start-up */
  }

  const client = enableTelemetry(opts);

  // The request boundary is the usual place these arm, and it will never run
  // here. Without this a worker measures nothing at all.
  try {
    armJobSystems();
  } catch {
    /* arming must never break the worker */
  }

  // REGISTER NOW, rather than waiting for something to measure.
  //
  // In a web app registration is lazy on purpose: the first request is proof
  // the app is really serving, and an app that never serves is not yet worth a
  // row on anyone's dashboard. A worker has no first request. Left lazy, a
  // worker that had not yet been handed a job would never knock at all — the
  // dashboard would show nothing, this file's own status line would say "NOT
  // registered", and a developer would have no way to tell an install that is
  // waiting for work from one that is broken. Those are the two states this
  // whole entry point exists to keep apart.
  //
  // The process being up IS the signal here, so the knock happens on start.
  // It costs one request per worker start-up and it is what makes a queue
  // consumer with an empty queue a visible project rather than an absence.
  try {
    void client.consent().catch(() => {
      /* the retry timer inside the client owns getting this right; a worker
         must never fail to start because Boosthis could not be reached */
    });
  } catch {
    /* registration is never allowed to break the host's worker */
  }

  const announce = opts.announceStatus ?? true;
  if (announce && !isBoosthisDisabled()) {
    try {
      const delay = Math.max(0, opts.announceAfterMs ?? DEFAULT_ANNOUNCE_MS);
      const timer = setTimeout(() => {
        try {
          console.info(workerStatusText());
        } catch {
          /* a host that replaced console must not break the worker */
        }
      }, delay);
      // UNREFERENCED on purpose: a short-lived worker that finishes before the
      // delay is up must still exit exactly when it always did. A meter that
      // holds a process open has changed what the customer's program does.
      const t = timer as unknown as { unref?: () => void };
      if (typeof t.unref === "function") t.unref();
    } catch {
      /* the status line is a convenience, never a requirement */
    }
  }

  return client;
}
