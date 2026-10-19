/**
 * Patient-identifier protection (PDPL decision, Oct 2026).
 *
 * TriagePulse keeps only the HIS Transaction No. (and its own ticket number) to identify a
 * patient; names, national ID / iqama, phone, MRN, date of birth, nationality and insurance
 * stay in the HIS. Two helpers enforce that on the server:
 *
 *  - redactIdentifiers(text): removes ID-like numbers, phone numbers and spoken names from
 *    free text before it is stored or sent to an outside service (e.g. the OpenAI
 *    extraction step). Clinical numbers (vitals, ages, scores, times) are never 7+ digits
 *    long, so they are kept.
 *  - stripIdentifiers(value): deep copy of a JSON value with identifier keys removed and
 *    every string passed through redactIdentifiers.
 *
 * Audio cannot be redacted; the nurse is asked not to say names or ID numbers aloud.
 */

export const REDACTED = '[•••]';

/** Keys that hold a patient identifier anywhere in a record or JSON blob. */
export const IDENTIFIER_KEYS: ReadonlySet<string> = new Set([
  'patient_name', 'patient_name_ar', 'patient_name_en', 'patientName', 'patientNameAr', 'patientNameEn',
  'full_name_patient', 'mrn', 'id_number', 'idNumber', 'national_id', 'nationalId', 'iqama',
  'phone', 'mobile', 'phone_number', 'phoneNumber', 'dob', 'date_of_birth', 'dateOfBirth',
  'nationality', 'insurance', 'insurance_id', 'receipt_image_url', 'receiptImageUrl',
]);

const DIGIT = '[0-9٠-٩۰-۹]';

/** Saudi mobile in any common form: 05xxxxxxxx, 5xxxxxxxx, +9665…, 009665…, with spaces or dashes. */
const PHONE_RE = new RegExp(
  `(?<![0-9A-Za-z\u0660-\u0669])(?:\\+|00)?(?:966[\\s-]?)?0?5${DIGIT}(?:[\\s-]?${DIGIT}){7}(?![0-9A-Za-z\u0660-\u0669])`,
  'g',
);

/** Any run of 7 or more digits (national ID / iqama 10, Transaction No. 9–10, MRN 7, phone). */
/** Not part of a code such as a UUID or rule ID (letters/digits, or a dash joined to them). */
const LONG_NUMBER_RE = new RegExp(`(?<![0-9A-Za-z]|[0-9A-Za-z]-)${DIGIT}{7,}(?![0-9A-Za-z]|-[0-9A-Za-z])`, 'g');

/** Digits grouped with dashes into 9+ digits (e.g. 1023-456-789); dates are kept. */
const GROUPED_NUMBER_RE = new RegExp(`(?<![0-9A-Za-z])${DIGIT}{2,}(?:-${DIGIT}{2,}){2,}(?![0-9A-Za-z])`, 'g');
const DATE_SHAPE = /^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}-\d{1,2}-\d{4})$/;

const AR_WORD = '[ء-ي٠-٩ٱ-ۓ]+';
const EN_WORD = "[A-Za-z][A-Za-z'\\-]*";

