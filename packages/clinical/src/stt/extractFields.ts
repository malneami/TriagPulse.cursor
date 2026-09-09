import { mapClinicalCodes } from './coding';
import { matchComplaint } from '../ctas/resolveChiefComplaint';
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
  'اربع': 4, 'اربعة': 4,
  'خمس': 5, 'خمسة': 5, 'ست': 6, 'ستة': 6, 'سبع': 7, 'سبعة': 7, 'ثمان': 8, 'ثمانية': 8, 'تسع': 9, 'تسعة': 9,
  'عشر': 10, 'عشرة': 10, 'عشرين': 20, 'ثلاثين': 30, 'أربعين': 40, 'اربعين': 40, 'خمسين': 50, 'ستين': 60, 'سبعين': 70,
  'ثمانين': 80, 'تسعين': 90, 'مئة': 100, 'مائة': 100, 'ميه': 100, 'مية': 100,
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

/** ASR often drops / swaps Arabic hamza forms (أ/إ/آ → ا). */
function normalizeArabicAlef(word: string): string {
  return String(word).replace(/[أإآ]/g, 'ا');
}

function lookupArabicNumber(word: string): number | null {
  if (ARABIC_NUMBERS[word] != null) return ARABIC_NUMBERS[word];
  const folded = normalizeArabicAlef(word);
  if (ARABIC_NUMBERS[folded] != null) return ARABIC_NUMBERS[folded];
  // Prefer folded keys that were stored with hamza
  for (const [k, v] of Object.entries(ARABIC_NUMBERS)) {
    if (normalizeArabicAlef(k) === folded) return v;
  }
  return null;
}

