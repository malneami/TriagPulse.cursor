import { mapClinicalCodes } from './coding';
import { matchComplaint } from '../ctas/ctasDatabase';
import { STT_FIELD_DEFINITIONS, STT_REQUIRED_KEYS } from './vocabulary';
import { conservativeTranscriptCleanup, detectTranscriptLanguage, segmentTranscriptByLanguage } from './vocabulary';
import type {
  SttFieldKey,
  SttFieldSlot,
  SttSessionOutput,
  VitalSignEntry,
} from './types';

const ARABIC_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

const ARABIC_NUMBERS: Record<string, number> = {
  'صفر': 0, 'واحد': 1, 'واحدة': 1, 'اثنين': 2, 'اثنان': 2, 'ثلاث': 3, 'ثلاثة': 3, 'أربع': 4, 'أربعة': 4,
  'خمس': 5, 'خمسة': 5, 'ست': 6, 'ستة': 6, 'سبع': 7, 'سبعة': 7, 'ثمان': 8, 'ثمانية': 8, 'تسع': 9, 'تسعة': 9,
  'عشر': 10, 'عشرة': 10, 'عشرين': 20, 'ثلاثين': 30, 'أربعين': 40, 'خمسين': 50, 'ستين': 60, 'سبعين': 70,
  'ثمانين': 80, 'تسعين': 90, 'مئة': 100, 'مائة': 100,
};

const ENGLISH_NUMBERS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100,
};

/** Word / Arabic-run / separator, so a rewrite can preserve everything in between. */
const NUMBER_TOKEN_RE = /[A-Za-z]+|[؀-ۿ]+|[^A-Za-z؀-ۿ]+/g;

function classifyNumberWord(word: string): { lang: 'en' | 'ar'; value: number } | null {
  const lower = word.toLowerCase();
  if (ENGLISH_NUMBERS[lower] != null) return { lang: 'en', value: ENGLISH_NUMBERS[lower] };
  if (ARABIC_NUMBERS[word] != null) return { lang: 'ar', value: ARABIC_NUMBERS[word] };
  // Arabic prefixes 'and' onto the following number: مئة وأربعين
  if (word.startsWith('و') && ARABIC_NUMBERS[word.slice(1)] != null) {
    return { lang: 'ar', value: ARABIC_NUMBERS[word.slice(1)] };
  }
  return null;
}

/** Arabic composes additively in any order: مئة وأربعين = 140, خمسة وخمسين = 55. */
function combineArabic(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function combineEnglish(values: number[]): number {
  if (values.length === 1) return values[0];
  const hundredIdx = values.indexOf(100);
  if (hundredIdx >= 0) {
    const multiplier = hundredIdx > 0 ? values[hundredIdx - 1] : 1;
    const rest = values.slice(hundredIdx + 1).reduce((a, b) => a + b, 0);
    return multiplier * 100 + rest;
  }
  // Colloquial vitals shorthand: "one forty" = 140, "one ten" = 110.
  if (values[0] === 1 && values[1] >= 10) {
    return 100 + values.slice(1).reduce((a, b) => a + b, 0);
  }
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Rewrite spoken number phrases as digits so every existing digit-based vitals
 * pattern works for dictation in either language — including across a switch
 * ("heart rate مئة وعشرة", "الضغط مئة وأربعين over ninety").
 */
export function normalizeSpokenNumbers(text: string): string {
  const tokens = String(text).match(NUMBER_TOKEN_RE);
  if (!tokens) return String(text);

  const isWord = (t: string) => /[A-Za-z؀-ۿ]/.test(t);
  const isRunGap = (t: string) => /^[\s-]+$/.test(t);

  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    const head = isWord(token) ? classifyNumberWord(token) : null;
    if (!head) {
      out.push(token);
      i += 1;
      continue;
    }

    // Greedily consume same-language number words separated only by spaces/hyphens.
    const values = [head.value];
    let j = i + 1;
    let consumedTo = i;
    while (j < tokens.length) {
      let k = j;
      while (k < tokens.length && !isWord(tokens[k])) {
        if (!isRunGap(tokens[k])) break;
        k += 1;
      }
      if (k >= tokens.length || !isWord(tokens[k])) break;
      const word = tokens[k];
      if (head.lang === 'en' && word.toLowerCase() === 'and') {
        j = k + 1;
        continue;
      }
      const next = classifyNumberWord(word);
      if (!next || next.lang !== head.lang) break;
      values.push(next.value);
      consumedTo = k;
      j = k + 1;
    }

    out.push(String(head.lang === 'ar' ? combineArabic(values) : combineEnglish(values)));
    i = consumedTo + 1;
  }

  return out.join('');
}

function normalizeDigits(text: string): string {
  return normalizeSpokenNumbers(String(text).replace(/[٠-٩]/g, (d) => ARABIC_DIGITS[d] ?? d));
}

function parseSpokenNumberWord(word: string): number | null {
  const map: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
    ...ARABIC_NUMBERS,
  };
  return map[String(word).toLowerCase()] ?? null;
}

