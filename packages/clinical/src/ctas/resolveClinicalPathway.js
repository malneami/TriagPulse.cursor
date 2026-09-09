/**
 * Resolve the clinical clarifying pathway from complaint + vitals + transcript.
 * Prevents trauma/limb bank questions when the case is fever or undifferentiated medical.
 */
import { matchComplaint, resolveChiefComplaint } from './resolveChiefComplaint.js';

function toNum(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {{
 *   patient?: Record<string, unknown>,
 *   transcript?: string,
 *   preferredPathway?: string|null,
 * }} opts
 * @returns {{
 *   pathway: string,
 *   source: 'complaint'|'vital_fever'|'transcript'|'preferred'|'general'|'pending_confirmation',
 *   match: ReturnType<typeof matchComplaint>,
 *   resolution?: object,
 * }}
 */
export function resolveClinicalPathway({
  patient = {},
  transcript = '',
  preferredPathway = null,
} = {}) {
  const txFull = `${transcript || ''} ${patient.transcription || ''}`;
  const confirmedKey = patient.confirmed_complaint_key || null;

  if (preferredPathway && preferredPathway !== 'general') {
    return {
      pathway: preferredPathway,
      source: 'preferred',
      match: matchComplaint(String(patient.chief_complaint || ''), { transcript: txFull, confirmedKey }),
    };
  }

  const resolution = resolveChiefComplaint({
    chiefComplaint: String(patient.chief_complaint || ''),
    transcript: txFull,
    confirmedKey,
  });

  if (resolution.selected?.complaintKey) {
    const match = matchComplaint(String(patient.chief_complaint || ''), { transcript: txFull, confirmedKey });
    return {
      pathway: resolution.selected.complaintKey,
      source: resolution.status === 'confirmed' ? 'preferred' : 'complaint',
      match,
      resolution,
    };
  }

  const tx = txFull.toLowerCase();
  const temp = toNum(patient.temperature);

  // Vital/transcript rescues run even when free-text complaint is garbled/unmapped
  if ((temp != null && temp >= 38.0)
    || /\bfever\b|febrile|حمى|سخون|حرارة\s*(?:عالي|مرتفعة)?/i.test(tx)) {
    return { pathway: 'fever', source: temp != null && temp >= 38.0 ? 'vital_fever' : 'transcript', match: null, resolution };
  }

  if (/\bchest\s*pain\b|ألم\s*(?:في\s*)?الصدر|ألم\s*صدري/i.test(tx)) {
    return { pathway: 'chest_pain_cardiac', source: 'transcript', match: null, resolution };
  }
  if (/\btrauma\b|حادث|إصابة|injury|fall|سقوط|limb|كسر|طرف/i.test(tx)) {
    return { pathway: 'multisystem_trauma_blunt', source: 'transcript', match: null, resolution };
  }
  if (/\bshortness|dyspnea|ضيق\s*تنفس/i.test(tx)) {
    return { pathway: 'shortness_of_breath', source: 'transcript', match: null, resolution };
  }

  // Ambiguous complaint with candidates — await confirmation (no silent pathway guess)
  if (resolution.needs_confirmation && (resolution.candidates?.length || patient.chief_complaint)) {
    return {
      pathway: 'general',
      source: 'pending_confirmation',
      match: null,
      resolution,
    };
  }

  return { pathway: 'general', source: 'general', match: null, resolution };
}
