import type { RedFlagLibrary, RedFlagThresholds, RedFlagTextRule } from './types';

export const RED_FLAG_LIBRARY_VERSION = '1.0.0';

export const DEFAULT_RED_FLAG_THRESHOLDS: RedFlagThresholds = {
  spo2_critical: 85,
  spo2_urgent: 90,
  gcs_critical: 8,
  gcs_urgent: 13,
  sbp_critical: 70,
  sbp_urgent: 90,
  hr_severe: 130,
  rr_severe: 35,
  pain_severe: 9,
  pain_unstable_sbp: 100,
  pain_unstable_hr: 120,
};

export const DEFAULT_RED_FLAG_TEXT_RULES: RedFlagTextRule[] = [
  {
    id: 'rf_chest_pain',
    terms: ['chest pain', 'ألم صدر', 'الم صدر', 'diaphoresis', 'تعرق', 'radiation', 'يمتد', 'dyspnea', 'ضيق تنفس'],
    level: 2,
    label_ar: 'ألم صدر عالي الخطورة',
    label_en: 'High-risk chest pain',
    active: true,
  },
  {
    id: 'rf_stroke',
    terms: ['stroke', 'سكتة', 'facial droop', 'arm weakness', 'speech difficulty', 'ضعف ذراع', 'ثقل لسان', 'تلعثم'],
    level: 2,
    label_ar: 'اشتباه سكتة دماغية',
    label_en: 'Possible stroke presentation',
    active: true,
  },
  {
    id: 'rf_bleeding',
    terms: ['uncontrolled bleeding', 'نزيف شديد', 'نزيف لا يتوقف', 'major bleeding'],
    level: 1,
    label_ar: 'نزيف شديد غير مسيطر عليه',
    label_en: 'Uncontrolled major bleeding',
    active: true,
  },
  {
    id: 'rf_anaphylaxis',
    terms: ['anaphylaxis', 'تأق', 'throat swelling', 'تورم الحلق', 'stridor', 'صفير حنجري'],
    level: 1,
    label_ar: 'اشتباه تأق أو اضطراب مجرى الهواء',
    label_en: 'Possible anaphylaxis or airway compromise',
    active: true,
  },
  {
    id: 'rf_seizure',
    terms: ['seizure', 'تشنج', 'اختلاج'],
    level: 2,
    label_ar: 'تشنج/اختلاج',
    label_en: 'Seizure presentation',
    active: true,
  },
];

export function buildDefaultRedFlagLibrary(): RedFlagLibrary {
  return {
    version: RED_FLAG_LIBRARY_VERSION,
    thresholds: { ...DEFAULT_RED_FLAG_THRESHOLDS },
    text_rules: DEFAULT_RED_FLAG_TEXT_RULES.map((r) => ({ ...r, terms: [...r.terms] })),
  };
}
