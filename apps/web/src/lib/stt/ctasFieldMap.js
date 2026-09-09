/**
 * Web-side CTAS/STT helpers — self-contained to avoid Vite CJS/ESM interop crashes.
 * Logic mirrors packages/clinical/src/stt/{ctasFieldSchema,extractFields}.ts
 */

/**
 * `key` is the CTAS field id, which is NOT always a patient property — `bp_systolic`
 * reads better paired with the diastolic. Every entry therefore carries `value`
 * alongside `check`, so anything displaying a field uses the same accessor the
 * completeness check uses and the two cannot disagree.
 */
function hasNumericWeight(p) {
  const n = Number(p.weight);
  return p.weight != null && p.weight !== '' && Number.isFinite(n) && n > 0;
}

export const CTAS_REQUIRED_FIELDS = [
  { key: 'weight', label_ar: 'الوزن', label_en: 'Weight', scrollTo: 'vitals-form', check: hasNumericWeight, value: (p) => `${p.weight} kg` },
  { key: 'age', label_ar: 'العمر', label_en: 'Age', scrollTo: 'chief-complaint', check: (p) => !!p.age, value: (p) => {
    const n = parseFloat(p.age);
    if (!Number.isFinite(n)) return p.age;
    if (n > 0 && n < 1) {
      const months = Math.round(n * 12);
      if (months >= 1) return `${months} شهر`;
      const weeks = Math.round(n * 52);
      if (weeks >= 1) return `${weeks} أسبوع`;
      return `${Math.max(1, Math.round(n * 365))} يوم`;
    }
    return p.age;
  } },
  { key: 'chief_complaint', label_ar: 'الشكوى', label_en: 'Complaint', scrollTo: 'chief-complaint', check: (p) => !!p.chief_complaint, value: (p) => p.chief_complaint },
  { key: 'pain_score', label_ar: 'درجة الألم', label_en: 'Pain Score', scrollTo: 'pain-scale', check: (p) => p.pain_score != null && p.pain_score !== '', value: (p) => `${p.pain_score}/10` },
  { key: 'hr', label_ar: 'النبض', label_en: 'HR', scrollTo: 'vitals-form', check: (p) => !!p.hr, value: (p) => p.hr },
  { key: 'bp_systolic', label_ar: 'الضغط', label_en: 'BP', scrollTo: 'vitals-form', check: (p) => !!p.bp_systolic, value: (p) => (p.bp_diastolic ? `${p.bp_systolic}/${p.bp_diastolic}` : p.bp_systolic) },
  { key: 'spo2', label_ar: 'الأكسجين', label_en: 'SpO₂', scrollTo: 'vitals-form', check: (p) => !!p.spo2, value: (p) => `${p.spo2}%` },
  { key: 'rr', label_ar: 'معدل التنفس', label_en: 'RR', scrollTo: 'vitals-form', check: (p) => !!p.rr, value: (p) => p.rr },
  { key: 'temperature', label_ar: 'درجة الحرارة', label_en: 'Temp', scrollTo: 'vitals-form', check: (p) => !!p.temperature, value: (p) => `${p.temperature}°C` },
  { key: 'gcs', label_ar: 'مستوى الوعي', label_en: 'GCS', scrollTo: 'vitals-form', check: (p) => !!p.gcs, value: (p) => `${p.gcs}/15` },
];

export function computeCtasCompleteness(patient) {
  const missing = CTAS_REQUIRED_FIELDS.filter((f) => !f.check(patient));
  return {
    captured: CTAS_REQUIRED_FIELDS.length - missing.length,
    total: CTAS_REQUIRED_FIELDS.length,
    missing: missing.map((f) => f.key),
    missingLabels: missing.map((f) => ({ key: f.key, label_ar: f.label_ar, label_en: f.label_en })),
    isComplete: missing.length === 0,
  };
}

function slotValue(fields, key) {
  const slot = fields?.[key];
  if (!slot || slot.value == null || slot.value === '') return null;
  if (Array.isArray(slot.value) && slot.value.length === 0) return null;
  return slot;
}

