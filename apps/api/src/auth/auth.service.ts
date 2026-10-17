import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { LOCK_MINUTES, MAX_FAILED_LOGINS } from './login-limit';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.module';

/** bcrypt hash of a random string; compared against when the e-mail is unknown. */
const DUMMY_HASH = '$2b$10$ScnoZX5RGFwy316BFJP9wuw56Zxg1rY75XGlU90qO4qWJXn/QzzIS';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(email: string, password: string) {
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
    if (!user || !ok) {
      if (user) {
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
    if (user.failedLoginCount || user.lockedUntil) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    }
    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        full_name: user.fullName,
        role: user.role,
      },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      full_name: user.fullName,
      role: user.role,
    };
  }
}
