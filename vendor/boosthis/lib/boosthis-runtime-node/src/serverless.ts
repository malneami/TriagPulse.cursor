/** Serverless hosting: is this a function, which platform, and who is it?
 *
 * Every other Node deployment gives the kit a process to hang measurement off:
 * it registers once, buffers in memory, and uploads on a timer. A function has
 * none of that. The invocation is frozen the moment it answers, so timers never
 * fire; there is no writable home directory; and "start-up" happens on every
 * cold start.
 *
 * This module answers the three questions everything else in the serverless
 * path depends on, and NOTHING else (no network, no timers, no state beyond a
 * frozen first read):
 *
 *   1. Are we inside a function, and on which platform?
 *   2. Have we PROVEN that platform? An unproven one is refused with a plain
 *      reason rather than pretended to work.
 *   3. What is this project's identity here — one identity for the whole
 *      project, derived so that every cold start of every instance arrives at
 *      the SAME install id without anything writable to remember it in.
 *
 * The derivation is the load-bearing part. A function that minted a random
 * install id per cold start would create thousands of siblings under one
 * project key (the server deliberately does not merge installs that share a
 * key), so the id is a pure function of:
 *
 *     project key  ×  platform  ×  the platform's own project scope
 *
 * The project key is a secret only the project's owner holds, so nobody else
 * can derive — or guess — the id. The server holds the same three inputs at
 * registration, so it can recompute the id and refuse anything that does not
 * match: the identity is verifiable, not merely asserted.
 */

import { createHash } from "node:crypto";

/* ─── The closed platform vocabulary ──────────────────────────────────── */

/** Numeric platform codes. Kits send the CODE; every human-readable name is
 *  server-owned (a text slot on the wire is a route for a customer's data onto
 *  our pages). Codes are permanent — never renumber one. */
export const PLATFORM_UNKNOWN = 0 as const;
export const PLATFORM_VERCEL = 1 as const;
export const PLATFORM_AWS_LAMBDA = 2 as const;
export const PLATFORM_NETLIFY = 3 as const;
export const PLATFORM_GCP_FUNCTIONS = 4 as const;
export const PLATFORM_AZURE_FUNCTIONS = 5 as const;
/** The always-on look-alikes: a container that keeps its process between
 *  requests but has its PROCESSOR frozen the moment it answers, unless the
 *  customer pays to keep it awake. Not functions — identity, registration and
 *  lifecycle stay exactly as they are for a long-running server — but billed
 *  and frozen like one, which is why they carry a code of their own. */
export const PLATFORM_CLOUD_RUN = 6 as const;
export const PLATFORM_FIREBASE_APP_HOSTING = 7 as const;
/** Isolate runtimes. This kit never boots there; the codes exist so the shared
 *  platform-capability table has a row for them and the server can word what
 *  is knowable where, rather than two tables drifting apart. */
export const PLATFORM_CLOUDFLARE_WORKERS = 8 as const;
export const PLATFORM_SUPABASE_EDGE = 9 as const;

export type PlatformCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Kit-side names. The DASHBOARD never renders these — it maps the numeric
 *  code itself — but the kit's own stderr line, in-app page and status page do,
 *  and those are kit-owned surfaces. */
const PLATFORM_NAMES: Record<PlatformCode, string> = {
  [PLATFORM_UNKNOWN]: "an unrecognised function host",
  [PLATFORM_VERCEL]: "Vercel Functions",
  [PLATFORM_AWS_LAMBDA]: "AWS Lambda",
  [PLATFORM_NETLIFY]: "Netlify Functions",
  [PLATFORM_GCP_FUNCTIONS]: "Google Cloud Functions",
  [PLATFORM_AZURE_FUNCTIONS]: "Azure Functions",
  [PLATFORM_CLOUD_RUN]: "Google Cloud Run",
  [PLATFORM_FIREBASE_APP_HOSTING]: "Firebase App Hosting",
  [PLATFORM_CLOUDFLARE_WORKERS]: "Cloudflare Workers",
  [PLATFORM_SUPABASE_EDGE]: "Supabase Edge Functions",
};