function parseSpokenAge(text: string): { value: number; span: string; confidence: number } | null {
  const t = normalizeDigits(text);
  const digitMatch = t.match(/(?:age|عمر(?:ه|ها)?|سنة)\s*(?:is|around|about|حوالي)?\s*(\d{1,3})/i)
    || t.match(/(?:^|[,\s])(\d{1,3})\s*(?:years?\s*old|year\s*old|y\/o|yo|سنة)\b/i);
  if (digitMatch) return { value: Number(digitMatch[1]), span: digitMatch[0], confidence: 0.92 };

  const mixedAge = t.match(/(?:age|عمر(?:ه|ها)?)\s+([a-z\u0600-\u06FF]+)/i)
    || t.match(/(?:,\s*|\s)عمر(?:ه|ها)?\s+(\d{1,3}|\w+)/i);
  if (mixedAge) {
    const raw = mixedAge[1].trim();
    const val = parseSpokenNumberWord(raw) ?? (Number.isFinite(Number(raw)) ? Number(raw) : null);
    if (val != null && val > 0 && val <= 130) return { value: val, span: mixedAge[0], confidence: 0.87 };
  }

  const arWord = t.match(/(?:عمر(?:ه|ها)?)\s+([\u0600-\u06FF\s]+?)(?:\s+سنة|$)/i);
  if (arWord) {
    const words = arWord[1].trim().split(/\s+/);
    let total = 0;
    for (const w of words) {
      const n = parseSpokenNumberWord(w);
      if (n != null) total += n;
    }
    if (total > 0 && total <= 130) return { value: total, span: arWord[0], confidence: 0.88 };
  }

  const wordAge = t.match(/\b(fifty|sixty|seventy|eighty|ninety|forty|thirty|twenty|\d{1,3})\s*(?:years?\s*old|year\s*old|y\/o|yo)\b/i);
  if (wordAge) {
    const val = parseSpokenNumberWord(wordAge[1]) ?? Number(wordAge[1]);
    if (val > 0 && val <= 130) return { value: val, span: wordAge[0], confidence: 0.9 };
  }
  return null;
}

function parseSex(text: string): { value: 'M' | 'F'; span: string; confidence: number } | null {
  if (/(\bmale\b|\bman\b|\bboy\b|ذكر)/i.test(text)) {
    const span = text.match(/(\bmale\b|\bman\b|\bboy\b|ذكر)/i)?.[0] || 'male';
    return { value: 'M', span, confidence: 0.95 };
  }
  if (/(\bfemale\b|\bwoman\b|\bgirl\b|أنثى|انثى)/i.test(text)) {
    const span = text.match(/(\bfemale\b|\bwoman\b|\bgirl\b|أنثى|انثى)/i)?.[0] || 'female';
    return { value: 'F', span, confidence: 0.95 };
  }
  return null;
}

