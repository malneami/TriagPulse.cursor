/** Floating Boosthis bubble for Node/Express apps — the live perf badge.
 *
 * The middleware injects a small self-contained <script> into outgoing HTML
 * pages that draws a movable badge showing the server's live page pulse: one
 * score, one rating, one sample count. The badge polls the closed
 * `GET /_boosthis/pulse` endpoint (served directly by the middleware, so it
 * works without `mount()`).
 *
 * Whether the script is injected at all (first match wins):
 *   1. `BOOSTHIS_DISABLED` — the global kill-switch always wins (not injected).
 *   2. `BOOSTHIS_BUBBLE` env/global — "1"/"true"/"yes"/"on" wants it,
 *      "0"/"false"/"no"/"off" does not; anything else falls through.
 *   3. `BOOSTHIS_NO_BUBBLE` truthy hides, then `BOOSTHIS_FORCE_BUBBLE` truthy
 *      shows. These legacy aliases lose to `BOOSTHIS_BUBBLE`.
 *   4. The `bubble` option passed to `boosthis({ bubble })`.
 *   5. Default: WANTED.
 *
 * Who sees a wanted bubble (owner decision, 4 Oct 2026 — "the floating bubble
 * is only for the owners"): the people visiting an app are the owner's
 * customers and must NEVER see it. The script is injected only into pages
 * served to a browser switched on with the owner link from the project's page
 * on Boosthis (a pass Boosthis confirmed, see ownerLink.ts), or to the machine
 * itself after `?boosthis=on`. It then opens with `OWNER_GATE_JS`, a second
 * check that draws nothing unless that browser carries the owner marker
 * cookie. No setting or option shows it to every visitor.
 *
 * Privacy: display-only. The injected script reads the closed pulse shape
 * ({ score, rating, sampleCount }) from the app's own origin and one marker
 * cookie the kit set; it never transmits anything anywhere else. Injection is fail-open: any doubt (non-
 * HTML, compressed, streamed past the cap, headers already sent, missing
 * </body>, any thrown error) serves the original bytes untouched.
 */

import { summary } from "./samples";
import { linearScore as checkedLinearScore } from "./healthAxes";
import { BUDGET_BASELINE_N } from "./budgets";
import {
  BASELINE_ALGORITHM,
  BASELINE_RECENT_N,
  DECIDED_PART,
  DECIDED_PART_AXIS,
} from "./meterAxes";
import {
  SCORE_THRESHOLDS,
  RESILIENCE_MIN_MEDIAN_MS,
  RESILIENCE_MIN_TAIL_SAMPLES,
  RESILIENCE_TAIL_FLOOR_MS,
  type Rating,
  type NoScoreRating,
} from "./thresholds";
import { isBoosthisDisabled } from "./runtimeFlags";
import { FREEZE_COUNT_MS } from "./eventLoopLag";
import { overWords } from "./rateHonesty";
import { SYSTEM_LIMITED_READINGS } from "./systemLimits";
import {
  capturePerfSnapshot,
  nextSnapshotDelayMs,
  type NodeAxisResult,
  type NodeAxisValue,
} from "./snapshot";
import { getEntitlementGateKind, getEntitlementMessage } from "./killSwitch";
import {
  getDroppedRowCauses,
  getDroppedRowCount,
  getUndeliveredCauses,
  getUndeliveredRowCount,
  type DropCause,
  type UndeliveredCause,
} from "./dropReport";
import {
  askRegistration,
  getDroppedUploadCount,
  getLastUploadFailure,
  getPanelInstallId,
  getPanelProjectKey,
  getRegistrationRejection,
  getRegistrationRefusalKind,
  getRegistrationRefusalRetryAfterSeconds,
  getRegistrationRefusalSentence,
  describeRetryWait,
  isLastUploadAttemptFailed,
  isRegisteredForPanel,
  isSharingOnForPanel,
  type UploadFailReason,
} from "./telemetry";
import { getRegistrationVerdict } from "./registration";
import { describeProjectKeySource } from "./projectKey";
import {
  getKitProject,
  getKitPromises,
  type KitPromise,
  projectDisplay,
  INSTALL_ID_LABEL,
  INSTALL_ID_UNKNOWN_TEXT,
  PROJECT_LABEL,
  PROJECT_UNKNOWN_TEXT,
  SCORE_CAPTION,
} from "./projectIdentity";

/** The closed pulse endpoint path. Served by the middleware itself (and by
 *  mount() for parity), so the bubble works with `app.use(boosthis())` alone. */
export const PULSE_PATH = "/_boosthis/pulse";

/** The pulse endpoint path suffix, appended to the mount prefix. */
export const PULSE_SUFFIX = "/pulse";

/** The panel endpoint path suffix — the closed, coarse dashboard read the
 *  bubble's full panel polls. Same visibility policy as the pulse. */
export const PANEL_SUFFIX = "/panel";

/** The closed panel endpoint path. Served next to /pulse (same UNGATED policy)
 *  so the dashboard-first bubble panel works with `mount()`/`app.use()`. */
export const PANEL_PATH = "/_boosthis/panel";

/** The closed account auth-context endpoint path suffix, appended to the mount
 *  prefix. Served by mount() behind the SAME loopback guard as /connect. */
export const ACCOUNT_SUFFIX = "/account";

/**
 * Boosthis brand icon — the signature navy "B" with an orange lightning bolt,
 * the SAME mark shipped as the RN kit's `src/ui/brandIcon.ts` (which resizes
 * artifacts/mobile/assets/images/icon.png). Here it is the 96x96 variant,
 * embedded as a PNG data URI so the injected floating bubble shows the real
 * brand mark without the kit shipping any asset files — a plain <img src>
 * renders it in every browser. Do NOT regenerate or substitute it here; keep
 * it byte-identical to the shared mark.
 *
 * Regenerate (keep it byte-for-byte the app icon, just smaller):
 *   magick artifacts/mobile/assets/images/icon.png -resize 96x96 /tmp/b.png
 *   base64 -w0 /tmp/b.png
 * paste below, then repack the kit.
 */
export const BOOSTHIS_ICON_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAMAAADVRocKAAACK1BMVEUZIDoYHzoXHjgWIDkVGzQZGS4aGzMeIDY1OEpIR1dEQ1M/QVE9O0yxkFzjsmPcql7drWHdsGZHODcHES9LSllISFdLSVleVE3/w2T/xWX/x2j/yGj/0m/CnWUmKT1BQE80Nkmxi1n/xWLzuGP6v2X8wWVKRUklJTkSFzD8vmSOclEmK0ESFi39u2PcqGJtXlAuMUQ/QE9APk92Y1I+P1AuLUAOEynJk1f8tmD1sl5ZSEX8sl6Mb006OEanfVPapWA0MkTvp1wrKj0BByHRlVX7q1osJCtBP1BzW0gDDSk5N0mod0z4qFhIPkGfcEv+qVc5MzzpmFIpJjY5NkaFXkb3o1R3Uz8xLj7RjFLKhU4NECZgR0D7pFX6nFFIMzMjIja0c0n2m1EiHi6UXUBmRjk0KzXijE37mU8SEyb5k0vnkE/biE3ahkzgjlTJd0VbQDr3kkqta0EwL0H2ikb3jkj4jUgrKDfegEb6i0UIDih3RzgKDCP1hENYPTuUVzupYj7uhUM+LjJALzI5KSw3KCvDaDpHJyj9g0LdeEEWGC8hHzS4WzT2fkD0ej1ULSoGCiEoJzsFBxwICh+lVjVpNSsGCB0sGh+LSDGTRSv+ejwoGSbtdT30dDr/gD/ZZzcZEBzqaTX8dDkzHCJ4Oij1cTeJQSzzazSqTjD/cjXIWjL9bTQXDxvxZjEwGR64UC+GOib4ZzClSSzsYi/ZXTAiFiP2Zy7+aS4bFSaDQTBq3a+TAAAK3ElEQVRo3rWZi3vb1BnGFWM5l2pslLVLYWvNWiqFqhCyWSsYM1UhLUm7ZbiwDK2tSAuLs44uywUilI1baeasqSIRDwJdga6ENsvWC13Zn7fvOxfpSLZz4Xn6xrHko3Pe33c5slNXktJq4ceWlsyaSly/jx3IQlzb0iI1ErpuyB39W5oMg/d99b78uK7xBtSSaWlclrXcs9nsZjGJBNYLPZvdPIHUa73AE4DNEzKZjbQzwYnOUsemgA25xsHjCX0hOK8FkdZwTb7OJAey9ckkZjcFkGjjirMTNhBfS6l5IlKdezbGZOL1MWEdpdOQEvbpCmSbEjIbhIgAsarJBNZzzGSaEyTRv36jiwBZziXUKsFvswiicCUMNOWfbWvviLRli0LU9p37v0v1Pa4HHrh/64ONU4pjlRKt5IDvb9tOtA3VjjjlB507Ojs7dxA99DDRjh/+aKe0Zt3gISXH6EYEAHWGB7Hv2JV/5Me79zA9uudRos7dexUlrzYD0IgbRaC1bW+nAO7f0bZ3d1dCkM2ehx/bpyhwLaOvsZsaAzB4UhvejPxjnfuThK49Ox7PtynKFri6T2teqIY1pID2dqHPj3ftR1Fvcrb/oSe6FQJo396tNyU0AcCq9gjwZE/+J537Y1FW5yPor/wUp24vGJsBaAzA/RWl+2ddB/Yn1fXU3jz4P0lntqvGZgGxYKc8XSweAAn+Bzqf2aeUYkBHVtf0DQPyMWAXxK90P1t8ihCQQY9dPzfbSgDYxeZtMw19wwBDBIB/ae/BYrHICCh40fVEt+gPyjUuUgzQowiMPC//rp4eRTGlZ7qKKXU9q2KBBEC7ZayZgaYzgKYBgK9C/57W3ueKfcU+UAw4eMiwwL9HaFVJJxbQCvjhMVOAhrYMAMcog8Por/RkthL3WMW+ruf7s4aaqFBHR8YgACpiSwA0bhzTIHgNt0IEwH0+oGSOFI+mCM/hIqOwS0wBdiqacDcMGl8gQOMAHYd4Bj0k/lK+8Iu+Om3tx0XZUk/PYaoOeOwEgIY2GLmGQo6kc9EBvG6Y7ay/Sqlkqr8sDlLbo4Pk5GjxSD/JXi90KBDGYYrpKBjMSMdCa+y8DoAlMkkDiH++8KsXBkUB4WD5QTJPV3vohxFClI5uI6p/ZJrVJAYSBYDDBFAqHTPVFwdfShAGi7/upyU1JIUBcHKHaSRcNNIRTdKT3hzACpQfsn4TA+jJyzZ10owMB+DsqERx9FgTKelugBBA/Qcggd8eP/FSQn0n+8k0mMcBlGLhGLoY9ISKAdgYW9jdQYpbOpYfcl45PnxCQAwPHmH+hmG3Kvh2wQGqrRsGv2bwekjRSETQjcJh6g8JbB0eBgATAI6/cMpmceiGNQCKCDnbSIhOk0R73oMCL9BQ5vTx4WGBMdz3aq9hoyABzTTNYxGiTTNSIvFKsblu8GohAPzzpvXa70ZGhgUdf7kSy8IcEVGCz2bFNOoARgIQZ2UUoLboPyQ9PzI6IurE78+c+QOIPJ95/fWnC2YeACCl1TYaSeKtFcGWMoD+plU+OzKaFOMQjZ540YIqAWGgpOQNoxnASBNsAOTBf6j1jyNjKcAoGRjD57GR046JyrdBH3J2M0D9GADQ37RyfxodS3vHr0ZecayhcULIK5ZtNClRo0GrhP5D6smJyUnmOoYiiCk6MDl69g3LssYJYaCAcdkJBO4zuzHAtmBzmONW5vQoEFBjY5Njk0xTRJNTb76mAmAICXmLbd1kQ8lQc4ClvvHm9MTUpKgpZj81OT1xstWyWAqOa1MCSSK5ayQhJZqUbbtq3hwfH8q8NT0RKQp+Ah4T8PRqzooAVqvh2p5tx5CYkgDYNC1XBX/Lcs5Oz0wICHaklLey5TIBFEgTLNll5p6Yik4ANq8YK5vtqebQkCX9eXoGBJb4OyXYT81M/QX8OQBlmq2unRZJRKLGhngBMoCVrW9PvzMDP1xRKjMz02/LDvO3CoXCOEJMx7M9z40wLo3blhjKqANY77733rvvv3/uHDzOnTv0AckHMgL/s6ecsgBAWZaZc8Hf9UBxBjYHQF3IMF63PWcclzoO/FNSprLPz0Sa/euhXDkJsArY7qpHCcTEZclIYmc8KtchS8HDcebmToGcyt9mL0SEk3LsH2dgjVvEHRlgTo4xgMafAqgAAMmVint+Zv4CaGZmfn72ol+p6BU5p6YA1njOd10GYCceBfCyeSxHB+cvlFVKkIMw+HB2nhAuzM8uBmEN5XtVtRAXCQFlYs6iZASJBU56wDLweIlUVXWcshwGf6fu6P9R4Pm+T6b5NBKKIM+6V4eQBP8UYGEBEJiBF3y8NE81+yHx9/lM1VqwYhWgRkLwAiD2FgAWAoAg937y6SXq/48PoDJ+GHKCby/s3CkAVJ/F7rHdBAB4StrD8BzPAGukysFHs5cIYenyZ5BAKKTg5yyRUPai3FxWKMl2k+ZwAVYt0AJhAo7+2edfXELNf3olCEOM3/eYk6/DxIUFayd5thZsX/QiAC8tAigzfwT0/3PpKgWcJxuIEKgAoy4Q4dyFsqXz9kd5SGl3kjdzR/+53KnLXyDg6tIi8w99L0Y4xJ4AVAAwOq2QH2XgevwWwCMA1Mh/znhrifp/SW8AIQGUo6p8tqoCgPp7vs92s8SbHrcCAFH8kIBMElhe+iqoUSUJjiqIATyeYcMeeF6YI9sT7SGBxWvLy1eXr10PABBQCK4Nabu9BEC1uS/vMc1AMCdrYwC8m15fWV5evnb5X+wdIgXQHYfmSgH0LhT3sSTUxqPLIIMo/py9uLK6vLzy+b/Bn9cI+8zaUZNxIplOOB5xFioolIi8DvE2DWXSXbDPyfp1AsANGsSAKBfPcVqdSGouvQV8XxLcKQJmyMw+J9sXV1ZXV6/BBg3iBCJOUMNvN53cXCulqDJJjkkA+OT2jy8QAH41WnX/A4CVG+CPAtOgxkHwOkx8k+rMOXZNJIQMIEZPQFBYukR2z9+E+G8FDRXaubRI+cKwxuzxV2LWsT8C5uj8qvvVyu2V6yG/Iu7lSkUwztCDHtAdwDcCMiShNqxqYY2trfafX169+fUdGz4hK5VqtZprIuafC+MCkp2AZlJINk6smh8GFCBXem+t3Lx9xSX+hIAQ+BsjRcqICcRbmTzzEvHYafv0nEwKdOX2f1cu9ld0ESBnq3Jjf7nWQCIg2t0AyGWz2Ur/x3fvLvbjnxB65A8E+MEUYEYS5Af1/nEG0HkoWQTIQqDuJ7fv3ugFf130R19Nk5k/PjGSFzTOAHtA+hwPIkCrVvq/vHYL/wTSK4J/Ff2rGv3OLAJkm/hDyFINAWF0+wc1nwCyFfeb1esVu1IR/TWSgcYykak5+mc9fiemCRLuoPQwAfTeuH0n5Y8IYghNAFe2mSD8aijcgEkvqVYPCHSwcO98fQUanAYkvrJk3c3akDi3ThOkWn0CAKjqvf8jGwh3EN07NAGZ7FQSNgNUbXJzNS4RAPz6MehB1buzaLP9U6nK6f8filTVvRr9qAsavN3SDBoAjKrtf2Pb0bceDFRh3zHxo+2JHxINfPCilHgVvWAx1eLOJQ5iQ5tEzqpWk3iPg7ViSa8ix5oQQhRXOsIog2A9QBxxtFuC+EJqbo3nygFRwnWQIA0IGgOCxgEFFBCXeJ3yNM2uwSxGkDawfpOAZBpS7R5LBPjf2mWDgHuewb0FBM3ut43df+sA4nsx3tzf3jMQT/4PiY93LR3+sbEAAAAASUVORK5CYII=";

/**
 * The accepted-terms revision the bubble's first-open gate records/checks.
 * Byte-equal to the canonical TERMS_VERSION constants (RN
 * `lib/boosthis-runtime-rn/src/ui/consent.ts`, web
 * `lib/boosthis-runtime-web/src/terms.ts`, server
 * `artifacts/api-server/src/lib/accounts.ts`) that the `scripts`
 * legal-consistency test keeps in agreement. The Node runtime is a server kit
 * with no TS consent module of its own, so the value is embedded here as a
 * literal; do NOT edit it in isolation — bump it in lockstep with the others.
 */
export const TERMS_VERSION_LITERAL = "2026-07-21";

/** Max response size we will buffer while deciding whether to inject. */
export const MAX_INJECT_BYTES = 2 * 1024 * 1024;

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

type BubbleFlag =
  | "BOOSTHIS_BUBBLE"
  | "BOOSTHIS_NO_BUBBLE"
  | "BOOSTHIS_FORCE_BUBBLE";

/** Read exactly the named bubble flag from process.env or globalThis. */
function readBubbleFlag(name: BubbleFlag): string | boolean | undefined {
  let raw: string | boolean | undefined;
  if (typeof process !== "undefined" && process.env) raw = process.env[name];
  if (raw === undefined) {
    const g = globalThis as unknown as Record<
      BubbleFlag,
      string | boolean | undefined
    >;
    raw = g[name];
  }
  return raw;
}

function parseBubbleDirective(
  raw: string | boolean | undefined,
): boolean | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "boolean") return raw;
  const value = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  return undefined;
}

function isTruthyAlias(raw: string | boolean | undefined): boolean {
  if (typeof raw === "boolean") return raw;
  return typeof raw === "string" && TRUE_VALUES.has(raw.trim().toLowerCase());
}

/** True when this process looks like a dev run: no deployment marker and no
 *  production env flag. NOTE: the bubble does not key its visibility off this
 *  helper (a wanted bubble draws only in a browser the owner switched on, dev or
 *  live alike); it stays part of the public API for callers that want the
 *  dev/prod signal. */
export function isDevProcess(
  env?: Record<string, string | undefined>,
): boolean {
  try {
    const e = env ?? (typeof process !== "undefined" ? process.env : undefined);
    if (!e) return false;
    if (e.REPLIT_DEPLOYMENT !== undefined && e.REPLIT_DEPLOYMENT !== "") {
      return false;
    }
    const nodeEnv = (e.NODE_ENV ?? "").toLowerCase();
    const plainEnv = (e.ENV ?? "").toLowerCase();
    if (nodeEnv === "production" || plainEnv === "production") return false;
    return true;
  } catch {
    return false;
  }
}

/** Resolve whether the bubble should be injected. See precedence above. */
export function resolveBubbleVisibility(option?: boolean): boolean {
  // The kill-switch gets its own fail-closed guard. No lower-precedence read is
  // attempted when this check says stop or cannot be completed.
  try {
    if (isBoosthisDisabled()) return false;
  } catch {
    return false;
  }

  // Every ordinary configuration failure is fail-open. The host must never
  // crash, and a broken lower-precedence accessor must not become a silent off.
  try {
    const directive = parseBubbleDirective(readBubbleFlag("BOOSTHIS_BUBBLE"));
    if (directive !== undefined) return directive;
    if (isTruthyAlias(readBubbleFlag("BOOSTHIS_NO_BUBBLE"))) return false;
    if (isTruthyAlias(readBubbleFlag("BOOSTHIS_FORCE_BUBBLE"))) return true;
    if (option !== undefined) return option;
  } catch {
    return true;
  }
  // Default TRUE — visible on live/published sites too. An install that shows
  // nothing in production reads as broken; hiding is an explicit opt-out.
  return true;
}

export interface PagePulse {
  /** 0–100 composite, or null until at least one sample has been recorded. */
  score: number | null;
  rating: Rating | null;
  sampleCount: number;
}

/** Map a p95 duration onto 0–100 against the TTI budget (100 at/below the
 *  good line, 0 at/above the poor line, linear between). */
function linearScore(durationMs: number): number {
  const { good, poor } = SCORE_THRESHOLDS.tti;
  // Delegates to the kit's one checked scorer. This was a private copy of the
  // interpolation with no band check in it, so an inverted TTI band would have
  // been refused everywhere EXCEPT here, where it would have gone on
  // publishing a score.
  return checkedLinearScore(durationMs, good, poor);
}

function ratingForScore(score: number): Rating {
  if (score >= 85) return "good";
  if (score >= 60) return "needs-work";
  return "poor";
}

/** Compute the closed pulse shape from the in-process sample buffer. Never
 *  includes route labels or durations — one score, one rating, one count. */
export function computePulse(): PagePulse {
  try {
    const sum = summary();
    if (sum.total === 0 || sum.p95_ms === null || sum.p95_ms === undefined) {
      return { score: null, rating: null, sampleCount: sum.total ?? 0 };
    }
    const score = linearScore(sum.p95_ms);
    return { score, rating: ratingForScore(score), sampleCount: sum.total };
  } catch {
    return { score: null, rating: null, sampleCount: 0 };
  }
}

