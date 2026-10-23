/** Attach Boosthis's in-app page and read-only JSON endpoints to an existing
 * Express app.
 *
 * Mirrors the Python `boosthis.mount(app)` helper. Endpoints are:
 *
 *   GET /_boosthis/          — the in-app page (the ONE page every kit serves)
 *   GET /_boosthis/dev       — this kit's detailed local view (loopback-only)
 *   GET /_boosthis/healthz   — version + sample count
 *   GET /_boosthis/summary   — aggregate p50/p95/p99 + per-route worst rating
 *   GET /_boosthis/recent    — most recent samples (default 50)
 *   GET /_boosthis/budgets   — auto-learned budgets + regressions
 *
 * All endpoints are read-only and share the in-process sample buffer with
 * the middleware, so mounting alone does not record anything new — make
 * sure you also `app.use(boosthis())`.
 *
 * WHAT EACH READ ANSWERS IS NOT DECIDED HERE. The status, the body and the
 * gate all come from `answerKitRead` in kitAnswers.ts, which the middleware
 * and the framework-free attach dispatch to as well. This module's only job is
 * to register the Express routes and to write the answer the Express way.
 * That split is deliberate: while each door decided for itself, the mounted
 * `/panel` route handed out meter values that the middleware withheld behind
 * a kill-switch lock, so the same app answered differently depending on which
 * door a request happened to reach first.
 *
 * TWO pages, deliberately:
 *
 *  - `/_boosthis` is the canonical in-app page — the same markup every other
 *    kit serves (generated from lib/kit-page/panel_page.html), so a developer
 *    who has seen it in one language recognises it in all of them. It carries
 *    no measurements of its own: it fetches the closed `/panel` read beside it,
 *    and rides the SAME visibility as that read (owners only: a confirmed
 *    owner pass, the machine itself, or the developer's allowRemote) — the
 *    page and its only data source open and close together.
 *  - `/_boosthis/dev` is this kit's older, richer local view: per-route table,
 *    learned budgets, recent samples and the "Connect your AI" card. That view
 *    shows route labels and a credential, so it keeps the loopback guard the
 *    whole dashboard used to have, along with every JSON endpoint it reads.
 */

import { isDirectLoopback } from "./loopback";
import { ownerFromPass, type OwnerReq, type OwnerRes } from "./ownerLink";
import { registerApp } from "./routeInventory";
import { STATUS_SUFFIX } from "./statusPage";
import {
  KIT_BASE_PATH,
  KIT_ERROR_HTML,
  PANEL_PAGE_HTML,
  answerKitRead,
  noteKitPathsRegistered,
  type KitAnswer,
} from "./kitAnswers";
import type { TelemetryClient } from "./telemetry";

interface AppLike {
  get(path: string, handler: (req: ReqLike, res: ResLike) => void): unknown;
}

interface ReqLike {
  socket?: { remoteAddress?: string };
  connection?: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
  query?: { limit?: string; name?: string };
}

interface ResLike {
  json(body: unknown): unknown;
  status(code: number): ResLike;
  type?(mime: string): ResLike;
  send?(body: string): unknown;
  setHeader?(name: string, value: string): unknown;
  end?(body?: string): unknown;
  /** Express/Node set this once the head has gone out. When it is true the
   *  answer is already on the wire and must not be rewritten. */
  headersSent?: boolean;
}

/** What a mounted route owes its caller: a page, or a JSON body. */
type AnswerKind = "html" | "json";

