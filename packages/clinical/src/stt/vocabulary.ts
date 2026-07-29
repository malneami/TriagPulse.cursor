import type { SttFieldDefinition } from './types';

/** Triage field list from BUILD PROMPT — names, types, required flags. */
export const STT_FIELD_DEFINITIONS: SttFieldDefinition[] = [
  { key: 'name', label_en: 'Name', label_ar: 'الاسم', required: true, type: 'text' },
  { key: 'age', label_en: 'Age', label_ar: 'العمر', required: true, type: 'integer' },
  { key: 'sex', label_en: 'Sex', label_ar: 'الجنس', required: true, type: 'enum' },
  { key: 'chief_complaint', label_en: 'Chief complaint', label_ar: 'الشكوى الرئيسية', required: true, type: 'text' },
  { key: 'onset_duration', label_en: 'Onset / duration', label_ar: 'البداية / المدة', required: true, type: 'text' },
  { key: 'vital_signs', label_en: 'Vital signs', label_ar: 'العلامات الحيوية', required: false, type: 'vitals' },
  { key: 'pain_score', label_en: 'Pain score', label_ar: 'درجة الألم', required: false, type: 'integer' },
  { key: 'allergies', label_en: 'Allergies', label_ar: 'الحساسية', required: true, type: 'text' },
  { key: 'current_medications', label_en: 'Current medications', label_ar: 'الأدوية الحالية', required: false, type: 'list' },
  { key: 'relevant_history', label_en: 'Relevant history', label_ar: 'التاريخ المرضي', required: false, type: 'text' },
  { key: 'acuity_proposed', label_en: 'Acuity (proposed)', label_ar: 'الأولوية (مقترحة)', required: false, type: 'enum' },
];

export const STT_REQUIRED_KEYS = STT_FIELD_DEFINITIONS.filter((f) => f.required).map((f) => f.key);

export const CLINICAL_STT_VOCABULARY = [
  'CTAS', 'triage', 'patient name', 'age', 'male', 'female', 'complaint',
  'HR', 'heart rate', 'BP', 'blood pressure', 'SpO2', 'O2 sat', 'oxygen saturation',
  'RR', 'respiratory rate', 'temperature', 'temp', 'GCS', 'Glasgow Coma Scale',
  'pain score', 'chest pain', 'abdominal pain', 'dyspnea', 'shortness of breath', 'stroke', 'fever',
  'NKDA', 'no known allergies', 'aspirin', 'metformin', 'insulin',
  'اسم المريض', 'العمر', 'ذكر', 'أنثى', 'الشكوى', 'ألم', 'النبض', 'الضغط', 'الأكسجين',
  'التنفس', 'الحرارة', 'الوعي', 'ألم صدر', 'ضيق تنفس', 'حمى', 'لا حساسية', 'منذ', 'ساعة', 'ساعات',
];

export function buildCodeSwitchPrompt(customPrompt = ''): string {
  const vocab = CLINICAL_STT_VOCABULARY.slice(0, 28).join(', ');
  const base = `CTAS triage: ${vocab}.`;
  const extra = String(customPrompt || '').trim().slice(0, 200);
  return extra ? `${base} ${extra}` : base;
}

export function buildMixedSttPrompt(customPrompt = ''): string {
  return buildCodeSwitchPrompt(
    `Mixed Arabic and English ED dictation. Preserve code-switching. Do not translate. ${customPrompt}`.trim(),
  );
}

export function buildArabicSttPrompt(): string {
  return buildCodeSwitchPrompt('Arabic clinical dictation only.');
}

export function buildEnglishSttPrompt(): string {
  return buildCodeSwitchPrompt('English clinical dictation only.');
}

export function resolveSttPrompt(languageHint?: 'en' | 'ar' | 'mixed'): string {
  if (languageHint === 'ar') return buildArabicSttPrompt();
  if (languageHint === 'en') return buildEnglishSttPrompt();
  return buildMixedSttPrompt();
}

