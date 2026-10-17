/**
 * Private triage feedback for nurses (Stage A — no HIS link yet).
 *
 * Reference = the physician's check of the triage level (agreement at "Seen", or a
 * re-triage). A case is "closed" once it is older than `closeDays`; only closed cases count,
 * so a level can still be corrected before it is measured. Accuracy is measured per month.
 *
 * Pure functions: the API passes rows in, nothing here reads a database.
 */

export const FEEDBACK_MIN_CASES = 20;
export const FEEDBACK_CLOSE_DAYS = 7;
export const FEEDBACK_LEARNING_LIMIT = 10;

/**
 * condition_changed: the physician re-triaged because the patient changed after triage.
 * It is shown to the nurse but not counted for or against them.
 */
export type CaseStatus = 'agree' | 'under_triage' | 'over_triage' | 'condition_changed' | 'not_reviewed' | 'open';

export interface FeedbackRecordRow {
  id: string;
  journeyId: string;
  createdAt: Date | string;
  nurseLevel: number | null;
  aiLevel: number | null;
  age: number | null;
  gender: string | null;
  chiefComplaint: string | null;
  hr: number | null;
  bpSystolic: number | null;
  spo2: number | null;
  rr: number | null;
  temperature: number | null;
  gcs: number | null;
  painScore: number | null;
  ticketNo: number | null;
}

export interface FeedbackReviewRow {
  id: string;
  journeyId: string;
  triageRecordId: string | null;
  reviewedLevel: number;
  agreed: boolean;
  reason: string | null;
  conditionChanged?: boolean;
  reviewerRole: string;
  createdAt: Date | string;
}

export interface FeedbackAckRow {
  reviewId: string;
  action: string;
  comment: string | null;
  createdAt: Date | string;
}

export interface FeedbackCase {
  id: string;
  ticket: string | null;
  date: string;
  ageBand: string | null;
  sex: string | null;
  complaint: string | null;
  vitals: string;
  nurseLevel: number | null;
  aiLevel: number | null;
  reviewedLevel: number | null;
  reviewerRole: string | null;
  reason: string | null;
  reviewId: string | null;
  status: CaseStatus;
  response: { action: string; comment: string | null } | null;
}

export interface MonthSummary {
  month: string;
  cases: number;
  closed: number;
  reviewed: number;
  agree: number;
  underTriage: number;
  overTriage: number;
  /** null below FEEDBACK_MIN_CASES reviewed cases: too few to mean anything. */
  accuracyPct: number | null;
  aiAgreePct: number | null;
}

const toDate = (d: Date | string) => (d instanceof Date ? d : new Date(d));

