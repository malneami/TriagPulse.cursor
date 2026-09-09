const NUMERIC_LIMITS: Record<string, { min: number; max: number; label: string }> = {
  age: { min: 0, max: 120, label: 'Age' },
  weight: { min: 1, max: 300, label: 'Weight' },
  hr: { min: 20, max: 250, label: 'HR' },
  bp_systolic: { min: 40, max: 300, label: 'Systolic BP' },
  bp_diastolic: { min: 20, max: 200, label: 'Diastolic BP' },
  spo2: { min: 40, max: 100, label: 'SpO₂' },
  rr: { min: 4, max: 70, label: 'RR' },
  temperature: { min: 32, max: 43, label: 'Temperature' },
  gcs: { min: 3, max: 15, label: 'GCS' },
  pain_score: { min: 0, max: 10, label: 'Pain score' },
};

/** Minimal hard gate for Confirm Triage — blank vitals are treated as non-abnormal by the rules engine. */
export const REQUIRED_TRIAGE_FIELDS = [
  { key: 'chief_complaint', label_ar: 'الشكوى الرئيسية', label_en: 'Chief complaint' },
];

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function toNumber(value: unknown): number | null {
  if (isBlank(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function getMissingTriageFields(patient: Record<string, unknown>) {
  return REQUIRED_TRIAGE_FIELDS.filter((field) => {
    if ('alt' in field && field.alt) {
      return isBlank(patient?.[field.key]) && isBlank(patient?.[field.alt as string]);
    }
    return isBlank(patient?.[field.key]);
  });
}

export function validateVitals(patient: Record<string, unknown>): string[] {
  const errors: string[] = [];
  Object.entries(NUMERIC_LIMITS).forEach(([key, cfg]) => {
    if (isBlank(patient?.[key])) return;
    const n = toNumber(patient[key]);
    if (n === null) {
      errors.push(`${cfg.label} must be numeric`);
      return;
    }
    if (n < cfg.min || n > cfg.max) {
      errors.push(`${cfg.label} outside accepted range (${cfg.min}-${cfg.max})`);
    }
  });
  const sbp = toNumber(patient?.bp_systolic);
  const dbp = toNumber(patient?.bp_diastolic);
  if (sbp !== null && dbp !== null && dbp >= sbp) {
    errors.push('Diastolic BP must be lower than systolic BP');
  }
  return errors;
}

export function validateTriageReady(patient: Record<string, unknown>) {
  const missing = getMissingTriageFields(patient);
  const vitalErrors = validateVitals(patient);
  return {
    ok: missing.length === 0 && vitalErrors.length === 0,
    missing,
    errors: vitalErrors,
  };
}

export function validateRegistration(form: Record<string, unknown>) {
  const errors: string[] = [];
  if (!form.patient_name_ar && !form.patient_name_en) errors.push('Patient name is required');
  const age = toNumber(form.age);
  if (age === null) errors.push('Age is required');
  if (age !== null && (age < 0 || age > 120)) errors.push('Age outside accepted range');
  if (!form.gender) errors.push('Gender is required');
  return { ok: errors.length === 0, errors };
}
