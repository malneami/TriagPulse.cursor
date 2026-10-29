/**
 * CTAS 2025 pain modifier (approved 2026-10-29, option A): full adult and paediatric table,
 * chronic-with-objective-signs → acute, peripheral life/limb threat → central.
 */
// @ts-nocheck — JS modules
import { computeLiveCTAS } from './vitalRanges.js';

type Assert = (cond: boolean, id: string, label: string, detail?: string) => void;

export function runPainTests(assert: Assert) {
  const base = { spo2: '99', gcs: '15', rr: '16', temperature: '36.8', bp_systolic: '125', hr: '80' };
  const lvl = (p: Record<string, unknown>, a: Record<string, unknown> = {}) => (computeLiveCTAS as any)({ ...base, ...p }, a).level;
  const C = { chief_complaint: 'abdominal pain' };
  const P = { chief_complaint: 'ankle injury' };
  const chronic = { pain_duration_type: 'chronic' };
  const cells = [
    ['central acute severe', C, {}, 9, 2], ['central acute moderate', C, {}, 6, 3], ['central acute mild', C, {}, 2, 4],
    ['central chronic severe', C, chronic, 9, 3], ['central chronic moderate', C, chronic, 6, 4], ['central chronic mild', C, chronic, 2, 5],
    ['peripheral acute severe', P, {}, 9, 3], ['peripheral acute moderate', P, {}, 6, 4], ['peripheral acute mild', P, {}, 2, 5],
    ['peripheral chronic severe', P, chronic, 9, 4], ['peripheral chronic moderate', P, chronic, 6, 5], ['peripheral chronic mild', P, chronic, 2, 5],
  ];
  let bad = [];
  for (const [name, cc, a, pain, want] of cells) {
    const got = lvl({ age: '40', ...cc, pain_score: pain }, a);
    if (got !== want) bad.push(`${name}: ${got} (want ${want})`);
  }
  assert(bad.length === 0, 'PN-01', 'Adult CTAS 2025 pain table: all 12 cells', bad.join('; '));
  bad = [];
  for (const [name, a, pain, want] of [['acute severe', {}, 9, 2], ['acute moderate', {}, 6, 3], ['acute mild', {}, 2, 4],
    ['chronic severe', chronic, 9, 3], ['chronic moderate', chronic, 6, 4], ['chronic mild', chronic, 2, 5]]) {
    const got = lvl({ age: '8', hr: '90', rr: '20', bp_systolic: '100', chief_complaint: 'ankle injury', pain_score: pain }, a);
    if (got !== want) bad.push(`${name}: ${got} (want ${want})`);
  }
  assert(bad.length === 0, 'PN-02', 'Paediatric CTAS 2025 pain table: all 6 cells', bad.join('; '));
  assert(lvl({ age: '40', ...C, pain_score: 9, hr: '112' }, chronic) === 2, 'PN-03', 'Chronic central severe pain with tachycardia → triaged as acute (2)');
  assert(lvl({ age: '40', chief_complaint: 'leg pain, swelling, suspected necrotizing fasciitis', pain_score: 8 }) === 2, 'PN-04', 'Peripheral site, suspected life/limb threat → scored as central (2)');
  // Physician-reviewed adult cases (Set 4, 28 Oct 2026)
  assert(lvl({ age: '37', chief_complaint: 'flank pain', pain_score: 8, hr: '100', bp_systolic: '140' }) === 2, 'PN-05', 'A4-5 renal colic 8/10 → 2 (CTAS 2025, option A)');
  assert(lvl({ age: '42', chief_complaint: 'sudden severe headache', pain_score: 9, hr: '92', bp_systolic: '165' }) === 2, 'PN-06', 'A4-4 thunderclap headache 9/10 → 2');
  assert(lvl({ age: '29', chief_complaint: 'chest wall pain after exercise, tender on pressing', pain_score: 5, hr: '84' }) === 4, 'PN-07', 'A4-2 chest-wall pain 5/10 (peripheral) → 4 (physician: right)');
  assert(lvl({ age: '24', chief_complaint: 'ankle sprain', pain_score: 3, hr: '78' }) === 5, 'PN-08', 'A4-3 ankle sprain 3/10 → 5 (physician: right)');
}
