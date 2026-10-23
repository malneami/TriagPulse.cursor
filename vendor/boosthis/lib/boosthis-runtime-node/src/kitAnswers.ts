/** The ONE place that decides what a kit-owned read answers.
 *
 * WHY THIS EXISTS
 *
 * The kit is reachable through three different doors: the Express middleware
 * (`app.use(boosthis())`), the Express route mount (`mount(app)`), and — since
 * the framework-free attach — the raw Node request boundary, which is the only
 * door a Fastify / Hono / Next.js / NestJS / plain-`http` app has.
 *
 * Three doors used to mean three copies of "what does /panel return, and who
 * is allowed to read it". They had already drifted: the middleware withheld
 * the meters behind a kill-switch lock and the mounted route did not, so the
 * SAME app answered differently depending on which door a request happened to
 * reach first. An adapter that merely watches traffic does not get to invent
 * its own answers — it dispatches to this module, above its instrumentation,
 * and writes whatever comes back in the shape its host expects.
 *
 * So: this module decides the STATUS, the BODY and the GATE. It never touches
 * a response object — writing is the adapter's job, because an Express
 * response and a bare `http.ServerResponse` are written differently.
 */

import * as samples from "./samples";
import * as budgets from "./budgets";
import * as reporting from "./reporting";
import { computePulse, computePanel, computePanelLock, renewNotice, type PanelLock } from "./bubble";
import { computeDashboardAxes } from "./healthAxes";
import { declaredWaitsBlock } from "./declaredWaits";
import { RUNTIME_VERSION } from "./thresholds";
import {
  forceEntitlementCheck,
  isKitDissolved,
  renewOnly,
  visibleEntitlementStatus,
} from "./killSwitch";
import { DASHBOARD_MARKUP, PANEL_PAGE_MARKUP } from "./kitPageAssets";
import { sayAfterStartupLine } from "./startAnnounce";
import { STATUS_FORBIDDEN_HTML, renewOnlyHtml, statusPageHtml } from "./statusPage";
import type { TelemetryClient } from "./telemetry";

/** Wrap a body in the kit's own page chrome. Static markup with nothing to look
 *  up, so a page built here cannot fail the way the page it stands in for did. */
