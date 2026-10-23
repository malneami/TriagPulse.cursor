/** The Node server setups this kit is PROVEN to measure, the exact wiring for
 *  each one, and — for every framework our guides name — which HOSTING SHAPES
 *  that wiring has actually been run on.
 *
 * WHY THIS FILE EXISTS
 *
 * The install instructions are followed by an AI agent working unsupervised
 * inside a customer's codebase. A guessed instruction there does not read as a
 * guess: it ships as a broken install that still looks healthy — panel up,
 * project registered, per-request readings empty forever. So the recipes are
 * not prose written from memory. Each entry names a setup that a real, running
 * app of that kind proved: started for real, driven with real traffic, and
 * confirmed to file real per-request rows (`scripts/live-proofs/node-any-server`).
 *
 * This list is the ONE source of truth. The served install steps, the kit's
 * INSTALL.md, the README and the proof gate all read it, so a setup can never
 * be advertised in one place and unproven in another: the gate fails the build
 * when an entry here has no passing arm in the proof record.
 *
 * ADDING A SETUP: prove it first (add an arm, re-record), then add it here.
 * Never the other way round.
 *
 * WHY A RECIPE IS NOT AN ANSWER ON ITS OWN
 *
 * Every recipe above is a recipe for a server the project STARTS and KEEPS: a
 * process that owns its own `http.Server`. That is not where a large share of
 * these projects run. A Next.js app on Vercel has no server file of its own,
 * so the Next recipe has nothing to go in; and a framework route handler is
 * not the bare `(event, context)` handler `withBoosthis` wraps. Naming the
 * framework and naming the host separately let a reader combine two true
 * sentences into a promise we cannot keep, which is why the answer here is
 * keyed by framework AND hosting shape, and why "no path" is a written answer
 * with a reason and a door rather than an absence.
 */

import type { ServerKind } from "./serverKind";
import type { PlatformCode } from "./serverless";
import {
  PLATFORM_AWS_LAMBDA,
  PLATFORM_VERCEL,
  PROVEN_PLATFORMS,
  platformName,
  recognisedUnprovenFunctionPlatforms,
} from "./serverless";

export interface SupportedSetup {
  /** The tag the kit reports for this setup. */
  readonly id: Exclude<ServerKind, "unknown">;
  /** How the setup is named to a human. */
  readonly label: string;
  /** The arm of the live proof that keeps this entry honest. */
  readonly proofArm: string;
  /** Where in the project the wiring goes, in one line. */
  readonly where: string;
  /** The lines to add, exactly as the proof arm runs them. */
  readonly code: readonly string[];
  /** Anything true and non-obvious about this setup. */
  readonly note?: string;
}

/** WHERE a Node back end runs, as far as measurement is concerned.
 *
 *  Deliberately a HOST and not a shape. "It is a function host" does not
 *  decide the answer, and treating it as if it did is how the two true
 *  sentences combined into a false one: the kit only runs on a function host
 *  it has been PROVEN on, and what has a path on one proven host is not
 *  automatically what has a path on the next.
 *
 *  - `long-running` — the project starts a Node process and keeps it. It owns
 *    an `http.Server`; timers fire; `attach()` and the Express middleware both
 *    have somewhere to sit. Containers frozen BETWEEN requests (Cloud Run,
 *    Firebase App Hosting, Replit autoscale) are still this shape: the process
 *    survives, so the kit keeps its identity and sends at the request
 *    boundary.
 *  - `vercel`, `lambda` — one column each for the two function hosts the kit
 *    is proven on. The code runs per invocation and is frozen the moment it
 *    answers, so nothing the kit gathers survives unless it was sent INSIDE
 *    the invocation.
 *  - `named-unproven-function-host` — a function host the kit's own detection
 *    can NAME but has not been proven on. It names it, says why, and stops.
 *  - `unrecognised-function-host` — a function host detection has no marker
 *    for. This column exists because the one above was written as if it
 *    covered every other host, and it does not: with no marker there is no
 *    detection, so nothing refuses. The kit starts as if this were an
 *    ordinary Node server and reports almost nothing — the silent failure,
 *    arriving through the very sentence meant to prevent it. */
export type HostingTarget =
  | "long-running"
  | "vercel"
  | "lambda"
  | "named-unproven-function-host"
  | "unrecognised-function-host";

export const HOSTING_TARGETS: readonly HostingTarget[] = [
  "long-running",
  "vercel",
  "lambda",
  "named-unproven-function-host",
  "unrecognised-function-host",
];

/** The platform code behind each proven function column, so a column is tied
 *  to the kit's own detection rather than to a word in a heading. The claim
 *  gate checks this against PROVEN_PLATFORMS in both directions: a platform
 *  the kit starts to accept without a column here fails the build. */