/** One rendered meter row in the dashboard-first bubble panel. `score`/`rating`
 *  are pending while an axis is still measuring so the DOM layer renders a
 *  "measuring…" state with a zero-width bar (never a fake zero).
 *
 *  A row with no score is not always warming up, and the rating says which:
 *  "pending" is a score still coming, "not-available" is a reading this host
 *  cannot take, and "not-scored" is a reading that is real and deliberately
 *  never graded. All three used to be "pending", so the panel promised a
 *  verdict for two states that will never produce one. */
export interface PanelAxis {
  key: string;
  label: string;
  score: number | null;
  rating: Rating | NoScoreRating;
  caption: string;
}

/** The closed panel shape: the pulse trio plus an ordered list of meter rows.
 *  Never includes route labels, URLs, or raw sample data. `notice` carries the
 *  fixed developer-facing rejected-registration banner when the server refused
 *  this install's registration for a reason the developer must fix in code. */
export interface PagePanel extends PagePulse {
  axes: PanelAxis[];
  projectKey: {
    display: string | null;
    source: string;
  };
  /** WHICH PROJECT this kit feeds, already spelled out by {@link projectDisplay}
   *  — the developer's own name plus the short code the AI connection uses, or
   *  the kit's own honest wording when the server has not said yet. Always a
   *  string, so the panel never has to invent a fallback of its own. */
  project: string;
  /** The identity this kit is holding right now, or null when it has none
   *  yet. Printed beside the registration verdict so a developer (or an AI)
   *  can compare it with the dashboard instead of guessing which install the
   *  verdict is about. */
  installId: string | null;
  notice?: PanelNotice;
  drops?: PanelDrops;
  /** Rows this kit never got out. Omitted entirely when there are none. */
  undelivered?: PanelUndelivered;
  /** The developer's own standing promises. Omitted entirely when the project
   *  holds none, so a project that has written none down sees nothing new. */
  promises?: PanelPromises;
  /** WHERE SCHEDULED JOBS LIVE. Always present, never omitted — see
   *  {@link PanelJobs}. */
  jobs: PanelJobs;
}

/** Where this kit's scheduled jobs can be read, as a CLOSED token. The page
 *  holds the sentences; the wire carries only this word, exactly like the drop
 *  causes and the promise standings.
 *
 *  Two answers, and the page has a third of its own for "no answer at all":
 *   - `reported`:     this kit reports named job runs to Boosthis, so they are
 *     listed on the project's dashboard and never on the kit's own page.
 *   - `not-reported`: this kit reports no named job at all (background work
 *     reaches Boosthis only as the aggregate meter), so the dashboard's
 *     scheduled-jobs list stays empty for this app whatever it runs.
 *
 *  Never omitted: the whole point is that a page which cannot show jobs says
 *  so whether or not the app has any. An install with no jobs and an install
 *  with sixty send the same token.
 *  See docs/decisions/kit-page-says-where-jobs-live.md. */
export type PanelJobReporting = "reported" | "not-reported";

export interface PanelJobs {
  reporting: PanelJobReporting;
}

/** This kit HAS a job-reporting call (`trackJob` / `beginJob` /
 *  `reportJobRun`), so its jobs reach the dashboard. Held here as a constant
 *  rather than sniffed at runtime: it is a fact about the kit's own surface,
 *  not about what this process happens to have run, and an app that has not
 *  reported a job yet must still be told where jobs appear. The cross-runtime
 *  guard derives the expected token from lib/background-work-coverage.json. */
export const PANEL_JOBS: PanelJobs = { reporting: "reported" };

/** The project's promises as the panel carries them: the developer's own
 *  words, and a CLOSED token for where each stands. No sentence of ours
 *  travels — the page holds the standing words as literals, held byte-equal
 *  to the server's vocabulary by a test — and no verdict travels either: the
 *  reply this comes from is read at registration, and a "broken" that went
 *  stale hours ago would be a claim this page cannot stand behind. */
export interface PanelPromises {
  /** Every promise the project holds, so the page can say what it is not
   *  showing rather than trimming silently. */
  total: number;
  items: KitPromise[];
}

/** Rows the server accepted the batch for and then refused. Carries only a
 *  count and CODE-DEFINED cause markers — the words shown in the panel are
 *  literals in the injected snippet, exactly like {@link PanelNotice}, so no
 *  server text can ever be rendered. Omitted entirely when nothing has been
 *  dropped, so a healthy app shows nothing at all. */
export interface PanelDrops {
  count: number;
  causes: DropCause[];
}

/** The bubble's drops line, or null when the server has never reported a
 *  dropped row in this process. Fail-safe: any error degrades to null. */
export function computePanelDrops(): PanelDrops | null {
  try {
    const count = getDroppedRowCount();
    if (count <= 0) return null;
    return { count, causes: getDroppedRowCauses() };
  } catch {
    return null;
  }
}

/** Rows this kit gathered and then gave up on, so they never reached the
 *  server at all. Same shape and same rules as {@link PanelDrops} — a count
 *  and CODE-DEFINED cause markers only — but deliberately a separate line: the
 *  server refusing what we sent and us never sending it are different failures
 *  with different answers, and a total that merges them asks for neither. */
export interface PanelUndelivered {
  count: number;
  causes: UndeliveredCause[];
}
/** Fixed, code-defined banner shown at the TOP of the bubble panel when the kit
 *  is not honestly feeding the dashboard. Every string here is a literal in
 *  this file — the panel NEVER renders server-provided or developer-provided
 *  text, so the banner can carry no attacker-controllable input. The `kind`
 *  markers, ordered by how completely each state blocks the developer:
 *   - `install-id-not-uuid`: the server refused the id outright.
 *   - `not-registered`:      Boosthis TOLD us this install is not on file (or
 *     refused the key), so nothing is being sent.
 *   - `registration-throttled`: Boosthis answered, and the answer was "not so
 *     fast". Temporary, self-clearing, already being waited out — so it must
 *     never borrow `registration-unknown`'s "could not be reached" wording,
 *     which sends a developer hunting a network fault that does not exist.
 *   - `registration-unknown`: we could not get an answer about it at all. Its
 *     own visible state, never the failure state's wording — "nothing is being
 *     sent" is a thing this kit may only say when it KNOWS it.
 *   - `sharing-off`:         registered, but nothing is being uploaded — the
 *     quiet failure this notice exists to end: the app runs, shows live local
 *     meters, and looks healthy while the dashboard it feeds stays empty. */
export interface PanelNotice {
  kind:
    | "install-id-not-uuid"
    | "no-project-key"
    | "no-project-key-chosen"
    | "not-registered"
    | "registration-throttled"
    | "registration-unknown"
    | "sharing-off"
    | "uploads-failing";
  title: string;
  body: string;
  /** `uploads-failing` only: the code-defined reason marker. Resolved to words
   *  by the renderer, never by whatever answered the request. */
  reason?: UploadFailReason;
  /** `uploads-failing` only: how many uploads have been lost so far. */
  lost?: number;
  /** `registration-throttled` only: the server's own `Retry-After`, in
   *  seconds. A NUMBER, never text — the renderer builds the sentence from
   *  literals around it, exactly as it does with `lost`. */
  retryAfterSeconds?: number;
}

/** The four reasons a whole batch can fail, in words. Code-defined and closed:
 *  a response body never reaches a customer's screen. Identical to the status
 *  page's `uploadFailText` on purpose — the two surfaces must never tell a
 *  developer two different stories about the same failure. */
export function panelUploadFailText(reason: UploadFailReason): string {
  if (reason === "unauthorized") {
    return "Refused — credentials rejected";
  }
  if (reason === "rejected") {
    return "Refused — batch rejected";
  }
  if (reason === "server-error") {
    return "Boosthis failed to store it";
  }
  return "No answer — timed out or unreachable";
}
/** Resolve the panel's notice, or null when there is nothing to say. Ordered
 *  exactly like the Ruby kit's `compute_panel_notice`: a server-refused id
 *  first, then a kit that never registered, then a registered-but-silent
 *  install, then null. Fail-safe: any error degrades to null (the panel then
 *  renders normally) — a readout bug must never blank the bubble or
 *  destabilize the host. */
