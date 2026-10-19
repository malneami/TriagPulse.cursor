import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { passwordProblem } from './password-policy';
import { LOCK_MINUTES, MAX_FAILED_LOGINS } from './login-limit';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.module';
import { SessionsService } from './sessions.service';

/** bcrypt hash of a random string; compared against when the e-mail is unknown. */
const DUMMY_HASH = '$2b$10$ScnoZX5RGFwy316BFJP9wuw56Zxg1rY75XGlU90qO4qWJXn/QzzIS';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private sessions: SessionsService,
  ) {}

  private publicUser(user: { id: string; email: string; fullName: string; role: string; mustChangePassword: boolean }) {
    return {
      id: user.id,
      email: user.email,
      full_name: user.fullName,
      role: user.role,
      must_change_password: user.mustChangePassword,
    };
  }

  /** Short-lived access token tied to a sign-in session (`sid`). */
  private accessToken(user: { id: string; email: string; role: string }, sessionId: string) {
    return this.jwtService.sign({ sub: user.id, email: user.email, role: user.role, sid: sessionId });
  }

  async login(email: string, password: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const now = new Date();
    if (user?.lockedUntil && user.lockedUntil > now) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000);
      throw new HttpException(
        `Account locked after ${MAX_FAILED_LOGINS} wrong passwords. Try again in ${minutes} min or ask an admin.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // Same work whether or not the account exists, so timing does not reveal valid e-mails.
    const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
    // A deactivated account answers like a wrong password (no hint that it exists).
    if (!user || !ok || !user.active) {
      if (user && user.active) {
        const failed = user.failedLoginCount + 1;
        const lock = failed >= MAX_FAILED_LOGINS;
        await this.prisma.user.update({
          where: { id: user.id },
          data: lock
            ? { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) }
            : { failedLoginCount: failed },
        });
        if (lock) {
          await this.prisma.auditEvent.create({
            data: { actorId: user.id, action: 'account_locked', entityType: 'user', entityId: user.id, payload: { reason: 'failed_logins', minutes: LOCK_MINUTES } },
          }).catch(() => undefined);
        }
      }
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } });
    const { sessionId, refreshToken } = await this.sessions.create(user.id, userAgent);
    return {
      access_token: this.accessToken(user, sessionId),
      user: this.publicUser(user),
      refreshToken,
    };
  }

  /** New access token from the renewal cookie; rotates the cookie (H3). */
  async refresh(token: string | undefined) {
    const result = await this.sessions.renew(token);
    if (!result.ok) throw new UnauthorizedException('Session ended. Please sign in again.');
    const user = await this.prisma.user.findUnique({ where: { id: result.userId } });
    if (!user || !user.active) {
      await this.sessions.revoke(result.sessionId, 'inactive_user');
      throw new UnauthorizedException('Session ended. Please sign in again.');
    }
    return {
      access_token: this.accessToken(user, result.sessionId),
      user: this.publicUser(user),
      refreshToken: result.refreshToken,
    };
  }

  /** Ends this device's session; works with only the cookie (expired access token). */
  async logout(refreshToken: string | undefined, sessionId: string | undefined, reason = 'sign_out') {
    await this.sessions.revokeByToken(refreshToken, reason);
    if (sessionId) await this.sessions.revoke(sessionId, reason);
    return { ok: true };
  }

  /** Signs the user out on every device, this one included. */
  async logoutEverywhere(userId: string) {
    const ended = await this.sessions.revokeAllForUser(userId, 'sign_out_everywhere');
    await this.prisma.auditEvent.create({
      data: { actorId: userId, action: 'signed_out_everywhere', entityType: 'user', entityId: userId, payload: { sessions: ended } },
    }).catch(() => undefined);
    return { ok: true, sessions: ended };
  }

  /** The signed-in user changes their own password (also clears "must change"). */
  async changePassword(userId: string, current: string, next: string, sessionId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) throw new UnauthorizedException();
    if (!(await bcrypt.compare(current || '', user.passwordHash))) throw new BadRequestException('Current password is not correct.');
    const problem = passwordProblem(next, user.email);
    if (problem) throw new BadRequestException(problem);
    if (await bcrypt.compare(next, user.passwordHash)) throw new BadRequestException('Choose a new password, not the current one.');
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(next, 10), mustChangePassword: false } });
    // Other devices signed in with the old password are signed out; this one stays (H3).
    const otherSessions = await this.sessions.revokeAllForUser(userId, 'password_changed', sessionId);
    await this.prisma.auditEvent.create({
      data: { actorId: userId, action: 'password_changed', entityType: 'user', entityId: userId, payload: { otherSessionsEnded: otherSessions } },
    }).catch(() => undefined);
    return { ok: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) throw new UnauthorizedException();
    return this.publicUser(user);
  }
}
