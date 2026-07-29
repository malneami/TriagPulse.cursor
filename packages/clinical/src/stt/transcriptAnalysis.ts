/** Transcript-aware CTAS completeness — mention detection + coach phrases. */

import { CTAS_REQUIRED_FIELDS, computeCtasCompleteness, type CtasFieldKey } from './ctasFieldSchema';
import { conservativeTranscriptCleanup } from './vocabulary';

const FIELD_MENTION_PATTERNS: Record<CtasFieldKey, RegExp[]> = {
  name: [
    /(?:patient(?:\s+name)?|name is|اسم(?: المريض)?)/i,
    /\bpatient\s+[A-Za-z\u0600-\u06FF]{2,}/i,
  ],
  age: [/age|عمر(?:ه|ها)?|years?\s*old|سنة/i, /\b\d{1,3}\s*(?:yo|y\/o)\b/i],
  chief_complaint: [
    /complaint|شكوى|كومبلين|presenting with/i,
    /chest pain|abdominal pain|headache|dyspnea|shortness of breath|fever|ألم صدر|ضيق تنفس|حمى/i,
  ],
  pain_score: [/pain score|pain\s*\d|ben score|between score|بين سكور|درجة(?:\s+الألم)?|\/10|out of ten/i],
  hr: [/heart rate|hr|pulse|نبض|النبض|\b\d{2,3}\s*bpm/i],
  bp_systolic: [/blood pressure|\bbp\b|ضغط|الضغط|\d{2,3}\s*(?:\/|over|على)\s*\d{2,3}/i],
  spo2: [/spo2|sp o2|oxygen|saturation|أكسجين|الأكسجين|\d{2,3}\s*%/i],
  rr: [/respiratory rate|resp rate|\brr\b|تنفس|معدل التنفس/i],
  temperature: [/temp|temperature|حرارة|الحرارة|\b3[0-9](?:\.\d)?\s*(?:c|°)?/i],
  gcs: [/gcs|glasgow|وعي|غلاسكو|\bgcs\s*\d{1,2}/i],
};

const SUGGESTED_PHRASES: Record<CtasFieldKey, { en: string; ar: string }> = {
  name: { en: 'Patient name is Ahmed', ar: 'اسم المريض أحمد' },
  age: { en: 'Age fifty five', ar: 'عمره خمسة وخمسين' },
  chief_complaint: { en: 'Chief complaint chest pain', ar: 'الشكوى ألم صدر' },
  pain_score: { en: 'Pain score seven out of ten', ar: 'درجة الألم سبعة من عشرة' },
  hr: { en: 'Heart rate one ten', ar: 'النبض مئة وعشرة' },
  bp_systolic: { en: 'BP one forty over ninety', ar: 'الضغط مئة وأربعين على تسعين' },
  spo2: { en: 'SpO2 ninety six percent', ar: 'الأكسجين ستة وتسعين' },
  rr: { en: 'Respiratory rate eighteen', ar: 'معدل التنفس ثمانية عشر' },
  temperature: { en: 'Temperature thirty seven', ar: 'الحرارة سبعة وثلاثين' },
  gcs: { en: 'GCS fifteen', ar: 'مستوى الوعي خمسة عشر' },
};

function fieldFilledOnPatient(key: CtasFieldKey, patient: Record<string, unknown>): boolean {
  const def = CTAS_REQUIRED_FIELDS.find((f) => f.key === key);
  return def ? def.check(patient) : false;
}

export function detectMentionedFields(transcript: string): Set<CtasFieldKey> {
  const t = conservativeTranscriptCleanup(transcript);
  const mentioned = new Set<CtasFieldKey>();
  if (!t) return mentioned;
  for (const field of CTAS_REQUIRED_FIELDS) {
    if (FIELD_MENTION_PATTERNS[field.key].some((rx) => rx.test(t))) {
      mentioned.add(field.key);
    }
  }
  return mentioned;
}

export interface TranscriptCompletenessAnalysis {
  formCompleteness: ReturnType<typeof computeCtasCompleteness>;
  mentionCompleteness: { captured: number; total: number; mentioned: CtasFieldKey[] };
  missing: CtasFieldKey[];
  mentionedNotExtracted: CtasFieldKey[];
  suggestedPhrases: Array<{ key: CtasFieldKey; label_en: string; label_ar: string; phrase_en: string; phrase_ar: string }>;
}

export function analyzeTranscriptCompleteness(
  transcript: string,
  patient: Record<string, unknown> = {},
): TranscriptCompletenessAnalysis {
  const formCompleteness = computeCtasCompleteness(patient);
  const mentioned = detectMentionedFields(transcript);
  const missing = formCompleteness.missing as CtasFieldKey[];
  const mentionedNotExtracted = missing.filter((k) => mentioned.has(k));

  const suggestedPhrases = missing.map((key) => {
    const def = CTAS_REQUIRED_FIELDS.find((f) => f.key === key)!;
    const phrases = SUGGESTED_PHRASES[key];
    return {
      key,
      label_en: def.label_en,
      label_ar: def.label_ar,
      phrase_en: phrases.en,
      phrase_ar: phrases.ar,
    };
  });

  const mentionedFilled = CTAS_REQUIRED_FIELDS.filter(
    (f) => mentioned.has(f.key) && fieldFilledOnPatient(f.key, patient),
  ).length;

  return {
    formCompleteness,
    mentionCompleteness: {
      captured: mentionedFilled,
      total: CTAS_REQUIRED_FIELDS.length,
      mentioned: [...mentioned],
    },
    missing,
    mentionedNotExtracted,
    suggestedPhrases,
  };
}
