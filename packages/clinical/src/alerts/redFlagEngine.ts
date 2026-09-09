import { getRedFlagLibrary } from '../libraries/runtime';

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
  const spo2 = toNumber(patient.spo2);
  const gcs = toNumber(patient.gcs);
  const sbp = toNumber(patient.bp_systolic);
  const hr = toNumber(patient.hr);
  const rr = toNumber(patient.rr);
  const pain = toNumber(patient.pain_score);
  let ctasLevel: number | null = null;

  const add = (level: number, ar: string, en: string) => {
    symptoms.push({ ar, en });
    ctasLevel = ctasLevel === null ? level : Math.min(ctasLevel, level);
  };

  if (spo2 !== null && spo2 < th.spo2_urgent) {
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
  if (sbp !== null && sbp < th.sbp_urgent) {
    add(
      sbp < th.sbp_critical ? 1 : 2,
      `ضغط انقباضي ${sbp} — عدم استقرار`,
      `SBP ${sbp} — hemodynamic instability`,
    );
  }
  if (hr !== null && hr > th.hr_severe) {
    add(2, `نبض ${hr} — تسرع شديد`, `HR ${hr} — severe tachycardia`);
  }
  if (rr !== null && rr > th.rr_severe) {
    add(2, `تنفس ${rr}/دقيقة — ضائقة تنفسية`, `RR ${rr}/min — respiratory distress`);
  }

  for (const rule of lib.text_rules) {
    if (rule.active === false) continue;
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
