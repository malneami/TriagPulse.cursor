/**
 * Complaints and history for one triage, from the STT case details plus the nurse's
 * corrections (removed items, chosen primary complaint).
 *
 * Every complaint is scored by the CTAS engine with the same vitals; the most urgent
 * one is the primary complaint unless the nurse picks another. Chronic illnesses and
 * medicines are recorded and shown only: they do not change CTAS here.
 */
export const complaintId = (c) => c?.key || c?.text || '';

export function deriveCase(patient, { computeLiveCTAS, answers = {} } = {}) {
  const cd = patient?.case_details || null;
  const dismissedC = patient?.dismissed_complaints || [];
  const dismissedH = patient?.dismissed_conditions || [];

  const complaints = (cd?.complaints || [])
    .filter((c) => !dismissedC.includes(complaintId(c)))
    .map((c) => {
      let level = null;
      try {
        level = computeLiveCTAS
          ? computeLiveCTAS({ ...patient, chief_complaint: c.text, confirmed_complaint_key: c.key || null }, answers)?.level ?? null
          : null;
      } catch { level = null; }
      return { ...c, id: complaintId(c), level };
    });

  // Most urgent first; on a tie the complaint that is more urgent by default (e.g.
  // cardiac chest pain over vomiting), then the one mentioned first.
  const rank = (c) => [c.level ?? 9, Number(c.default_ctas) || 9];
  const mostUrgent = complaints.reduce((best, c) => {
    if (best == null) return c;
    const [l1, d1] = rank(c);
    const [l2, d2] = rank(best);
    return l1 < l2 || (l1 === l2 && d1 < d2) ? c : best;
  }, null);
  const chosen = patient?.primary_complaint ? complaints.find((c) => c.id === patient.primary_complaint) || null : null;
  const primary = chosen || mostUrgent;

  return {
    complaints,
    mostUrgent,
    primary,
    chosenByNurse: !!chosen,
    // The nurse kept a less urgent complaint as primary while a more urgent one is listed.
    primaryLessUrgent: !!(chosen && mostUrgent && (chosen.level ?? 9) > (mostUrgent.level ?? 9)),
    conditions: (cd?.conditions || []).filter((c) => !dismissedH.includes(c.id)),
    medications: cd?.medications || [],
    noKnownHistory: !!cd?.no_known_history,
    historyAsked: !!cd?.history_asked,
    llmRejected: cd?.llm_rejected || 0,
  };
}

const CLASS_LABEL = {
  anticoagulant: 'مميّع دم · anticoagulant',
  antiplatelet: 'مضاد صفائح · antiplatelet',
  insulin: 'إنسولين · insulin',
  oral_hypoglycaemic: 'سكري فموي · oral diabetes',
  immunosuppressant: 'مثبط مناعة · immunosuppressant',
  steroid: 'كورتيزون · steroid',
  beta_blocker: 'حاصر بيتا · beta-blocker',
  antiepileptic: 'مضاد صرع · antiepileptic',
};
export const drugClassLabel = (id) => CLASS_LABEL[id] || id;

/** Plain-text lines for the saved record and the printable document. */
export function caseSummaryLines(cc) {
  const lines = [];
  if (cc.complaints.length) {
    lines.push(`Complaints: ${cc.complaints.map((c) => `${c.label_en || c.text}${c.level ? ` (CTAS ${c.level})` : ''}${cc.primary?.id === c.id ? ' [primary]' : ''}`).join('; ')}`);
  }
  const present = cc.conditions.filter((c) => c.status === 'present');
  const probable = cc.conditions.filter((c) => c.status === 'probable');
  const absent = cc.conditions.filter((c) => c.status === 'absent');
  if (present.length || probable.length || absent.length || cc.noKnownHistory) {
    const parts = [
      ...present.map((c) => c.label_en),
      ...probable.map((c) => `${c.label_en} (probable, from medicine)`),
      ...absent.map((c) => `no ${c.label_en}`),
    ];
    lines.push(`Chronic illness: ${cc.noKnownHistory && !present.length ? 'none known' : parts.join('; ')}`);
  } else {
    lines.push('Chronic illness: not asked');
  }
  if (cc.medications.length) {
    lines.push(`Regular medicines: ${cc.medications.map((m) => `${m.name}${m.classes.length ? ` (${m.classes.join(', ')})` : ''}`).join('; ')}`);
  }
  return lines;
}

/** What the saved record keeps. */
export function casePayload(cc) {
  return {
    complaints: cc.complaints.map((c) => ({ key: c.key, text: c.text, label_en: c.label_en, ctas_level: c.level, source: c.source, evidence: c.evidence })),
    primary_complaint: cc.primary ? { key: cc.primary.key, text: cc.primary.text, ctas_level: cc.primary.level, chosen_by: cc.chosenByNurse ? 'nurse' : 'auto_most_urgent' } : null,
    most_urgent_complaint: cc.mostUrgent ? { key: cc.mostUrgent.key, text: cc.mostUrgent.text, ctas_level: cc.mostUrgent.level } : null,
    primary_less_urgent_than_listed: cc.primaryLessUrgent,
    conditions: cc.conditions.map((c) => ({ id: c.id, label_en: c.label_en, status: c.status, high_risk: c.high_risk, source: c.source, evidence: c.evidence })),
    medications: cc.medications.map((m) => ({ name: m.name, classes: m.classes, source: m.source })),
    no_known_history: cc.noKnownHistory,
    history_asked: cc.historyAsked,
  };
}