/** 'YYYY-MM' in Riyadh time (UTC+3, no daylight saving). */
export function monthKey(d: Date | string): string {
  const t = new Date(toDate(d).getTime() + 3 * 3600 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function ageBand(age: number | null): string | null {
  if (age == null) return null;
  if (age < 1) return '< 1 y';
  if (age < 5) return '1–4 y';
  if (age < 14) return '5–13 y';
  if (age < 18) return '14–17 y';
  if (age < 40) return '18–39 y';
  if (age < 65) return '40–64 y';
  return '65+ y';
}

/** Lower CTAS number = more urgent. Reviewer more urgent than the nurse = under-triage. */
export function caseStatus(nurseLevel: number | null, review: FeedbackReviewRow | null, closed: boolean): CaseStatus {
  if (!closed) return 'open';
  if (!review || nurseLevel == null) return 'not_reviewed';
  if (review.reviewedLevel === nurseLevel) return 'agree';
  if (review.conditionChanged) return 'condition_changed';
  return review.reviewedLevel < nurseLevel ? 'under_triage' : 'over_triage';
}

function vitalsText(r: FeedbackRecordRow): string {
  return [
    r.hr != null ? `HR ${r.hr}` : null,
    r.bpSystolic != null ? `SBP ${r.bpSystolic}` : null,
    r.spo2 != null ? `SpO₂ ${r.spo2}` : null,
    r.rr != null ? `RR ${r.rr}` : null,
    r.temperature != null ? `T ${r.temperature}` : null,
    r.gcs != null ? `GCS ${r.gcs}` : null,
    r.painScore != null ? `pain ${r.painScore}/10` : null,
  ].filter(Boolean).join(' · ');
}

/** Latest review per triage record (or per journey when the review has no record id). */
function latestReviewFor(r: FeedbackRecordRow, reviews: FeedbackReviewRow[]): FeedbackReviewRow | null {
  const mine = reviews.filter((v) => v.triageRecordId === r.id || (!v.triageRecordId && v.journeyId === r.journeyId));
  if (!mine.length) return null;
  return mine.sort((a, b) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime())[0];
}

export function summarise(month: string, cases: FeedbackCase[], aiAgree: number, aiCompared: number): MonthSummary {
  const closed = cases.filter((c) => c.status !== 'open');
  const reviewed = closed.filter((c) => c.status === 'agree' || c.status === 'under_triage' || c.status === 'over_triage');
  const agree = reviewed.filter((c) => c.status === 'agree').length;
  return {
    month,
    cases: cases.length,
    closed: closed.length,
    reviewed: reviewed.length,
    agree,
    underTriage: reviewed.filter((c) => c.status === 'under_triage').length,
    overTriage: reviewed.filter((c) => c.status === 'over_triage').length,
    accuracyPct: reviewed.length >= FEEDBACK_MIN_CASES ? Math.round((agree / reviewed.length) * 100) : null,
    aiAgreePct: aiCompared >= FEEDBACK_MIN_CASES ? Math.round((aiAgree / aiCompared) * 100) : null,
  };
}

/** Cases for one month. */
export function buildCases(
  records: FeedbackRecordRow[],
  reviews: FeedbackReviewRow[],
  acks: FeedbackAckRow[],
  { now = new Date(), closeDays = FEEDBACK_CLOSE_DAYS }: { now?: Date; closeDays?: number } = {},
) {
  let aiAgree = 0;
  let aiCompared = 0;
  const cases: FeedbackCase[] = records.map((r) => {
    const review = latestReviewFor(r, reviews);
    const closed = now.getTime() - toDate(r.createdAt).getTime() >= closeDays * 86400000;
    const status = caseStatus(r.nurseLevel, review, closed);
    if (closed && review && r.aiLevel != null && status !== 'condition_changed') {
      aiCompared += 1;
      if (r.aiLevel === review.reviewedLevel) aiAgree += 1;
    }
    const ack = review ? acks.find((a) => a.reviewId === review.id) : undefined;
    return {
      id: r.id,
      ticket: r.ticketNo != null ? `T${String(r.ticketNo % 1000).padStart(3, '0')}` : null,
      date: toDate(r.createdAt).toISOString().slice(0, 10),
      ageBand: ageBand(r.age),
      sex: r.gender,
      complaint: r.chiefComplaint,
      vitals: vitalsText(r),
      nurseLevel: r.nurseLevel,
      aiLevel: r.aiLevel,
      reviewedLevel: review?.reviewedLevel ?? null,
      reviewerRole: review?.reviewerRole ?? null,
      reason: review?.reason ?? null,
      reviewId: review?.id ?? null,
      status,
      response: ack ? { action: ack.action, comment: ack.comment } : null,
    };
  });
  return { cases, aiAgree, aiCompared };
}

/** Learning cases: closed disagreements, newest first, unanswered first. */
export function learningCases(cases: FeedbackCase[], limit = FEEDBACK_LEARNING_LIMIT) {
  return cases
    .filter((c) => c.status === 'under_triage' || c.status === 'over_triage')
    .sort((a, b) => (a.response ? 1 : 0) - (b.response ? 1 : 0) || b.date.localeCompare(a.date))
    .slice(0, limit);
}
