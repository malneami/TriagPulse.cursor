/** 10-field CTAS completeness schema — mirrors Triage.jsx REQUIRED_FIELDS. */

export type CtasFieldKey =
  | 'name'
  | 'age'
  | 'chief_complaint'
  | 'pain_score'
  | 'hr'
  | 'bp_systolic'
  | 'spo2'
  | 'rr'
  | 'temperature'
  | 'gcs';

export interface CtasFieldDefinition {
  key: CtasFieldKey;
  label_ar: string;
  label_en: string;
  scrollTo: string;
  check: (patient: Record<string, unknown>) => boolean;
}

export const CTAS_REQUIRED_FIELDS: CtasFieldDefinition[] = [
  { key: 'name', label_ar: 'الاسم', label_en: 'Name', scrollTo: 'chief-complaint', check: (p) => !!(p.patient_name_ar || p.patient_name_en) },
  { key: 'age', label_ar: 'العمر', label_en: 'Age', scrollTo: 'chief-complaint', check: (p) => !!p.age },
  { key: 'chief_complaint', label_ar: 'الشكوى', label_en: 'Complaint', scrollTo: 'chief-complaint', check: (p) => !!p.chief_complaint },
  { key: 'pain_score', label_ar: 'درجة الألم', label_en: 'Pain Score', scrollTo: 'pain-scale', check: (p) => p.pain_score != null && p.pain_score !== '' },
  { key: 'hr', label_ar: 'النبض', label_en: 'HR', scrollTo: 'vitals-form', check: (p) => !!p.hr },
  { key: 'bp_systolic', label_ar: 'الضغط', label_en: 'BP', scrollTo: 'vitals-form', check: (p) => !!p.bp_systolic },
  { key: 'spo2', label_ar: 'الأكسجين', label_en: 'SpO₂', scrollTo: 'vitals-form', check: (p) => !!p.spo2 },
  { key: 'rr', label_ar: 'معدل التنفس', label_en: 'RR', scrollTo: 'vitals-form', check: (p) => !!p.rr },
  { key: 'temperature', label_ar: 'درجة الحرارة', label_en: 'Temp', scrollTo: 'vitals-form', check: (p) => !!p.temperature },
  { key: 'gcs', label_ar: 'مستوى الوعي', label_en: 'GCS', scrollTo: 'vitals-form', check: (p) => !!p.gcs },
];

export const CTAS_REQUIRED_FIELD_KEYS = CTAS_REQUIRED_FIELDS.map((f) => f.key);

/** Maps STT/extraction patient keys to CTAS field keys for confidence tracking. */
export const PATIENT_KEY_TO_CTAS: Record<string, CtasFieldKey> = {
  patient_name_ar: 'name',
  patient_name_en: 'name',
  age: 'age',
  chief_complaint: 'chief_complaint',
  pain_score: 'pain_score',
  hr: 'hr',
  bp_systolic: 'bp_systolic',
  bp_diastolic: 'bp_systolic',
  spo2: 'spo2',
  rr: 'rr',
  temperature: 'temperature',
  gcs: 'gcs',
};

export function computeCtasCompleteness(patient: Record<string, unknown>) {
  const missing = CTAS_REQUIRED_FIELDS.filter((f) => !f.check(patient));
  return {
    captured: CTAS_REQUIRED_FIELDS.length - missing.length,
    total: CTAS_REQUIRED_FIELDS.length,
    missing: missing.map((f) => f.key),
    missingLabels: missing.map((f) => ({ key: f.key, label_ar: f.label_ar, label_en: f.label_en })),
    isComplete: missing.length === 0,
  };
}

export function getCtasMissingLabels(patient: Record<string, unknown>) {
  return computeCtasCompleteness(patient).missingLabels;
}
