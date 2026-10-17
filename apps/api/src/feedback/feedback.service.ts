import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FEEDBACK_CLOSE_DAYS, buildCases, learningCases, monthKey, previousMonth, summarise,
  type FeedbackRecordRow, type FeedbackReviewRow,
} from '@triagepulse/clinical';
import { PrismaService } from '../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';

type User = { id: string; role: string; full_name?: string; email?: string };

/** Month bounds in Riyadh time (UTC+3), as UTC instants. */
function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - 3 * 3600 * 1000);
  const end = new Date(Date.UTC(y, m, 1) - 3 * 3600 * 1000);
  return { start, end };
}

function validMonth(month?: string) {
  const m = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : monthKey(new Date());
  return m;
}

@Injectable()
export class FeedbackService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private closeDays() {
    const n = Number(process.env.FEEDBACK_CLOSE_DAYS);
    return Number.isFinite(n) && n >= 0 ? n : FEEDBACK_CLOSE_DAYS;
  }

  private async monthData(month: string, nurseId?: string) {
    const { start, end } = monthRange(month);
    const rows = await this.prisma.triageRecord.findMany({
      where: { createdAt: { gte: start, lt: end }, ...(nurseId ? { createdById: nurseId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { journey: { select: { ticketNo: true } } },
    });
    const records: FeedbackRecordRow[] = rows.map((r) => ({
      id: r.id, journeyId: r.journeyId, createdAt: r.createdAt,
      nurseLevel: r.nurseCtas ?? r.ctasLevel, aiLevel: r.aiCtas ?? r.aiRecommendedCtas,
      age: r.age, gender: r.gender, chiefComplaint: r.chiefComplaint,
      hr: r.hr, bpSystolic: r.bpSystolic, spo2: r.spo2, rr: r.rr, temperature: r.temperature, gcs: r.gcs, painScore: r.painScore,
      ticketNo: r.journey?.ticketNo ?? null,
    }));
    const journeyIds = [...new Set(records.map((r) => r.journeyId))];
    const reviewRows = journeyIds.length
      ? await this.prisma.ctasReview.findMany({ where: { journeyId: { in: journeyIds } } })
      : [];
    const reviews: FeedbackReviewRow[] = reviewRows.map((v) => ({
      id: v.id, journeyId: v.journeyId, triageRecordId: v.triageRecordId, reviewedLevel: v.reviewedLevel,
      agreed: v.agreed, reason: v.reason, conditionChanged: v.conditionChanged, reviewerRole: v.reviewerRole, createdAt: v.createdAt,
    }));
    const acks = reviews.length
      ? await this.prisma.triageFeedback.findMany({ where: { reviewId: { in: reviews.map((r) => r.id) } } })
      : [];
    return { records, reviews, acks };
  }

  /** The signed-in user's own cases only. Nobody else's are ever returned here. */
  async mine(user: User, monthParam?: string) {
    const month = validMonth(monthParam);
    const prev = previousMonth(month);
    const now = new Date();
    const cur = await this.monthData(month, user.id);
    const last = await this.monthData(prev, user.id);
    const c = buildCases(cur.records, cur.reviews, cur.acks.filter((a) => a.nurseId === user.id), { now, closeDays: this.closeDays() });
    const p = buildCases(last.records, last.reviews, [], { now, closeDays: this.closeDays() });
    return {
      month,
      closeDays: this.closeDays(),
      summary: summarise(month, c.cases, c.aiAgree, c.aiCompared),
      previous: summarise(prev, p.cases, p.aiAgree, p.aiCompared),
      learning: learningCases(c.cases),
      pendingResponses: c.cases.filter((x) => (x.status === 'under_triage' || x.status === 'over_triage') && !x.response).length,
    };
  }

  /** Understood or disputed — only on a review of the nurse's own triage. */
  async respond(user: User, reviewId: string, action: string, comment?: string) {
    if (action !== 'understood' && action !== 'disputed') throw new BadRequestException('Choose understood or disputed');
    const text = String(comment || '').trim().slice(0, 500) || null;
    if (action === 'disputed' && !text) throw new BadRequestException('Say briefly why you disagree');
    const review = await this.prisma.ctasReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Case not found');
    const record = review.triageRecordId
      ? await this.prisma.triageRecord.findUnique({ where: { id: review.triageRecordId } })
      : await this.prisma.triageRecord.findFirst({ where: { journeyId: review.journeyId }, orderBy: { createdAt: 'desc' } });
    if (!record || record.createdById !== user.id) throw new ForbiddenException('Only the nurse who triaged can respond');
    const saved = await this.prisma.triageFeedback.upsert({
      where: { reviewId_nurseId: { reviewId, nurseId: user.id } },
      create: { reviewId, nurseId: user.id, action, comment: text },
      update: { action, comment: text },
    });
    await this.audit.log('CtasReview', reviewId, `feedback_${action}`, user, {});
    return saved;
  }

  /** Department totals and disputed cases, with no nurse or physician names. */
  async department(monthParam?: string) {
    const month = validMonth(monthParam);
    const prev = previousMonth(month);
    const now = new Date();
    const cur = await this.monthData(month);
    const last = await this.monthData(prev);
    const c = buildCases(cur.records, cur.reviews, cur.acks, { now, closeDays: this.closeDays() });
    const p = buildCases(last.records, last.reviews, [], { now, closeDays: this.closeDays() });
    const disputes = c.cases
      .filter((x) => x.response?.action === 'disputed')
      .map(({ response, ...rest }) => ({ ...rest, nurseComment: response?.comment ?? null }));
    return {
      month,
      summary: summarise(month, c.cases, c.aiAgree, c.aiCompared),
      previous: summarise(prev, p.cases, p.aiAgree, p.aiCompared),
      disputes,
    };
  }
}
