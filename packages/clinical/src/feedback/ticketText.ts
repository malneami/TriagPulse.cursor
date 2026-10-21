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
