/**
 * Breathing rate in children (approved by the clinical lead, 2026-10-25).
 *
 * Fast breathing:
 *   under 1 year      ≥ 50 → CTAS 3, ≥ 60 → CTAS 2 (WHO fast breathing / NICE NG254 2025)
 *   1 year – 17 years above the ED 95th centile → CTAS 3, above the 99th → CTAS 2
 *                     (O'Leary F et al., Arch Dis Child 2015; 16–17 y use the 15-year limits)
 * Fever never explains fast breathing (Heal 2022: no independent effect of temperature on
 * breathing rate; persistent tachypnoea predicts pneumonia). Crying: the level stands until a
 * settled re-count ("normal once settled" removes it).
 * Slow breathing: PaedCTAS bands (Warren 2008), rows as for heart rate.
 * Breathing rate alone never gives CTAS 1 (capped at 2); CTAS 1 needs SpO₂ < 90 or severe
 * distress, which other rules score. Adults (≥ 18 y) are not assessed here.
 */

export const RR_RULES_META = {
  rule_set_id: 'respiratory_rate_paeds_v1',
  version: '1.0.0',
  effective_date: '2026-10-25',
  approval_status: 'approved',
  clinical_source: "WHO/NICE NG254 under 1 y; ED centiles (O'Leary 2015) from 1 y; PaedCTAS bradypnoea bands",
};

/** Under 1 year: fixed cut-offs (≥). */
export const INFANT_RR_LIMITS = { ctas3: 50, ctas2: 60 };

/** From 1 year: ED centiles (strictly above). */
export const ED_RR_CENTILES = [
  { max_age_years: 1.5, label: '12–18 months', p95: 36, p99: 42 },
  { max_age_years: 2, label: '18–24 months', p95: 34, p99: 40 },
  { max_age_years: 3, label: '2–3 years', p95: 32, p99: 38 },
  { max_age_years: 4, label: '3–4 years', p95: 30, p99: 34 },
  { max_age_years: 6, label: '4–6 years', p95: 28, p99: 32 },
  { max_age_years: 8, label: '6–8 years', p95: 28, p99: 31 },
  { max_age_years: 12, label: '8–12 years', p95: 26, p99: 29 },
  { max_age_years: 15, label: '12–15 years', p95: 24, p99: 28 },
  { max_age_years: 18, label: '15–17 years', p95: 24, p99: 28 },
];

/** PaedCTAS slow-breathing bands: below `normal_low` → 3, below `sd1_low` → 2, below `sd2_low` → 2 (capped). */
export const PAEDS_CTAS_RR_LOW = [
  { max_age_years: 0.5, label: '0–6 months', normal_low: 30, sd1_low: 20, sd2_low: 10 },
  { max_age_years: 1, label: '6–12 months', normal_low: 25, sd1_low: 17, sd2_low: 10 },
  { max_age_years: 3, label: '1–3 years', normal_low: 20, sd1_low: 15, sd2_low: 10 },
  { max_age_years: 7, label: '3–6 years (6-year row)', normal_low: 16, sd1_low: 12, sd2_low: 8 },
  { max_age_years: 18, label: '7–17 years (10-year row)', normal_low: 14, sd1_low: 10, sd2_low: 8 },
];

const YES_RE = /^(نعم|yes|true|1)$/i;

export const RR_RECOUNT_QUESTION = {
  id: 'rr_recount',
  field: 'rr_recount',
  text_ar: 'أعد عدّ التنفس بعد أن يهدأ الطفل — ما النتيجة؟',
  text_en: 'Re-count the breathing rate once the child has settled — result?',
  answer_type: 'options',
  options: [
    { value: 'settled_normal', label_ar: 'طبيعي بعد الهدوء', label_en: 'Normal once settled' },
    { value: 'settled_high', label_ar: 'ما زال مرتفعاً', label_en: 'Still high when settled' },
    { value: 'not_settled', label_ar: 'لم يهدأ بعد', label_en: 'Not settled yet' },
  ],
  question_category: 'ctas_modifier',
  reason_en: 'Crying raises breathing rate; a settled count decides the level.',
  reason_ar: 'البكاء يرفع التنفس؛ العدّ بعد الهدوء يحدد المستوى.',
};

