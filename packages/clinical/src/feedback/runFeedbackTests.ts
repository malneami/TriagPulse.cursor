import {
  buildCases, caseStatus, departmentBreakdown, reasonText, learningCases, monthKey, previousMonth, summarise, ageBand,
  FEEDBACK_MIN_CASES, type FeedbackRecordRow, type FeedbackReviewRow,
} from './nurseFeedback.js';

type Assert = (cond: boolean, id: string, name: string, detail?: string) => void;

const rec = (id: string, daysAgo: number, nurse: number | null, ai: number | null, now: Date, extra: Partial<FeedbackRecordRow> = {}): FeedbackRecordRow => ({
  id, journeyId: `j-${id}`, createdAt: new Date(now.getTime() - daysAgo * 86400000), nurseLevel: nurse, aiLevel: ai,
  age: 40, gender: 'male', chiefComplaint: 'abdominal pain', hr: 90, bpSystolic: 120, spo2: 98, rr: 16, temperature: 37,
  gcs: 15, painScore: 5, ticketNo: 1042, ...extra,
});
const rev = (id: string, recId: string, level: number, agreed: boolean, reason: string | null = null): FeedbackReviewRow => ({
  id, journeyId: `j-${recId}`, triageRecordId: recId, reviewedLevel: level, agreed, reason, reviewerRole: 'physician', createdAt: new Date(),
});

export function runFeedbackTests(assert: Assert) {
  const now = new Date('2026-10-20T12:00:00Z');
  assert(caseStatus(3, rev('r', 'a', 3, true), true) === 'agree', 'FB-01', 'Same level → agree');
  assert(caseStatus(3, rev('r', 'a', 2, false), true) === 'under_triage', 'FB-02', 'Physician more urgent → under-triage');
  assert(caseStatus(2, rev('r', 'a', 4, false), true) === 'over_triage', 'FB-03', 'Physician less urgent → over-triage');
  assert(caseStatus(3, null, true) === 'not_reviewed' && caseStatus(3, rev('r', 'a', 2, false), false) === 'open', 'FB-04', 'No review → not reviewed; younger than close window → open');

  const records = [rec('a', 10, 3, 3, now), rec('b', 9, 3, 2, now), rec('c', 8, 2, 2, now), rec('d', 2, 4, 4, now), rec('e', 9, 5, 5, now)];
  const reviews = [rev('ra', 'a', 3, true), rev('rb', 'b', 2, false, 'chest pain with diaphoresis'), rev('rc', 'c', 4, false, 'pain settled'), rev('rd', 'd', 2, false)];
  const { cases, aiAgree, aiCompared } = buildCases(records, reviews, [{ reviewId: 'rb', action: 'understood', comment: null, createdAt: now }], { now, closeDays: 7 });
  const by = Object.fromEntries(cases.map((c) => [c.id, c.status]));
  assert(by.a === 'agree' && by.b === 'under_triage' && by.c === 'over_triage' && by.d === 'open' && by.e === 'not_reviewed', 'FB-05', 'Statuses from reviews and the 7-day close window', JSON.stringify(by));
  assert(aiCompared === 3 && aiAgree === 2, 'FB-06', 'AI compared with the physician on closed reviewed cases only', `${aiAgree}/${aiCompared}`);
  const s = summarise('2026-10', cases, aiAgree, aiCompared);
  assert(s.reviewed === 3 && s.agree === 1 && s.underTriage === 1 && s.overTriage === 1 && s.accuracyPct === null, 'FB-07', `Accuracy hidden below ${FEEDBACK_MIN_CASES} reviewed cases`, JSON.stringify(s));
  const many = Array.from({ length: 20 }, (_, i) => rec(`m${i}`, 10, 3, 3, now));
  const manyRev = many.map((r, i) => rev(`mr${i}`, r.id, i < 17 ? 3 : 2, i < 17));
  const big = buildCases(many, manyRev, [], { now });
  assert(summarise('2026-10', big.cases, big.aiAgree, big.aiCompared).accuracyPct === 85, 'FB-08', '17 of 20 agree → 85%');
  const learn = learningCases(cases);
  assert(learn.length === 2 && learn[0].id === 'c' && learn[1].response?.action === 'understood', 'FB-09', 'Learning cases: disagreements only, unanswered first');
  const c = cases.find((x) => x.id === 'b')!;
  assert(c.ticket === 'T042' && c.ageBand === '40–64 y' && !('patientName' in c) && !JSON.stringify(c).includes('mrn'), 'FB-10', 'Cases carry a ticket code and age band, never a name or record number');
  const changed = buildCases([rec('x', 10, 3, 3, now)], [{ ...rev('rx', 'x', 2, false, 'deteriorated'), conditionChanged: true }], [], { now });
  const cs = summarise('2026-10', changed.cases, changed.aiAgree, changed.aiCompared);
  assert(changed.cases[0].status === 'condition_changed' && cs.reviewed === 0 && cs.underTriage === 0 && learningCases(changed.cases).length === 0, 'FB-12', 'Condition changed after triage: shown, not counted against the nurse');
  const deptRecs = [rec('d1', 10, 3, 3, now), rec('d2', 10, 4, 2, now), rec('d3', 10, 2, 2, now), rec('d4', 10, 3, 3, now), rec('d5', 10, 3, 3, now), rec('d6', 1, 3, 3, now)];
  const deptRevs = [
    rev('v1', 'd1', 3, true),
    rev('v2', 'd2', 2, false, reasonText(['Vital signs', 'Pain'], 'HR 130')),
    rev('v3', 'd3', 4, false, reasonText([], 'looked well')),
    { ...rev('v4', 'd4', 1, false, 'seizure in waiting room'), conditionChanged: true },
  ];
  const dc = buildCases(deptRecs, deptRevs, [{ reviewId: 'v2', action: 'disputed', comment: 'x', createdAt: now }], { now });
  const b = departmentBreakdown(dc.cases);
  assert(b.matrix[2][2] === 1 && b.matrix[3][1] === 1 && b.matrix[1][3] === 1 && b.highRiskUnder === 1 && b.conditionChanged === 1 && b.coveragePct === 80,
    'FB-13', 'Department matrix, high-risk under-triage (physician 1–2, nurse 3–5), condition-changed apart, review coverage', JSON.stringify(b));
  assert(b.reasons.length === 3 && b.reasons.every((r) => r.count === 1) && b.reasons.some((r) => r.reason === 'Other') && b.responses.disputed === 1 && b.responses.pending === 1,
    'FB-14', 'Reasons counted from the quick picks (free text → Other); responses counted', JSON.stringify({ r: b.reasons, s: b.responses }));
  assert(monthKey('2026-10-31T22:30:00Z') === '2026-11' && previousMonth('2026-01') === '2025-12' && ageBand(0.5) === '< 1 y', 'FB-11', 'Month in Riyadh time; previous month; age bands');
}
