/* ─── Boosthis: what KIND of dependency a destination is (Node) ──────────
 *
 * WHY THIS EXISTS
 * A distance reading is only useful if it can say WHICH dependency is far
 * away: "your database is 90 ms away" is actionable, "the network is 90 ms
 * away" is not. This module turns a bare hostname into one of a handful of
 * CODES — never a name, never a label built from the address.
 *
 * PRIVACY CONTRACT (the whole point of this file)
 * The hostname is matched against closed, vendor-owned tables that live in
 * source, and the matched INPUT is thrown away: only our own small integer
 * leaves. There is no code path that copies a byte of the address into the
 * result. A host we do not recognise is `other` — never a derived string.
 *
 * The vocabulary is CLOSED and mirrored on the server (pii.ts), which rejects
 * any code outside it, and in the browser kit, which uses the same numbers for
 * the same things.
 */

import { isHostedDatabaseCall } from "./dbWork";
import { aiProviderCode } from "./aiProviders";

/** Nothing decided (never emitted on the wire as a row). */
export const DEP_KIND_UNKNOWN = 0;
/** The app's own backend. Browser-only — a server IS the backend. */
export const DEP_KIND_OWN_BACKEND = 1;
/** A database reached over the web (Supabase, Neon, Turso, Firestore, …). */
export const DEP_KIND_DATABASE = 2;
/** A model provider (OpenAI, Anthropic, Gemini, Bedrock, …). */
export const DEP_KIND_AI = 3;
/** Object/file storage (S3, R2, GCS, Azure Blob, Cloudinary, …). */
export const DEP_KIND_STORAGE = 4;
/** A payments processor (Stripe, Moyasar, PayPal, Checkout, …). */
export const DEP_KIND_PAYMENTS = 5;
/** A recognised outbound destination that is none of the above. */
export const DEP_KIND_OTHER = 6;

/** Highest code this vocabulary can ever emit (the server bounds-checks it). */
export const DEP_KIND_MAX = 6;

/** Storage data planes. Vendor-owned names only — never a generic API host. */
const STORAGE_HOST_SUFFIXES: readonly string[] = [
  ".r2.cloudflarestorage.com",
  ".blob.core.windows.net",
  "storage.googleapis.com",
  ".storage.googleapis.com",
  "api.cloudinary.com",
  "res.cloudinary.com",
  ".digitaloceanspaces.com",
  ".backblazeb2.com",
  ".wasabisys.com",
  "api.uploadthing.com",
  ".uploadthing.com",
  "api.bunny.net",
  ".b-cdn.net",
];

/** AWS shares one apex across every service, so S3 is recognised by its own
 *  data-plane prefixes rather than by the apex (which would drag Bedrock,
 *  SQS and DynamoDB into a storage reading). */
const S3_HOST_PREFIXES: readonly string[] = ["s3.", "s3-"];
const AWS_APEX = ".amazonaws.com";

/** Payment processors' data planes. */
const PAYMENT_HOST_SUFFIXES: readonly string[] = [
  "api.stripe.com",
  ".stripe.com",
  "api.moyasar.com",
  ".moyasar.com",
  "api.paypal.com",
  "api-m.paypal.com",
  ".paypal.com",
  "api.checkout.com",
  ".checkout.com",
  ".adyen.com",
  "api.braintreegateway.com",
  ".braintreegateway.com",
  "connect.squareup.com",
  ".squareup.com",
  "api.razorpay.com",
  "api.paddle.com",
  ".paddle.com",
  "api.lemonsqueezy.com",
  "api.mollie.com",
  ".tap.company",
  "api.myfatoorah.com",
  ".myfatoorah.com",
  "api.whop.com",
];

function matchesSuffix(host: string, suffixes: readonly string[]): boolean {
  for (const suffix of suffixes) {
    if (host === suffix || host.endsWith(suffix)) return true;
    if (suffix.startsWith(".") && host === suffix.slice(1)) return true;
  }
  return false;
}

/**
 * Which kind of dependency is this hostname? Pure, total, allocation-light and
 * cheap enough to run on every new connection. Never throws; reads nothing but
 * the hostname, and returns only a code from the closed set above.
 */
export function dependencyKindForHost(host: unknown): number {
  try {
    const h = typeof host === "string" ? host.trim().toLowerCase() : "";
    if (!h) return DEP_KIND_UNKNOWN;
    // Order matters: the most specific reading of a host wins. A hosted
    // database and a model provider are both "an API" to anyone else.
    if (isHostedDatabaseCall(h, "")) return DEP_KIND_DATABASE;
    if (aiProviderCode(h) > 0) return DEP_KIND_AI;
    if (matchesSuffix(h, STORAGE_HOST_SUFFIXES)) return DEP_KIND_STORAGE;
    if (
      h.endsWith(AWS_APEX) &&
      S3_HOST_PREFIXES.some((p) => h.startsWith(p) || h.includes("." + p))
    ) {
      return DEP_KIND_STORAGE;
    }
    if (matchesSuffix(h, PAYMENT_HOST_SUFFIXES)) return DEP_KIND_PAYMENTS;
    return DEP_KIND_OTHER;
  } catch {
    return DEP_KIND_UNKNOWN;
  }
}
