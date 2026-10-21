import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FEEDBACK_CLOSE_DAYS, buildCases, departmentBreakdown, learningCases, monthKey, monthRange, previousMonth, previousWeek,
  summarise, weekKey, weekRange,
  type FeedbackRecordRow, type FeedbackReviewRow,
} from '@triagepulse/clinical';
import { PrismaService } from '../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';

type User = { id: string; role: string; full_name?: string; email?: string };

function validWeek(week?: string) {
  if (week && /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(week)) {
    const [y, m, d] = week.split('-').map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d));
    if (utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d) {
      return weekKey(new Date(Date.UTC(y, m - 1, d, 12) - 3 * 3600 * 1000));
    }
  }
  return weekKey(new Date());
}

function validMonth(month?: string) {
  return month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : monthKey(new Date());
}

@Injectable()
export class FeedbackService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private closeDays() {
    const n = Number(process.env.FEEDBACK_CLOSE_DAYS);
    return Number.isFinite(n) && n >= 0 ? n : FEEDBACK_CLOSE_DAYS;
  }

  private async periodData(start: Date, end: Date, nurseId?: string) {
    const rows = await this.prisma.triageRecord.findMany({
      where: { createdAt: { gte: start, lt: end }, ...(nurseId ? { createdById: nurseId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { journey: { select: { ticketNo: true, mrnSuffix: true } } },
    });
    const records: FeedbackRecordRow[] = rows.map((r) => ({
      id: r.id, journeyId: r.journeyId, createdAt: r.createdAt,
      nurseLevel: r.nurseCtas ?? r.ctasLevel, aiLevel: r.aiCtas ?? r.aiRecommendedCtas,
      age: r.age, gender: r.gender, chiefComplaint: r.chiefComplaint,
      hr: r.hr, bpSystolic: r.bpSystolic, spo2: r.spo2, rr: r.rr, temperature: r.temperature, gcs: r.gcs, painScore: r.painScore,
      ticketNo: r.journey?.ticketNo ?? null,
      mrnSuffix: r.journey?.mrnSuffix ?? null,
      ctasStartedAt: r.ctasStartedAt,
      ctasCompletedAt: r.ctasCompletedAt,
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
  async mine(user: User, weekParam?: string) {
    const week = validWeek(weekParam);
    const prev = previousWeek(week);
    const now = new Date();
    const cur = await this.periodData(weekRange(week).start, weekRange(week).end, user.id);
    const last = await this.periodData(weekRange(prev).start, weekRange(prev).end, user.id);
    const c = buildCases(cur.records, cur.reviews, cur.acks.filter((a) => a.nurseId === user.id), { now, closeDays: this.closeDays() });
    const p = buildCases(last.records, last.reviews, [], { now, closeDays: this.closeDays() });
    return {
      week,
      closeDays: this.closeDays(),
      summary: summarise(week, c.cases, c.aiAgree, c.aiCompared),
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
  async department(weekParam?: string, monthParam?: string) {
    const periodType = monthParam ? 'month' : 'week';
    const period = periodType === 'month' ? validMonth(monthParam) : validWeek(weekParam);
    const prev = periodType === 'month' ? previousMonth(period) : previousWeek(period);
    const now = new Date();
    const curRange = periodType === 'month' ? monthRange(period) : weekRange(period);
    const prevRange = periodType === 'month' ? monthRange(prev) : weekRange(prev);
    const cur = await this.periodData(curRange.start, curRange.end);
    const last = await this.periodData(prevRange.start, prevRange.end);
    const c = buildCases(cur.records, cur.reviews, cur.acks, { now, closeDays: this.closeDays() });
    const p = buildCases(last.records, last.reviews, [], { now, closeDays: this.closeDays() });
    const disputes = c.cases
      .filter((x) => x.response?.action === 'disputed')
      .map(({ response, ...rest }) => ({ ...rest, nurseComment: response?.comment ?? null }));
    // Physician CTAS 1–2 where triage gave 3–5: listed for case review, without names.
    const highRisk = c.cases
      .filter((x) => x.status === 'under_triage' && (x.reviewedLevel ?? 9) <= 2 && (x.nurseLevel ?? 0) >= 3)
      .map(({ response, ...rest }) => ({ ...rest, nurseResponse: response?.action ?? null }));
    return {
      periodType,
      week: periodType === 'week' ? period : undefined,
      month: periodType === 'month' ? period : undefined,
      closeDays: this.closeDays(),
      summary: summarise(period, c.cases, c.aiAgree, c.aiCompared),
      previous: summarise(prev, p.cases, p.aiAgree, p.aiCompared),
      breakdown: departmentBreakdown(c.cases),
      highRisk,
      disputes,
    };
  }
}
