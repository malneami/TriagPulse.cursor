/**
 * WHERE THIS PROJECT RUNS — recognition, not guesswork.
 *
 * Every hosting platform publishes something about itself to the code running
 * on it, and most publish a region and an environment with it. This module
 * reads only those declarations and turns them into three words from three
 * fixed lists.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 *   - It reads no other configuration and sends none. The markers below are
 *     the only variables it looks at, and it sends the WORD it recognised,
 *     never the value it read. Nothing free-form leaves the process.
 *   - It never guesses a host from a similar one. Something unfamiliar
 *     declaring itself answers "unrecognised", which is a real answer, and an
 *     honest one.
 *   - It never reads an environment as "production" on a hunch. A preview's
 *     numbers being mistaken for the real app's is precisely what this exists
 *     to prevent, so a host that declares nothing answers "unknown".
 *
 * KEEP IN LOCKSTEP with the closed lists in
 * artifacts/api-server/src/lib/hostingPlatforms.ts — the server checks every
 * arriving word against them and stores anything it does not hold as
 * "unrecognised". A guard test on the server side fails if the two drift.
 */

/** Read one environment variable. Never throws — a frozen or proxied
 *  `process.env` (some sandboxes) must not take a host's app down. */
const env = (name: string): string => {
  try {
    const v = process.env[name];
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
};

export interface HostingFacts {
  /** A word from the server's closed platform list, "unrecognised", or
   *  "undeclared" when nothing published a host. */
  platform: string;
  /** The region code the platform declares, or "undeclared". */
  region: string;
  /** "production" | "preview" | "development" | "unknown". */
  environment: string;
  /**
   * The operating-system FAMILY this process runs on — "linux", "macos",
   * "windows" or "other" — from the server's closed list (osFamilies.ts).
   * Never a version or a machine name. Sent beside the platform, because the
   * same platform word can mean different rules on different systems.
   */
  os?: string;
}

/** The operating-system family, from the runtime's own word. Never throws:
 *  an unreadable answer is "other", never a guess at "linux". */
export function osFamily(platform: unknown = readPlatform()): string {
  switch (platform) {
    case "linux":
      return "linux";
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "other";
  }
}

function readPlatform(): unknown {
  try {
    return process.platform;
  } catch {
    return undefined;
  }
}

/** Nothing published a host: a laptop, a plain virtual machine, a server
 *  somebody owns. A real answer, not a blank. */
const NOTHING_DECLARED: HostingFacts = {
  platform: "undeclared",
  region: "undeclared",
  environment: "unknown",
};

/** Vercel's own word for the deployment, straight through — production /
 *  preview / development are exactly the three it publishes. */
function vercelEnvironment(): string {
  const v = env("VERCEL_ENV").toLowerCase();
  if (v === "production" || v === "preview" || v === "development") return v;
  return "unknown";
}

/** Netlify publishes a build CONTEXT. Deploy previews and branch deploys are
 *  both previews; its "dev" is a local run, which is development, not a
 *  preview — mapping it to "preview" would be the guess this avoids. */
function netlifyEnvironment(): string {
  const c = env("CONTEXT").toLowerCase();
  if (c === "production") return "production";
  if (c === "deploy-preview" || c === "branch-deploy") return "preview";
  if (c === "dev") return "development";
  return "unknown";
}

/**
 * Recognise the platform, its region and its environment from what the
 * platform publishes about itself. Pure, cheap, and never throws.
 *
 * ORDER MATTERS. Several of these hosts run ON another one and set its
 * markers too: Vercel's Node functions run on Lambda, Netlify's do too, and
 * Google's Cloud Functions run on the same container service as Cloud Run. The
 * more specific host is tested first every time, or a Vercel project would
 * file itself as raw AWS.
 */
export function detectHosting(): HostingFacts {
  try {
    // ── Function hosts ──

    // Vercel before Lambda: its functions carry the Lambda markers as well.
    if (env("VERCEL") === "1" || env("VERCEL_ENV")) {
      return {
        platform: "vercel",
        region: env("VERCEL_REGION") || "undeclared",
        environment: vercelEnvironment(),
      };
    }

    // Netlify before Lambda, for the same reason.
    if (env("NETLIFY") === "true" || env("NETLIFY_LOCAL") || env("SITE_ID")) {
      return {
        platform: "netlify",
        region: env("AWS_REGION") || "undeclared",
        environment: netlifyEnvironment(),
      };
    }

    if (env("AWS_LAMBDA_FUNCTION_NAME")) {
      return {
        platform: "aws-lambda",
        region: env("AWS_REGION") || env("AWS_DEFAULT_REGION") || "undeclared",
        // Lambda has no environment concept of its own — a stage lives in the
        // function name, which we neither read nor send. "unknown" is the
        // honest answer; calling every Lambda "production" would be a guess.
        environment: "unknown",
      };
    }

    // Google Cloud Functions before Cloud Run: a function sets BOTH the
    // function marker and Cloud Run's service marker.
    if (env("FUNCTION_TARGET")) {
      return {
        platform: "gcp-functions",
        region: env("FUNCTION_REGION") || "undeclared",
        environment: "unknown",
      };
    }

    // Azure Functions before App Service, same overlap.
    if (env("FUNCTIONS_WORKER_RUNTIME")) {
      return {
        platform: "azure-functions",
        region: env("REGION_NAME") || "undeclared",
        environment: "unknown",
      };
    }

    // ── Long-running container and application hosts ──

    if (env("K_SERVICE")) {
      return {
        platform: "cloud-run",
        // Cloud Run publishes its region only through its metadata service,
        // which is a network call this must never make. Undeclared it is.
        region: "undeclared",
        environment: "unknown",
      };
    }

    if (env("WEBSITE_SITE_NAME")) {
      return {
        platform: "azure-app-service",
        region: env("REGION_NAME") || "undeclared",
        environment: "unknown",
      };
    }

    if (env("FLY_APP_NAME")) {
      return {
        platform: "fly-io",
        region: env("FLY_REGION") || "undeclared",
        environment: "unknown",
      };
    }

    if (env("RENDER") === "true" || env("RENDER_SERVICE_ID")) {
      return {
        platform: "render",
        region: "undeclared",
        // Render's own marker for a pull-request preview service. Absent means
        // an ordinary service, which Render only ever runs as production.
        environment: env("IS_PULL_REQUEST") === "true" ? "preview" : "production",
      };
    }

    if (env("RAILWAY_ENVIRONMENT") || env("RAILWAY_PROJECT_ID")) {
      // Railway lets a project have any number of named environments and calls
      // the live one "production". Every other name is one of the throwaway
      // environments people spin up per branch, so it reads as a preview —
      // never silently as production.
      const named = (
        env("RAILWAY_ENVIRONMENT_NAME") || env("RAILWAY_ENVIRONMENT")
      ).toLowerCase();
      return {
        platform: "railway",
        region: env("RAILWAY_REPLICA_REGION") || "undeclared",
        environment: !named
          ? "unknown"
          : named === "production"
            ? "production"
            : "preview",
      };
    }

    if (env("KOYEB_APP_NAME")) {
      return {
        platform: "koyeb",
        region: env("KOYEB_REGION") || "undeclared",
        environment: "unknown",
      };
    }

    if (env("REPL_ID") || env("REPLIT_DEPLOYMENT")) {
      return {
        platform: "replit",
        region: "undeclared",
        // Replit publishes exactly this distinction: a published app sets the
        // marker, the workspace copy does not. The workspace copy is a
        // development run, not a preview of one.
        environment: env("REPLIT_DEPLOYMENT") === "1" ? "production" : "development",
      };
    }

    // ECS before Heroku and Kubernetes: a container on Fargate can carry a
    // scheduler's markers too, and its own is the specific one.
    if (env("ECS_CONTAINER_METADATA_URI_V4") || env("ECS_CONTAINER_METADATA_URI")) {
      return {
        platform: "aws-ecs",
        region: env("AWS_REGION") || env("AWS_DEFAULT_REGION") || "undeclared",
        environment: "unknown",
      };
    }

    if (env("DYNO")) {
      return {
        platform: "heroku",
        region: "undeclared",
        environment: "unknown",
      };
    }

    // Last of the recognised hosts on purpose. Kubernetes is underneath a
    // great many of the platforms above, so it is only the answer once none of
    // them has claimed the process — and it is a genuine answer: we know it is
    // a cluster, and we deliberately do not guess which cloud is under it.
    if (env("KUBERNETES_SERVICE_HOST")) {
      return {
        platform: "kubernetes",
        region: "undeclared",
        environment: "unknown",
      };
    }

    return NOTHING_DECLARED;
  } catch {
    // Reading the environment is the only thing that can fail here, and a
    // project's readings must never be lost over a question about where it
    // runs. Answer "we could not tell" and carry on.
    return NOTHING_DECLARED;
  }
}

let cached: HostingFacts | null = null;

/**
 * The detection, read once per process.
 *
 * Caching is safe and correct here: a process cannot move between platforms
 * while it is running. A project that MOVES gets a new process, which detects
 * afresh and re-registers, which is exactly how the record stops describing
 * where the project used to run.
 */
export function hostingFacts(): HostingFacts {
  if (cached === null) cached = { ...detectHosting(), os: osFamily() };
  return cached;
}

/** Test seam. Never called in production. */
export function resetHostingCacheForTests(): void {
  cached = null;
}

/**
 * Plain-English names for the hosts this kit can recognise, for the kit's OWN
 * status page — the one Boosthis surface that is served from inside the
 * developer's app and cannot ask our server for anything.
 *
 * Every entry here must be spelt exactly as the server spells it. That is not
 * a convention: a guard test on the server side (hostingPlatforms.test.ts)
 * fails the build if this map and the server's disagree by so much as a
 * capital letter, so a developer can never read two different names for the
 * same host on two Boosthis screens.
 */
export const HOSTING_LABELS: Readonly<Record<string, string>> = {
  vercel: "Vercel Functions",
  "aws-lambda": "AWS Lambda",
  netlify: "Netlify Functions",
  "gcp-functions": "Google Cloud Functions",
  "azure-functions": "Azure Functions",
  "cloud-run": "Google Cloud Run",
  "azure-app-service": "Azure App Service",
  "aws-ecs": "AWS ECS",
  "fly-io": "Fly.io",
  render: "Render",
  railway: "Railway",
  heroku: "Heroku",
  replit: "Replit",
  koyeb: "Koyeb",
  kubernetes: "Kubernetes",
  unrecognised: "Unrecognised host",
  undeclared: "No hosting platform declared",
};

const ENVIRONMENT_LABELS: Readonly<Record<string, string>> = {
  production: "Production",
  preview: "Preview",
  development: "Development",
  unknown: "Environment not declared",
};

/**
 * "Vercel Functions · Preview · iad1" — one line for the kit's status page.
 *
 * Composed the same way the dashboard composes it: the environment appears
 * only when it says something, so a preview stands out instead of being lost
 * in a row of "not declared" on every healthy install.
 */
export function hostingLine(facts: HostingFacts = hostingFacts()): string {
  const platform = HOSTING_LABELS[facts.platform] ?? HOSTING_LABELS.unrecognised!;
  const parts = [platform];
  if (facts.environment === "preview" || facts.environment === "development") {
    parts.push(ENVIRONMENT_LABELS[facts.environment]!);
  }
  if (facts.region && facts.region !== "undeclared") parts.push(facts.region);
  return parts.join(" · ");
}
