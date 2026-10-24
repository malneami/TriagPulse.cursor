/** Closed words, decided on the calling stack; raw errors are never retained. */
export const CALL_FAILURE_KINDS = [
  // boosthis:call-failure-kinds:begin
  "could-not-connect", "no-answer", "turned-away", "too-many-requests",
  "server-error", "timed-out", "cancelled",
  // boosthis:call-failure-kinds:end
] as const;
export type CallFailure = (typeof CALL_FAILURE_KINDS)[number];
export interface FailureCounts {
  couldNotConnect: number; noAnswer: number; turnedAway: number;
  tooManyRequests: number; serverError: number; cancelled: number;
}
export const emptyFailures = (): FailureCounts => ({
  couldNotConnect: 0, noAnswer: 0, turnedAway: 0,
  tooManyRequests: 0, serverError: 0, cancelled: 0,
});
export function callFailure(status?: unknown, error?: unknown): CallFailure | undefined {
  try {
    if (typeof status === "number" && status > 0) {
      if (status >= 500 && status < 600) return "server-error";
      if (status === 429) return "too-many-requests";
      if (status >= 400 && status < 500) return "turned-away";
      return undefined;
    }
    if (error == null) return undefined;
    const e = error as { code?: unknown; name?: unknown; cause?: unknown };
    const classify = (v: { code?: unknown; name?: unknown }): CallFailure | undefined => {
      if (v.name === "TimeoutError" || ["ETIMEDOUT", "ESOCKETTIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(String(v.code))) return "timed-out";
      if (v.name === "AbortError" || v.code === "ABORT_ERR" || v.code === "UND_ERR_ABORTED") return "cancelled";
      if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"].includes(String(v.code))) return "could-not-connect";
      return undefined;
    };
    return classify(e) ?? (e.cause ? classify(e.cause as typeof e) : undefined) ?? "no-answer";
  } catch { return error == null ? undefined : "no-answer"; }
}
export function countFailure(t: FailureCounts, word: CallFailure | undefined, failed: boolean, timedOut: boolean): void {
  if (word === "turned-away") { if (!failed && !timedOut) t.turnedAway++; return; }
  if (!failed || timedOut) return;
  if (word === "could-not-connect") t.couldNotConnect++;
  if (word === "no-answer") t.noAnswer++;
  if (word === "too-many-requests") t.tooManyRequests++;
  if (word === "server-error") t.serverError++;
  if (word === "cancelled") t.cancelled++;
}
export interface ServiceCounts { name: string; calls: number; failed: number; timedOut: number }
export function countService(services: Map<string, ServiceCounts>, name: string | undefined, failed: boolean, timedOut: boolean): void {
  if (!name) return;
  let s = services.get(name);
  if (!s && services.size < 8) {
    s = { name, calls: 0, failed: 0, timedOut: 0 };
    services.set(name, s);
  }
  if (s) { s.calls++; if (failed) s.failed++; if (timedOut) s.timedOut++; }
}
export function topServices(services: Map<string, ServiceCounts>): { services?: ServiceCounts[] } {
  const rows = [...services.values()].sort((a, b) => b.calls - a.calls || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, 4).map(s => ({ ...s }));
  return rows.length ? { services: rows } : {};
}
export interface DbFailureCounts {
  dbFailed: number; dbCouldNotConnect: number; dbNoAnswer: number; dbTurnedAway: number;
  dbTooManyRequests: number; dbServerError: number; dbTimedOut: number; dbCancelled: number;
}
export const emptyDbFailures = (): DbFailureCounts => ({
  dbFailed: 0, dbCouldNotConnect: 0, dbNoAnswer: 0, dbTurnedAway: 0,
  dbTooManyRequests: 0, dbServerError: 0, dbTimedOut: 0, dbCancelled: 0,
});
export function dbFailure(error: unknown): CallFailure | undefined {
  if (error == null) return undefined;
  try {
    const network = callFailure(undefined, error);
    if (network !== "no-answer") return network;
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) && /\d/.test(code)) {
      if (code === "53300") return "too-many-requests";
      // pg does not expose a separate statement-timeout flag. Never read its message.
      if (code === "57014") return "cancelled";
      if (code === "08001" || code === "08004") return "could-not-connect";
      if (code.startsWith("08")) return "no-answer";
      if (["22", "23", "25", "28", "2B", "2D", "3D", "3F", "42", "44", "0A"].includes(code.slice(0, 2))) return "turned-away";
      return "server-error";
    }
    return callFailure(undefined, error);
  } catch { return undefined; }
}
export function countDbFailure(t: DbFailureCounts, word?: CallFailure): void {
  t.dbFailed++;
  if (word === "could-not-connect") t.dbCouldNotConnect++;
  if (word === "no-answer") t.dbNoAnswer++;
  if (word === "turned-away") t.dbTurnedAway++;
  if (word === "too-many-requests") t.dbTooManyRequests++;
  if (word === "server-error") t.dbServerError++;
  if (word === "timed-out") t.dbTimedOut++;
  if (word === "cancelled") t.dbCancelled++;
}