export function platformName(code: PlatformCode): string {
  return PLATFORM_NAMES[code] ?? PLATFORM_NAMES[PLATFORM_UNKNOWN];
}

/**
 * The platforms this kit has been PROVEN on, end to end, against the real API.
 *
 * Proof means: a function-shaped run on that platform's runtime contract
 * registered, measured, flushed inside the invocation, and had its rows stored
 * — including a run deliberately taken to its time limit. The records live in
 * `scripts/live-proofs/serverless-*` and the release gate refuses a platform
 * listed here without one.
 *
 * A platform absent from this list is REFUSED at start-up with a plain reason.
 * That is the whole point: half-working measurement on an unproven host is our
 * worst failure mode, because the panel renders and the customer believes they
 * are measured.
 */
export const PROVEN_PLATFORMS: readonly PlatformCode[] = [
  PLATFORM_VERCEL,
  PLATFORM_AWS_LAMBDA,
];

export function isProvenPlatform(code: PlatformCode): boolean {
  return PROVEN_PLATFORMS.includes(code);
}

/**
 * The function hosts detection can NAME, from the environment markers below.
 *
 * The refusal is only ever as wide as this list, and saying otherwise is the
 * exact over-promise this kit exists to avoid: on a function host with no
 * marker here, `detectServerlessHost()` answers `serverless: false`, the kit
 * starts as if it were an ordinary Node process, and NOTHING refuses. Surfaces
 * that describe the refusal derive the list from here so they cannot claim a
 * host the detector has never heard of.
 *
 * A developer who knows they are on such a host can say so with
 * `BOOSTHIS_SERVERLESS=1`, which is honoured below and produces the refusal.
 */
export const RECOGNISED_FUNCTION_PLATFORMS: readonly PlatformCode[] = [
  PLATFORM_VERCEL,
  PLATFORM_AWS_LAMBDA,
  PLATFORM_NETLIFY,
  PLATFORM_GCP_FUNCTIONS,
  PLATFORM_AZURE_FUNCTIONS,
];

/** The function hosts we can name AND have not proven — the ones the kit
 *  refuses by name. Derived, so adding a platform to either list above moves
 *  every sentence that lists them. */
export function recognisedUnprovenFunctionPlatforms(): PlatformCode[] {
  return RECOGNISED_FUNCTION_PLATFORMS.filter((code) => !isProvenPlatform(code));
}

/* ─── Detection ───────────────────────────────────────────────────────── */

export interface ServerlessHost {
  /** True when this process is a short-lived function invocation. */
  readonly serverless: boolean;
  readonly platform: PlatformCode;
  /** Have we proven this platform? False ⇒ the kit refuses to start here. */
  readonly proven: boolean;
  /** The platform's own stable name for THIS project (never a per-deploy id).
   *  Empty when the platform gave us nothing stable to key on. */
  readonly scope: string;
  /** Deployment environment (production / preview / …) folded into identity so
   *  a preview's numbers never land on the production project. */
  readonly environment: string;
  /** Configured memory ceiling in MB, when the platform states one. */
  readonly memoryLimitMb: number | null;
  /** Region label, when the platform states one. Never uploaded — only used to
   *  keep two regions of one project from being told apart by accident. */
  readonly region: string;
  /**
   * The always-on look-alike. True on a host whose process survives between
   * requests but whose PROCESSOR is frozen the moment it answers.
   *
   * Deliberately separate from `serverless`. Flipping one of these hosts into
   * function mode would re-derive its install identity and split every
   * existing Cloud Run project in two, so identity, registration and the
   * scoring model stay exactly as they are. Only the two things the freeze
   * really breaks change: measurements are sent BEFORE the response completes
   * instead of on a timer that will never fire, and the cost readings are
   * taken, because these hosts are billed per request-second like a function.
   *
   * Shape alone is not proof — a customer paying for always-on CPU is not
   * frozen at all. This flag says "shaped like one"; whether a freeze has
   * actually been WITNESSED is a separate question the suspend sensor answers.
   */
  readonly frozenBetweenRequests: boolean;
}

