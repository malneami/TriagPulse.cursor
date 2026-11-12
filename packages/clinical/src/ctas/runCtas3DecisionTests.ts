/**
 * Permanent regression tests for the CTAS 3 / burn / seizure / asthma decisions
 * recorded 2026-11-09 (clinical lead). Each case fixes the CTAS level and,
 * where the decision names one, the direction.
 */
import { computeLiveCTAS } from './vitalRanges.js';
import { resolveDirection } from '../routing/routingConfig.js';
import { evaluateCtasRules } from './ctasRulesEngine.js';
import { BASELINE_SPO2_QUESTION } from './clarifyingQuestionBank.js';

type Assert = (cond: boolean, id: string, name: string, detail?: string) => void;

// Stable vitals so only the case under test drives the result.
const STABLE = { hr: 100, rr: 24, spo2: 99, temperature: 36.8, gcs: 15, bp_systolic: 100, bp_diastolic: 60, pain_score: 0 };
// A Riyadh time when Fast Track is open is not required; direction is asserted only where the zone is independent of hours.
const NOON_UTC = new Date(Date.UTC(2026, 10, 9, 9, 0));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const resolve = resolveDirection as (opts: any) => any;

export function runCtas3DecisionTests(assert: Assert) {
  // Usual-SpO₂ question (approved 2026-11-12): SpO₂ ≤ 85 with no usual value → CTAS 1 and a numeric question;
  // a confirmed usual value within 3 of the reading lowers the category.
  const evalRaw = evaluateCtasRules as (o: any) => any;
  const base = { age: 4, chief_complaint: 'cough for 3 days', ...STABLE, spo2: 85 };
  const noBase = evalRaw({ patient: base, answers: {}, transcript: '' });
  assert(noBase.level === 1 && (noBase.missing_ctas_changing || []).some((g: any) => g.field === 'baseline_spo2'), 'DEC-26', 'SpO₂ 85, usual unknown → CTAS 1 and usual-SpO₂ question');
  const withBase = evalRaw({ patient: base, answers: { baseline_spo2: 85 }, transcript: '' });
  assert(withBase.level === 5, 'DEC-27', 'SpO₂ 85, usual 85 confirmed, cough → not CTAS 1 (5, no complaint baseline)', `${withBase.level}`);
  assert(BASELINE_SPO2_QUESTION.answer_type === 'number' && BASELINE_SPO2_QUESTION.min === 60 && BASELINE_SPO2_QUESTION.max === 100, 'DEC-28', 'baseline question is numeric 60–100');
  const cases: Array<{
    id: string; name: string;
    patient: Record<string, unknown>; answers: Record<string, unknown>;
    level: number; zone?: string; rule?: string;
  }> = [
    { id: 'DEC-01', name: 'burn small, pain 2/10, non-critical site → CTAS 4',
      patient: { age: 5, chief_complaint: 'scald burn to arm', ...STABLE, pain_score: 2 },
      answers: { burn_size: 'small', burn_critical_site: 'لا' }, level: 4, rule: 'burn_fast_track' },
    { id: 'DEC-02', name: 'burn small, pain 6/10 → CTAS 3 (pain ≥ 5 raises)',
      patient: { age: 5, chief_complaint: 'scald burn to arm', ...STABLE, pain_score: 6 },
      answers: { burn_size: 'small', burn_critical_site: 'لا' }, level: 3, rule: 'burn_observation' },
    { id: 'DEC-03', name: 'burn moderate (5–10%), pain 2/10 → CTAS 3',
      patient: { age: 5, chief_complaint: 'scald burn to arm', ...STABLE, pain_score: 2 },
      answers: { burn_size: 'moderate', burn_critical_site: 'لا' }, level: 3, rule: 'burn_observation' },
    { id: 'DEC-04', name: 'burn to hand (critical site) → CTAS 2',
      patient: { age: 5, chief_complaint: 'scald burn to hand', ...STABLE, pain_score: 2 },
      answers: { burn_size: 'small', burn_critical_site: 'نعم' }, level: 2, zone: 'PEDIATRIC_RESUS' },
    { id: 'DEC-05', name: 'large burn (>10%) → CTAS 2',
      patient: { age: 5, chief_complaint: 'burn to chest', ...STABLE, pain_score: 2 },
      answers: { burn_size: 'large', burn_critical_site: 'لا' }, level: 2, zone: 'PEDIATRIC_RESUS' },
    { id: 'DEC-06', name: 'fever with prior febrile seizure, looks well, 2 y → CTAS 3 Observation',
      patient: { age: 2, chief_complaint: 'fever and fit', ...STABLE, temperature: 38.8 },
      answers: { looks_unwell: 'لا', febrile_seizure_history: 'نعم' }, level: 3, rule: 'ped_fever_seizure_obs' },
    { id: 'DEC-07', name: 'C3-11: fever 14 months, immunisation/source unanswered → CTAS 3 Observation',
      patient: { age: 1.2, chief_complaint: 'febrile fit resolved, fever', ...STABLE, temperature: 38.9 },
      answers: { looks_unwell: 'لا' }, level: 3, zone: 'PEDIATRIC_OBSERVATION' },
    { id: 'DEC-08', name: 'fever 14 months, immunised with clear source, looks well → CTAS 4 Clinic',
      patient: { age: 1.2, chief_complaint: 'fever', ...STABLE, temperature: 38.9 },
      answers: { looks_unwell: 'لا', immunisations_up_to_date: 'نعم', fever_clear_source: 'نعم' }, level: 4, zone: 'PEDIATRIC_CLINIC' },
    { id: 'DEC-09', name: 'C3-09: stable asthma (SpO2 ≥ 95%, improved after salbutamol) → CTAS 4 Clinic',
      patient: { age: 8, chief_complaint: 'asthma, wheezing improved after inhaler', ...STABLE, rr: 24, spo2: 97 },
      answers: { asthma_improved_after_bronchodilator: 'نعم' }, level: 4, zone: 'PEDIATRIC_CLINIC' },
    { id: 'DEC-11', name: 'P01: dog bite to hand, 6 y → CTAS 4, Fast Track rule',
      patient: { age: 6, chief_complaint: 'dog bite to hand', ...STABLE },
      answers: {}, level: 4, rule: 'ped_bite_fast_track' },
    { id: 'DEC-12', name: 'P11: suture removal, 8 y → CTAS 5, Fast Track rule',
      patient: { age: 8, chief_complaint: 'suture removal, healed wound', ...STABLE },
      answers: {}, level: 5, rule: 'ped_wound_care_fast_track' },
    { id: 'DEC-13', name: 'P12: dressing change, 6 y → CTAS 5, Fast Track rule',
      patient: { age: 6, chief_complaint: 'dressing change, well', ...STABLE },
      answers: {}, level: 5, rule: 'ped_wound_care_fast_track' },
    { id: 'DEC-14', name: 'C2-12: lip swelling and hives, no breathing difficulty, 5 y → CTAS 3, Observation',
      patient: { age: 5, chief_complaint: 'allergic reaction: lip swelling, hives, no breathing difficulty', ...STABLE },
      answers: {}, level: 3, zone: 'PEDIATRIC_OBSERVATION' },
    { id: 'DEC-15', name: 'C2-08: 4-month fever, looks well → CTAS 3, Clinic',
      patient: { age: 0.33, chief_complaint: 'fever, looks well', ...STABLE, temperature: 38.5 },
      answers: { looks_unwell: 'لا' }, level: 3, rule: 'ped_infant_well_fever_clinic' },
    { id: 'DEC-16', name: 'P20: moderate dehydration, 2 y → CTAS 3, Observation',
      patient: { age: 2, chief_complaint: 'vomiting and moderate dehydration signs', ...STABLE },
      answers: {}, level: 3, zone: 'PEDIATRIC_OBSERVATION' },
    { id: 'DEC-10', name: 'asthma not improved after salbutamol → stays CTAS 3',
      patient: { age: 8, chief_complaint: 'asthma, wheezing improved after inhaler', ...STABLE, rr: 24, spo2: 97 },
      answers: {}, level: 3, zone: 'PEDIATRIC_OBSERVATION' },
    { id: 'DEC-17', name: 'child 4 y, cough, SpO2 92% → CTAS 3 (90–93 warning with respiratory presentation)',
      patient: { age: 4, chief_complaint: 'cough for 3 days', ...STABLE, spo2: 92 },
      answers: {}, level: 3 },
    { id: 'DEC-18', name: 'child 4 y, cough, SpO2 88% → CTAS 2 (86–89 high risk)',
      patient: { age: 4, chief_complaint: 'cough for 3 days', ...STABLE, spo2: 88 },
      answers: {}, level: 2 },
    { id: 'DEC-18b', name: 'child 4 y, SpO2 84% → CTAS 1 (≤ 85)',
      patient: { age: 4, chief_complaint: 'cough for 3 days', ...STABLE, spo2: 84 },
      answers: {}, level: 1 },
    { id: 'DEC-18c', name: 'child 4 y, SpO2 92% no respiratory presentation → no SpO2 rule (level 5)',
      patient: { age: 4, chief_complaint: 'rash on the arm', ...STABLE, spo2: 92 },
      answers: {}, level: 5 },
    { id: 'DEC-19', name: 'child 4 y, cough, SpO2 97% → not CTAS 2 from this rule',
      patient: { age: 4, chief_complaint: 'cough for 3 days', ...STABLE, spo2: 97 },
      answers: {}, level: 5 },
    { id: 'DEC-20', name: 'infant 2 months, lethargic, fever 39 (C2-07) → CTAS 2 Observation',
      patient: { age: 0.17, chief_complaint: 'fever, very sleepy, not feeding', ...STABLE, temperature: 39.0 },
      answers: { looks_unwell: 'نعم' }, level: 2, zone: 'PEDIATRIC_OBSERVATION', rule: 'ped_ctas2_infant_fever_obs' },
    { id: 'DEC-21', name: 'infant 2 months, lethargic, no fever → CTAS 2 Observation',
      patient: { age: 0.17, chief_complaint: 'very sleepy, lethargic since this morning', ...STABLE },
      answers: {}, level: 2, zone: 'PEDIATRIC_OBSERVATION', rule: 'infant_u3m_critical_obs' },
    { id: 'DEC-22', name: 'infant 2 months, vomiting alone → CTAS 2 Observation',
      patient: { age: 0.17, chief_complaint: 'repeated vomiting', ...STABLE },
      answers: {}, level: 2, zone: 'PEDIATRIC_OBSERVATION', rule: 'infant_u3m_critical_obs' },
    { id: 'DEC-23', name: 'infant 2 months, abdominal distension → CTAS 2 Observation',
      patient: { age: 0.2, chief_complaint: 'abdominal distension and vomiting', ...STABLE },
      answers: {}, level: 2, zone: 'PEDIATRIC_OBSERVATION', rule: 'infant_u3m_critical_obs' },
    { id: 'DEC-24', name: 'infant 2 months, abnormal movements → CTAS 2 Observation',
      patient: { age: 0.15, chief_complaint: 'abnormal movements of the arms', ...STABLE },
      answers: {}, level: 2, zone: 'PEDIATRIC_OBSERVATION', rule: 'infant_u3m_critical_obs' },
    { id: 'DEC-25', name: 'child 5 y, lethargic, no fever → not infant rule (level unchanged)',
      patient: { age: 5, chief_complaint: 'lethargic since this morning', ...STABLE },
      answers: {}, level: 5 },
  ];

  for (const c of cases) {
    const live = computeLiveCTAS(c.patient, c.answers);
    const level = live?.level ?? null;
    const dir = resolve({
      level, age: c.patient.age,
      complaints: [{ text: String(c.patient.chief_complaint) }],
      answers: c.answers, now: NOON_UTC,
    });
    const levelOk = level === c.level;
    assert(levelOk, c.id, c.name, `expected CTAS ${c.level}, got ${level}`);
    if (c.zone) {
      assert(dir?.destination === c.zone, `${c.id}-zone`, `${c.id}: direction ${c.zone}`,
        `got ${dir?.destination}`);
    }
    if (c.rule) {
      assert(dir?.from_routing_rule?.id === c.rule, `${c.id}-rule`, `${c.id}: rule ${c.rule}`,
        `got ${dir?.from_routing_rule?.id ?? 'default'}`);
    }
  }
}