function parsePainScore(text: string): { value: number; span: string; confidence: number } | null {
  const t = normalizeDigits(text);
  const digitMatch = t.match(/(?:pain(?:\s+score|\s+is|\s+at)?|ألم|درجة(?:\s+الألم)?)\s*(?:is|at|of|[:=])?\s*(\d{1,2})(?:\s*(?:out of|\/)\s*10)?/i)
    || t.match(/\bpain\s*(\d{1,2})\s*(?:\/\s*10|out of ten)\b/i)
    || t.match(/(?:pain score|ben score|between score|بين سكور)\s*(\d{1,2})/i)
    || t.match(/(\d{1,2})\s*(?:out of ten|\/10|من\s*10)/i);
  if (digitMatch) {
    const val = Number(digitMatch[1]);
    if (val >= 0 && val <= 10) return { value: val, span: digitMatch[0], confidence: 0.9 };
  }
  const wordMatch = t.match(/(?:pain(?:\s+score|\s+is|\s+at)?|درجة(?:\s+الألم)?)\s*(?:is|at|of)?\s*([a-z]+)\s*(?:out of ten|\/10|من\s*10)/i);
  if (wordMatch) {
    const val = parseSpokenNumberWord(wordMatch[1]);
    if (val != null && val >= 0 && val <= 10) return { value: val, span: wordMatch[0], confidence: 0.86 };
  }
  return null;
}

function parseAllergies(text: string): { value: string; span: string; confidence: number } | null {
  if (/\b(no known allergies|n\.?k\.?d\.?a\.?|no allergies)\b/i.test(text)
    || /لا\s*حساسية|بدون\s*حساسية/i.test(text)) {
    const span = text.match(/\b(no known allergies|n\.?k\.?d\.?a\.?|no allergies)\b|لا\s*حساسية|بدون\s*حساسية/i)?.[0] || 'NKDA';
    return { value: 'NKDA', span, confidence: 0.93 };
  }
  const m = text.match(/(?:allerg(?:y|ies)|حساسية(?:\s*من)?)\s*(?:to\s*|من\s*)?([^.،;\n]+)/i);
  if (m) return { value: m[1].trim(), span: m[0], confidence: 0.82 };
  return null;
}

function parseOnset(text: string): { value: string; span: string; confidence: number } | null {
  const m = text.match(/(?:for|since|منذ|من)\s+([\w\u0600-\u06FF\s\d]+?(?:hours?|hour|minutes?|minute|days?|day|morning|evening|صباح|مساء|ساعة|ساعات|دقيقة|أيام))/i)
    || text.match(/(\d+\s*(?:hours?|minutes?|days?|ساعة|ساعات|دقيقة|أيام))/i);
  if (m) return { value: m[1].trim(), span: m[0], confidence: 0.85 };
  return null;
}

/**
 * Clauses asserting absence or normality. A triage dictation is full of them
 * ("pulse is good", "denies chest pain"), and the fuzzy complaint matcher will
 * happily turn the clinical noun inside one into the chief complaint.
 */
const NEGATED_CLAUSE = new RegExp(
  [
    '\\b(?:no|not|nil|denies|denied|without|negative\\s+for|free\\s+of)\\b',
    '\\b(?:is|are|was|were|looks?|seems?)\\s+(?:good|normal|fine|okay|ok|stable|unremarkable|wnl)\\b',
    'لا\\s*يوجد',
    'لا\\s*يشكو',
    '\\bبدون\\b',
    '\\bليس\\b',
    'طبيعي(?:ة)?',
    '\\bسليم(?:ة)?\\b',
    '\\bكويس(?:ة)?\\b',
    '\\bتمام\\b',
  ].join('|'),
  'i',
);

/**
 * Drop clauses that assert normality/absence before looking for a complaint.
 * Missing a complaint shows the nurse a red chip; inventing one silently routes
 * the patient down the wrong CTAS pathway.
 */
