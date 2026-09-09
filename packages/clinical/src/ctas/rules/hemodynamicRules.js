/**
 * Hemodynamic primary modifier — Shock (1) / Compromise (2) / ULN-LLN (3).
 * Does not classify shock from heart rate alone.
 */

import { getNorms, PEDIATRIC_SD_HEMODYNAMIC_RULES } from '../ageNorms.js';

export const HEMODYNAMIC_RULES_META = {
  rule_set_id: 'hemodynamic_v1',
  ctas_version: 'CTAS 2025',
  version: '1.0.0',
  approval_status: 'configured',
  effective_date: '2026-08-05',
  clinical_source: 'CTAS Interactive Quick Look Booklet — Hemodynamic',
};

/** Configured adult shock / compromise thresholds (not LLM-invented). */
export const HEMODYNAMIC_THRESHOLDS = {
  adult_shock_sbp: 70,
  adult_hypotension_sbp: 90,
  adult_significant_tachycardia: 130,
  adult_borderline_tachycardia: 120,
  adult_bradycardia: 50,
};

/**
 * Classify tachycardia interpretation for explainability.
 */
export function classifyTachycardia({ vitals, flags, appearance, norms, isPediatric }) {
  const hr = vitals.hr;
  if (hr == null && !vitals.hr_qualitative_tachycardia) {
    return { class: 'none', explanation_en: 'No tachycardia documented' };
  }
  const high = norms?.HR?.high ?? 100;
  const elevated = (hr != null && hr > high) || !!vitals.hr_qualitative_tachycardia;
  if (!elevated) return { class: 'none', explanation_en: 'Heart rate within age norms' };

  if (appearance.shocked || flags.poor_perfusion && hr != null && hr > HEMODYNAMIC_THRESHOLDS.adult_significant_tachycardia) {
    return { class: 'shock', explanation_en: 'Tachycardia with shock / severe hypoperfusion features' };
  }
  if (flags.poor_perfusion || flags.postural_hypotension) {
    return { class: 'borderline_perfusion', explanation_en: 'Tachycardia with perfusion concern' };
  }
  if (flags.unexplained_tachycardia) {
    return { class: 'unexplained', explanation_en: 'Unexplained significant tachycardia' };
  }
  if (flags.expected_tachycardia || (vitals.temp != null && vitals.temp >= 38.0) || flags.crying) {
    return {
      class: 'expected',
      explanation_en: isPediatric
        ? 'Age-context tachycardia possibly expected with fever/crying — not automatically shock'
        : 'Tachycardia may be physiological response to fever/pain/anxiety — not automatically shock',
    };
  }
  return {
    class: 'unknown',
    explanation_en: 'Tachycardia present; unclear if expected vs unexplained — provider clarification may change CTAS',
    needs_clarification: true,
  };
}

/**
 * @returns {{ level: number|null, rule_id: string, tachycardia_class: object, explanation_en: string, explanation_ar: string, evidence: object, not_configured?: string|null }}
 */