export const TARGET_PLATFORM: Readonly<Partial<Record<HostingTarget, PlatformCode>>> = {
  vercel: PLATFORM_VERCEL,
  lambda: PLATFORM_AWS_LAMBDA,
};

/** How a human is told which host is being talked about. The two function
 *  columns take the kit's own name for the platform, so a column can never be
 *  headed by a host the kit does not recognise. */
export const HOSTING_TARGET_LABELS: Record<HostingTarget, string> = {
  "long-running": "A Node server you start and keep",
  vercel: platformName(PLATFORM_VERCEL),
  lambda: platformName(PLATFORM_AWS_LAMBDA),
  "named-unproven-function-host": "A function host the kit names but has not proven",
  "unrecognised-function-host": "A function host the kit cannot recognise",
};

/** The same host, named mid-sentence. Kept apart from the column heading
 *  because lower-casing a heading turns two product names into words. */
export const HOSTING_TARGET_IN_PROSE: Record<HostingTarget, string> = {
  "long-running": "a Node server you start and keep",
  vercel: platformName(PLATFORM_VERCEL),
  lambda: platformName(PLATFORM_AWS_LAMBDA),
  "named-unproven-function-host": "a function host the kit names but has not proven",
  "unrecognised-function-host": "a function host the kit cannot recognise",
};

/** The hosts the refusal column actually covers, named. Derived from the
 *  kit's own detection so the sentence can never be wider than the markers
 *  behind it — the exact way "any other function host" became false. */
export function namedUnprovenFunctionHostNames(): string[] {
  return recognisedUnprovenFunctionPlatforms().map((code) => platformName(code));
}

/** The wiring a cell claims. Named because the claim and the recorded run
 *  have to be the same thing: an Express app measured on Vercel does not earn
 *  "wrap your handler on Vercel", and the gate checks the cited arm really
 *  drove the wiring named here. */
export type Wiring = "express-middleware" | "wrapped-handler" | "attach" | "none";

/** Why an answer is not "proven". Written once per REASON rather than once per
 *  framework: a reason reworded nine times is nine claims to keep true. */
export type ReasonKey =
  | "next-on-vercel"
  | "framework-owns-the-request"
  | "host-not-proven"
  | "host-not-recognised";

/** What a `proven` cell was proven AGAINST — the part a single word hides.
 *
 *  `real-run`: a real app of that kind, started and driven on that host, rows
 *  arriving. That is what the long-running column holds.
 *  `contract-reproduced`: the host's published contract — its environment
 *  markers, its handler signature, its freeze-on-response — reproduced on our
 *  own machine against the shipped kit, because we hold no account on that
 *  host and have never published to it. The rig says so in its own record and
 *  the claim gate holds the word to it. Real evidence, and not a deployment:
 *  calling both "proven" is how a reader is told we ran on Vercel. */
export type Evidence = "real-run" | "contract-reproduced";

/** One framework's answer for one host.
 *
 *  A refusal is a real answer with a reason and a door, never a blank cell: an
 *  unjudged combination reads as a promise, and the failure it produces is the
 *  silent one — registered, panel up, not one request ever timed. */
export interface HostingAnswer {
  readonly target: HostingTarget;
  /** `proven` — a rig arm ran THIS framework, on THIS host, with THIS wiring,
   *  and the measurements arrived. `evidence` says against what.
   *  `generic` — no recipe of its own; the plain-Node line applies where the
   *  app ends in a server you start, and we have never run it ourselves.
   *  `none` — there is no path, and the reason and the doors are written.
   *  `refused` — the kit itself declines to start here and says so.
   *  `unrefused` — the kit does NOT decline, and that is the problem: it
   *  cannot tell it is on a function host, so it starts, registers and
   *  reports almost nothing. The one answer a reader must not mistake for
   *  either a path or a refusal. */
  readonly answer: "proven" | "generic" | "none" | "refused" | "unrefused";
  /** The table cell, minus its verdict: one short clause, not a paragraph. */
  readonly short: string;
  /** Proven: what the evidence behind it actually is. Required there, and the
   *  gate checks it against the cited rig's own statement of scope. */
  readonly evidence?: Evidence;
  /** Proven / generic: the wiring, in one line a developer can act on. */
  readonly how?: string;
  /** Proven / refused: which wiring the cited run drove. */
  readonly wiring?: Wiring;
  /** Proven / refused: the rig arms that earn it, each as `rig:arm`. The claim
   *  gate looks every one up in that rig's own record AND checks the run was
   *  on this host with this wiring. */
  readonly proof?: readonly string[];
  /** No path / refused: which written reason applies. */
  readonly reason?: ReasonKey;
}

/** Every framework our guides name, and what is true of it per host.
 *  A framework named anywhere in the kit's own guides must appear here, and
 *  the claim gate checks both directions. */
