/* ─── Boosthis: what KIND of outside service a call went to (Node) ─────────
 *
 * WHY THIS EXISTS. An AI-built app leans on a handful of outside services for
 * the things a visitor notices most, and until now every one of them arrived
 * as the same blurred figure: some outbound calls happened, some were slow.
 * "Sign-in is what is slow, and it has been getting worse for a week" is a
 * sentence a founder can act on; "outbound calls are slow" is not.
 *
 * THE PRIVACY CONTRACT, AND THE WHOLE REASON THIS FILE IS SHAPED THIS WAY.
 * Nothing derived here comes from the CONTENT of an address. A hostname is
 * matched against the closed table below, the matched INPUT IS THROWN AWAY,
 * and at most two of OUR OWN constant words are kept in its place: the kind
 * (one of six) and, for a host the table recognises, the service's closed
 * word. There is no code path that copies a byte of a host, a path, a query
 * string, a header or a payload into a value that leaves. A host we do not
 * recognise becomes `other`, with no service word — a visible group of its
 * own, never folded into a known kind and never guessed at.
 *
 * The table itself is not ours to edit here: it is the ONE shared table every
 * server kit recognises a service by (lib/dependency-services.json), copied
 * between the two markers below and held equal to it, in order, by
 * scripts/src/__tests__/dependency-kind-parity.test.ts. The server accepts a
 * service word only beside the kind the table gives it
 * (docs/server-call-failures.md §1).
 *
 * WHAT IS DELIBERATELY NOT HERE.
 *   • Hosted databases (Supabase, Firebase, Neon, Turso …) are classified as
 *     DATABASE work upstream of this table and never reach it. Their reading
 *     is the `dbWork` axis and moving them here would report one wait twice.
 *   • AI providers are classified as AI work upstream too, for the same
 *     reason: their reading is the `aiCalls` axis.
 *   • Boosthis's own upload endpoint is excluded before any classification
 *     runs, so our flushes can never be reported as the customer's traffic.
 *
 * A JUDGEMENT WE REFUSE TO MAKE. A recognised service is named so a founder
 * can tell which of their services failed; it is never ranked against
 * another provider, and no reliability claim about somebody else's service is
 * ever published from it.
 */

/**
 * Every kind word this kit can ever emit. CLOSED SET — mirrored in the
 * server's ingest guard, which rejects anything outside it and drops the whole
 * row rather than rewriting it.
 *
 * Order is documentation, not a wire contract: the WORD travels, never a
 * position.
 */
export const DEPENDENCY_KINDS = ["signin", "storage", "payments", "messaging", "search", "other"] as const;

export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

/** The kinds that are a recognised service, i.e. everything but the honest
 *  "we do not know what this is" bucket. */
export const KNOWN_DEPENDENCY_KINDS: readonly DependencyKind[] =
  DEPENDENCY_KINDS.filter((k) => k !== "other");

/**
 * One recognition rule. `domain` is a vendor-owned domain matched against the
 * bare hostname the outbound observer already normalised (no scheme, no
 * userinfo, no port, no path) — and matched on a LABEL BOUNDARY: the host must
 * BE that domain or sit under it. A plain "ends with" test would read
 * notclerk.com as a sign-in service and evil-uploadthing.com as storage, which
 * would put a stranger's traffic under a trusted service's name and hide it
 * from the unrecognised group where it belongs. `prefix`, when present, must
 * ALSO match, which is how a vendor that puts the product in the first label
 * and the account in the middle (AWS) is recognised without claiming every
 * host at that vendor.
 *
 * Every entry is a vendor-owned DATA-PLANE name. A generic API host is
 * deliberately absent: mistaking an ordinary API for a payment provider would
 * put real traffic in a reading about money, which is the exact confusion this
 * table exists to end.
 */
interface KindRule {
  readonly domain: string;
  readonly prefix?: string;
  /** An inner label that must ALSO appear. Needed where the vendor puts the
   *  customer's own name FIRST and the product in the middle — the ordinary
   *  form of an S3 bucket URL — which neither a prefix nor a suffix can catch
   *  on its own. Matched with the dots included, so it can only ever match a
   *  whole label. */
  readonly infix?: string;
  readonly kind: DependencyKind;
  /** The service's closed word from the shared table: never derived from the
   *  host, always one of the table's own words. */
  readonly service: string;
}

