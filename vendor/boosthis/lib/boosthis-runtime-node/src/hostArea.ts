/* ─── Boosthis: the platform's OWN declared region (Node) ────────────────
 *
 * WHY THIS EXISTS
 * A distance measurement is far easier to act on when the app can also say
 * where it is running: "your app runs in Western Europe and your database
 * handshake takes 95 ms" points straight at the cause. Every platform we
 * support declares its own region in its own environment; nothing here
 * infers, looks up, or resolves anything.
 *
 * PRIVACY CONTRACT
 *   • This is the PLATFORM's declaration about ITSELF, never a person, a
 *     visitor, or the app's users. No address is read, resolved or stored.
 *   • The declared string is matched against a closed table in source and then
 *     THROWN AWAY: only our own small integer leaves the process. A region we
 *     do not recognise becomes `declared but not recognised` — never the raw
 *     string.
 *   • Absence is a first-class answer: an unstated region is `unknown`, and
 *     the measurement is reported without it rather than guessing.
 */

/** The platform said nothing. */
export const HOST_AREA_UNKNOWN = 0;
/** The platform declared a region we do not have a word for. */
export const HOST_AREA_UNRECOGNISED = 1;
export const HOST_AREA_NA_EAST = 2;
export const HOST_AREA_NA_WEST = 3;
export const HOST_AREA_NA_CENTRAL = 4;
export const HOST_AREA_SOUTH_AMERICA = 5;
export const HOST_AREA_EUROPE_WEST = 6;
export const HOST_AREA_EUROPE_NORTH = 7;
export const HOST_AREA_ASIA_PACIFIC = 8;
export const HOST_AREA_INDIA = 9;
export const HOST_AREA_MIDDLE_EAST = 10;
export const HOST_AREA_AFRICA = 11;
export const HOST_AREA_OCEANIA = 12;

/** Highest code this vocabulary can ever emit (the server bounds-checks it). */
export const HOST_AREA_MAX = 12;

/** Environment variables in which a platform states its OWN region. Closed
 *  list; nothing else in the environment is read. */
const REGION_VARS: readonly string[] = [
  "VERCEL_REGION",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "FUNCTION_REGION",
  "GOOGLE_CLOUD_REGION",
  "REGION_NAME",
  "FLY_REGION",
  "RAILWAY_REPLICA_REGION",
  "RENDER_REGION",
];

/** Prefix rules for the big clouds' own region formats, in match order. */
const AREA_PREFIXES: ReadonlyArray<readonly [string, number]> = [
  // AWS / Vercel-on-AWS
  ["us-east", HOST_AREA_NA_EAST],
  ["us-west", HOST_AREA_NA_WEST],
  ["us-central", HOST_AREA_NA_CENTRAL],
  ["ca-central", HOST_AREA_NA_EAST],
  ["ca-west", HOST_AREA_NA_WEST],
  ["sa-east", HOST_AREA_SOUTH_AMERICA],
  ["southamerica-", HOST_AREA_SOUTH_AMERICA],
  ["eu-north", HOST_AREA_EUROPE_NORTH],
  ["eu-", HOST_AREA_EUROPE_WEST],
  ["europe-north", HOST_AREA_EUROPE_NORTH],
  ["europe-", HOST_AREA_EUROPE_WEST],
  ["ap-south-", HOST_AREA_INDIA],
  ["ap-southeast-2", HOST_AREA_OCEANIA],
  ["ap-southeast-4", HOST_AREA_OCEANIA],
  ["ap-", HOST_AREA_ASIA_PACIFIC],
  ["asia-south", HOST_AREA_INDIA],
  ["asia-", HOST_AREA_ASIA_PACIFIC],
  ["australia", HOST_AREA_OCEANIA],
  ["northamerica-northeast", HOST_AREA_NA_EAST],
  ["me-", HOST_AREA_MIDDLE_EAST],
  ["il-", HOST_AREA_MIDDLE_EAST],
  ["af-", HOST_AREA_AFRICA],
  ["africa-", HOST_AREA_AFRICA],
  // Azure's own single-word names
  ["eastus", HOST_AREA_NA_EAST],
  ["westus", HOST_AREA_NA_WEST],
  ["centralus", HOST_AREA_NA_CENTRAL],
  ["northcentralus", HOST_AREA_NA_CENTRAL],
  ["southcentralus", HOST_AREA_NA_CENTRAL],
  ["westcentralus", HOST_AREA_NA_CENTRAL],
  ["canada", HOST_AREA_NA_EAST],
  ["brazil", HOST_AREA_SOUTH_AMERICA],
  ["chile", HOST_AREA_SOUTH_AMERICA],
  ["northeurope", HOST_AREA_EUROPE_WEST],
  ["westeurope", HOST_AREA_EUROPE_WEST],
  ["uk", HOST_AREA_EUROPE_WEST],
  ["france", HOST_AREA_EUROPE_WEST],
  ["germany", HOST_AREA_EUROPE_WEST],
  ["switzerland", HOST_AREA_EUROPE_WEST],
  ["italy", HOST_AREA_EUROPE_WEST],
  ["spain", HOST_AREA_EUROPE_WEST],
  ["poland", HOST_AREA_EUROPE_WEST],
  ["sweden", HOST_AREA_EUROPE_NORTH],
  ["norway", HOST_AREA_EUROPE_NORTH],
  ["eastasia", HOST_AREA_ASIA_PACIFIC],
  ["southeastasia", HOST_AREA_ASIA_PACIFIC],
  ["japan", HOST_AREA_ASIA_PACIFIC],
  ["korea", HOST_AREA_ASIA_PACIFIC],
  ["centralindia", HOST_AREA_INDIA],
  ["southindia", HOST_AREA_INDIA],
  ["westindia", HOST_AREA_INDIA],
  ["jioindia", HOST_AREA_INDIA],
  ["uae", HOST_AREA_MIDDLE_EAST],
  ["qatar", HOST_AREA_MIDDLE_EAST],
  ["israel", HOST_AREA_MIDDLE_EAST],
  ["southafrica", HOST_AREA_AFRICA],
];

