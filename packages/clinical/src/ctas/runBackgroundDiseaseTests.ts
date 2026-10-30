/**
 * Background disease (approved 2026-10-26): SpO₂ against the usual level (local HMG rule),
 * cyanotic heart disease, metabolic / adrenal (CTAS 2016 + BIMDG), medical complexity.
 */
// @ts-nocheck — JS modules
import { computeLiveCTAS } from './vitalRanges.js';
import { detectRedFlags } from '../alerts/redFlagEngine.js';
import { buildCaseDetails } from './caseDetails.js';
import { evaluateComorbidityRules } from './comorbidityRules.js';

type Assert = (cond: boolean, id: string, label: string, detail?: string) => void;

export function runBackgroundDiseaseTests(assert: Assert) {
  const lvl = (p: Record<string, unknown>, a: Record<string, unknown> = {}) => (computeLiveCTAS as any)(p, a).level;
  const alertLvl = (p: Record<string, unknown>, a: Record<string, unknown> = {}) => (detectRedFlags(p, a) as any)?.ctas_level ?? null;
  const rules = (t: string, p: Record<string, unknown> = {}, a: Record<string, unknown> = {}) =>
    evaluateComorbidityRules({ patient: p, caseDetails: buildCaseDetails(t), answers: a, transcript: t });
  const floorOf = (t: string, p = {}, a = {}) => rules(t, p, a).floor;

  // A. SpO₂ against the usual level
  const chd = { age: '2', chief_complaint: 'cough', hr: '120', rr: '30', temperature: '37', bp_systolic: '95', gcs: '15' };
  const U80 = { baseline_spo2: '80' };
  assert(lvl({ ...chd, spo2: '82' }, U80) > 2 && alertLvl({ ...chd, spo2: '82' }, U80) == null, 'BD-01', 'Usual 80, now 82, no distress → SpO₂ does not set the level, no alert', `${lvl({ ...chd, spo2: '82' }, U80)}`);
  assert(lvl({ ...chd, spo2: '77' }, U80) > 2, 'BD-02', 'Usual 80, now 77 (−3) → within tolerance');
  assert(lvl({ ...chd, spo2: '76' }, U80) === 2 && alertLvl({ ...chd, spo2: '76' }, U80) === 2, 'BD-03', 'Usual 80, now 76 (−4) → CTAS 2 + alert');
  assert(lvl({ ...chd, spo2: '72' }, U80) === 2, 'BD-04', 'Usual 80, now 72 (−8) → CTAS 2');
  assert(lvl({ ...chd, spo2: '68' }, U80) === 1 && alertLvl({ ...chd, spo2: '68' }, U80) === 1, 'BD-05', 'Below 70 → CTAS 1 + alert');
  assert(lvl({ ...chd, spo2: '82' }) === 1, 'BD-06', 'Usual unknown, 82 → standard cut-off CTAS 1');
  assert(lvl({ ...chd, spo2: '82', chief_complaint: 'cough, usual saturation 80' }) > 2, 'BD-07', 'Usual level read from the history ("usual saturation 80")');
  const copd = { age: '65', chief_complaint: 'chronic cough as usual', hr: '88', rr: '20', temperature: '37', bp_systolic: '130', gcs: '15' };
  assert(lvl({ ...copd, spo2: '87' }, { baseline_spo2: '88' }) > 2, 'BD-08', 'COPD usual 88, now 87 → not CTAS 1');
  assert(lvl({ ...copd, spo2: '83' }, { baseline_spo2: '88' }) === 2, 'BD-09', 'COPD usual 88, now 83 → CTAS 2');
  assert(lvl({ ...copd, spo2: '87' }) === 1, 'BD-10', 'COPD usual unknown, 87 → CTAS 1 (standard)');
  assert(lvl({ ...chd, spo2: '82', gcs: '12' }, U80) <= 2, 'BD-11', 'At usual SpO₂ but GCS 12 → still CTAS 2 (other rules unaffected)');

  const ask = rules('2 year old cough, known cyanotic heart disease', { age: '2', spo2: '82' });
  assert(ask.confirmQuestions.some((x) => x.field === 'baseline_spo2'), 'BD-30', 'Cyanotic CHD, low reading, usual unknown → asks the usual SpO₂');
  assert(!rules('2 year old cough, known cyanotic heart disease, usual saturation 80', { age: '2', spo2: '82' }).confirmQuestions.some((x) => x.field === 'baseline_spo2'),
    'BD-31', 'Usual SpO₂ already in the history → no question');
  assert(lvl({ ...chd, spo2: '82' }, { baseline_spo2: '84' }) > 2 && lvl({ ...chd, spo2: '82' }, { baseline_spo2: 'unknown' }) === 1, 'BD-32', 'Answer "80–84" (84) → at usual; "unknown" → standard');

  assert(lvl({ ...chd, spo2: '84', chief_complaint: 'cough, known cyanotic heart disease' }, {}) === 1
      && lvl({ ...chd, spo2: '84', transcription: 'Parents do not know the usual saturation. SpO2 84.', chief_complaint: 'cough, cyanotic heart disease' }) === 1,
    'BD-34', '"Parents do not know the usual saturation. SpO₂ 84" is NOT read as usual = 84 (standard cut-off → CTAS 1)');

  // B. Cyanotic heart disease
  const cy = 'known cyanotic congenital heart disease, Glenn';
  assert(floorOf(`2 year old cough, ${cy}`, { age: '2', spo2: '81' }) === 3, 'BD-12', 'Cyanotic CHD + cough → at least CTAS 3');
  assert(floorOf(`2 year old fever, ${cy}`, { age: '2', temperature: '39' }) === 2, 'BD-13', 'Cyanotic CHD + fever → CTAS 2');
  assert(floorOf('5 year old vomiting since morning, known Fontan', { age: '5' }) === 2, 'BD-14', 'Fontan + vomiting → CTAS 2');
  assert(floorOf(`2 year old cough, ${cy}`, { age: '2' }) !== 2, 'BD-15', '"cyanotic" in the history is not a new-cyanosis trigger');
  assert(floorOf(`2 year old cough, more cyanosis than usual, ${cy}`, { age: '2' }) === 2, 'BD-16', 'New / worse cyanosis → CTAS 2');
  assert(floorOf('7 year old sprained ankle, repaired VSD as a baby', { age: '7' }) == null, 'BD-17', 'Repaired acyanotic CHD + sprain → no upgrade');
  assert(floorOf('3 year old cough, known VP shunt', { age: '3' }) == null && !buildCaseDetails('known BT shunt').conditions.some((c) => c.id === 'vp_shunt'),
    'BD-18', 'A BT shunt is not read as a VP shunt');

  // C. Metabolic / adrenal
  assert(floorOf('3 year old vomiting 3 times, known MSUD', { age: '3' }) === 2, 'BD-19', 'MSUD + vomiting → CTAS 2');
  assert(floorOf('5 year old small finger cut, known metabolic disorder, eating well', { age: '5' }) == null, 'BD-20', 'Metabolic + finger cut, eating well → no upgrade');
  assert(floorOf('infant with known metabolic disorder, cough and runny nose, feeding well', { age: '1' }) === 3, 'BD-33', 'Metabolic + infection (cough/coryza), eating, no fever → at least CTAS 3 (BIMDG)');
  assert(floorOf('2 year old MCAD deficiency, not eating today', { age: '2' }) === 2, 'BD-21', 'MCAD + poor intake → CTAS 2');
  assert(floorOf('4 year old with emergency letter for propionic acidaemia, cough', { age: '4' }) === 2, 'BD-22', 'Emergency letter → CTAS 2');
  const ai = rules('10 year old vomiting, known adrenal insufficiency on hydrocortisone', { age: '10' });
  assert(ai.floor === 2 && /hydrocortisone/i.test(ai.applied[0]?.note_en || ''), 'BD-23', 'Adrenal insufficiency + vomiting → CTAS 2 with stress-dose reminder');
  assert(floorOf('9 year old vomiting, known type 1 diabetes on insulin', { age: '9' }) === 2, 'BD-24', 'Type 1 diabetes + vomiting → CTAS 2 (CTAS 2016)');

  // D. Medical complexity
  const cp = '6 year old cerebral palsy with gastrostomy, vomiting';
  const q = rules(cp, { age: '6' });
  assert(q.confirmQuestions.some((x) => x.field === 'different_from_usual'), 'BD-25', 'Child with medical complexity → asks "different from usual?"');
  assert(floorOf(cp, { age: '6' }, { different_from_usual: 'نعم' }) === 3, 'BD-26', 'Parents: not usual self → at least CTAS 3');
  assert(floorOf(cp, { age: '6' }, { different_from_usual: 'لا' }) == null, 'BD-27', 'Parents: usual self → no upgrade');
  assert(floorOf('3 year old with tracheostomy, cough and more secretions', { age: '3' }) === 2, 'BD-28', 'Tracheostomy + cough/secretions → CTAS 2');
  assert(floorOf('4 year old Down syndrome, fever and cough, usual self', { age: '4', temperature: '38.6' }, { different_from_usual: 'لا' }) == null, 'BD-29', 'Down syndrome + fever, usual self → no automatic upgrade');
}