export function evaluateHemodynamicModifier({
  vitals,
  flags,
  appearance,
  ageGroup,
  isPediatric,
  chronicityStable = false,
}) {
  const norms = getNorms(ageGroup);
  const sbp = vitals.sbp;
  const hr = vitals.hr;
  const spo2 = vitals.spo2;
  const gcs = vitals.gcs;
  const th = HEMODYNAMIC_THRESHOLDS;

  const tachy = classifyTachycardia({ vitals, flags, appearance, norms, isPediatric });

  // Chronic baseline unchanged — do not auto-upgrade on HR alone
  if (chronicityStable && tachy.class === 'expected') {
    return {
      level: null,
      rule_id: 'hemo_chronic_stable_no_upgrade',
      tachycardia_class: tachy,
      explanation_en: 'Chronic baseline abnormality unchanged — no automatic hemodynamic upgrade',
      explanation_ar: 'شذوذ مزمن دون تغير حاد — لا ترقية ديناميكية تلقائية',
      evidence: { chronicity: 'chronic_stable' },
      meta: HEMODYNAMIC_RULES_META,
    };
  }

  // Pediatric SD bands — not configured in tranche 1
  let pedSdNote = null;
  if (isPediatric && !PEDIATRIC_SD_HEMODYNAMIC_RULES) {
    pedSdNote = 'Unable to apply SD-based pediatric hemodynamic bands because the required validated rule is not configured.';
  }

  // ── Shock CTAS 1 ──
  const shockFeatures = [];
  if (sbp != null && sbp < th.adult_shock_sbp) shockFeatures.push(`SBP ${sbp} < ${th.adult_shock_sbp}`);
  if (appearance.shocked) shockFeatures.push('shocked_appearance');
  if (flags.septic_shock) shockFeatures.push('septic_shock');
  if (gcs != null && gcs <= 8) shockFeatures.push(`GCS ${gcs}`);
  if (spo2 != null && spo2 < 85) shockFeatures.push(`SpO2 ${spo2}`);
  if (isYesish(flags.weak_thready_pulse) || appearance.shocked) {
    // already covered
  }

  // Pediatric shock: poor perfusion + altered vitals / appearance
  if (isPediatric && flags.poor_perfusion && (appearance.shocked || (gcs != null && gcs < 15) || (sbp != null && sbp < norms.SBP.low))) {
    shockFeatures.push('pediatric_poor_perfusion_with_compromise');
  }

  if (shockFeatures.length && (sbp != null && sbp < th.adult_shock_sbp || appearance.shocked || flags.septic_shock || (gcs != null && gcs <= 8) || (isPediatric && flags.poor_perfusion && appearance.shocked))) {
    return {
      level: 1,
      rule_id: 'hemo_shock',
      tachycardia_class: tachy,
      explanation_en: `Hemodynamic shock → CTAS 1 (${shockFeatures.join('; ')}). Tachycardia class: ${tachy.class}.`,
      explanation_ar: `صدمة ديناميكية → CTAS 1. تصنيف تسرع القلب: ${tachy.class}.`,
      evidence: { shockFeatures, sbp, hr },
      not_configured: pedSdNote,
      meta: HEMODYNAMIC_RULES_META,
    };
  }

  // Adult SBP < 70 already handled; also treat severe hypoperfusion cues + hypotension
  if (!isPediatric && sbp != null && sbp < th.adult_shock_sbp) {
    return {
      level: 1,
      rule_id: 'hemo_shock_sbp',
      tachycardia_class: tachy,
      explanation_en: `SBP ${sbp} — critical shock → CTAS 1`,
      explanation_ar: `ضغط ${sbp} — صدمة حرجة → CTAS 1`,
      evidence: { sbp },
      meta: HEMODYNAMIC_RULES_META,
    };
  }

  // ── Compromise CTAS 2 ──
  const compromise = [];
  if (sbp != null && sbp < th.adult_hypotension_sbp) compromise.push(`hypotension SBP ${sbp}`);
  if (flags.postural_hypotension) compromise.push('postural_hypotension');
  if (flags.poor_perfusion) compromise.push('poor_perfusion');
  if (flags.unexplained_tachycardia) compromise.push('unexplained_tachycardia');
  // Significant tachycardia + hypotension combo (adult thresholds only)
  if (!isPediatric && hr != null && hr > th.adult_significant_tachycardia && sbp != null && sbp < 100) {
    compromise.push(`HR ${hr} with SBP ${sbp}`);
  }
  // Pediatric: HR well above age high + poor perfusion
  if (isPediatric && flags.poor_perfusion && hr != null && hr > norms.HR.high) {
    compromise.push('pediatric_tachycardia_with_poor_perfusion');
  }

  if (compromise.length) {
    return {
      level: 2,
      rule_id: 'hemo_compromise',
      tachycardia_class: tachy,
      explanation_en: `Hemodynamic compromise → CTAS 2 (${compromise.join('; ')}). Tachycardia: ${tachy.explanation_en}. Not shock: no severe end-organ hypoperfusion criteria met.`,
      explanation_ar: `اضطراب ديناميكي → CTAS 2. تسرع القلب: ${tachy.class}. ليست صدمة.`,
      evidence: { compromise, sbp, hr },
      not_configured: pedSdNote,
      meta: HEMODYNAMIC_RULES_META,
    };
  }

  // ── ULN / LLN CTAS 3 — clinically relevant abnormal vitals without 1/2 ──
  const uln = [];
  if (!isPediatric) {
    if (hr != null && (hr > th.adult_borderline_tachycardia || hr < th.adult_bradycardia)) {
      uln.push(`HR ${hr}`);
    } else if (hr != null && hr > norms.HR.high) {
      uln.push(`HR ${hr} above adult norm`);
    }
  } else if (hr != null && hr > norms.HR.high) {
    // Age-appropriate mild elevation → note only unless far above; without SD table stay at CTAS 3 max for vital alone
    if (hr > norms.HR.high * 1.15) uln.push(`HR ${hr} above age norm`);
  }
  if (sbp != null && sbp < norms.SBP.low && sbp >= th.adult_hypotension_sbp) {
    uln.push(`SBP ${sbp} below age low-normal`);
  }

  if (uln.length && !chronicityStable) {
    return {
      level: 3,
      rule_id: 'hemo_uln_lln',
      tachycardia_class: tachy,
      explanation_en: `Relevant vital-sign limits → CTAS 3 (${uln.join('; ')}). Tachycardia class: ${tachy.class}. ${tachy.explanation_en}. Not shock/compromise.`,
      explanation_ar: `حدود العلامات الحيوية → CTAS 3. تصنيف التسرع: ${tachy.class}.`,
      evidence: { uln, sbp, hr },
      not_configured: pedSdNote,
      missing_ctas_changing: tachy.needs_clarification ? ['unexplained_tachycardia'] : [],
      meta: HEMODYNAMIC_RULES_META,
    };
  }

  return {
    level: null,
    rule_id: 'hemo_no_modifier',
    tachycardia_class: tachy,
    explanation_en: `No hemodynamic CTAS floor. ${tachy.explanation_en}${pedSdNote ? ` ${pedSdNote}` : ''}`,
    explanation_ar: 'لا معدّل ديناميكي دموي',
    evidence: { sbp, hr },
    not_configured: pedSdNote,
    meta: HEMODYNAMIC_RULES_META,
  };
}

function isYesish(v) {
  return v === true;
}
