/**
 * Heart rate and fever rules (approved by the clinical lead, 2026-10-25):
 * PaedCTAS heart-rate bands (+1 SD → 3, +2 SD → 2, beyond → 2; HR alone never CTAS 1),
 * tachycardia explained by fever ≥ 38.0 °C or a recorded cause (crying, pain, anxiety)
 * does not raise CTAS, a rate beyond the top band is never explained, crying asks for a
 * settled re-count; adults: unexplained → 2, unanswered → 3, cardiac complaint → 2,
 * ≥ 130 never explained. Paediatric fever modifier per the CTAS table (38.0 under 3 months,
 * 38.5 after; under 3 y looks well → 3; 3 y and over looks well → 4; neonates → 2).
 */
// @ts-ignore — plain JS module
import { computeLiveCTAS, interpretHR } from './vitalRanges.js';
import { detectRedFlags } from '../alerts/redFlagEngine.js';

type Assert = (cond: boolean, id: string, name: string, detail?: string) => void;

export function runHeartRateTests(assert: Assert) {
  const base = { spo2: '98', gcs: '15', bp_systolic: '110', bp_diastolic: '70', pain_score: 0, temperature: '36.9' };
  const run = (p: Record<string, unknown>, a: Record<string, unknown> = {}) => (computeLiveCTAS as any)({ ...base, ...p }, a);
  const lvl = (p: Record<string, unknown>, a: Record<string, unknown> = {}) => run(p, a).level;
  const hrOf = (p: Record<string, unknown>, a: Record<string, unknown> = {}) => run(p, a).heart_rate || {};
  const qs = (p: Record<string, unknown>, a: Record<string, unknown> = {}) => (run(p, a).hr_questions || []).map((q: { field: string }) => q.field);
  const alert = (p: Record<string, unknown>, a: Record<string, unknown> = {}) => (detectRedFlags({ ...base, ...p }, a) as any) || null;
  const hrAlert = (p: Record<string, unknown>, a: Record<string, unknown> = {}) => (alert(p, a)?.symptoms || []).some((s: { en: string }) => /^HR /.test(s.en));
  const WELL = { looks_unwell: 'لا' };
  const urti = 'URTI symptoms, cough and runny nose';

  // Paediatric fever modifier
  {
    const p = { age: '1', temperature: '39', hr: '160', rr: '30', bp_systolic: '95', chief_complaint: urti };
    assert(lvl(p, { ...WELL, tachycardia_reason: 'crying' }) === 3 && lvl(p, WELL) === 3, 'HR-01',
      '1 y, 39 °C, HR 160, crying, looks well → CTAS 3 (fever explains HR; under 3 y looks well = 3)', `${lvl(p, WELL)}`);
    assert(!hrAlert(p, WELL) && hrOf(p, WELL).explained === true, 'HR-02', 'Fever-explained HR 160 at 1 y raises no HR alert');
  }
  {
    const p = { age: '3', temperature: '38.8', hr: '110', rr: '24', bp_systolic: '98', chief_complaint: 'Fever' };
    assert(lvl(p, WELL) === 4, 'HR-03', '3 y, 38.8 °C, looks well → CTAS 4 (3 y and over)', `${lvl(p, WELL)}`);
    assert(lvl(p, {}) === 3, 'HR-04', '3 y, 38.8 °C, appearance not answered → CTAS 3 until answered', `${lvl(p, {})}`);
    assert(lvl({ ...p, age: '2.9' }, WELL) === 3, 'HR-05', '2.9 y, 38.8 °C, looks well → CTAS 3', `${lvl({ ...p, age: '2.9' }, WELL)}`);
    assert(lvl({ ...p, age: '3.5', temperature: '39.5', hr: '120' }, WELL) === 4, 'HR-06', '3.5 y, 39.5 °C, HR 120, looks well → CTAS 4');
    assert(lvl({ ...p, age: '3', temperature: '38.8' }, { looks_unwell: 'نعم' }) === 3, 'HR-07', '3 y, fever, looks unwell → CTAS 3');
    assert(lvl({ ...p, age: '1' }, { looks_unwell: 'نعم' }) === 2, 'HR-08', '1 y, fever, looks unwell → CTAS 2');
    const mild = lvl({ ...p, temperature: '38.2', chief_complaint: urti }, WELL);
    assert(mild >= 4, 'HR-09', '3 y, 38.2 °C (< 38.5), looks well → no fever modifier, complaint level', `${mild}`);
    assert(lvl({ ...p, age: '0.05', temperature: '38.2', hr: '160' }) === 2, 'HR-10', 'Neonate, 38.2 °C → CTAS 2 (not 1)');
  }

  // Local HMG rule, option C (2026-10-25): 12–36 months, ≥ 38.5 °C, looks well
  {
    const f = { age: '1', temperature: '39', hr: '110', rr: '25', bp_systolic: '110', chief_complaint: 'fever' };
    const IMM = { immunisations_up_to_date: 'yes' }; const SRC = { fever_clear_source: 'yes' };
    assert(lvl(f, WELL) === 3 && qs(f, WELL).includes('immunisations_up_to_date') && qs(f, WELL).includes('fever_clear_source'), 'FC-01',
      '1 y, 39 °C, looks well, not answered → CTAS 3 and asks immunisation + source');
    assert(lvl(f, { ...WELL, ...IMM, ...SRC }) === 4 && qs(f, { ...WELL, ...IMM, ...SRC }).length === 0, 'FC-02', '1 y, 39 °C, looks well, immunised, clear source → CTAS 4');
    assert(lvl(f, { ...WELL, ...IMM, fever_clear_source: 'no' }) === 3, 'FC-03', 'No clear source → CTAS 3');
    assert(lvl(f, { ...WELL, immunisations_up_to_date: 'no', ...SRC }) === 3 && lvl(f, { ...WELL, immunisations_up_to_date: 'unknown', ...SRC }) === 3, 'FC-04', 'Not immunised or unknown → CTAS 3');
    assert(lvl(f, { looks_unwell: 'نعم', ...IMM, ...SRC }) === 2, 'FC-05', 'Looks unwell → CTAS 2 whatever the answers');
    assert(lvl({ ...f, age: '0.75' }, { ...WELL, ...IMM, ...SRC }) === 3 && !qs({ ...f, age: '0.75' }, WELL).includes('fever_clear_source'), 'FC-06', '9 months stays CTAS 3, no extra questions');
    assert(lvl({ ...f, age: '2.9' }, { ...WELL, ...IMM, ...SRC }) === 4, 'FC-07', '2.9 y, well, immunised, source → CTAS 4');
    assert(lvl({ ...f, temperature: '38.2' }, WELL) === 4 && !qs({ ...f, temperature: '38.2' }, WELL).includes('fever_clear_source'), 'FC-08', '38.2 °C → no fever modifier, no questions');
    assert(lvl({ ...f, hr: '180' }, { ...WELL, ...IMM, ...SRC }) === 2, 'FC-09', 'HR above the 99th still CTAS 2');
  }

  // Paediatric heart rate (local HMG rule: ED centiles, O'Leary 2015 — above the 95th → 3 unless explained, above the 99th → 2)
  {
    const calm = { temperature: '36.9', rr: '24', bp_systolic: '100', chief_complaint: 'abdominal pain' };
    assert(lvl({ ...calm, age: '1', temperature: '39', hr: '180', chief_complaint: urti }, WELL) === 2
      && hrAlert({ ...calm, age: '1', temperature: '39', hr: '180', chief_complaint: urti }, WELL)
      && hrOf({ ...calm, age: '1', temperature: '39', hr: '175', chief_complaint: urti }, WELL).explained === true, 'HR-11',
    '1 y, 39 °C: HR 180 (above the 99th, 176) → CTAS 2 + alert, never explained; HR 175 → explained by fever');
    assert(lvl({ ...calm, age: '2', hr: '150', chief_complaint: 'vomiting' }) === 3 && !hrAlert({ ...calm, age: '2', hr: '150', chief_complaint: 'vomiting' })
      && lvl({ ...calm, age: '2', hr: '165', chief_complaint: 'vomiting' }) === 2 && hrAlert({ ...calm, age: '2', hr: '165', chief_complaint: 'vomiting' }), 'HR-12',
      '2 y, no fever: HR 150 (above the 95th, 146) → CTAS 3; HR 165 (above the 99th, 162) → CTAS 2 + alert');
    assert(lvl({ ...calm, age: '6', hr: '130' }) === 3 && lvl({ ...calm, age: '6', hr: '145' }) === 2, 'HR-13', '6 y, no fever: HR 130 → CTAS 3; HR 145 (above 141) → CTAS 2', `${lvl({ ...calm, age: '6', hr: '130' })}`);
    assert(lvl({ ...calm, age: '10', hr: '125' }) === 3 && lvl({ ...calm, age: '10', hr: '140' }) === 2, 'HR-14', '10 y, no fever: HR 125 → CTAS 3; HR 140 (above 135) → CTAS 2, never 1 from HR alone');
    assert(lvl({ ...calm, age: '10', hr: '140' }, { poor_perfusion: 'نعم' }) === 1, 'HR-15', '10 y, HR 140 with poor perfusion → CTAS 1');
    const hr90 = lvl({ ...calm, age: '6', hr: '90' });
    const pain = lvl({ ...calm, age: '6', hr: '132' }, { tachycardia_reason: 'pain' });
    assert(pain === hr90 && hrOf({ ...calm, age: '6', hr: '132' }, { tachycardia_reason: 'pain' }).explained === true, 'HR-16',
      '6 y, HR 132, pain recorded → HR does not raise CTAS', `${pain} vs ${hr90}`);
    assert(lvl({ ...calm, age: '6', hr: '132' }) === 3 && qs({ ...calm, age: '6', hr: '132' }).includes('tachycardia_reason'), 'HR-17',
      '6 y, no fever, HR 132 (above the 95th, 128), no reason → CTAS 3 and asks the reason');
    assert(lvl({ ...calm, age: '3', hr: '140' }) === 3 && lvl({ ...calm, age: '13', hr: '115' }) === 3 && hrOf({ ...calm, age: '8', hr: '110' }).level == null
      && hrOf({ ...calm, age: '18', hr: '100' }).band === 'normal',
      'HR-18', 'Rows: 3 y HR 140 → 3; 13 y HR 115 → 3; 8 y HR 110 normal; adult rule from 18 y');
    const cry = { ...calm, age: '1', hr: '165', chief_complaint: urti };
    assert(qs(cry, { tachycardia_reason: 'crying' }).includes('hr_recount') && lvl(cry, { tachycardia_reason: 'crying' }) > 3, 'HR-19',
      '1 y, no fever, HR 165, crying → explained, asks for a settled re-count');
    assert(lvl(cry, { tachycardia_reason: 'crying', hr_recount: 'settled_high' }) === 3, 'HR-20', 'Still high once settled → unexplained → CTAS 3');
    assert(!qs(cry, { tachycardia_reason: 'crying', hr_recount: 'settled_normal' }).includes('hr_recount'), 'HR-21', 'Normal once settled → no further re-count prompt');
  }

  // Blood pressure by age (no adult cut-off for infants)
  {
    const inf = { age: '0.67', hr: '130', rr: '35', bp_systolic: '85', temperature: '37', chief_complaint: 'vomiting' };
    const r = run(inf);
    const sbpAlert = (alert(inf)?.symptoms || []).some((s: { en: string }) => /^SBP /.test(s.en));
    assert(r.level > 2 && !sbpAlert, 'HR-22', '8 months, SBP 85 → no hypotension flag, no CTAS 2 from BP', `${r.level} ${sbpAlert}`);
    assert(lvl({ ...inf, bp_systolic: '55' }) === 1, 'HR-23', '8 months, SBP 55 (< 60) → hypotension for age → CTAS 1');
  }

  // Adults
  {
    const ad = { age: '40', temperature: '36.8', rr: '16', bp_systolic: '120' };
    const st = { ...ad, hr: '118', chief_complaint: 'sore throat' };
    assert(lvl(st) === 3 && qs(st).includes('tachycardia_reason'), 'HR-24', 'Adult, no fever, HR 118, not answered → CTAS 3 and asks the reason');
    assert(lvl({ ...ad, hr: '125', chief_complaint: 'sore throat' }, { tachycardia_reason: 'unexplained' }) === 2, 'HR-25', 'Adult, HR 125, unexplained → CTAS 2');
    assert(lvl(st, { tachycardia_reason: 'anxiety' }) > 3 || hrOf(st, { tachycardia_reason: 'anxiety' }).level == null, 'HR-26', 'Adult, HR 118, anxiety recorded → HR does not raise CTAS');
    const cp = { ...ad, hr: '118', chief_complaint: 'chest pain' };
    assert(lvl(cp) === 2 && hrOf(cp).rule_id === 'hr_adult_unexplained_cardiac', 'HR-27', 'Adult, HR 118, chest pain → CTAS 2 + ECG (unexplained with cardiac complaint)');
    assert(lvl({ ...ad, hr: '125', chief_complaint: 'palpitations' }) === 2, 'HR-28', 'Adult palpitations, HR 125, not answered → CTAS 2');
    assert(lvl({ ...ad, hr: '135', chief_complaint: 'sore throat' }, { tachycardia_reason: 'anxiety' }) === 2, 'HR-29', 'Adult HR 135, anxiety → still CTAS 2 (≥ 130 never explained)');
    assert(hrOf({ ...ad, hr: '118', temperature: '38.6', chief_complaint: 'fever' }).explained === true, 'HR-30', 'Adult, 38.6 °C, HR 118 → explained by fever (SIRS still counts it)');
  }

  // The tile, the alert and the level agree
  {
    const t1 = (interpretHR as any)(160, 1, { temperature: 39 });
    const t2 = (interpretHR as any)(180, 1, { temperature: 39 });
    const t3 = (interpretHR as any)(165, 2, {});
    assert(t1?.status === 'abnormal' && /مفسَّر/.test(t1?.label || '') && t2?.status === 'critical' && t3?.status === 'critical', 'HR-31',
      'HR tile: fever-explained amber; above the 99th red (fever or not)', JSON.stringify([t1, t2, t3]));
    let agree = true; const bad: string[] = [];
    for (const age of ['0.1', '0.4', '0.8', '2', '4', '8', '15', '30', '70']) {
      for (const temp of ['36.9', '39']) {
        for (const hr of ['35', '55', '90', '110', '125', '140', '150', '160', '175', '200']) {
          const p = { age, hr, temperature: temp, rr: '20', chief_complaint: 'abdominal pain' };
          const a = hrAlert(p); const L = lvl(p);
          if (a && L > 2) { agree = false; bad.push(`${age}y ${temp}° HR ${hr}: alert, CTAS ${L}`); }
          if (!a && hrOf(p).level === 2) { agree = false; bad.push(`${age}y ${temp}° HR ${hr}: HR CTAS 2, no alert`); }
        }
      }
    }
    assert(agree, 'HR-32', 'The HR alert shows exactly when the heart rate sets CTAS 2', bad.slice(0, 4).join('; '));
  }
}
