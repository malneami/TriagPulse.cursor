/**
 * Concise bilingual narrative clinical summary from structured fields + transcript.
 * Assistive only — does not replace clinician documentation.
 */

export interface NarrativeSummaryInput {
  patient?: Record<string, unknown>;
  transcript?: string;
  ctasLevel?: number | null;
  ctasNameAr?: string | null;
  ctasNameEn?: string | null;
  waitAr?: string | null;
  waitEn?: string | null;
  redFlags?: Array<{ ar?: string; en?: string } | string> | string | null;
  destinationAr?: string | null;
  destinationEn?: string | null;
  modifierNotes?: string | null;
}

export interface NarrativeSummary {
  clinical_summary_ar: string;
  clinical_summary_en: string;
}

function str(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function vitalsLine(patient: Record<string, unknown>): { ar: string; en: string } {
  const partsAr: string[] = [];
  const partsEn: string[] = [];
  if (patient.hr != null && patient.hr !== '') {
    partsAr.push(`نبض ${patient.hr}`);
    partsEn.push(`HR ${patient.hr}`);
  }
  if (patient.bp_systolic != null && patient.bp_systolic !== '') {
    const bp = `${patient.bp_systolic}/${patient.bp_diastolic || '—'}`;
    partsAr.push(`ضغط ${bp}`);
    partsEn.push(`BP ${bp}`);
  }
  if (patient.spo2 != null && patient.spo2 !== '') {
    partsAr.push(`SpO₂ ${patient.spo2}%`);
    partsEn.push(`SpO₂ ${patient.spo2}%`);
  }
  if (patient.rr != null && patient.rr !== '') {
    partsAr.push(`تنفس ${patient.rr}`);
    partsEn.push(`RR ${patient.rr}`);
  }
  if (patient.temperature != null && patient.temperature !== '') {
    partsAr.push(`حر ${patient.temperature}`);
    partsEn.push(`Temp ${patient.temperature}`);
  }
  if (patient.gcs != null && patient.gcs !== '') {
    partsAr.push(`GCS ${patient.gcs}`);
    partsEn.push(`GCS ${patient.gcs}`);
  }
  if (patient.pain_score != null && patient.pain_score !== '') {
    partsAr.push(`ألم ${patient.pain_score}/10`);
    partsEn.push(`Pain ${patient.pain_score}/10`);
  }
  return {
    ar: partsAr.join('، '),
    en: partsEn.join(', '),
  };
}

function redFlagText(
  flags: NarrativeSummaryInput['redFlags'],
): { ar: string; en: string } {
  if (!flags) return { ar: '', en: '' };
  if (typeof flags === 'string') return { ar: flags, en: flags };
  const ar = flags.map((f) => (typeof f === 'string' ? f : f.ar || f.en || '')).filter(Boolean).join('؛ ');
  const en = flags.map((f) => (typeof f === 'string' ? f : f.en || f.ar || '')).filter(Boolean).join('; ');
  return { ar, en };
}

/** First ~180 chars of transcript as clinical context snippet. */
function transcriptSnippet(transcript: string, max = 180): string {
  const t = transcript.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function buildNarrativeClinicalSummary(input: NarrativeSummaryInput = {}): NarrativeSummary {
  const patient = input.patient || {};
  const age = str(patient.age);
  const gender = str(patient.gender);
  const complaint = str(patient.chief_complaint) || 'غير محدد / Unspecified';
  const onset = str(patient.onset_duration || patient.onset);
  const history = str(patient.relevant_history);
  const meds = Array.isArray(patient.current_medications)
    ? patient.current_medications.join(', ')
    : str(patient.current_medications);
  const allergies = str(patient.allergies);
  const level = input.ctasLevel ?? null;
  const vitals = vitalsLine(patient);
  const flags = redFlagText(input.redFlags);
  const snippet = transcriptSnippet(str(input.transcript || patient.transcription));

  const demAr = [age && `عمر ${age}`, gender === 'male' ? 'ذكر' : gender === 'female' ? 'أنثى' : gender]
    .filter(Boolean)
    .join('، ');
  const demEn = [age && `age ${age}`, gender].filter(Boolean).join(', ');

  const arParts = [
    demAr ? `مريض (${demAr})` : 'مريض',
    `يشكو من: ${complaint}`,
    onset ? `بدء الأعراض: ${onset}` : '',
    vitals.ar ? `العلامات الحيوية: ${vitals.ar}` : '',
    history ? `تاريخ مرضي: ${history}` : '',
    meds ? `أدوية: ${meds}` : '',
    allergies ? `حساسية: ${allergies}` : '',
    flags.ar ? `علامات خطر: ${flags.ar}` : '',
    input.modifierNotes ? `ملاحظات معدّل: ${input.modifierNotes}` : '',
    level != null
      ? `توصية CTAS ${level}${input.ctasNameAr ? ` (${input.ctasNameAr})` : ''}${input.waitAr ? ` — ${input.waitAr}` : ''}`
      : '',
    input.destinationAr ? `الوجهة المقترحة: ${input.destinationAr}` : '',
    snippet ? `من المحادثة: ${snippet}` : '',
  ].filter(Boolean);

  const enParts = [
    demEn ? `Patient (${demEn})` : 'Patient',
    `presents with: ${complaint}`,
    onset ? `onset: ${onset}` : '',
    vitals.en ? `vitals: ${vitals.en}` : '',
    history ? `history: ${history}` : '',
    meds ? `medications: ${meds}` : '',
    allergies ? `allergies: ${allergies}` : '',
    flags.en ? `red flags: ${flags.en}` : '',
    input.modifierNotes ? `modifier notes: ${input.modifierNotes}` : '',
    level != null
      ? `CTAS recommendation ${level}${input.ctasNameEn ? ` (${input.ctasNameEn})` : ''}${input.waitEn ? ` — ${input.waitEn}` : ''}`
      : '',
    input.destinationEn ? `suggested destination: ${input.destinationEn}` : '',
    snippet ? `from conversation: ${snippet}` : '',
  ].filter(Boolean);

  return {
    clinical_summary_ar: arParts.join('. ') + '.',
    clinical_summary_en: enParts.join('. ') + '.',
  };
}