export function computePanelNotice(): PanelNotice | null {
  try {
    // Ask Boosthis whether this install is on file. Fire-and-forget and
    // self-throttled: the verdict below reads whatever answer has landed, and
    // says "cannot tell" until one has.
    askRegistration();
    if (getRegistrationRejection() === "install-id-not-uuid") {
      return {
        kind: "install-id-not-uuid",
        title: "Registration rejected",
        body: "Install ID must be a UUID. Mint a real UUID and restart.",
      };
    }
    const refusalKind = getRegistrationRefusalKind();
    if (refusalKind === "no-key-missing" || refusalKind === "no-key-chosen") {
      return {
        kind:
          refusalKind === "no-key-chosen"
            ? "no-project-key-chosen"
            : "no-project-key",
        title:
          refusalKind === "no-key-chosen"
            ? "Running with no project key"
            : "No project key",
        body: getRegistrationRefusalSentence() ?? "",
      };
    }
    if (refusalKind === "throttled") {
      // BEFORE the verdict, because the verdict for a throttled install is
      // "unknown" and the unknown notice says Boosthis could not be reached.
      // It was reached; it answered; the answer was "wait". Saying otherwise
      // is what sends a developer to check egress that is working.
      const secs = getRegistrationRefusalRetryAfterSeconds();
      return {
        kind: "registration-throttled",
        title: "Waiting — too many new registrations",
        body:
          "Boosthis is rate-limiting new registrations for this project key, " +
          "so this app is not on file yet. It is temporary and needs nothing " +
          "from you: the kit is waiting " +
          describeRetryWait(secs ?? undefined) +
          " and will register itself, with no restart. Do not change the " +
          "install line's id while this is showing — a new id is a new " +
          "registration and makes the wait longer.",
        ...(secs !== null ? { retryAfterSeconds: secs } : {}),
      };
    }
    const verdict = getRegistrationVerdict();
    if (verdict === "unregistered") {
      const reason = getRegistrationRefusalSentence();
      return {
        kind: "not-registered",
        title: "Not registered yet",
        body:
          reason ??
          "This app has not registered with Boosthis, so nothing is being sent. Check the project key and this app's outbound network access, then restart.",
      };
    }
    if (verdict === "unknown") {
      // Local state may fill the gap ONLY while the question is unanswered: a
      // process holding a server-minted delete token knows something real. It
      // still cannot turn an unanswered question into a negative.
      if (!isRegisteredForPanel()) {
        return {
          kind: "registration-unknown",
          title: "Can't check right now",
          body:
            "Boosthis could not be reached to confirm whether this app is " +
            "registered, so this panel cannot say either way yet. This is " +
            "not a failed install and it does not mean anything stopped — it " +
            "settles by itself once the check goes through. Do not change " +
            "the install line's id while this is showing.",
        };
      }
    }
    if (!isSharingOnForPanel()) {
      return {
        kind: "sharing-off",
        title: "Nothing is being uploaded",
        body:
          "This app is registered, but sharing is off: these meters stay on " +
          "this screen and your Boosthis dashboard stays empty. Turn sharing " +
          "on there, or start the kit with shareMeterWithAI: true.",
      };
    }
    // LAST in the chain, and deliberately so: an app that never registered has
    // no uploads to fail, so the earlier (more useful) problem stays on screen.
    // Reached only when the MOST RECENT attempt is the failed one — a burst can
    // land a success and a failure in the same millisecond, so this reads the
    // explicit flag and never compares two timestamps.
    const failure = getLastUploadFailure();
    if (isLastUploadAttemptFailed() && failure) {
      const lost = getDroppedUploadCount();
      return {
        kind: "uploads-failing",
        title: "Uploads are not getting through",
        body:
          "This app is registered and sharing is on, but the last batch of measurements did not reach Boosthis, so your dashboard is missing the most recent data." +
          " " +
          panelUploadFailText(failure.reason) +
          "." +
          (lost > 0 ? " Uploads lost: " + String(lost) + "." : ""),
        reason: failure.reason,
        lost,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Display order + labels for the panel's meter rows. Core axes always render
 *  (as "measuring…" while absent); environment-dependent axes (container
 *  pressure, GC meters, …) appear only when honestly computable — mirroring the
 *  honest-N/A doctrine of the meter page. */
export const PANEL_AXIS_LABELS: Record<string, string> = {
  responsiveness: "Responsiveness",
  resilience: "Resilience",
  budget: "On budget",
  baseline: "Baseline",
  network: "Network",
  idle: "Idle efficiency",
  latencyFloor: "Latency floor",
  confidence: "Confidence",
  eventLoopLag: "Event-loop lag",
  cpuEntitlement: "CPU entitlement",
  contextSwitching: "Context switching",
  threadFootprint: "Thread footprint",
  queueTime: "Queue time",
  blockingAsync: "Blocking async",
  forkChurn: "Fork churn",
  memoryStability: "Memory stability",
  heapHeadroom: "Heap headroom",
  gcPressure: "GC pressure",
  gcPauseTail: "GC pause tail",
  gcGenerationBalance: "GC generation balance",
  containerPressure: "Container pressure",
  crashFree: "Crash-free",
  reliability: "Reliability",
  eventLoopUtilization: "Event-loop utilization",
  heapFragmentation: "Heap fragmentation",
  handleLeak: "Handle leak",
  // 2026-08 Node meter batch (mirrors the web dashboard's AXIS_LABELS).
  worstFreeze: "Worst freeze",
  backpressure: "Backpressure",
  connectionSetup: "Connection setup",
  handleChurn: "Handle churn",
  gcTrend: "GC trend",
  workerImbalance: "Worker balance",
  rejectionPressure: "Rejection pressure",
  promiseRejections: "Promise rejections",
  unhandledErrors: "Unhandled errors",
  timerHealth: "Timer health",
  heapWall: "Heap wall",
  startupImport: "Startup import cost",
  // 2026-08 batch 2 (mirrors the web dashboard's AXIS_LABELS).
  cpuConsumption: "CPU consumption",
  residentGrowth: "Memory growth",
  nativeMemoryMix: "Native memory mix",
  uptimeStability: "Uptime stability",
  heapSpacePressure: "Heap space pressure",
  arrayBufferRetention: "Buffer retention",
  eventLoopDelayTail: "Event-loop delay tail",
  eventLoopDelayMax: "Event-loop delay max",
  perfEntryBacklog: "Perf-entry backlog",
  asyncResourceDiversity: "Async resource diversity",
  diagnosticErrorVolume: "Diagnostic errors",
  diagnosticActivity: "Diagnostic activity",
  // 2026-08 additive display-only leak monitor (mirrors swallowedErrors doctrine:
  // runtime evidence only, never feeds Speed). Label "Leak Watch".
  swallowedErrors: "Swallowed errors",
  leakWatch: "Leak Watch",
  // Cookie Exposure — safe-flag exposure on cookies this app actually sets.
  // NOT in PANEL_EXPECTED_AXES: an app that sets no cookies must show no row
  // at all rather than a "warming up" one that never resolves.
  cookieExposure: "Cookie Exposure",
  // Cross-Origin Exposure — the cross-origin answers on the same responses:
  // any origin, the asking origin echoed back, a wildcard with credentials.
  // IS in PANEL_EXPECTED_AXES: every app answers requests, and the reading
  // arrives with the first one, so its warming row is honest. Never scored.
  corsExposure: "Cross-Origin Exposure",
  // Dev Posture — the development settings we can read; a clean tile means none
  // of them were on, NOT that the deployment is hardened. Frozen at startup and
  // display-only. NOT in PANEL_EXPECTED_AXES: it emits from the first snapshot,
  // so it never needs a warming-up row.
  devPosture: "Dev Posture",
  // Access Pressure — break-in pressure / traffic surge, the shape of who is
  // knocking. IS in PANEL_EXPECTED_AXES: every app answers requests, so a
  // 10-minute warming row is honest (unlike cookieExposure/patchLag).
  accessPressure: "Access Pressure",
  refusalHonesty: "Refusal honesty",
  // Patch lag — build-identity / exposure-window meter. Appears ONLY when the
  // build time is honestly known (like mcpTools it is NOT in
  // PANEL_EXPECTED_AXES, so it never shows a warming-up row).
  patchLag: "Patch lag",
  // Repeated Work — the same call made more than once inside ONE request.
  // NOT in PANEL_EXPECTED_AXES: it needs calls whose identity the kit can see
  // (`trackPerf`-wrapped work, outbound HTTP). An app that wraps none can be
  // honestly "cannot tell" forever, and a permanently-warming row would be a
  // fake meter.
  repeatedWork: "Repeated Work",
  // Database work — how much of a request was spent WAITING on the database.
  // NOT in PANEL_EXPECTED_AXES, for the same reason as repeatedWork: an app
  // with no database, or one using a client this kit cannot watch, honestly
  // has no reading, and a row that warmed up forever would be a fake meter.
  dbWork: "Database work",
  // Database sequencing — whether that database work happened in single file.
  // NOT in PANEL_EXPECTED_AXES, for the same reason as dbWork.
  dbSequencing: "Database sequencing",
  // Database rows — how much a query hands back. Same reason again, plus one
  // of its own: an app whose every read is a cursor reports no size at all.
  dbRowVolume: "Database rows",
  // Point-in-time occupancy of a real bounded connection pool. No pool means
  // no row; it is never a permanently warming expected axis.
  dbPoolPressure: "Database pool pressure",
  // AI calls — how long the AI part of a request takes, what it costs, and how
  // close the project is to its provider's limits. NOT in PANEL_EXPECTED_AXES,
  // and this is the point of the whole reading: an app that calls no AI
  // provider must show NOTHING here rather than a row of zeros or a row that
  // warms up forever. The rows appear the moment a call to a provider on the
  // kit's maintained list is watched, and never before.
  aiCalls: "AI Wait",
  aiSpend: "AI Spend",
  aiHeadroom: "AI Rate Limit Headroom",
  // Background work — jobs, queues and schedules: work with no request behind
  // it. NOT in PANEL_EXPECTED_AXES, for the same reason as dbWork: an app with
  // no background work at all honestly has no reading, and a row warming up
  // forever in a plain web app would be a fake meter.
  backgroundWork: "Background work",
  // Upstream cache — the hit/miss verdict declared by the services this app
  // CALLS (never this project's own hosting: a server cannot see that). NOT in
  // PANEL_EXPECTED_AXES: an app whose dependencies sit behind plain origins, or
  // one that calls nothing, never gets a verdict at all, and a row warming up
  // forever would be a fake meter.
  upstreamCache: "Upstream cache",
  // 2026-08 serverless batch. Present ONLY when this app runs as short-lived
  // functions; a long-running server never emits them. Deliberately NOT in
  // PANEL_EXPECTED_AXES for exactly that reason — an ordinary server would show
  // three rows warming up forever, which is the fake meter this whole doctrine
  // forbids. Labels mirror the web dashboard's AXIS_LABELS word for word.
  serverless: "Serverless Delivery",
  timeoutHeadroom: "Timeout Headroom",
  functionMemory: "Function Memory",
  // Live Connections — chat sockets, live feeds, streamed answers. Deliberately
  // NOT in PANEL_EXPECTED_AXES: a server that holds none must show NO row here,
  // not a warming one that never resolves. An app without a realtime feature is
  // not an app with a broken realtime meter.
  liveConnections: "Live Connections",
  // Failing Routes — of the answers this app sent, how many were its own
  // fault. Worded exactly as the dashboard words it, because it is the same
  // reading. NOT in PANEL_EXPECTED_AXES: the request middleware may not be
  // mounted at all (a worker serves nothing), and an app that has answered
  // nothing must show no row rather than one warming up forever.
  routeFailures: "Failing Routes",
  // How far this app is from its data, judged on how long a NEW connection
  // takes to open — never on the round trip, which would report a slow
  // service as a distant one. Always emitted by this kit (with "too few new
  // connections to judge" while it cannot decide), so it never needs to be in
  // PANEL_EXPECTED_AXES.
  dependencyDistance: "Data distance",
  // 2026-08 serverless limits-and-cost batch. Same reasoning as above: absent
  // on an ordinary server, and absent from PANEL_EXPECTED_AXES so an ordinary
  // server never shows them warming up forever. `kitFootprint` is what BOOSTHIS
  // costs this app — shown on every plan, because a vendor that puts its own
  // honesty behind a paywall has not been honest.
  coldStartCost: "Cold Starts",
  functionCpu: "Computing Time",
  functionLimits: "Platform Limits",
  functionCost: "Function Cost",
  functionKills: "Stopped Runs",
  kitFootprint: "Boosthis Footprint",
};

const PANEL_CORE_AXES = ["responsiveness", "resilience", "budget"] as const;
const PANEL_RATINGS = new Set<string>(["good", "needs-work", "poor"]);
const PANEL_CAPTION_MAX = 120;

/** The additive axes this kit reliably produces once the app is running, keyed
 *  by their WIRE keys (the keys `buildAxes()`/`readVitals()` upload). Each one
 *  missing from the live snapshot is appended as a muted "warming up" row so
 *  the in-app panel shows the SAME meter set the web dashboard renders for a
 *  Node project (`EXPECTED_AXES_BY_KIND.node` in the api-server's
 *  snapshotView). Environment-dependent axes (container pressure, CPU
 *  throttling, fd saturation, cold start) are deliberately ABSENT: they can be
 *  honestly N/A forever, and a permanently-warming row would be a fake meter. */
export const PANEL_EXPECTED_AXES = [
  "blockingAsync",
  "threadFootprint",
  // Cross-runtime parity meters that warm up with ordinary traffic, so they
  // show as muted "warming up" rows on a fresh app exactly like the web
  // dashboard. `network` is deliberately ABSENT: an app that makes no outbound
  // calls can be honestly N/A forever, and a permanently-warming row would be a
  // fake meter (same doctrine as containerPressure / cpuThrottling).
  "confidence",
  "baseline",
  "idle",
  "latencyFloor",
  "memoryStability",
  "gcPressure",
  "reliability",
  "crashFree",
  "eventLoopLag",
  "eventLoopUtilization",
  // Break-in pressure / traffic surge — warms on ordinary traffic (10 min +
  // 50 responses), so a warming row is honest on every app.
  "accessPressure",
  "refusalHonesty",
  // Cross-origin answers — counted from the first finished response.
  "corsExposure",
  "heapFragmentation",
  "handleLeak",
  "gcPauseTail",
  "gcGenerationBalance",
  "heapHeadroom",
  // 2026-08 batch — same six the web dashboard expects for a Node project.
  // connectionSetup (needs outbound calls) and workerImbalance (needs a
  // cluster) stay ABSENT here too. startupImport does NOT: see the entry at
  // the end of this list.
  "worstFreeze",
  "backpressure",
  "handleChurn",
  "gcTrend",
  "rejectionPressure",
  "promiseRejections",
  "unhandledErrors",
  "timerHealth",
  "heapWall",
  // 2026-08 batch 2 — the always-on seven warm with ordinary uptime, so a
  // warming row is honest. The env-gated six (event-loop histogram,
  // perf-entry backlog, async diversity, diagnostics) stay ABSENT: without
  // their opt-in flag they can honestly never appear.
  "cpuConsumption",
  "residentGrowth",
  "nativeMemoryMix",
  "uptimeStability",
  "heapSpacePressure",
  "arrayBufferRetention",
  // 2026-08 additive display-only meters that warm with ordinary traffic/logs
  // (5-min minimum window), so a muted "warming up" row is honest — mirroring
  // the swallowedErrors doctrine. Never feed the Speed score.
  "swallowedErrors",
  "leakWatch",
  // startupImport — the ms this app spent loading its own modules. Captured
  // ONCE when telemetry is enabled, from Node's own bootstrap timing
  // (perf_hooks nodeTiming.bootstrapComplete), and frozen. This list used to
  // call it "capture-dependent" and leave it out; that was not true — there is
  // no ordinary Node process without that timing, and the kit puts the reading
  // on the first snapshot of every install. The dashboard's list had it out
  // too, for a DIFFERENT and also-expired reason ("older kits never send it"),
  // so the reading was promised by neither surface while arriving on both. An
  // outside tester found that before we did.
  "startupImport",
  // dependencyDistance — how far this app is from its data, judged on how long
  // a NEW connection takes to open. The kit emits it on every snapshot,
  // including the honest "too few new connections to judge" state a pooled
  // server usually sits in, so a warming row here is honest.
  "dependencyDistance",
  // devPosture — development settings left exposed, read once at startup and
  // frozen. A deterministic one-shot read that every process can take.
  "devPosture",
  // Disk capacity is an immediate read of the volume holding the kit's state,
  // so every process can answer it from its first snapshot.
  "diskPressure",
  // Memory and collection. Every reading here is one this engine can take
  // and that fills with ordinary use, so the panel warms the same rows the
  // web dashboard does for the same app rather than showing fewer meters.
  "gcTax",
  "memoryPerRequest",
  "peakRss",
] as const;

/** Caption shown on an expected-but-not-yet-measurable axis row. */
const PANEL_WARMING_CAPTION = "warming up";

/** WHICH silence a no-score row is: "pending" (warming up — a score is
 *  coming), "not-scored" (a real reading deliberately never graded) or
 *  "not-available" (this host cannot take the reading at all). One decision
 *  shared by every no-score row the panel builds, so the object-axis loop and
 *  the warming backfill can never give one reading two different words.
 *
 *  The order is the order of trust: the axis's own label first, then positive
 *  evidence beside a zero. `measurable: 0` alone is NOT enough to say "not
 *  available here": half this kit's axes ship a zero while still gathering
 *  (database work below its minimum watched requests, a baseline whose routes
 *  were all too fast to divide by), and telling that reader nothing is coming
 *  is the same lie in the other direction. Every axis in this kit that truly
 *  cannot be taken here sends a `reasonCode` alongside its zero — that code is
 *  the positive evidence, and without one the row stays "pending". */
function noScoreRating(
  axis: NodeAxisResult | null | undefined,
): Rating | NoScoreRating {
  if (!axis) return "pending";
  const declared = typeof axis.rating === "string" ? axis.rating : "";
  if (declared === "not-scored" || declared === "not-available") {
    return declared;
  }
  if (axis.measurable !== 0) return "pending";
  return typeof axis.reasonCode === "number" ? "not-available" : "pending";
}

/** Honest first-report wait shown while this process has no score yet.
 *
 * The number comes from Node's own first scheduled snapshot delay, rather than
 * from another kit or a duplicated literal. The uploader also tries
 * immediately, but an empty first snapshot is deliberately skipped; this
 * scheduled tick is the first reliable cadence once the app has handled work. */
export const FIRST_REPORT_WAIT_TEXT = `first report arrives in about ${nextSnapshotDelayMs(0) / 1_000} seconds`;

const MEASURING_HERO_TEXT = `measuring \u2014 handle a few requests; ${FIRST_REPORT_WAIT_TEXT}`;

/** No-score axes that word themselves from their own numbers instead of
 *  shipping a caption string. The failure reading is here because its wire
 *  shape is deliberately closed to prose — a string field is how such a shape
 *  grows to hold a route, a status line or an error — so the panel does the
 *  wording locally, from the counts that did travel. */
export const SELF_WORDED_NO_SCORE_AXES: ReadonlySet<string> = new Set([
  "routeFailures",
]);

/** A reading this operating system cannot give at all (systemLimits.ts). It
 *  arrives present and final — "not available here", with the system's own
 *  reason as its caption — and its row says so. Dropped like an ordinary
 *  no-score reading, it vanished from the panel on Windows and macOS while the
 *  project page said why it was missing. Never true on Linux, which lacks none
 *  of these sources, so the Linux panel is unchanged. */
function withheldBySystem(key: string, axis: NodeAxisResult): boolean {
  return (
    Object.prototype.hasOwnProperty.call(SYSTEM_LIMITED_READINGS, key) &&
    axis.rating === "not-available"
  );
}

/** Human label for one axis. Falls back to a humanized camelCase key rather
 *  than dropping an otherwise-honest meter. */
function panelLabel(key: string): string {
  const label = PANEL_AXIS_LABELS[key];
  if (label) return label;
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return words.slice(0, 1).toUpperCase() + words.slice(1);
}

/** Honest numeric caption for one axis. Prefers the axis's own caption (the
 *  snapshot ships one for most axes); falls back to per-key formats mirroring
 *  the web panel, then to a bare score. Display-only; control chars stripped,
 *  length-capped closed channel — never routes/URLs/raw samples. */
/** The honest last resort when a reading arrives with no caption and this kit
 *  has no wording for its key. Kept byte-identical to the Go kit's
 *  panelNoDetailCaption. */
const PANEL_NO_DETAIL_CAPTION = "no detail reported for this reading";

/** A duration in the deciding part's words: milliseconds under a second, one
 *  decimal under ten seconds, whole seconds up to two minutes, minutes beyond.
 *  The dashboard words the same figure in the same steps
 *  (artifacts/api-server/src/lib/decidedPart.ts), so the panel and the page
 *  never print one reading two ways. */
function decidedMsText(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${Math.round(ms / 100) / 10}s`;
  if (ms <= 120_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 600_000) return `${Math.round(ms / 6000) / 10} min`;
  return `${Math.round(ms / 60_000)} min`;
}

function decidedNumText(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/**
 * The part that set a worst-of-several rating, its figure and the line this
 * kit calls poor — "queue wait 38s at p95 (poor at 60s)". Worded from the
 * three numbers the scorer attached when it took the score
 * ({@link DECIDED_PART}); nothing here re-decides which part it was.
 *
 * Empty when the reading carries no part (pending, unscored, every part at
 * 100), when a figure is unusable, or when the code belongs to another meter —
 * a sentence about the wrong part is worse than the caption without one.
 */
export function panelDecidedLead(key: string, axis: NodeAxisResult): string {
  const code = axis.decidedBy;
  const fig = axis.decidedFigure;
  const poor = axis.decidedPoorAt;
  if (
    typeof code !== "number" ||
    typeof fig !== "number" ||
    typeof poor !== "number" ||
    !Number.isFinite(fig) ||
    !Number.isFinite(poor) ||
    fig < 0 ||
    poor < 0 ||
    DECIDED_PART_AXIS[code] !== key
  ) {
    return "";
  }
  const ms = decidedMsText;
  const n = decidedNumText;
  const pct = (v: number): string => `${decidedNumText(v)}%`;
  switch (code) {
    case DECIDED_PART.networkLatency:
      return `outside calls p75 ${ms(fig)} (poor at ${ms(poor)})`;
    case DECIDED_PART.networkStalls:
      return `stalled calls ${pct(fig)} (poor at ${pct(poor)})`;
    case DECIDED_PART.mcpLatency:
      return `slowest tool p95 ${ms(fig)} (poor at ${ms(poor)})`;
    case DECIDED_PART.mcpErrors:
      return `tool errors ${pct(fig)} (poor at ${pct(poor)})`;
    case DECIDED_PART.repeatedTime:
      return `time spent repeating ${pct(fig)} (poor at ${pct(poor)})`;
    case DECIDED_PART.repeatedBurst:
      return `worst repeat ${n(fig)}\u00d7 in one request (poor at ${n(poor)}\u00d7)`;
    case DECIDED_PART.dbWait:
      return `database wait ${pct(fig)} of request time (poor at ${pct(poor)})`;
    case DECIDED_PART.dbRepeat:
      return `same statement ${n(fig)}\u00d7 in one request (poor at ${n(poor)}\u00d7)`;
    case DECIDED_PART.rowsWorst:
      return `largest result ${n(fig)} rows (poor at ${n(poor)})`;
    case DECIDED_PART.rowsTypical:
      return `typical result ${n(fig)} rows (poor at ${n(poor)})`;
    case DECIDED_PART.aiFailures:
      return `AI call failures ${pct(fig)} (poor at ${pct(poor)})`;
    case DECIDED_PART.aiFirstWords:
      return `first words p75 ${ms(fig)} (poor at ${ms(poor)})`;
    case DECIDED_PART.headroomRequests:
      return `typical requests left ${pct(fig)} (poor at ${pct(poor)})`;
    case DECIDED_PART.headroomTokens:
      return `typical tokens left ${pct(fig)} (poor at ${pct(poor)})`;
    case DECIDED_PART.jobFailures:
      return `failed runs ${pct(fig)} (poor at ${pct(poor)})`;
    case DECIDED_PART.jobOverlaps:
      return `overlapping runs ${n(fig)} (poor at ${n(poor)})`;
    case DECIDED_PART.jobMissed:
      return `missed runs ${n(fig)} (poor at ${n(poor)})`;
    case DECIDED_PART.jobWait:
      return `queue wait ${ms(fig)} at p95 (poor at ${ms(poor)})`;
    case DECIDED_PART.depWait:
      return `outside-service wait ${pct(fig)} of request time (poor at ${pct(poor)})`;
    case DECIDED_PART.depFailures:
      return `outside-service failures ${pct(fig)} (poor at ${pct(poor)})`;
    default:
      return "";
  }
}

function panelCaption(key: string, axis: NodeAxisResult): string {
  try {
    const cap = axis.caption;
    let out: string;
    if (typeof cap === "string" && cap.trim()) {
      out = cap;
    } else if (key === "responsiveness" && typeof axis.p75Ms === "number") {
      out = `${panelStoredMsText(axis.p75Ms)} p75`;
      if (typeof axis.count === "number") out += ` \u00b7 ${axis.count} reqs`;
    } else if (key === "resilience" && typeof axis.sampleCount === "number") {
      // Four visibly distinct readings, never a blank or a bare zero:
      // a ratio · a tail too small to have a ratio · a median too small to
      // take one from · not enough traffic yet.
      const samples = ` \u00b7 ${axis.sampleCount} samples`;
      if (typeof axis.tailRatio === "number") {
        out = `${axis.tailRatio}\u00d7 tail${samples}`;
      } else if (typeof axis.score === "number") {
        out = `every request under ${RESILIENCE_TAIL_FLOOR_MS}ms${samples}`;
      } else if (axis.sampleCount >= RESILIENCE_MIN_TAIL_SAMPLES) {
        out = `tail not judged \u2014 median under ${RESILIENCE_MIN_MEDIAN_MS}ms${samples}`;
      } else {
        out = `warming up${samples}`;
      }
    } else if (key === "budget" && typeof axis.total === "number") {
      const onBudget = typeof axis.onBudget === "number" ? axis.onBudget : 0;
      out = `${onBudget}/${axis.total} on budget`;
    } else if (key === "baseline" && typeof axis.scoredRoutes === "number") {
      const anoms =
        typeof axis.anomalyCount === "number" ? axis.anomalyCount : 0;
      // WHICH derivation answered, and over WHICH two spans. The same
      // question is answered by a server-side window for the phone kit, in
      // the same words, so a tile that does not name its algorithm leaves a
      // reader guessing which one replied. Both spans are constants of this
      // algorithm — see docs/learned-budget-contract.md.
      const derivation =
        ` \u00b7 ${BUDGET_BASELINE_N} post-warm-up vs newest ${BASELINE_RECENT_N}` +
        ` \u00b7 ${BASELINE_ALGORITHM}`;
      // A route whose earlier window is all sub-millisecond has no denominator
      // to divide by, so it is NOT examined. Say so: an abstention must never
      // read as steadiness, and a "steady · N routes" count must name only the
      // routes actually compared.
      const skipped =
        typeof axis.unscoredRoutes === "number" ? axis.unscoredRoutes : 0;
      const skippedTail =
        skipped > 0 ? ` \u00b7 ${skipped} too fast to compare` : "";
      out =
        (axis.scoredRoutes === 0
          ? `not judged \u00b7 ${skipped} route${skipped === 1 ? "" : "s"} too fast to compare`
          : anoms > 0 && typeof axis.worstRatio === "number"
            ? `worst ${axis.worstRatio}\u00d7 drift \u00b7 ${anoms} anomal${anoms === 1 ? "y" : "ies"}${skippedTail}`
            : `steady \u00b7 ${axis.scoredRoutes} route${axis.scoredRoutes === 1 ? "" : "s"}${skippedTail}`) +
        derivation;
    } else if (key === "network" && typeof axis.attemptCount === "number") {
      const stall = typeof axis.stallPct === "number" ? axis.stallPct : 0;
      // An outbound attempt is timed in whole milliseconds too, and a call
      // to a service on the same host really does come back inside one. With
      // no p75 at all the clause is dropped rather than printed as a zero.
      out = `${stall}% stalled`;
      if (typeof axis.p75Ms === "number") {
        out += ` \u00b7 p75 ${panelStoredMsText(axis.p75Ms)}`;
      }
    } else if (key === "idle" && typeof axis.idleBusyPct === "number") {
      const stalls =
        typeof axis.idleLongTaskCount === "number" ? axis.idleLongTaskCount : 0;
      out = `${axis.idleBusyPct}% busy while idle${stalls > 0 ? ` \u00b7 ${stalls} stalls` : ""}`;
    } else if (key === "latencyFloor" && typeof axis.worstMs === "number") {
      const wins = typeof axis.windowCount === "number" ? axis.windowCount : 0;
      out = `worst window ${panelStoredMsText(axis.worstMs)} \u00b7 ${wins} windows`;
    } else if (key === "worstFreeze" && typeof axis.worstMs === "number") {
      // HOW OFTEN beside HOW BAD: a lifetime maximum alone cannot tell a
      // process that hiccupped once from one stalling every few seconds. The
      // count is always said; the projection only when the window earned it.
      out = `worst block ${Math.round(axis.worstMs)}ms`;
      if (typeof axis.freezeCount === "number") {
        out += ` \u00b7 ${axis.freezeCount} block${axis.freezeCount === 1 ? "" : "s"} over ${FREEZE_COUNT_MS}ms`;
        if (
          typeof axis.freezesPerMin === "number" &&
          typeof axis.windowMin === "number"
        ) {
          out += ` \u00b7 ${axis.freezesPerMin}/min over ${overWords(axis.windowMin)}`;
        }
      }
    } else if (
      key === "repeatedWork" &&
      typeof axis.worstRepeats === "number"
    ) {
      const hits =
        typeof axis.requestsWithRepeat === "number"
          ? axis.requestsWithRepeat
          : 0;
      const seen =
        typeof axis.watchedRequests === "number" ? axis.watchedRequests : 0;
      const pct =
        typeof axis.repeatTimePct === "number" ? axis.repeatTimePct : 0;
      out =
        hits > 0
          ? `worst ${axis.worstRepeats}\u00d7 same call \u00b7 ${hits}/${seen} requests \u00b7 ${pct}% of time`
          : `no repeats \u00b7 ${seen} request${seen === 1 ? "" : "s"} watched`;
    } else if (key === "upstreamCache" && typeof axis.hitPct === "number") {
      const misses = typeof axis.misses === "number" ? axis.misses : 0;
      const bypass = typeof axis.bypass === "number" ? axis.bypass : 0;
      const bypassNote = bypass > 0 ? ` \u00b7 ${bypass} never cacheable` : "";
      out = `${axis.hitPct}% served from cache \u00b7 ${misses} fetched fresh${bypassNote}`;
    } else if (key === "dbWork") {
      const blind =
        typeof axis.unwatchedClients === "number" ? axis.unwatchedClients : 0;
      const blindNote =
        blind > 0
          ? ` \u00b7 ${blind} database librar${blind === 1 ? "y" : "ies"} this kit cannot watch`
          : "";
      if (axis.measurable === 0 || typeof axis.waitPct !== "number") {
        // HONESTY: the kit is watching but has nothing it can score yet, and a
        // blind spot is the reason this must not read as "no database work".
        out = `cannot tell yet${blindNote}`;
      } else {
        const seen =
          typeof axis.watchedRequests === "number" ? axis.watchedRequests : 0;
        const worst =
          typeof axis.repeatWorst === "number" ? axis.repeatWorst : 1;
        const waste =
          typeof axis.repeatWastePct === "number" ? axis.repeatWastePct : 0;
        out =
          `${axis.waitPct}% of request time waiting on the database \u00b7 ` +
          `${seen} request${seen === 1 ? "" : "s"} watched`;
        if (worst > 1) {
          out += ` \u00b7 worst ${worst}\u00d7 same query (${waste}% wasted)`;
        }
        out += blindNote;
      }
    } else if (key === "dbSequencing") {
      const blind =
        typeof axis.unwatchedClients === "number" ? axis.unwatchedClients : 0;
      const blindNote =
        blind > 0
          ? ` \u00b7 ${blind} database librar${blind === 1 ? "y" : "ies"} this kit cannot watch`
          : "";
      if (axis.measurable === 0 || typeof axis.wavesWorst !== "number") {
        // HONESTY: too few judged requests to say anything about sequencing.
        out = `cannot tell yet${blindNote}`;
      } else {
        const seen =
          typeof axis.watchedRequests === "number" ? axis.watchedRequests : 0;
        const series =
          typeof axis.seriesPct === "number" ? axis.seriesPct : 100;
        const worst = axis.wavesWorst;
        out =
          worst > 1
            ? `worst request: ${worst} round trips in a row \u00b7 ${series}% of database time in single file`
            : "nothing ran in single file";
        out += ` \u00b7 ${seen} request${seen === 1 ? "" : "s"} watched${blindNote}`;
      }
    } else if (key === "dbRowVolume") {
      const blind =
        typeof axis.unwatchedClients === "number" ? axis.unwatchedClients : 0;
      const blindNote =
        blind > 0
          ? ` \u00b7 ${blind} database librar${blind === 1 ? "y" : "ies"} this kit cannot watch`
          : "";
      if (axis.measurable === 0 || typeof axis.worstRows !== "number") {
        // HONESTY: no watched call reported a size — a cursor-only app is not
        // an app whose queries return nothing.
        out = `cannot tell yet${blindNote}`;
      } else {
        const avg = typeof axis.rowsAvg === "number" ? axis.rowsAvg : 0;
        const sized = typeof axis.sizedCalls === "number" ? axis.sizedCalls : 0;
        out =
          `worst query returned ${axis.worstRows} rows \u00b7 ${avg} on the typical read \u00b7 ` +
          `${sized} read${sized === 1 ? "" : "s"} sized${blindNote}`;
      }
    } else if (key === "dbPoolPressure") {
      const busy = typeof axis.busy === "number" ? axis.busy : 0;
      const size = typeof axis.size === "number" ? axis.size : 0;
      const waiting = typeof axis.waiting === "number" ? axis.waiting : 0;
      out = `${axis.usedPct}% used \u00b7 ${busy}/${size} connections busy`;
      if (waiting > 0) {
        out += ` \u00b7 ${waiting} waiting`;
      }
    } else if (key === "aiCalls") {
      const num = (k: string): number =>
        typeof axis[k] === "number" ? (axis[k] as number) : 0;
      const blind = num("unwatchedClients");
      const blindNote =
        blind > 0
          ? ` \u00b7 ${blind} HTTP client${blind === 1 ? "" : "s"} this kit cannot watch`
          : "";
      if (axis.measurable === 0 || typeof axis.waitPct !== "number") {
        out = `cannot tell yet${blindNote}`;
      } else {
        const calls = num("callCount");
        out = `${axis.waitPct}% of request time waiting on AI \u00b7 ${calls} call${calls === 1 ? "" : "s"}`;
        const streams = num("streamCount");
        if (streams > 0 && num("ttftP75Ms") > 0) {
          out += ` \u00b7 first words in ${Math.round(num("ttftP75Ms") / 100) / 10}s`;
        }
        const stalls = num("stallCount");
        if (stalls > 0) out += ` \u00b7 ${stalls} stalled mid-answer`;
        const fails = num("failCount");
        if (fails > 0) out += ` \u00b7 ${fails} delivered nothing`;
        out += blindNote;
      }
    } else if (key === "aiSpend") {
      const num = (k: string): number =>
        typeof axis[k] === "number" ? (axis[k] as number) : 0;
      const cost = num("costMicros");
      const parts: string[] = [
        `${num("tokensIn")} in / ${num("tokensOut")} out`,
      ];
      // HONESTY: no cache-hit share at all when no reply reported an input
      // token count. A cold cache and an unreported one are different answers.
      parts.push(
        typeof axis.cacheHitPct === "number"
          ? `${axis.cacheHitPct}% from the provider's cache`
          : "cache use unknown",
      );
      if (cost > 0) {
        parts.push(`about $${(cost / 1_000_000).toFixed(4)} so far`);
      }
      const unpriced = num("unpricedCalls");
      // "Cannot price" and "will not price" are different sentences, and only
      // one of them is a gap. A call to an endpoint this app hosts itself is
      // one we DECLINE to price: our table describes what a provider charges
      // on a published page, which says nothing about what a model you run
      // costs you, and a private gateway's price is your contract. Reporting
      // that as a failure sends a developer hunting a fault that is not there.
      const declaredUnpriced = Math.min(unpriced, num("declaredUnpricedCalls"));
      const cannotPrice = unpriced - declaredUnpriced;
      if (cannotPrice > 0) {
        parts.push(
          `${cannotPrice} call${cannotPrice === 1 ? "" : "s"} we cannot price`,
        );
      }
      if (declaredUnpriced > 0) {
        parts.push(
          `${declaredUnpriced} call${declaredUnpriced === 1 ? "" : "s"} to an endpoint you host \u2014 not priced`,
        );
      }
      const missing = num("streamUsageMissingCalls");
      if (missing > 0) {
        parts.push(
          `${missing} streamed answer${missing === 1 ? "" : "s"} did not ask for its own usage`,
        );
      }
      const repeat =
        typeof axis.repeatWorst === "number" ? axis.repeatWorst : 1;
      if (repeat > 1)
        parts.push(`worst ${repeat}\u00d7 same prompt in one request`);
      out = parts.join(" \u00b7 ");
    } else if (key === "aiHeadroom") {
      const num = (k: string): number =>
        typeof axis[k] === "number" ? (axis[k] as number) : 0;
      const refusals = num("refusals");
      if (axis.measurable === 0) {
        // Refused, but the provider published no headroom figures — so the
        // ceiling is real and its position is unknown. Never drawn as "full".
        out =
          refusals > 0
            ? `${refusals} refused for rate limit \u00b7 provider published no headroom`
            : "provider published no headroom";
      } else {
        out =
          `${num("worstRequestsPct")}% of requests left \u00b7 ` +
          `${num("worstTokensPct")}% of tokens left`;
        if (refusals > 0) out += ` \u00b7 ${refusals} refused`;
      }
    } else if (key === "routeFailures") {
      // WHETHER IT WORKED, in the same words the dashboard uses, built HERE
      // from the counts rather than shipped as a string: the wire shape for
      // this reading is closed to prose on purpose. Counts only — the share
      // is a derived verdict, withheld until enough answers have been seen,
      // and it is decided in one place on the server. Two renderers deciding
      // it separately is how they come to disagree.
      const observed = typeof axis.observed === "number" ? axis.observed : 0;
      const failed = typeof axis.failed === "number" ? axis.failed : 0;
      const untracked = typeof axis.untracked === "number" ? axis.untracked : 0;
      const over = untracked > 0 ? ` \u00b7 ${untracked} over the cap` : "";
      if (observed === 0) {
        // Seen nothing is NOT "nothing failed". The axis is omitted entirely
        // when there is nothing at all, so this is the cap-only case.
        out = `no answers counted yet${over}`;
      } else {
        out =
          failed === 0
            ? `none of ${observed} answers failed${over}`
            : `${failed} of ${observed} answers failed${over}`;
      }
    } else if (key === "backgroundWork") {
      const blind =
        typeof axis.unattachedSystems === "number" ? axis.unattachedSystems : 0;
      const blindNote =
        blind > 0
          ? ` \u00b7 ${blind} job system${blind === 1 ? "" : "s"} this kit cannot watch`
          : "";
      const runs = typeof axis.runs === "number" ? axis.runs : 0;
      if (axis.measurable === 0) {
        // HONESTY: watching, but nothing scoreable yet — and a blind spot is
        // exactly why this must never read as "no background work".
        out =
          runs > 0
            ? `cannot tell yet \u00b7 ${runs} job run${runs === 1 ? "" : "s"} so far${blindNote}`
            : `cannot tell yet${blindNote}`;
      } else {
        const failed = typeof axis.failed === "number" ? axis.failed : 0;
        const names = typeof axis.jobNames === "number" ? axis.jobNames : 0;
        out = `${runs} job run${runs === 1 ? "" : "s"} \u00b7 ${names} job${names === 1 ? "" : "s"}`;
        out += failed > 0 ? ` \u00b7 ${failed} failed` : " \u00b7 none failed";
        // A missing run is the signal with no error and no log line behind it,
        // so it is said outright rather than folded into the score.
        if (typeof axis.missed === "number" && axis.missed > 0) {
          out += ` \u00b7 ${axis.missed} run${axis.missed === 1 ? "" : "s"} never happened`;
        }
        if (typeof axis.overlaps === "number" && axis.overlaps > 0) {
          out += ` \u00b7 ${axis.overlaps} overlapped`;
        }
        if (typeof axis.waitP95Ms === "number") {
          out += ` \u00b7 waited ${axis.waitP95Ms}ms before starting`;
        }
        out += blindNote;
      }
    } else if (key === "dependencyDistance") {
      const num = (k: string): number =>
        typeof axis[k] === "number" ? (axis[k] as number) : 0;
      if (axis.measurable === 0) {
        // A STATE, not a zero: connections are pooled and reused on a
        // long-running server, so there may be too few new ones to judge.
        const seen = num("newConnections");
        const need = num("minConnections");
        out = `too few new connections to judge \u00b7 ${seen} of ${need}`;
      } else {
        const setup = num("worstSetupMs");
        out = `furthest dependency ${setup < 10 ? setup : Math.round(setup)}ms away`;
        if (typeof axis.worstSharePct === "number") {
          out += ` \u00b7 ${axis.worstSharePct}% of a typical request`;
        }
        out += ` \u00b7 ${num("newConnections")} new connection${num("newConnections") === 1 ? "" : "s"}`;
        // A SLOWER READING WE DID NOT JUDGE. The connection floor is right,
        // but the word "furthest" is false while a bigger number sits in the
        // same reading unmentioned — so it rides here too, on the surface a
        // developer sees inside their own app.
        if (typeof axis.unjudgedWorstSetupMs === "number") {
          out += ` \u00b7 a slower one (${Math.round(axis.unjudgedWorstSetupMs)}ms) had too few connections to judge`;
        }
      }
    } else if (key === "patchLag" && typeof axis.buildAgeMs === "number") {
      // HONESTY: report build AGE only — never imply the app is safe/patched.
      // The meter reports lag, nothing more.
      const days = Math.round(axis.buildAgeMs / 86_400_000);
      out = `build ~${days}d old`;
    } else if (key === "coldStartCost" && typeof axis.setupSharePct === "number") {
      // WHAT WAS SLOW, not what it scored. This axis's whole point is the
      // share of a short-lived container's life spent getting ready.
      out = `${axis.setupSharePct}% of this container's life was setup`;
      if (typeof axis.initMs === "number") out += ` \u00b7 ${axis.initMs}ms init`;
      if (typeof axis.coldPenaltyMs === "number") {
        out += ` \u00b7 first run ${axis.coldPenaltyMs}ms slower than a warm one`;
      }
    } else if (key === "startupImport" && typeof axis.importMs === "number") {
      out = `${axis.importMs}ms loading modules before this kit started`;
      if (typeof axis.bootMs === "number" && axis.bootMs > 0) {
        out += ` \u00b7 ${axis.bootMs}ms from process start`;
      }
    } else if (
      key === "connectionSetup" &&
      typeof axis.reconnectPct === "number" &&
      typeof axis.attemptCount === "number"
    ) {
      // A zero here read "0 · poor · 0/100" with no reason given. The reason
      // is the reconnect share: every outbound call paying for a new socket.
      out = `${axis.reconnectPct}% of ${axis.attemptCount} outbound call${axis.attemptCount === 1 ? "" : "s"} opened a new connection`;
    } else {
      // A CAPTION MAY NOT RESTATE ITS OWN SCORE. `${axis.score}/100` printed
      // beside the very same number describes nothing that was measured: it
      // fills the column, reads as detail, and leaves a zero or a poor
      // verdict with no reason attached. Say plainly that this reading
      // shipped none, and fix it at the producer — which is what the panel
      // caption tests force by failing on a score-shaped caption.
      out = PANEL_NO_DETAIL_CAPTION;
    }
    // WHICH PART SET THE RATING, first. A row that shows "37" and a list of
    // figures leaves the reader to work out which figure did that; the lead
    // says it before the 120-character cap can cut anything. On a reading
    // with no wording of its own the lead IS the detail, so the "no detail"
    // sentence would now be false and goes.
    const lead = panelDecidedLead(key, axis);
    if (lead) {
      out = out === PANEL_NO_DETAIL_CAPTION || !out ? lead : `${lead} \u00b7 ${out}`;
    }
    // Host-suspend honesty note: when an axis discounted suspend artifacts
    // (scale-to-zero host sleeping between requests), say so in the caption.
    if (
      typeof axis.suspendDiscounts === "number" &&
      axis.suspendDiscounts > 0
    ) {
      out += ` \u00b7 host-suspend gaps discounted (${axis.suspendDiscounts})`;
    }
    out = String(out)
      .split("")
      .filter((ch) => ch >= " ")
      .join("");
    return out.slice(0, PANEL_CAPTION_MAX);
  } catch {
    return "";
  }
}

/** Compute the closed panel shape for the bubble's full dashboard panel: the
 *  pulse trio plus an ordered list of meter rows, each projected onto the fixed
 *  {key, label, score, rating, caption} allowlist. Reuses the SAME snapshot
 *  axis builder the perf snapshot uploads. Never includes route labels, URLs,
 *  or raw sample data. Fail-open: any error degrades to the pulse-only shape
 *  (the panel then renders hero + "measuring…"). */
export function computePanel(): PagePanel {
  const pulse = computePulse();
  const rows: PanelAxis[] = [];
  let axes: Record<string, NodeAxisValue> = {};
  try {
    axes = capturePerfSnapshot().axes;
  } catch {
    axes = {};
  }
  try {
    const ordered = [
      ...PANEL_CORE_AXES,
      ...Object.keys(axes).filter(
        (k) => !(PANEL_CORE_AXES as readonly string[]).includes(k),
      ),
    ];
    for (const key of ordered) {
      const raw = axes[key];
      // Only axis RESULT OBJECTS render as scored rows here. The four scalar
      // confidence keys (confidence / confidenceMounts / …) are siblings of the
      // axis objects, not rows — they build the dedicated Confidence tile below.
      const axis =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as NodeAxisResult)
          : null;
      if (!axis || typeof axis.score !== "number") {
        // A reading that is PRESENT and final, but words itself from its own
        // counts rather than shipping a caption string. Without this it falls
        // past both loops — not a core axis, not an expected one — and the
        // panel shows nothing at all for an answer the kit really has. The
        // dashboard would show it and the panel would not, about the same
        // install, which is the disagreement this surface exists to avoid.
        if (axis && (SELF_WORDED_NO_SCORE_AXES.has(key) || withheldBySystem(key, axis))) {
          rows.push({
            key,
            label: panelLabel(key),
            score: null,
            rating: noScoreRating(axis),
            caption: panelCaption(key, axis).slice(0, PANEL_CAPTION_MAX),
          });
          continue;
        }
        if ((PANEL_CORE_AXES as readonly string[]).includes(key)) {
          rows.push({
            key,
            label: panelLabel(key),
            score: null,
            // WHICH silence this is, not just "no score yet": a reading that
            // declared itself never-graded, or unreadable on this host, said so
            // on the axis, and hardcoding "pending" threw that word away.
            rating: noScoreRating(axis),
            caption: "measuring\u2026",
          });
        }
        continue;
      }
      const score = Math.max(0, Math.min(100, Math.round(axis.score)));
      let rating: string | undefined =
        typeof axis.rating === "string" ? axis.rating : undefined;
      if (!rating || !PANEL_RATINGS.has(rating)) rating = ratingForScore(score);
      rows.push({
        key: String(key).slice(0, 40),
        label: panelLabel(String(key)),
        score,
        rating: rating as Rating,
        caption: panelCaption(String(key), axis),
      });
    }
  } catch {
    rows.length = 0;
  }
  // Confidence tile — built from the four scalar confidence keys (not an axis
  // object): the sample level and a human caption, never a rating band.
  // Omitted while there is no scored route yet (honesty gate), so a fresh app
  // shows no fake "high confidence" reading.
  try {
    const level =
      typeof axes.confidence === "string" ? axes.confidence : "none";
    const capt =
      typeof axes.confidenceCaption === "string"
        ? axes.confidenceCaption
        : "no samples yet";
    // Confidence is how sure the readings are, never how healthy the app is
    // (docs/settle-rule-decisions.md): it is reported, never graded, so the
    // tile carries no rating band and no bar.
    if (level !== "none") {
      const mounts =
        typeof axes.confidenceMounts === "number" ? axes.confidenceMounts : 0;
      rows.push({
        key: "confidence",
        label: panelLabel("confidence"),
        score: null,
        rating: "not-scored",
        // NAME THE QUANTITY. `mounts` is the sample count of the
        // LEAST-sampled scored route, never the number of requests this kit
        // captured. A bare "10 samples" printed under a headline of "429
        // requests measured" reads as "10 of your 429 were measured", which
        // is a different, wrong, and alarming fact.
        caption:
          `${capt}${mounts > 0 ? ` \u00b7 ${mounts} samples on the least-sampled route` : ""}`.slice(
            0,
            PANEL_CAPTION_MAX,
          ),
      });
    }
  } catch {
    /* confidence tile is best-effort — never blank the panel */
  }
  // Append a muted "warming up" row for every expected axis that has no honest
  // numeric data yet, so a fresh app shows the SAME meter set here as on the
  // web dashboard. Measured axes keep their order above; warming rows follow in
  // PANEL_EXPECTED_AXES order. Guarded — a throw here must never blank the panel.
  try {
    const seen = new Set(rows.map((r) => r.key));
    for (const key of PANEL_EXPECTED_AXES) {
      if (seen.has(key)) continue;
      // leakWatch / swallowedErrors observe a 5-min minimum window before a
      // clean bill is honest — quote the real gate in the warming caption.
      const warming =
        key === "leakWatch" || key === "swallowedErrors"
          ? "warming up \u00b7 5 min minimum window"
          : key === "accessPressure"
            ? "warming up \u00b7 needs 10 min + 50 responses"
            : key === "refusalHonesty"
              ? "warming up \u00b7 10 min minimum window"
              : key === "corsExposure"
                ? "warming up \u00b7 needs one finished response"
                : PANEL_WARMING_CAPTION;
      // An axis can be PRESENT and honest with no score at all: either the
      // host cannot measure it, or the axis deliberately refuses to grade what
      // it saw (refusalHonesty reports an observation, never a verdict). Those
      // arrive with their own caption, and saying "warming up" over real data
      // would be the lie this whole area exists to avoid.
      const raw = axes[key];
      const present =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as NodeAxisResult)
          : null;
      const own = present?.caption;
      // BASELINE abstaining is the same kind of reading, arriving without a
      // caption of its own: it is PRESENT, it is honest, and no score is ever
      // coming for it — every route's earlier window was too fast to divide by.
      // Left to the line below it would say "warming up" for ever, which is the
      // steadiness claim this axis is not entitled to make, one voice quieter.
      const abstains =
        key === "baseline" && !!present && present.measurable === 0;
      const caption = abstains
        ? panelCaption(key, present).slice(0, PANEL_CAPTION_MAX)
        : typeof own === "string" && own.trim()
          ? own.slice(0, PANEL_CAPTION_MAX)
          : warming;
      // …and the ROW says which silence it is, not just the caption. The
      // caption above already told the truth for these two states; the rating
      // did not, so anything that sorts, colours or counts these rows still
      // filed a permanent observation under "still measuring". One shared
      // decision with the object-axis loop above (`noScoreRating`), so the two
      // can never give one reading two different words.
      const rating: Rating | NoScoreRating = noScoreRating(present);
      rows.push({
        key,
        label: panelLabel(key),
        score: null,
        rating,
        caption,
      });
    }
  } catch {
    /* keep whatever rows were assembled */
  }
  // A REJECTED registration must never read as connected/normal/awaiting: the
  // panel carries a fixed banner so the developer sees why this install will
  // never appear. Omitted entirely when registration was not refused.
  const projectKey = getPanelProjectKey();
  const projectKeyPayload = {
    display: projectKey.display,
    source: describeProjectKeySource(projectKey.source),
  };
  const notice = computePanelNotice();
  // Rows the server threw away. Additive: it never replaces the notice above,
  // because "nothing is being uploaded" and "some of what was uploaded was
  // refused" are different problems and a developer may have both.
  const drops = computePanelDrops();
  // Rows that never left this process. Additive again, and for the same
  // reason: a developer can have both, and the fix differs.
  const undelivered = computePanelUndelivered();
  // WHICH PROJECT this kit reports to. Resolved to its final printed form here
  // rather than on the wire, so every renderer shows the same three states and
  // none of them can invent a fallback of its own.
  let project = PROJECT_UNKNOWN_TEXT;
  try {
    project = projectDisplay(getKitProject());
  } catch {
    /* keep the honest unknown wording */
  }
  // WHICH INSTALL the verdict above is about. Null until the kit has started.
  let installId: string | null = null;
  try {
    installId = getPanelInstallId();
  } catch {
    /* an unreadable mirror just leaves the line on its honest fallback */
  }
  // WHAT THE DEVELOPER SAID MUST STAY TRUE. Their own words and a closed
  // standing token, nothing else: the page spells the standing out from its
  // own literals. Omitted entirely when this project holds none (or nothing
  // has arrived), so a project with no promises sees no change at all.
  let promises: PanelPromises | undefined;
  try {
    const held = getKitPromises();
    if (held.items.length > 0) promises = held;
  } catch {
    /* a page that cannot read them shows none, never an error */
  }
  const base = notice
    ? {
        ...pulse,
        axes: rows,
        projectKey: projectKeyPayload,
        project,
        installId,
        // WHERE JOBS LIVE — always sent, so the page can say jobs are not
        // shown there whether or not this app has any.
        jobs: PANEL_JOBS,
        notice,
      }
    : {
        ...pulse,
        axes: rows,
        projectKey: projectKeyPayload,
        project,
        installId,
        jobs: PANEL_JOBS,
      };
  const withDrops = drops ? { ...base, drops } : base;
  const withUndelivered = undelivered
    ? { ...withDrops, undelivered }
    : withDrops;
  return promises
    ? { ...withUndelivered, promises }
    : withUndelivered;
}