/** The shared recognition table, first match wins. */
export const KIND_RULES: readonly KindRule[] = [
  // boosthis:dependency-rules:begin
  { domain: "clerk.accounts.dev", kind: "signin", service: "clerk" },
  { domain: "clerk.com", kind: "signin", service: "clerk" },
  { domain: "auth0.com", kind: "signin", service: "auth0" },
  { domain: "okta.com", kind: "signin", service: "okta" },
  { domain: "oktapreview.com", kind: "signin", service: "okta" },
  { domain: "okta-emea.com", kind: "signin", service: "okta" },
  { domain: "identitytoolkit.googleapis.com", kind: "signin", service: "firebase-auth" },
  { domain: "securetoken.googleapis.com", kind: "signin", service: "firebase-auth" },
  { domain: "accounts.google.com", kind: "signin", service: "google-sign-in" },
  { domain: "oauth2.googleapis.com", kind: "signin", service: "google-sign-in" },
  { domain: "login.microsoftonline.com", kind: "signin", service: "microsoft-sign-in" },
  { domain: "appleid.apple.com", kind: "signin", service: "apple-sign-in" },
  { domain: "amazoncognito.com", kind: "signin", service: "aws-cognito" },
  { domain: "amazonaws.com", prefix: "cognito-idp.", kind: "signin", service: "aws-cognito" },
  { domain: "amazonaws.com", prefix: "cognito-identity.", kind: "signin", service: "aws-cognito" },
  { domain: "workos.com", kind: "signin", service: "workos" },
  { domain: "authkit.app", kind: "signin", service: "workos" },
  { domain: "stytch.com", kind: "signin", service: "stytch" },
  { domain: "supertokens.io", kind: "signin", service: "supertokens" },
  { domain: "supertokens.com", kind: "signin", service: "supertokens" },
  { domain: "propelauth.com", kind: "signin", service: "propelauth" },
  { domain: "kinde.com", kind: "signin", service: "kinde" },
  { domain: "frontegg.com", kind: "signin", service: "frontegg" },
  { domain: "descope.com", kind: "signin", service: "descope" },
  { domain: "logto.app", kind: "signin", service: "logto" },
  { domain: "ory.sh", kind: "signin", service: "ory" },
  { domain: "api.magic.link", kind: "signin", service: "magic" },
  { domain: "keycloak.org", kind: "signin", service: "keycloak" },
  { domain: "s3.amazonaws.com", kind: "storage", service: "aws-s3" },
  { domain: "amazonaws.com", prefix: "s3.", kind: "storage", service: "aws-s3" },
  { domain: "amazonaws.com", prefix: "s3-", kind: "storage", service: "aws-s3" },
  { domain: "amazonaws.com", infix: ".s3.", kind: "storage", service: "aws-s3" },
  { domain: "amazonaws.com", infix: ".s3-", kind: "storage", service: "aws-s3" },
  { domain: "storage.googleapis.com", kind: "storage", service: "google-cloud-storage" },
  { domain: "firebasestorage.googleapis.com", kind: "storage", service: "firebase-storage" },
  { domain: "blob.core.windows.net", kind: "storage", service: "azure-blob-storage" },
  { domain: "r2.cloudflarestorage.com", kind: "storage", service: "cloudflare-r2" },
  { domain: "digitaloceanspaces.com", kind: "storage", service: "digitalocean-spaces" },
  { domain: "backblazeb2.com", kind: "storage", service: "backblaze-b2" },
  { domain: "wasabisys.com", kind: "storage", service: "wasabi" },
  { domain: "storage.bunnycdn.com", kind: "storage", service: "bunny-storage" },
  { domain: "cloudinary.com", kind: "storage", service: "cloudinary" },
  { domain: "imagekit.io", kind: "storage", service: "imagekit" },
  { domain: "uploadthing.com", kind: "storage", service: "uploadthing" },
  { domain: "uploadcare.com", kind: "storage", service: "uploadcare" },
  { domain: "ucarecdn.com", kind: "storage", service: "uploadcare" },
  { domain: "filestackapi.com", kind: "storage", service: "filestack" },
  { domain: "bytescale.com", kind: "storage", service: "bytescale" },
  { domain: "mux.com", kind: "storage", service: "mux" },
  { domain: "transloadit.com", kind: "storage", service: "transloadit" },
  { domain: "stripe.com", kind: "payments", service: "stripe" },
  { domain: "paypal.com", kind: "payments", service: "paypal" },
  { domain: "adyen.com", kind: "payments", service: "adyen" },
  { domain: "checkout.com", kind: "payments", service: "checkout-com" },
  { domain: "razorpay.com", kind: "payments", service: "razorpay" },
  { domain: "paddle.com", kind: "payments", service: "paddle" },
  { domain: "squareup.com", kind: "payments", service: "square" },
  { domain: "braintreegateway.com", kind: "payments", service: "braintree" },
  { domain: "lemonsqueezy.com", kind: "payments", service: "lemon-squeezy" },
  { domain: "mollie.com", kind: "payments", service: "mollie" },
  { domain: "paystack.co", kind: "payments", service: "paystack" },
  { domain: "flutterwave.com", kind: "payments", service: "flutterwave" },
  { domain: "moyasar.com", kind: "payments", service: "moyasar" },
  { domain: "tap.company", kind: "payments", service: "tap-payments" },
  { domain: "whop.com", kind: "payments", service: "whop" },
  { domain: "revenuecat.com", kind: "payments", service: "revenuecat" },
  { domain: "resend.com", kind: "messaging", service: "resend" },
  { domain: "sendgrid.com", kind: "messaging", service: "sendgrid" },
  { domain: "mailgun.net", kind: "messaging", service: "mailgun" },
  { domain: "mailgun.org", kind: "messaging", service: "mailgun" },
  { domain: "postmarkapp.com", kind: "messaging", service: "postmark" },
  { domain: "mailjet.com", kind: "messaging", service: "mailjet" },
  { domain: "mailchimp.com", kind: "messaging", service: "mailchimp" },
  { domain: "brevo.com", kind: "messaging", service: "brevo" },
  { domain: "sendinblue.com", kind: "messaging", service: "brevo" },
  { domain: "amazonaws.com", prefix: "email.", kind: "messaging", service: "aws-ses" },
  { domain: "twilio.com", kind: "messaging", service: "twilio" },
  { domain: "vonage.com", kind: "messaging", service: "vonage" },
  { domain: "nexmo.com", kind: "messaging", service: "vonage" },
  { domain: "unifonic.com", kind: "messaging", service: "unifonic" },
  { domain: "msg91.com", kind: "messaging", service: "msg91" },
  { domain: "api.telegram.org", kind: "messaging", service: "telegram" },
  { domain: "slack.com", kind: "messaging", service: "slack" },
  { domain: "discord.com", kind: "messaging", service: "discord" },
  { domain: "discordapp.com", kind: "messaging", service: "discord" },
  { domain: "fcm.googleapis.com", kind: "messaging", service: "firebase-messaging" },
  { domain: "onesignal.com", kind: "messaging", service: "onesignal" },
  { domain: "exp.host", kind: "messaging", service: "expo-push" },
  { domain: "pushover.net", kind: "messaging", service: "pushover" },
  { domain: "knock.app", kind: "messaging", service: "knock" },
  { domain: "courier.com", kind: "messaging", service: "courier" },
  { domain: "pinecone.io", kind: "search", service: "pinecone" },
  { domain: "weaviate.network", kind: "search", service: "weaviate" },
  { domain: "weaviate.cloud", kind: "search", service: "weaviate" },
  { domain: "qdrant.io", kind: "search", service: "qdrant" },
  { domain: "qdrant.tech", kind: "search", service: "qdrant" },
  { domain: "zillizcloud.com", kind: "search", service: "zilliz" },
  { domain: "zilliz.com", kind: "search", service: "zilliz" },
  { domain: "trychroma.com", kind: "search", service: "chroma" },
  { domain: "turbopuffer.com", kind: "search", service: "turbopuffer" },
  { domain: "vectara.io", kind: "search", service: "vectara" },
  { domain: "algolia.net", kind: "search", service: "algolia" },
  { domain: "algolianet.com", kind: "search", service: "algolia" },
  { domain: "algolia.io", kind: "search", service: "algolia" },
  { domain: "typesense.net", kind: "search", service: "typesense" },
  { domain: "meilisearch.io", kind: "search", service: "meilisearch" },
  { domain: "meilisearch.com", kind: "search", service: "meilisearch" },
  { domain: "elastic-cloud.com", kind: "search", service: "elastic-cloud" },
  // boosthis:dependency-rules:end
];

