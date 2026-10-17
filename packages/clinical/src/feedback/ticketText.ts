/**
 * Finds the HIS "Transaction No." in text read by the camera (OCR) from the outpatient
 * visit ticket. The ticket also prints the patient file number (MRN, 7 digits), the
 * appointment number (8 digits), dates and the insurance ID, which must not be taken.
 *
 * Pure function: the app runs OCR on the device and passes the text in; nothing else
 * from the ticket is kept.
 */

export interface TicketNumberResult {
  value: string;
  /** Always read next to the printed "Transaction No." label. */
  source: 'label';
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

const LABEL = /tr[a-z]{0,3}n[s5][a-z]{0,3}ct[il1]{0,2}[o0]n[^A-Za-z0-9]{0,4}(?:n[o0]|number|#)?/i;

export function transactionNoFromText(text: string, pattern: RegExp = /^\d{9,10}$/): TicketNumberResult | null {
  const lines = String(text || '').split(/\r?\n/);
  // 1) The number printed after the "Transaction No." label (same line, or the next line).
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(LABEL);
    if (!m) continue;
    const after = lines[i].slice((m.index ?? 0) + m[0].length);
    for (const candidate of [after, lines[i + 1] || '']) {
      const runs = candidate.match(/[0-9OoDQIl|iSsBZzGgq][0-9OoDQIl|iSsBZzGgq\s.,'’`-]{6,}/g) || [];
      for (const run of runs) {
        const d = digitsOf(run);
        if (pattern.test(d)) return { value: d, source: 'label' };
      }
    }
  }
  // No fallback to "any 9–10 digit number": on a real ticket photo that picked up the wrong
  // number (the sticker or a barcode's digits). Without the label, the nurse types it.
  return null;
}
