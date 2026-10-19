import { ConfigService } from '@nestjs/config';

/**
 * JWT settings are read only through ConfigService, after .env has loaded.
 * There is deliberately no fallback secret: the repository is public, so any
 * default would let anyone sign their own admin token.
 */

const MIN_SECRET_LENGTH = 32;

/** Values that have appeared in this repo or its docs and must never be used. */
const KNOWN_BAD_SECRETS = new Set([
  'dev-secret-change-me',
  'change-me-in-production-use-long-random-string',
  'secret',
  'changeme',
]);

export function assertJwtSecret(secret: string | undefined): string {
  const value = secret?.trim();
  if (!value) {
    throw new Error(
      'JWT_SECRET is not set. Generate one with `openssl rand -base64 48` and set it in the environment.',
    );
  }
  if (KNOWN_BAD_SECRETS.has(value)) {
    throw new Error('JWT_SECRET is a published example value. Generate a new random secret.');
  }
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);
  }
  return value;
}

export function jwtSecretFrom(config: ConfigService): string {
  return assertJwtSecret(config.get<string>('JWT_SECRET'));
}

/** Access tokens are short-lived; the browser renews them through the session cookie (H3). */
export function jwtExpiresInFrom(config: ConfigService): string {
  return config.get<string>('JWT_EXPIRES_IN')?.trim() || '10m';
}

/**
 * ConfigModule `validate` hook: stops the API at boot, before it listens,
 * when required security settings are missing or weak.
 */
export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  assertJwtSecret(env.JWT_SECRET as string | undefined);
  if (env.NODE_ENV === 'production' && !String(env.CORS_ORIGIN ?? '').trim()) {
    throw new Error('CORS_ORIGIN must be set in production (for example https://app.triagepulse.com).');
  }
  return env;
}
