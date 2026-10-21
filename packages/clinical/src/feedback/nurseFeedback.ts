import { triageDurationSec } from '../utils/shared.js';

/**
 * Private triage feedback for nurses (Stage A — no HIS link yet).
 *
 * Reference = the physician's validation of the nurse CTAS (agree, or a different level).
 * A case is "closed" once it is older than `closeDays`; only closed cases count,
 * so a level can still be corrected before it is measured. Accuracy is measured per
 * Riyadh calendar week (Sunday–Saturday, UTC+3) once 20 reviewed cases are in.
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
/** Quick-pick reasons for a physician re-triage (stored by their English label). */
export const REVIEW_REASONS: ReadonlyArray<{ en: string; ar: string }> = [
  { en: 'Vital signs', ar: 'العلامات الحيوية' },
  { en: 'Pain', ar: 'شدة الألم' },
  { en: 'Red flag / history', ar: 'علامة خطر / القصة' },
  { en: 'Age / risk factor', ar: 'العمر / عامل خطورة' },
  { en: 'Less urgent than rated', ar: 'أقل خطورة مما قُدّر' },
];

/** Reason text as saved: quick picks joined by ", ", then " — " and the free note. */
export function reasonText(picks: string[], note?: string | null): string {
  return [picks.join(', '), String(note || '').trim()].filter(Boolean).join(' — ');
}

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
  mrnSuffix?: string | null;
  ctasStartedAt?: Date | string | null;
  ctasCompletedAt?: Date | string | null;
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
  triageDurationSec: number | null;
}

export interface WeekSummary {
  week: string;
  cases: number;
  closed: number;
  reviewed: number;
  agree: number;
  underTriage: number;
  overTriage: number;
  /** null below FEEDBACK_MIN_CASES reviewed cases: too few to mean anything. Exact-match = agreement. */
  accuracyPct: number | null;
  aiAgreePct: number | null;
  /** Share of reviewed cases. Null when nothing has been reviewed. */
  underPct: number | null;
  overPct: number | null;
  /** Mean CTAS start → CTAS complete, in seconds. Null when no timestamps. */
  meanTriageDurationSec: number | null;
}

const toDate = (d: Date | string) => (d instanceof Date ? d : new Date(d));

