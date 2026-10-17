/**
 * Sign-in protection (review H2).
 * - Per account: 5 wrong passwords in a row lock the account for 15 minutes (stored in the
 *   database, so a restart does not reset it). A correct password clears the count.
 * - Per address + account: at most 10 attempts a minute, so one machine cannot hammer the
 *   login route. Kept in memory; keyed with the e-mail so a shared ED proxy address does not
 *   lock out every nurse at shift change.
 */
export const MAX_FAILED_LOGINS = Number(process.env.LOGIN_MAX_FAILED || 5);
export const LOCK_MINUTES = Number(process.env.LOGIN_LOCK_MINUTES || 15);
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = Number(process.env.LOGIN_MAX_PER_MINUTE || 10);

const attempts = new Map<string, number[]>();

/** Records an attempt; returns false when this address has tried this account too often. */
export function allowLoginAttempt(ip: string, email: string, now = Date.now()): boolean {
  const key = `${ip}|${email.toLowerCase()}`;
  const recent = (attempts.get(key) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  attempts.set(key, recent);
  if (attempts.size > 10_000) {
    for (const [k, v] of attempts) if (!v.some((t) => now - t < WINDOW_MS)) attempts.delete(k);
  }
  return recent.length <= MAX_PER_WINDOW;
}