function classifyNumberWord(word: string): { lang: 'en' | 'ar'; value: number } | null {
  const lower = word.toLowerCase();
  if (ENGLISH_NUMBERS[lower] != null) return { lang: 'en', value: ENGLISH_NUMBERS[lower] };
  const ar = lookupArabicNumber(word);
  if (ar != null) return { lang: 'ar', value: ar };
  // Arabic prefixes 'and' onto the following number: مئة وأربعين / واربعين
  if (word.startsWith('و')) {
    const rest = lookupArabicNumber(word.slice(1));
    if (rest != null) return { lang: 'ar', value: rest };
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
  const lower = String(word).toLowerCase();
  if (ENGLISH_NUMBERS[lower] != null) return ENGLISH_NUMBERS[lower];
  return lookupArabicNumber(word);
}

function clampAge(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (n <= 0 || n > 130) return null;
  return Math.round(n * 1000) / 1000;
}

/** Convert infant ages (months/weeks/days) to fractional years for getAgeGroup. */
function parseAgeInSmallUnits(text: string): { value: number; span: string; confidence: number } | null {
  const t = normalizeDigits(text);
  const cue = '(?:\\bage\\b|العمر|عمر(?:ه|ها|ي)?)';
  const fillers = '(?:المريض|patient|is|around|about|حوالي|تقريباً?|نحو)?';

  // Arabic dual: شهرين / يومين / أسبوعين (= 2)
  const dual = t.match(
    new RegExp(`${cue}\\s*${fillers}\\s*(شهرين|شهران|يومين|يومان|أسبوعين|أسبوعان)`, 'i'),
  );
  if (dual) {
    const unit = dual[1];
    let years = 2 / 12;
    if (/يوم/.test(unit)) years = 2 / 365;
    else if (/أسبوع/.test(unit)) years = 2 / 52;
    const val = clampAge(years);
    if (val != null) return { value: val, span: dual[0], confidence: 0.93 };
  }

  // N + months/weeks/days (digits or spoken words)
  const unitMatch = t.match(
    new RegExp(
      `${cue}\\s*${fillers}\\s*(\\d{1,3}|[a-z\\u0600-\\u06FF]+(?:\\s+(?:and|و)?\\s*[a-z\\u0600-\\u06FF]+)?)\\s*`
      + `(months?|month|أشهر|شهور|شهر|weeks?|week|أسابيع|أسبوع|days?|day|أيام|يوم)`,
      'i',
    ),
  )
    || t.match(
      /(\d{1,3})\s*(months?\s*old|weeks?\s*old|days?\s*old|أشهر|شهور|أسابيع|أيام)/i,
    );
  if (unitMatch) {
    const raw = unitMatch[1].trim();
    let amount = Number(raw);
    if (!Number.isFinite(amount)) {
      const parts = raw.split(/\s+/).filter((w) => !/^(and|و)$/i.test(w));
      amount = 0;
      for (const w of parts) {
        const n = parseSpokenNumberWord(w);
        if (n != null) amount += n;
      }
    }
    // "شهر واحد" style already handled via word+شهر; bare "شهر" after cue = 1 month
    if (!amount && /^(شهر|month)$/i.test(raw)) amount = 1;
    const unit = unitMatch[2].toLowerCase();
    let years = amount / 12;
    if (/week|أسبوع/.test(unit)) years = amount / 52;
    else if (/day|يوم|أيام/.test(unit)) years = amount / 365;
    else if (/month|شهر|أشهر|شهور/.test(unit)) years = amount / 12;
    const val = clampAge(years);
    if (val != null && amount > 0) return { value: val, span: unitMatch[0], confidence: 0.93 };
  }

  // Bare dual / "شهر واحد" with age cue: عمره شهر، age one month
  const oneMonth = t.match(
    new RegExp(`${cue}\\s*${fillers}\\s*(?:one\\s+month|شهر(?:\\s*واحد)?|واحد\\s*شهر)`, 'i'),
  );
  if (oneMonth) {
    const val = clampAge(1 / 12);
    if (val != null) return { value: val, span: oneMonth[0], confidence: 0.92 };
  }

  return null;
}

function yearUnitFollows(text: string, matchIndex: number, matchLen: number): boolean {
  const after = text.slice(matchIndex + matchLen, matchIndex + matchLen + 20);
  return /^\s*(months?|month|أشهر|شهور|شهر|weeks?|week|أسابيع|أسبوع|days?|day|أيام|يوم)\b/i.test(after);
}

function parseSpokenAge(text: string): { value: number; span: string; confidence: number } | null {
  const t = normalizeDigits(text);

  // Infants first — "عمره شهرين", "age 2 months" (must beat bare "عمر 2")
  const unitAge = parseAgeInSmallUnits(t);
  if (unitAge) return unitAge;

  // Cue + optional fillers + digits (years), reject if month/week/day unit follows
  const digitRe = /(?:\bage\b|العمر|عمر(?:ه|ها|ي)?)\s*(?:المريض|patient|is|around|about|approx(?:imately)?|حوالي|تقريباً?|نحو)?\s*(?:is|around|about|حوالي|تقريباً?)?\s*(\d{1,3})/gi;
  let digitMatch: RegExpExecArray | null;
  while ((digitMatch = digitRe.exec(t)) != null) {
    if (yearUnitFollows(t, digitMatch.index, digitMatch[0].length)) continue;
    const val = clampAge(Number(digitMatch[1]));
    if (val != null) return { value: val, span: digitMatch[0], confidence: 0.92 };
  }

  const yearsOld = t.match(/(?:^|[,\s])(\d{1,3})\s*(?:years?\s*old|year\s*old|years?\s+of\s+age|y\/o|yo|سن[ةها])/i)
    || t.match(/(?:حوالي|تقريباً?|نحو)\s*(\d{1,3})\s*سن[ةها]?/i)
    || t.match(/سن[ةها]\s*(\d{1,3})/i);
  if (yearsOld) {
    const val = clampAge(Number(yearsOld[1]));
    if (val != null) return { value: val, span: yearsOld[0], confidence: 0.92 };
  }

  // how old … fifty five / how old is he, 55
  const howOld = t.match(/how\s+old[^.\n,]{0,40}?(?:,|\bis\b)?\s*(\d{1,3})\b/i);
  if (howOld) {
    const val = clampAge(Number(howOld[1]));
    if (val != null) return { value: val, span: howOld[0], confidence: 0.86 };
  }

  // Cue + spoken number words (years): عمره اربعين / age fifty five — not followed by أشهر
  const mixedAge = t.match(
    /(?:\bage\b|العمر|عمر(?:ه|ها|ي)?)\s*(?:المريض|patient|is|around|about|حوالي|تقريباً?)?\s*([a-z\u0600-\u06FF]+(?:\s+(?:and|و)?\s*[a-z\u0600-\u06FF]+)?)/i,
  );
  if (mixedAge) {
    const after = t.slice(mixedAge.index! + mixedAge[0].length, mixedAge.index! + mixedAge[0].length + 12);
    if (!/^\s*(months?|أشهر|شهور|شهر|weeks?|days?|أسابيع|أيام)/i.test(after)
      && !/شهرين|شهران|يومين|أسبوعين/i.test(mixedAge[1])) {
      const raw = mixedAge[1].trim();
      const parts = raw.split(/\s+/).filter((w) => !/^(and|و)$/i.test(w));
      let total = 0;
      let parsedAny = false;
      for (const w of parts) {
        const n = parseSpokenNumberWord(w);
        if (n != null) {
          total += n;
          parsedAny = true;
        }
      }
      const val = parsedAny ? clampAge(total) : clampAge(Number(raw));
      if (val != null) return { value: val, span: mixedAge[0], confidence: 0.87 };
    }
  }

  const arWord = t.match(/(?:العمر|عمر(?:ه|ها|ي)?)\s+([\u0600-\u06FF\s]+?)(?:\s+سن[ةها]|$)/i);
  if (arWord && !/شهر|يوم|أسبوع|أشهر|أيام/.test(arWord[1])) {
    const words = arWord[1].trim().split(/\s+/).filter((w) => !/^و$/.test(w));
    let total = 0;
    for (const w of words) {
      const n = parseSpokenNumberWord(w);
      if (n != null) total += n;
    }
    const val = clampAge(total);
    if (val != null) return { value: val, span: arWord[0], confidence: 0.88 };
  }

  const wordAge = t.match(
    /\b(fifty|sixty|seventy|eighty|ninety|forty|fourty|thirty|twenty|\d{1,3})(?:\s+(?:one|two|three|four|five|six|seven|eight|nine))?\s*(?:years?\s*old|year\s*old|years?\s+of\s+age|y\/o|yo)\b/i,
  );
  if (wordAge) {
    const head = parseSpokenNumberWord(wordAge[1]) ?? Number(wordAge[1]);
    const restMatch = wordAge[0].match(/\b(one|two|three|four|five|six|seven|eight|nine)\b/i);
    const rest = restMatch ? (parseSpokenNumberWord(restMatch[1]) || 0) : 0;
    const val = clampAge(Number(head) + Number(rest));
    if (val != null) return { value: val, span: wordAge[0], confidence: 0.9 };
  }
  return null;
}

function transcriptMentionsPain(text: string): boolean {
  return /(?:\bpain\b|ألم|الألم|درجة\s*الألم|pain\s*score|\/\s*10|من\s*10|out of ten)/i.test(text);
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
  'heart\\s?rate', 'heart\\s?beats?', 'heartbeats?', 'beats per minute', 'bpm', 'pulse rate', 'pulse',
  '\\bh\\s?r\\b',
  'معدل ضربات القلب', 'ضربات القلب', 'نبضات القلب', 'دقات القلب', 'معدل النبض', 'النبض', 'نبض',
].join('|');

const RR_LABEL = [
  'respiratory rate', 'respiration rate', 'resp\\s?rate', 'breathing rate', 'breaths per minute', 'breath rate',
  '\\br\\s?r\\b',
  'معدل التنفس', 'معدل تنفس', 'التنفس', 'تنفس',
].join('|');

const TEMP_LABEL = [
  'temperature', 'temp',
  // STT routinely clips the trailing ة off حرارة
  'درجة الحرار(?:ة)?', 'الحرار(?:ة)?', 'حرار(?:ة)?', 'سخونة',
].join('|');

const GCS_LABEL = [
  'glasgow coma scale', 'glasgow', 'level of consciousness', 'conscious(?:ness)? level',
  '\\bg\\s?c\\s?s\\b',
  'مستو[يى] الوعي', 'درجة الوعي', 'غلاسكو', 'الوعي', 'وعي',
].join('|');

/**
 * SpO2 is dictated more loosely than any other vital, and the transcriber writes
 * the "O" as a digit zero about as often as the letter.
 */
const SPO2_LABEL = [
  'sp\\s?[o0]\\s?2', 's\\s?p\\s?[o0]\\s?2',
  'oxygen saturation', '[o0]2\\s?sat(?:uration)?', 'oxygen level', 'oxygen', 'saturation', 'sats?',
  'تشبع الأكسجين', 'نسبة الأكسجين', 'ال[أا]كسجين', '[أا]كسجين',
].join('|');

/** Saturation is a percentage; anything outside this is a flow rate or a misparse. */
const SPO2_MIN = 50;
const SPO2_MAX = 100;

const BP_LABEL = ['blood pressure', 'systolic', 'diastolic', '\\bb\\s?p\\b', 'ضغط الدم', 'الضغط', 'ضغط'].join('|');

const WEIGHT_LABEL = [
  'weight', 'body weight', 'wt',
  'الوزن', 'وزن', 'كيلو', 'كيلوغرام',
].join('|');

/** Any vital label, used to detect a label sitting between another label and its number. */
const ANY_VITAL_LABEL = new RegExp(
  [HR_LABEL, RR_LABEL, TEMP_LABEL, GCS_LABEL, SPO2_LABEL, BP_LABEL, WEIGHT_LABEL].join('|'),
  'i',
);

/**
 * Reject a label→number match whose gap contains a DIFFERENT vital's label.
 *
 * The gap is deliberately permissive ("HR is about 110"), which also let a bare
 * label bind to the next vital's figure: in "heart rate, BP 140 over 90" the HR
 * pattern happily reached past "BP" and reported a heart rate of 140.
 */
function bindsAcrossAnotherLabel(match: RegExpMatchArray, ownLabel: string): boolean {
  const span = match[0];
  const numberAt = span.search(/\d/);
  if (numberAt < 0) return false;
  const gap = span.slice(0, numberAt).replace(new RegExp(ownLabel, 'ig'), ' ');
  return ANY_VITAL_LABEL.test(gap);
}

/** Last labeled dictation wins so voice corrections replace earlier values. */
function lastRegexMatch(
  text: string,
  patterns: RegExp[],
  ownLabel?: string,
): RegExpMatchArray | null {
  let best: RegExpMatchArray | null = null;
  let bestIndex = -1;
  for (const re of patterns) {
    const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
    const global = new RegExp(re.source, flags);
    let m: RegExpExecArray | null;
    while ((m = global.exec(text)) !== null) {
      if (ownLabel && bindsAcrossAnotherLabel(m, ownLabel)) {
        if (m[0].length === 0) global.lastIndex += 1;
        continue;
      }
      if (m.index >= bestIndex) {
        bestIndex = m.index;
        best = m;
      }
      if (m[0].length === 0) global.lastIndex += 1;
    }
  }
  return best;
}

function parseVitals(text: string): { value: VitalSignEntry[]; span: string; confidence: number } | null {
  const t = normalizeDigits(text);
  const byType = new Map<VitalSignEntry['type'], VitalSignEntry>();
  const spans: string[] = [];

  const add = (type: VitalSignEntry['type'], value: VitalSignEntry['value'], unit: string, span: string) => {
    byType.set(type, { type, value, unit });
    spans.push(span);
  };

  const hr = lastRegexMatch(t, [
    new RegExp(`(?:${HR_LABEL})[^\\d]{0,12}(\\d{2,3})`, 'i'),
    new RegExp(`(\\d{2,3})\\s*(?:bpm)?\\s*(?:${HR_LABEL})`, 'i'),
  ], HR_LABEL);
  if (hr) add('HR', Number(hr[1]), 'bpm', hr[0]);

  const bp = lastRegexMatch(t, [
    new RegExp(`(?:${BP_LABEL})[^\\d]{0,12}(\\d{2,3})\\s*(?:[\\/\\\\]|over|على|on)\\s*(\\d{2,3})`, 'i'),
    /(\d{2,3})\s*(?:[\/\\]|over|على|on)\s*(\d{2,3})\s*(?:mmhg|mm hg|ضغط|bp)?/i,
  ], BP_LABEL);
  if (bp) add('BP', `${bp[1]}/${bp[2]}`, 'mmHg', bp[0]);

  // 'oxygen 15 liters' is a flow rate, not a saturation — hence the range check.
  const spo2 = lastRegexMatch(t, [
    new RegExp(`(?:${SPO2_LABEL})[^\\d]{0,8}(\\d{2,3})\\s*%?`, 'i'),
    /(\d{2,3})\s*%\s*(?:spo2|sat|oxygen|أكسجين)?/i,
  ], SPO2_LABEL);
  if (spo2) {
    const pct = Number(spo2[1]);
    if (pct >= SPO2_MIN && pct <= SPO2_MAX) add('SpO2', pct, '%', spo2[0]);
  }

  const rr = lastRegexMatch(t, [
    new RegExp(`(?:${RR_LABEL})[^\\d]{0,8}(\\d{1,3})`, 'i'),
    /\brr\s*(\d{1,3})\b/i,
  ], RR_LABEL);
  if (rr) {
    const n = Number(rr[1]);
    if (n >= 1 && n <= 120) add('RR', n, '/min', rr[0]);
  }

  const temp = lastRegexMatch(t, [
    new RegExp(`(?:${TEMP_LABEL})[^\\d]{0,8}(\\d{2}(?:\\.\\d)?)\\s*(?:c|celsius|°)?`, 'i'),
    /\btemp\s*(\d{2}(?:\.\d)?)\b/i,
  ], TEMP_LABEL);
  if (temp) add('Temp', Number(temp[1]), '°C', temp[0]);

  const gcs = lastRegexMatch(t, [
    new RegExp(`(?:${GCS_LABEL})[^\\d]{0,8}(\\d{1,2})`, 'i'),
    /\bgcs\s*(\d{1,2})\b/i,
  ], GCS_LABEL);
  if (gcs) add('GCS', Number(gcs[1]), '/15', gcs[0]);

  const weight = lastRegexMatch(t, [
    new RegExp(`(?:${WEIGHT_LABEL})[^\\d]{0,12}(\\d{1,3}(?:\\.\\d+)?)\\s*(?:kg|kgs|kilograms?|كيلو(?:غرام)?)?`, 'i'),
    /(\d{1,3}(?:\.\d+)?)\s*(?:kg|kgs|kilograms?|كيلو(?:غرام)?)/i,
  ], WEIGHT_LABEL);
  if (weight) {
    const kg = Number(weight[1]);
    if (Number.isFinite(kg) && kg >= 1 && kg <= 300) add('Weight', kg, 'kg', weight[0]);
  }

  const vitals = [...byType.values()];
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

function isVitalSignArray(value: unknown): value is VitalSignEntry[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  const first = value[0];
  return !!first && typeof first === 'object' && 'type' in first;
}

/** Union vitals by type so incremental transcripts accumulate BP/SpO2/RR/Temp/GCS. */
export function mergeVitalSignEntries(
  current: VitalSignEntry[] | null | undefined,
  incoming: VitalSignEntry[] | null | undefined,
): VitalSignEntry[] {
  const byType = new Map<VitalSignEntry['type'], VitalSignEntry>();
  for (const v of current || []) {
    if (v?.type) byType.set(v.type, v);
  }
  for (const v of incoming || []) {
    if (v?.type) byType.set(v.type, v); // incoming overwrites same type
  }
  return [...byType.values()];
}

/**
 * Overwrite when new confidence is higher, values differ (voice correction), field empty,
 * or user-edited preserved only when value is unchanged.
 * Special case: vital_signs arrays are union-merged by type so later chunks can add
 * BP/SpO2/RR/Temp/GCS without losing HR already captured at equal confidence.
 */
export function mergeFieldSlot<T>(
  current: SttFieldSlot<T>,
  incoming: { value: T; confidence: number; source_span: string },
): SttFieldSlot<T> {
  if (current.edited_by_user) return current;
  if (!isFilled(current)) {
    return { value: incoming.value, confidence: incoming.confidence, source_span: incoming.source_span, edited_by_user: false };
  }

  if (isVitalSignArray(current.value) && isVitalSignArray(incoming.value)) {
    const merged = mergeVitalSignEntries(current.value, incoming.value);
    const spans = [current.source_span, incoming.source_span].filter(Boolean);
    return {
      value: merged as T,
      confidence: Math.max(current.confidence, incoming.confidence),
      source_span: spans.join('; '),
      edited_by_user: false,
    };
  }

  const changed = JSON.stringify(current.value) !== JSON.stringify(incoming.value);
  if (incoming.confidence > current.confidence || (changed && incoming.confidence >= current.confidence)) {
    return { value: incoming.value, confidence: incoming.confidence, source_span: incoming.source_span, edited_by_user: false };
  }
  return current;
}

function joinSpans(a: string, b: string): string {
  const seen = [a, b].filter(Boolean).join('; ');
  return seen.length > 400 ? `${seen.slice(0, 397)}...` : seen;
}

/**
 * Union-merge for the array-valued slots.
 *
 * `vital_signs` carries all six vitals in ONE slot, so the scalar rule above
 * ("replace only on strictly higher confidence") froze it after the first
 * extraction — parseVitals always reports 0.88, so a later pass that found BP,
 * SpO2, RR, Temp and GCS could never replace a slot already holding just HR.
 * A collection has to accumulate, keyed so a restated value still wins.
 */
function mergeCollectionSlot<T>(
  current: SttFieldSlot<T[]>,
  incoming: { value: T[]; confidence: number; source_span: string },
  keyOf: (item: T) => string,
  { overwrite = true }: { overwrite?: boolean } = {},
): SttFieldSlot<T[]> {
  if (current.edited_by_user) return current;
  const byKey = new Map<string, T>();
  for (const item of (current.value || [])) byKey.set(keyOf(item), item);
  for (const item of (incoming.value || [])) {
    // The per-segment pass only fills gaps: it re-reads a fragment of the same
    // transcript, so it must never replace a value the full text already resolved.
    if (!overwrite && byKey.has(keyOf(item))) continue;
    byKey.set(keyOf(item), item);
  }
  return {
    value: [...byKey.values()],
    confidence: Math.max(current.confidence || 0, incoming.confidence),
    source_span: joinSpans(current.source_span, incoming.source_span),
    edited_by_user: false,
  };
}

const VITALS_KEY = (v: VitalSignEntry) => String(v.type);
const MED_KEY = (m: string) => String(m).trim().toLowerCase();

/** Route array-valued slots to the union merge; everything else keeps scalar semantics. */
function mergeAnySlot(
  key: SttFieldKey,
  current: SttFieldSlot,
  incoming: { value: unknown; confidence: number; source_span: string },
  opts: { overwrite?: boolean } = {},
): SttFieldSlot {
  if (key === 'vital_signs') {
    return mergeCollectionSlot(
      current as SttFieldSlot<VitalSignEntry[]>,
      incoming as { value: VitalSignEntry[]; confidence: number; source_span: string },
      VITALS_KEY,
      opts,
    ) as SttFieldSlot;
  }
  if (key === 'current_medications') {
    return mergeCollectionSlot(
      current as SttFieldSlot<string[]>,
      incoming as { value: string[]; confidence: number; source_span: string },
      MED_KEY,
      opts,
    ) as SttFieldSlot;
  }
  return mergeFieldSlot(current, incoming) as SttFieldSlot;
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
      local[key] = mergeAnySlot(key, local[key], {
        value: hit.value,
        confidence: hit.confidence,
        source_span: hit.span,
      });
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
      local.current_medications = mergeAnySlot('current_medications', local.current_medications, {
        value: meds.value,
        confidence: meds.confidence,
        source_span: meds.span,
      }) as SttFieldSlot<string[]>;
    }
    return local;
  };

  const full = runExtract(text);
  for (const key of Object.keys(full) as SttFieldKey[]) {
    const slot = full[key];
    if (isFilled(slot)) {
      fields[key] = mergeAnySlot(key, fields[key], {
        value: slot.value,
        confidence: slot.confidence,
        source_span: slot.source_span,
      });
    }
  }

  // Supplementary pass: re-read each script run to catch what the whole-text pass
  // missed. It sees less context than the full pass, so it fills gaps only.
  for (const seg of segmentTranscriptByLanguage(text)) {
    const segFields = runExtract(seg.text);
    for (const key of Object.keys(segFields) as SttFieldKey[]) {
      const slot = segFields[key];
      if (isFilled(slot)) {
        fields[key] = mergeAnySlot(key, fields[key], {
          value: slot.value,
          confidence: slot.confidence,
          source_span: slot.source_span,
        }, { overwrite: false });
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

  const coerceNum = (raw: unknown): string | number | null => {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    const s = String(raw).trim().replace(/%/g, '');
    const direct = Number(s);
    if (Number.isFinite(direct)) return direct;
    const spaced = s.replace(/ninetynine/gi, 'ninety nine').replace(/ninetyeight/gi, 'ninety eight');
    const normalized = normalizeSpokenNumbers(spaced);
    const n = Number(String(normalized).replace(/%/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  const vitals = fields.vital_signs.value as VitalSignEntry[] | null;
  if (Array.isArray(vitals)) {
    for (const v of vitals) {
      const conf = fields.vital_signs.confidence;
      if (v.type === 'HR') {
        const n = coerceNum(v.value);
        if (n != null) set('hr', String(n), conf);
      }
      if (v.type === 'SpO2') {
        const n = coerceNum(v.value);
        if (n != null) set('spo2', String(n), conf);
      }
      if (v.type === 'RR') {
        const n = coerceNum(v.value);
        if (n != null) set('rr', String(n), conf);
      }
      if (v.type === 'Temp') {
        const n = coerceNum(v.value);
        if (n != null) set('temperature', String(n), conf);
      }
      if (v.type === 'GCS') {
        const n = coerceNum(v.value);
        if (n != null) set('gcs', String(n), conf);
      }
      if (v.type === 'Weight') {
        const n = coerceNum(v.value);
        if (n != null) set('weight', n, conf);
      }
      if (v.type === 'BP' && typeof v.value === 'string') {
        const parts = String(v.value).split('/');
        const sys = coerceNum(parts[0]);
        const dia = parts[1] != null ? coerceNum(parts[1]) : null;
        if (sys != null) set('bp_systolic', String(sys), conf);
        if (dia != null) set('bp_diastolic', String(dia), conf);
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
  transcript = '',
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
    const spoken = parseSpokenAge(String(llm.age))
      || parseSpokenAge(`age ${llm.age}`)
      || parseSpokenAge(`عمره ${llm.age}`);
    if (spoken) {
      out.age = mergeFieldSlot(out.age, { value: spoken.value, confidence: cap(conf.age ?? 0.8), source_span: 'llm' });
    } else {
      const ageNum = Number(String(llm.age).replace(/[^\d.]/g, ''));
      if (ageNum > 0 && ageNum <= 130 && !/month|شهر|week|day|يوم|أسبوع/i.test(String(llm.age))) {
        out.age = mergeFieldSlot(out.age, { value: ageNum, confidence: cap(conf.age ?? 0.8), source_span: 'llm' });
      }
    }
  }
  if (llm.chief_complaint) {
    out.chief_complaint = mergeFieldSlot(out.chief_complaint, { value: llm.chief_complaint, confidence: cap(conf.chief_complaint ?? 0.8), source_span: 'llm' });
  }
  // Never invent pain — especially "0 / no pain" when the transcript never mentioned pain
  if (
    llm.pain_score != null
    && llm.pain_score >= 0
    && llm.pain_score <= 10
    && transcriptMentionsPain(transcript)
  ) {
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