const ymd = (t: Date) =>
  `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;

/** 'YYYY-MM' in Riyadh time (UTC+3, no daylight saving). */
export function monthKey(d: Date | string): string {
  const t = new Date(toDate(d).getTime() + 3 * 3600 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * Sunday of the Riyadh week that contains `d`, as YYYY-MM-DD (the Riyadh calendar date).
 * Weeks run Sunday 00:00 – Saturday 24:00 Arabia Standard Time (UTC+3).
 */
export function weekKey(d: Date | string): string {
  const t = new Date(toDate(d).getTime() + 3 * 3600 * 1000);
  const sunday = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - t.getUTCDay()));
  return ymd(sunday);
}

export function previousWeek(week: string): string {
  return shiftWeek(week, -1);
}

export function shiftWeek(week: string, delta: number): string {
  const [y, m, d] = week.split('-').map(Number);
  return ymd(new Date(Date.UTC(y, m - 1, d + delta * 7)));
}

/** Instant bounds of a Sunday–Saturday Riyadh week, as UTC. */
export function weekRange(week: string): { start: Date; end: Date } {
  const [y, m, d] = week.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d) - 3 * 3600 * 1000);
  return { start, end: new Date(start.getTime() + 7 * 86400000) };
}

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Instant bounds of a Riyadh calendar month, as UTC. */
export function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - 3 * 3600 * 1000);
  const end = new Date(Date.UTC(y, m, 1) - 3 * 3600 * 1000);
  return { start, end };
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_AR[m - 1]} ${y} · ${MONTHS_EN[m - 1]} ${y}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function weekLabel(week: string): string {
  const [y, m, d] = week.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  const end = new Date(Date.UTC(y, m - 1, d + 6));
  const same = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();
  if (same) {
    return `${start.getUTCDate()}–${end.getUTCDate()} ${MONTHS_AR[start.getUTCMonth()]} ${start.getUTCFullYear()} · ${start.getUTCDate()}–${end.getUTCDate()} ${MONTHS_EN[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
  }
  return `${start.getUTCDate()} ${MONTHS_AR[start.getUTCMonth()]} ${start.getUTCFullYear()} – ${end.getUTCDate()} ${MONTHS_AR[end.getUTCMonth()]} ${end.getUTCFullYear()} · ${start.getUTCDate()} ${MONTHS_EN[start.getUTCMonth()]} ${start.getUTCFullYear()} – ${end.getUTCDate()} ${MONTHS_EN[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
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

export function summarise(week: string, cases: FeedbackCase[], aiAgree: number, aiCompared: number): WeekSummary {
  const closed = cases.filter((c) => c.status !== 'open');
  const reviewed = closed.filter((c) => c.status === 'agree' || c.status === 'under_triage' || c.status === 'over_triage');
  const agree = reviewed.filter((c) => c.status === 'agree').length;
  const underTriage = reviewed.filter((c) => c.status === 'under_triage').length;
  const overTriage = reviewed.filter((c) => c.status === 'over_triage').length;
  const durations = cases.map((c) => c.triageDurationSec).filter((n): n is number => n != null && n >= 0);
  return {
    week,
    cases: cases.length,
    closed: closed.length,
    reviewed: reviewed.length,
    agree,
    underTriage,
    overTriage,
    accuracyPct: reviewed.length >= FEEDBACK_MIN_CASES ? Math.round((agree / reviewed.length) * 100) : null,
    aiAgreePct: aiCompared >= FEEDBACK_MIN_CASES ? Math.round((aiAgree / aiCompared) * 100) : null,
    underPct: reviewed.length ? Math.round((underTriage / reviewed.length) * 100) : null,
    overPct: reviewed.length ? Math.round((overTriage / reviewed.length) * 100) : null,
    meanTriageDurationSec: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null,
  };
}

/** Cases for one week. */
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
      ticket: r.ticketNo != null
        ? `T${String(r.ticketNo % 1000).padStart(3, '0')}-${/^\d{3}$/.test(String(r.mrnSuffix || '')) ? r.mrnSuffix : '•••'}`
        : null,
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
      triageDurationSec: triageDurationSec(r.ctasStartedAt, r.ctasCompletedAt),
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

export interface DepartmentBreakdown {
  /** matrix[nurseLevel-1][reviewedLevel-1] = closed reviewed cases (condition-changed excluded). */
  matrix: number[][];
  /** Physician CTAS 1–2 where the nurse gave 3–5: the under-triage that matters most. */
  highRiskUnder: number;
  conditionChanged: number;
  /** Share of closed cases a physician checked (agree or re-triage). null when nothing is closed. */
  coveragePct: number | null;
  /** Re-triage reasons (the quick-pick part before " — "), most common first. */
  reasons: Array<{ reason: string; count: number }>;
  responses: { understood: number; disputed: number; pending: number };
}

/** Department-level breakdown of one week's cases. No nurse or patient identity is used. */
export function departmentBreakdown(cases: FeedbackCase[]): DepartmentBreakdown {
  const matrix = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
  let highRiskUnder = 0;
  let conditionChanged = 0;
  let checked = 0;
  let closed = 0;
  const reasonCount = new Map<string, number>();
  const responses = { understood: 0, disputed: 0, pending: 0 };
  for (const c of cases) {
    if (c.status === 'open') continue;
    closed += 1;
    if (c.status === 'not_reviewed') continue;
    checked += 1;
    if (c.status === 'condition_changed') { conditionChanged += 1; continue; }
    const n = c.nurseLevel;
    const r = c.reviewedLevel;
    if (n != null && r != null && n >= 1 && n <= 5 && r >= 1 && r <= 5) matrix[n - 1][r - 1] += 1;
    if (c.status === 'under_triage' || c.status === 'over_triage') {
      if (c.status === 'under_triage' && r != null && r <= 2 && n != null && n >= 3) highRiskUnder += 1;
      const text = String(c.reason || '');
      const picked = REVIEW_REASONS.map((r) => r.en).filter((en) => text.includes(en));
      for (const part of picked.length ? picked : ['Other']) {
        reasonCount.set(part, (reasonCount.get(part) || 0) + 1);
      }
      if (c.response?.action === 'understood') responses.understood += 1;
      else if (c.response?.action === 'disputed') responses.disputed += 1;
      else responses.pending += 1;
    }
  }
  return {
    matrix,
    highRiskUnder,
    conditionChanged,
    coveragePct: closed ? Math.round((checked / closed) * 100) : null,
    reasons: [...reasonCount.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    responses,
  };
}
