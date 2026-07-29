import type { CodedTerm } from './types';

/** Lightweight SNOMED/ICD-10 mapping for common ED chief complaints (decision support). */
const COMPLAINT_CODES: Array<{ pattern: RegExp; term: string; snomed: string; icd10: string }> = [
  { pattern: /chest pain|ألم صدر|ألم في الصدر/i, term: 'Chest pain', snomed: '29857009', icd10: 'R07.9' },
  { pattern: /shortness of breath|dyspnea|ضيق تنفس|ضيق في التنفس/i, term: 'Dyspnea', snomed: '267036007', icd10: 'R06.00' },
  { pattern: /abdominal pain|ألم بطن|ألم في البطن/i, term: 'Abdominal pain', snomed: '21522001', icd10: 'R10.9' },
  { pattern: /headache|صداع/i, term: 'Headache', snomed: '25064002', icd10: 'R51.9' },
  { pattern: /fever|حمى|حرارة/i, term: 'Fever', snomed: '386661006', icd10: 'R50.9' },
  { pattern: /stroke|سكتة/i, term: 'Stroke symptoms', snomed: '230690007', icd10: 'I63.9' },
  { pattern: /seizure|تشنج|نوبة/i, term: 'Seizure', snomed: '91175000', icd10: 'R56.9' },
];

export function mapClinicalCodes(transcript: string, chiefComplaint?: string | null): CodedTerm[] {
  const haystack = `${transcript} ${chiefComplaint || ''}`.trim();
  if (!haystack) return [];
  const coded: CodedTerm[] = [];
  for (const entry of COMPLAINT_CODES) {
    if (entry.pattern.test(haystack)) {
      coded.push({ term: entry.term, system: 'SNOMED', code: entry.snomed });
      coded.push({ term: entry.term, system: 'ICD10', code: entry.icd10 });
    }
  }
  return coded;
}
