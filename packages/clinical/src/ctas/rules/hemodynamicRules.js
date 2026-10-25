/**
 * Hemodynamic primary modifier — Shock (1) / Compromise (2) / ULN-LLN (3).
 * Does not classify shock from heart rate alone.
 */

import { getNorms, PEDIATRIC_SD_HEMODYNAMIC_RULES } from '../ageNorms.js';

export const HEMODYNAMIC_RULES_META = {
  rule_set_id: 'hemodynamic_v1',
  ctas_version: 'CTAS 2025',
  version: '1.3.0',
  approval_status: 'configured',
  effective_date: '2026-10-25',
  clinical_source: 'CTAS Interactive Quick Look Booklet — Hemodynamic; PaedCTAS bradycardia bands (Warren 2008); ED heart-rate centiles (O\'Leary 2015, local rule)',
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
 * Severe heart rate for age (approved 2026-10-16, rules T1–T4): a rate at or beyond these
 * limits is CTAS 2 even when blood pressure is normal, and CTAS 1 with hypotension, poor
 * perfusion / shock signs or altered mental state. Paediatric limits are rounded from the
 * Fleming 2011 99th centiles (awaiting clinical sign-off of the exact numbers).
 * The red-flag alert reads the same table, so the alert and the CTAS level always agree.
 */
export const SEVERE_HEART_RATE_BY_AGE = [
  { max_age_years: 0.25, label: '< 3 months', tachy: 190, brady: 90 },
  { max_age_years: 1, label: '3–12 months', tachy: 180, brady: 80 },
  { max_age_years: 3, label: '1–3 years', tachy: 160, brady: 70 },
  { max_age_years: 6, label: '3–6 years', tachy: 150, brady: 60 },
  { max_age_years: 12, label: '6–12 years', tachy: 140, brady: 55 },
  { max_age_years: 18, label: '12–18 years', tachy: 130, brady: 45 },
  { max_age_years: Infinity, label: 'adult', tachy: 130, brady: 40 },
];

/**
 * @param {number|string|null} hr
 * @param {number|string|null} age years (missing → adult limits)
 * @returns {{ kind: 'tachycardia'|'bradycardia', hr: number, limit: number, band: string } | null}
 */
export function severeHeartRate(hr, age) {
  const h = hr == null || hr === '' ? NaN : Number(hr);
  if (!Number.isFinite(h) || h <= 0) return null;
  const a = age == null || age === '' ? NaN : parseFloat(age);
  const band = SEVERE_HEART_RATE_BY_AGE.find((b) => (Number.isFinite(a) ? a < b.max_age_years : b.max_age_years === Infinity));
  if (h >= band.tachy) return { kind: 'tachycardia', hr: h, limit: band.tachy, band: band.label };
  if (h <= band.brady) return { kind: 'bradycardia', hr: h, limit: band.brady, band: band.label };
  return null;
}

/**
 * PaedCTAS heart-rate bands (approved 2026-10-25). Source: Warren et al., PaedCTAS
 * revision, CJEM 2008 (Table: heart rate by age, ±1 SD → CTAS 3, ±2 SD → CTAS 2,
 * beyond → CTAS 1). Local decisions: heart rate alone never gives CTAS 1 (capped at 2;
 * CTAS 1 needs shock, poor perfusion, hypotension for age or altered consciousness);
 * the 6-year row covers 3–6 y, the 10-year row covers 7–17 y; adult rules from 18 y.
 * A band edge belongs to the less urgent band (1–3 y: 130 normal, 145 is +1 SD).
 */
export const PAEDS_CTAS_HR_BANDS = [
  { max_age_years: 0.25, label: '0–3 months', normal: [90, 180], sd1: [65, 205], sd2: [40, 230] },
  { max_age_years: 0.5, label: '3–6 months', normal: [80, 160], sd1: [63, 180], sd2: [40, 210] },
  { max_age_years: 1, label: '6–12 months', normal: [80, 140], sd1: [60, 160], sd2: [40, 180] },
  { max_age_years: 3, label: '1–3 years', normal: [75, 130], sd1: [58, 145], sd2: [40, 165] },
  { max_age_years: 7, label: '3–6 years (6-year row)', normal: [70, 110], sd1: [55, 125], sd2: [40, 140] },
  { max_age_years: 18, label: '7–17 years (10-year row)', normal: [60, 90], sd1: [45, 105], sd2: [30, 120] },
];

/**
 * Fast heart rate in children: ED centiles (local HMG rule, approved 2026-10-25, option C).
 * O'Leary F et al., Arch Dis Child 2015 — 111,696 heart and breathing rates from a paediatric ED.
 * Above the 95th centile → CTAS 3 unless fever or a recorded cause explains it; above the
 * 99th → CTAS 2, never explained. 16–17 y use the 15-year limits (data stop at 16).
 * Slow heart rate keeps the PaedCTAS bands above.
 */
export const ED_HR_CENTILES = [
  { max_age_years: 0.25, label: '0–3 months', p95: 171, p99: 181 },
  { max_age_years: 0.5, label: '3–6 months', p95: 161, p99: 174 },
  { max_age_years: 0.75, label: '6–9 months', p95: 159, p99: 172 },
  { max_age_years: 1, label: '9–12 months', p95: 160, p99: 174 },
  { max_age_years: 1.5, label: '12–18 months', p95: 159, p99: 176 },
  { max_age_years: 2, label: '18–24 months', p95: 154, p99: 172 },
  { max_age_years: 3, label: '2–3 years', p95: 146, p99: 162 },
  { max_age_years: 4, label: '3–4 years', p95: 138, p99: 152 },
  { max_age_years: 6, label: '4–6 years', p95: 133, p99: 146 },
  { max_age_years: 8, label: '6–8 years', p95: 128, p99: 141 },
  { max_age_years: 12, label: '8–12 years', p95: 122, p99: 135 },
  { max_age_years: 15, label: '12–15 years', p95: 113, p99: 127 },
  { max_age_years: 18, label: '15–17 years', p95: 111, p99: 122 },
];

/** Adult heart-rate limits (CTAS hemodynamic modifier, approved T1–T3 and 2026-10-25). */
export const ADULT_HR_LIMITS = { normal_high: 100, never_explained: 130, low_ctas3: 50, low_ctas2: 40 };

/** Complaints where unexplained tachycardia is a cardiac finding → CTAS 2 + ECG. */
export const CARDIAC_TACHY_PATHWAYS = new Set([
  'chest_pain_cardiac', 'chest_pain_non_cardiac', 'palpitations', 'syncope', 'shortness_of_breath',
]);

const YES_RE = /^(نعم|yes|true|1)$/i;
const isYesAns = (v) => YES_RE.test(String(v ?? '').trim());

/** The documented reason for a fast heart rate, from the nurse's answers. */
export function tachycardiaReason(answers = {}) {
  const r = String(answers.tachycardia_reason ?? '').trim().toLowerCase();
  if (r) {
    if (/unexpl|غير\s*مفس|بدون\s*سبب/.test(r)) return 'unexplained';
    if (/fever|حمى|حرارة/.test(r)) return 'fever';
    if (/cry|بكاء/.test(r)) return 'crying';
    if (/pain|ألم|الم/.test(r)) return 'pain';
    if (/anx|fear|agitat|قلق|خوف|توتر/.test(r)) return 'anxiety';
  }
  if (isYesAns(answers.unexplained_tachycardia)) return 'unexplained';
  if (isYesAns(answers.tachycardia_from_fever)) return 'fever';
  if (isYesAns(answers.crying)) return 'crying';
  if (isYesAns(answers.expected_tachycardia)) return 'documented';
  return null;
}

const REASON_WORDS = {
  fever: { en: 'fever', ar: 'الحمى' },
  crying: { en: 'crying', ar: 'البكاء' },
  pain: { en: 'pain', ar: 'الألم' },
  anxiety: { en: 'anxiety', ar: 'القلق' },
  documented: { en: 'documented cause', ar: 'سبب موثق' },
};

/** The question asked when a fast heart rate has no documented reason. */
export const HR_REASON_QUESTION = {
  id: 'hr_reason',
  field: 'tachycardia_reason',
  text_ar: 'النبض أعلى من الطبيعي للعمر — ما السبب؟',
  text_en: 'Heart rate is above normal for age — what explains it?',
  answer_type: 'options',
  options: [
    { value: 'fever', label_ar: 'حمى', label_en: 'Fever' },
    { value: 'crying', label_ar: 'بكاء', label_en: 'Crying' },
    { value: 'pain', label_ar: 'ألم', label_en: 'Pain' },
    { value: 'anxiety', label_ar: 'قلق / خوف', label_en: 'Anxiety / fear' },
    { value: 'unexplained', label_ar: 'غير مفسَّر', label_en: 'Unexplained' },
  ],
  question_category: 'ctas_modifier',
  reason_en: 'An explained fast heart rate does not raise CTAS; an unexplained one does.',
  reason_ar: 'النبض السريع المفسَّر لا يرفع CTAS، وغير المفسَّر يرفعه.',
};

/** Re-count after settling, when crying is the reason (CTAS: take vitals when the child is quiet). */
export const HR_RECOUNT_QUESTION = {
  id: 'hr_recount',
  field: 'hr_recount',
  text_ar: 'أعد عدّ النبض بعد أن يهدأ الطفل — ما النتيجة؟',
  text_en: 'Re-count the heart rate once the child has settled — result?',
  answer_type: 'options',
  options: [
    { value: 'settled_normal', label_ar: 'طبيعي بعد الهدوء', label_en: 'Normal once settled' },
    { value: 'settled_high', label_ar: 'ما زال مرتفعاً', label_en: 'Still high when settled' },
    { value: 'not_settled', label_ar: 'لم يهدأ بعد', label_en: 'Not settled yet' },
  ],
  question_category: 'ctas_modifier',
  reason_en: 'Crying raises heart rate; a settled count decides whether it is explained.',
  reason_ar: 'البكاء يرفع النبض؛ العدّ بعد الهدوء يحدد إن كان مفسَّراً.',
};

/**
 * One heart-rate assessment, read by the CTAS level, the red-flag alert and the HR tile.
 * @returns {null | {
 *   hr: number, adult: boolean, row: string, direction: 'high'|'low'|null,
 *   band: 'normal'|'sd1'|'sd2'|'beyond', level: 2|3|null, explained: boolean,
 *   explanation: string|null, ceiling: boolean, alert: boolean, cardiac: boolean,
 *   needs_reason: boolean, needs_recount: boolean, display: 'normal'|'explained'|'abnormal'|'critical',
 *   rule_id: string, label_en: string, label_ar: string }}
 */
export function assessHeartRate({ hr, age, temp = null, answers = {}, pathway = '' } = {}) {
  const h = hr == null || hr === '' ? NaN : Number(hr);
  if (!Number.isFinite(h) || h < 20 || h > 250) return null;
  const a = age == null || age === '' ? NaN : parseFloat(age);
  const adult = !Number.isFinite(a) || a >= 18;
  const t = temp == null || temp === '' ? NaN : Number(temp);
  const febrile = Number.isFinite(t) && t >= 38.0;
  let reason = tachycardiaReason(answers);
  const recount = String(answers.hr_recount ?? '').trim();
  if (reason === 'crying' && recount === 'settled_high') reason = 'unexplained';
  const cardiac = CARDIAC_TACHY_PATHWAYS.has(String(pathway || ''));

  const base = {
    hr: h, adult, direction: null, band: 'normal', level: null, explained: false, explanation: null,
    ceiling: false, alert: false, cardiac, needs_reason: false, needs_recount: false, display: 'normal',
  };
  const explainWith = () => {
    if (reason === 'unexplained') return null;
    if (reason && reason !== 'unexplained') return reason;
    return febrile ? 'fever' : null;
  };

  if (adult) {
    const L = ADULT_HR_LIMITS;
    const row = 'adult';
    if (h <= L.low_ctas2) {
      return { ...base, row, direction: 'low', band: 'beyond', level: 2, alert: true, display: 'critical', rule_id: 'hr_adult_brady_severe',
        label_en: `HR ${h} — severe bradycardia (≤ ${L.low_ctas2})`, label_ar: `نبض ${h} — بطء شديد` };
    }
    if (h < L.low_ctas3) {
      return { ...base, row, direction: 'low', band: 'sd1', level: 3, display: 'abnormal', rule_id: 'hr_adult_brady',
        label_en: `HR ${h} — bradycardia (< ${L.low_ctas3})`, label_ar: `نبض ${h} — بطء` };
    }
    if (h <= L.normal_high) return { ...base, row, rule_id: 'hr_normal', label_en: `HR ${h} normal`, label_ar: `نبض ${h} طبيعي` };
    if (h >= L.never_explained) {
      return { ...base, row, direction: 'high', band: 'beyond', level: 2, ceiling: true, alert: true, display: 'critical', rule_id: 'hr_adult_severe',
        label_en: `HR ${h} ≥ ${L.never_explained} — severe tachycardia, never treated as explained`, label_ar: `نبض ${h} — تسرع شديد لا يُعدّ مفسَّراً` };
    }
    const why = explainWith();
    if (why) {
      const w = REASON_WORDS[why] || REASON_WORDS.documented;
      return { ...base, row, direction: 'high', band: 'sd1', explained: true, explanation: why, display: 'explained', rule_id: 'hr_adult_explained',
        label_en: `HR ${h} — tachycardia explained by ${w.en}; does not raise CTAS`, label_ar: `نبض ${h} — تسرع يفسره ${w.ar}؛ لا يرفع CTAS` };
    }
    if (reason === 'unexplained' || cardiac) {
      return { ...base, row, direction: 'high', band: 'sd2', level: 2, alert: true, display: 'critical', needs_reason: reason == null,
        rule_id: cardiac ? 'hr_adult_unexplained_cardiac' : 'hr_adult_unexplained',
        label_en: cardiac
          ? `HR ${h} — unexplained tachycardia with a cardiac complaint → CTAS 2, ECG now`
          : `HR ${h} — unexplained tachycardia (hemodynamic compromise) → CTAS 2`,
        label_ar: cardiac ? `نبض ${h} — تسرع غير مفسَّر مع شكوى قلبية → CTAS 2، تخطيط قلب فوراً` : `نبض ${h} — تسرع غير مفسَّر → CTAS 2` };
    }
    return { ...base, row, direction: 'high', band: 'sd1', level: 3, display: 'abnormal', needs_reason: true, rule_id: 'hr_adult_unanswered',
      label_en: `HR ${h} > ${L.normal_high} — cause not yet documented → CTAS 3 until answered`, label_ar: `نبض ${h} — السبب غير موثق بعد → CTAS 3` };
  }

  const b = PAEDS_CTAS_HR_BANDS.find((x) => a < x.max_age_years) || PAEDS_CTAS_HR_BANDS.at(-1);
  const row = b.label;
  if (h < b.normal[0]) {
    // Bradycardia is never explained. The stricter of PaedCTAS and the earlier severe limits wins.
    const sev = severeHeartRate(h, a);
    let band = h >= b.sd1[0] ? 'sd1' : h >= b.sd2[0] ? 'sd2' : 'beyond';
    let level = band === 'sd1' ? 3 : 2;
    if (sev && sev.kind === 'bradycardia') level = 2;
    return { ...base, row, direction: 'low', band, level, alert: level === 2, display: level === 2 ? 'critical' : 'abnormal',
      rule_id: level === 2 ? 'hr_paeds_brady_severe' : 'hr_paeds_brady',
      label_en: `HR ${h} — bradycardia for age (${row}, normal ${b.normal[0]}–${b.normal[1]}) → CTAS ${level}`,
      label_ar: `نبض ${h} — بطء للعمر → CTAS ${level}` };
  }
  const c = ED_HR_CENTILES.find((x) => a < x.max_age_years) || ED_HR_CENTILES.at(-1);
  const crow = `${c.label}: ED 95th ${c.p95}, 99th ${c.p99}`;
  if (h <= c.p95) return { ...base, row: crow, rule_id: 'hr_normal', label_en: `HR ${h} within ED range for age (${crow})`, label_ar: `نبض ${h} ضمن المدى للعمر` };
  if (h > c.p99) {
    return { ...base, row: crow, direction: 'high', band: 'beyond', level: 2, ceiling: true, alert: true, display: 'critical', rule_id: 'hr_paeds_beyond',
      label_en: `HR ${h} > ${c.p99} (99th centile, ${c.label}) — never treated as explained → CTAS 2`,
      label_ar: `نبض ${h} — فوق الشريحة 99 للعمر؛ لا يُعدّ مفسَّراً → CTAS 2` };
  }
  const why = explainWith();
  if (why) {
    const w = REASON_WORDS[why] || REASON_WORDS.documented;
    const needsRecount = why === 'crying' && recount !== 'settled_normal';
    return { ...base, row: crow, direction: 'high', band: 'p95', explained: true, explanation: why, display: 'explained', needs_recount: needsRecount,
      rule_id: 'hr_paeds_explained',
      label_en: `HR ${h} (above the 95th centile, ${c.label}) explained by ${w.en}; does not raise CTAS`,
      label_ar: `نبض ${h} يفسره ${w.ar}؛ لا يرفع CTAS` };
  }
  return { ...base, row: crow, direction: 'high', band: 'p95', level: 3, display: 'abnormal',
    needs_reason: reason == null, rule_id: 'hr_paeds_unexplained_p95',
    label_en: `HR ${h} — unexplained tachycardia, above the 95th centile for ${c.label} (${c.p95}) → CTAS 3`,
    label_ar: `نبض ${h} — تسرع غير مفسَّر فوق الشريحة 95 للعمر → CTAS 3` };
}

/** Hypotension for age: < 70 + 2×age (1–10 y), < 90 from 10 y, < 60 under 1 y. */
export function hypotensiveForAge(sbp, age) {
  if (sbp == null || sbp === '' || !Number.isFinite(Number(sbp))) return false;
  const s = Number(sbp);
  const a = age == null || age === '' ? NaN : parseFloat(age);
  if (!Number.isFinite(a) || a >= 10) return s < 90;
  if (a < 1) return s < 60;
  return s < 70 + 2 * a;
}

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
 * @returns {{ level: number|null, rule_id: string, tachycardia_class: object, heart_rate: object|null, explanation_en: string, explanation_ar: string, evidence: object, not_configured?: string|null }}
 */
export function evaluateHemodynamicModifier({
  vitals,
  flags,
  appearance,
  ageGroup,
  isPediatric,
  chronicityStable = false,
  age = null,
  answers = {},
  pathway = '',
}) {
  const norms = getNorms(ageGroup);
  const sbp = vitals.sbp;
  const hr = vitals.hr;
  const spo2 = vitals.spo2;
  const gcs = vitals.gcs;
  const th = HEMODYNAMIC_THRESHOLDS;

  const tachy = classifyTachycardia({ vitals, flags, appearance, norms, isPediatric });
  const hrA = assessHeartRate({ hr, age, temp: vitals.temp, answers, pathway });
  // Hypotension: adult < 90; children by age (< 60 under 1 y, < 70 + 2×age to 10 y, < 90 after).
  const hypotensive = isPediatric ? hypotensiveForAge(sbp, age) : (sbp != null && sbp < th.adult_hypotension_sbp);
  const meta = HEMODYNAMIC_RULES_META;
  const out = (o) => ({ tachycardia_class: tachy, heart_rate: hrA, meta, ...o });

  // Chronic baseline unchanged — a CTAS 3 heart rate is not an upgrade; CTAS 2 rates still count.
  const hrLevel = (chronicityStable && hrA?.level === 3) ? null : (hrA?.level ?? null);

  // Pediatric SD bands for blood pressure — not configured in tranche 1 (heart rate uses PaedCTAS).
  let pedSdNote = null;
  if (isPediatric && !PEDIATRIC_SD_HEMODYNAMIC_RULES) {
    pedSdNote = 'Blood-pressure SD bands are not configured; hypotension for age uses < 70 + 2×age.';
  }

  // ── Shock CTAS 1 ──
  const shockFeatures = [];
  if (!isPediatric && sbp != null && sbp < th.adult_shock_sbp) shockFeatures.push(`SBP ${sbp} < ${th.adult_shock_sbp}`);
  if (appearance.shocked) shockFeatures.push('shocked_appearance');
  if (flags.septic_shock) shockFeatures.push('septic_shock');
  if (gcs != null && gcs <= 8) shockFeatures.push(`GCS ${gcs}`);
  if (spo2 != null && spo2 < 85) shockFeatures.push(`SpO2 ${spo2}`);
  // Pediatric shock: poor perfusion with hypotension for age, altered consciousness or shocked look
  // Children: low blood pressure for age is decompensated shock → CTAS 1 (approved 2026-10-25).
  if (isPediatric && hypotensive) shockFeatures.push(`SBP ${sbp} hypotension for age`);
  if (isPediatric && flags.poor_perfusion && (appearance.shocked || (gcs != null && gcs < 15) || hypotensive)) {
    shockFeatures.push('pediatric_poor_perfusion_with_compromise');
  }
  const pedShock = isPediatric && flags.poor_perfusion && (appearance.shocked || (gcs != null && gcs < 15) || hypotensive);
  if (shockFeatures.length && ((!isPediatric && sbp != null && sbp < th.adult_shock_sbp) || appearance.shocked || flags.septic_shock || (gcs != null && gcs <= 8) || pedShock || (isPediatric && hypotensive))) {
    return out({
      level: 1,
      rule_id: 'hemo_shock',
      explanation_en: `Hemodynamic shock → CTAS 1 (${shockFeatures.join('; ')}).`,
      explanation_ar: 'صدمة ديناميكية → CTAS 1',
      evidence: { shockFeatures, sbp, hr },
      not_configured: pedSdNote,
    });
  }

  // ── Heart rate CTAS 2 (PaedCTAS +2 SD or beyond, adult ≥ 130, unexplained / cardiac) ──
  // Heart rate alone never gives CTAS 1: only with hypotension, poor perfusion, shock signs or GCS < 15.
  if (hrLevel === 2) {
    const unstable = [];
    if (hypotensive) unstable.push(`SBP ${sbp}`);
    if (flags.poor_perfusion) unstable.push('poor perfusion');
    if (appearance.shocked) unstable.push('shock signs');
    if (gcs != null && gcs < 15) unstable.push(`GCS ${gcs}`);
    if (unstable.length) {
      return out({
        level: 1,
        rule_id: 'hemo_severe_rate_unstable',
        explanation_en: `${hrA.label_en}, with ${unstable.join(', ')} → CTAS 1.`,
        explanation_ar: `${hrA.label_ar} مع عدم استقرار → CTAS 1`,
        evidence: { heart_rate: hrA, unstable, sbp, hr },
      });
    }
    return out({
      level: 2,
      rule_id: hrA.rule_id === 'hr_adult_severe' || hrA.rule_id === 'hr_paeds_beyond' || hrA.rule_id.startsWith('hr_paeds_brady') || hrA.rule_id === 'hr_adult_brady_severe'
        ? 'hemo_severe_rate' : 'hemo_unexplained_tachycardia',
      explanation_en: `${hrA.label_en}. Needs monitor and ECG now, even with normal blood pressure.`,
      explanation_ar: `${hrA.label_ar} (مراقبة وتخطيط قلب فوراً)`,
      evidence: { heart_rate: hrA, sbp, hr },
    });
  }

  // ── Compromise CTAS 2 ──
  const compromise = [];
  if (hypotensive) compromise.push(`hypotension for age SBP ${sbp}`);
  if (flags.postural_hypotension) compromise.push('postural_hypotension');
  if (flags.poor_perfusion) compromise.push('poor_perfusion');
  // A measured rate is judged by the heart-rate table above; the answer counts alone only without one.
  if (flags.unexplained_tachycardia && hr == null) compromise.push('unexplained_tachycardia');
  if (!isPediatric && hr != null && hr > th.adult_significant_tachycardia && sbp != null && sbp < 100) {
    compromise.push(`HR ${hr} with SBP ${sbp}`);
  }

  if (compromise.length) {
    return out({
      level: 2,
      rule_id: 'hemo_compromise',
      explanation_en: `Hemodynamic compromise → CTAS 2 (${compromise.join('; ')}). Not shock: no severe end-organ hypoperfusion criteria met.`,
      explanation_ar: 'اضطراب ديناميكي → CTAS 2. ليست صدمة.',
      evidence: { compromise, sbp, hr },
      not_configured: pedSdNote,
    });
  }

  // ── CTAS 3 — heart rate +1 SD / adult unanswered, or BP below low-normal ──
  const uln = [];
  if (hrLevel === 3) uln.push(hrA.label_en);
  if (sbp != null && sbp < norms.SBP.low && !hypotensive && !chronicityStable) {
    uln.push(`SBP ${sbp} below age low-normal`);
  }

  if (uln.length) {
    return out({
      level: 3,
      rule_id: 'hemo_uln_lln',
      explanation_en: `Relevant vital-sign limits → CTAS 3 (${uln.join('; ')}). Not shock/compromise.`,
      explanation_ar: `حدود العلامات الحيوية → CTAS 3${hrLevel === 3 ? ` (${hrA.label_ar})` : ''}`,
      evidence: { uln, sbp, hr, heart_rate: hrA },
      not_configured: pedSdNote,
      missing_ctas_changing: hrA?.needs_reason ? ['tachycardia_reason'] : [],
    });
  }

  const quiet = chronicityStable && hrA?.level === 3
    ? 'Chronic baseline abnormality unchanged — no automatic hemodynamic upgrade.'
    : (hrA?.explained ? hrA.label_en : tachy.explanation_en);
  return out({
    level: null,
    rule_id: chronicityStable && hrA?.level === 3 ? 'hemo_chronic_stable_no_upgrade' : 'hemo_no_modifier',
    explanation_en: `No hemodynamic CTAS floor. ${quiet}`,
    explanation_ar: hrA?.explained ? hrA.label_ar : 'لا معدّل ديناميكي دموي',
    evidence: { sbp, hr, heart_rate: hrA },
    not_configured: pedSdNote,
  });
}

function isYesish(v) {
  return v === true;
}
