/**
 * Reads HIS numbers from on-device OCR of Al Gharb visit slips.
 *
 * Two layouts:
 * - Outpatient visit ticket: "Transaction No." (9–10 digits) and "Patient No." (MRN).
 * - Follow-up voucher: "Voucher No." (9–10 digits); often no Transaction No. label.
 *
 * The 8-digit appointment / Ref. Invoice number must not be taken. Full MRN is
 * never kept — only the last three digits for the public tracking code.
 */

export interface TicketNumberResult {
  value: string;
  /** Which printed label the digits were read from. */
  source: 'transaction' | 'voucher' | 'invoice' | 'patient_no';
}

const DIGIT_LOOKALIKE: Record<string, string> = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', '|': '1', i: '1', S: '5', s: '5', B: '8', Z: '2', z: '2', G: '6', g: '9', q: '9' };

/** Fix OCR look-alikes inside a run that is mostly digits ("26399O3O8" → "263990308"). */
function digitsOf(chunk: string): string {
  const compact = chunk.replace(/[\s.,'’`-]/g, '');
  if (!compact) return '';
  const digitish = [...compact].filter((c) => /\d/.test(c) || c in DIGIT_LOOKALIKE).length;
  if (digitish / compact.length < 0.8) return '';
  return [...compact].map((c) => (/\d/.test(c) ? c : DIGIT_LOOKALIKE[c] ?? '')).join('');
}

const VISIT_PATTERN = /^\d{9,10}$/;
const MRN_PATTERN = /^\d{6,7}$/;

type LabelSpec = { re: RegExp; source: TicketNumberResult['source']; skipIf?: (line: string) => boolean };

const VISIT_LABELS: LabelSpec[] = [
  { re: /tr[a-z]{0,3}n[s5][a-z]{0,3}ct[il1]{0,2}[o0]n[^A-Za-z0-9]{0,4}(?:n[o0]|number|#)?/i, source: 'transaction' },
  { re: /v[o0]uch[ae]r[^A-Za-z0-9]{0,4}(?:n[o0]|number|#)?/i, source: 'voucher' },
  {
    re: /invoice[^A-Za-z0-9]{0,4}(?:n[o0]|number|#)?/i,
    source: 'invoice',
    skipIf: (line) => /\bref\.?\b/i.test(line),
  },
];

const PATIENT_NO = /patient[^A-Za-z0-9]{0,6}n[o0]/i;

function numberAfterLabel(lines: string[], spec: LabelSpec, pattern: RegExp): TicketNumberResult | null {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (spec.skipIf?.(line)) continue;
    const m = line.match(spec.re);
    if (!m) continue;
    const after = line.slice((m.index ?? 0) + m[0].length);
    for (const candidate of [after, lines[i + 1] || '']) {
      const runs = candidate.match(/[0-9OoDQIl|iSsBZzGgq][0-9OoDQIl|iSsBZzGgq\s.,'’`-]{5,}/g) || [];
      for (const run of runs) {
        const d = digitsOf(run);
        if (pattern.test(d)) return { value: d, source: spec.source };
      }
    }
  }
  return null;
}

/**
 * Visit / encounter number: Transaction No., else Voucher No., else a 9–10 digit Invoice No.
 * (never Ref. Invoice / appointment).
 */
export function visitNumberFromText(text: string, pattern: RegExp = VISIT_PATTERN): TicketNumberResult | null {
  const lines = String(text || '').split(/\r?\n/);
  for (const spec of VISIT_LABELS) {
    const found = numberAfterLabel(lines, spec, pattern);
    if (found) return found;
  }
  return null;
}

/** @deprecated Use visitNumberFromText — kept so existing camera callers keep working. */
export function transactionNoFromText(text: string, pattern: RegExp = VISIT_PATTERN): TicketNumberResult | null {
  return visitNumberFromText(text, pattern);
}

/** Printed Patient No. (the MRN): 6–7 digits. Null if that label is missing. */
export function patientNoFromText(text: string): string | null {
  const lines = String(text || '').split(/\r?\n/);
  const found = numberAfterLabel(lines, { re: PATIENT_NO, source: 'patient_no' }, MRN_PATTERN);
  return found?.value ?? null;
}

/** Last three digits of the printed Patient No. (MRN). Null if that label is missing. */
export function mrnSuffixFromText(text: string): string | null {
  const no = patientNoFromText(text);
  return no ? no.slice(-3) : null;
}

/**
 * Patient No. (MRN) from a 6–7 digit barcode. 9–10 digit barcodes are visit numbers.
 */
export function patientNoFromBarcode(raw: string): string | null {
  const d = String(raw || '').replace(/\D/g, '');
  return MRN_PATTERN.test(d) ? d : null;
}

/**
 * Last three digits from a barcode that holds the file number (6–7 digits).
 * 9–10 digit barcodes are visit numbers, not MRN — ignored here.
 */
export function mrnSuffixFromBarcode(raw: string): string | null {
  const no = patientNoFromBarcode(raw);
  return no ? no.slice(-3) : null;
}

export function isVisitNumber(raw: string): boolean {
  return VISIT_PATTERN.test(String(raw || '').replace(/\s+/g, ''));
}

export function isMrnSuffix(raw: string): boolean {
  return /^\d{3}$/.test(String(raw || '').trim());
}

/** Age read from the slip. Date of birth is used on the device only to work out the age; it is never kept. */
export interface TicketAgeResult {
  /** Whole months (0 for a newborn under one month). */
  months: number;
  /** Whole years. */
  years: number;
  source: 'age' | 'dob';
  /** Short display, e.g. "5 y 3 m", "18 m", "34 y". */
  label: string;
}

const MAX_AGE_MONTHS = 130 * 12;

export function ageLabel(months: number): string {
  if (months < 24) return `${months} m`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y < 18 && m ? `${y} y ${m} m` : `${y} y`;
}

function ageResult(months: number, source: TicketAgeResult['source']): TicketAgeResult | null {
  if (!Number.isFinite(months) || months < 0 || months > MAX_AGE_MONTHS) return null;
  const mo = Math.floor(months);
  return { months: mo, years: Math.floor(mo / 12), source, label: ageLabel(mo) };
}

const AGE_LABEL = /(?:\bage\b|العمر|السن)\s*[:.\-]?\s*(.{0,40})/i;
const DOB_LABEL = /(?:\bd\.?\s?o\.?\s?b\b|date\s*of\s*birth|birth\s*date|b\.?\s?date|تاريخ\s*الميلاد)\s*[:.\-]?\s*(.{0,40})/i;

/** "5 Y 3 M", "34 Years", "18 Months", "10 Days", "2Y", "34" → months. */
function monthsFromAgeText(raw: string): number | null {
  const s = raw.replace(/[Oo](?=\s*\d|\d)/g, '0').toLowerCase();
  const num = (re: RegExp) => { const m = s.match(re); return m ? parseInt(m[1], 10) : null; };
  const y = num(/(\d{1,3})\s*(?:y(?:ears?|rs?)?\b|سن[ةه]|سنوات|عام)/);
  const mo = num(/(\d{1,2})\s*(?:m(?:o|on|onths?|ths?)?\b|شهر|أشهر|اشهر)/);
  const w = num(/(\d{1,2})\s*(?:w(?:ee)?ks?\b|w\b|أسبوع|اسابيع|أسابيع)/);
  const d = num(/(\d{1,3})\s*(?:d(?:ays?)?\b|يوم|أيام|ايام)/);
  if (y != null || mo != null) return (y ?? 0) * 12 + (mo ?? 0);
  if (w != null) return Math.floor((w * 7) / 30.44);
  if (d != null) return Math.floor(d / 30.44);
  const bare = s.match(/^\s*(\d{1,3})(?!\s*[\/.\-]\d)\b/);
  return bare ? parseInt(bare[1], 10) * 12 : null;
}

function monthsBetween(birth: Date, today: Date): number {
  let m = (today.getFullYear() - birth.getFullYear()) * 12 + (today.getMonth() - birth.getMonth());
  if (today.getDate() < birth.getDate()) m -= 1;
  return m;
}

function validDate(y: number, mo: number, d: number): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  return dt.getMonth() === mo - 1 ? dt : null;
}

/** Date of birth → months. dd/mm vs mm/dd is accepted only when both readings give the same age. */
function monthsFromDobText(raw: string, today: Date): number | null {
  const iso = raw.match(/(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
  if (iso) {
    const dt = validDate(+iso[1], +iso[2], +iso[3]);
    return dt && dt <= today ? monthsBetween(dt, today) : null;
  }
  const m = raw.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
  if (!m) return null;
  const a = +m[1]; const b = +m[2]; const yr = +m[3];
  const readings = [validDate(yr, b, a), validDate(yr, a, b)] // dd/mm, mm/dd
    .filter((x): x is Date => !!x && x <= today)
    .map((x) => monthsBetween(x, today));
  if (!readings.length) return null;
  if (readings.length === 2 && readings[0] !== readings[1]) {
    // Ambiguous day/month: accept only if the whole-year age agrees (and the patient is 2 y or older).
    const [y1, y2] = readings.map((x) => Math.floor(x / 12));
    if (y1 !== y2 || y1 < 2) return null;
    return y1 * 12;
  }
  return readings[0];
}

/**
 * Patient age from the slip text: an "Age" label first, else the date of birth.
 * Null when neither is printed or the reading is unclear (the nurse then checks by hand).
 */
export function ageFromText(text: string, today: Date = new Date()): TicketAgeResult | null {
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (DOB_LABEL.test(line)) continue;
    const m = line.match(AGE_LABEL);
    if (!m) continue;
    for (const candidate of [m[1], lines[i + 1] || '']) {
      const months = monthsFromAgeText(candidate);
      if (months != null) return ageResult(months, 'age');
    }
  }
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(DOB_LABEL);
    if (!m) continue;
    for (const candidate of [m[1], lines[i + 1] || '']) {
      const months = monthsFromDobText(candidate, today);
      if (months != null) return ageResult(months, 'dob');
    }
  }
  return null;
}