function positiveClauses(text: string): string {
  // Comma-delimited too: a single dictated sentence routinely ends with an
  // unrelated negation ("…, SpO2 96 percent, no known allergies"), which would
  // otherwise discard the complaint sitting earlier in the same sentence.
  return String(text)
    .split(/[.!?,،؛;\n]+/)
    .filter((clause) => clause.trim() && !NEGATED_CLAUSE.test(clause))
    .join('. ')
    .trim();
}

function parseChiefComplaint(rawText: string): { value: string; span: string; confidence: number } | null {
  const text = positiveClauses(rawText);
  if (!text) return null;
  const patterns = [
    /(?:chief complaint|complaint|complain(?:s|ing)?(?:\s+(?:about|of|from))?|presenting with|presents with|c\/o|came with|شكوى|الشكوى(?: الرئيسية)?|كومبلين|يشكو(?: من)?|يشتكي(?: من)?|يعاني من)\s*(?:is|of|:)?\s*([^.،;\n]+)/i,
    /(?:,\s*|\s)(chest pain|abdominal pain|headache|dyspnea|shortness of breath|fever|syncope|bleeding|back pain|nausea|vomiting|diarrhea|cough)(?:\s|,|$)/i,
    /(?:,\s*|\s)(ألم صدر|ألم بطن|صداع|ضيق تنفس|حمى|غثيان|قيء|إسهال|سعال)(?:\s|,|$)/i,
    /\b(chest pain|abdominal pain|headache|dyspnea|shortness of breath|fever|syncope|bleeding)\b/i,
    /(ألم صدر|ألم بطن|صداع|ضيق تنفس|حمى)/i,
  ];
  for (const rx of patterns) {
    const m = text.match(rx);
    if (m) {
      let value = (m[1] || m[0]).trim();
      value = value.split(/\bfor\b|\bsince\b|\bمنذ\b|\bمن\b/i)[0].trim();
      return { value, span: m[0], confidence: 0.86 };
    }
  }
  const fuzzy = matchComplaint(text);
  if (fuzzy?.complaint) {
    const label = fuzzy.complaint.label_en || fuzzy.complaint.label_ar || text.slice(0, 40);
    return { value: label, span: text.slice(0, 80), confidence: 0.78 };
  }
  return null;
}

