/**
 * Adult / geriatric CTAS fever + SIRS rules (configurable data).
 * Pulse and heart rate are one SIRS parameter. Missing WBC is unknown, never abnormal.
 */

export const ADULT_FEVER_RULES_META = {
  rule_set_id: 'adult_fever_sirs_v1',
  ctas_version: 'CTAS 2025',
  applicability: 'adult_geriatric',
  version: '1.0.0',
  approval_status: 'configured',
  effective_date: '2026-08-05',
  clinical_source: 'CTAS Interactive Quick Look Booklet — Fever / SIRS / Hemodynamic',
};

/** Adult SIRS thresholds (configured). */
export const ADULT_SIRS_THRESHOLDS = {
  temperature_high_c: 38.0,
  temperature_low_c: 36.0,
  heart_rate_high: 90,
  respiratory_rate_high: 20,
  wbc_high: 12,
  wbc_low: 4,
};

/**
 * Evaluate each SIRS criterion once.
 * @returns {{
 *   criteria: Record<string, 'present'|'absent'|'unknown'>,
 *   known_positive_count: number,
 *   known_negative_count: number,
 *   unknown_count: number,
 *   details: Array<object>,
 * }}
 */
export function evaluateSirsCriteria({ vitals, ageGroup, isPediatric }) {
  const t = ADULT_SIRS_THRESHOLDS;
  // Pediatric SIRS numeric adult cutoffs must not be applied — use age norms via caller for ped fever bands instead.
  if (isPediatric) {
    return {
      criteria: {
        temperature: 'unknown',
        heart_rate: 'unknown',
        respiratory_rate: 'unknown',
        wbc: 'unknown',
      },
      known_positive_count: 0,
      known_negative_count: 0,
      unknown_count: 4,
      details: [{
        rule_id: 'sirs_adult_not_applicable_pediatric',
        note: 'Adult SIRS thresholds not applied to pediatric patients',
      }],
      not_applicable: true,
    };
  }

  const criteria = {};
  const details = [];

  // 1. Temperature (fever ≡ temp — one parameter)
  if (vitals.temp == null && !vitals.temp_qualitative_fever) {
    criteria.temperature = 'unknown';
    details.push({ criterion: 'temperature', status: 'unknown' });
  } else if (vitals.temp != null) {
    const abnormal = vitals.temp >= t.temperature_high_c || vitals.temp <= t.temperature_low_c;
    criteria.temperature = abnormal ? 'present' : 'absent';
    details.push({ criterion: 'temperature', status: criteria.temperature, value: vitals.temp });
  } else {
    criteria.temperature = 'present';
    details.push({ criterion: 'temperature', status: 'present', value: 'qualitative_fever' });
  }

  // 2. Heart rate (pulse ≡ HR — one parameter; never double-count tachycardia)
  if (vitals.hr == null && !vitals.hr_qualitative_tachycardia) {
    criteria.heart_rate = 'unknown';
    details.push({ criterion: 'heart_rate', status: 'unknown' });
  } else if (vitals.hr != null) {
    const abnormal = vitals.hr > t.heart_rate_high;
    criteria.heart_rate = abnormal ? 'present' : 'absent';
    details.push({ criterion: 'heart_rate', status: criteria.heart_rate, value: vitals.hr, note: 'pulse_and_hr_single_parameter' });
  } else {
    criteria.heart_rate = 'present';
    details.push({ criterion: 'heart_rate', status: 'present', value: 'qualitative_tachycardia', note: 'pulse_and_hr_single_parameter' });
  }

  // 3. Respiratory rate — do not infer abnormality without value or clear finding
  if (vitals.rr == null && !vitals.rr_qualitative_tachypnea) {
    criteria.respiratory_rate = 'unknown';
    details.push({ criterion: 'respiratory_rate', status: 'unknown' });
  } else if (vitals.rr != null) {
    const abnormal = vitals.rr > t.respiratory_rate_high;
    criteria.respiratory_rate = abnormal ? 'present' : 'absent';
    details.push({ criterion: 'respiratory_rate', status: criteria.respiratory_rate, value: vitals.rr });
  } else {
    criteria.respiratory_rate = 'present';
    details.push({ criterion: 'respiratory_rate', status: 'present', value: 'qualitative_tachypnea' });
  }

  // 4. WBC — missing = unknown, never assumed abnormal
  if (vitals.wbc == null) {
    criteria.wbc = 'unknown';
    details.push({ criterion: 'wbc', status: 'unknown', note: 'lab_unavailable_at_arrival' });
  } else {
    const abnormal = vitals.wbc > t.wbc_high || vitals.wbc < t.wbc_low;
    criteria.wbc = abnormal ? 'present' : 'absent';
    details.push({ criterion: 'wbc', status: criteria.wbc, value: vitals.wbc });
  }

  const known_positive_count = Object.values(criteria).filter((s) => s === 'present').length;
  const known_negative_count = Object.values(criteria).filter((s) => s === 'absent').length;
  const unknown_count = Object.values(criteria).filter((s) => s === 'unknown').length;

  return {
    criteria,
    known_positive_count,
    known_negative_count,
    unknown_count,
    details,
    not_applicable: false,
    age_group: ageGroup,
  };
}

/**
 * Adult fever primary modifier — never CTAS 1 from fever+tachycardia alone.
 * CTAS 1 only via separate shock/hypoperfusion evidence (passed in).
 *
 * @returns {{ level: number|null, rule_id: string, explanation_en: string, explanation_ar: string, evidence: object, candidates_rejected: object }}
 */
