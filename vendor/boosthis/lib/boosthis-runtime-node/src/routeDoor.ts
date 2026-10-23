/**
 * How a route answered a request that carried no credentials — one closed
 * word per finished request, riding the sample's metadata.
 *
 * WHY. Boosthis can tell a developer "this route used to turn away requests
 * with no credentials and now answers them" only by setting one stretch of a
 * route's history against an earlier one, and that comparison is made on the
 * server (api-server src/lib/routeDoorChange.ts) from these words, counted per
 * route per day. The kit holds no history and judges nothing here.
 *
 * WHAT IS READ. Only whether an Authorization header was PRESENT — the same
 * presence-only read the refusal-honesty meter already makes at this boundary
 * — the method, whether the response completed, and the status code. No
 * header value is kept, hashed or sent, and no cookie is ever looked at.
 *
 * THE WORDS. A request that carried an Authorization header gets no word, and
 * neither does an OPTIONS request (a browser's preflight never carries
 * credentials and is answered whatever the route requires). Every other
 * finished request gets exactly one:
 *
 *   refused   the app answered 401 or 403
 *   answered  the app answered 2xx or 304
 *   other     anything else — a redirect, a 404, a 5xx, a status that could
 *             not be read, or a response that never completed
 *
 * The server's copy of this list is `DOOR_WORDS` in routeDoorChange.ts, and a
 * server test pins the two together.
 */

export const DOOR_WORD_REFUSED = "refused" as const;
export const DOOR_WORD_ANSWERED = "answered" as const;
export const DOOR_WORD_OTHER = "other" as const;

/** Every word a sample's `door` metadata may carry. */
export const DOOR_WORDS = [DOOR_WORD_REFUSED, DOOR_WORD_ANSWERED, DOOR_WORD_OTHER] as const;
export type DoorWord = (typeof DOOR_WORDS)[number];

const DOOR_WORD_SET: ReadonlySet<string> = new Set(DOOR_WORDS);

export function isDoorWord(v: unknown): v is DoorWord {
  return typeof v === "string" && DOOR_WORD_SET.has(v);
}

/**
 * Was an Authorization header present on this request? `null` when the
 * request carries no readable header table at all — "cannot tell", which
 * gives no word rather than filing a request we could not read as one that
 * carried no credentials. Presence only: the value is never returned.
 */
export function authorizationPresence(req: unknown): boolean | null {
  const headers = (req as { headers?: unknown } | null | undefined)?.headers;
  if (headers == null || typeof headers !== "object") return null;
  const h = headers as Record<string, unknown>;
  const v = h.authorization ?? h.Authorization;
  if (Array.isArray(v)) return v.some((x) => typeof x === "string" && x.length > 0);
  return typeof v === "string" && v.length > 0;
}

/**
 * The word for one finished request, or null when it gets none.
 *
 * `authorizationPresent` is `authorizationPresence(req)`; `completed` is
 * whether the response finished (a client that hung up mid-request never
 * received an answer, so it is `other`, never `answered`).
 */
export function doorWordFor(
  method: unknown,
  authorizationPresent: boolean | null,
  completed: boolean,
  status: unknown,
): DoorWord | null {
  if (authorizationPresent !== false) return null;
  if (typeof method === "string" && method.toUpperCase() === "OPTIONS") return null;
  if (!completed) return DOOR_WORD_OTHER;
  if (typeof status !== "number" || !Number.isInteger(status)) return DOOR_WORD_OTHER;
  if (status === 401 || status === 403) return DOOR_WORD_REFUSED;
  if ((status >= 200 && status < 300) || status === 304) return DOOR_WORD_ANSWERED;
  return DOOR_WORD_OTHER;
}
