import { getRedFlagLibrary } from '../libraries/runtime';
// @ts-ignore — plain JS module
import { detectKnownModifier } from '../ctas/modifierEngine.js';
// @ts-ignore — plain JS module
import { getActiveModifiers } from '../ctas/modifierLibrary.js';
// @ts-ignore — plain JS module
import { assessHeartRate } from '../ctas/rules/hemodynamicRules.js';
import { assessSpo2AgainstBaseline, parseBaselineSpo2 } from '../ctas/ctasRulesEngine.js';
import { assessRespiratoryRate } from '../ctas/rules/respiratoryRateRules.js';

const YES_RE = /^(نعم|yes|true|1)$/i;
const NO_RE = /^(لا|no|false|0)$/i;
/** Complaints where unexplained tachycardia is a cardiac finding (same set as the CTAS rule). */
const CARDIAC_TEXT = /chest\s+pain|palpitat\w*|syncop\w*|faint\w*|short(?:ness)?\s+of\s+breath|breathless\w*|dyspn\w*|ألم\s*(?:في\s*)?(?:ال)?صدر|خفقان|إغماء|اغماء|ضيق\s*(?:في\s*)?(?:ال)?تنفس/i;
const SHOCK_SIGNS = /\bshock\b|clammy|mottl\w*|cold\s+(?:peripher\w*|extremit\w*|hands|feet|skin)|pale\s+and\s+(?:sweaty|cold|clammy)|poor\s+perfusion|delayed\s+cap\w*|صدمة|برودة\s*(?:في\s*)?الأطراف|بارد(?:ة)?\s*الأطراف|أطرافه?\s*بارد|شاحب\w*\s+و\s*(?:متعرق|بارد)|مزرق\s*الأطراف|تعرق\s*بارد|عرق\s*بارد/i;

/** Hypotension for age: < 70 + 2×age (1–10 y), < 90 from 10 y, < 60 under 1 y. */
function hypotensiveForAge(sbp: number | null, age: number | null): boolean {
  if (sbp === null) return false;
  if (age === null || age >= 10) return sbp < 90;
  if (age < 1) return sbp < 60;
  return sbp < 70 + 2 * age;
}

/** Uncontrolled bleeding as the CTAS engine reads it (stated, not denied; nurse's answer wins). */
function bleedingStated(text: string, answers: Record<string, unknown>): boolean | null {
  const a = String(answers?.uncontrolled_bleeding ?? '').trim();
  if (YES_RE.test(a)) return true;
  if (NO_RE.test(a)) return false;
  const mod = (getActiveModifiers() as Array<{ field: string }>).find((m) => m.field === 'uncontrolled_bleeding');
  if (!mod) return null;
  const r = detectKnownModifier(mod, { patient: {}, answers: {}, transcript: text }) as { known?: boolean; value?: string };
  if (r.known && r.value === 'نعم') return true;
  if (r.known && r.value === 'لا') return false;
  return null;
}

export interface RedFlagSymptom {
  ar: string;
  en: string;
}

export interface RedFlagResult {
  ctas_level: number;
  symptoms: RedFlagSymptom[];
  action: string;
  source: string;
  triggered_at: string;
}

function toNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Same finished-vital windows as the CTAS engine / save validation.
 * Prefixes typed on the way to a real value (HR 1→120, SBP 12→120, SpO₂ 9→98,
 * GCS 1→15) sit outside these ranges and must not raise a critical alert.
 */
function toVital(value: unknown, min: number, max: number): number | null {
  const n = toNumber(value);
  if (n === null || n < min || n > max) return null;
  return n;
}

function textHas(text: string, terms: string[]): boolean {
  const t = String(text || '').toLowerCase();
  return terms.some((term) => t.includes(term.toLowerCase()));
}