function cryingRecorded(answers = {}) {
  const r = String(answers.tachycardia_reason ?? '').toLowerCase();
  return /cry|بكاء/.test(r) || YES_RE.test(String(answers.crying ?? '').trim());
}

/**
 * One breathing-rate assessment for children, read by the CTAS level, the red-flag alert and the RR tile.
 * @returns {null | { rr: number, row: string, direction: 'high'|'low'|null, level: 2|3|null, alert: boolean,
 *   needs_recount: boolean, display: 'normal'|'abnormal'|'critical', rule_id: string, label_en: string, label_ar: string }}
 */
export function assessRespiratoryRate({ rr, age, answers = {} } = {}) {
  const r = rr == null || rr === '' ? NaN : Number(rr);
  if (!Number.isFinite(r) || r < 4 || r > 120) return null;
  const a = age == null || age === '' ? NaN : parseFloat(age);
  if (!Number.isFinite(a) || a >= 18) return null; // adults: existing adult rule
  const base = { rr: r, direction: null, level: null, alert: false, needs_recount: false, display: 'normal' };

  const low = PAEDS_CTAS_RR_LOW.find((x) => a < x.max_age_years) || PAEDS_CTAS_RR_LOW.at(-1);
  if (r < low.normal_low) {
    const level = r >= low.sd1_low ? 3 : 2;
    return { ...base, row: low.label, direction: 'low', level, alert: level === 2, display: level === 2 ? 'critical' : 'abnormal',
      rule_id: level === 2 ? 'rr_paeds_slow_severe' : 'rr_paeds_slow',
      label_en: `RR ${r} — slow breathing for age (${low.label}, below ${low.normal_low}) → CTAS ${level}`,
      label_ar: `تنفس ${r} — بطء تنفس للعمر → CTAS ${level}` };
  }

  let row; let level = null; let limitText = '';
  if (a < 1) {
    row = 'under 1 year';
    if (r >= INFANT_RR_LIMITS.ctas2) { level = 2; limitText = `≥ ${INFANT_RR_LIMITS.ctas2}`; }
    else if (r >= INFANT_RR_LIMITS.ctas3) { level = 3; limitText = `≥ ${INFANT_RR_LIMITS.ctas3}`; }
  } else {
    const c = ED_RR_CENTILES.find((x) => a < x.max_age_years) || ED_RR_CENTILES.at(-1);
    row = `${c.label}: ED 95th ${c.p95}, 99th ${c.p99}`;
    if (r > c.p99) { level = 2; limitText = `> ${c.p99} (99th centile)`; }
    else if (r > c.p95) { level = 3; limitText = `> ${c.p95} (95th centile)`; }
  }
  if (level == null) {
    return { ...base, row, rule_id: 'rr_normal', label_en: `RR ${r} within range for age (${row})`, label_ar: `تنفس ${r} ضمن المدى للعمر` };
  }

  const recount = String(answers.rr_recount ?? '').trim();
  const crying = cryingRecorded(answers);
  if (crying && recount === 'settled_normal') {
    return { ...base, row, rule_id: 'rr_settled_normal', label_en: `RR ${r} while crying; normal once settled`, label_ar: `تنفس ${r} أثناء البكاء؛ طبيعي بعد الهدوء` };
  }
  return { ...base, row, direction: 'high', level, alert: level === 2, display: level === 2 ? 'critical' : 'abnormal',
    needs_recount: crying && recount !== 'settled_high',
    rule_id: level === 2 ? 'rr_paeds_fast_severe' : 'rr_paeds_fast',
    label_en: `RR ${r} ${limitText} for ${row.split(':')[0]} → CTAS ${level}${crying ? ' (re-count when settled)' : ''}`,
    label_ar: `تنفس ${r} — تسرع تنفس للعمر → CTAS ${level}` };
}