/** Name cues followed by up to three name words. */
const AR_NAME_RE = new RegExp(
  `((?:^|[\\s،,.:؛])(?:اسم المريضة|اسم المريض|اسم الطفلة|اسم الطفل|اسمها|اسمه|اسمي|اسمك|إسمها|إسمه|إسمي|الاسم)\\s*(?:هو|هي)?\\s*[:：]?\\s*)(${AR_WORD}(?:\\s+${AR_WORD}){0,4})`,
  'g',
);
const EN_NAME_RE = new RegExp(
  `(\\b(?:my name is|his name is|her name is|the name is|name is|patient name(?: is)?|patient's name(?: is)?|name)\\s*[:：]\\s*|\\b(?:my name is|his name is|her name is|the name is|name is|patient name is|patient's name is)\\s+)(${EN_WORD}(?:\\s+${EN_WORD}){0,3})`,
  'gi',
);
/** Words that end a name: the clinical story starts here, so it is kept. */
const AR_STOP = new Set(['عنده', 'عندها', 'عندي', 'يشتكي', 'تشتكي', 'اشتكي', 'عمره', 'عمرها', 'عمري', 'جاء', 'جات', 'جاءت',
  'وصل', 'وصلت', 'من', 'في', 'على', 'مع', 'و', 'ألم', 'الم', 'حرارة', 'كحة', 'سعال', 'ضيق', 'ترجيع', 'استفراغ', 'اسهال',
  'إسهال', 'دوخة', 'صداع', 'المريض', 'المريضة', 'الطفل', 'الطفلة', 'سنة', 'سنوات', 'شهر', 'شهور', 'يوم', 'أيام', 'رقم', 'هويته', 'جواله']);
const EN_STOP = /^(?:and|with|has|have|had|is|was|who|age|aged|year|years|old|presents|presented|complains|complaining|came|comes|brought|from|in|on|at|for|he|she|they|his|her|pain|fever|cough|vomiting|the|a|an|unknown|not|no)$/i;

/** Redact the leading name words up to the first stop word; keep the rest of the text. */
function cutName(words: string, isStop: (w: string) => boolean): { name: string; rest: string } {
  const parts = words.split(/(\s+)/);
  let i = 0;
  let nameWords = 0;
  for (; i < parts.length; i += 2) {
    const w = parts[i];
    const bare = w.replace(/^و(?=\S{2,})/, '');
    if (isStop(w) || (nameWords > 0 && bare !== w && isStop(bare))) break;
    nameWords += 1;
  }
  return { name: parts.slice(0, Math.max(0, i - 1)).join(''), rest: parts.slice(Math.max(0, i - 1)).join('') };
}

export function redactIdentifiers(text: string): string;
export function redactIdentifiers(text: string | null | undefined): string | null | undefined;
export function redactIdentifiers(text: string | null | undefined): string | null | undefined {
  if (text == null || text === '') return text;
  let out = String(text);
  out = out.replace(PHONE_RE, REDACTED);
  out = out.replace(GROUPED_NUMBER_RE, (m) => (
    !DATE_SHAPE.test(m) && m.replace(/[^0-9٠-٩۰-۹]/g, '').length >= 9 ? REDACTED : m));
  out = out.replace(LONG_NUMBER_RE, REDACTED);
  out = out.replace(AR_NAME_RE, (m, cue: string, words: string) => {
    const { name, rest } = cutName(words, (w) => AR_STOP.has(w));
    return name ? `${cue}${REDACTED}${rest}` : m;
  });
  out = out.replace(EN_NAME_RE, (m, cue: string, words: string) => {
    const { name, rest } = cutName(words, (w) => EN_STOP.test(w));
    return name ? `${cue}${REDACTED}${rest}` : m;
  });
  return out;
}

/** Deep copy without identifier keys; every string is redacted. Safe on any JSON value. */
export function stripIdentifiers<T>(value: T): T {
  return strip(value, 0) as T;
}

function strip(value: unknown, depth: number): unknown {
  if (depth > 25) return null;
  if (typeof value === 'string') return redactIdentifiers(value);
  if (Array.isArray(value)) return value.map((v) => strip(v, depth + 1));
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (IDENTIFIER_KEYS.has(k)) continue;
      out[k] = strip(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** True when a record still carries a patient identifier key with a value. */
export function findIdentifierKeys(value: unknown, path = '', found: string[] = [], depth = 0): string[] {
  if (depth > 25 || !value || typeof value !== 'object') return found;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const p = path ? `${path}.${k}` : k;
    if (IDENTIFIER_KEYS.has(k) && v != null && v !== '') found.push(p);
    else findIdentifierKeys(v, p, found, depth + 1);
  }
  return found;
}