/**
 * Wrap ONE kit-owned route handler so a throw inside kit code can never reach
 * the host's error handler.
 *
 * The kit is a guest in someone else's application. If a read below throws,
 * Express hands the exception to the HOST's error middleware — so a hiccup in
 * our code shows the customer's own visitor the customer's error page (or, in
 * development, our stack trace on their site). That is the kit intervening in
 * an application it was only invited to watch.
 *
 * Same shape the Go kit uses (`defer recover()` at the top of every serve
 * function), with one addition: we still answer, in the shape this route's
 * caller expects — the kit's own page for an HTML route, a JSON body for a
 * JSON read — so the browser or the bubble gets a well-formed reply instead of
 * a hung request.
 *
 * Two rules borrowed from our own site's safety net:
 *   - if the head is already on the wire, leave the response alone; rewriting
 *     it corrupts a reply the caller is already reading;
 *   - the apology must not be able to fail, so writing it is guarded too.
 *
 * This wraps only routes the KIT registered. The host's own handlers are never
 * touched — their exceptions must keep reaching the host, exactly as before.
 */
function safeRoute(
  kind: AnswerKind,
  handler: (req: ReqLike, res: ResLike, next?: () => void) => void,
): (req: ReqLike, res: ResLike, next?: () => void) => void {
  return function boosthisSafeRoute(req: ReqLike, res: ResLike, next?: () => void): void {
    try {
      handler(req, res, next);
    } catch {
      try {
        if (res.headersSent === true) return;
        res.status(500);
        if (kind === "json") {
          res.json({ error: "boosthis could not answer this read." });
          return;
        }
        if (res.setHeader) {
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.setHeader("cache-control", "no-store");
        }
        if (res.send) res.send(KIT_ERROR_HTML);
        else if (res.end) res.end(KIT_ERROR_HTML);
      } catch {
        /* the apology must never become the failure it apologises for */
      }
    }
  };
}

export interface MountOptions {
  /** Override the default `/_boosthis` path prefix. */
  basePath?: string;
  /**
   * Allow requests from non-loopback IPs. Default `false` to match the
   * Python `boosthis.mount()` posture — perf history and internal route
   * structure should not be readable by the public internet just because
   * the host app is internet-reachable.
   *
   * Set `true` when intentionally exposing the dashboard to an internal
   * network, and put real auth in front of it.
   */
  allowRemote?: boolean;
  /**
   * The live telemetry client returned by {@link enableTelemetry}. When
   * provided, the dashboard shows a "Connect your AI" card at
   * `GET /_boosthis/connect` with this install's id, its read-only read token,
   * and a paste-ready hosted-MCP config so the developer's own AI can read the
   * live perf picture.
   *
   * The `/connect` endpoint is ALWAYS loopback-only — it ignores
   * `allowRemote` — because it emits a read-token credential; the perf-data
   * endpoints may be exposed, but a secret never should be.
   */
  telemetry?: TelemetryClient;
}

