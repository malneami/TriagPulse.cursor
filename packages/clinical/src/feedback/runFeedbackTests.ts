import {
  buildCases, caseStatus, departmentBreakdown, reasonText, learningCases, weekKey, previousWeek, weekRange, monthRange, summarise, ageBand,
  FEEDBACK_MIN_CASES, type FeedbackRecordRow, type FeedbackReviewRow,
} from './nurseFeedback.js';
import { triageDurationSec } from '../utils/shared.js';
import { physicianMayAct } from './journeyOwnership.js';
import { hasHisEncounter, physicianValidationEligible, statusAfterCtasComplete } from './hisHandoff.js';
import {
  highAcuityOutcome, normalizeIcd10, normalizeOutcomeReview, outcomeCloseProblem, outcomeReviewEligible,
  outcomeReviewMayAct, outcomeReviewVisible, resourceCount,
} from './outcomeHandoff.js';
import { computeEvaluationReport, referenceSource } from '../analytics/computeEvaluation.js';
import { computeSystemNurseComparison, overrideWinner, systemCtasOf, versusLevel, versusOutcome } from '../analytics/systemVsNurse.js';
import { ageFromText, mrnSuffixFromBarcode, mrnSuffixFromText, patientNoFromBarcode, patientNoFromText, transactionNoFromText, visitNumberFromText } from './ticketText.js';

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
  const s = summarise('2026-10-18', cases, aiAgree, aiCompared);
  assert(s.reviewed === 3 && s.agree === 1 && s.underTriage === 1 && s.overTriage === 1 && s.accuracyPct === null, 'FB-07', `Accuracy hidden below ${FEEDBACK_MIN_CASES} reviewed cases`, JSON.stringify(s));
  const many = Array.from({ length: 20 }, (_, i) => rec(`m${i}`, 10, 3, 3, now));
  const manyRev = many.map((r, i) => rev(`mr${i}`, r.id, i < 17 ? 3 : 2, i < 17));
  const big = buildCases(many, manyRev, [], { now });
  assert(summarise('2026-10-18', big.cases, big.aiAgree, big.aiCompared).accuracyPct === 85, 'FB-08', '17 of 20 agree → 85%');
  const learn = learningCases(cases);
  assert(learn.length === 2 && learn[0].id === 'c' && learn[1].response?.action === 'understood', 'FB-09', 'Learning cases: disagreements only, unanswered first');
  const c = cases.find((x) => x.id === 'b')!;
  assert(c.ticket === 'T042-•••' && c.ageBand === '40–64 y' && !('patientName' in c) && !JSON.stringify(c).includes('mrn'), 'FB-10', 'Cases carry a ticket code and age band, never a name or record number');
  const changed = buildCases([rec('x', 10, 3, 3, now)], [{ ...rev('rx', 'x', 2, false, 'deteriorated'), conditionChanged: true }], [], { now });
  const cs = summarise('2026-10-18', changed.cases, changed.aiAgree, changed.aiCompared);
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
  const ticket = [
    'OUTPATIENT VISIT TICKET', 'Invoice No.:', 'Transaction No.: 512345678', 'Invoice Date 2026-10-18 14:28:00',
    'Patient No : 1234567', 'Appointment No. 87654321', 'Insurance ID. 38970000',
  ].join('\n');
  const followUp = [
    'Follow Up Visit', 'Voucher No: 264408364', 'Voucher Date: 10/20/2026',
    'Ref. Invoice No: 36008568', 'Patient Name: WALEED RAED ALMUTAIRI',
  ].join('\n');
  const outpatientReal = [
    'OUTPATIENT VISIT TICKET', 'Invoice No.: 264409220', 'Transaction No.: 264409220',
    'Patient No: 1793255', 'Appointment No. 36008397',
  ].join('\n');
  const t1 = transactionNoFromText(ticket);
  const t2 = transactionNoFromText('Transacti0n N0.: 5I2345 67B\nPatient No : 1234567');
  const t3 = transactionNoFromText('Transaction No.:\n512345678\nPatient No 1234567');
  const t4 = transactionNoFromText('Patient No : 1234567\nAppointment No. 87654321\nInsurance ID. 389700001');
  const t5 = transactionNoFromText('random 512345678 text\nPatient No : 1234567');
  const t6 = transactionNoFromText('a 512345678\nb 612345678');
  const t7 = visitNumberFromText(followUp);
  const t8 = visitNumberFromText(outpatientReal);
  const s1 = mrnSuffixFromText(outpatientReal);
  const s2 = mrnSuffixFromText(followUp);
  const s3 = mrnSuffixFromBarcode('1793255');
  const s4 = mrnSuffixFromBarcode('264409220');
  const p1 = patientNoFromText(outpatientReal);
  const p2 = patientNoFromBarcode('1793255');
  assert(t1?.value === '512345678' && t1.source === 'transaction', 'FB-15', 'Ticket text: Transaction No. read next to its label', JSON.stringify(t1));
  assert(t2?.value === '512345678' && t3?.value === '512345678', 'FB-16', 'Ticket text: OCR look-alikes (O/0, I/1, B/8) and the number on the next line', JSON.stringify([t2, t3]));
  assert(t4 === null && t5 === null && t6 === null, 'FB-17', 'Ticket text: only next to a visit label — never the MRN, appointment, insurance or any loose number', JSON.stringify([t4, t5, t6]));
  assert(t7?.value === '264408364' && t7.source === 'voucher', 'FB-18', 'Follow-up voucher: Voucher No. when Transaction No. is missing', JSON.stringify(t7));
  assert(t8?.value === '264409220' && t8.source === 'transaction', 'FB-19', 'Outpatient ticket prefers Transaction No. over Invoice No.', JSON.stringify(t8));
  assert(s1 === '255' && s2 === null && s3 === '255' && s4 === null && p1 === '1793255' && p2 === '1793255', 'FB-20', 'Patient No. is the MRN; last 3 for tracking; 9-digit barcode is not MRN', JSON.stringify({ s1, s2, s3, s4, p1, p2 }));
  {
    const today = new Date(2026, 10, 1); // 1 Nov 2026
    const a1 = ageFromText('Patient No: 1793255\nAge: 5 Y 3 M\nGender: M', today);
    const a2 = ageFromText('Age : 34 Years', today);
    const a3 = ageFromText('Age: 18 Months', today);
    const a4 = ageFromText('Age:\n10 Days', today);
    const a5 = ageFromText('العمر: 7 سنوات', today);
    const a6 = ageFromText('DOB: 2024-05-20', today);
    const a7 = ageFromText('Date of Birth: 25/12/2015', today); // day > 12: dd/mm
    const a8 = ageFromText('DOB: 03/04/1990', today); // ambiguous but same years
    const a9 = ageFromText('DOB: 03/04/2026', today); // ambiguous infant: unclear
    const a10 = ageFromText('Patient No: 1793255\nVoucher Date: 10/20/2026', today);
    const a11 = ageFromText('Age: 200 Y', today);
    // Real HMG outpatient tickets: "Patient Age: 9 Yr 4 Mnth 16 Days", Arabic label on the same line.
    const r1 = ageFromText('Patient Gender: Female العيادة:\nPatient Age: 9 Yr 4 Mnth 16 Days الدكتور:', today);
    const r2 = ageFromText('Patient Age: 4 Yr 5 Mnth 9 Days', today);
    const r3 = ageFromText('Patient Age: 0 Yr 2 Mnth 3 Days', today);
    // Real OCR output of the two HMG tickets: a dropped "9" must not become 0 months.
    const o1 = ageFromText('Patient Age: Yr 4 Mrith 16 Days ssl bss Pie', today);
    const o2 = ageFromText('. | Patient Age: 4 Yr 5 Mnth © Days seal', today);
    const o3 = ageFromText('Patient Age: 9 Yr 4 Mrith 16 Days', today);
    assert(
      a1?.months === 63 && a1.label === '5 y 3 m' && a1.source === 'age'
      && a2?.years === 34 && a3?.months === 18 && a3.label === '18 m' && a4?.months === 0
      && a5?.years === 7 && a6?.months === 29 && a6.source === 'dob'
      && a7?.years === 10 && a8?.years === 36 && a9 === null && a10 === null && a11 === null
      && r1?.months === 112 && r1.label === '9 y 4 m' && r2?.months === 53 && r3?.months === 2
      && o1 === null && o2?.months === 53 && o3?.months === 112,
      'FB-29', 'Slip age: Age label (y/m/days, Arabic) or date of birth; unclear day/month in infants and other dates are not taken',
      JSON.stringify({ a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, r1, r2, r3, o1, o2, o3 }),
    );
  }
  {
    // System CTAS (at decision + very first) vs nurse, physician and outcome.
    const s1 = systemCtasOf({ aiRecommendedCtas: 4, nurseCtas: 3, validatedPayload: { initial_assessment: { level: 5 } } });
    const s2 = systemCtasOf({ rulesRecommendedCtas: 2, ctasLevel: 2, validatedPayload: {} });
    const vOut = [versusOutcome(3, true), versusOutcome(2, true), versusOutcome(2, false), versusOutcome(4, false), versusOutcome(4, null)];
    const w1 = overrideWinner(4, 3, (l) => versusLevel(l, 3));       // nurse right
    const w2 = overrideWinner(3, 4, (l) => versusLevel(l, 3));       // system right
    const w3 = overrideWinner(4, 2, (l) => versusLevel(l, 3));       // both wrong, nurse safer
    const rep = computeSystemNurseComparison([
      { aiRecommendedCtas: 4, nurseCtas: 3, physicianCtas: 3, highAcuityOutcome: false, validatedPayload: { initial_assessment: { level: 4 } } },
      { aiRecommendedCtas: 3, nurseCtas: 3, physicianCtas: 2, highAcuityOutcome: true },
      { aiRecommendedCtas: 2, nurseCtas: 4, physicianCtas: 2, highAcuityOutcome: true, validatedPayload: { initial_assessment: { level: 3 } } },
      { aiRecommendedCtas: 5, nurseCtas: 5, physicianCtas: 1, physicianConditionChanged: true },
    ]);
    assert(
      s1.system === 4 && s1.first === 5 && s1.nurse === 3 && s1.nurseChanged && s1.questionsChanged
      && s2.system === 2 && s2.first === null && !s2.nurseChanged
      && vOut.join() === 'under,agree,over,agree,' && w1 === 'nurse' && w2 === 'system' && w3 === 'nurse_safer'
      && rep.nurse_changed === 2 && rep.changed_up === 1 && rep.changed_down === 1 && rep.questions_changed === 1
      && rep.vs_physician.system.n === 3 && rep.vs_physician.nurse.under === 2
      && rep.when_nurse_changed.vs_physician.nurse === 1 && rep.when_nurse_changed.vs_physician.system === 1
      && rep.vs_outcome.nurse.under === 2 && rep.vs_outcome.system.under === 1,
      'FB-30', 'System CTAS (at decision, very first) vs nurse, physician and outcome; who was right when the nurse changed it',
      JSON.stringify({ s1, s2, vOut, w1, w2, w3, rep }).slice(0, 600),
    );
  }
  assert(
    weekKey('2026-10-17T21:00:00Z') === '2026-10-18'
    && weekKey('2026-10-17T20:59:00Z') === '2026-10-11'
    && weekKey('2026-10-20T12:00:00Z') === '2026-10-18'
    && previousWeek('2026-10-18') === '2026-10-11'
    && weekRange('2026-10-18').start.toISOString() === '2026-10-17T21:00:00.000Z'
    && weekRange('2026-10-18').end.toISOString() === '2026-10-24T21:00:00.000Z'
    && ageBand(0.5) === '< 1 y',
    'FB-11',
    'Week is Sunday–Saturday in Riyadh time; previous week; age bands',
  );
  const dur = triageDurationSec('2026-10-20T08:00:00Z', '2026-10-20T08:04:30Z');
  const withDur = buildCases(
    [rec('dur', 10, 3, 3, now, { ctasStartedAt: '2026-10-20T08:00:00Z', ctasCompletedAt: '2026-10-20T08:04:30Z' })],
    [rev('rdur', 'dur', 3, true)],
    [],
    { now },
  );
  assert(
    dur === 270
    && withDur.cases[0].triageDurationSec === 270
    && summarise('2026-10-18', withDur.cases, 0, 0).meanTriageDurationSec === 270
    && monthRange('2026-10').start.toISOString() === '2026-09-30T21:00:00.000Z',
    'FB-22',
    'Triage duration is CTAS complete minus CTAS start; monthly bounds in Riyadh time',
  );
  const owner = 'phys-1';
  assert(
    physicianMayAct({ id: 'n1', role: 'nurse' }, owner)
    && physicianMayAct({ id: 'admin', role: 'admin' }, owner)
    && physicianMayAct({ id: 'phys-2', role: 'physician' }, null)
    && physicianMayAct({ id: owner, role: 'physician' }, owner)
    && !physicianMayAct({ id: 'phys-2', role: 'physician' }, owner),
    'FB-21',
    'First reviewer owns later physician actions; nurse and admin may still act',
  );
  assert(
    !hasHisEncounter(null)
    && !hasHisEncounter('')
    && !hasHisEncounter('   ')
    && hasHisEncounter('123456789')
    && !physicianValidationEligible({ ctasCompletedAt: null, encounterNo: '123456789' })
    && !physicianValidationEligible({ ctasCompletedAt: now, encounterNo: null })
    && !physicianValidationEligible({ ctasCompletedAt: now, encounterNo: '' })
    && physicianValidationEligible({ ctasCompletedAt: now, encounterNo: '123456789' })
    && statusAfterCtasComplete(null) === 'awaiting_his_link'
    && statusAfterCtasComplete('123456789') === 'pending_physician_validation',
    'FB-23',
    'Physician validation is allowed only after CTAS complete and a non-empty HIS encounter',
  );
  // Reference measures every saved outcome must answer (unknown allowed where it may be pending).
  const ref = {
    finalDiagnosisCode: 'R07.4', interventions: ['none'], icuWithin24h: 'no', death: 'none',
    resources: ['labs', 'ecg_xray'], return72h: 'unknown',
  };
  const admitted = normalizeOutcomeReview({
    ...ref, disposition: 'admitted', admissionSpecialty: 'Pediatrics', admissionLocation: 'ward',
  });
  const discharged = normalizeOutcomeReview({ ...ref, disposition: 'discharged_ed', dischargeDestination: 'home' });
  const missingAdmit = normalizeOutcomeReview({ ...ref, disposition: 'admitted' });
  const directionNo = normalizeOutcomeReview({
    ...ref, disposition: 'transferred', directionAppropriate: 'no',
  });
  assert(
    !outcomeReviewEligible({ ctasReviewedAt: null, encounterNo: '123456789' })
    && !outcomeReviewEligible({ ctasReviewedAt: now, encounterNo: null })
    && outcomeReviewEligible({ ctasReviewedAt: now, encounterNo: '123456789' })
    && admitted.ok && admitted.value.admissionSpecialty === 'Pediatrics' && admitted.value.dischargeDestination === null
    && discharged.ok && discharged.value.admissionLocation === null
    && !missingAdmit.ok
    && !directionNo.ok
    && !('nurseCtas' in (admitted.ok ? admitted.value : {}))
    && !('physicianCtas' in (admitted.ok ? admitted.value : {})),
    'FB-24',
    'Outcome review needs physician validation and HIS number; admitted/discharged fields are conditional; CTAS is not in the form',
  );
  const nurse = { id: 'n1', role: 'nurse' };
  const otherNurse = { id: 'n2', role: 'nurse' };
  const phys = { id: 'p1', role: 'physician' };
  const otherPhys = { id: 'p2', role: 'physician' };
  const admin = { id: 'a1', role: 'admin' };
  const unassigned = { ctasNurseId: 'n1', outcomePhysicianId: null };
  const assigned = { ctasNurseId: 'n1', outcomePhysicianId: 'p1' };
  // A physician who also did the CTAS (same account) is the triage person: refused.
  const selfTriaged = { ctasNurseId: 'p1', outcomePhysicianId: 'p1' };
  assert(
    !outcomeReviewMayAct(nurse, unassigned)
    && !outcomeReviewMayAct(nurse, assigned)
    && !outcomeReviewMayAct(otherNurse, assigned)
    && !outcomeReviewMayAct(phys, selfTriaged)
    && !outcomeReviewMayAct(phys, unassigned)
    && outcomeReviewMayAct(phys, assigned)
    && !outcomeReviewMayAct(otherPhys, assigned)
    && !outcomeReviewMayAct(admin, assigned)
    && outcomeReviewVisible(admin, assigned)
    && outcomeReviewVisible(admin, unassigned)
    && !outcomeReviewVisible(phys, unassigned)
    && outcomeReviewVisible(phys, assigned)
    && !outcomeReviewVisible(otherNurse, assigned),
    'FB-25',
    'Only the admin-assigned physician may save the outcome, never the triage nurse; admin can see cases to assign but cannot act',
  );

  // FB-26 Reference measures: required, coded, consistent.
  const noCode = normalizeOutcomeReview({ ...ref, disposition: 'other', finalDiagnosisCode: 'chest pain' });
  const noneMixed = normalizeOutcomeReview({ ...ref, disposition: 'other', interventions: ['none', 'cpr'] });
  const unknownLsi = normalizeOutcomeReview({ ...ref, disposition: 'other', interventions: ['bogus'] });
  const missingIcu = normalizeOutcomeReview({ ...ref, disposition: 'other', icuWithin24h: undefined });
  const dischargedIcu = normalizeOutcomeReview({ ...ref, disposition: 'discharged_ed', dischargeDestination: 'home', icuWithin24h: 'yes' });
  const diedEdAdmitted = normalizeOutcomeReview({ ...ref, disposition: 'admitted', admissionSpecialty: 'ICU', admissionLocation: 'icu', death: 'died_in_ed' });
  const severe = normalizeOutcomeReview({
    ...ref, disposition: 'admitted', admissionSpecialty: 'Medicine', admissionLocation: 'icu',
    interventions: ['intubation', 'vasopressors_inotropes'], icuWithin24h: 'yes', resources: ['labs', 'complex_procedure'],
  });
  assert(
    normalizeIcd10('r074') === 'R07.4' && normalizeIcd10(' J45.909 ') === 'J45.909' && normalizeIcd10('chest') === null
    && !noCode.ok && !noneMixed.ok && !unknownLsi.ok && !missingIcu.ok && !dischargedIcu.ok && !diedEdAdmitted.ok
    && severe.ok && severe.value.resourceCount === 3 && severe.value.finalDiagnosisCode === 'R07.4'
    && resourceCount(['none']) === 0
    && highAcuityOutcome({ interventions: ['cpr'], icuWithin24h: 'unknown', death: 'unknown' }) === true
    && highAcuityOutcome({ interventions: ['none'], icuWithin24h: 'no', death: 'none' }) === false
    && highAcuityOutcome({ interventions: ['none'], icuWithin24h: 'unknown', death: 'none' }) === null,
    'FB-26',
    'Outcome reference: ICD-10 code required; interventions/resources from fixed lists ("none" alone); ICU, death and 72 h return answered; contradictions refused; composite high-acuity outcome',
  );

  // FB-27 Closing waits for the 72-hour return.
  const arrived80h = new Date(now.getTime() - 80 * 3600 * 1000);
  const arrived10h = new Date(now.getTime() - 10 * 3600 * 1000);
  assert(
    outcomeCloseProblem({ return72h: 'no' }, arrived10h, now) !== null
    && outcomeCloseProblem({ return72h: 'unknown' }, arrived80h, now) !== null
    && outcomeCloseProblem({ return72h: 'yes_admitted' }, arrived80h, now) === null,
    'FB-27',
    'A case closes only 72 h after arrival with the return visit recorded',
  );

  // FB-28 Accuracy reference = physician-validated level only, never the nurse's own level.
  const base = { createdAt: now, nurseCtas: 3, aiRecommendedCtas: 3 };
  const unvalidated = { ...base, id: 'u', clinicianFinalCtas: 3 };
  const validated = { ...base, id: 'v', clinicianFinalCtas: 2, physicianCtas: 2, physicianValidatedAt: now };
  const changedCase = { ...base, id: 'c', physicianCtas: 1, physicianValidatedAt: now, physicianConditionChanged: true };
  const report = computeEvaluationReport([unvalidated, validated, changedCase]);
  assert(
    referenceSource(unvalidated) === 'none' && referenceSource(validated) === 'physician'
    && referenceSource(changedCase) === 'condition_changed'
    && report.sample_sizes.expert_labeled === 1
    && report.sample_sizes.not_validated === 1
    && report.sample_sizes.excluded_condition_changed === 1
    && report.sample_sizes.reference_physician_validated === 1,
    'FB-28',
    'AI/nurse accuracy scores only physician-validated cases; unvalidated and condition-changed cases are excluded',
  );
}