/**
 * Which kind of outside service this hostname is and, when the table
 * recognises it, which service — or `other` with no service.
 *
 * Pure, total and cheap: it runs on every outbound call. The hostname is read
 * and dropped; only the returned constants are ever kept. Never throws.
 */
export function dependencyFor(host: unknown): { kind: DependencyKind; service?: string } {
  try {
    const h = typeof host === "string" ? host.toLowerCase() : "";
    if (!h) return { kind: "other" };
    for (const rule of KIND_RULES) {
      // Label-boundary match ONLY: the host either IS the vendor's domain or
      // sits under it. Never a bare "ends with", which would hand a lookalike
      // domain a trusted service's name.
      if (h !== rule.domain && !h.endsWith("." + rule.domain)) continue;
      if (rule.prefix && !h.startsWith(rule.prefix)) continue;
      if (rule.infix && !h.includes(rule.infix)) continue;
      return { kind: rule.kind, service: rule.service };
    }
  } catch {
    /* never disturb the host */
  }
  return { kind: "other" };
}

/** The kind alone, for the readers that need nothing more. */
export function dependencyKindFor(host: unknown): DependencyKind {
  return dependencyFor(host).kind;
}

// A label that is a bare ADDRESS rather than one of our own words: a dotted
// hostname ("api.stripe.com") or an IPv4 literal ("10.0.0.5"). The retry-storm
// detector names the host it saw hammered, which is exactly right for the
// developer's own screen inside their own process — and exactly wrong on the
// wire, because our published privacy claim says a hostname never reaches us.
// Anchored, dot-bearing and whitespace-free, so our own code-defined finding
// names ("responses", "event loop", "GET /pay") are never mistaken for one.
const BARE_ADDRESS_RE =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/** True when a label is a bare outbound address — a hostname or an IPv4 —
 *  rather than a code-defined word. Used at the transmit boundary: an address
 *  is replaced by the closed dependency-kind vocabulary above, never uploaded.
 *
 *  Mirrors `looks_like_address` in `lib/boosthis-py/boosthis/pii.py`. */