/** Lock descriptor served alongside (or instead of) the panel body when the
 *  server-authority kill-switch has rendered the kit inert. Consumed by the
 *  injected bubble snippet's `paint()`:
 *   - `kind: "hidden"` → silently hide the whole bubble (env-kill / tampered /
 *     grace-expired / never-activated ACTIVATION LOCK — no readable state).
 *   - `kind: "revoked" | "unpaid" | "paused"` → render the BLOCKING overlay with
 *     the paired `title` + `body` copy (owner-facing, no action button, no
 *     in-kit payment). Copy is kept byte-equal to the RN dashboard overlay.
 *
 *  Returns `null` when the gate is "none" (active / within grace) so the panel
 *  serves its normal meter body. Never throws — a failure fails OPEN (null) so
 *  a bug in the entitlement client can never brick a paying app. */
export interface PanelLock {
  kind: "hidden" | "revoked" | "unpaid" | "paused" | "dissolved";
  title: string;
  body: string;
}

/** The dissolved notice, said exactly as the erase happens: the local copy
 *  only, nothing asked of our server, one ask again after a restart. */
const DISSOLVED_TITLE = "Boosthis has stopped for this project";
const DISSOLVED_SENTENCE =
  "Boosthis erased what it kept on this machine and stopped. It did not ask " +
  "our server to delete anything, and it asks again once when this app restarts.";

