/**
 * Fever / SIRS / hemodynamic validation suite — release gate for CTAS rules engine.
 */
import { computeLiveCTAS } from './vitalRanges.js';

export const FEVER_VALIDATION_CASES = [
  {
    id: 'FEVER-01',
    name: 'Fever only, looks well',
    patient: {
      age: 45, chief_complaint: 'Fever / حمى', hr: 82, bp_systolic: 118, bp_diastolic: 72,
      spo2: 98, rr: 16, temperature: 38.6, gcs: 15, pain_score: 1,
    },
    answers: { looks_unwell: 'لا', looks_well: 'نعم' },
    expectedLevel: 4,
    expectedSirsMax: 1,
    mustNotBe: [1, 2],
  },
  {
    id: 'FEVER-02',
    name: 'Fever + tachycardia, looks unwell, <3 SIRS',
    patient: {
      age: 50, chief_complaint: 'Fever / حمى', hr: 125, bp_systolic: 118, bp_diastolic: 70,
      spo2: 98, rr: 18, temperature: 39.0, gcs: 15, pain_score: 2,
    },
    answers: { looks_unwell: 'نعم' },
    expectedLevel: 3,
    expectedSirsExact: 2,
    mustNotBe: [1],
  },
  {
    id: 'FEVER-03',
    name: 'Fever with three known SIRS criteria',
    patient: {
      age: 48, chief_complaint: 'Fever / حمى', hr: 110, bp_systolic: 120, bp_diastolic: 75,
      spo2: 97, rr: 24, temperature: 38.8, gcs: 15, pain_score: 2, wbc: 14,
    },
    answers: { looks_unwell: 'نعم' },
    expectedLevel: 2,
    expectedSirsMin: 3,
    mustNotBe: [1],
  },
  {
    id: 'FEVER-04',
    name: 'Fever in immunocompromised patient',
    patient: {
      age: 62, chief_complaint: 'Fever / حمى', hr: 88, bp_systolic: 122, bp_diastolic: 78,
      spo2: 98, rr: 16, temperature: 38.2, gcs: 15, pain_score: 1,
    },
    answers: { immunocompromised: 'نعم', looks_unwell: 'لا' },
    expectedLevel: 2,
    mustNotBe: [1],
  },
  {
    id: 'FEVER-05',
    name: 'Fever with hemodynamic compromise',
    patient: {
      age: 55, chief_complaint: 'Fever / حمى', hr: 118, bp_systolic: 86, bp_diastolic: 50,
      spo2: 96, rr: 20, temperature: 39.1, gcs: 15, pain_score: 3,
    },
    answers: { looks_unwell: 'نعم', poor_perfusion: 'نعم' },
    expectedLevel: 2,
    mustNotBe: [1],
  },
  {
    id: 'FEVER-06',
    name: 'Fever with septic shock features',
    patient: {
      age: 70, chief_complaint: 'Fever / حمى', hr: 140, bp_systolic: 68, bp_diastolic: 40,
      spo2: 90, rr: 28, temperature: 39.4, gcs: 12, pain_score: 2,
    },
    answers: { looks_unwell: 'نعم', septic_shock: 'نعم', shock: 'نعم' },
    expectedLevel: 1,
  },
  {
    id: 'FEVER-07',
    name: 'Febrile neonate (configured band)',
    patient: {
      age: 0.05, chief_complaint: 'Fever / حمى', hr: 160, bp_systolic: 75,
      spo2: 98, rr: 45, temperature: 38.2, gcs: 15, pain_score: 0,
    },
    answers: {},
    expectedLevel: 1,
  },
  {
    id: 'FEVER-08',
    name: 'Febrile child with age-appropriate tachycardia',
    patient: {
      age: 4, chief_complaint: 'Fever / حمى', hr: 135, bp_systolic: 95,
      spo2: 98, rr: 28, temperature: 38.7, gcs: 15, pain_score: 2,
    },
    answers: { looks_unwell: 'لا' },
    mustNotBe: [1],
    expectedLevelMin: 3,
  },
  {
    id: 'FEVER-09',
    name: 'Febrile child with poor perfusion',
    patient: {
      age: 3, chief_complaint: 'Fever child looks unwell / حمى', hr: 155, bp_systolic: 78,
      spo2: 95, rr: 36, temperature: 39.5, gcs: 14, pain_score: 4,
    },
    answers: { looks_unwell: 'نعم', poor_perfusion: 'نعم', delayed_cap_refill: 'نعم' },
    expectedLevelMax: 2,
  },
  {
    id: 'FEVER-10',
    name: 'Chronic baseline abnormality, no acute change',
    patient: {
      age: 68, chief_complaint: 'Fever / حمى', hr: 105, bp_systolic: 128,
      spo2: 97, rr: 18, temperature: 38.3, gcs: 15, pain_score: 1,
    },
    answers: {
      looks_unwell: 'لا',
      looks_well: 'نعم',
      vital_chronicity: 'chronic baseline unchanged',
      baseline_unchanged: 'نعم',
      expected_tachycardia: 'نعم',
    },
    mustNotBe: [1, 2],
    expectedLevelMin: 3,
  },
];

/**
 * @param {(ok: boolean, id: string, name: string, detail?: string) => void} assertFn
 */
export function runFeverValidationSuite(assertFn: (
  ok: boolean,
  id: string,
  name: string,
  detail?: string,
) => void) {
  for (const tc of FEVER_VALIDATION_CASES) {
    const result = computeLiveCTAS(tc.patient, tc.answers || {});
    const level = result?.level ?? null;
    const sirs = result?.sirs || result?.assessment_trail?.step3_primary_modifiers?.sirs;
    const hrCriteria = (sirs?.details || []).filter((d: { criterion?: string }) => d.criterion === 'heart_rate');

    let ok = level != null;
    if (tc.expectedLevel != null && level !== tc.expectedLevel) ok = false;
    if (tc.expectedLevelMax != null && (level ?? 99) > tc.expectedLevelMax) ok = false;
    if (tc.expectedLevelMin != null && (level ?? 0) < tc.expectedLevelMin) ok = false;
    if (tc.mustNotBe?.includes(level as number)) ok = false;
    if (tc.expectedSirsExact != null && sirs?.known_positive_count !== tc.expectedSirsExact) ok = false;
    if (tc.expectedSirsMax != null && (sirs?.known_positive_count ?? 99) > tc.expectedSirsMax) ok = false;
    if (tc.expectedSirsMin != null && (sirs?.known_positive_count ?? 0) < tc.expectedSirsMin) ok = false;
    if (hrCriteria.length > 1) ok = false;

    assertFn(
      ok,
      tc.id,
      tc.name,
      `level=${level} sirs=${sirs?.known_positive_count} just=${(result?.justification_en || '').slice(0, 120)}`,
    );
  }
}
