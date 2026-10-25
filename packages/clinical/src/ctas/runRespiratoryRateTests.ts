/**
 * Breathing rate in children (approved 2026-10-25): under 1 y ≥ 50 → 3, ≥ 60 → 2;
 * from 1 y ED 95th/99th centile (O'Leary 2015, local HMG rule); fever never explains it;
 * crying → settled re-count; PaedCTAS low bands; alone capped at CTAS 2. Low BP for age → CTAS 1.
 */
// @ts-nocheck — JS modules
import { computeLiveCTAS, interpretRR } from './vitalRanges.js';
import { detectRedFlags } from '../alerts/redFlagEngine.js';

type Assert = (cond: boolean, id: string, label: string, detail?: string) => void;

export function runRespiratoryRateTests(assert: Assert) {
  const base = { spo2: '98', gcs: '15', bp_systolic: '100', bp_diastolic: '60', pain_score: 0, temperature: '36.9', chief_complaint: 'URTI symptoms, cough and runny nose' };
  const hrFor = (age: number) => (age < 1 ? '130' : age < 6 ? '110' : '90');
  const run = (p: Record<string, unknown>, a: Record<string, unknown> = {}) => (computeLiveCTAS as any)({ ...base, hr: hrFor(Number(p.age)), ...p }, a);
  const lvl = (p: Record<string, unknown>, a: Record<string, unknown> = {}) => run(p, a).level;
  const rrOf = (p: Record<string, unknown>, a: Record<string, unknown> = {}) => run(p, a).respiratory_rate || {};
  const qs = (p: Record<string, unknown>, a: Record<string, unknown> = {}) => (run(p, a).hr_questions || []).map((q: { field: string }) => q.field);
  const rrAlert = (p: Record<string, unknown>, a: Record<string, unknown> = {}) =>
    ((detectRedFlags({ ...base, hr: hrFor(Number(p.age)), ...p }, a) as any)?.symptoms || []).some((s: { en: string }) => /^RR /.test(s.en));
  const WELL = { looks_unwell: 'لا' };

  // Under 1 year: WHO / NICE cut-offs
  assert(lvl({ age: '0.17', rr: '55' }) === 3, 'RR-01', '2 months, RR 55 (≥ 50) → CTAS 3', `${lvl({ age: '0.17', rr: '55' })}`);
  assert(lvl({ age: '0.5', rr: '52' }) === 3, 'RR-02', '6 months, RR 52 → CTAS 3');
  assert(lvl({ age: '0.5', rr: '62' }) === 2 && rrAlert({ age: '0.5', rr: '62' }), 'RR-03', '6 months, RR 62 (≥ 60) → CTAS 2 + alert');
  assert(rrOf({ age: '0.67', rr: '40' }).level == null && !rrAlert({ age: '0.67', rr: '40' }) && lvl({ age: '0.67', rr: '40' }) > 3,
    'RR-04', '8 months, RR 40 → no level, no alert');

  // From 1 year: ED centiles
  assert(lvl({ age: '1.5', rr: '38', spo2: '93' }) === 3, 'RR-05', '18 months, RR 38, SpO₂ 93 → CTAS 3');
  assert(lvl({ age: '1.5', rr: '41' }) === 2 && rrAlert({ age: '1.5', rr: '41' }), 'RR-06', '18 months, RR 41 (above the 99th, 40) → CTAS 2 + alert');
  assert(lvl({ age: '4', rr: '30' }) === 3, 'RR-07', '4 y, RR 30 (above the 95th, 28) → CTAS 3');
  assert(lvl({ age: '7', rr: '30', temperature: '39.5', chief_complaint: 'Fever' }, WELL) === 3, 'RR-08',
    '7 y, 39.5 °C, RR 30, looks well → CTAS 3 (fever does not explain fast breathing)', `${lvl({ age: '7', rr: '30', temperature: '39.5', chief_complaint: 'Fever' }, WELL)}`);
  assert(lvl({ age: '10', rr: '28' }) === 3 && lvl({ age: '10', rr: '30' }) === 2, 'RR-09', '10 y: RR 28 → CTAS 3; RR 30 (above 29) → CTAS 2');
  assert(rrOf({ age: '13', rr: '23' }).level == null && lvl({ age: '13', rr: '23' }) > 3, 'RR-10', '13 y, RR 23 → normal');
  assert(lvl({ age: '2', rr: '60' }) === 2 && lvl({ age: '2', rr: '60', spo2: '86' }) === 1, 'RR-11',
    '2 y, RR 60 → CTAS 2 (never 1 from RR alone); with SpO₂ 86 → CTAS 1');
  assert(lvl({ age: '2', rr: '12' }) === 2, 'RR-12', '2 y, RR 12 (slow for age) → CTAS 2');
  assert(lvl({ age: '16', rr: '26' }) === 3, 'RR-13', '16 y uses the 15-year limits (RR 26 → CTAS 3)');
  assert(lvl({ age: '30', rr: '24', hr: '80' }) >= 3, 'RR-14', 'Adults: breathing-rate rule unchanged');

  // Crying: re-count when settled
  {
    const c = { age: '1', rr: '40' };
    assert(qs(c, { crying: 'نعم' }).includes('rr_recount') && lvl(c, { crying: 'نعم' }) === 3, 'RR-15', '1 y, RR 40 while crying → CTAS 3 and asks for a settled re-count');
    assert(rrOf(c, { crying: 'نعم', rr_recount: 'settled_normal' }).level == null && !qs(c, { crying: 'نعم', rr_recount: 'settled_normal' }).includes('rr_recount'),
      'RR-16', 'Normal once settled → no breathing-rate level, no further prompt');
    assert(lvl(c, { crying: 'نعم', rr_recount: 'settled_high' }) === 3, 'RR-17', 'Still high once settled → CTAS 3 stands');
  }

  // Low blood pressure for age → CTAS 1
  assert(lvl({ age: '4', bp_systolic: '70', rr: '24' }) === 1, 'RR-18', '4 y, SBP 70 (< 78 for age) → CTAS 1');
  assert(lvl({ age: '0.67', bp_systolic: '85', rr: '35' }) > 2, 'RR-19', '8 months, SBP 85 → not hypotensive');

  // Tile, alert and level agree
  {
    let agree = true; const bad: string[] = [];
    for (const age of ['0.1', '0.5', '0.9', '1.2', '2', '3.5', '5', '7', '10', '14', '17']) {
      for (const rr of ['8', '11', '14', '18', '24', '28', '30', '33', '36', '42', '52', '62']) {
        const p = { age, rr };
        const A = rrOf(p); const al = rrAlert(p); const t = (interpretRR as any)(rr, age);
        if (al !== (A.level === 2)) { agree = false; bad.push(`${age}y RR ${rr}: alert ${al}, level ${A.level}`); }
        if (A.level == null && t?.status !== 'normal') { agree = false; bad.push(`${age}y RR ${rr}: tile ${t?.status}, no level`); }
        if (A.level === 2 && t?.status !== 'critical') { agree = false; bad.push(`${age}y RR ${rr}: tile ${t?.status}, level 2`); }
        if (A.level === 3 && t?.status !== 'abnormal') { agree = false; bad.push(`${age}y RR ${rr}: tile ${t?.status}, level 3`); }
        if (A.level != null && lvl(p) > A.level) { agree = false; bad.push(`${age}y RR ${rr}: CTAS ${lvl(p)} above RR level ${A.level}`); }
      }
    }
    assert(agree, 'RR-20', 'The RR tile, alert and CTAS level agree across ages', bad.slice(0, 4).join('; '));
  }
}