/** The notice for a lock with no readable reason of its own (a tampered copy,
 *  a lapsed offline grace window, an answer this kit does not know). */
const LOCKED_TITLE = "Boosthis is locked for this project";
const LOCKED_SENTENCE =
  "Nothing is being measured or sent from this app. The project's owner can " +
  "see why on the Boosthis dashboard, and this app checks again by itself.";

/**
 * The ONE notice every local page and local read shows while the kit is locked
 * (docs/kit-lock-rule.md): a title and a sentence, no numbers. The server's own
 * words for the lock lead when it sent some. Never throws.
 */
export function renewNotice(): { title: string; body: string } {
  try {
    const detail = getEntitlementMessage();
    if (getEntitlementGateKind() === "dissolved") {
      return {
        title: DISSOLVED_TITLE,
        body: detail ? `${detail} ${DISSOLVED_SENTENCE}` : DISSOLVED_SENTENCE,
      };
    }
    const lock = computePanelLock();
    if (lock && lock.kind !== "hidden" && lock.title !== "") {
      return { title: lock.title, body: lock.body };
    }
    return { title: LOCKED_TITLE, body: detail ? `${detail} ${LOCKED_SENTENCE}` : LOCKED_SENTENCE };
  } catch {
    return { title: LOCKED_TITLE, body: "" };
  }
}

export function computePanelLock(): PanelLock | null {
  try {
    const gate = getEntitlementGateKind();
    if (gate === "none") return null;
    // Never checked in is NOT a lock: no overlay, so the ordinary panel renders
    // and computePanelNotice()'s "Not registered yet" is what the developer
    // reads. Returning a lock here is what used to blank the whole bubble.
    if (gate === "unregistered") return null;
    if (gate === "hidden") {
      return { kind: "hidden", title: "", body: "" };
    }
    if (gate === "dissolved") {
      const notice = renewNotice();
      return { kind: "dissolved", title: notice.title, body: notice.body };
    }
    const detail = getEntitlementMessage();
    if (gate === "revoked") {
      return {
        kind: "revoked",
        title: "Access revoked",
        body:
          "This project's Boosthis access was revoked by the account owner. " +
          "Contact the owner if you think this is a mistake.",
      };
    }
    if (gate === "unpaid") {
      return {
        kind: "unpaid",
        title: "Payment required",
        body:
          "The Boosthis subscription for this account is unpaid. Ask the account " +
          "owner to renew it at boosthis.com to restore access.",
      };
    }
    // paused — calmer, reversible-pause notice; prefer the server-supplied
    // message when present (parity with the RN overlay's `detail ?? …`).
    return {
      kind: "paused",
      title: "Boosthis is paused",
      body:
        detail ??
        "The owner has paused this app from the Boosthis dashboard. " +
          "Nothing was deleted — press Reconnect there to resume.",
    };
  } catch {
    // Fail OPEN: never brick a paying app because the gate readout threw.
    return null;
  }
}

/** The address key an owner link and the machine-itself switch use. Same key
 *  as the browser kit. */
export const OWNER_SWITCH_PARAM = "boosthis";

/** The second check every injected bubble script opens with (owner decision,
 *  4 Oct 2026: the bubble is for the app's owner only). The server injects the
 *  script only for the owner; this gate keeps a page that reached someone else
 *  (a cache that ignored our headers, a saved copy) from drawing: it reads ONE
 *  cookie, the `boosthis_owner` marker the kit sets when it switches a browser
 *  on, clears the storage flag older kits kept, uploads nothing, and returns
 *  before anything is drawn unless the marker is there. Fails CLOSED. */
export const OWNER_GATE_JS =
  "var OWNER_ON=false;try{OWNER_ON=(' '+document.cookie+';').indexOf(' boosthis_owner=1;')>=0;}catch(e){}try{window.localStorage.removeItem('boosthis:bubble-owner-device:v1');}catch(e){}if(!OWNER_ON)return;";

/** Build the injected bubble script for a given pulse path. Derives the panel
 *  path by swapping the `/pulse` suffix for `/panel`; fails open to the pulse
 *  path when the pulse path does not end in `/pulse`. Self-contained IIFE:
 *  closed shadow DOM, no globals, textContent-only writes, every step
 *  try/catch-guarded. The badge polls the closed pulse-shaped panel; tapping it
 *  opens a FULL dashboard-first panel — hero score, rating badge, meter rows
 *  with bars. Mirrors the Web/Python kit bubble panel (dark theme, orange
 *  accent); nothing here transmits anywhere. */