export function detectRedFlags(
  patient: Record<string, unknown> = {},
  answers: Record<string, unknown> = {},
): RedFlagResult | null {
  const lib = getRedFlagLibrary();
  const th = lib.thresholds;
  const symptoms: RedFlagSymptom[] = [];
  const complaintText = [patient.chief_complaint, patient.transcription, answers?.notes]
    .filter(Boolean)
    .join(' ');
  const spo2 = toVital(patient.spo2, 40, 100);
  const gcs = toVital(patient.gcs, 3, 15);
  const sbp = toVital(patient.bp_systolic, 40, 300);
  const hr = toVital(patient.hr, 20, 250);
  const rr = toVital(patient.rr, 4, 120);
  const pain = toNumber(patient.pain_score);
  let ctasLevel: number | null = null;

  const add = (level: number, ar: string, en: string) => {
    symptoms.push({ ar, en });
    ctasLevel = ctasLevel === null ? level : Math.min(ctasLevel, level);
  };

  // Known usual SpO₂ (local HMG rule): alert on a fall of more than 3 below usual (2) or < 70 (1).
  const usualSpo2 = (parseBaselineSpo2 as unknown as (p: unknown, a: unknown, t: string) => number | null)(
    patient, answers || {}, `${patient.transcription || ''} ${patient.chief_complaint || ''}`);
  const vsUsual = (assessSpo2AgainstBaseline as unknown as (o: Record<string, unknown>) => { level: number | null; label_en: string; label_ar: string } | null)(
    { spo2, baselineSpo2: usualSpo2 });
  if (vsUsual) {
    if (vsUsual.level != null) add(vsUsual.level, vsUsual.label_ar, vsUsual.label_en);
  } else if (spo2 !== null && spo2 < th.spo2_urgent) {
    add(
      spo2 < th.spo2_critical ? 1 : 2,
      `SpO₂ ${spo2}% — نقص أكسجين`,
      `SpO₂ ${spo2}% — hypoxia`,
    );
  }
  if (gcs !== null && gcs < th.gcs_urgent) {
    add(
      gcs <= th.gcs_critical ? 1 : 2,
      `GCS ${gcs} — اضطراب وعي`,
      `GCS ${gcs} — altered consciousness`,
    );
  }
  const ageYears = toNumber(patient.age);
  const pediatric = ageYears !== null && ageYears < 18;
  // Children: hypotension for age, as the CTAS rule reads it; adults: the library thresholds.
  if (pediatric ? hypotensiveForAge(sbp, ageYears) : (sbp !== null && sbp < th.sbp_urgent)) {
    add(
      pediatric || (sbp !== null && sbp < th.sbp_critical) ? 1 : 2,
      `ضغط انقباضي ${sbp} — ${pediatric ? 'انخفاض للعمر' : 'عدم استقرار'}`,
      `SBP ${sbp} — ${pediatric ? 'hypotension for age' : 'hemodynamic instability'}`,
    );
  }
  // The same heart-rate assessment as the CTAS rule (PaedCTAS bands, explained vs unexplained),
  // so the alert shows exactly when the heart rate sets CTAS 2.
  const hrA = (assessHeartRate as (o: Record<string, unknown>) => unknown)({
    hr,
    age: ageYears,
    temp: toVital(patient.temperature ?? patient.temp, 32, 43),
    answers: answers || {},
    pathway: CARDIAC_TEXT.test(complaintText) ? 'palpitations' : '',
  }) as { alert: boolean; direction: string | null; label_en: string; label_ar: string } | null;
  if (hr !== null && hrA?.alert) {
    const unstable = hypotensiveForAge(sbp, ageYears)
      || (gcs !== null && gcs < 15)
      || SHOCK_SIGNS.test(complaintText);
    add(unstable ? 1 : 2, hrA.label_ar, hrA.label_en);
  }
  // Children: the same breathing-rate assessment as the CTAS rule (alert when it sets CTAS 2);
  // adults: the library threshold.
  if (pediatric) {
    const rrA = (assessRespiratoryRate as (o: Record<string, unknown>) => unknown)({ rr, age: ageYears, answers: answers || {} }) as
      { alert: boolean; label_en: string; label_ar: string } | null;
    if (rr !== null && rrA?.alert) add(2, rrA.label_ar, rrA.label_en);
  } else if (rr !== null && rr > th.rr_severe) {
    add(2, `تنفس ${rr}/دقيقة — ضائقة تنفسية`, `RR ${rr}/min — respiratory distress`);
  }

  const age = ageYears;
  for (const rule of lib.text_rules) {
    if (rule.active === false) continue;
    if (rule.id === 'rf_bleeding') {
      // Same reading as the CTAS rule, so the alert and the level agree.
      const stated = bleedingStated(complaintText, answers || {});
      if (stated === false) continue;
      if (!stated && !textHas(complaintText, rule.terms)) continue;
      const shock = SHOCK_SIGNS.test(complaintText) || hypotensiveForAge(sbp, age);
      add(shock ? 1 : rule.level, rule.label_ar, rule.label_en);
      continue;
    }
    if (!textHas(complaintText, rule.terms)) continue;
    // Chest-pain rule: only fire when chest-pain terms present (legacy behavior)
    if (rule.id === 'rf_chest_pain') {
      if (!textHas(complaintText, ['chest pain', 'ألم صدر', 'الم صدر'])) continue;
    }
    add(rule.level, rule.label_ar, rule.label_en);
  }

  if (
    pain !== null
    && pain >= th.pain_severe
    && ((sbp !== null && sbp < th.pain_unstable_sbp) || (hr !== null && hr > th.pain_unstable_hr))
  ) {
    add(2, `ألم شديد ${pain}/10 مع عدم استقرار`, `Severe pain ${pain}/10 with instability`);
  }

  if (!symptoms.length) return null;
  return {
    ctas_level: ctasLevel || 2,
    symptoms,
    action: ctasLevel === 1
      ? 'Notify resuscitation team immediately and move patient to resus area.'
      : 'Notify clinician immediately and prioritize CTAS completion.',
    source: 'local_red_flag_engine',
    triggered_at: new Date().toISOString(),
  };
}
