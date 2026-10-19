import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.module';
import { SessionSettings, sessionSettingsFrom } from './session-config';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

export type RenewResult =
  | { ok: true; sessionId: string; userId: string; refreshToken: string | null }
  | { ok: false; reason: 'missing' | 'unknown' | 'revoked' | 'expired' | 'idle' | 'reused' };

/**
 * Server-side sign-in sessions (review H3).
 *
 * - Login creates a session and returns an opaque renewal token (cookie) whose SHA-256 is
 *   stored; the plain token never touches the database or logs.
 * - Each renewal rotates the token. Presenting the previous token again after the grace
 *   window means it was copied: the whole session is revoked.
 * - Access tokens carry the session id and are checked against it on every request, so
 *   revoking a session (sign-out, deactivation, password change) works at once.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private readonly settings: SessionSettings;

  constructor(
    private prisma: PrismaService,
    config: ConfigService,
  ) {
    this.settings = sessionSettingsFrom(config);
  }

  get cookieSecure() {
    return this.settings.secureCookie;
  }

  /** Cookie lifetime: the session's hard limit (the server enforces idle and revocation). */
  get maxAgeMs() {
    return this.settings.maxMs;
  }

  async create(userId: string, userAgent?: string) {
    const refreshToken = newToken();
    const now = Date.now();
    const session = await this.prisma.authSession.create({
      data: {
        userId,
        refreshHash: hash(refreshToken),
        expiresAt: new Date(now + this.settings.maxMs),
        userAgent: userAgent?.slice(0, 200) || null,
      },
    });
    // Housekeeping: drop this user's sessions that ended more than a day ago.
    await this.prisma.authSession.deleteMany({
      where: {
        userId,
        OR: [
          { expiresAt: { lt: new Date(now - 86_400_000) } },
          { revokedAt: { lt: new Date(now - 86_400_000) } },
        ],
      },
    }).catch(() => undefined);
    return { sessionId: session.id, refreshToken };
  }

  /** Is the session behind an access token still valid? Called on every request. */
  async isActive(sessionId: string | undefined, userId: string): Promise<boolean> {
    if (!sessionId) return false;
    const s = await this.prisma.authSession.findUnique({ where: { id: sessionId } });
    if (!s || s.userId !== userId || s.revokedAt) return false;
    const now = Date.now();
    if (s.expiresAt.getTime() <= now) return false;
    if (s.lastUsedAt.getTime() + this.settings.idleMs <= now) return false;
    return true;
  }

  /** Exchange a renewal token for a new one (rotation). */
  async renew(token: string | undefined): Promise<RenewResult> {
    if (!token) return { ok: false, reason: 'missing' };
    const h = hash(token);
    const now = new Date();

    const current = await this.prisma.authSession.findUnique({ where: { refreshHash: h } });
    if (current) {
      const problem = this.problem(current, now);
      if (problem) {
        if (!current.revokedAt) await this.revoke(current.id, problem);
        return { ok: false, reason: problem };
      }
      const refreshToken = newToken();
      // Conditional update: if two requests rotate the same token at once, only one wins.
      const updated = await this.prisma.authSession.updateMany({
        where: { id: current.id, refreshHash: h, revokedAt: null },
        data: { refreshHash: hash(refreshToken), previousHash: h, rotatedAt: now, lastUsedAt: now },
      });
      if (updated.count === 1) return { ok: true, sessionId: current.id, userId: current.userId, refreshToken };
      // Lost the race: fall through and treat the token as the previous one.
    }

    const previous = await this.prisma.authSession.findFirst({ where: { previousHash: h } });
    if (!previous) return { ok: false, reason: 'unknown' };
    const problem = this.problem(previous, now);
    if (problem) return { ok: false, reason: problem };
    const withinGrace = previous.rotatedAt && now.getTime() - previous.rotatedAt.getTime() <= this.settings.reuseGraceMs;
    if (withinGrace) {
      // Another tab renewed a moment ago; the browser already holds the new cookie.
      await this.prisma.authSession.update({ where: { id: previous.id }, data: { lastUsedAt: now } });
      return { ok: true, sessionId: previous.id, userId: previous.userId, refreshToken: null };
    }
    this.logger.warn(`Renewal token reused after rotation; session ${previous.id} revoked`);
    await this.revoke(previous.id, 'reused');
    await this.prisma.auditEvent.create({
      data: { actorId: previous.userId, action: 'session_token_reused', entityType: 'user', entityId: previous.userId, payload: { sessionId: previous.id } },
    }).catch(() => undefined);
    return { ok: false, reason: 'reused' };
  }

  private problem(s: { revokedAt: Date | null; expiresAt: Date; lastUsedAt: Date }, now: Date) {
    if (s.revokedAt) return 'revoked' as const;
    if (s.expiresAt <= now) return 'expired' as const;
    if (s.lastUsedAt.getTime() + this.settings.idleMs <= now.getTime()) return 'idle' as const;
    return null;
  }

  async revoke(sessionId: string, reason: string) {
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Sign-out by renewal token (works even when the access token has already expired). */
  async revokeByToken(token: string | undefined, reason: string) {
    if (!token) return;
    const h = hash(token);
    await this.prisma.authSession.updateMany({
      where: { OR: [{ refreshHash: h }, { previousHash: h }], revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Every device of a user (deactivation, password reset or change). */
  async revokeAllForUser(userId: string, reason: string, exceptSessionId?: string) {
    const r = await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return r.count;
  }
}