export function bubbleSnippet(
  pulsePath: string = PULSE_PATH,
  panelPath?: string,
): string {
  const resolvedPanel =
    panelPath ??
    (pulsePath.endsWith(PULSE_SUFFIX)
      ? pulsePath.slice(0, pulsePath.length - PULSE_SUFFIX.length) +
        PANEL_SUFFIX
      : pulsePath);
  // The account auth-context endpoint sits next to /panel (…/panel →
  // …/account). Fails open to null when the panel path does not end in /panel;
  // the account card then renders the loopback-only note instead of a form.
  const resolvedAccount = resolvedPanel.endsWith(PANEL_SUFFIX)
    ? resolvedPanel.slice(0, resolvedPanel.length - PANEL_SUFFIX.length) +
      ACCOUNT_SUFFIX
    : null;
  // Escape the paths for embedding inside a double-quoted JS string.
  const safePanel = resolvedPanel.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const safeAccount =
    resolvedAccount === null
      ? null
      : resolvedAccount.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  // The accepted-terms revision embedded into the gate. Kept byte-equal to the
  // canonical TERMS_VERSION constants (RN lib/boosthis-runtime-rn/src/ui/
  // consent.ts, web lib/boosthis-runtime-web/src/terms.ts, server
  // artifacts/api-server/src/lib/accounts.ts) that the `scripts`
  // legal-consistency test enforces. Do NOT change it here without bumping
  // those together. Node is a server kit with no TS consent module of its own,
  // so the literal is embedded directly into the injected snippet.
  const safeTermsVersion = TERMS_VERSION_LITERAL.replace(/\\/g, "\\\\").replace(
    /"/g,
    '\\"',
  );
  // The panel mirrors the RN kit dashboard end-to-end (same DARK_THEME palette,
  // card system, hero score, rating pill, per-axis bars, legend) so the web
  // surface looks EXACTLY like the in-app performance kit. Display-only.
  return (
    "\n<script>(function(){try{" +
    "if(window.__boosthisBubble)return;window.__boosthisBubble=1;" +
    // The owner gate: the bubble draws only in a browser carrying the kit's owner marker cookie.
    OWNER_GATE_JS +
    // ---- Terms gate state (port of the RN kit's BoosthisTermsGate) ----
    // The panel opens to a GATE on first ever open (connect card + terms box +
    // checkbox + Agree/Decline); after a one-time accept it opens straight to
    // the dashboard forever, until TERMS_VERSION changes. Display + localStorage
    // only — no new endpoints, no new data collection.
    'var TERMS_VERSION="' +
    safeTermsVersion +
    '";' +
    'var TERMS_KEY="boosthis:terms-accepted:v1";' +
    // In-memory acceptance for this page session — the fallback when
    // localStorage is unavailable, so a user is never locked in a loop.
    "var ACCEPTED_MEM=false;" +
    // VERIFIED LINK flag — set true ONLY inside the claim success handler (a 200
    // from …/claim). Mere sign-in does not count. Exposed to the gate.
    "var LINKED=false;" +
    "function termsRead(){try{" +
    "var raw=window.localStorage&&window.localStorage.getItem(TERMS_KEY);" +
    "if(!raw)return null;var p=JSON.parse(raw);" +
    'if(p&&typeof p.version==="string")return p;return null;' +
    "}catch(e){return null;}}" +
    // Keyed to the CURRENT installId (when the account context has one): a
    // fresh install (new installId) does not inherit an old acceptance, so
    // the full gate flow (sign-in -> telemetry -> terms) runs again.
    "function termsAccepted(){try{" +
    "if(ACCEPTED_MEM)return true;" +
    "var p=termsRead();if(!p||p.version!==TERMS_VERSION)return false;" +
    'var iid=(typeof ACTX!=="undefined"&&ACTX&&typeof ACTX.installId==="string")?ACTX.installId:null;' +
    "if(iid===null)return true;" +
    "return (p.installId||null)===iid;" +
    "}catch(e){return ACCEPTED_MEM;}}" +
    "function termsWrite(){try{ACCEPTED_MEM=true;" +
    'var iid=(typeof ACTX!=="undefined"&&ACTX&&typeof ACTX.installId==="string")?ACTX.installId:null;' +
    "if(window.localStorage)window.localStorage.setItem(TERMS_KEY," +
    "JSON.stringify({version:TERMS_VERSION,at:Date.now(),installId:iid}));" +
    "}catch(e){}}" +
    // Sign-out wipes the acceptance so the WHOLE gate flow runs again
    // (owner requirement, Jul 2026).
    "function termsClear(){try{ACCEPTED_MEM=false;" +
    "if(window.localStorage)window.localStorage.removeItem(TERMS_KEY);" +
    "}catch(e){}}" +
    'var host=document.createElement("div");' +
    'host.style.cssText="position:fixed;bottom:18px;right:18px;z-index:2147483000;";' +
    'var root=host.attachShadow?host.attachShadow({mode:"closed"}):host;' +
    // RN kit DARK_THEME palette — keep byte-identical across all server kits.
    'var T={bg:"#0b0c10",card:"#15171c",br:"#262932",fg:"#e6e7eb",mut:"#8b8f99",pri:"#f97316"};' +
    'var COLORS={good:"#4ade80","needs-work":"#fbbf24",poor:"#f87171"};' +
    'var RL={good:"GOOD","needs-work":"NEEDS WORK",poor:"POOR"};' +
    'var btn=document.createElement("button");' +
    'btn.type="button";btn.setAttribute("aria-label","Boosthis performance bubble");' +
    'btn.style.cssText="width:48px;height:48px;border-radius:50%;background:"+T.bg+";' +
    'border:2.5px solid "+T.mut+";color:"+T.pri+";font-size:22px;line-height:1;' +
    "cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.4);display:flex;" +
    'align-items:center;justify-content:center;padding:0;font-family:system-ui,sans-serif;";' +
    // Brand mark — the real Boosthis icon (navy "B" + orange bolt) as an <img>
    // child, so the bubble reads as the app icon (parity with the RN kit).
    'var bImg=document.createElement("img");' +
    "bImg.src=" +
    JSON.stringify(BOOSTHIS_ICON_URI) +
    ";" +
    'bImg.alt="";bImg.draggable=false;' +
    'bImg.style.cssText="width:34px;height:34px;border-radius:50%;pointer-events:none;display:block;";' +
    "btn.appendChild(bImg);" +
    'var panel=document.createElement("div");' +
    'panel.setAttribute("role","dialog");panel.setAttribute("aria-label","Boosthis dashboard");' +
    // A PHONE IS A HOST APP'S FIRST SCREEN TOO. A flat 300px panel is wider
    // than the usable width of a small phone once the host's own 18px margins
    // are taken off, so the panel is capped against the viewport as well.
    // What then does not fit scrolls — and SAYS it scrolls: iOS and Android
    // draw an overlay scrollbar that only appears once you are already
    // swiping, so a scrollbar alone is not a cue. The background carries two
    // `local` cover layers and two `scroll` shadows, which is the one cue an
    // inline cssText can express (no ::-webkit-scrollbar rule is reachable
    // here). The plain `background` above it is the fallback: an engine that
    // cannot parse the gradient list drops that whole declaration, and
    // without the first one the panel would render transparent.
    'panel.style.cssText="display:none;position:absolute;bottom:56px;right:0;' +
    "width:300px;max-width:calc(100vw - 36px);max-height:72vh;overflow:auto;" +
    "overscroll-behavior:contain;-webkit-overflow-scrolling:touch;" +
    'scrollbar-width:thin;scrollbar-color:"+T.mut+" transparent;' +
    'background:"+T.bg+";' +
    'background:linear-gradient("+T.bg+" 50%,rgba(0,0,0,0)) top/100% 20px no-repeat local,' +
    'linear-gradient(rgba(0,0,0,0),"+T.bg+" 50%) bottom/100% 20px no-repeat local,' +
    "radial-gradient(farthest-side at 50% 0,rgba(0,0,0,.6),rgba(0,0,0,0)) top/100% 10px no-repeat scroll," +
    "radial-gradient(farthest-side at 50% 100%,rgba(0,0,0,.6),rgba(0,0,0,0)) bottom/100% 10px no-repeat scroll," +
    '"+T.bg+";color:"+T.fg+";' +
    'border:1px solid "+T.br+";border-radius:20px;padding:12px;' +
    'font:12px/1.5 system-ui,sans-serif;box-shadow:0 10px 28px rgba(0,0,0,.5);text-align:left;";' +
    // ---- Blocking lock overlay (VAULT contract, owner UX) ----
    // When the server verdict is REVOKED / UNPAID / PAUSED the kit must not
    // silently vanish: the bubble stays visible and opens straight to a
    // BLOCKING full-cover overlay. The overlay dims + BLURS everything behind
    // it (CSS backdrop-filter — the cheap web approximation, no deps) and, being
    // an opaque full-cover layer that absorbs pointer events, nothing of the
    // meters can be read or tapped through. Copy is closed + friendly, keyed off
    // the server-computed lock kind; no server internals, no action button, no
    // in-kit payment. Kept byte-equal to the RN dashboard overlay copy.
    'var lockEl=document.createElement("div");' +
    'lockEl.setAttribute("role","alertdialog");' +
    'lockEl.setAttribute("aria-label","Boosthis locked");' +
    'lockEl.style.cssText="display:none;position:absolute;top:0;left:0;right:0;bottom:0;' +
    "z-index:10;box-sizing:border-box;border-radius:20px;padding:32px 22px;" +
    "flex-direction:column;align-items:center;justify-content:center;text-align:center;" +
    // Dark scrim + blur of everything painted behind the overlay.
    "background:rgba(11,12,16,.92);" +
    '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);";' +
    'var lockTitle=document.createElement("div");' +
    'lockTitle.style.cssText="font-size:17px;font-weight:700;color:"+T.fg+";margin-bottom:8px;";' +
    'var lockBody=document.createElement("div");' +
    'lockBody.style.cssText="font-size:13px;line-height:1.5;color:"+T.mut+";max-width:240px;";' +
    "lockEl.appendChild(lockTitle);lockEl.appendChild(lockBody);" +
    // showLock(lock) — render the overlay for a {kind,title,body} descriptor and
    // block the panel body behind it. hideLock() — restore the normal panel.
    // The overlay absorbs pointer events (default) so no tap passes through.
    "function showLock(lock){try{" +
    'lockTitle.textContent=String(lock&&lock.title||"Boosthis is locked");' +
    'lockBody.textContent=String(lock&&lock.body||"");' +
    'lockEl.style.display="flex";' +
    // Freeze scrolling behind the cover so the meters cannot be scrolled to.
    'panel.style.overflow="hidden";' +
    "}catch(e){}}" +
    "function hideLock(){try{" +
    'lockEl.style.display="none";panel.style.overflow="auto";' +
    "}catch(e){}}" +
    "function card(){" +
    'var c=document.createElement("div");' +
    'c.style.cssText="background:"+T.card+";border:1px solid "+T.br+";border-radius:16px;padding:12px 14px;margin-bottom:10px;";' +
    "return c;}" +
    "function cardTitle(tx){" +
    'var d=document.createElement("div");' +
    'd.style.cssText="font-size:13px;font-weight:700;color:"+T.fg+";";d.textContent=tx;return d;}' +
    "function cardSub(tx){" +
    'var d=document.createElement("div");' +
    'd.style.cssText="font-size:10.5px;color:"+T.mut+";margin-top:1px;margin-bottom:2px;";d.textContent=tx;return d;}' +
    // Hero — app-kit hero card: name, runtime subtitle, big score, rating pill.
    "var hero=card();" +
    'var hName=document.createElement("div");' +
    'hName.style.cssText="font-size:16px;font-weight:800;color:"+T.fg+";";hName.textContent="Boosthis";' +
    'var hSub=document.createElement("div");' +
    'hSub.style.cssText="font-size:11px;color:"+T.mut+";";hSub.textContent="' +
    RUNTIME_PANEL_SUBTITLE +
    '";' +
    // WHICH PROJECT this kit feeds. The name is the ONE developer-authored
    // string this panel draws: it is sanitised on arrival and set with
    // textContent (never innerHTML), so it can only ever be read as text.
    // Starts on the honest "not received yet" wording so an unregistered app
    // never shows a blank line or a guess.
    'var hProj=document.createElement("div");' +
    'hProj.style.cssText="font-size:11px;color:"+T.mut+";margin-top:3px;word-break:break-word;";' +
    'hProj.textContent="' +
    PROJECT_LABEL +
    ": " +
    PROJECT_UNKNOWN_TEXT +
    '";' +
    // WHICH INSTALL this panel is reporting on. Printed next to the project so
    // the verdict above can be compared with the dashboard rather than
    // guessed at — an AI that reads "not registered" without knowing which id
    // was asked about is exactly how a second install gets minted.
    'var hInst=document.createElement("div");' +
    'hInst.style.cssText="font-size:11px;color:"+T.mut+";margin-top:2px;word-break:break-all;";' +
    'hInst.textContent="' +
    INSTALL_ID_LABEL +
    ": " +
    INSTALL_ID_UNKNOWN_TEXT +
    '";' +
    'var gw=document.createElement("div");gw.style.cssText="text-align:center;padding:10px 0 2px;";' +
    'var num=document.createElement("div");' +
    'num.style.cssText="font-size:46px;font-weight:800;line-height:1;letter-spacing:-1px;color:"+T.fg+";";' +
    'num.textContent="\\u2013";' +
    'var of=document.createElement("div");' +
    'of.style.cssText="font-size:11px;color:"+T.mut+";margin-top:2px;";of.textContent="/ 100";' +
    'var badge=document.createElement("div");' +
    'badge.style.cssText="display:inline-flex;align-items:center;gap:5px;margin-top:8px;padding:3px 12px;' +
    "border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.6px;" +
    'background:"+T.br+";color:"+T.mut+";border:1px solid "+T.br+";";' +
    'var bDot=document.createElement("span");' +
    'bDot.style.cssText="width:6px;height:6px;border-radius:50%;background:"+T.mut+";";' +
    'var bTxt=document.createElement("span");bTxt.textContent="MEASURING";' +
    "badge.appendChild(bDot);badge.appendChild(bTxt);" +
    'var stat=document.createElement("div");' +
    'stat.style.cssText="text-align:center;margin-top:7px;font-size:10.5px;color:"+T.mut+";";' +
    'stat.textContent="' +
    MEASURING_HERO_TEXT +
    '";' +
    // The score is measured HERE, from this process's own requests. It rises to
    // 100 whether or not a single byte ever reached Boosthis, so it carries a
    // caption saying exactly that — the notice above the panel says whether
    // anything is arriving; this number never does.
    'var hCap=document.createElement("div");' +
    'hCap.style.cssText="text-align:center;margin-top:5px;font-size:10px;line-height:1.4;color:"+T.mut+";";' +
    'hCap.textContent="' +
    SCORE_CAPTION +
    '";' +
    "gw.appendChild(num);gw.appendChild(of);" +
    "hero.appendChild(hName);hero.appendChild(hSub);hero.appendChild(hProj);hero.appendChild(hInst);hero.appendChild(gw);" +
    'var bWrap=document.createElement("div");bWrap.style.cssText="text-align:center;";bWrap.appendChild(badge);' +
    "hero.appendChild(bWrap);hero.appendChild(stat);hero.appendChild(hCap);" +
    // Score breakdown — core axes with bars + honest formula, like the app kit.
    "var bd=card();" +
    'bd.appendChild(cardTitle("Score breakdown"));' +
    'bd.appendChild(cardSub("this process \\u00b7 lower is better"));' +
    'var bdRows=document.createElement("div");bd.appendChild(bdRows);' +
    'var formula=document.createElement("div");' +
    'formula.style.cssText="font-size:10px;color:"+T.mut+";margin-top:8px;";' +
    'formula.textContent="score = p95 vs TTI budget \\u00b7 good\\u226585 \\u00b7 needs-work\\u226560";' +
    "bd.appendChild(formula);" +
    // Runtime health — the environment meters card.
    "var hl=card();" +
    'hl.appendChild(cardTitle("Runtime health"));' +
    'hl.appendChild(cardSub("environment meters \\u00b7 shown when measurable"));' +
    'var hlRows=document.createElement("div");hl.appendChild(hlRows);' +
    // Legend — same rating legend strip as the app kit.
    "var lg=card();" +
    'lg.style.cssText+="display:flex;flex-wrap:wrap;gap:6px 12px;font-size:10.5px;color:"+T.mut+";";' +
    "function lgItem(color,tx){" +
    'var s=document.createElement("span");s.style.cssText="display:inline-flex;align-items:center;gap:5px;";' +
    'var d=document.createElement("span");d.style.cssText="width:7px;height:7px;border-radius:50%;background:"+color+";";' +
    'var t=document.createElement("span");t.textContent=tx;' +
    "s.appendChild(d);s.appendChild(t);return s;}" +
    'lg.appendChild(lgItem(COLORS.good,"Good \\u226585"));' +
    'lg.appendChild(lgItem(COLORS["needs-work"],"Needs work \\u226560"));' +
    'lg.appendChild(lgItem(COLORS.poor,"Poor <60"));' +
    // "Connect to your account" — a port of the web kit's account card, styled
    // with the panel's T palette (card #15171c, orange buttons). Auth context
    // comes from the loopback-only /account endpoint fetched when the panel
    // opens; nothing is persisted (the session token lives only in this IIFE's
    // memory). Every listener + async path is try/catch guarded and NEVER
    // throws into the host page. All dynamic values use textContent.
    "var acct=card();" +
    'var acctBody=document.createElement("div");acct.appendChild(acctBody);' +
    // In-memory auth state — never persisted.
    "var ACTX={endpoint:null,installId:null,deleteToken:null,available:false,fullTelemetry:false};" +
    "var SESS=null;" + // {token,email} once signed in
    // Full-telemetry toggle state — set from the claim response (falls back to
    // ACTX.fullTelemetry, the kit's current effective mode). Only meaningful
    // once LINKED (a verified claim gives us the delete token + session).
    "var TELE_ON=false;var TELE_KNOWN=false;var TELE_BUSY=false;" +
    // Claim banner — the friendly line the signed-in card shows under the Link
    // button. Held in shared state (not on the message node) so it survives the
    // re-render that reveals the Full-telemetry toggle, and so the manual tap
    // and the automatic link-on-sign-in say exactly the same thing.
    "var CLAIM_MSG=null;var CLAIM_MSG_OK=false;" +
    // The honest fallback line when the server rejects the OWNERSHIP proof
    // (401 reason install_token / 403). It no longer claims linking is
    // impossible without this page's credential — an account that owns this
    // project's invite key can link it from any browser.
    'var ACCT_LINK_PROOF_MSG="Couldn\\u2019t link this project. Linking needs either this project\\u2019s own connection credential (available in the session where it registered) or an account that owns this project\\u2019s project key \\u2014 sign in with that account, or link it from your dashboard.";' +
    // Claim bookkeeping: CLAIM_BUSY guards the in-flight call (manual tap OR
    // the automatic link-on-sign-in), AUTO_CLAIM_FOR remembers the (session,
    // install) pair already auto-attempted so the automatic path fires exactly
    // once. A failed auto-link simply leaves the manual "Link this project"
    // button in place with the same code-mapped message.
    "var CLAIM_BUSY=false;var AUTO_CLAIM_FOR=null;" +
    'var acctView={kind:"signed-out"};' + // signed-out | otp | signed-in
    "var acctBusy=false;" +
    'function acctJoin(ep,p){return String(ep).replace(/\\/+$/,"")+p;}' +
    "function acctMkInput(type,ph,ac){" +
    'var i=document.createElement("input");i.type=type;i.placeholder=ph;' +
    'if(ac)i.setAttribute("autocomplete",ac);' +
    'i.style.cssText="width:100%;box-sizing:border-box;margin-bottom:8px;padding:8px 10px;' +
    'font-size:12.5px;background:"+T.bg+";color:"+T.fg+";border:1px solid "+T.br+";' +
    'border-radius:8px;outline:none;font-family:inherit;";return i;}' +
    "function acctMkBtn(tx){" +
    'var b=document.createElement("button");b.type="button";b.textContent=tx;' +
    'b.style.cssText="width:100%;padding:9px 10px;font-size:12.5px;font-weight:700;' +
    'background:"+T.pri+";color:"+T.bg+";border:none;border-radius:8px;cursor:pointer;font-family:inherit;";' +
    "return b;}" +
    "function acctMkGhost(tx){" +
    "var b=acctMkBtn(tx);" +
    'b.style.background="transparent";b.style.color=T.mut;' +
    'b.style.border="1px solid "+T.br;b.style.marginTop="8px";return b;}' +
    "function acctMkMsg(){" +
    'var d=document.createElement("div");' +
    'd.style.cssText="margin-top:8px;font-size:10.5px;line-height:1.5;color:"+T.mut+";";return d;}' +
    "function acctSetMsg(el,tx,color){try{el.textContent=tx;el.style.color=color||T.mut;}catch(e){}}" +
    // Fetch wrapper — plain fetch, no persistence, errors normalized to a code.
    "function acctFetch(url,init){" +
    "return fetch(url,init).then(function(r){return r;});}" +
    // ---- Renderers ----
    "function acctRender(){try{" +
    "while(acctBody.firstChild)acctBody.removeChild(acctBody.firstChild);" +
    'var title=document.createElement("div");' +
    'title.style.cssText="font-size:13px;font-weight:700;color:"+T.fg+";";' +
    'title.textContent="Connect to your account";acctBody.appendChild(title);' +
    "if(!ACTX.available||!ACTX.endpoint){" +
    'var s=document.createElement("div");' +
    's.style.cssText="font-size:10.5px;color:"+T.mut+";margin-top:6px;line-height:1.5;";' +
    's.textContent="Sign-in is available when this page is opened on the dev machine.";' +
    "acctBody.appendChild(s);return;}" +
    'if(acctView.kind==="signed-in"){acctRenderSignedIn();return;}' +
    'if(acctView.kind==="otp"){acctRenderOtp();return;}' +
    "acctRenderSignedOut();" +
    "}catch(e){}}" +
    // signed-out: email + password → Sign in
    "function acctRenderSignedOut(){" +
    'var s=document.createElement("div");' +
    's.style.cssText="font-size:10.5px;color:"+T.mut+";margin:6px 0 10px;line-height:1.5;";' +
    's.textContent="Sign in with your Boosthis dashboard account to link this project directly \\u2014 no project-key matching needed.";' +
    "acctBody.appendChild(s);" +
    'var email=acctMkInput("email","Email","username");acctBody.appendChild(email);' +
    'var pw=acctMkInput("password","Password","current-password");acctBody.appendChild(pw);' +
    'var btn=acctMkBtn("Sign in");acctBody.appendChild(btn);' +
    "var msg=acctMkMsg();acctBody.appendChild(msg);" +
    'btn.addEventListener("click",function(){try{' +
    "if(acctBusy)return;" +
    'var em=(email.value||"").trim();var pass=pw.value||"";' +
    'if(!em||!pass){acctSetMsg(msg,"Enter your email and password.",COLORS.poor);return;}' +
    'acctBusy=true;btn.disabled=true;btn.textContent="Signing in\\u2026";acctSetMsg(msg,"",T.mut);' +
    'acctFetch(acctJoin(ACTX.endpoint,"/auth/login"),{method:"POST",' +
    'headers:{"content-type":"application/json",accept:"application/json"},' +
    "body:JSON.stringify({email:em,password:pass})}).then(function(r){" +
    'pw.value="";' +
    'if(r.status===401){throw "Wrong email or password.";}' +
    'if(r.status===429){throw "Too many attempts. Try again later.";}' +
    'if(!r.ok){throw "Login failed. Please try again.";}' +
    "return r.json();}).then(function(b){" +
    'if(b&&b.otpRequired===true&&typeof b.challengeToken==="string"){' +
    'acctView={kind:"otp",challengeToken:b.challengeToken,email:em};acctRender();return;}' +
    'var tok=b&&typeof b.token==="string"?b.token:null;' +
    'var ae=b&&b.account&&typeof b.account.email==="string"?b.account.email:em;' +
    'if(!tok){throw "Login failed. Please try again.";}' +
    'SESS={token:tok,email:ae};acctView={kind:"signed-in"};acctRender();' +
    "}).catch(function(err){" +
    'acctBusy=false;try{btn.disabled=false;btn.textContent="Sign in";}catch(e){}' +
    'acctSetMsg(msg,typeof err==="string"?err:"Something went wrong. Please try again.",COLORS.poor);' +
    "return;}).then(function(){acctBusy=false;});" +
    "}catch(e){acctBusy=false;}});}" +
    // otp: 6-digit code + resend
    "function acctRenderOtp(){" +
    'var s=document.createElement("div");' +
    's.style.cssText="font-size:10.5px;color:"+T.mut+";margin:6px 0 10px;line-height:1.5;";' +
    's.textContent="We emailed a 6-digit code to "+acctView.email+". Enter it below to finish signing in.";' +
    "acctBody.appendChild(s);" +
    'var code=acctMkInput("text","6-digit code","one-time-code");code.inputMode="numeric";acctBody.appendChild(code);' +
    'var btn=acctMkBtn("Verify");acctBody.appendChild(btn);' +
    'var resend=acctMkGhost("Resend code");acctBody.appendChild(resend);' +
    "var msg=acctMkMsg();acctBody.appendChild(msg);" +
    'btn.addEventListener("click",function(){try{' +
    'if(acctBusy)return;var cv=(code.value||"").trim();' +
    'if(!cv){acctSetMsg(msg,"Enter the code from your email.",COLORS.poor);return;}' +
    'acctBusy=true;btn.disabled=true;btn.textContent="Verifying\\u2026";acctSetMsg(msg,"",T.mut);' +
    'acctFetch(acctJoin(ACTX.endpoint,"/auth/login/otp"),{method:"POST",' +
    'headers:{"content-type":"application/json",accept:"application/json"},' +
    "body:JSON.stringify({challengeToken:acctView.challengeToken,code:cv})}).then(function(r){" +
    'if(r.status===401){throw "That code isn\\u2019t right. Check the newest email we sent and try again.";}' +
    'if(r.status===400){acctView={kind:"signed-out"};acctRender();throw "__handled__";}' +
    'if(r.status===429){throw "Too many attempts. Try again later.";}' +
    'if(!r.ok){throw "Couldn\\u2019t verify the code. Please try again.";}' +
    "return r.json();}).then(function(b){" +
    'var tok=b&&typeof b.token==="string"?b.token:null;' +
    'var ae=b&&b.account&&typeof b.account.email==="string"?b.account.email:acctView.email;' +
    'if(!tok){throw "Couldn\\u2019t verify the code. Please try again.";}' +
    'SESS={token:tok,email:ae};acctView={kind:"signed-in"};acctRender();' +
    "}).catch(function(err){acctBusy=false;" +
    'if(err==="__handled__")return;' +
    'try{btn.disabled=false;btn.textContent="Verify";}catch(e){}' +
    'acctSetMsg(msg,typeof err==="string"?err:"Something went wrong. Please try again.",COLORS.poor);' +
    "}).then(function(){acctBusy=false;});" +
    "}catch(e){acctBusy=false;}});" +
    'resend.addEventListener("click",function(){try{' +
    'if(acctBusy)return;acctBusy=true;resend.disabled=true;acctSetMsg(msg,"",T.mut);' +
    'acctFetch(acctJoin(ACTX.endpoint,"/auth/login/otp/resend"),{method:"POST",' +
    'headers:{"content-type":"application/json",accept:"application/json"},' +
    "body:JSON.stringify({challengeToken:acctView.challengeToken})}).then(function(r){" +
    'if(r.ok){acctSetMsg(msg,"A new code is on its way.",COLORS.good);return;}' +
    'if(r.status===400){acctView={kind:"signed-out"};acctRender();return;}' +
    'if(r.status===429){throw "Too many resend requests. Please wait a moment.";}' +
    'if(r.status===502){throw "We couldn\\u2019t send a new code right now. Try again in a few minutes.";}' +
    'throw "Couldn\\u2019t resend the code. Please try again.";' +
    "}).catch(function(err){" +
    'if(typeof err==="string")acctSetMsg(msg,err,COLORS.poor);' +
    "}).then(function(){acctBusy=false;try{resend.disabled=false;}catch(e){}});" +
    "}catch(e){acctBusy=false;}});}" +
    // signed-in: who + optional claim + sign out
    "function acctRenderSignedIn(){" +
    'var who=document.createElement("div");' +
    'who.style.cssText="font-size:12.5px;color:"+T.fg+";font-weight:600;";' +
    'who.textContent="Signed in as "+(SESS?SESS.email:"");acctBody.appendChild(who);' +
    "var msg=acctMkMsg();" +
    // The link step needs an installId and nothing else from THIS page. The
    // install delete token is a BONUS proof, not a precondition: when it is
    // absent the claim still fires without the X-Boosthis-Install-Token header
    // and the SERVER decides, accepting the signed-in account when it owns the
    // invite key this project registered under (the same dual-signal ownership
    // the dashboard already uses). Requiring the token here is what deadlocked
    // every browser session after the first one.
    "var canClaim=!!ACTX.installId;" +
    "if(canClaim){" +
    'var cs=document.createElement("div");' +
    'cs.style.cssText="font-size:10.5px;color:"+T.mut+";margin:8px 0 10px;line-height:1.5;";' +
    'cs.textContent="Link this project to your account so it appears in your dashboard.";' +
    "acctBody.appendChild(cs);" +
    // One button, three honest states: idle (tap to link), in-flight (the
    // automatic link-on-sign-in or a manual tap), and done (already verified —
    // disabled, because the work happened without the developer lifting a
    // finger).
    'var claim=acctMkBtn(LINKED?"Linked":(CLAIM_BUSY?"Linking\\u2026":"Link this project"));' +
    "claim.disabled=LINKED||CLAIM_BUSY;" +
    "acctBody.appendChild(claim);acctBody.appendChild(msg);" +
    // The last claim outcome lives in shared state so it survives the
    // re-render that reveals the Full-telemetry toggle — and so a manual tap
    // and the automatic link-on-sign-in say exactly the same thing.
    "if(CLAIM_MSG)acctSetMsg(msg,CLAIM_MSG,CLAIM_MSG_OK?COLORS.good:COLORS.poor);" +
    'claim.addEventListener("click",function(){try{' +
    'if(acctBusy||CLAIM_BUSY||LINKED)return;acctBusy=true;claim.disabled=true;claim.textContent="Linking\\u2026";acctSetMsg(msg,"",T.mut);' +
    "acctClaimRun(function(res){acctBusy=false;" +
    "CLAIM_MSG=res.msg;CLAIM_MSG_OK=res.ok===true;try{acctRender();}catch(e){}});" +
    "}catch(e){acctBusy=false;}});" +
    // Auto-link on sign-in: the developer is signed in AND both proofs are in
    // hand, so fire the SAME claim call the button fires — no tap, no reload.
    // On 200 the re-render shows the Full-telemetry toggle instantly; on
    // failure the manual button above stays exactly where it is with the
    // code-mapped message, so 401/404/409 behave as they always did.
    "acctAutoClaim();" +
    "}else{" +
    'var ns=document.createElement("div");' +
    'ns.style.cssText="font-size:10.5px;color:"+T.mut+";margin:8px 0 0;line-height:1.5;";' +
    'ns.textContent="This project hasn\\u2019t registered with Boosthis yet, so it can\\u2019t be linked from here.";' +
    "acctBody.appendChild(ns);acctBody.appendChild(msg);}" +
    // ---- Full-telemetry toggle -------------------------------------------
    // Rendered ONLY once the project link (claim) has been VERIFIED by the
    // server (LINKED). The delete token is no longer part of the condition:
    // once the install is linked to this account, /installs/:id/telemetry
    // accepts the account session ALONE (its session-only mode, exactly the
    // proof the dashboard's own switch uses), so the toggle works in a later
    // browser session that never saw the delete token. Initialized from the
    // claim response (falls back to the kit's current effective mode via
    // ACTX.fullTelemetry). On tap it POSTs to /installs/:id/telemetry and
    // shows a tiny pending state; on 200 the dashboard reflects it and this
    // server kit's uploader picks it up on its next check-in (no relaunch of
    // the dev's code needed).
    "if(LINKED&&ACTX.installId){acctTeleToggle();}" +
    'var out=acctMkGhost("Sign out");acctBody.appendChild(out);' +
    'out.addEventListener("click",function(){try{' +
    "if(acctBusy)return;acctBusy=true;out.disabled=true;" +
    "var tok=SESS?SESS.token:null;" +
    // Sign-out restarts the WHOLE gate flow: wipe the terms acceptance +
    // LINKED flag, reset the checkbox, re-render the card, and gateSync()
    // swaps the panel back to the gate (owner requirement, Jul 2026).
    'function done(){SESS=null;acctView={kind:"signed-out"};acctBusy=false;' +
    // A new sign-in must auto-link (and re-verify) from scratch: forget the
    // attempted pair and the last claim banner.
    "AUTO_CLAIM_FOR=null;CLAIM_MSG=null;CLAIM_MSG_OK=false;TELE_KNOWN=false;" +
    "termsClear();LINKED=false;gateChecked=false;" +
    'try{if(gCheckBox){gCheckBox.style.borderColor=T.br;gCheckBox.style.background="transparent";' +
    'if(gCheckBox.firstChild)gCheckBox.firstChild.style.display="none";}}catch(e){}' +
    "acctRender();try{gateSync();}catch(e){}}" +
    'if(tok){acctFetch(acctJoin(ACTX.endpoint,"/auth/logout"),{method:"POST",headers:{authorization:"Bearer "+tok}}).then(done,done);}else{done();}' +
    "}catch(e){acctBusy=false;}});}" +
    // ---- Shared claim runner ----------------------------------------------
    // ONE code path for BOTH the manual "Link this project" tap and the
    // automatic link-on-sign-in. The account session (Bearer SESS.token) is
    // ALWAYS required. The install delete token rides along as
    // X-Boosthis-Install-Token WHEN THIS PAGE HAS IT — otherwise the header is
    // OMITTED entirely (never sent empty, which would read as a failed proof)
    // and the server falls back to its second sanctioned ownership proof: the
    // signed-in account owning the invite key this project registered with.
    // `cb` receives {ok,msg} where msg is the exact friendly, code-mapped line
    // the button always showed (401/404/409/429 wording untouched).
    'function acctClaimKey(){return (SESS?SESS.token:"")+"\\u0001"+(ACTX.installId||"");}' +
    'function acctClaimHeaders(){var h={accept:"application/json",authorization:"Bearer "+SESS.token};' +
    'if(ACTX.deleteToken)h["x-boosthis-install-token"]=ACTX.deleteToken;return h;}' +
    'function acctTeleHeaders(){var h=acctClaimHeaders();h["content-type"]="application/json";return h;}' +
    "function acctClaimRun(cb){try{" +
    "if(CLAIM_BUSY)return;" +
    "function done(res){CLAIM_BUSY=false;try{cb(res);}catch(e){}}" +
    'if(!SESS||!ACTX.endpoint||!ACTX.installId){done({ok:false,msg:"Linking failed. Please try again."});return;}' +
    "CLAIM_BUSY=true;AUTO_CLAIM_FOR=acctClaimKey();" +
    'acctFetch(acctJoin(ACTX.endpoint,"/installs/"+encodeURIComponent(ACTX.installId)+"/claim"),{method:"POST",' +
    "headers:acctClaimHeaders()}).then(function(r){" +
    "if(r.status===200){return r.json().then(function(b){return b||{};},function(){return {};}).then(function(b){" +
    "var linked=b&&b.linked===true;" +
    // A 200 from the claim endpoint is a VERIFIED LINK (linked:true or
    // already-linked). Set the LINKED flag and refresh the gate so
    // needsConnect clears and "I Agree & Continue" can enable.
    "LINKED=true;try{gateSync();}catch(e){}" +
    // Seed the telemetry toggle from the claim response (fall back to the
    // kit's current effective mode reported by /account).
    'TELE_ON=typeof b.fullTelemetry==="boolean"?b.fullTelemetry:ACTX.fullTelemetry===true;TELE_KNOWN=true;' +
    'done({ok:true,msg:linked?"Linked. This project now appears in your dashboard.":"This project is already linked to your account."});' +
    "return;});}" +
    // 401/403 = the OWNERSHIP proof failed, and the honest fallback line says
    // what would actually work. Linking is NOT impossible without this page's
    // credential: signing in as the account that owns this project's invite
    // key links it too (the server accepts that proof).
    "if(r.status===401){return r.json().then(function(b){return b&&b.reason;},function(){return null;}).then(function(rs){" +
    'throw rs==="install_token"?ACCT_LINK_PROOF_MSG:"Your session expired. Sign in again.";});}' +
    "if(r.status===403){throw ACCT_LINK_PROOF_MSG;}" +
    'if(r.status===404){throw "This project isn\\u2019t registered yet. Make sure telemetry is enabled.";}' +
    'if(r.status===409){throw "This project is already linked to a different account.";}' +
    'if(r.status===429){throw "Too many attempts. Try again later.";}' +
    'throw "Linking failed. Please try again.";' +
    "}).catch(function(err){" +
    'done({ok:false,msg:typeof err==="string"?err:"Linking failed. Please try again."});' +
    "}).then(function(){CLAIM_BUSY=false;});" +
    "}catch(e){CLAIM_BUSY=false;}}" +
    // ---- Auto-link on sign-in ---------------------------------------------
    // The moment the developer is signed in and the project has registered
    // (installId known), fire the claim automatically — no "Link this project"
    // tap, no page reload. The delete token is NOT required: without it the
    // header is omitted and the server decides via key ownership. Runs exactly
    // once per (session, install) pair; a manual tap marks the pair too, so a
    // failure is never silently retried in a loop. On 200 the re-render reveals
    // the Full-telemetry toggle instantly; on failure the manual Link button
    // stays put carrying the code-mapped message.
    "function acctAutoClaim(){try{" +
    "if(LINKED||CLAIM_BUSY)return;" +
    "if(!SESS||!ACTX.endpoint||!ACTX.installId)return;" +
    "var k=acctClaimKey();if(AUTO_CLAIM_FOR===k)return;AUTO_CLAIM_FOR=k;" +
    "acctClaimRun(function(res){CLAIM_MSG=res.msg;CLAIM_MSG_OK=res.ok===true;" +
    "try{acctRender();}catch(e){}});" +
    "}catch(e){}}" +
    // ---- Full-telemetry toggle (rendered by acctRenderSignedIn once LINKED)
    // Consent-flavored, honest: a label, a sub-line explaining what ON does,
    // and an ON/OFF pill. Tapping POSTs { fullTelemetry } to the telemetry
    // endpoint with the account session + install delete token (the same
    // dual-proof the claim used). Friendly, code-mapped errors — never a raw
    // dump. This server kit stores the choice server-side; its own uploader
    // reads the directive on its next check-in.
    "function acctTeleToggle(){try{" +
    'var wrap=document.createElement("div");' +
    'wrap.style.cssText="margin-top:12px;padding-top:12px;border-top:1px solid "+T.br+";";' +
    'var row=document.createElement("div");' +
    'row.style.cssText="display:flex;align-items:center;justify-content:space-between;gap:10px;";' +
    'var lw=document.createElement("div");lw.style.cssText="flex:1;min-width:0;";' +
    'var lb=document.createElement("div");' +
    'lb.style.cssText="font-size:12.5px;font-weight:700;color:"+T.fg+";";lb.textContent="Full telemetry";' +
    'var sub=document.createElement("div");' +
    'sub.style.cssText="font-size:10.5px;color:"+T.mut+";margin-top:2px;line-height:1.5;";' +
    'sub.textContent="Upload the complete meter picture so your dashboard and AI can see performance. Off = private mode.";' +
    "lw.appendChild(lb);lw.appendChild(sub);" +
    // The pill switch — orange track when ON, muted when OFF.
    'var sw=document.createElement("button");sw.type="button";' +
    'sw.setAttribute("role","switch");' +
    'sw.style.cssText="flex:0 0 auto;width:46px;height:26px;border-radius:999px;border:none;cursor:pointer;position:relative;padding:0;transition:background .15s;font-family:inherit;";' +
    'var knob=document.createElement("span");' +
    'knob.style.cssText="position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .15s;";' +
    "sw.appendChild(knob);" +
    'var pend=document.createElement("span");' +
    'pend.style.cssText="font-size:9px;font-weight:700;color:"+T.mut+";margin-left:8px;display:none;";pend.textContent="\\u2026";' +
    "row.appendChild(lw);row.appendChild(sw);row.appendChild(pend);wrap.appendChild(row);" +
    "var tmsg=acctMkMsg();wrap.appendChild(tmsg);" +
    "function reflect(){try{" +
    "sw.style.background=TELE_ON?T.pri:T.br;" +
    'sw.setAttribute("aria-checked",TELE_ON?"true":"false");' +
    'sw.setAttribute("aria-label",(TELE_ON?"Full telemetry on":"Full telemetry off"));' +
    'knob.style.left=TELE_ON?"23px":"3px";' +
    "}catch(e){}}" +
    "reflect();" +
    'sw.addEventListener("click",function(){try{' +
    "if(TELE_BUSY||acctBusy)return;" +
    'var next=!TELE_ON;TELE_BUSY=true;acctSetMsg(tmsg,"",T.mut);' +
    'pend.style.display="inline";sw.style.opacity="0.6";' +
    'acctFetch(acctJoin(ACTX.endpoint,"/installs/"+encodeURIComponent(ACTX.installId)+"/telemetry"),{method:"POST",' +
    // Same header rule as the claim: send the install token only when this
    // page actually has it. /installs/:id/telemetry already accepts the
    // account session ALONE once the install is linked to that account, which
    // is exactly the state the toggle renders in.
    "headers:acctTeleHeaders()," +
    "body:JSON.stringify({fullTelemetry:next})}).then(function(r){" +
    "if(r.status===200){return r.json().then(function(b){" +
    'return b&&typeof b.fullTelemetry==="boolean"?b.fullTelemetry:next;},function(){return next;}).then(function(applied){' +
    // 200 — the server stored the choice. Reflect it; this server kit's
    // uploader reads the directive on its next check-in.
    "TELE_ON=applied;TELE_KNOWN=true;reflect();" +
    'acctSetMsg(tmsg,applied?"Full telemetry on. Your dashboard and AI now see the complete picture.":"Private mode. Only issue-level signals are shared.",COLORS.good);' +
    "return;});}" +
    "if(r.status===402){return r.json().then(function(b){return b&&b.error;},function(){return null;}).then(function(er){" +
    'throw er==="billing_frozen"?"Billing is frozen \\u2014 clear the balance to change this.":"Full telemetry is a Pro plan feature.";});}' +
    'if(r.status===403){throw "This project is paused \\u2014 telemetry can\\u2019t change while paused.";}' +
    "if(r.status===401){return r.json().then(function(b){return b&&b.reason;},function(){return null;}).then(function(rs){" +
    'throw rs==="install_token"?"This copy needs repair \\u2014 press Repair in your dashboard, then reload.":"Your session expired. Sign in again.";});}' +
    'if(r.status===409){throw "This project is linked to a different account.";}' +
    'if(r.status===429){throw "Too many changes. Try again in a moment.";}' +
    'throw "Couldn\\u2019t change telemetry. Please try again.";' +
    "}).catch(function(err){" +
    'acctSetMsg(tmsg,typeof err==="string"?err:"Couldn\\u2019t change telemetry. Please try again.",COLORS.poor);' +
    '}).then(function(){TELE_BUSY=false;try{pend.style.display="none";sw.style.opacity="1";}catch(e){}});' +
    "}catch(e){TELE_BUSY=false;}});" +
    "acctBody.appendChild(wrap);" +
    "}catch(e){}}" +
    // ---- Account context load + auto-refresh -------------------------------
    // A FRESH install registers with the server seconds AFTER the page loaded,
    // so a one-shot read leaves installId/deleteToken null forever and the
    // developer is stuck on "reload after telemetry registers" — a dead end.
    // acctCtxRead() re-reads the SAME loopback-only endpoint with IDENTICAL
    // semantics (credentials omit, same path) and re-populates ACTX; on every
    // success it re-renders the account card and re-runs gateSync(). When the
    // context is still incomplete (no installId / no deleteToken) or the fetch
    // fails, acctPollStart() re-reads every 2s for up to 2 minutes and stops
    // the moment BOTH credentials land (or the cap hits — the existing reload
    // hint then stays as the honest fallback).
    "var acctLoaded=false;var acctPollTimer=null;var acctPollUntil=0;" +
    "var ACCT_POLL_MS=2000;var ACCT_POLL_WINDOW_MS=120000;" +
    "function acctCtxComplete(){return !!(ACTX.installId&&ACTX.deleteToken);}" +
    "function acctPollStop(){try{if(acctPollTimer){clearInterval(acctPollTimer);acctPollTimer=null;}}catch(e){}}" +
    "function acctCtxRead(){try{" +
    (safeAccount === null
      ? "acctRender();"
      : 'fetch("' +
        safeAccount +
        '",{credentials:"omit"}).then(function(r){' +
        "if(!r.ok)return null;return r.json();}).then(function(b){" +
        'if(b&&typeof b.endpoint==="string"&&b.endpoint){' +
        'ACTX.endpoint=b.endpoint;ACTX.installId=typeof b.installId==="string"?b.installId:null;' +
        'ACTX.deleteToken=typeof b.deleteToken==="string"?b.deleteToken:null;ACTX.available=true;' +
        "ACTX.fullTelemetry=b.fullTelemetry===true;}" +
        // Re-run FULL gate resolution once the account context (installId)
        // is known — gateApply() alone only refreshes the button state, so a
        // reinstalled project (new installId) would stay on a stale
        // acceptance until some later incidental gateSync(). On fetch failure
        // re-sync too (installId stays null => version-only check, never a
        // lockout).
        "acctRender();acctTermsHref();try{gateSync();}catch(e){}" +
        // Credentials that land LATE (the poll below) while the developer is
        // already signed in must link the project right away — same auto-link
        // the sign-in path fires, no tap and no reload.
        "try{acctAutoClaim();}catch(e){}" +
        "if(acctCtxComplete())acctPollStop();" +
        "}).catch(function(){acctRender();try{gateSync();}catch(e){}});") +
    "}catch(e){try{acctRender();}catch(e2){}}}" +
    "function acctPollStart(){try{" +
    "if(acctPollTimer||acctCtxComplete())return;" +
    "acctPollUntil=Date.now()+ACCT_POLL_WINDOW_MS;" +
    "acctPollTimer=setInterval(function(){try{" +
    "if(acctCtxComplete()||Date.now()>acctPollUntil){acctPollStop();return;}" +
    "acctCtxRead();}catch(e){}},ACCT_POLL_MS);" +
    "}catch(e){}}" +
    // Load the auth context once (called when the panel first opens), then let
    // the poll above keep it fresh until the credentials arrive.
    "function acctLoad(){try{" +
    "if(acctLoaded)return;acctLoaded=true;" +
    "acctCtxRead();" +
    (safeAccount === null ? "" : "acctPollStart();") +
    "}catch(e){try{acctRender();}catch(e2){}}}" +
    "acctRender();" +
    'var note=document.createElement("div");' +
    'note.style.cssText="margin:2px 2px 0;color:"+T.mut+";font-size:10.5px;";' +
    'note.textContent="Local dev meters \\u2014 served by this project, nothing leaves it.";' +
    // Terms & Privacy footer — at the very bottom, muted, opens in a new tab.
    // Href uses the telemetry endpoint origin + /terms when available, else a
    // safe fallback. Guarded: any parse failure degrades to the fallback.
    'var footer=document.createElement("div");' +
    'footer.style.cssText="margin:8px 2px 0;text-align:center;";' +
    'var terms=document.createElement("a");' +
    'terms.textContent="Terms & Privacy";terms.target="_blank";terms.rel="noopener";' +
    'terms.style.cssText="color:"+T.mut+";font-size:10px;text-decoration:underline;";' +
    'terms.href="https://www.boosthis.com/terms";' +
    "function acctTermsHref(){try{" +
    "if(ACTX.available&&ACTX.endpoint){" +
    'var u=new URL(ACTX.endpoint);terms.href=u.origin+"/terms";}' +
    "}catch(e){}}" +
    // Two containers inside the panel: the first-open GATE and the normal
    // dashboard. syncGate() toggles which one is visible. The dashboard keeps
    // its exact composition (hero/breakdown/health/acct/legend/note/footer);
    // the acct card node is reparented onto the gate while gated and moved back
    // to its dashboard slot on accept (DOM nodes reparent cleanly).
    'var gateWrap=document.createElement("div");gateWrap.style.display="none";' +
    'var dashWrap=document.createElement("div");dashWrap.style.display="none";' +
    "dashWrap.appendChild(hero);dashWrap.appendChild(bd);dashWrap.appendChild(hl);dashWrap.appendChild(acct);dashWrap.appendChild(lg);dashWrap.appendChild(note);dashWrap.appendChild(footer);" +
    "footer.appendChild(terms);" +
    "var switchOff=document.createElement('button');switchOff.type='button';switchOff.textContent='Hide the bubble on this browser';switchOff.style.cssText='display:block;margin:6px auto 0;padding:2px 6px;background:none;border:0;color:#8b8f99;font:inherit;font-size:10px;text-decoration:underline;cursor:pointer;';switchOff.addEventListener('click',function(){try{var u=new URL(window.location.href);u.searchParams.set('boosthis','off');window.location.assign(u.href);}catch(e){}});footer.appendChild(switchOff);" +
    // ---- Rejected-registration banner (fixed copy, top of the panel) ----
    // When the server REFUSED this install's registration for a reason the
    // developer must fix in code (today: an install ID that is not a UUID),
    // the panel must not read as connected/normal/awaiting. The closed /panel
    // read carries only a code-defined `notice.kind` marker; the copy below is
    // a literal in this snippet, so NOTHING server- or developer-provided is
    // ever rendered here. Appended FIRST so it sits above both the gate and
    // the dashboard.
    'var noticeEl=document.createElement("div");' +
    'noticeEl.style.cssText="display:none;background:"+T.card+";border:1px solid "+COLORS.poor+";' +
    'border-radius:12px;padding:10px 12px;margin:0 0 10px;";' +
    'var noticeT=document.createElement("div");' +
    'noticeT.style.cssText="font-size:12px;font-weight:700;color:"+COLORS.poor+";";' +
    'var noticeB=document.createElement("div");' +
    'noticeB.style.cssText="font-size:11px;line-height:1.45;color:"+T.fg+";margin-top:3px;";' +
    "noticeEl.appendChild(noticeT);noticeEl.appendChild(noticeB);" +
    "panel.appendChild(noticeEl);" +
    // "Cannot tell" is not a failure, so it is drawn in the warning tone while
    // every real problem keeps the red one. Same box, honestly coloured.
    'function noticeTone(n){try{return (n&&(n.kind==="registration-unknown"||n.kind==="registration-throttled"))?COLORS["needs-work"]:COLORS.poor;}catch(e){return COLORS.poor;}}' +
    // Mirrors describeRetryWait() in telemetry.ts — this snippet runs in the
    // browser and cannot import. Coarse on purpose, and the same coarseness,
    // so the panel and the console line never name two different waits.
    'function waitTxt(s){try{s=(typeof s==="number"&&isFinite(s)&&s>0)?Math.round(s):0;' +
    'if(!s)return "a short while";' +
    'if(s<90)return "about "+Math.max(1,s)+"s";' +
    'var m=Math.round(s/60);if(m<90)return "about "+m+" minute"+(m===1?"":"s");' +
    'var h=Math.round(s/3600);return "about "+h+" hour"+(h===1?"":"s");}catch(e){return "a short while";}}' +
    "function showNotice(n){try{" +
    "var tone=noticeTone(n);noticeEl.style.borderColor=tone;noticeT.style.color=tone;" +
    'if(n&&n.kind==="install-id-not-uuid"){' +
    'noticeT.textContent="Registration rejected";' +
    'noticeB.textContent="Install ID must be a UUID. Mint a real UUID and restart.";' +
    'noticeEl.style.display="block";}' +
    // not-registered: the kit never registered, so nothing is being sent — the
    // dashboard will stay empty until the key + outbound access are fixed.
    'else if(n&&n.kind==="not-registered"){' +
    'noticeT.textContent="Not registered yet";' +
    'noticeB.textContent="This app has not registered with Boosthis, so nothing is being sent. Check the project key and this app\'s outbound network access, then restart.";' +
    'noticeEl.style.display="block";}' +
    // registration-throttled: Boosthis answered and said "not so fast". A
    // temporary, self-clearing wait — never the unreachable wording below,
    // which would send a developer hunting a network fault that is not there.
    // The number is the server's own Retry-After; the WORDS are literals here.
    'else if(n&&n.kind==="registration-throttled"){' +
    'noticeT.textContent="Waiting \\u2014 too many new registrations";' +
    'noticeB.textContent="Boosthis is rate-limiting new registrations for this project key, so this app is not on file yet. It is temporary and needs nothing from you: the kit is waiting "+waitTxt(n.retryAfterSeconds)+" and will register itself, with no restart. Do not change the install line\'s id while this is showing \\u2014 a new id is a new registration and makes the wait longer.";' +
    'noticeEl.style.display="block";}' +
    // registration-unknown: we asked Boosthis and got no answer, so this panel
    // does not KNOW. Its own state, in its own words — it must never borrow
    // the failure wording above, and in particular must never carry the claim
    // that nothing is being sent.
    'else if(n&&n.kind==="registration-unknown"){' +
    'noticeT.textContent="Can\'t check right now";' +
    'noticeB.textContent="Boosthis could not be reached to confirm whether this app is registered, so this panel cannot say either way yet. This is not a failed install and it does not mean anything stopped \\u2014 it settles by itself once the check goes through. Do not change the install line\'s id while this is showing.";' +
    'noticeEl.style.display="block";}' +
    // sharing-off: registered, but full telemetry is off — the live meters on
    // this screen never leave the process, so the dashboard stays empty. Two
    // ways to turn sharing on: the owner's dashboard switch, or the code option.
    'else if(n&&n.kind==="sharing-off"){' +
    'noticeT.textContent="Nothing is being uploaded";' +
    'noticeB.textContent="This app is registered, but sharing is off: these meters stay on this screen and your Boosthis dashboard stays empty. Turn sharing on there, or start the kit with shareMeterWithAI: true.";' +
    'noticeEl.style.display="block";}' +
    // uploads-failing: registered, sharing on, and the last WHOLE batch was
    // refused or never answered. Without this the panel keeps showing a green
    // score and "last upload N minutes ago" while a hole opens in the
    // dashboard. The reason marker is code-defined and closed; the words are
    // literals here, so no response body ever reaches a customer's screen.
    'else if(n&&n.kind==="uploads-failing"){' +
    'noticeT.textContent="Uploads are not getting through";' +
    'noticeB.textContent="This app is registered and sharing is on, but the last batch of measurements did not reach Boosthis, so your dashboard is missing the most recent data."' +
    '+(FAILTXT[n.reason]?" "+FAILTXT[n.reason]+".":"")' +
    '+((typeof n.lost==="number"&&n.lost>0)?" Uploads lost: "+n.lost+".":"");' +
    'noticeEl.style.display="block";}' +
    'else{noticeEl.style.display="none";}' +
    "}catch(e){}}" +
    'var FAILTXT={unauthorized:"Refused \\u2014 credentials rejected",' +
    'rejected:"Refused \\u2014 batch rejected",' +
    '"server-error":"Boosthis failed to store it",' +
    'unreachable:"No answer \\u2014 timed out or unreachable"};' +
    // ---- Dropped-measurements line (fixed copy, under the banner) ----
    // The server can accept a batch and still refuse individual rows. The
    // closed /panel read carries only a count and code-defined cause markers;
    // every word below is a literal in this snippet, and the text matches the
    // project's web page so the two never tell different stories. Hidden
    // entirely when nothing has been dropped.
    'var dropEl=document.createElement("div");' +
    'dropEl.style.cssText="display:none;background:"+T.card+";border:1px solid "+COLORS["needs-work"]+";' +
    'border-radius:12px;padding:9px 12px;margin:0 0 10px;";' +
    'var dropT=document.createElement("div");' +
    'dropT.style.cssText="font-size:12px;font-weight:700;color:"+COLORS["needs-work"]+";";' +
    'dropT.textContent="Measurements dropped";' +
    'var dropB=document.createElement("div");' +
    'dropB.style.cssText="font-size:11px;line-height:1.45;color:"+T.fg+";margin-top:3px;";' +
    "dropEl.appendChild(dropT);dropEl.appendChild(dropB);" +
    "panel.appendChild(dropEl);" +
    'var DROPTXT={labelRejected:"route names the privacy guard refused",' +
    'traceCapReached:"spans past the 20-span limit",' +
    'snapshotEntryFiltered:"snapshot entries the privacy guard refused"};' +
    "function showDrops(d){try{" +
    'if(!d||typeof d.count!=="number"||d.count<=0){dropEl.style.display="none";return;}' +
    "var w=[];var cs=(d.causes&&d.causes.length)?d.causes:[];" +
    "for(var i=0;i<cs.length;i++){var t=DROPTXT[cs[i]];if(t)w.push(t);}" +
    'dropB.textContent=String(d.count)+(w.length?" \\u2014 "+w.join("; "):"");' +
    'dropEl.style.display="block";' +
    "}catch(e){}}" +
    // ROWS THIS KIT NEVER GOT OUT. Its own line, immediately below, because
    // the server refusing what we sent and us never sending it ask for
    // different fixes. Same rules: fixed copy, code-defined markers only,
    // hidden entirely when there is nothing to say.
    'var undEl=document.createElement("div");' +
    'undEl.style.cssText="display:none;margin-top:8px;padding:8px 10px;border-radius:8px;background:"+T.card+";border:1px solid "+COLORS.poor+";";' +
    'var undT=document.createElement("div");' +
    'undT.style.cssText="font-size:12px;font-weight:700;color:"+COLORS.poor+";";' +
    'undT.textContent="Measurements never delivered";' +
    'var undB=document.createElement("div");' +
    'undB.style.cssText="font-size:11px;line-height:1.45;color:"+T.fg+";margin-top:3px;";' +
    "undEl.appendChild(undT);undEl.appendChild(undB);" +
    "panel.appendChild(undEl);" +
    'var UNDTXT={bufferFull:"buffer full, oldest measurements dropped",' +
    'sendFailed:"an upload failed and its rows were already out of the buffer",' +
    'heldTooLong:"held too long without reaching Boosthis, then given up on",' +
    'processEnded:"the process ended with measurements still waiting"};' +
    "function showUndelivered(d){try{" +
    'if(!d||typeof d.count!=="number"||d.count<=0){undEl.style.display="none";return;}' +
    "var w=[];var cs=(d.causes&&d.causes.length)?d.causes:[];" +
    "for(var i=0;i<cs.length;i++){var t=UNDTXT[cs[i]];if(t)w.push(t);}" +
    'undB.textContent=String(d.count)+(w.length?" \\u2014 "+w.join("; "):"");' +
    'undEl.style.display="block";' +
    "}catch(e){}}" +
    "panel.appendChild(gateWrap);panel.appendChild(dashWrap);" +
    // ---- The GATE (port of the RN kit's BoosthisTermsGate) ----
    // Layout top→bottom: BOOSTHIS kicker · the connect card (moved here) ·
    // "Terms of Service & Privacy" heading + intro · body copy with a "Terms &
    // Privacy" link · agree checkbox · (needsConnect note) · "I Agree &
    // Continue" · "Decline". textContent-only writes; every path guarded.
    "var gateChecked=false;var gAgree=null,gNote=null,gCheckBox=null;" +
    "function gateMk(){try{" +
    "while(gateWrap.firstChild)gateWrap.removeChild(gateWrap.firstChild);" +
    'var kick=document.createElement("div");' +
    'kick.style.cssText="font-size:10px;font-weight:600;letter-spacing:2px;color:"+T.mut+";margin:2px 2px 10px;";' +
    'kick.textContent="BOOSTHIS";gateWrap.appendChild(kick);' +
    // Connect card at the top — the SAME acct node used on the dashboard.
    "gateWrap.appendChild(acct);" +
    'var gt=document.createElement("div");' +
    'gt.style.cssText="font-size:20px;font-weight:800;color:"+T.fg+";margin:4px 2px 0;line-height:1.2;";' +
    'gt.textContent="Terms of Service & Privacy";gateWrap.appendChild(gt);' +
    'var gi=document.createElement("div");' +
    'gi.style.cssText="font-size:11.5px;color:"+T.mut+";margin:3px 2px 8px;";' +
    'gi.textContent="Please review and accept before using Boosthis.";gateWrap.appendChild(gi);' +
    'var gb=document.createElement("div");' +
    'gb.style.cssText="font-size:11.5px;line-height:1.55;color:"+T.mut+";margin:0 2px 6px;";' +
    'gb.textContent="Everything \\u2014 liability, what Boosthis collects, AI suggestions, and project-key access \\u2014 lives on the Terms & Conditions page. Open it and read it, then tick the box below to agree.";' +
    "gateWrap.appendChild(gb);" +
    // Terms & Privacy link — same href logic as the dashboard footer link.
    'var gl=document.createElement("a");' +
    'gl.textContent="Terms & Privacy";gl.target="_blank";gl.rel="noopener";gl.href=terms.href;' +
    'gl.style.cssText="display:inline-block;color:"+T.pri+";font-size:11.5px;font-weight:600;text-decoration:underline;margin:0 2px 12px;";' +
    "gateWrap.appendChild(gl);" +
    // Checkbox row.
    'var crow=document.createElement("div");' +
    'crow.style.cssText="display:flex;align-items:flex-start;gap:9px;cursor:pointer;margin:0 2px 10px;";' +
    'gCheckBox=document.createElement("div");' +
    'gCheckBox.style.cssText="width:20px;height:20px;flex:0 0 20px;border-radius:5px;border:2px solid "+T.br+";display:flex;align-items:center;justify-content:center;box-sizing:border-box;";' +
    'var ck=document.createElement("span");ck.textContent="\\u2713";ck.style.cssText="color:"+T.bg+";font-size:13px;font-weight:700;line-height:1;display:none;";' +
    "gCheckBox.appendChild(ck);" +
    'var cl=document.createElement("span");' +
    'cl.style.cssText="font-size:11.5px;line-height:1.45;color:"+T.fg+";";' +
    'cl.textContent="I have read and agree to the Terms of Service & Privacy Policy.";' +
    "crow.appendChild(gCheckBox);crow.appendChild(cl);gateWrap.appendChild(crow);" +
    'crow.addEventListener("click",function(){try{gateChecked=!gateChecked;' +
    'gCheckBox.style.borderColor=gateChecked?T.pri:T.br;gCheckBox.style.background=gateChecked?T.pri:"transparent";' +
    'ck.style.display=gateChecked?"block":"none";gateSync();}catch(e){}});' +
    // needsConnect note (shown only when registered && !connected).
    'gNote=document.createElement("div");' +
    'gNote.style.cssText="display:none;font-size:11px;line-height:1.45;color:"+T.mut+";margin:0 2px 10px;";' +
    'gNote.textContent="Sign in above to connect this project to your dashboard before continuing.";' +
    "gateWrap.appendChild(gNote);" +
    // "I Agree & Continue" — disabled (muted, no-op) unless canAgree.
    'gAgree=document.createElement("button");gAgree.type="button";' +
    'gAgree.textContent="I Agree & Continue";' +
    'gAgree.style.cssText="width:100%;padding:11px 10px;font-size:13px;font-weight:700;border:none;border-radius:10px;cursor:pointer;font-family:inherit;";' +
    "gateWrap.appendChild(gAgree);" +
    'gAgree.addEventListener("click",function(){try{' +
    "if(!gateCanAgree())return;" +
    // Write acceptance (guarded), then reveal the dashboard forever.
    "termsWrite();gateSync();}catch(e){}});" +
    // "Decline" — closes the panel; nothing recorded.
    'var gd=document.createElement("button");gd.type="button";gd.textContent="Decline";' +
    'gd.style.cssText="width:100%;padding:8px 10px;margin-top:8px;font-size:12px;font-weight:600;background:transparent;color:"+T.mut+";border:none;cursor:pointer;font-family:inherit;";' +
    "gateWrap.appendChild(gd);" +
    'gd.addEventListener("click",function(){try{panel.style.display="none";}catch(e){}});' +
    "gateApply();" +
    "}catch(e){}}" +
    // registered := account context + installId + deleteToken all present.
    // connected := VERIFIED LINK (LINKED flag). needsConnect := registered &&
    // !connected. canAgree := checked && !needsConnect. Unregistered pages
    // (no account context) proceed on terms alone — never hard-locked.
    "function gateRegistered(){return !!(ACTX.available&&ACTX.endpoint&&ACTX.installId&&ACTX.deleteToken);}" +
    "function gateNeedsConnect(){return gateRegistered()&&!LINKED;}" +
    "function gateCanAgree(){return gateChecked&&!gateNeedsConnect();}" +
    // Reflect canAgree/needsConnect on the gate's controls without a rebuild.
    "function gateApply(){try{" +
    'if(gNote)gNote.style.display=gateNeedsConnect()?"block":"none";' +
    "if(gAgree){var ok=gateCanAgree();" +
    "gAgree.style.background=ok?T.pri:T.br;gAgree.style.color=ok?T.bg:T.mut;" +
    'gAgree.style.cursor=ok?"pointer":"default";}' +
    "}catch(e){}}" +
    // gateSync() = the single source of truth for gate-vs-dashboard visibility.
    // Called on open, on accept, and whenever LINKED/checkbox change. When
    // accepted it moves the acct node back to its dashboard slot (before lg).
    "var gateBuilt=false;" +
    "function gateSync(){try{" +
    "if(termsAccepted()){" +
    'gateWrap.style.display="none";dashWrap.style.display="block";' +
    "if(acct.parentNode!==dashWrap)dashWrap.insertBefore(acct,lg);" +
    "}else{" +
    "if(!gateBuilt){gateBuilt=true;gateMk();}else{" +
    "if(acct.parentNode!==gateWrap){var k=gateWrap.firstChild;" +
    "if(k&&k.nextSibling)gateWrap.insertBefore(acct,k.nextSibling);else gateWrap.appendChild(acct);}" +
    "gateApply();}" +
    'gateWrap.style.display="block";dashWrap.style.display="none";}' +
    "}catch(e){}}" +
    "var CORE={responsiveness:1,resilience:1,budget:1};" +
    "function axisRow(m){" +
    'var w=document.createElement("div");' +
    'w.style.cssText="padding:7px 0;border-bottom:1px solid "+T.br+";";' +
    'var top=document.createElement("div");' +
    'top.style.cssText="display:flex;justify-content:space-between;align-items:baseline;gap:8px;";' +
    'var l=document.createElement("span");' +
    'l.style.cssText="color:"+T.fg+";font-weight:600;font-size:12px;";l.textContent=String(m.label||m.key||"");' +
    "var rc=m.rating&&COLORS[m.rating]?COLORS[m.rating]:T.mut;" +
    'var c=document.createElement("span");' +
    'c.style.cssText="color:"+rc+";font-variant-numeric:tabular-nums;font-size:11px;text-align:right;";' +
    'c.textContent=String(m.caption||"");' +
    "top.appendChild(l);top.appendChild(c);" +
    'var bar=document.createElement("div");' +
    'bar.style.cssText="height:4px;border-radius:3px;background:"+T.br+";margin-top:5px;overflow:hidden;";' +
    'var fill=document.createElement("div");' +
    'var s=typeof m.score==="number"?Math.max(0,Math.min(100,m.score)):0;' +
    'fill.style.cssText="height:100%;border-radius:3px;width:"+s+"%;background:"+rc+";";' +
    "bar.appendChild(fill);w.appendChild(top);w.appendChild(bar);return w;}" +
    "function fillRows(box,list,empty){" +
    "while(box.firstChild)box.removeChild(box.firstChild);" +
    "if(list.length){for(var i=0;i<list.length;i++){var r=axisRow(list[i]);" +
    'if(i===list.length-1)r.style.borderBottom="none";box.appendChild(r);}}' +
    'else{var e=document.createElement("div");' +
    'e.style.cssText="padding:7px 0;color:"+T.mut+";";e.textContent=empty;box.appendChild(e);}}' +
    "function paint(p){try{" +
    // VAULT contract: a locked verdict swaps the panel to the blocking overlay
    // and stops here — the meters are never painted while locked, so there is
    // nothing behind the cover to read. A "hidden" kind (silent inert:
    // env-kill / tampered / grace-expired) hides the whole bubble instead.
    "if(p&&p.lock){" +
    'if(p.lock.kind==="hidden"){try{host.style.display="none";}catch(e){}return;}' +
    "showLock(p.lock);return;}" +
    // Not locked: ensure the overlay is down and the bubble is visible again
    // (a prior "hidden" verdict may have hidden the host; recovery restores it).
    "hideLock();" +
    'try{if(host.style.display==="none")host.style.display="";}catch(e){}' +
    // The reporting verdict is painted BEFORE the score, and sits above it in
    // the panel, because a screen of healthy numbers is exactly what makes a
    // silent install hard to notice.
    // Rejected registration (fixed copy, code-defined marker only).
    "showNotice(p&&p.notice);" +
    // Rows the server refused (fixed copy, code-defined markers only).
    "showDrops(p&&p.drops);" +
    // Rows we never got out (fixed copy, code-defined markers only).
    "showUndelivered(p&&p.undelivered);" +
    // WHICH PROJECT, in the developer's own words. Already spelled out by the
    // kit (name + short code, or the honest "not received yet" line), so the
    // panel only ever prints it.
    'try{hProj.textContent="' +
    PROJECT_LABEL +
    ': "+((p&&typeof p.project==="string"&&p.project)||"' +
    PROJECT_UNKNOWN_TEXT +
    '");}catch(e){}' +
    // WHICH INSTALL the verdict is about — the identity this kit is holding.
    'try{hInst.textContent="' +
    INSTALL_ID_LABEL +
    ': "+((p&&typeof p.installId==="string"&&p.installId)||"' +
    INSTALL_ID_UNKNOWN_TEXT +
    '");}catch(e){}' +
    "var c=p&&p.rating?COLORS[p.rating]||T.mut:T.mut;" +
    "btn.style.borderColor=c;" +
    'num.textContent=p&&typeof p.score==="number"?String(p.score):"\\u2013";' +
    "num.style.color=p&&p.rating?c:T.fg;" +
    'bTxt.textContent=p&&p.rating?(RL[p.rating]||"MEASURING"):"MEASURING";' +
    "bDot.style.background=p&&p.rating?c:T.mut;" +
    'badge.style.background=p&&p.rating?c+"1a":T.br;' +
    'badge.style.borderColor=p&&p.rating?c+"55":T.br;' +
    "badge.style.color=p&&p.rating?c:T.mut;" +
    'stat.textContent=p&&typeof p.score==="number"?String(p.sampleCount||0)+" requests measured":"' +
    MEASURING_HERO_TEXT +
    '";' +
    "var ax=(p&&p.axes)||[];var core=[],rest=[];" +
    "for(var i=0;i<ax.length;i++){(CORE[ax[i].key]?core:rest).push(ax[i]);}" +
    'fillRows(bdRows,core,"measuring\\u2026 appears after a few requests");' +
    'fillRows(hlRows,rest,"measuring\\u2026 appears with traffic");' +
    "}catch(e){}}" +
    "function poll(){try{" +
    'fetch("' +
    safePanel +
    '",{credentials:"omit"}).then(function(r){' +
    "return r.ok?r.json():null;}).then(paint).catch(function(){});}catch(e){}}" +
    'btn.addEventListener("click",function(){try{' +
    'var open=panel.style.display==="none";' +
    'panel.style.display=open?"block":"none";' +
    // On open: pick gate-vs-dashboard, then load the account context (needed on
    // BOTH surfaces — the connect card is on the gate too) and poll the meters.
    "if(open){gateSync();acctLoad();poll();}}catch(e){}});" +
    "panel.appendChild(lockEl);" +
    "root.appendChild(panel);root.appendChild(btn);" +
    "poll();setInterval(poll,2000);" +
    "function add(){try{(document.body||document.documentElement).appendChild(host);}catch(e){}}" +
    'if(document.body)add();else document.addEventListener("DOMContentLoaded",add);' +
    "}catch(e){}})();</script>\n"
  );
}