export interface FrameworkAnswer {
  readonly name: string;
  /** Every spelling a guide may use for this framework. The claim gate scans
   *  prose for these, so a sentence cannot name a framework under a second
   *  name and escape the check. `name` counts without being repeated here. */
  readonly aliases?: readonly string[];
  /** The setup above whose recipe this framework uses, when it has one. */
  readonly setupId?: Exclude<ServerKind, "unknown">;
  /** Exactly one entry per host in HOSTING_TARGETS. */
  readonly hosting: readonly HostingAnswer[];
}

/** Every kit-owned page and read lives under this prefix. */
export const KIT_BASE_PATH = "/_boosthis";

const IMPORT_ATTACH = 'import { attach, enableTelemetry } from "@workspace/boosthis-runtime-node";';

const TELEMETRY_LINES = [
  "enableTelemetry({",
  '  installId: "<a stable UUID v4 generated ONCE and reused>",',
  "  inviteKey: process.env.BOOSTHIS_INVITE_KEY,",
  '  endpoint: "https://www.boosthis.com/api",',
  '  appName: "My Service",',
  "});",
];

export const SUPPORTED_SERVER_SETUPS: readonly SupportedSetup[] = [
  {
    id: "express",
    label: "Express",
    proofArm: "express",
    where:
      "the file that builds the Express app, before the routes are registered",
    code: [
      'import { boosthis, mount, enableTelemetry } from "@workspace/boosthis-runtime-node";',
      "",
      "app.use(boosthis({ bubble: true })); // before your routes",
      "mount(app);                          // in-app page at /_boosthis",
      "",
      ...TELEMETRY_LINES,
    ],
    note:
      "Unchanged. An Express project that is already wired this way needs no edit — " +
      "`attach()` is for projects that are not Express, and an Express app may use either. " +
      "`mount(app)` is the optional second line: the middleware alone serves the status " +
      "page and the badge reads, and mounting adds the in-app page at /_boosthis plus the " +
      "local JSON reads. Leave it out and those addresses say so themselves rather than " +
      "falling through to your own 404.",
  },
  {
    id: "next",
    label: "Next.js",
    proofArm: "next",
    where:
      "the custom server file that creates the Node server, before the server is created " +
      "(a Next app without a custom server file needs one — the standard `createServer` + " +
      "`getRequestHandler()` file from the Next docs)",
    code: [
      IMPORT_ATTACH,
      "",
      "attach(); // before the server is created",
      "",
      ...TELEMETRY_LINES,
    ],
    note:
      "Node runtime only. Routes running on the edge runtime are a different runtime with no " +
      "Node server in it, and the kit says so instead of pretending: it refuses to attach and " +
      "names the reason at startup.",
  },
  {
    id: "fastify",
    label: "Fastify",
    proofArm: "fastify",
    where: "the entry file, before the Fastify instance is created",
    code: [IMPORT_ATTACH, "", "attach(); // before Fastify is created", "", ...TELEMETRY_LINES],
    note: "No Fastify plugin to register, and no change to the app's own hooks.",
  },
  {
    id: "hono",
    label: "Hono (Node adapter)",
    proofArm: "hono",
    where: "the entry file, before `serve()` is called",
    code: [
      IMPORT_ATTACH,
      "",
      'attach({ serverKind: "hono" }); // before serve()',
      "",
      ...TELEMETRY_LINES,
    ],
    note:
      "Pass `serverKind: \"hono\"` exactly as shown. Hono is the one setup the kit cannot name " +
      "by itself, and the name is only a label on the project page — the measurements do not " +
      "depend on it, but without the hint the page would call a Hono app a plain Node server.",
  },
  {
    id: "nest",
    label: "NestJS",
    proofArm: "nest",
    where: "the bootstrap file, before `NestFactory.create(...)`",
    code: [
      IMPORT_ATTACH,
      "",
      "attach(); // before NestFactory.create()",
      "",
      ...TELEMETRY_LINES,
    ],
    note:
      "Works on either Nest adapter (Express or Fastify) and needs no Nest middleware, " +
      "interceptor or module.",
  },
  {
    id: "node-http",
    label: "Plain Node server",
    proofArm: "plain-node",
    where: "the entry file, before `createServer(...)`",
    code: [IMPORT_ATTACH, "", "attach(); // before createServer()", "", ...TELEMETRY_LINES],
    note:
      "This is also the answer for any framework not named above: anything that ends in a Node " +
      "server is measured. It is named `node-http` on the project page because the kit will not " +
      "claim to recognise a framework it cannot see.",
  },
];

/* ─── Where each framework actually runs ──────────────────────────────── */

/** The doors out of a refused combination.
 *
 *  Written once, because a door that is worded differently on each surface is
 *  two promises. Each one states what it does NOT cover in the same breath:
 *  an alternative offered without its limit is the same over-promise a layer
 *  down, and the second door in particular measures a completely different
 *  half of the app. No door is "try the recipe anyway". */