export function looksLikeAddress(label: string): boolean {
  return BARE_ADDRESS_RE.test(label);
}

/**
 * SIGN-IN LIBRARIES THAT RUN INSIDE THE APP, AND WHY THEY NEED THEIR OWN
 * ANSWER.
 *
 * Several of the most popular ways to sign a visitor in make NO outbound call
 * at all: the library runs in the app's own process and talks only to the
 * app's own database. Classifying by destination misses them completely — and
 * telling a founder their app has no sign-in when it plainly has one would be
 * far worse than saying nothing.
 *
 * So we recognise them another way, exactly as the database meter already
 * recognises a driver it cannot watch: by looking for the library in the
 * module cache the host ALREADY filled. This kit never imports one of these,
 * never resolves one into existence, and reads nothing but the presence of the
 * name. The finding is reported as a plain sentence — sign-in happens inside
 * your app, so there is no outside call to time — never as an absence.
 *
 * Deliberately NOT here: a plain session or cookie library, and a password
 * hashing library, on their own. A session store is not proof that the app
 * signs anybody in, and a hashing function is not proof either — plenty of
 * apps hash something without having a sign-in. Claiming sign-in on that
 * evidence would be exactly the guess this whole file refuses to make. Every
 * name below exists for one purpose only: signing a person in.
 */
export const IN_APP_SIGNIN_PACKAGES: readonly string[] = [
  "next-auth",
  "@auth/core",
  "@auth/sveltekit",
  "@auth/express",
  "better-auth",
  "lucia",
  "@lucia-auth/adapter-drizzle",
  "passport",
  "passport-local",
  "openid-client",
  "remix-auth",
  "@nestjs/passport",
  "grant",
  "supertokens-node",
];
