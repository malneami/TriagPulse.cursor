const NUMERIC_LIMITS = {
  age: { min: 0, max: 120, label: 'Age' },
  hr: { min: 20, max: 250, label: 'HR' },
  bp_systolic: { min: 40, max: 300, label: 'Systolic BP' },
  bp_diastolic: { min: 20, max: 200, label: 'Diastolic BP' },
  spo2: { min: 40, max: 100, label: 'SpO₂' },
  rr: { min: 4, max: 70, label: 'RR' },
  temperature: { min: 32, max: 43, label: 'Temperature' },
  gcs: { min: 3, max: 15, label: 'GCS' },
  pain_score: { min: 0, max: 10, label: 'Pain score' },
};

export const REQUIRED_TRIAGE_FIELDS = [
  { key: 'patient_name_ar', label_ar: 'الاسم', label_en: 'Name', alt: 'patient_name_en' },
  { key: 'age', label_ar: 'العمر', label_en: 'Age' },
  { key: 'chief_complaint', label_ar: 'الشكوى الرئيسية', label_en: 'Chief complaint' },
  { key: 'pain_score', label_ar: 'درجة الألم', label_en: 'Pain score' },
  { key: 'hr', label_ar: 'النبض', label_en: 'HR' },
  { key: 'bp_systolic', label_ar: 'الضغط الانقباضي', label_en: 'SBP' },
  { key: 'spo2', label_ar: 'الأكسجين', label_en: 'SpO₂' },
  { key: 'rr', label_ar: 'معدل التنفس', label_en: 'RR' },
  { key: 'temperature', label_ar: 'الحرارة', label_en: 'Temperature' },
  { key: 'gcs', label_ar: 'مستوى الوعي', label_en: 'GCS' },
];

function isBlank(value) {
  return value === undefined || value === null || value === '';
}

function toNumber(value) {
  if (isBlank(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function getMissingTriageFields(patient) {
  return REQUIRED_TRIAGE_FIELDS.filter((field) => {
    if (field.alt) return isBlank(patient?.[field.key]) && isBlank(patient?.[field.alt]);
    return isBlank(patient?.[field.key]);
  });
}

export function validateVitals(patient) {
  const errors = [];
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

export function validateTriageReady(patient) {
  const missing = getMissingTriageFields(patient);
  const vitalErrors = validateVitals(patient);
  return {
    ok: missing.length === 0 && vitalErrors.length === 0,
    missing,
    errors: vitalErrors,
  };
}

export function validateRegistration(form) {
  const errors = [];
  if (!form.patient_name_ar && !form.patient_name_en) errors.push('Patient name is required');
  const age = toNumber(form.age);
  if (age === null) errors.push('Age is required');
  if (age !== null && (age < 0 || age > 120)) errors.push('Age outside accepted range');
  if (!form.gender) errors.push('Gender is required');
  return { ok: errors.length === 0, errors };
}
