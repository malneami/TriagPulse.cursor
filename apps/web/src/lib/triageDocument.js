import { CTAS_CONFIG } from '@triagepulse/clinical';

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const val = (v, unit = '') => (v === '' || v == null ? '—' : `${v}${unit}`);

/**
 * Plain-text triage note for copy, print and the record view. Built only from what
 * was recorded; empty fields are shown as "—", never filled in.
 */
export function buildTriageDocument(r) {
  const p = r.patient || {};
  const final = CTAS_CONFIG[r.finalLevel] || {};
  const lines = [
    'TriagePulse · CTAS triage record',
    `Patient: ${p.patient_name_en || p.patient_name_ar || '—'}${r.patientId ? ` (${r.patientId})` : ''}`,
    `Age/Sex: ${val(p.age, ' y')} / ${p.gender || '—'}    Weight: ${val(p.weight, ' kg')}`,
    `Arrival: ${fmtTime(p.arrival_time)}    Triage completed: ${fmtTime(r.completedAt)}`,
    '',
    `FINAL CTAS: ${r.finalLevel ?? '—'} ${final.en ? `(${final.en})` : ''}`,
    `Patient direction: ${r.direction?.destination_en || '—'}`,
    r.overridden
      ? `Nurse override of AI recommendation (CTAS ${r.aiLevel ?? '—'}, ${r.aiDirection?.destination_en || '—'}). Reason: ${r.overrideReason || '—'}`
      : `AI recommendation confirmed by nurse (CTAS ${r.aiLevel ?? '—'}).`,
    r.initialLevel != null && r.initialLevel !== r.aiLevel
      ? `Initial CTAS ${r.initialLevel} → updated ${r.aiLevel} after clarification.`
      : null,
    '',
    `Chief complaint: ${val(p.chief_complaint)}    Onset: ${val(p.onset_duration)}`,
    `Pain: ${val(p.pain_score, '/10')}`,
    `Vitals: HR ${val(p.hr)} · BP ${val(p.bp_systolic)}/${val(p.bp_diastolic)} · SpO2 ${val(p.spo2, '%')} · RR ${val(p.rr)} · T ${val(p.temperature, '°C')} · GCS ${val(p.gcs)}`,
    `History: ${val(p.relevant_history)}    Medications: ${val(p.current_medications)}    Allergies: ${val(p.allergies)}`,
  ];
  if (r.justification?.length) lines.push('', 'Clinical justification:', ...r.justification.map((j) => `- ${j}`));
  if (r.positives?.length) lines.push('', 'Positive findings:', ...r.positives.map((j) => `- ${j}`));
  if (r.answers?.length) lines.push('', 'Clarifying questions:', ...r.answers.map((a) => `- ${a.text_en || a.text_ar || a.field}: ${a.value_en || a.value}`));
  if (r.outstanding?.length) lines.push('', `Outstanding / not obtained: ${r.outstanding.join(', ')}`);
  if (r.safetyAlerts?.length) lines.push('', 'Safety alerts:', ...r.safetyAlerts.map((j) => `- ${j}`));
  lines.push('', `Triage nurse: ${r.nurse || '—'}`, 'Decision support only; CTAS confirmed by the triage nurse.');
  return lines.filter((l) => l !== null).join('\n');
}