/** Hero subtitle for this runtime's panel — mirrors the RN kit's
 *  "React Native Performance" hero subtitle. */
const RUNTIME_PANEL_SUBTITLE = "Node.js Performance";

/** The default injected bubble script (default `/_boosthis` prefix). Kept as a
 *  named export for the middleware's default injection and for tests. */
export const BUBBLE_SNIPPET: string = bubbleSnippet(PULSE_PATH);

/** Insert the snippet immediately before the LAST </body> (case-insensitive).
 *  Returns null when no </body> exists — the caller must then serve the
 *  original bytes untouched. Pure; easy to test. */
export function injectIntoHtml(body: Buffer, snippet: string): Buffer | null {
  try {
    const text = body.toString("utf8");
    const idx = text.toLowerCase().lastIndexOf("</body>");
    if (idx === -1) return null;
    return Buffer.from(text.slice(0, idx) + snippet + text.slice(idx), "utf8");
  } catch {
    return null;
  }
}

interface InjectableRes {
  statusCode?: number;
  headersSent?: boolean;
  getHeader?: (name: string) => unknown;
  setHeader?: (name: string, value: string) => unknown;
  write?: (...args: unknown[]) => boolean;
  end?: (...args: unknown[]) => unknown;
}

function headerString(res: InjectableRes, name: string): string | undefined {
  try {
    const v = res.getHeader?.(name);
    if (v === undefined || v === null) return undefined;
    return String(v);
  } catch {
    return undefined;
  }
}