/** The first door is the only one that sends a reader back to the table, so it
 *  is the only one that can hand out the table's strongest word by accident.
 *  It is written as a function for that reason: which frameworks have a recipe
 *  we have actually run, and which have only the generic Plain Node line, is
 *  read off the register at call time rather than typed here. */
const doorRunItAsAServer = (): string =>
  "Run the app as a Node server you start yourself — any host that runs `node …` and " +
  "keeps the process (a container or VM host: Cloud Run, Render, Fly.io, Railway, your " +
  "own machine). Where the table above says proven on a real run, that framework's own " +
  "recipe then applies unchanged. For " +
  `${asList(genericOnAServerFrameworkNames())} it does not: the table gives them no recipe ` +
  "of its own, so what applies is the generic Plain Node server line, and we have never " +
  "run those frameworks ourselves. What it does not cover: anything you leave behind on " +
  "the function host stays unmeasured, this is a hosting change rather than a setting, " +
  "and where the table gives a framework no recipe of its own you are getting the " +
  "plain-Node line, not an answer anybody has taken on that framework.";

const DOOR_BROWSER_KIT =
  "Measure the browser half instead, with the Boosthis browser kit: it is a tag on the " +
  "page and does not care who hosts the app, Vercel included. What it does not cover: " +
  "the server side. No per-request timings for your routes, no database or queue work, " +
  "no background jobs, and nothing that never reaches a browser.";

/** The third door exists only where the kit refuses the HOST rather than the
 *  combination: there is nothing to rewire, so the only thing left is to ask
 *  — and to be told plainly that asking changes nothing today. */
const DOOR_ASK_US_TO_PROVE_THE_HOST =
  "Where the kit refused the host outright: ask us to prove it — support@boosthis.com, " +
  "naming the host. What it does not cover: nothing changes while you wait. The kit stays " +
  "switched off there, the app runs exactly as it did before, and we will not switch it on " +
  "until a recorded run on that host shows the measurements really arrive.";

/** The fourth door is for the column where nothing stopped the install. It is
 *  the only door that changes the kit's behaviour, and what it buys is a
 *  refusal — worth saying plainly, because a switch that turns something OFF
 *  reads like a switch that turns something on. */
const DOOR_TELL_THE_KIT_IT_IS_A_FUNCTION =
  "Where the kit did not recognise the host: set `BOOSTHIS_SERVERLESS=1` in that " +
  "environment. The kit then refuses to start there, exactly as it does on a function " +
  "host it can name, instead of registering an install that reports almost nothing. What " +
  "it does not cover: it does not make the host work — it makes the kit stop, so nothing " +
  "measured is the answer you see rather than the answer you discover a month later.";

/** The written reasons. One per reason, not one per framework: nine reworded
 *  copies of the same fact are nine things to keep true, and the differences
 *  between them are where a promise creeps back in. Each takes the list of
 *  combinations it is speaking for, so a reader always knows which cells it
 *  answers for. */
export const REASONS: Record<
  ReasonKey,
  { readonly title: string; readonly text: (combinations: string) => string }
> = {
  "next-on-vercel": {
    title: "No custom server file, and a route handler is not a bare handler",
    text: (combinations) =>
      `${combinations}. Vercel never runs a custom server file, so the Next.js recipe has ` +
      "no file to go in — and a Next.js route handler or page is not the bare " +
      "`(event, context)` handler `withBoosthis()` wraps, so there is nowhere to send from " +
      "before the invocation freezes. Next's own `instrumentation.ts` hook does run early " +
      "enough to patch the server in a Next app you host yourself, but on Vercel each route " +
      "is served by the platform's own runtime, which we cannot get inside and have never " +
      "recorded. Unsupported rather than untested: `docs/decisions/next-on-vercel.md` says " +
      "what would reopen it.",
  },
  "framework-owns-the-request": {
    title: "The adapter owns the request, and the kit is not inside it",
    text: (combinations) =>
      `${combinations}. On a function host each of these is deployed through an adapter ` +
      "that hands the framework a request with no Node server of yours in the process, so " +
      "there is nothing for `attach()` to watch — and their route handlers are not the bare " +
      "`(event, context)` handler `withBoosthis()` wraps, so there is nowhere to send from " +
      "before the invocation freezes. We have never recorded a run of any of these " +
      "combinations.",
  },
  "host-not-proven": {
    title: "The kit refuses a function host it can name but has not proven",
    text: (combinations) =>
      `${combinations} — exactly ${asList(namedUnprovenFunctionHostNames())} today, the ` +
      "function hosts the kit's own detection can name and has not been proven on. It names " +
      "the host, prints why, and stops: nothing registers, nothing is measured, and no " +
      "dashboard shows a project that looks measured and is not. That is the kit's own " +
      "behaviour and it is recorded (`scripts/live-proofs/serverless-invocation`, arm " +
      "`unproven-platform-refused`), not advice — following the Express or bare-handler " +
      "recipe on such a host changes nothing, because the refusal happens before either of " +
      "them can report. This list is the whole of the refusal: a host not on it is the next " +
      "column, not this one.",
  },
  "host-not-recognised": {
    title: "A host the kit cannot name does not get refused — it gets misread",
    text: (combinations) =>
      `${combinations}. Detection reads the host's own environment markers, so the only ` +
      `function hosts it knows of are the ones it has markers for: ${asList(
        provenFunctionHostNames(),
      )}, which it runs on, and ${asList(namedUnprovenFunctionHostNames())}, which it ` +
      "refuses. Anywhere else there is nothing to read: the kit sees an ordinary Node process, " +
      "does NOT refuse, starts, registers and then loses almost everything it gathers when " +
      "the invocation freezes — the silent half-measured install this whole table exists to " +
      "prevent. An unrecognised function host is unsupported even though nothing stops the " +
      "kit from starting there. Setting `BOOSTHIS_SERVERLESS=1` tells the kit what it cannot " +
      "detect, and it then " +
      "refuses by the same path as the column before this one; it is a way to make the kit " +
      "stop, not a way to make it work.",
  },
};