function kitPage(title: string, body: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<title>${title}</title>` +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '</head><body style="background:#0b0c10;color:#e6e7eb;' +
    'font-family:system-ui,sans-serif;padding:40px;line-height:1.55;' +
    'max-width:46rem">' +
    body +
    "</body></html>"
  );
}

/** Shown only when this build of the kit carries no page markup at all.
 *
 * It used to say "the page file is missing from the package — reinstall the kit
 * to restore it", which was wrong twice over: the usual cause was a BUNDLED
 * install (a supported path — see kitPageAssets.ts), and reinstalling the same
 * version could never change the outcome. Both pages are embedded now, so the
 * only way here is a kit we built wrong. Say that, and never send a developer
 * to a remedy that cannot work. */
const PANEL_PAGE_STANDIN: string = kitPage(
  "Boosthis",
  "<h1>Boosthis is running</h1>" +
    "<p>This install is measuring normally — this page is the only thing " +
    "affected. This build of the kit carries no page markup, so there is " +
    "nothing here to draw. That is our packaging, not your install: nothing " +
    "you change in your app will restore it, and reinstalling the same " +
    "version will not either.</p>" +
    "<p>Everything else still works — the status page at " +
    "<code>/_boosthis/status</code> (localhost only), the badge, and your " +
    "project's readings on the Boosthis dashboard. Updating to a newer kit " +
    "version replaces this page; if a newer version does the same, tell us at " +
    "support@boosthis.com.</p>",
);

/** The canonical in-app page, shared byte-for-byte with every other kit.
 *
 * EMBEDDED, not read from disk beside this module — see kitPageAssets.ts for
 * why (a bundled install, which we advertise, strands a sibling HTML file).
 *
 * DO NOT EDIT panel_page.html in this package — edit lib/kit-page/panel_page.html,
 * re-run scripts/build-kit-page.mjs, then re-run this package's
 * `build-kit-assets` script, or the parity guard fails. */
export const PANEL_PAGE_HTML: string = PANEL_PAGE_MARKUP || PANEL_PAGE_STANDIN;

/** This kit's richer, loopback-only local view (per-route table, budgets,
 *  recent samples, Connect your AI). Hand-maintained and kit-specific — it is
 *  NOT the shared page above.
 *
 *  Its stand-in named `@workspace/boosthis-runtime-node` — the private monorepo
 *  package name, which no customer can install — and told them to reinstall it.
 *  Customer-facing text never names an internal package, and never prescribes a
 *  remedy that cannot work. */
export const DASHBOARD_HTML: string =
  DASHBOARD_MARKUP ||
  kitPage(
    "Boosthis",
    "<h1>Boosthis is running</h1>" +
      "<p>This install is measuring normally. This build of the kit carries no " +
      "markup for the detailed view, so there is nothing to draw here — our " +
      "packaging, not your install, and reinstalling the same version will not " +
      "change it.</p>" +
      "<p>The in-app page at <code>/_boosthis</code> and the status page at " +
      "<code>/_boosthis/status</code> still work, as do the readings on your " +
      "Boosthis dashboard. Updating the kit replaces this view; if a newer " +
      "version does the same, tell us at support@boosthis.com.</p>",
  );

/** Which of the kit's own pages this build could not carry, in one sentence, or
 *  null when both are present. Pure — the announcement below does the saying. */
export function missingKitAssetsLine(
  panel: string = PANEL_PAGE_MARKUP,
  dashboard: string = DASHBOARD_MARKUP,
): string | null {
  const missing: string[] = [];
  if (!panel) missing.push("the in-app page (/_boosthis)");
  if (!dashboard) missing.push("the detailed local view (/_boosthis/dev)");
  if (!missing.length) return null;
  return (
    `[boosthis] This build of the Boosthis kit carries no markup for ` +
    `${missing.join(" or ")}, so ${missing.length === 1 ? "that page shows" : "those pages show"} ` +
    `a plain stand-in. Measuring, uploading and the status page are unaffected. ` +
    `This is a packaging fault on our side — reinstalling the same version will ` +
    `not change it; tell us at support@boosthis.com.`
  );
}

let assetsAnnounced = false;

/**
 * Say ONE line at startup when the kit cannot find its own page markup.
 *
 * The read that used to fail here was wrapped in a `catch` returning null, so
 * the one channel that could have told the truth said nothing at all: a
 * developer saw an apology page and no reason for it anywhere. A missing asset
 * is now audible exactly once per process, and — like every other kit notice —
 * it can never throw into the host application.
 */
export function announceMissingKitAssets(): void {
  if (assetsAnnounced) return;
  assetsAnnounced = true;
  try {
    const line = missingKitAssetsLine();
    if (line) {
      try {
        sayAfterStartupLine(line);
      } catch {
        /* guest safety outranks the notice */
      }
    }
  } catch {
    // A diagnostic must never disturb its host.
  }
}

export function _resetKitAssetNoticeForTests(): void {
  assetsAnnounced = false;
}

/** Shown only when a read below threw. Static, self-contained markup — it has
 *  no measurements to render and nothing to look up, so the apology itself
 *  cannot fail the way the page it replaces just did. */
export const KIT_ERROR_HTML: string =
  '<!doctype html><html><head><meta charset="utf-8"><title>Boosthis</title>' +
  '</head><body style="background:#0b0c10;color:#e6e7eb;' +
  'font-family:system-ui,sans-serif;padding:40px">' +
  "<h1>Boosthis could not draw this page</h1>" +
  "<p>Something inside the kit failed while building this view. Your app is " +
  "unaffected — only this page is. Reload to try again.</p></body></html>";

/** The default mount prefix. Every kit-owned read hangs off it. */
export const KIT_BASE_PATH = "/_boosthis";

/**
 * Every suffix the kit answers, relative to the mount prefix. `""` and `"/"`
 * are BOTH the canonical page: a developer types one or the other and neither
 * habit may 404.
 *
 * This is the closed list the framework-free attach routes on and the list the
 * parity guard walks — a path served by one door and not the other is exactly
 * the half-attached state this module exists to make impossible.
 */
export const KIT_READ_SUFFIXES = [
  "",
  "/",
  "/dev",
  "/healthz",
  "/summary",
  "/recent",
  "/budgets",
  "/pulse",
  "/panel",
  "/connect",
  "/account",
  "/status",
] as const;

export type KitReadSuffix = (typeof KIT_READ_SUFFIXES)[number];

/** What a kit-owned read owes its caller: a page, or a JSON body. */
export type KitAnswerKind = "html" | "json";

/** A decided answer. `kind` tells the adapter which field to write. */
export interface KitAnswer {
  status: number;
  kind: KitAnswerKind;
  html?: string;
  json?: unknown;
}

/** Everything the decision needs from the request. The adapter reads these off
 *  whatever request object its host uses, so this module never touches one. */
export interface KitReadContext {
  /** The STRICT loopback verdict (direct loopback peer AND no forwarding
   *  headers) — the same one `/account` has always used. */
  loopback: boolean;
  /** `mount({ allowRemote: true })`. Opens the perf reads; never a credential. */
  allowRemote?: boolean;
  /** A browser holding an owner pass Boosthis confirmed (ownerLink.ts). */
  owner?: boolean;
  /** The live reporting client, for the two credential reads. */
  telemetry?: TelemetryClient;
  /** `?limit=` / `?name=` for `/recent`. */
  query?: { limit?: string; name?: string };
}

/** True when this suffix is one the kit owns. */
export function isKitReadSuffix(suffix: string): suffix is KitReadSuffix {
  return (KIT_READ_SUFFIXES as readonly string[]).includes(suffix);
}

/**
 * Split a request path into the kit's mount prefix and the suffix it owns, or
 * null when the path is the host's own. Query strings are already stripped by
 * the caller.
 */
export function kitReadSuffixFor(
  path: string,
  base: string = KIT_BASE_PATH,
): KitReadSuffix | null {
  if (!path.startsWith(base)) return null;
  const raw = path.slice(base.length);
  // A trailing slash is a habit, not a different address. `mount()` registers
  // both spellings of the page for exactly that reason; the two doors that
  // route on this function used to answer `/_boosthis/status` and 404 on
  // `/_boosthis/status/`, which reads as "no kit here".
  const suffix = raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;
  return isKitReadSuffix(suffix) ? suffix : null;
}

/* ── which doors are already serving the kit's own paths ─────────────────── */

/** Bases under which some door in THIS process serves the kit's whole path set:
 *  `mount(app)` for Express, `attach()` for everything else. */
const registeredKitBases = new Set<string>();

/** Normalise a base the way `mount()` and `attach()` do, so `/_boosthis/` and
 *  `/_boosthis` are one entry. */
function normaliseBase(base: string): string {
  return base.replace(/\/$/, "");
}

/**
 * Record that a door now serves every kit-owned path under `base`.
 *
 * The middleware answers three paths directly and leaves the rest to
 * `mount(app)` — a deliberate split. What it must NOT do is answer a path a
 * mounted route is about to answer properly: middleware runs first, so an
 * unconditional reply there would shadow the real page. This register is how
 * the middleware knows to stay quiet.
 */
export function noteKitPathsRegistered(base: string = KIT_BASE_PATH): void {
  try {
    registeredKitBases.add(normaliseBase(base));
  } catch {
    /* a note about our own wiring must never break the wiring */
  }
}

/** True when a door already serves the kit's paths under this base. */
export function areKitPathsRegistered(base: string = KIT_BASE_PATH): boolean {
  return registeredKitBases.has(normaliseBase(base));
}

/** Every base a door registered, for a message that must not tell a developer
 *  to mount what they have already mounted somewhere else. */
export function registeredKitBasePaths(): string[] {
  return [...registeredKitBases];
}

export function _resetKitPathRegistrationsForTests(): void {
  registeredKitBases.clear();
}

/** How the honest "this surface is not registered here" answer is worded. Kept
 *  beside the answer itself so the two can never drift. */
function unmountedGuidance(base: string, elsewhere?: string): {
  reason: string;
  fix: string;
} {
  if (elsewhere) {
    return {
      reason:
        `Boosthis is installed and measuring, but its pages are served under ` +
        `${elsewhere} in this app, not under ${base}.`,
      fix: `Use ${elsewhere} instead — same page, same reads.`,
    };
  }
  return {
    reason:
      `Boosthis is installed and measuring. This surface is registered by the ` +
      `optional second call, mount(app), which this app has not made.`,
    fix:
      `Add mount(app) next to app.use(boosthis()) and restart. ` +
      `A non-Express app uses attach() instead, which needs no mount call.`,
  };
}

/**
 * Answer a kit-owned path that no door in this process serves.
 *
 * `mount(app)` is optional by design and we say so. What went unsaid is what
 * happens to the rest of the prefix without it: every read the mount registers
 * — INCLUDING the bare `/_boosthis` page we print in the setup block, the
 * install guide and the kit's own comments — fell through to the host's own
 * 404. A developer whose kit was installed, registered, measuring and uploading
 * perfectly visited the address we gave them and got a reply byte-identical to
 * having no kit at all.
 *
 * The middleware already knew everything needed to answer: it holds the prefix,
 * it sees the raw path, and it owns a writer for kit-owned replies. So it says
 * the true thing instead of nothing — the kit is here and measuring, this
 * surface needs the mount call, and the status page works right now.
 *
 * Still a 404: the address really does not serve a page in this app, and
 * claiming 200 would trade one lie for another. What changes is that the body
 * is ours and it names the cause. Only paths in the closed suffix list get this
 * answer, so a host route that merely starts with the prefix is never claimed.
 */
export function answerUnmountedKitRead(
  suffix: string,
  opts: { base?: string; elsewhere?: string } = {},
): KitAnswer | null {
  if (!isKitReadSuffix(suffix)) return null;
  const base = normaliseBase(opts.base ?? KIT_BASE_PATH);
  const { reason, fix } = unmountedGuidance(base, opts.elsewhere);
  const statusPath = `${base}/status`;
  const wantsHtml =
    suffix === "" || suffix === "/" || suffix === "/dev" || suffix === "/status";
  if (!wantsHtml) {
    return {
      status: 404,
      kind: "json",
      json: {
        error: reason,
        fix,
        measuring: true,
        statusPage: statusPath,
      },
    };
  }
  return {
    status: 404,
    kind: "html",
    html: kitPage(
      "Boosthis — one line short",
      "<h1>Boosthis is installed and measuring</h1>" +
        `<p>${reason}</p>` +
        `<p>${fix}</p>` +
        (opts.elsewhere
          ? ""
          : "<pre style=\"background:#15171d;padding:14px;border-radius:8px;" +
            'overflow:auto"><code>app.use(boosthis());\nmount(app);' +
            "</code></pre>") +
        "<p>Nothing is broken and nothing is missing from the install — this " +
        "app simply skipped a call we describe as optional.</p>" +
        `<p>Working right now, with no mount: the status page at ` +
        `<a style="color:#7cc4ff" href="${statusPath}">${statusPath}</a> ` +
        `(localhost only), and the badge reads at <code>${base}/pulse</code> ` +
        `and <code>${base}/panel</code>.</p>`,
    ),
  };
}

/** Build the paste-ready hosted-MCP "Connect your AI" payload from a live
 *  telemetry client. Returns `{ connected: false }` until a read token has been
 *  issued (fresh consent or backfill). The install id + read token are surfaced
 *  so the developer can hand them to their OWN AI as per-call tool arguments;
 *  the config JSON deliberately does NOT bake them in (the hosted server holds
 *  no per-install creds in module state — the cross-tenant guarantee). The
 *  invite key is a `<YOUR_PROJECT_KEY>` placeholder: the runtime never stores it
 *  in a readable form. */
export function buildConnectPayload(tele: TelemetryClient | undefined): {
  connected: boolean;
  installId?: string;
  readToken?: string;
  mcpUrl?: string;
  mcpConfig?: string;
} {
  if (!tele || !tele.enabled || !tele.readToken) return { connected: false };
  // Hosted MCP lives next to the API (…/api → …/mcp), mirroring the RN card.
  const mcpUrl = tele.endpoint.replace(/\/api\/?$/, "") + "/mcp";
  const mcpConfig = [
    "{",
    '  "mcpServers": {',
    '    "boosthis": {',
    `      "url": "${mcpUrl}",`,
    '      "headers": { "Authorization": "Bearer <YOUR_PROJECT_KEY>" }',
    "    }",
    "  }",
    "}",
  ].join("\n");
  return {
    connected: true,
    installId: tele.installId,
    readToken: tele.readToken,
    mcpUrl,
    mcpConfig,
  };
}

/** The bare Node response shape the two non-Express doors write through. */
export interface RawResLike {
  statusCode?: number;
  setHeader?(name: string, value: string): unknown;
  end?(body?: string): unknown;
  headersSent?: boolean;
}

/**
 * Write one decided answer to a bare `http.ServerResponse`.
 *
 * Used by the middleware's direct interception and by the framework-free
 * attach — the two doors that hold a raw Node response rather than an Express
 * one. Returns true when the answer went out, false when it could not be
 * written (head already sent, or a response object that cannot be written to),
 * so the caller can decide whether the host still needs to see the request.
 */
export function writeRawKitAnswer(res: RawResLike, answer: KitAnswer): boolean {
  try {
    if (res.headersSent === true) return false;
    if (typeof res.end !== "function") return false;
    res.statusCode = answer.status;
    if (typeof res.setHeader === "function") {
      res.setHeader(
        "content-type",
        answer.kind === "html"
          ? "text/html; charset=utf-8"
          : "application/json; charset=utf-8",
      );
      res.setHeader("cache-control", "no-store");
    }
    res.end(
      answer.kind === "html"
        ? (answer.html ?? KIT_ERROR_HTML)
        : JSON.stringify(answer.json ?? null),
    );
    return true;
  } catch {
    return false;
  }
}

/** The loopback-or-allowRemote refusal body, worded exactly as the mounted
 *  route has always worded it. */
const DASHBOARD_FORBIDDEN = {
  error:
    "boosthis dashboard is localhost-only by default. " +
    "Pass { allowRemote: true } to mount() (and put auth in front) " +
    "to expose it on this host.",
};

/** A lock with nothing readable of its own: the bubble hides. */
const HIDDEN_LOCK: PanelLock = { kind: "hidden", title: "", body: "" };

/**
 * LOCKED (docs/kit-lock-rule.md): the renew notice and nothing else, in the
 * shape the read asked for — no numbers, rules, samples, budgets or
 * credentials. Each read's own access check has already run, so exactly the
 * people who could open it before see this.
 */
function renewAnswer(kind: KitAnswerKind): KitAnswer {
  const notice = renewNotice();
  return kind === "html"
    ? { status: 200, kind: "html", html: renewOnlyHtml(notice) }
    : {
        status: 200,
        kind: "json",
        json: { entitlement: visibleEntitlementStatus(), renewOnly: true, notice },
      };
}

/**
 * Decide the answer for ONE kit-owned read. Returns null when the suffix is
 * not ours — the adapter must then leave the request entirely alone.
 *
 * Never throws: every adapter wraps the call anyway (a kit exception must not
 * reach the host's error page), but a read that cannot be built answers with
 * the kit's own apology rather than relying on that wrapper.
 */
export function answerKitRead(
  suffix: string,
  ctx: KitReadContext,
): KitAnswer | null {
  if (!isKitReadSuffix(suffix)) return null;
  // DISSOLVED (docs/kit-lock-rule.md): the kit is unhooked, so no door answers
  // for it. Null, and every door hands the request to the app's own answer.
  if (isKitDissolved()) return null;
  const allowRemote = ctx.allowRemote === true;
  // Owners only (owner decision, 4 Oct 2026): the kit's page and readings
  // answer a confirmed owner pass, the machine itself, or the developer's own
  // `allowRemote` opt-in (their auth in front). Anyone else: null, so every
  // door falls through to the app's own answer, nothing Boosthis-branded.
  if (!allowRemote && !ctx.loopback && ctx.owner !== true) return null;
  const perfReadAllowed = allowRemote || ctx.loopback;

  try {
    // Read once per answer: every read below shows only the renew notice while
    // the kit is locked, after its own access check.
    const renew = renewOnly();
    switch (suffix) {
      // The canonical in-app page (and its slash variant, so neither habit
      // 404s) — the same markup every other kit serves. Gated exactly like
      // the /panel read it fetches its numbers from (the owners-only check at
      // the top): a page that worked while its numbers refused, or the other
      // way round, would only puzzle the owner.
      case "":
      case "/":
        if (renew) return renewAnswer("html");
        return { status: 200, kind: "html", html: PANEL_PAGE_HTML };

      // This kit's richer local view. It renders route labels, learned
      // budgets, raw samples and the read-token card, so it keeps the loopback
      // guard the whole dashboard used to have.
      case "/dev":
        if (!perfReadAllowed) {
          return { status: 403, kind: "json", json: DASHBOARD_FORBIDDEN };
        }
        if (renew) return renewAnswer("html");
        return { status: 200, kind: "html", html: DASHBOARD_HTML };

      case "/healthz":
        if (!perfReadAllowed) {
          return { status: 403, kind: "json", json: DASHBOARD_FORBIDDEN };
        }
        if (renew) return renewAnswer("json");
        return {
          status: 200,
          kind: "json",
          json: {
            ok: true,
            version: RUNTIME_VERSION,
            samples: samples.summary().total,
          },
        };

      case "/summary": {
        if (!perfReadAllowed) {
          return { status: 403, kind: "json", json: DASHBOARD_FORBIDDEN };
        }
        if (renew) return renewAnswer("json");
        const sum = samples.summary();
        // The verdicts judge settled requests only; the counts stay whole.
        const axes = computeDashboardAxes(
          samples.settledSummary(),
          budgets.allStatuses(),
          budgets.regressions(),
          reporting.collectFindings(),
        );
        // Routes declared as waiting on purpose have no samples by design, so
        // they are listed beside the samples rather than left to read as
        // missing: each with the calls kept out and the longest wait.
        return {
          status: 200,
          kind: "json",
          json: { ...sum, axes, declaredWaits: declaredWaitsBlock() },
        };
      }

      case "/recent": {
        if (!perfReadAllowed) {
          return { status: 403, kind: "json", json: DASHBOARD_FORBIDDEN };
        }
        if (renew) return renewAnswer("json");
        const limit = Number(ctx.query?.limit ?? 50);
        return {
          status: 200,
          kind: "json",
          json: samples.recent({
            limit: Number.isFinite(limit) ? limit : 50,
            name: ctx.query?.name,
          }),
        };
      }

      case "/budgets":
        if (!perfReadAllowed) {
          return { status: 403, kind: "json", json: DASHBOARD_FORBIDDEN };
        }
        if (renew) return renewAnswer("json");
        // Name the algorithm and the rule beside the rows. This read is the
        // one place a developer sees the learned budget without a dashboard,
        // and the same question is answered by a server-computed window on
        // the phone and browser kits — a reader must not have to infer which
        // one replied, nor what span each verdict covers.
        return {
          status: 200,
          kind: "json",
          json: {
            algorithm: budgets.BUDGET_ALGORITHM,
            rule:
              `Baseline frozen from ${budgets.BUDGET_BASELINE_N} samples per ` +
              `route after ${budgets.BUDGET_WARMUP_N} warm-up samples, ` +
              `compared against ${budgets.BUDGET_RECENT_N} samples taken ` +
              "strictly later. The two windows share no sample, and each " +
              "row carries both spans.",
            all: budgets.allStatuses(),
            regressions: budgets.regressions(),
          },
        };

      // The two closed, coarse reads the floating badge polls, from any page
      // the app serves to its owner. Owners only (the check at the top), and
      // the shape carries only scores, ratings, labels and numeric captions —
      // never route labels, URLs, durations or raw samples.
      case "/pulse":
      case "/panel": {
        // VAULT contract on-open enforcement edge: a bubble/panel poll IS the
        // "dashboard opened" signal, so trigger a FRESH (throttled ≤1/60s)
        // server entitlement check. Non-blocking; the verdict lands async and
        // the next poll reflects it.
        try {
          forceEntitlementCheck(false);
        } catch {
          /* enforcement edge must never break the panel read */
        }
        // When the kit is VISIBLY LOCKED (revoked / unpaid / paused /
        // dissolved), the panel returns ONLY the lock descriptor — never the
        // meters — so the browser snippet renders the blocking overlay with
        // nothing readable behind it. A silent "hidden" inert state (env-kill /
        // tampered / grace-expired / an unknown answer) also withholds the
        // meters (the bubble vanishes). The pulse carries no number either.
        const lock = computePanelLock();
        let json: unknown;
        if (renew || lock) {
          const shown = lock ?? HIDDEN_LOCK;
          json =
            suffix === "/panel"
              ? { lock: shown }
              : { score: null, rating: null, sampleCount: 0, lock: shown };
        } else {
          json = suffix === "/panel" ? computePanel() : computePulse();
        }
        return { status: 200, kind: "json", json };
      }

      // "Connect your AI" — surfaces the install id + read-only read token + a
      // paste-ready hosted-MCP config. This read emits a CREDENTIAL, so unlike
      // the perf reads it is ALWAYS loopback-only: `allowRemote` never opens
      // it.
      case "/connect":
        if (!ctx.loopback) {
          return {
            status: 403,
            kind: "json",
            json: {
              error:
                "boosthis /connect is loopback-only — it emits a read token. " +
                "Copy the credentials from a local session.",
            },
          };
        }
        if (renew) return renewAnswer("json");
        return { status: 200, kind: "json", json: buildConnectPayload(ctx.telemetry) };

      // "Connect to your account" auth context for the badge's account card.
      // Also a CREDENTIAL (the install delete token used to claim/link the
      // install), so it is ALWAYS loopback-only too.
      case "/account": {
        if (!ctx.loopback) {
          return {
            status: 403,
            kind: "json",
            json: {
              error:
                "boosthis /account is loopback-only — it emits an install token. " +
                "Open this page on the dev machine to sign in.",
            },
          };
        }
        if (renew) {
          return { status: 200, kind: "json", json: { lock: computePanelLock() ?? HIDDEN_LOCK } };
        }
        const tele = ctx.telemetry;
        if (!tele || !tele.enabled) {
          return {
            status: 200,
            kind: "json",
            json: { endpoint: null, installId: null, deleteToken: null },
          };
        }
        return {
          status: 200,
          kind: "json",
          json: {
            endpoint: tele.endpoint,
            installId: tele.installId,
            deleteToken: tele.deleteToken ?? null,
            // The kit's current effective full-telemetry mode — the account
            // card's telemetry toggle falls back to this when the claim
            // response omits `fullTelemetry`. Display-only; never a credential.
            fullTelemetry: tele.fullTelemetryEffective === true,
          },
        };
      }

      // The standalone "is Boosthis working?" page — the surface a back-end app
      // with no UI has instead of the floating badge. STRICT loopback, same
      // posture as /connect and /account (`allowRemote` never opens it): it is
      // a developer's local diagnostic, not a public health page.
      case "/status":
        if (!ctx.loopback) {
          return { status: 403, kind: "html", html: STATUS_FORBIDDEN_HTML };
        }
        if (renew) return renewAnswer("html");
        return { status: 200, kind: "html", html: statusPageHtml() };
    }
  } catch {
    // A read that failed still owes its caller a well-formed answer in the
    // shape it asked for — a hung request is worse than an apology.
    const kind: KitAnswerKind =
      suffix === "" || suffix === "/" || suffix === "/dev" || suffix === "/status"
        ? "html"
        : "json";
    return kind === "html"
      ? { status: 500, kind, html: KIT_ERROR_HTML }
      : { status: 500, kind, json: { error: "boosthis could not answer this read." } };
  }
  return null;
}
