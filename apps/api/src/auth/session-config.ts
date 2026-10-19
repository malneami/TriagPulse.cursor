import { ConfigService } from '@nestjs/config';

/**
 * Session lifetimes (review H3). All can be overridden in the environment.
 *   JWT_EXPIRES_IN           access token lifetime            default 10m
 *   SESSION_IDLE_MIN         renewal must happen within this  default 30 (server-side idle limit)
 *   SESSION_MAX_HOURS        hard limit for one sign-in       default 12 (one shift)
 *   REFRESH_REUSE_GRACE_SEC  two tabs renewing at once        default 30
 */
export const REFRESH_COOKIE = 'tp_refresh';
/** The cookie is only sent to the auth routes, never to the rest of the API. */
export const REFRESH_COOKIE_PATH = '/api/auth';

function positive(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface SessionSettings {
  idleMs: number;
  maxMs: number;
  reuseGraceMs: number;
  secureCookie: boolean;
}

export function sessionSettingsFrom(config: ConfigService): SessionSettings {
  return {
    idleMs: positive(config.get('SESSION_IDLE_MIN'), 30) * 60_000,
    maxMs: positive(config.get('SESSION_MAX_HOURS'), 12) * 3_600_000,
    reuseGraceMs: positive(config.get('REFRESH_REUSE_GRACE_SEC'), 30) * 1000,
    // Secure cookies need HTTPS; local development and CI run on plain http://localhost.
    secureCookie: config.get('NODE_ENV') === 'production',
  };
}