/** The same answer on every row: the kit refuses the HOST, so the framework
 *  in front of it changes nothing. Written once and shared, because ten
 *  reworded copies of one behaviour are ten chances to describe it wrongly. */
const REFUSED_BY_HOST: HostingAnswer = {
  target: "named-unproven-function-host",
  answer: "refused",
  short: "The kit names the host and stops before it registers.",
  wiring: "none",
  reason: "host-not-proven",
  proof: ["serverless-invocation:unproven-platform-refused"],
};

/** The same again for the host nobody detected — and the opposite behaviour.
 *  Shared for the same reason, and kept beside its neighbour so the two can
 *  never be collapsed back into one column: the difference between them is
 *  whether anything stops the install at all. */
const NOT_RECOGNISED_BY_HOST: HostingAnswer = {
  target: "unrecognised-function-host",
  answer: "unrefused",
  short:
    "Nothing stops the install: the kit reads no marker, starts as if on an ordinary " +
    "Node server, and loses what it gathers when the invocation freezes.",
  wiring: "none",
  reason: "host-not-recognised",
};

/** A framework that owns the request, on a proven function host: there is a
 *  host, the kit runs — and still nowhere for this framework to attach. */
const ownsTheRequest = (target: "vercel" | "lambda"): HostingAnswer => ({
  target,
  answer: "none",
  short: "The adapter hands the framework the request; no server of yours, and no bare handler.",
  reason: "framework-owns-the-request",
});