/** Airport-style codes (Vercel, Fly.io and friends name regions this way). */
const AREA_CODES: Readonly<Record<string, number>> = {
  iad: HOST_AREA_NA_EAST,
  bos: HOST_AREA_NA_EAST,
  ewr: HOST_AREA_NA_EAST,
  atl: HOST_AREA_NA_EAST,
  mia: HOST_AREA_NA_EAST,
  yyz: HOST_AREA_NA_EAST,
  yul: HOST_AREA_NA_EAST,
  cle: HOST_AREA_NA_CENTRAL,
  ord: HOST_AREA_NA_CENTRAL,
  dfw: HOST_AREA_NA_CENTRAL,
  den: HOST_AREA_NA_CENTRAL,
  qro: HOST_AREA_NA_CENTRAL,
  sfo: HOST_AREA_NA_WEST,
  sjc: HOST_AREA_NA_WEST,
  lax: HOST_AREA_NA_WEST,
  pdx: HOST_AREA_NA_WEST,
  sea: HOST_AREA_NA_WEST,
  phx: HOST_AREA_NA_WEST,
  gru: HOST_AREA_SOUTH_AMERICA,
  gig: HOST_AREA_SOUTH_AMERICA,
  scl: HOST_AREA_SOUTH_AMERICA,
  eze: HOST_AREA_SOUTH_AMERICA,
  bog: HOST_AREA_SOUTH_AMERICA,
  lhr: HOST_AREA_EUROPE_WEST,
  cdg: HOST_AREA_EUROPE_WEST,
  fra: HOST_AREA_EUROPE_WEST,
  ams: HOST_AREA_EUROPE_WEST,
  dub: HOST_AREA_EUROPE_WEST,
  mad: HOST_AREA_EUROPE_WEST,
  waw: HOST_AREA_EUROPE_WEST,
  otp: HOST_AREA_EUROPE_WEST,
  zrh: HOST_AREA_EUROPE_WEST,
  arn: HOST_AREA_EUROPE_NORTH,
  osl: HOST_AREA_EUROPE_NORTH,
  hel: HOST_AREA_EUROPE_NORTH,
  cph: HOST_AREA_EUROPE_NORTH,
  nrt: HOST_AREA_ASIA_PACIFIC,
  hnd: HOST_AREA_ASIA_PACIFIC,
  kix: HOST_AREA_ASIA_PACIFIC,
  icn: HOST_AREA_ASIA_PACIFIC,
  hkg: HOST_AREA_ASIA_PACIFIC,
  sin: HOST_AREA_ASIA_PACIFIC,
  bkk: HOST_AREA_ASIA_PACIFIC,
  bom: HOST_AREA_INDIA,
  maa: HOST_AREA_INDIA,
  del: HOST_AREA_INDIA,
  syd: HOST_AREA_OCEANIA,
  mel: HOST_AREA_OCEANIA,
  akl: HOST_AREA_OCEANIA,
  dxb: HOST_AREA_MIDDLE_EAST,
  bah: HOST_AREA_MIDDLE_EAST,
  tlv: HOST_AREA_MIDDLE_EAST,
  jnb: HOST_AREA_AFRICA,
  cpt: HOST_AREA_AFRICA,
  los: HOST_AREA_AFRICA,
};

/**
 * Turn one declared region string into an area code. Exported for the tests
 * and for the platform detectors that already hold a region string; the string
 * itself never leaves this function.
 */
export function areaForRegion(raw: unknown): number {
  const r = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!r) return HOST_AREA_UNKNOWN;
  for (const [prefix, area] of AREA_PREFIXES) {
    if (r.startsWith(prefix)) return area;
  }
  // Airport-style: three letters, optionally with a trailing digit (`iad1`).
  const code = r.replace(/[0-9]+$/, "");
  if (code.length === 3 && Object.prototype.hasOwnProperty.call(AREA_CODES, code)) {
    return AREA_CODES[code]!;
  }
  return HOST_AREA_UNRECOGNISED;
}

let cached: number | null = null;

/**
 * The area this app's platform declares for ITSELF, read once and frozen.
 * `HOST_AREA_UNKNOWN` when no platform said anything — the honest answer, and
 * the measurement is then reported on its own.
 */
export function declaredHostArea(): number {
  if (cached !== null) return cached;
  let area = HOST_AREA_UNKNOWN;
  try {
    for (const name of REGION_VARS) {
      const v = process.env[name];
      if (typeof v !== "string" || v.trim() === "") continue;
      area = areaForRegion(v);
      if (area !== HOST_AREA_UNKNOWN) break;
    }
  } catch {
    area = HOST_AREA_UNKNOWN;
  }
  cached = area;
  return area;
}

/** @internal test hook — the read is frozen for the process's life. */
export const _hostAreaInternals = {
  reset(): void {
    cached = null;
  },
};
