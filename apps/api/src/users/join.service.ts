import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { BRANCHES, JOB_TITLES } from '@triagepulse/clinical';
import { PrismaService } from '../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import { UsersService } from './users.service';
import { passwordProblem } from '../auth/password-policy';

type Actor = { id: string; role: string; full_name?: string; email?: string };

export type JoinBody = {
  fullName: string; email: string; password: string;
  jobTitle: string; jobTitleOther?: string; branch: string; branchOther?: string;
};

const WINDOW_MS = 15 * 60 * 1000;
const MAX_SUBMITS = 10;     // per address per window
const MAX_PENDING = 500;    // stop a flood of requests
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/**
 * Staff sign-up through the join link (public; the admin can close it). The person gives name, e-mail, job title, branch and their own password (kept
 * hashed; nobody sees it). Nothing works until the admin approves: approval creates the account
 * with that password and the access level the admin chooses. Reject deletes the password.
 */
@Injectable()
export class JoinService {
  private hits = new Map<string, { at: number[] }>();

  constructor(private prisma: PrismaService, private audit: AuditService, private users: UsersService) {}

  private async settings() {
    return this.prisma.joinSetting.findUnique({ where: { id: 'default' } });
  }

  async publicStatus() {
    const s = await this.settings();
    return { open: s ? s.enabled : true };
  }

  private limiter(ip: string) {
    const now = Date.now();
    const h = this.hits.get(ip) ?? { at: [] };
    h.at = h.at.filter((t) => now - t < WINDOW_MS);
    this.hits.set(ip, h);
    if (this.hits.size > 5000) this.hits.clear();
    return h;
  }

  private tooMany() {
    return new HttpException('Too many attempts. Try again in 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
  }

  async submit(body: JoinBody, ip: string) {
    const h = this.limiter(ip);
    if (h.at.length >= MAX_SUBMITS) throw this.tooMany();
    h.at.push(Date.now());

    const s = await this.settings();
    if (s && !s.enabled) throw new ForbiddenException('Sign-up is closed. Contact the TriagePulse admin.');

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
    const pwProblem = passwordProblem(String(body.password || ''), email);
    if (pwProblem) throw new BadRequestException(pwProblem);

    // Same answer whether or not the e-mail is already known (no account discovery).
    const [existingUser, existingPending, pending] = await Promise.all([
      this.prisma.user.findUnique({ where: { email }, select: { id: true } }),
      this.prisma.staffRequest.findFirst({ where: { email, status: 'pending' }, select: { id: true } }),
      this.prisma.staffRequest.count({ where: { status: 'pending' } }),
    ]);
    if (!existingUser && !existingPending) {
      if (pending >= MAX_PENDING) throw this.tooMany();
      await this.prisma.staffRequest.create({
        data: { fullName, email, jobTitle, jobTitleOther, branch, branchOther, passwordHash: await bcrypt.hash(String(body.password), 10) },
      });
    }
    return { ok: true };
  }

  // ── Admin ─────────────────────────────────────────────────────────────
  async adminSettings() {
    const s = await this.settings();
    return { enabled: s ? s.enabled : true, updatedAt: s?.updatedAt ?? null };
  }

  async updateSettings(data: { enabled?: boolean }, actor: Actor) {
    if (data.enabled === undefined) return this.adminSettings();
    await this.prisma.joinSetting.upsert({
      where: { id: 'default' },
      create: { id: 'default', enabled: data.enabled, updatedById: actor.id },
      update: { enabled: data.enabled, updatedById: actor.id },
    });
    await this.audit.log('JoinSetting', 'default', 'join_settings_updated', actor, { enabled: data.enabled });
    return this.adminSettings();
  }

  listRequests(status = 'pending') {
    const st = ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending';
    return this.prisma.staffRequest.findMany({
      where: { status: st as 'pending' | 'approved' | 'rejected' },
      // Never send the password hash to the browser.
      select: {
        id: true, fullName: true, email: true, jobTitle: true, jobTitleOther: true, branch: true, branchOther: true,
        status: true, createdAt: true, decidedAt: true,
      },
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

  async approve(id: string, data: { role: UserRole; outcomeReviewer?: boolean }, actor: Actor) {
    const r = await this.pendingRequest(id);
    if (!r.passwordHash) throw new BadRequestException('This request has no password; ask the person to sign up again.');
    const user = await this.users.create({
      email: r.email, fullName: r.fullName, role: data.role, passwordHash: r.passwordHash,
      outcomeReviewer: data.outcomeReviewer,
      jobTitle: r.jobTitle, jobTitleOther: r.jobTitleOther, branch: r.branch, branchOther: r.branchOther,
    }, actor);
    await this.prisma.staffRequest.update({
      where: { id }, data: { status: 'approved', decidedAt: new Date(), decidedById: actor.id, userId: user.id, passwordHash: null },
    });
    await this.audit.log('StaffRequest', id, 'staff_request_approved', actor, { userId: user.id, role: data.role });
    return user;
  }

  async reject(id: string, actor: Actor) {
    await this.pendingRequest(id);
    await this.prisma.staffRequest.update({ where: { id }, data: { status: 'rejected', decidedAt: new Date(), decidedById: actor.id, passwordHash: null } });
    await this.audit.log('StaffRequest', id, 'staff_request_rejected', actor, {});
    return { ok: true };
  }
}