export const FRAMEWORK_ANSWERS: readonly FrameworkAnswer[] = [
  {
    name: "Express",
    setupId: "express",
    hosting: [
      {
        target: "long-running",
        answer: "proven",
        short: "`app.use(boosthis())` before your routes.",
        how: "`app.use(boosthis())` before your routes.",
        wiring: "express-middleware",
        evidence: "real-run",
        proof: ["node-any-server:express"],
      },
      {
        target: "vercel",
        answer: "proven",
        short: "The same middleware, unchanged.",
        how:
          "The same middleware, unchanged — `boosthis()` already sits on the request " +
          "boundary, and on Vercel it hands the rest to the platform's own after-response " +
          "mechanism rather than making the visitor wait.",
        wiring: "express-middleware",
        evidence: "contract-reproduced",
        proof: ["serverless-invocation:vercel-after-response"],
      },
      {
        target: "lambda",
        answer: "proven",
        short: "The same middleware, unchanged.",
        how:
          "The same middleware, unchanged — `boosthis()` already sits on the request " +
          "boundary and holds the response there until the send has finished, which is " +
          "what the freeze on return demands.",
        wiring: "express-middleware",
        evidence: "contract-reproduced",
        proof: ["serverless-invocation:express-lambda-adapter"],
      },
      REFUSED_BY_HOST,
      NOT_RECOGNISED_BY_HOST,
    ],
  },
  {
    name: "Next.js",
    aliases: ["Next.js", "Next"],
    setupId: "next",
    hosting: [
      {
        target: "long-running",
        answer: "proven",
        short: "`attach()` in the custom server file, before `createServer(...)`.",
        how:
          "`attach()` in the custom server file, before `createServer(...)`. Node runtime; " +
          "the edge runtime is refused by name at startup.",
        wiring: "attach",
        evidence: "real-run",
        proof: ["node-any-server:next"],
      },
      {
        target: "vercel",
        answer: "none",
        short: "No custom server file to put `attach()` in, and a route handler is not a bare handler.",
        reason: "next-on-vercel",
      },
      ownsTheRequest("lambda"),
      REFUSED_BY_HOST,
      NOT_RECOGNISED_BY_HOST,
    ],
  },
  {
    name: "Fastify",
    setupId: "fastify",
    hosting: [
      {
        target: "long-running",
        answer: "proven",
        short: "`attach()` before the Fastify instance is created.",
        how: "`attach()` before the Fastify instance is created.",
        wiring: "attach",
        evidence: "real-run",
        proof: ["node-any-server:fastify"],
      },
      ownsTheRequest("vercel"),
      ownsTheRequest("lambda"),
      REFUSED_BY_HOST,
      NOT_RECOGNISED_BY_HOST,
    ],
  },
  {
    name: "Hono",
    setupId: "hono",
    hosting: [
      {
        target: "long-running",
        answer: "proven",
        short: '`attach({ serverKind: "hono" })` before `serve()`, on the Node adapter.',
        how: '`attach({ serverKind: "hono" })` before `serve()`, on the Node adapter.',
        wiring: "attach",
        evidence: "real-run",
        proof: ["node-any-server:hono"],
      },
      ownsTheRequest("vercel"),
      ownsTheRequest("lambda"),
      REFUSED_BY_HOST,
      NOT_RECOGNISED_BY_HOST,
    ],
  },
  {
    name: "NestJS",
    aliases: ["NestJS", "Nest"],
    setupId: "nest",
    hosting: [
      {
        target: "long-running",
        answer: "proven",
        short: "`attach()` before `NestFactory.create(...)`, on either adapter.",
        how: "`attach()` before `NestFactory.create(...)`, on either adapter.",
        wiring: "attach",
        evidence: "real-run",
        proof: ["node-any-server:nest"],
      },
      ownsTheRequest("vercel"),
      ownsTheRequest("lambda"),
      REFUSED_BY_HOST,
      NOT_RECOGNISED_BY_HOST,
    ],
  },
  {
    name: "Plain Node server",
    aliases: ["plain Node server", "plain Node", "plain `http` server", "plain http server"],
    setupId: "node-http",
    hosting: [
      {
        target: "long-running",
        answer: "proven",
        short: "`attach()` before `createServer(...)`.",
        how: "`attach()` before `createServer(...)`.",
        wiring: "attach",
        evidence: "real-run",
        proof: ["node-any-server:plain-node"],
      },
      {
        target: "vercel",
        answer: "proven",
        short: "Wrap the exported handler in `withBoosthis()`.",
        how:
          "A bare handler has no server to watch, so wrap it: " +
          "`export const handler = withBoosthis(async (event, context) => { … })`.",
        wiring: "wrapped-handler",
        evidence: "contract-reproduced",
        proof: ["serverless-invocation:vercel-no-countdown-abstains"],
      },
      {
        target: "lambda",
        answer: "proven",
        short: "Wrap the exported handler in `withBoosthis()`.",
        how:
          "A bare handler has no server to watch, so wrap it: " +
          "`export const handler = withBoosthis(async (event, context) => { … })`.",
        wiring: "wrapped-handler",
        evidence: "contract-reproduced",
        proof: ["serverless-invocation:lambda-inline"],
      },
      REFUSED_BY_HOST,
      NOT_RECOGNISED_BY_HOST,
    ],
  },
  ...(["Remix", "SvelteKit", "Nuxt", "Astro"] as const).map(
    (name): FrameworkAnswer => ({
      name,
      hosting: [
        {
          target: "long-running",
          answer: "generic",
          short:
            "The Plain Node server line, where the app ends in one — with no run of our " +
            "own on this framework.",
          how:
            "Where the app ends in a Node server you start yourself, the Plain Node server " +
            "recipe measures it — `attach()` before that server is created. We have not run " +
            "this framework ourselves, so this is the generic answer, not a verified one.",
        },
        ownsTheRequest("vercel"),
        ownsTheRequest("lambda"),
        REFUSED_BY_HOST,
        NOT_RECOGNISED_BY_HOST,
      ],
    }),
  ),
];

/** The function hosts the kit recognises AND has earned the right to run on.
 *  Derived, so a sentence can never name a host that is not on the proven
 *  list. */
export function provenFunctionHostNames(): string[] {
  return PROVEN_PLATFORMS.map((code) => platformName(code));
}

/** The one sentence about function hosts, generated rather than typed.
 *
 *  It exists because its two predecessors were each true alone: "Vercel
 *  Functions and AWS Lambda are detected automatically — there is nothing to
 *  configure", and "one call measures any Node server, Next.js included". A
 *  Next-on-Vercel reader combines them into a promise, so the two facts are
 *  now stated in one place, joined by the part that was missing: recognising a
 *  host is not the same as having somewhere to attach on it. */
