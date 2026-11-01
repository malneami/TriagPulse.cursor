import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { BRANCHES, JOB_TITLES } from '@triagepulse/clinical';
import { PrismaService } from '../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import { UsersService } from './users.service';

type Actor = { id: string; role: string; full_name?: string; email?: string };

export type JoinBody = {
  code: string; fullName: string; email: string;
  jobTitle: string; jobTitleOther?: string; branch: string; branchOther?: string;
};

const WINDOW_MS = 15 * 60 * 1000;
const MAX_SUBMITS = 10;     // per address per window
const MAX_BAD_CODES = 5;    // wrong pilot codes per address per window
const MAX_PENDING = 500;    // stop a flood of requests
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/**
 * Staff sign-up through the join link. Public, but closed unless an admin turned it on and set
 * a pilot code. Collects name, e-mail, job title and branch only (no password). The admin approves
 * (creates the account with a temporary password and the access level they choose) or rejects.
 */
@Injectable()
export class JoinService {
  private hits = new Map<string, { at: number[]; bad: number[] }>();

  constructor(private prisma: PrismaService, private audit: AuditService, private users: UsersService) {}

  private async settings() {
    return this.prisma.joinSetting.findUnique({ where: { id: 'default' } });
  }

  async publicStatus() {
    const s = await this.settings();
    return { open: !!(s?.enabled && s.codeHash) };
  }

  private limiter(ip: string) {
    const now = Date.now();
    const h = this.hits.get(ip) ?? { at: [], bad: [] };
    h.at = h.at.filter((t) => now - t < WINDOW_MS);
    h.bad = h.bad.filter((t) => now - t < WINDOW_MS);
    this.hits.set(ip, h);
    if (this.hits.size > 5000) this.hits.clear();
    return h;
  }

  private tooMany() {
    return new HttpException('Too many attempts. Try again in 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
  }

  async submit(body: JoinBody, ip: string) {
    const h = this.limiter(ip);
    if (h.at.length >= MAX_SUBMITS || h.bad.length >= MAX_BAD_CODES) throw this.tooMany();
    h.at.push(Date.now());

    const s = await this.settings();
    if (!s?.enabled || !s.codeHash) throw new ForbiddenException('The sign-up link is closed.');
    const code = String(body.code || '').trim().toUpperCase();
    if (!code || !(await bcrypt.compare(code, s.codeHash))) {
      h.bad.push(Date.now());
      throw new ForbiddenException('Wrong pilot code.');
    }

    const fullName = String(body.fullName || '').trim().replace(/\s+/g, ' ');
    const email = String(body.email || '').trim().toLowerCase();
    if (fullName.length < 3 || fullName.length > 120) throw new BadRequestException('Enter your full name.');
    if (!EMAIL_RE.test(email) || email.length > 120) throw new BadRequestException('Enter a valid e-mail.');
    const jobTitle = String(body.jobTitle || '');
    if (!JOB_TITLES.some((j) => j.id === jobTitle)) throw new BadRequestException('Choose a job title.');
    const jobTitleOther = jobTitle === 'other' ? String(body.jobTitleOther || '').trim().slice(0, 60) : null;
    if (jobTitle === 'other' && !jobTitleOther) throw new BadRequestException('Write your job title.');
    const branch = String(body.branch || '');
    if (!BRANCHES.some((b) => b.id === branch)) throw new BadRequestException('Choose your branch.');
    const branchOther = branch === 'other' ? String(body.branchOther || '').trim().slice(0, 60) : null;
    if (branch === 'other' && !branchOther) throw new BadRequestException('Write your branch.');

    // Same answer whether or not the e-mail is already known (no account discovery).
    const [existingUser, existingPending, pending] = await Promise.all([
      this.prisma.user.findUnique({ where: { email }, select: { id: true } }),
      this.prisma.staffRequest.findFirst({ where: { email, status: 'pending' }, select: { id: true } }),
      this.prisma.staffRequest.count({ where: { status: 'pending' } }),
    ]);
    if (!existingUser && !existingPending) {
      if (pending >= MAX_PENDING) throw this.tooMany();
      await this.prisma.staffRequest.create({
        data: { fullName, email, jobTitle, jobTitleOther, branch, branchOther },
      });
    }
    return { ok: true };
  }

  // ── Admin ─────────────────────────────────────────────────────────────
  async adminSettings() {
    const s = await this.settings();
    return { enabled: !!s?.enabled, hasCode: !!s?.codeHash, updatedAt: s?.updatedAt ?? null };
  }

  async updateSettings(data: { enabled?: boolean; code?: string }, actor: Actor) {
    const patch: { enabled?: boolean; codeHash?: string } = {};
    if (data.code !== undefined) {
      const code = String(data.code).trim().toUpperCase();
      if (!/^[A-Z0-9-]{4,20}$/.test(code)) throw new BadRequestException('Pilot code: 4–20 letters or digits.');
      patch.codeHash = await bcrypt.hash(code, 10);
    }
    if (data.enabled !== undefined) patch.enabled = data.enabled;
    const current = await this.settings();
    if (patch.enabled && !(patch.codeHash || current?.codeHash)) throw new BadRequestException('Set a pilot code first.');
    await this.prisma.joinSetting.upsert({
      where: { id: 'default' },
      create: { id: 'default', enabled: patch.enabled ?? false, codeHash: patch.codeHash ?? null, updatedById: actor.id },
      update: { ...patch, updatedById: actor.id },
    });
    await this.audit.log('JoinSetting', 'default', 'join_settings_updated', actor, {
      enabled: patch.enabled, codeChanged: !!patch.codeHash,
    });
    return this.adminSettings();
  }

  listRequests(status = 'pending') {
    const st = ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending';
    return this.prisma.staffRequest.findMany({
      where: { status: st as 'pending' | 'approved' | 'rejected' },
      orderBy: { createdAt: st === 'pending' ? 'asc' : 'desc' },
      take: 300,
    });
  }

  private async pendingRequest(id: string) {
    const r = await this.prisma.staffRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Request not found');
    if (r.status !== 'pending') throw new ConflictException('This request was already decided.');
    return r;
  }

  async approve(id: string, data: { role: UserRole; password: string; outcomeReviewer?: boolean }, actor: Actor) {
    const r = await this.pendingRequest(id);
    const user = await this.users.create({
      email: r.email, fullName: r.fullName, role: data.role, password: data.password,
      outcomeReviewer: data.outcomeReviewer,
      jobTitle: r.jobTitle, jobTitleOther: r.jobTitleOther, branch: r.branch, branchOther: r.branchOther,
    }, actor);
    await this.prisma.staffRequest.update({
      where: { id }, data: { status: 'approved', decidedAt: new Date(), decidedById: actor.id, userId: user.id },
    });
    await this.audit.log('StaffRequest', id, 'staff_request_approved', actor, { userId: user.id, role: data.role });
    return user;
  }

  async reject(id: string, actor: Actor) {
    await this.pendingRequest(id);
    await this.prisma.staffRequest.update({ where: { id }, data: { status: 'rejected', decidedAt: new Date(), decidedById: actor.id } });
    await this.audit.log('StaffRequest', id, 'staff_request_rejected', actor, {});
    return { ok: true };
  }
}