export function detectTranscriptLanguage(text: string) {
  const value = String(text || '').trim();
  const arabicChars = (value.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (value.match(/[A-Za-z]/g) || []).length;
  const arabicWords = (value.match(/[\u0600-\u06FF]+/g) || []).length;
  const englishWords = (value.match(/[A-Za-z]+/g) || []).length;
  const totalLetters = arabicChars + latinChars;
  const arabicRatio = totalLetters ? arabicChars / totalLetters : 0;
  const englishRatio = totalLetters ? latinChars / totalLetters : 0;
  let detected: 'unknown' | 'arabic' | 'english' | 'mixed_arabic_english' = 'unknown';
  if (arabicChars > 0 && latinChars > 0) detected = 'mixed_arabic_english';
  else if (arabicChars > 0) detected = 'arabic';
  else if (latinChars > 0) detected = 'english';
  return {
    detected_language: detected,
    has_arabic: arabicChars > 0,
    has_english: latinChars > 0,
    arabic_words: arabicWords,
    english_words: englishWords,
    arabic_ratio: Number(arabicRatio.toFixed(3)),
    english_ratio: Number(englishRatio.toFixed(3)),
  };
}

export function conservativeTranscriptCleanup(text = ''): string {
  let t = String(text || '').trim();
  if (!t) return '';
  t = t
    .replace(/\b(passion|pation|patience)\b/gi, 'patient')
    .replace(/\b(chase|case|cheese|chaste|jest|just)\s+pain\b/gi, 'chest pain')
    .replace(/\bchest\s+patient\b/gi, 'chest pain')
    .replace(/\bheart\s+(raid|read)\b/gi, 'heart rate')
    .replace(/\brespiratory\s+(raid|read)\b/gi, 'respiratory rate')
    .replace(/\boxygen\s+(station|situation|section)\b/gi, 'oxygen saturation')
    .replace(/\bblood\s+(press|precious|pleasure)\b/gi, 'blood pressure')
    .replace(/\bsp\s?o\s?two\b/gi, 'SpO2')
    .replace(/\bo\s?two\b/gi, 'O2')
    .replace(/\btemperature\b/gi, 'temp')
    .replace(/\bglascow\b/gi, 'Glasgow')
    .replace(/\bglasco\b/gi, 'Glasgow')
    .replace(/\b(ben|between)\s+score\b/gi, 'pain score')
    .replace(/بين\s*سكور/g, 'pain score')
    .replace(/كومبلين/g, 'complaint')
    .replace(/كومبلaint/gi, 'complaint')
    .replace(/\bheart\s+read\b/gi, 'heart rate')
    .replace(/\bblood\s+precious\b/gi, 'blood pressure')
    .replace(/الظغط/g, 'الضغط')
    .replace(/الضقط/g, 'الضغط')
    .replace(/الاكسجين/g, 'الأكسجين')
    .replace(/اوكسجين/g, 'أكسجين')
    .replace(/حراره/g, 'حرارة')
    .replace(/انثى/g, 'أنثى');
  return t.replace(/\s+/g, ' ').trim();
}

export function segmentTranscriptByLanguage(text: string, baseConfidence = 0.85): import('./types').LanguageSegment[] {
  const cleaned = conservativeTranscriptCleanup(text);
  if (!cleaned) return [];
  const parts = cleaned.split(/(?=[\u0600-\u06FF])|(?<=[\u0600-\u06FF])(?=[A-Za-z])|(?<=[A-Za-z])(?=[\u0600-\u06FF])/);
  const segments: import('./types').LanguageSegment[] = [];
  let offset = 0;
  for (const part of parts) {
    const chunk = part.trim();
    if (!chunk) continue;
    const hasAr = /[\u0600-\u06FF]/.test(chunk);
    const hasEn = /[A-Za-z]/.test(chunk);
    const lang = hasAr && hasEn ? 'mixed' : hasAr ? 'ar' : 'en';
    segments.push({ lang, text: chunk, start: offset, end: offset + chunk.length, confidence: baseConfidence });
    offset += chunk.length + 1;
  }
  if (segments.length === 0) {
    const profile = detectTranscriptLanguage(cleaned);
    const lang = profile.detected_language === 'arabic' ? 'ar' : profile.detected_language === 'english' ? 'en' : 'mixed';
    segments.push({ lang, text: cleaned, start: 0, end: cleaned.length, confidence: baseConfidence });
  }
  return segments;
}