export function mapSttSessionToPatientUpdates(fields) {
  const updates = {};
  const fieldConfidence = {};

  const set = (key, value, confidence) => {
    if (value == null || value === '') return;
    updates[key] = value;
    fieldConfidence[key] = confidence ?? 0.8;
  };

  const nameSlot = slotValue(fields, 'name');
  if (nameSlot) {
    const name = String(nameSlot.value);
    if (/[\u0600-\u06FF]/.test(name)) set('patient_name_ar', name, nameSlot.confidence);
    else set('patient_name_en', name, nameSlot.confidence);
  }

  const ageSlot = slotValue(fields, 'age');
  if (ageSlot) set('age', String(ageSlot.value), ageSlot.confidence);

  const sexSlot = slotValue(fields, 'sex');
  if (sexSlot?.value === 'M') set('gender', 'male', sexSlot.confidence);
  if (sexSlot?.value === 'F') set('gender', 'female', sexSlot.confidence);

  const complaintSlot = slotValue(fields, 'chief_complaint');
  if (complaintSlot) set('chief_complaint', complaintSlot.value, complaintSlot.confidence);

  const onsetSlot = slotValue(fields, 'onset_duration');
  if (onsetSlot) set('onset_duration', onsetSlot.value, onsetSlot.confidence);

  const painSlot = slotValue(fields, 'pain_score');
  if (painSlot) set('pain_score', painSlot.value, painSlot.confidence);

  const weightSlot = slotValue(fields, 'weight');
  if (weightSlot) set('weight', weightSlot.value, weightSlot.confidence);

  const vitalsSlot = slotValue(fields, 'vital_signs');
  const vitals = vitalsSlot?.value;
  if (Array.isArray(vitals)) {
    const conf = vitalsSlot.confidence ?? 0.88;
    for (const v of vitals) {
      if (v.type === 'HR') set('hr', String(v.value), conf);
      if (v.type === 'SpO2') set('spo2', String(v.value), conf);
      if (v.type === 'RR') set('rr', String(v.value), conf);
      if (v.type === 'Temp') set('temperature', String(v.value), conf);
      if (v.type === 'GCS') set('gcs', String(v.value), conf);
      if (v.type === 'Weight') set('weight', v.value, conf);
      if (v.type === 'BP' && typeof v.value === 'string') {
        const [sys, dia] = v.value.split('/');
        if (sys) set('bp_systolic', sys, conf);
        if (dia) set('bp_diastolic', dia, conf);
      }
    }
  }

  return { updates, fieldConfidence };
}

export function clinicalSafetyDisclaimer() {
  return 'STT output is decision support only. Clinician must confirm all fields and acuity before closing triage.';
}