function isHtmlContentType(ct: string | undefined): boolean {
  return ct !== undefined && ct.toLowerCase().includes("text/html");
}

function toBuffer(
  chunk: unknown,
  encoding?: unknown,
): Buffer | null | undefined {
  if (chunk === undefined || chunk === null) return undefined;
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === "string") {
    try {
      return Buffer.from(
        chunk,
        typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8",
      );
    } catch {
      return null;
    }
  }
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return null; // unknown chunk type — give up on injection
}

function pickCallback(...args: unknown[]): (() => void) | undefined {
  for (const a of args) if (typeof a === "function") return a as () => void;
  return undefined;
}

/** An existing Vary header with `Cookie` added once. */
export function varyWithCookie(prior: string | undefined): string {
  const parts = (prior ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.includes("*") || parts.some((p) => p.toLowerCase() === "cookie")) {
    return parts.join(", ");
  }
  return [...parts, "Cookie"].join(", ");
}

/**
 * Wrap `res.write`/`res.end` so the bubble snippet is injected before the
 * closing </body> of eligible HTML responses. Fail-open by construction:
 *
 *  - buffers only up to {@link MAX_INJECT_BYTES}; past the cap the buffered
 *    bytes are flushed through the original write and injection is abandoned
 *  - injects only 2xx + text/html + no Content-Encoding + headers not yet
 *    sent + a real </body> present
 *  - recomputes Content-Length when it was set
 *  - ANY thrown error falls back to the original bytes
 */
export function wrapResponseForInjection(
  res: InjectableRes,
  snippet: string = BUBBLE_SNIPPET,
): void {
  if (typeof res.write !== "function" || typeof res.end !== "function") return;
  const origWrite = res.write.bind(res) as (...args: unknown[]) => boolean;
  const origEnd = res.end.bind(res) as (...args: unknown[]) => unknown;

  let chunks: Buffer[] | null = [];
  let size = 0;

  const giveUp = (): void => {
    if (!chunks) return;
    const buffered = chunks;
    chunks = null;
    for (const c of buffered) origWrite(c);
  };

  const stillEligibleMidStream = (): boolean => {
    const ct = headerString(res, "content-type");
    if (ct !== undefined && !isHtmlContentType(ct)) return false;
    if (headerString(res, "content-encoding") !== undefined) return false;
    return true;
  };

  res.write = function boosthisWrite(...args: unknown[]): boolean {
    try {
      if (!chunks) return origWrite(...args);
      if (!stillEligibleMidStream()) {
        giveUp();
        return origWrite(...args);
      }
      const [chunk, encoding] = args;
      const buf = toBuffer(chunk, encoding);
      if (buf === null) {
        giveUp();
        return origWrite(...args);
      }
      if (buf) {
        size += buf.length;
        if (size > MAX_INJECT_BYTES) {
          giveUp();
          return origWrite(...args);
        }
        chunks.push(buf);
      }
      const cb = pickCallback(...args.slice(1));
      if (cb) queueMicrotask(cb);
      return true;
    } catch {
      try {
        giveUp();
      } catch {
        /* swallow */
      }
      return origWrite(...args);
    }
  };

  res.end = function boosthisEnd(...args: unknown[]): unknown {
    try {
      if (!chunks) return origEnd(...args);
      const [chunk, encoding] = args;
      const buf = toBuffer(chunk, encoding);
      const cb = pickCallback(...args);
      if (buf === null) {
        giveUp();
        return origEnd(...args);
      }
      if (buf) {
        size += buf.length;
        chunks.push(buf);
      }
      const body = Buffer.concat(chunks);
      chunks = null;

      const status = res.statusCode ?? 200;
      const eligible =
        size <= MAX_INJECT_BYTES &&
        status >= 200 &&
        status < 300 &&
        res.headersSent !== true &&
        isHtmlContentType(headerString(res, "content-type")) &&
        headerString(res, "content-encoding") === undefined;

      let out: Buffer = body;
      if (eligible) {
        const injected = injectIntoHtml(body, snippet);
        if (injected) {
          out = injected;
          try {
            if (headerString(res, "content-length") !== undefined) {
              res.setHeader?.("content-length", String(out.length));
            }
          } catch {
            out = body; // cannot fix the length → serve original bytes
          }
          if (out !== body) {
            try {
              // A page carrying the owner's bubble is the owner's alone: no
              // shared cache may keep it for someone else.
              res.setHeader?.("cache-control", "private, no-store");
              res.setHeader?.("vary", varyWithCookie(headerString(res, "vary")));
            } catch {
              /* the in-page gate still keeps it from drawing for anyone else */
            }
          }
        }
      }
      return cb ? origEnd(out, cb) : origEnd(out);
    } catch {
      return origEnd(...args);
    }
  };
}

/** Test helper — nothing module-level to reset today; kept for parity with the
 *  web kit so future state has a sanctioned reset point. */
export function _resetBubbleForTests(): void {
  /* no module state yet */
}

/** The bubble's never-delivered line, or null when this process has lost
 *  nothing. Fail-safe: any error degrades to null. */
export function computePanelUndelivered(): PanelUndelivered | null {
  try {
    const count = getUndeliveredRowCount();
    if (count <= 0) return null;
    return { count, causes: getUndeliveredCauses() };
  } catch {
    return null;
  }
}

/** A millisecond figure at a precision that can tell a FAST app from a broken
 *  one. `Math.round` printed a sub-millisecond p75 as "0 ms p75" — the one
 *  figure a back-end developer looks at, reading as if nothing had been
 *  measured — in the same panel that prints "p99 0.16ms" for scheduler
 *  latency. One helper, so the copies of this formatting cannot drift. */
function panelMsText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0";
  if (ms >= 100) return String(Math.round(ms));
  if (ms >= 10) return String(Math.round(ms * 10) / 10);
  const rounded = Math.round(ms * 100) / 100;
  // Real, and smaller than the precision printed here. A "0" would be the
  // same untruth one decimal place further down.
  return rounded === 0 ? "<0.01" : String(rounded);
}

/** A duration this kit STORED as whole milliseconds. Requests and outbound
 *  attempts are both recorded rounded, so a genuinely fast app's p75 or worst
 *  window arrives as a real zero — and "0 ms p75" beside "good" reads as
 *  nothing measured. The store cannot say WHICH fraction it was, so the
 *  caption says the most it honestly can, from one helper, on every latency
 *  row that prints one. */
function panelStoredMsText(ms: number): string {
  return Number.isFinite(ms) && ms > 0 ? `${panelMsText(ms)} ms` : "<1 ms";
}
