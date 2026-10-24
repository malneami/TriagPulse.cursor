/** What the framework-free attach is doing, in one leaf module.
 *
 * Kept apart from the attach itself so the status page can read it without
 * importing the code that patches the server (the attach imports the
 * middleware, the middleware imports the page's answers — a page that imported
 * the attach would close that ring). Nothing here does anything: it holds the
 * verdict, the counters and the one sentence the kit says when it cannot
 * attach at all.
 */

import { detectServerKind, type ServerKind } from "./serverKind";

/**
 * Why the kit could not attach. A CLOSED, code-defined set — the kit's own
 * words, never a message from somewhere else.
 *
 *   no-node-http            no `node:http` in this process, so there is no
 *                           request boundary to watch
 *   deno-runtime            this is Deno, not Node. (Bun is NOT refused: it
 *                           implements node:http and the attach works there,
 *                           so it goes down the ordinary path and is judged by
 *                           whether the patch actually takes.)
 *   edge-runtime            this is Next.js's edge runtime, which never starts
 *                           a Node HTTP server
 *   server-dispatch-locked  Node is here, but its server event dispatch could
 *                           not be observed (frozen, sealed, or replaced)
 *
 * EACH REASON NAMES ONE THING. This set used to carry a general
 * `other-runtime`, and a general reason is how Bun — an engine this kit
 * supports, ships an engine tag for, and proves against a live app — ended up
 * being told it was unsupported: it shared a bucket, and therefore a sentence,
 * with Deno. A refusal that cannot name exactly what it is refusing has no
 * business being said out loud, so a new runtime gets its own member here
 * rather than being folded into somebody else's.
 */
export type AttachRefusal =
  | "no-node-http"
  | "deno-runtime"
  | "edge-runtime"
  | "server-dispatch-locked";

/** What the status page and the proof rigs read. */
export interface AttachState {
  /** True once `attach()` has been called at all. */
  called: boolean;
  attached: boolean;
  reason: AttachRefusal | null;
  serverKind: ServerKind;
  /** Requests handed to the measuring path since the attach went on. */
  requestsObserved: number;
  /** Kit-owned reads (page, badge poll, status page) answered from the
   *  boundary. Counted separately: they are the kit talking to itself and are
   *  deliberately NOT measured. */
  kitReadsServed: number;
}

let called = false;
let attached = false;
let refusal: AttachRefusal | null = null;
let requestsObserved = 0;
let kitReadsServed = 0;

/**
 * The plain sentence the kit says when it cannot attach.
 *
 * Pure builder, so the wording is testable without a process that actually
 * refuses. Same voice as every other thing the kit cannot do: name the fact,
 * name the cause, say what it means — one line, at startup, ungated.
 */
export function cannotAttachLine(reason: AttachRefusal): string {
  const cause: Record<AttachRefusal, string> = {
    "no-node-http":
      "this process has no Node HTTP server to watch (node:http is unavailable)",
    "deno-runtime":
      "this app is running on Deno, whose node:http compatibility Boosthis has not proved against a real app, so it is not supported yet (Bun IS supported — it runs this same kit, unchanged)",
    "edge-runtime":
      "this code is running on Next.js's edge runtime, which never starts a Node server — run Boosthis from the Node.js runtime instead",
    "server-dispatch-locked":
      "this process will not let Boosthis watch its HTTP server (the server's event dispatch cannot be replaced)",
  };
  return (
    `[boosthis] Boosthis could not attach to this app's server: ${cause[reason]}. ` +
    "No request will be timed and the in-app page will not be served until this is fixed. " +
    "Nor will this app register on the strength of an attach that did not happen: it cannot " +
    "sit on your dashboard as a healthy install that is silently measuring nothing. If " +
    "something else in this process does have readings to file, it registers and files this " +
    "refusal alongside them. Nothing else about your app is affected."
  );
}

/** Short, page-sized version of the same fact. Used on the status page, where
 *  the full sentence would not fit a value column. */
export function cannotAttachShort(reason: AttachRefusal): string {
  switch (reason) {
    case "no-node-http":
      return "No — no Node HTTP server in this process";
    case "deno-runtime":
      return "No — this is Deno, which is not supported yet";
    case "edge-runtime":
      return "No — Next.js edge runtime, not Node";
    case "server-dispatch-locked":
      return "No — this process will not let Boosthis watch its server";
  }
}

/** Record the outcome of an attach attempt. */
export function noteAttachOutcome(
  outcome: { attached: true } | { attached: false; reason: AttachRefusal },
): void {
  called = true;
  attached = outcome.attached;
  refusal = outcome.attached ? null : outcome.reason;
}

/** One more request handed to the measuring path. */
export function noteAttachedRequest(): void {
  requestsObserved++;
}

/** One more kit-owned read answered straight from the boundary. */
export function noteKitReadServed(): void {
  kitReadsServed++;
}

/**
 * Has this process already decided it will not watch its own server?
 *
 * True only after a REAL refusal: `attach()` was called and answered no. Never
 * true for an app that simply does not use `attach()` (an Express app on the
 * middleware, a worker, a function handler), and never true while the attach
 * is still to come.
 *
 * Exists so the registration path can tell the difference between "nothing has
 * been measured YET" and "nothing will EVER be measured here". The first is the
 * ordinary state of a process one millisecond after boot; the second is a
 * decision this kit has already taken, and registering an install on the back
 * of it is how a Bun service ended up on a dashboard looking healthy and
 * permanently empty. Never throws.
 */
export function attachWasRefused(): boolean {
  return called && !attached && refusal !== null;
}

/** What the attach is doing right now. Never throws. */
export function attachState(): AttachState {
  let serverKind: ServerKind = "unknown";
  try {
    serverKind = detectServerKind();
  } catch {
    serverKind = "unknown";
  }
  return { called, attached, reason: refusal, serverKind, requestsObserved, kitReadsServed };
}

/** @internal test hook */
export function _resetAttachStatusForTests(): void {
  called = false;
  attached = false;
  refusal = null;
  requestsObserved = 0;
  kitReadsServed = 0;
}
