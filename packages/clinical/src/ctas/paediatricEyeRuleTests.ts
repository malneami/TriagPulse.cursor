import { evaluateCtasRules } from './ctasRulesEngine';
import { paedEyeDestination } from './ctasRulesEngine';
import { resolveDirection } from '../routing/routingConfig';

type Assert = (cond: boolean, id: string, name: string, detail?: string) => void;

const BASE = { hr: 100, rr: 22, spo2: 99, temperature: 36.8, gcs: 15, bp_systolic: 100, bp_diastolic: 60, pain_score: 0 } as const;

// [id, age, complaint, reviewed CTAS, extra vitals]. Levels follow the reviewed sheet (clinician direction, PR #39).
const CASES: Array<[string, number, string, number, Record<string, unknown>]> = [
  ['PE-01', 8, 'chemical splash to the eye', 2, { pain_score: 6 }],
  ['PE-02', 8, 'penetrating eye injury from a metal piece', 2, { pain_score: 4 }],
  ['PE-03', 8, 'sudden change in vision in my eye', 2, {}],
  ['PE-04', 6, 'swelling around the right eye with fever, pain on moving the eye', 2, { temperature: 38.8 }],
  ['PE-06', 8, 'foreign body in eye, penetrating metal', 2, {}],
  ['PE-07', 8, 'foreign body in eye, mild pain', 4, { pain_score: 2 }],
  ['PE-08', 8, 'hit in the eye with a ball, cannot see well', 2, { pain_score: 3 }],
  ['PE-09', 8, 'eye injury, mild pain', 4, { pain_score: 2 }],
  ['PE-10', 8, 'red eye with watery discharge', 4, {}],
  ['PE-11', 8, 'chronic red eye for months', 5, {}],
  ['PE-12', 8, 'photophobia, light hurts my eyes', 4, {}],
  ['PE-13', 8, 'double vision came on today', 3, {}],
  ['PE-14', 8, 'chronic double vision for months', 4, {}],
  ['PE-15', 8, 'gradual blurry vision for months', 4, {}],
  ['PE-16', 8, 'chronic eye pain for weeks', 5, {}],
  ['PE-17', 8, 'headache with blurred vision', 2, {}],
];

export function runPaediatricEyeRuleTests(assert: Assert): void {
  for (const [id, age, complaint, expected, extra] of CASES) {
    const r = evaluateCtasRules({ patient: { ...BASE, ...extra, age, chief_complaint: complaint } as any, answers: {}, transcript: '' } as any) as any;
    assert(r.level === expected, id, `paediatric eye: ${complaint}`, `expected CTAS ${expected}, got ${r.level}`);
  }
  // PE-05 (periorbital swelling with fever, no cellulitis features) is reviewed as CTAS 4 → Clinic.
  // The existing paediatric fever rule (CTAS 3 for fever ≥ 38.5 °C, age ≥ 3) still gives 3. Open decision; the test records current behaviour.
  const pe05 = evaluateCtasRules({ patient: { ...BASE, temperature: 38.8, age: 6, chief_complaint: 'swelling around the right eye with fever' } as any, answers: {}, transcript: '' } as any) as any;
  assert(pe05.level === 3, 'PE-05', 'KNOWN OPEN: periorbital swelling with fever, no features (reviewed CTAS 4 vs fever rule CTAS 3)', `got ${pe05.level}`);
}

// Destination zones for the reviewed eye presentations (PR #39 reviewed areas).
const ZONE_CASES: Array<[string, number, string, string, Record<string, unknown>]> = [
  ['PE-01', 8, 'chemical splash to the eye', 'PEDIATRIC_RESUS', { pain_score: 6 }],
  ['PE-02', 8, 'penetrating eye injury from a metal piece', 'PEDIATRIC_OBSERVATION', { pain_score: 4 }],
  ['PE-03', 8, 'sudden change in vision in my eye', 'PEDIATRIC_OBSERVATION', {}],
  ['PE-04', 6, 'swelling around the right eye with fever, pain on moving the eye', 'PEDIATRIC_OBSERVATION', { temperature: 38.8 }],
  ['PE-05', 6, 'swelling around the right eye with fever', 'PEDIATRIC_CLINIC', { temperature: 38.8 }],
  ['PE-06', 8, 'foreign body in eye, penetrating metal', 'PEDIATRIC_OBSERVATION', {}],
  ['PE-07', 8, 'foreign body in eye, mild pain', 'PEDS_FAST_TRACK', { pain_score: 2 }],
  ['PE-08', 8, 'hit in the eye with a ball, cannot see well', 'PEDIATRIC_OBSERVATION', { pain_score: 3 }],
  ['PE-09', 8, 'eye injury, mild pain', 'PEDS_FAST_TRACK', { pain_score: 2 }],
  ['PE-10', 8, 'red eye with watery discharge', 'PEDIATRIC_CLINIC', {}],
  ['PE-11', 8, 'chronic red eye for months', 'PEDIATRIC_CLINIC', {}],
  ['PE-12', 8, 'photophobia, light hurts my eyes', 'PEDIATRIC_CLINIC', {}],
  ['PE-13', 8, 'double vision came on today', 'PEDIATRIC_OBSERVATION', {}],
  ['PE-14', 8, 'chronic double vision for months', 'PEDIATRIC_CLINIC', {}],
  ['PE-15', 8, 'gradual blurry vision for months', 'PEDIATRIC_CLINIC', {}],
  ['PE-16', 8, 'chronic eye pain for weeks', 'PEDIATRIC_CLINIC', {}],
  ['PE-17', 8, 'headache with blurred vision', 'PEDIATRIC_OBSERVATION', {}],
];

export function runPaediatricEyeZoneTests(assert: Assert): void {
  for (const [id, age, complaint, zone, extra] of ZONE_CASES) {
    const d = paedEyeDestination({ age, text: complaint, pain: (extra.pain_score as number) ?? null, temperature: (extra.temperature as number) ?? null });
    assert(d?.zone === zone, `${id}-ZONE`, `paediatric eye zone: ${complaint}`, `expected ${zone}, got ${d?.zone ?? 'none'}`);
  }
  // Resolved direction: PE-05 keeps CTAS 3 but goes to Clinic via the eye hint.
  const pe05 = paedEyeDestination({ age: 6, text: 'swelling around the right eye with fever', temperature: 38.8 });
  const dir = resolveDirection({ level: 3, age: 6, complaints: [], directionApplied: [{ ...pe05, paed_eye_zone: true, destination_hint: pe05?.zone }] as any }) as any;
  assert(dir?.destination === 'PEDIATRIC_CLINIC', 'PE-05-DIR', 'PE-05 at CTAS 3 is directed to Clinic', `got ${dir?.destination}`);
}