export function functionHostSentence(): string {
  const proven = asList(provenFunctionHostNames()) || "no function host";
  const refused = asList(namedUnprovenFunctionHostNames());
  return (
    `${proven} are recognised automatically — but recognition is not wiring, and they are ` +
    "the only function hosts the kit runs on at all. What earns them that word is the " +
    "host's published contract — its environment markers, its handler signature, its freeze " +
    "on response — reproduced here against the shipped kit: we hold no account on either " +
    "host and have never published to one, so no claim here is a run on a deployment. " +
    `On ${refused} the kit names the host and stops before registering, rather than draw a ` +
    "panel over nothing. On a function host it has no marker for it cannot tell at all: " +
    "nothing refuses, the kit starts as if this were an ordinary Node server, and almost " +
    "everything it gathers dies with the invocation — set `BOOSTHIS_SERVERLESS=1` to make " +
    "it stop instead. A function is frozen the moment it answers, so even on the two " +
    "recognised hosts the kit can only measure code it is already inside: an Express app's " +
    "`boosthis()` middleware, or a bare handler wrapped with `withBoosthis()`. A framework " +
    "that owns the request itself — a Next.js route handler or page, or the serverless " +
    "adapter of Remix, SvelteKit, Nuxt or Astro — gives neither of those anywhere to sit, " +
    "and has no path on either. The table above says which is which, per framework and per " +
    "host."
  );
}

/** Lookup by framework name, for a surface that needs one row. */
export function frameworkAnswer(name: string): FrameworkAnswer | undefined {
  return FRAMEWORK_ANSWERS.find((f) => f.name === name);
}

/** One framework's answer for one host. */
export function hostingAnswer(
  framework: FrameworkAnswer,
  target: HostingTarget,
): HostingAnswer | undefined {
  return framework.hosting.find((h) => h.target === target);
}

/** The verdict word, which is the part a reader acts on. Kept apart from the
 *  clause after it so no cell can be written without one. */
const VERDICT: Record<HostingAnswer["answer"], string> = {
  proven: "**Proven.**",
  generic: "**No recipe of its own.**",
  none: "**No path.**",
  refused: "**The kit refuses to start.**",
  unrefused: "**No path, and no refusal either.**",
};

/** A proven cell says WHICH kind of proof, in the verdict itself. "Proven" on
 *  a function host meant a run on that host to every reader, and what we hold
 *  there is the host's contract reproduced here — so the word carries its own
 *  qualifier rather than relying on a footnote nobody reaches. */
const PROVEN_VERDICT: Record<Evidence, string> = {
  "real-run": "**Proven on a real run.**",
  "contract-reproduced": "**Proven against this host's contract, not on a deployment.**",
};

const answerCell = (a: HostingAnswer): string => {
  const verdict =
    a.answer === "proven" && a.evidence ? PROVEN_VERDICT[a.evidence] : VERDICT[a.answer];
  return `${verdict} ${a.short}`.trim();
};

const asList = (items: readonly string[]): string =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : (items[0] ?? "");

/** The frameworks whose only answer on a server you start yourself is the
 *  generic Plain Node line. Derived rather than typed: the door above tells a
 *  reader their framework's recipe "applies unchanged", and for these there is
 *  no recipe of their own to apply — a list kept by hand would go stale the
 *  first time one of them earned a real run. */
function genericOnAServerFrameworkNames(): string[] {
  return FRAMEWORK_ANSWERS.filter(
    (f) => f.hosting.find((h) => h.target === "long-running")?.answer === "generic",
  ).map((f) => f.name);
}

/** Every door, in the order a developer should consider them. The last two
 *  apply only to one column each, and say which in their own first words
 *  rather than relying on where they are printed.
 *
 *  Declared here, below the register, because the first door reads the
 *  register to decide which frameworks it may call proven. */
export const DOORS: readonly string[] = [
  doorRunItAsAServer(),
  DOOR_BROWSER_KIT,
  DOOR_ASK_US_TO_PROVE_THE_HOST,
  DOOR_TELL_THE_KIT_IT_IS_A_FUNCTION,
];

/** Which cells a written reason is speaking for, in the reader's own terms.
 *  A reason that answers for every framework on one host is said once as a
 *  fact about the host; anything narrower is named pair by pair, because a
 *  reason whose scope is vague is how a refusal gets read as a general one. */
function reasonCoverage(key: ReasonKey): string {
  const per = new Map<HostingTarget, { names: string[]; kind: HostingAnswer["answer"] }>();
  for (const f of FRAMEWORK_ANSWERS) {
    for (const a of f.hosting) {
      if (a.reason !== key) continue;
      const seen = per.get(a.target) ?? { names: [], kind: a.answer };
      seen.names.push(f.name);
      per.set(a.target, seen);
    }
  }
  const parts: string[] = [];
  for (const target of HOSTING_TARGETS) {
    const group = per.get(target);
    if (!group?.names.length) continue;
    // Each clause carries its own verdict. A list of combinations with the
    // verdict only at the end of the paragraph reads, clause by clause, as a
    // list of places the kit works.
    const verdict =
      group.kind === "refused"
        ? "the kit refuses to start for"
        : group.kind === "unrefused"
          ? "no path, and no refusal either, for"
          : "no path for";
    const who =
      group.names.length === FRAMEWORK_ANSWERS.length ? "every framework above" : asList(group.names);
    parts.push(`${verdict} ${who} on ${HOSTING_TARGET_IN_PROSE[target]}`);
  }
  const joined = parts.join("; ");
  return joined ? joined.charAt(0).toUpperCase() + joined.slice(1) : "";
}