export function clampConfidence(value, fallback = 1) {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  if (n > 1) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

export function detectTranscriptLanguage(text) {
  const t = String(text || '');
  const hasArabic = /[\u0600-\u06FF]/.test(t);
  const hasLatin = /[A-Za-z]/.test(t);
  // Must match packages/clinical/src/stt/vocabulary.ts — callers switch on this value.
  if (hasArabic && hasLatin) return { detected_language: 'mixed_arabic_english' };
  if (hasArabic) return { detected_language: 'arabic' };
  if (hasLatin) return { detected_language: 'english' };
  return { detected_language: 'unknown' };
}

export function conservativeTranscriptCleanup(text = '') {
  let t = String(text || '').trim();
  if (!t) return '';
  t = t
    .replace(/\b(passion|pation|patience)\b/gi, 'patient')
    // 'case'/'just' are ordinary English words — mapping them to a red-flag complaint
    // fabricated chest pain out of correct input. Only keep genuine misrecognitions.
    .replace(/\b(chase|cheese|chaste|jest)\s+pain\b/gi, 'chest pain')
    .replace(/\bchest\s+patient\b/gi, 'chest pain')
    .replace(/\bheart\s+(raid|read)\b/gi, 'heart rate')
    .replace(/\brespiratory\s+(raid|read)\b/gi, 'respiratory rate')
    .replace(/\boxygen\s+(station|situation|section)\b/gi, 'oxygen saturation')
    .replace(/\bblood\s+(press|precious|pleasure)\b/gi, 'blood pressure')
    .replace(/\bsp\s?o\s?two\b/gi, 'SpO2')
    .replace(/\bo\s?two\b/gi, 'O2')
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

/** Turn timestamp for display. Shared so the log and the floating window agree. */
export function formatTurnTime(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function linesToTranscript(lines) {
  return lines.map((l) => (typeof l === 'string' ? l : l.text)).join(' ');
}

/** Always derive extraction/display transcript from live final lines + optional interim. */
export function getLiveTranscript(lines = [], interim = '') {
  const base = linesToTranscript(lines);
  const combined = interim ? `${base} ${interim}`.trim() : base.trim();
  return conservativeTranscriptCleanup(combined);
}

const FIELD_MENTION_PATTERNS = {
  weight: [/weight|وزن|الوزن|\b\d{1,3}(?:\.\d+)?\s*kg\b/i],
  age: [/age|عمر(?:ه|ها)?|years?\s*old|سنة/i],
  chief_complaint: [/complaint|شكوى|كومبلين|chest pain|ألم صدر|headache|حمى/i],
  pain_score: [/pain score|ben score|بين سكور|\/10|out of ten/i],
  hr: [/heart rate|hr|pulse|نبض|النبض/i],
  bp_systolic: [/blood pressure|\bbp\b|ضغط|على|\d{2,3}\s*\/\s*\d{2,3}/i],
  spo2: [/spo2|oxygen|أكسجين/i],
  rr: [/respiratory rate|\brr\b|تنفس|معدل التنفس/i],
  temperature: [/temp|temperature|حرارة/i],
  gcs: [/gcs|glasgow|وعي/i],
};

const SUGGESTED_PHRASES = {
  weight: { en: 'Weight seventy kilograms', ar: 'الوزن سبعون كيلوغرام' },
  age: { en: 'Age fifty five', ar: 'عمره خمسة وخمسين' },
  chief_complaint: { en: 'Chief complaint chest pain', ar: 'الشكوى ألم صدر' },
  pain_score: { en: 'Pain score seven out of ten', ar: 'درجة الألم سبعة من عشرة' },
  hr: { en: 'Heart rate one ten', ar: 'النبض مئة وعشرة' },
  bp_systolic: { en: 'BP one forty over ninety', ar: 'الضغط مئة وأربعين على تسعين' },
  spo2: { en: 'SpO2 ninety six', ar: 'الأكسجين ستة وتسعين' },
  rr: { en: 'Respiratory rate eighteen', ar: 'معدل التنفس ثمانية عشر' },
  temperature: { en: 'Temperature thirty seven', ar: 'الحرارة سبعة وثلاثين' },
  gcs: { en: 'GCS fifteen', ar: 'مستوى الوعي خمسة عشر' },
};

export function analyzeTranscriptCompleteness(transcript, patient = {}) {
  const formCompleteness = computeCtasCompleteness(patient);
  const t = conservativeTranscriptCleanup(transcript);
  const mentioned = new Set();
  for (const field of CTAS_REQUIRED_FIELDS) {
    if (FIELD_MENTION_PATTERNS[field.key]?.some((rx) => rx.test(t))) mentioned.add(field.key);
  }
  const missing = formCompleteness.missing;
  const mentionedNotExtracted = missing.filter((k) => mentioned.has(k));
  const suggestedPhrases = missing.map((key) => {
    const def = CTAS_REQUIRED_FIELDS.find((f) => f.key === key);
    const phrases = SUGGESTED_PHRASES[key] || { en: '', ar: '' };
    return { key, label_en: def?.label_en, label_ar: def?.label_ar, phrase_en: phrases.en, phrase_ar: phrases.ar };
  });
  const mentionedCaptured = CTAS_REQUIRED_FIELDS.filter((f) => mentioned.has(f.key) && f.check(patient)).length;
  return {
    formCompleteness,
    mentionCompleteness: { captured: mentionedCaptured, total: formCompleteness.total, mentioned: [...mentioned] },
    missing,
    mentionedNotExtracted,
    suggestedPhrases,
  };
}

/** Merge transcript lines — prefer OpenAI (source=openai), dedupe similar. */
export function mergeTranscriptLines(existingLines, newLine, { source = 'browser' } = {}) {
  const cleaned = conservativeTranscriptCleanup(newLine);
  if (!cleaned) return existingLines;
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const b = norm(cleaned);
  const textOf = (l) => norm(typeof l === 'string' ? l : l.text);

  // Exact repeat of any earlier line is a duplicate.
  if (existingLines.some((l) => textOf(l) === b)) return existingLines;

  // Substring containment is only meaningful against the LAST line, where a partial
  // grows into its final form. Scanning every prior line silently deleted legitimate
  // short utterances ("seven", "نعم") that happened to appear earlier in the dictation.
  const last = existingLines.length ? textOf(existingLines[existingLines.length - 1]) : '';
  if (last && last.includes(b)) return existingLines;

  const entry = { text: cleaned, source, at: Date.now() };
  // The new line supersedes the previous one when it is that line grown longer.
  if (last && b.includes(last)) {
    return [...existingLines.slice(0, -1), entry];
  }
  return [...existingLines, entry];
}
