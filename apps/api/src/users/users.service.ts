import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import { passwordProblem } from '../auth/password-policy';

type Actor = { id: string; role: string; full_name?: string; email?: string };

const PUBLIC = {
  id: true, email: true, fullName: true, role: true, active: true, mustChangePassword: true,
  lockedUntil: true, lastLoginAt: true, createdAt: true,
} as const;

/** Staff accounts, managed by admins. Passwords are never returned or logged. */
@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  list() {
    return this.prisma.user.findMany({ select: PUBLIC, orderBy: [{ active: 'desc' }, { role: 'asc' }, { fullName: 'asc' }] });
  }

  private checkPassword(password: string, email: string) {
    const problem = passwordProblem(password, email);
    if (problem) throw new BadRequestException(problem);
  }

  async create(data: { email: string; fullName: string; role: UserRole; password: string }, actor: Actor) {
    const email = data.email.trim().toLowerCase();
    const fullName = data.fullName.trim();
    if (!fullName) throw new BadRequestException('Enter the full name.');
    this.checkPassword(data.password, email);
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('An account with this e-mail already exists.');
    const user = await this.prisma.user.create({
      data: { email, fullName, role: data.role, passwordHash: await bcrypt.hash(data.password, 10), mustChangePassword: true },
      select: PUBLIC,
    });
    await this.audit.log('User', user.id, 'user_created', actor, { role: user.role });
    return user;
  }

  /** Keeps at least one active admin, and admins cannot lock themselves out. */
  private async guardAdmins(target: { id: string; role: UserRole; active: boolean }, next: { role?: UserRole; active?: boolean }, actor: Actor) {
    const losesAdmin = target.role === 'admin' && target.active && ((next.role && next.role !== 'admin') || next.active === false);
    if (!losesAdmin) return;
    if (target.id === actor.id) throw new ForbiddenException('You cannot remove your own admin access.');
    const others = await this.prisma.user.count({ where: { role: 'admin', active: true, id: { not: target.id } } });
    if (others === 0) throw new ForbiddenException('At least one active admin must remain.');
  }

  async update(id: string, data: { fullName?: string; role?: UserRole; active?: boolean }, actor: Actor) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Account not found');
    await this.guardAdmins(target, data, actor);
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(data.fullName !== undefined ? { fullName: data.fullName.trim() || target.fullName } : {}),
        ...(data.role ? { role: data.role } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
      select: PUBLIC,
    });
    const changes: Record<string, unknown> = {};
    if (data.role && data.role !== target.role) changes.role = { from: target.role, to: data.role };
    if (data.active !== undefined && data.active !== target.active) changes.active = data.active;
    if (data.fullName !== undefined && data.fullName.trim() !== target.fullName) changes.name = true;
    await this.audit.log('User', id, data.active === false ? 'user_deactivated' : data.active === true && !target.active ? 'user_reactivated' : 'user_updated', actor, changes);
    return user;
  }

  /** Temporary password from the admin; the user must change it at next sign-in. */
  async resetPassword(id: string, password: string, actor: Actor) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Account not found');
    this.checkPassword(password, target.email);
    const user = await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
      select: PUBLIC,
    });
    await this.audit.log('User', id, 'password_reset', actor, {});
    return user;
  }

  async unlock(id: string, actor: Actor) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Account not found');
    const user = await this.prisma.user.update({ where: { id }, data: { failedLoginCount: 0, lockedUntil: null }, select: PUBLIC });
    await this.audit.log('User', id, 'account_unlocked', actor, {});
    return user;
  }
}
