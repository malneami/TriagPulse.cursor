/**
 * Resolve the clinical clarifying pathway from complaint + vitals + transcript.
 * Prevents trauma/limb bank questions when the case is fever or undifferentiated medical.
 */
import { matchComplaint, resolveChiefComplaint, findComplaintMentions } from './resolveChiefComplaint.js';
import { findingStatus } from './negation.js';

/** Stated (not only denied): "no fever" does not make a fever pathway. */
const stated = (re, tx) => ['positive', 'both'].includes(findingStatus(re, tx));

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

  // With no complaint typed or confirmed, the transcript match must be something actually
  // stated ("no vomiting" is not a vomiting complaint); otherwise use what was stated.
  if (resolution.selected?.complaintKey && !patient.chief_complaint && !confirmedKey) {
    const mentions = findComplaintMentions(txFull).map((m) => m.complaintKey);
    if (!mentions.includes(resolution.selected.complaintKey)) {
      if (mentions.length) {
        return { pathway: mentions[0], source: 'transcript', match: null, resolution };
      }
      resolution.selected = null;
    }
  }

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
    // «حرارة» alone is not fever: «درجة الحرارة ٣٦» is the temperature reading.
    || stated(/\bfever\b|febrile|حمى|حمّى|سخون|(?:عنده|عندها|عندو|فيه|فيها|معه|معها|من|مع)\s+(?:ال)?حرارة|حرارة\s+(?:عالي|عالية|مرتفعة|شديدة)|ارتفاع\s+(?:في\s+)?(?:درجة\s+)?(?:ال)?حرارة/i, tx)) {
    return { pathway: 'fever', source: temp != null && temp >= 38.0 ? 'vital_fever' : 'transcript', match: null, resolution };
  }

  if (stated(/\bchest\s*pain\b|ألم\s*(?:في\s*)?الصدر|ألم\s*صدري/i, tx)) {
    return { pathway: 'chest_pain_cardiac', source: 'transcript', match: null, resolution };
  }
  // Arabic words matched whole: «المكسرات» (nuts) is not «كسر» (fracture).
  if (stated(/\btrauma\b|\binjur\w*|\bfell\b|\bfall\b|(?:^|[\s،,.])(?:حادث|إصابة|اصابة|سقوط|سقط|طاح|كسر|الكسر|طرف)(?=$|[\s،,.])/i, tx)) {
    return { pathway: 'multisystem_trauma_blunt', source: 'transcript', match: null, resolution };
  }
  if (stated(/\bshortness\s+of\s+breath|dyspn\w*|ضيق\s*(?:في\s*)?(?:ال)?تنفس/i, tx)) {
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