export function mount(app: AppLike, opts: MountOptions = {}): void {
  const base = (opts.basePath ?? KIT_BASE_PATH).replace(/\/$/, "");

  // Remember the app so the framework can be asked for its whole route list.
  // Only the reference is kept here; the walk happens at snapshot time, so
  // mounting the dashboard costs nothing extra at startup.
  registerApp(app);

  // Tell the middleware this prefix is now fully served. The middleware runs
  // BEFORE these routes, so without this note its honest "that surface needs
  // mount(app)" reply would shadow the real page it is about to serve. With it,
  // the reply appears only in the app that really did skip this call.
  noteKitPathsRegistered(base);

  const sendHtml = (res: ResLike, html: string) => {
    if (res.setHeader) res.setHeader("content-type", "text/html; charset=utf-8");
    if (res.send) res.send(html);
    else if (res.end) res.end(html);
  };

  /** Write one decided answer the Express way. */
  const write = (res: ResLike, answer: KitAnswer): void => {
    // Once the head has gone out the caller is already reading the reply;
    // writing over it corrupts a response rather than improving it. The
    // answer core turns its own failures into a 500 body, so this check has
    // to live here, at the only place that writes.
    if (res.headersSent === true) return;
    if (res.setHeader) res.setHeader("cache-control", "no-store");
    if (answer.status !== 200) res.status(answer.status);
    if (answer.kind === "html") {
      sendHtml(res, answer.html ?? KIT_ERROR_HTML);
      return;
    }
    res.json(answer.json);
  };

  /** Register ONE kit-owned suffix, answered by the shared decision. */
  const serve = (suffix: string, kind: AnswerKind, path = `${base}${suffix}`) => {
    app.get(path, safeRoute(kind, (req, res, next) => {
      // Owners only: a confirmed owner pass, the machine itself or the
      // developer's allowRemote opt-in. Anyone else falls through to the
      // app's own answer for an unknown address.
      const respond = (owner: boolean): void => {
        const answer = answerKitRead(suffix, {
          loopback: isDirectLoopback(req),
          owner,
          allowRemote: opts.allowRemote ?? false,
          telemetry: opts.telemetry,
          query: req.query,
        });
        if (!answer) {
          next?.();
          return;
        }
        write(res, answer);
      };
      const owner = ownerFromPass(req as OwnerReq, res as OwnerRes);
      if (typeof owner === "boolean") {
        respond(owner);
        return;
      }
      owner.then(respond, () => respond(false)).catch(() => {
        if (res.headersSent !== true) next?.();
      });
    }));
  };

  // The canonical in-app page at /_boosthis (and /_boosthis/, so neither habit
  // 404s) — the same markup every other kit serves, written straight from the
  // shipped page file. UNGATED, exactly like the /panel read below that it
  // fetches its numbers from: the markup is static, holds no measurements, no
  // route labels and no credential, so gating it while /panel stays open would
  // protect nothing and only puzzle a developer whose badge works while the
  // page 403s.
  const servePage = safeRoute("html", (_req: ReqLike, res: ResLike) =>
    sendHtml(res, PANEL_PAGE_HTML),
  );
  app.get(base, servePage);
  app.get(`${base}/`, servePage);

  // This kit's richer local view. It renders route labels, learned budgets,
  // raw samples and the read-token card, so it keeps the loopback guard the
  // whole dashboard used to have — same gate as every JSON endpoint it reads.
  serve("/dev", "html");

  serve("/healthz", "json");
  serve("/summary", "json");
  serve("/recent", "json");
  serve("/budgets", "json");

  // Closed pulse read for the floating bubble — deliberately UNGATED (no
  // loopback guard): the injected badge polls it from any page the app
  // serves, and the shape is closed + coarse ({score, rating, sampleCount}
  // — never route labels, durations, or per-route data). The middleware
  // serves the same path directly, so this route is parity for hosts whose
  // routing reaches mount() first.
  serve("/pulse", "json");

  // Closed panel read for the bubble's dashboard panel — same UNGATED
  // visibility policy as /pulse; the shape carries only scores, ratings,
  // labels, and numeric captions (no routes, no URLs, no raw samples).
  serve("/panel", "json");

  // "Connect your AI" — surfaces the install id + read-only read token + a
  // paste-ready hosted-MCP config. This endpoint emits a CREDENTIAL, so unlike
  // the perf-data endpoints it is ALWAYS loopback-only: `allowRemote` never
  // opens it. A remote request (even with allowRemote true) gets 403.
  serve("/connect", "json");

  // "Connect to your account" auth context for the floating bubble's account
  // card. Like /connect this emits a CREDENTIAL (the install delete token used
  // to claim/link the install), so it is ALWAYS loopback-only — `allowRemote`
  // never opens it, and a proxied loopback peer (forwarding headers present)
  // is rejected by the SAME strict guard as /connect. A remote request gets
  // the host's own answer, never a token. The delete token is NEVER surfaced
  // through the /panel or /pulse reads — only here, behind the loopback gate.
  serve("/account", "json");

  // The standalone "is Boosthis working?" page — the surface a back-end app
  // with no UI has instead of the floating bubble. Same STRICT loopback posture
  // as /connect and /account (`allowRemote` never opens it), because it is a
  // developer's local diagnostic, not a public health page. It renders no
  // credential, so a 403 here costs nothing but keeps the app's public surface
  // exactly as small as it was before Boosthis was installed. The middleware
  // serves the same path directly; this route is parity for hosts whose routing
  // reaches mount() first.
  serve(STATUS_SUFFIX, "html");
}