function parseName(text: string): { value: string; span: string; confidence: number } | null {
  const m = text.match(/(?:patient(?:\s+name)?|name is|اسم(?: المريض)?(?: هو)?)\s*,?\s*([A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF\s'-]{1,60})/i);
  if (m) {
    let value = m[1].trim().replace(/^is\s+/i, '');
    value = value.split(/,|\s+(?:\d|fifty|sixty|seventy|eighty|male|female|ذكر|أنثى|age|عمر)/i)[0].trim();
    return { value, span: m[0], confidence: 0.84 };
  }
  const short = text.match(/\bpatient\s+([A-Za-z][A-Za-z\s'-]{1,40})(?:\s*,|\s+عمر|\s+age|\s+\d)/i);
  if (short) return { value: short[1].trim(), span: short[0], confidence: 0.8 };
  const inline = text.match(/^patient\s+([A-Za-z\u0600-\u06FF'-]{2,40})\s*,/i);
  if (inline) return { value: inline[1].trim(), span: inline[0], confidence: 0.82 };
  return null;
}

function parseMedications(text: string): { value: string[]; span: string; confidence: number } | null {
  const meds: string[] = [];
  const rxList = text.match(/(?:takes|on|medications?|meds|يتناول|أدوية)\s*([^.،;\n]+)/gi) || [];
  for (const chunk of rxList) {
    const inner = chunk.replace(/^(?:takes|on|medications?|meds|يتناول|أدوية)\s*/i, '');
    inner.split(/,|،|and|و/).map((s) => s.trim()).filter(Boolean).forEach((m) => meds.push(m));
  }
  if (meds.length) return { value: meds, span: rxList.join('; '), confidence: 0.8 };
  return null;
}

function parseHistory(text: string): { value: string; span: string; confidence: number } | null {
  const m = text.match(/(?:history of|past history|known case of|تاريخ(?: مرضي)?|يعاني من)\s*([^.،;\n]+)/i);
  if (m) return { value: m[1].trim(), span: m[0], confidence: 0.78 };
  return null;
}

/**
 * Bilingual label synonyms, one alternation per vital.
 *
 * Longest-first within each group so 'heart rate' is not shadowed by 'heart beat',
 * and every entry still requires an adjacent number — a label alone never yields a
 * value ("pulse is good" must stay empty rather than borrow a nearby figure).
 */
const HR_LABEL = [
  'heart\\s?rate', 'heart\\s?beats?', 'heartbeats?', 'beats per minute', 'bpm', 'pulse rate', 'pulse', 'hr',
  'معدل ضربات القلب', 'ضربات القلب', 'نبضات القلب', 'دقات القلب', 'معدل النبض', 'النبض', 'نبض',
].join('|');

const RR_LABEL = [
  'respiratory rate', 'respiration rate', 'resp\\s?rate', 'breathing rate', 'breaths per minute', 'breath rate', 'rr',
  'معدل التنفس', 'معدل تنفس', 'التنفس', 'تنفس',
].join('|');

const TEMP_LABEL = [
  'temperature', 'temp',
  'درجة الحرارة', 'الحرارة', 'حرارة', 'سخونة',
].join('|');

const GCS_LABEL = [
  'glasgow coma scale', 'glasgow', 'level of consciousness', 'conscious(?:ness)? level', 'gcs',
  'مستوى الوعي', 'درجة الوعي', 'غلاسكو', 'الوعي', 'وعي',
].join('|');

function parseVitals(text: string): { value: VitalSignEntry[]; span: string; confidence: number } | null {
  const t = normalizeDigits(text);
  const vitals: VitalSignEntry[] = [];
  const spans: string[] = [];
  const seen = new Set<string>();

  const add = (type: VitalSignEntry['type'], value: VitalSignEntry['value'], unit: string, span: string) => {
    if (seen.has(type)) return;
    seen.add(type);
    vitals.push({ type, value, unit });
    spans.push(span);
  };

  const hr = t.match(new RegExp(`(?:${HR_LABEL})[^\\d]{0,12}(\\d{2,3})`, 'i'))
    || t.match(new RegExp(`(\\d{2,3})\\s*(?:bpm)?\\s*(?:${HR_LABEL})`, 'i'));
  if (hr) add('HR', Number(hr[1]), 'bpm', hr[0]);

  const bp = t.match(/(?:bp|blood pressure|ضغط|الضغط)[^\d]{0,12}(\d{2,3})\s*(?:[\/\\]|over|على|on)\s*(\d{2,3})/i)
    || t.match(/(\d{2,3})\s*(?:[\/\\]|over|على|on)\s*(\d{2,3})\s*(?:mmhg|mm hg|ضغط|bp)?/i);
  if (bp) add('BP', `${bp[1]}/${bp[2]}`, 'mmHg', bp[0]);

  const spo2 = t.match(/(?:spo2|sp o2|sp\s*o2|oxygen saturation|sat|أكسجين|الأكسجين|o2)[^\d]{0,8}(\d{2,3})\s*%?/i)
    || t.match(/(\d{2,3})\s*%\s*(?:spo2|sat|oxygen|أكسجين)?/i);
  if (spo2) add('SpO2', Number(spo2[1]), '%', spo2[0]);

  const rr = t.match(new RegExp(`(?:${RR_LABEL})[^\\d]{0,8}(\\d{1,2})`, 'i'))
    || t.match(/\brr\s*(\d{1,2})\b/i);
  if (rr) add('RR', Number(rr[1]), '/min', rr[0]);

  const temp = t.match(new RegExp(`(?:${TEMP_LABEL})[^\\d]{0,8}(\\d{2}(?:\\.\\d)?)\\s*(?:c|celsius|°)?`, 'i'))
    || t.match(/\btemp\s*(\d{2}(?:\.\d)?)\b/i);
  if (temp) add('Temp', Number(temp[1]), '°C', temp[0]);

  const gcs = t.match(new RegExp(`(?:${GCS_LABEL})[^\\d]{0,8}(\\d{1,2})`, 'i'))
    || t.match(/\bgcs\s*(\d{1,2})\b/i);
  if (gcs) add('GCS', Number(gcs[1]), '/15', gcs[0]);

  if (vitals.length === 0) return null;
  return { value: vitals, span: spans.join('; '), confidence: 0.88 };
}

function parseAcuity(text: string): { value: string; span: string; confidence: number } | null {
  const m = text.match(/\b(?:ctas|esi|acuity|triage level|مستوى(?: الفرز)?)\s*(?:level|is|[:=])?\s*([1-5])\b/i);
  if (m) return { value: `CTAS ${m[1]}`, span: m[0], confidence: 0.7 };
  return null;
}

function emptySlot<T = unknown>(): SttFieldSlot<T> {
  return { value: null, confidence: 0, source_span: '', edited_by_user: false };
}

function isFilled(slot: SttFieldSlot): boolean {
  if (slot.edited_by_user && slot.value != null && slot.value !== '') return true;
  if (slot.value == null || slot.value === '') return false;
  if (Array.isArray(slot.value)) return slot.value.length > 0;
  return true;
}

/** Overwrite only when new confidence is higher, or field empty, or user-edited preserved. */
export function mergeFieldSlot<T>(
  current: SttFieldSlot<T>,
  incoming: { value: T; confidence: number; source_span: string },
): SttFieldSlot<T> {
  if (current.edited_by_user) return current;
  if (!isFilled(current)) {
    return { value: incoming.value, confidence: incoming.confidence, source_span: incoming.source_span, edited_by_user: false };
  }
  if (incoming.confidence > current.confidence) {
    return { value: incoming.value, confidence: incoming.confidence, source_span: incoming.source_span, edited_by_user: false };
  }
  return current;
}

export function createEmptySttFields(): Record<SttFieldKey, SttFieldSlot> {
  return {
    name: emptySlot<string>(),
    age: emptySlot<number>(),
    sex: emptySlot<'M' | 'F'>(),
    chief_complaint: emptySlot<string>(),
    onset_duration: emptySlot<string>(),
    vital_signs: emptySlot<VitalSignEntry[]>(),
    pain_score: emptySlot<number>(),
    allergies: emptySlot<string>(),
    current_medications: emptySlot<string[]>(),
    relevant_history: emptySlot<string>(),
    acuity_proposed: emptySlot<string>(),
  };
}

export function extractFieldsFromTranscript(
  transcript: string,
  existingFields: Record<SttFieldKey, SttFieldSlot> = createEmptySttFields(),
): Record<SttFieldKey, SttFieldSlot> {
  const text = conservativeTranscriptCleanup(transcript);
  let fields = { ...existingFields };

  const runExtract = (chunk: string) => {
    const local = { ...createEmptySttFields() };
    const apply = <T>(key: SttFieldKey, hit: { value: T; span: string; confidence: number } | null) => {
      if (!hit) return;
      local[key] = mergeFieldSlot(local[key] as SttFieldSlot<T>, {
        value: hit.value,
        confidence: hit.confidence,
        source_span: hit.span,
      }) as SttFieldSlot;
    };
    apply('name', parseName(chunk));
    apply('age', parseSpokenAge(chunk));
    apply('sex', parseSex(chunk));
    apply('chief_complaint', parseChiefComplaint(chunk));
    apply('onset_duration', parseOnset(chunk));
    apply('pain_score', parsePainScore(chunk));
    apply('allergies', parseAllergies(chunk));
    apply('relevant_history', parseHistory(chunk));
    apply('acuity_proposed', parseAcuity(chunk));
    const vitals = parseVitals(chunk);
    if (vitals) apply('vital_signs', vitals);
    const meds = parseMedications(chunk);
    if (meds) {
      local.current_medications = mergeFieldSlot(local.current_medications, {
        value: meds.value,
        confidence: meds.confidence,
        source_span: meds.span,
      });
    }
    return local;
  };

  const full = runExtract(text);
  for (const key of Object.keys(full) as SttFieldKey[]) {
    const slot = full[key];
    if (isFilled(slot)) {
      fields[key] = mergeFieldSlot(fields[key], {
        value: slot.value,
        confidence: slot.confidence,
        source_span: slot.source_span,
      }) as SttFieldSlot;
    }
  }

  for (const seg of segmentTranscriptByLanguage(text)) {
    const segFields = runExtract(seg.text);
    for (const key of Object.keys(segFields) as SttFieldKey[]) {
      const slot = segFields[key];
      if (isFilled(slot)) {
        fields[key] = mergeFieldSlot(fields[key], {
          value: slot.value,
          confidence: slot.confidence,
          source_span: slot.source_span,
        }) as SttFieldSlot;
      }
    }
  }

  return fields;
}

export function computeCompleteness(fields: Record<SttFieldKey, SttFieldSlot>) {
  const missing = STT_REQUIRED_KEYS.filter((key) => !isFilled(fields[key]));
  const captured = STT_FIELD_DEFINITIONS.filter((f) => isFilled(fields[f.key])).length;
  return { captured, total: STT_FIELD_DEFINITIONS.length, missing };
}

export function buildSttSessionOutput(
  sessionId: string,
  transcript: string,
  fields: Record<SttFieldKey, SttFieldSlot>,
  modelVersion = 'triagepulse-stt-extract-v1',
  extras: Partial<Pick<import('./types').SttSessionOutput, 'extraction_method' | 'llm_used' | 'transcript_analysis'>> = {},
): SttSessionOutput {
  const cleaned = conservativeTranscriptCleanup(transcript);
  const languageProfile = detectTranscriptLanguage(cleaned);
  const segments = segmentTranscriptByLanguage(cleaned);
  const chief = fields.chief_complaint.value as string | null;
  const coded = mapClinicalCodes(cleaned, chief);
  const low_confidence_spans = Object.values(fields)
    .filter((f) => isFilled(f) && f.confidence > 0 && f.confidence < 0.75)
    .map((f) => ({ text: f.source_span, confidence: f.confidence }));

  return {
    session_id: sessionId,
    language_segments: segments,
    full_transcript: cleaned,
    fields,
    completeness: computeCompleteness(fields),
    coded,
    low_confidence_spans,
    model_version: modelVersion,
    timestamp: new Date().toISOString(),
    ...extras,
  };
}

/** Map STT session fields to TriagePulse patient object keys with per-key confidence. */
export function mapSttFieldsToPatient(fields: Record<SttFieldKey, SttFieldSlot>): Record<string, unknown> {
  const { updates } = mapSttSessionToPatientUpdates(fields);
  return updates;
}

export function mapSttSessionToPatientUpdates(fields: Record<SttFieldKey, SttFieldSlot>): {
  updates: Record<string, unknown>;
  fieldConfidence: Record<string, number>;
} {
  const updates: Record<string, unknown> = {};
  const fieldConfidence: Record<string, number> = {};

  const set = (key: string, value: unknown, confidence: number) => {
    if (value == null || value === '') return;
    updates[key] = value;
    fieldConfidence[key] = confidence;
  };

  const name = fields.name.value as string | null;
  if (name) {
    if (/[\u0600-\u06FF]/.test(name)) set('patient_name_ar', name, fields.name.confidence);
    else set('patient_name_en', name, fields.name.confidence);
  }
  if (fields.age.value != null) set('age', String(fields.age.value), fields.age.confidence);
  if (fields.sex.value === 'M') set('gender', 'male', fields.sex.confidence);
  if (fields.sex.value === 'F') set('gender', 'female', fields.sex.confidence);
  if (fields.chief_complaint.value) set('chief_complaint', fields.chief_complaint.value, fields.chief_complaint.confidence);
  if (fields.pain_score.value != null) set('pain_score', fields.pain_score.value, fields.pain_score.confidence);

  const vitals = fields.vital_signs.value as VitalSignEntry[] | null;
  if (Array.isArray(vitals)) {
    for (const v of vitals) {
      const conf = fields.vital_signs.confidence;
      if (v.type === 'HR') set('hr', String(v.value), conf);
      if (v.type === 'SpO2') set('spo2', String(v.value), conf);
      if (v.type === 'RR') set('rr', String(v.value), conf);
      if (v.type === 'Temp') set('temperature', String(v.value), conf);
      if (v.type === 'GCS') set('gcs', String(v.value), conf);
      if (v.type === 'BP' && typeof v.value === 'string') {
        const [sys, dia] = v.value.split('/');
        if (sys) set('bp_systolic', sys, conf);
        if (dia) set('bp_diastolic', dia, conf);
      }
    }
  }

  return { updates, fieldConfidence };
}

export function clinicalSafetyDisclaimer(): string {
  return 'STT output is decision support only. Clinician must confirm all fields and acuity before closing triage.';
}

export function clampConfidence(value: unknown, fallback = 0.65): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n > 1) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

export function mergeLlmExtractIntoFields(
  fields: Record<SttFieldKey, SttFieldSlot>,
  llm: import('./llmExtractSchema').LlmCtasExtractResult,
): Record<SttFieldKey, SttFieldSlot> {
  const out = { ...fields };
  const cap = (n: number) => Math.min(0.85, Math.max(0, n || 0.75));
  const conf = llm.field_confidence || {};

  if (llm.patient_name_ar) {
    out.name = mergeFieldSlot(out.name, { value: llm.patient_name_ar, confidence: cap(conf.patient_name_ar ?? 0.8), source_span: 'llm' });
  }
  if (llm.patient_name_en) {
    out.name = mergeFieldSlot(out.name, { value: llm.patient_name_en, confidence: cap(conf.patient_name_en ?? 0.8), source_span: 'llm' });
  }
  if (llm.age) {
    const ageNum = Number(String(llm.age).replace(/[^\d.]/g, ''));
    if (ageNum > 0 && ageNum <= 130) {
      out.age = mergeFieldSlot(out.age, { value: ageNum, confidence: cap(conf.age ?? 0.8), source_span: 'llm' });
    }
  }
  if (llm.chief_complaint) {
    out.chief_complaint = mergeFieldSlot(out.chief_complaint, { value: llm.chief_complaint, confidence: cap(conf.chief_complaint ?? 0.8), source_span: 'llm' });
  }
  if (llm.pain_score != null && llm.pain_score >= 0 && llm.pain_score <= 10) {
    out.pain_score = mergeFieldSlot(out.pain_score, { value: llm.pain_score, confidence: cap(conf.pain_score ?? 0.8), source_span: 'llm' });
  }

  const vitals: VitalSignEntry[] = [];
  const vConf = cap(conf.hr ?? conf.bp_systolic ?? 0.8);
  if (llm.hr) vitals.push({ type: 'HR', value: llm.hr, unit: 'bpm' });
  if (llm.spo2) vitals.push({ type: 'SpO2', value: llm.spo2, unit: '%' });
  if (llm.rr) vitals.push({ type: 'RR', value: llm.rr, unit: '/min' });
  if (llm.temperature) vitals.push({ type: 'Temp', value: llm.temperature, unit: '°C' });
  if (llm.gcs) vitals.push({ type: 'GCS', value: llm.gcs, unit: '/15' });
  if (llm.bp_systolic) {
    vitals.push({ type: 'BP', value: `${llm.bp_systolic}/${llm.bp_diastolic || ''}`, unit: 'mmHg' });
  }
  if (vitals.length) {
    out.vital_signs = mergeFieldSlot(out.vital_signs, { value: vitals, confidence: vConf, source_span: 'llm' });
  }
  return out;
}