const env = (name: string): string => {
  try {
    const v = process.env[name];
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
};

const num = (name: string): number | null => {
  const raw = env(name);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/** Detect the function host from the environment alone. Pure; never throws. */
export function detectServerlessHost(): ServerlessHost {
  const none: ServerlessHost = {
    serverless: false,
    platform: PLATFORM_UNKNOWN,
    proven: false,
    scope: "",
    environment: "",
    memoryLimitMb: null,
    region: "",
    frozenBetweenRequests: false,
  };
  try {
    // An explicit opt-out always wins: a customer running a long-lived process
    // on a platform we misread must be able to say so.
    if (env("BOOSTHIS_SERVERLESS") === "0") return none;

    const lambdaMemory = num("AWS_LAMBDA_FUNCTION_MEMORY_SIZE");

    // Vercel first: its Node functions run ON Lambda, so the Lambda markers are
    // present too and the more specific host must win.
    if (env("VERCEL") === "1" || env("VERCEL_ENV")) {
      return {
        serverless: true,
        platform: PLATFORM_VERCEL,
        proven: isProvenPlatform(PLATFORM_VERCEL),
        // VERCEL_PROJECT_ID when the project exposes it, else the production
        // domain, else the git repo. All three are stable ACROSS deploys —
        // VERCEL_URL and VERCEL_DEPLOYMENT_ID deliberately are not, because
        // keying on them would mint a new install on every publish.
        scope:
          env("VERCEL_PROJECT_ID") ||
          env("VERCEL_PROJECT_PRODUCTION_URL") ||
          `${env("VERCEL_GIT_REPO_OWNER")}/${env("VERCEL_GIT_REPO_SLUG")}`,
        environment: env("VERCEL_ENV") || "production",
        memoryLimitMb: lambdaMemory,
        region: env("VERCEL_REGION"),
        frozenBetweenRequests: false,
      };
    }

    // Netlify's Node functions also run on Lambda — same reasoning.
    if (env("NETLIFY") === "true" || env("NETLIFY_LOCAL") || env("SITE_ID")) {
      if (env("NETLIFY") === "true" || env("SITE_ID")) {
        return {
          serverless: true,
          platform: PLATFORM_NETLIFY,
          proven: isProvenPlatform(PLATFORM_NETLIFY),
          scope: env("SITE_ID") || env("SITE_NAME"),
          environment: env("CONTEXT") || "production",
          memoryLimitMb: lambdaMemory,
          region: env("AWS_REGION"),
          frozenBetweenRequests: false,
        };
      }
    }

    if (env("AWS_LAMBDA_FUNCTION_NAME")) {
      return {
        serverless: true,
        platform: PLATFORM_AWS_LAMBDA,
        proven: isProvenPlatform(PLATFORM_AWS_LAMBDA),
        // The function name is stable across cold starts, versions and aliases.
        scope: env("AWS_LAMBDA_FUNCTION_NAME"),
        // Lambda has no environment concept of its own — a stage lives in the
        // function name — so every Lambda install shares one environment label.
        environment: "production",
        memoryLimitMb: lambdaMemory,
        region: env("AWS_REGION") || env("AWS_DEFAULT_REGION"),
        frozenBetweenRequests: false,
      };
    }

    // Google: FUNCTION_TARGET is set for functions; K_SERVICE alone is Cloud
    // Run, which is a long-lived container and must keep today's behaviour.
    if (env("FUNCTION_TARGET")) {
      return {
        serverless: true,
        platform: PLATFORM_GCP_FUNCTIONS,
        proven: isProvenPlatform(PLATFORM_GCP_FUNCTIONS),
        scope: `${env("GOOGLE_CLOUD_PROJECT") || env("GCP_PROJECT")}/${env("K_SERVICE") || env("FUNCTION_TARGET")}`,
        environment: "production",
        memoryLimitMb: num("FUNCTION_MEMORY_MB"),
        region: env("FUNCTION_REGION"),
        frozenBetweenRequests: false,
      };
    }

    if (env("FUNCTIONS_WORKER_RUNTIME")) {
      return {
        serverless: true,
        platform: PLATFORM_AZURE_FUNCTIONS,
        proven: isProvenPlatform(PLATFORM_AZURE_FUNCTIONS),
        scope: env("WEBSITE_SITE_NAME"),
        environment: env("AZURE_FUNCTIONS_ENVIRONMENT") || "production",
        memoryLimitMb: null,
        region: env("REGION_NAME"),
        frozenBetweenRequests: false,
      };
    }

    // ── The always-on look-alikes ──────────────────────────────────────────
    // Reached only after every function check above has declined, so a Google
    // FUNCTION_TARGET still wins and nothing that is a function is reclassified
    // here. `serverless` stays FALSE on purpose: these processes really do
    // survive between requests, so their identity, registration and lifecycle
    // must not change. What changes is that they are billed per request-second
    // and frozen when they answer, which the cost readings need to know.
    if (env("FIREBASE_APP_HOSTING") === "1" || env("FIREBASE_CONFIG")) {
      if (env("K_SERVICE")) {
        return {
          serverless: false,
          platform: PLATFORM_FIREBASE_APP_HOSTING,
          proven: true,
          scope: `${env("GOOGLE_CLOUD_PROJECT") || env("GCP_PROJECT")}/${env("K_SERVICE")}`,
          environment: "production",
          memoryLimitMb: null,
          region: env("GOOGLE_CLOUD_REGION") || env("FUNCTION_REGION"),
          frozenBetweenRequests: true,
        };
      }
    }

    if (env("K_SERVICE")) {
      return {
        serverless: false,
        platform: PLATFORM_CLOUD_RUN,
        proven: true,
        scope: `${env("GOOGLE_CLOUD_PROJECT") || env("GCP_PROJECT")}/${env("K_SERVICE")}`,
        environment: "production",
        memoryLimitMb: null,
        region: env("GOOGLE_CLOUD_REGION"),
        frozenBetweenRequests: true,
      };
    }

    // ── Told, rather than detected ────────────────────────────────────────
    // Last, so every host we CAN name still wins and is refused by its own
    // name. A function host we cannot name is otherwise indistinguishable
    // from an ordinary Node process: no marker, no detection, no refusal —
    // the install registers, draws its panel and reports almost nothing.
    // This is the developer's way to say "it is one anyway", and the answer
    // is the same refusal an unproven named host gets.
    if (env("BOOSTHIS_SERVERLESS") === "1") {
      return {
        serverless: true,
        platform: PLATFORM_UNKNOWN,
        proven: false,
        scope: "",
        environment: "",
        memoryLimitMb: null,
        region: "",
        frozenBetweenRequests: false,
      };
    }

    return none;
  } catch {
    return none;
  }
}

/* ─── The frozen read ─────────────────────────────────────────────────── */

let cached: ServerlessHost | null = null;

/** The host, read ONCE and frozen. Everything downstream reads this, so the
 *  answer can never change halfway through a process's life. */
export function serverlessHost(): ServerlessHost {
  if (cached === null) cached = detectServerlessHost();
  return cached;
}

/** True when the kit should run its per-invocation lifecycle instead of the
 *  long-running one. A detected-but-unproven platform is NOT serverless mode —
 *  it is a refusal (see `serverlessRefusal`). */
export function isServerlessMode(): boolean {
  const h = serverlessHost();
  return h.serverless && h.proven;
}

/**
 * True on an always-on look-alike: a host whose process survives but whose
 * processor is frozen between requests.
 *
 * NOT serverless mode. Nothing about identity, registration or scoring changes
 * here — this answers only "does the freeze-shaped delivery and the cost
 * reading apply", and both of those are true of a container billed per
 * request-second whose CPU stops when it answers.
 */
export function isFrozenBetweenRequests(): boolean {
  const h = serverlessHost();
  return h.frozenBetweenRequests && !h.serverless;
}

/** True when the per-run cost readings apply at all: a real function, or a
 *  container billed and frozen like one. The single question every cost
 *  collector asks before taking a reading. */
export function isPerRunBilled(): boolean {
  return isServerlessMode() || isFrozenBetweenRequests();
}

/**
 * True where the per-run readings BELONG, whether or not the kit runs its
 * per-invocation lifecycle there.
 *
 * Deliberately wider than {@link isPerRunBilled}: a function host we have not
 * proven still gets its section, and every reading in it abstains with a named
 * reason. Silence would say "this is an ordinary long-running server", which is
 * the one thing it is not — while the readings that need the lifecycle running
 * to produce a number ask the narrower question, rather than warming up forever
 * on a host where nothing will ever fill them in.
 */
export function hasPerRunCostReadings(): boolean {
  const h = serverlessHost();
  return h.serverless || h.frozenBetweenRequests;
}

/** The plain reason to refuse, or null when there is nothing to refuse. A
 *  function host we can NAME but have not proven gets a named refusal; it never
 *  gets a half-working install. A host with no marker of its own never reaches
 *  this path on its own — `BOOSTHIS_SERVERLESS=1` is what brings it here. */
export function serverlessRefusal(): string | null {
  const h = serverlessHost();
  if (!h.serverless || h.proven) return null;
  return (
    `Boosthis does not start on ${platformName(h.platform)} yet. ` +
    `Measuring from short-lived functions needs work we have proven on that ` +
    `platform, and we have not proven this one — so the kit stops here rather ` +
    `than register an install that would report almost nothing. ` +
    `Ask us to add it at support@boosthis.com, naming the host; nothing else ` +
    `in your app is affected.`
  );
}

/* ─── Identity ────────────────────────────────────────────────────────── */

const IDENTITY_NAMESPACE = "boosthis-serverless-install-v1";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** The hashed platform scope. The raw scope can be a site name a developer
 *  chose, so only its digest ever leaves the process; the server stores the
 *  digest and recomputes the identity from it. */
export function scopeHashFor(host: ServerlessHost): string {
  const material = `${host.platform}|${host.scope}|${host.environment}`;
  return sha256Hex(material).slice(0, 32);
}

/**
 * Derive this project's install id on this platform.
 *
 * Deterministic: the same project key, on the same platform, in the same
 * project scope, always lands on the same id — so a thousand cold starts are
 * one install. Unguessable: the project key is an input, and it is a secret.
 * Verifiable: the server holds the same inputs and recomputes it.
 *
 * The output is formatted as a version-5 UUID (name-based, which is exactly
 * what it is) so it passes the same shape check as every other install id.
 */
export function deriveServerlessInstallId(
  projectKey: string,
  host: ServerlessHost,
): string | null {
  try {
    if (!projectKey) return null;
    // Nothing stable to key on ⇒ no derivation. Better to refuse than to mint
    // an id that changes when the platform changes its mind.
    if (!host.scope || host.scope === "/" || host.scope === "undefined") {
      return null;
    }
    const h = sha256Hex(
      `${IDENTITY_NAMESPACE}|${projectKey}|${host.platform}|${scopeHashFor(host)}`,
    );
    // RFC-shaped: version nibble 5 (name-based), variant bits 10xx.
    const variant = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
    return (
      `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-` +
      `${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
    );
  } catch {
    return null;
  }
}

/** Test seam — drop the frozen read so a test can re-detect. */
export function _resetServerlessForTests(): void {
  cached = null;
}