export function evaluateAdultFeverModifier({
  vitals,
  appearance,
  flags,
  sirs,
  hemodynamic,
  hasFeverContext,
}) {
  const temp = vitals.temp;
  const febrile = (temp != null && temp >= 38.0)
    || !!vitals.temp_qualitative_fever
    || hasFeverContext;

  if (!febrile && !hasFeverContext) {
    return {
      level: null,
      rule_id: 'fever_not_applicable',
      explanation_en: 'No fever context — fever modifier not applied',
      explanation_ar: 'لا توجد حمى — لم يُطبّق معدّل الحمى',
      evidence: { febrile: false },
      candidates_rejected: {},
    };
  }

  const looksUnwell = appearance.looks_unwell === true;
  const looksWell = appearance.looks_well === true || appearance.looks_unwell === false;
  const knownSirs = sirs?.known_positive_count ?? 0;
  const hemoLevel = hemodynamic?.level ?? null;
  const shock = hemoLevel === 1 || appearance.shocked === true || flags.septic_shock;
  const compromise = hemoLevel === 2 || flags.poor_perfusion;
  const immuno = !!flags.immunocompromised;
  const modRd = !!flags.moderate_respiratory_distress;
  const ams = !!flags.altered_loc;

  const rejected = {
    ctas_1: null,
    ctas_2: null,
  };

  // CTAS 1 — shock / severe end-organ hypoperfusion only
  if (shock) {
    return {
      level: 1,
      rule_id: 'fever_septic_shock',
      explanation_en: 'Fever with shock / severe end-organ hypoperfusion → CTAS 1',
      explanation_ar: 'حمى مع صدمة / نقص تروية شديد → CTAS 1',
      evidence: { febrile: true, shock: true, sirs },
      candidates_rejected: rejected,
      meta: ADULT_FEVER_RULES_META,
    };
  }
  rejected.ctas_1 = 'No evidence of shock or severe end-organ hypoperfusion; fever + tachycardia alone is not CTAS 1';

  // CTAS 2
  const ctas2Reasons = [];
  if (immuno) ctas2Reasons.push('immunocompromised_with_fever');
  if (knownSirs >= 3) ctas2Reasons.push(`sirs_known_${knownSirs}`);
  if (compromise) ctas2Reasons.push('hemodynamic_compromise');
  if (modRd) ctas2Reasons.push('moderate_respiratory_distress');
  if (ams) ctas2Reasons.push('altered_loc');

  if (ctas2Reasons.length) {
    return {
      level: 2,
      rule_id: 'fever_ctas_2',
      explanation_en: `Fever CTAS 2 because: ${ctas2Reasons.join(', ')}. Known SIRS=${knownSirs}.`,
      explanation_ar: `حمى CTAS 2 بسبب: ${ctas2Reasons.join('، ')}. معايير SIRS المعروفة=${knownSirs}.`,
      evidence: { febrile: true, sirs, reasons: ctas2Reasons },
      candidates_rejected: rejected,
      meta: ADULT_FEVER_RULES_META,
    };
  }
  rejected.ctas_2 = `Fewer than 3 known SIRS (${knownSirs}), not immunocompromised, no hemodynamic compromise, no moderate respiratory distress, no altered LOC`;

  // CTAS 3 — unwell and/or <3 SIRS without 1/2 findings
  if (looksUnwell || (knownSirs >= 1 && knownSirs < 3 && !looksWell)) {
    return {
      level: 3,
      rule_id: 'fever_ctas_3_unwell_or_partial_sirs',
      explanation_en: `Proposed fever modifier CTAS 3: appears unwell and/or ${knownSirs} known SIRS criteria (<3). CTAS 1 not supported: ${rejected.ctas_1}. CTAS 2 not supported: ${rejected.ctas_2}.`,
      explanation_ar: `معدّل الحمى CTAS 3: يبدو معتلاً و/أو ${knownSirs} من معايير SIRS المعروفة (<3). CTAS 1 غير مدعوم. CTAS 2 غير مدعوم.`,
      evidence: { febrile: true, looks_unwell: looksUnwell, sirs },
      candidates_rejected: rejected,
      meta: ADULT_FEVER_RULES_META,
    };
  }

  // CTAS 4 — fever only / looks well
  if (looksWell || knownSirs <= 1) {
    return {
      level: 4,
      rule_id: 'fever_ctas_4_looks_well',
      explanation_en: `Fever modifier CTAS 4: looks well / fever as limited SIRS (known=${knownSirs}). ${rejected.ctas_1}. ${rejected.ctas_2}.`,
      explanation_ar: `معدّل الحمى CTAS 4: يبدو جيداً / حمى محدودة (SIRS معروف=${knownSirs}).`,
      evidence: { febrile: true, looks_well: true, sirs },
      candidates_rejected: rejected,
      meta: ADULT_FEVER_RULES_META,
    };
  }

  // Unknown appearance with some SIRS → CTAS 3 conservative clinical floor for fever pathway
  return {
    level: 3,
    rule_id: 'fever_ctas_3_uncertain_appearance',
    explanation_en: `Fever with ${knownSirs} known SIRS; appearance uncertain → CTAS 3 pending clarification. ${rejected.ctas_1}. ${rejected.ctas_2}.`,
    explanation_ar: `حمى مع ${knownSirs} SIRS؛ المظهر غير مؤكد → CTAS 3 بانتظار التوضيح.`,
    evidence: { febrile: true, sirs, appearance_uncertain: true },
    candidates_rejected: rejected,
    missing_ctas_changing: ['looks_unwell'],
    meta: ADULT_FEVER_RULES_META,
  };
}