/** The reasons, each printed once with the cells it answers for. */
function reasonBlocks(bold: boolean): string[] {
  const lines: string[] = [];
  for (const key of Object.keys(REASONS) as ReasonKey[]) {
    const covers = reasonCoverage(key);
    if (!covers) continue;
    const { title, text } = REASONS[key];
    lines.push("", bold ? `**${title}.**` : `${title}:`, "", text(covers));
  }
  return lines;
}

/** The framework × host answer, as markdown. Shared by the README, the served
 *  install steps and INSTALL.md so the three cannot drift. */
export function frameworkAnswersMarkdown(): string[] {
  const lines = [
    `| Framework | ${HOSTING_TARGETS.map((t) => HOSTING_TARGET_LABELS[t]).join(" | ")} |`,
    `|---|${HOSTING_TARGETS.map(() => "---").join("|")}|`,
  ];
  for (const f of FRAMEWORK_ANSWERS) {
    const cells = HOSTING_TARGETS.map((target) => {
      const a = hostingAnswer(f, target);
      return a ? answerCell(a).replace(/\n/g, " ") : "";
    });
    lines.push(`| ${f.name} | ${cells.join(" | ")} |`);
  }
  lines.push(
    "",
    "Every cell was earned, or refused, for that exact pair — the framework, the host and " +
      "the wiring together. Nothing carries across from the column beside it.",
    "",
    "**Proven on a real run** means an app of that kind was started and driven on that " +
      "host and the measurements arrived. **Proven against this host's contract** means the " +
      "host's published contract — its environment markers, its handler signature, its " +
      "freeze on response — was reproduced here against the shipped kit: we hold no account " +
      "on Vercel or AWS and have never published to either, so those cells are not a run on " +
      "a deployment of yours or of ours.",
    ...reasonBlocks(true),
    "",
    "Where a cell is not **Proven**, these are the ways out:",
    "",
  );
  for (const door of DOORS) lines.push(`- ${door}`);
  return lines;
}

/** The same answer, as indented plain-text lines for the served, numbered
 *  install steps an AI follows. */
export function frameworkAnswersSteps(): string[] {
  const lines: string[] = [];
  for (const f of FRAMEWORK_ANSWERS) {
    lines.push(`     ${f.name}:`);
    for (const target of HOSTING_TARGETS) {
      const a = hostingAnswer(f, target);
      if (!a) continue;
      lines.push(`       - ${HOSTING_TARGET_LABELS[target]} — ${answerCell(a).replace(/\*\*/g, "")}`);
    }
  }
  lines.push(
    "",
    "     Every pair above was earned, or refused, for that exact framework, host and",
    "     wiring together. Do not carry an answer across to the host beside it.",
    "",
    "     Proven on a real run: an app of that kind was started and driven on that host",
    "     and the measurements arrived. Proven against this host's contract: the host's",
    "     published contract — environment markers, handler signature, freeze on response",
    "     — was reproduced on our own machine against the shipped kit. We hold no account",
    "     on Vercel or AWS and have never published to either, so those cells are not a",
    "     run on a deployment of yours or of ours.",
    ...reasonBlocks(false).map((line) => (line ? `     ${line}` : "")),
    "",
    "     Where a pair is not PROVEN, say so to the developer and offer one of these,",
    "     naming which:",
  );
  for (const door of DOORS) lines.push(`       - ${door.replace(/\*\*/g, "")}`);
  return lines;
}

/** The setups, most-specific first, as a plain sentence. */
export function supportedSetupsSentence(): string {
  const labels = SUPPORTED_SERVER_SETUPS.map((s) => s.label);
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** The recipe for one setup, as indented plain-text lines for the served,
 *  numbered install steps an AI follows. */
export function setupRecipeSteps(setup: SupportedSetup): string[] {
  return [
    `   ${setup.label.toUpperCase()} — in ${setup.where}:`,
    ...setup.code.map((line) => (line ? `     ${line}` : "")),
    ...(setup.note ? [`     (${setup.note})`] : []),
  ];
}

/** The recipe for one setup, as markdown lines. Shared by the served install
 *  instructions and INSTALL.md so the two can never drift. */
export function setupRecipeMarkdown(setup: SupportedSetup): string[] {
  return [
    `### ${setup.label}`,
    "",
    `In ${setup.where}:`,
    "",
    "```ts",
    ...setup.code,
    "```",
    ...(setup.note ? ["", setup.note] : []),
  ];
}
