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

  if (spo2 !== null && spo2 < 90) add(spo2 < 85 ? 1 : 2, `SpO₂ ${spo2}% — نقص أكسجين`, `SpO₂ ${spo2}% — hypoxia`);
  if (gcs !== null && gcs < 13) add(gcs <= 8 ? 1 : 2, `GCS ${gcs} — اضطراب وعي`, `GCS ${gcs} — altered consciousness`);
  if (sbp !== null && sbp < 90) add(sbp < 70 ? 1 : 2, `ضغط انقباضي ${sbp} — عدم استقرار`, `SBP ${sbp} — hemodynamic instability`);
  if (hr !== null && hr > 130) add(2, `نبض ${hr} — تسرع شديد`, `HR ${hr} — severe tachycardia`);
  if (rr !== null && rr > 35) add(2, `تنفس ${rr}/دقيقة — ضائقة تنفسية`, `RR ${rr}/min — respiratory distress`);

  if (textHas(complaintText, ['chest pain', 'ألم صدر', 'الم صدر', 'diaphoresis', 'تعرق', 'radiation', 'يمتد', 'dyspnea', 'ضيق تنفس'])) {
    if (textHas(complaintText, ['chest pain', 'ألم صدر', 'الم صدر'])) add(2, 'ألم صدر عالي الخطورة', 'High-risk chest pain');
  }
  if (textHas(complaintText, ['stroke', 'سكتة', 'facial droop', 'arm weakness', 'speech difficulty', 'ضعف ذراع', 'ثقل لسان', 'تلعثم'])) {
    add(2, 'اشتباه سكتة دماغية', 'Possible stroke presentation');
  }
  if (textHas(complaintText, ['uncontrolled bleeding', 'نزيف شديد', 'نزيف لا يتوقف', 'major bleeding'])) {
    add(1, 'نزيف شديد غير مسيطر عليه', 'Uncontrolled major bleeding');
  }
  if (textHas(complaintText, ['anaphylaxis', 'تأق', 'throat swelling', 'تورم الحلق', 'stridor', 'صفير حنجري'])) {
    add(1, 'اشتباه تأق أو اضطراب مجرى الهواء', 'Possible anaphylaxis or airway compromise');
  }
  if (textHas(complaintText, ['seizure', 'تشنج', 'اختلاج'])) {
    add(2, 'تشنج/اختلاج', 'Seizure presentation');
  }
  if (pain !== null && pain >= 9 && ((sbp !== null && sbp < 100) || (hr !== null && hr > 120))) {
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
