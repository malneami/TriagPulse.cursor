/**
 * Normalize clinical synonyms into one structured concept before CTAS scoring.
 * Pulse ≡ heart rate; fever ≡ temperature; tachypnea ≡ respiratory rate.
 */

function toNum(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function answerText(v) {
  return String(v ?? '').toLowerCase().trim();
}

function isYes(v) {
  const t = answerText(v);
  return t === 'yes' || t === 'true' || t.includes('نعم') || t.includes('اي نعم') || t.includes('إيجابي') || t.includes('positive');
}

function isNo(v) {
  const t = answerText(v);
  return t === 'no' || t === 'false' || t.includes('لا') || t.includes('negative');
}

/**
 * Vital-fact chronicity (legacy + mapped from symptom states).
 * Prefer detectSymptomChronicity() for encounter-level five-state model:
 * new | acute_on_chronic | worse_than_baseline | chronic_unchanged | uncertain
 * @typedef {'acute'|'worse_than_baseline'|'chronic_stable'|'unknown'} Chronicity
 * @typedef {'positive'|'negative'|'uncertain'|'unknown'} Polarity
 * @typedef {{
 *   concept: string,
 *   value: unknown,
 *   unit?: string|null,
 *   source_sentence?: string|null,
 *   confidence?: number,
 *   polarity?: Polarity,
 *   chronicity?: Chronicity,
 *   provider_validated?: boolean,
 * }} ClinicalFact
 */

function fact(concept, value, extras = {}) {
  return {
    concept,
    value,
    unit: extras.unit ?? null,
    source_sentence: extras.source_sentence ?? null,
    confidence: extras.confidence ?? 0.9,
    polarity: extras.polarity ?? (value == null ? 'unknown' : 'positive'),
    chronicity: extras.chronicity ?? 'unknown',
    provider_validated: extras.provider_validated ?? false,
  };
}

function chronicityFromAnswers(answers = {}, fieldHints = []) {
  const symptom = answerText(answers.symptom_chronicity);
  if (symptom) {
    if (/acute_on_chronic|exacerb|flare|تفاقم/.test(symptom)) return 'worse_than_baseline';
    if (/chronic_unchanged|chronic_stable|baseline_unchanged|مزمن/.test(symptom)) return 'chronic_stable';
    if (/worse_than_baseline|worse|أسوأ/.test(symptom)) return 'worse_than_baseline';
    if (/^new|acute|حاد|جديد/.test(symptom)) return 'acute';
  }
  for (const key of fieldHints) {
    const v = answerText(answers[key]);
    if (!v) continue;
    if (/acute\s*on\s*chronic|exacerb|flare|تفاقم/.test(v)) return 'worse_than_baseline';
    if (/chronic_unchanged|same\s+as|unchanged|لم\s*يتغير|نفس\s*المعتاد/.test(v)) return 'chronic_stable';
    if (/chronic|مزمن|baseline|معتاد|usual/.test(v) && !/worse|أسوأ|new|جديد/.test(v)) return 'chronic_stable';
    if (/worse|أسوأ|changed|تغير/.test(v)) return 'worse_than_baseline';
    if (/\bnew\b|جديد|acute|حاد/.test(v)) return 'acute';
  }
  if (isYes(answers.worse_than_baseline)) return 'worse_than_baseline';
  if (isYes(answers.chronic_stable) || isYes(answers.baseline_unchanged)) return 'chronic_stable';
  if (isYes(answers.acute_new)) return 'acute';
  return 'unknown';
}

/**
 * Build normalized facts from patient form + answers + optional transcript cues.
 * @returns {{
 *   facts: Record<string, ClinicalFact>,
 *   vitals: { hr: number|null, rr: number|null, sbp: number|null, spo2: number|null, temp: number|null, gcs: number|null, pain: number|null, wbc: number|null },
 *   appearance: { looks_unwell: boolean|null, looks_well: boolean|null, shocked: boolean|null },
 *   flags: Record<string, boolean>,
 * }}
 */
export function normalizeClinicalFacts({ patient = {}, answers = {}, transcript = '' } = {}) {
  const tx = `${transcript || ''} ${patient.transcription || ''} ${patient.chief_complaint || ''}`.toLowerCase();
  const facts = {};

  // Heart rate — pulse / tachycardia / HR collapse to one concept
  let hr = toNum(patient.hr ?? patient.heart_rate ?? patient.pulse ?? answers.hr);
  const tachycardicCue = /\btachycard\w*\b|تسرع\s*(?:قلب|نبض)|نبض\s*(?:سريع|عالي)|high\s+pulse|rapid\s+pulse|fast\s+(?:heart|pulse)/i.test(tx)
    || isYes(answers.tachycardia);
  if (hr == null && tachycardicCue) {
    // Qualitative only — do not invent a numeric value
    facts.heart_rate = fact('heart_rate', 'tachycardic_qualitative', {
      unit: null,
      source_sentence: 'qualitative tachycardia / high pulse',
      confidence: 0.7,
      polarity: 'positive',
    });
  } else if (hr != null) {
    facts.heart_rate = fact('heart_rate', hr, {
      unit: 'bpm',
      source_sentence: patient.hr != null ? 'patient.hr' : 'pulse/heart_rate alias',
      chronicity: chronicityFromAnswers(answers, ['hr_chronicity', 'vital_chronicity']),
    });
  }

  // Temperature — fever / febrile / high temp
  let temp = toNum(patient.temperature ?? patient.temp ?? answers.temperature);
  const feverCue = /\bfebril\w*\b|\bfever\b|حمى|سخون|حرارة\s*عالي/i.test(tx) || isYes(answers.fever);
  if (temp == null && feverCue) {
    facts.temperature = fact('temperature', 'febrile_qualitative', {
      source_sentence: 'qualitative fever',
      confidence: 0.7,
      polarity: 'positive',
    });
  } else if (temp != null) {
    facts.temperature = fact('temperature', temp, {
      unit: 'C',
      source_sentence: 'patient.temperature',
      chronicity: chronicityFromAnswers(answers, ['temp_chronicity', 'vital_chronicity']),
    });
  }

  // Respiratory rate
  let rr = toNum(patient.rr ?? patient.respiratory_rate ?? answers.rr);
  const tachypneaCue = /\btachypn\w*\b|breathing\s+fast|تنفس\s*سريع|لهثان/i.test(tx) || isYes(answers.tachypnea);
  if (rr == null && tachypneaCue) {
    facts.respiratory_rate = fact('respiratory_rate', 'tachypnea_qualitative', {
      source_sentence: 'qualitative tachypnea',
      confidence: 0.65,
      polarity: 'positive',
    });
  } else if (rr != null) {
    facts.respiratory_rate = fact('respiratory_rate', rr, {
      unit: '/min',
      source_sentence: 'patient.rr',
      chronicity: chronicityFromAnswers(answers, ['rr_chronicity', 'vital_chronicity']),
    });
  }

  const sbp = toNum(patient.bp_systolic ?? answers.bp_systolic);
  if (sbp != null) facts.sbp = fact('sbp', sbp, { unit: 'mmHg' });

  const spo2 = toNum(patient.spo2 ?? answers.spo2);
  if (spo2 != null) facts.spo2 = fact('spo2', spo2, { unit: '%' });

  const gcs = toNum(patient.gcs ?? answers.gcs);
  if (gcs != null) facts.gcs = fact('gcs', gcs, { unit: '/15' });

  const pain = toNum(patient.pain_score ?? answers.pain_score);
  if (pain != null) facts.pain = fact('pain', pain, { unit: '/10' });

  // WBC — never assume abnormal if missing
  const wbc = toNum(patient.wbc ?? answers.wbc ?? patient.white_cell_count);
  if (wbc != null) {
    facts.wbc = fact('wbc', wbc, { unit: 'x10^9/L' });
  } else {
    facts.wbc = fact('wbc', null, { polarity: 'unknown', confidence: 0 });
  }

  // Appearance
  let looksUnwell = null;
  if (isYes(answers.looks_unwell) || /looks?\s+unwell|يبدو\s*(?:مريضا|معتلا)|toxic\s+appearance/i.test(tx)) looksUnwell = true;
  else if (isNo(answers.looks_unwell) || /looks?\s+well|يبدو\s*جيدا/i.test(tx)) looksUnwell = false;

  let looksWell = looksUnwell === false ? true : (looksUnwell === true ? false : null);
  if (isYes(answers.looks_well)) { looksWell = true; looksUnwell = false; }

  let shocked = null;
  if (isYes(answers.shock) || isYes(answers.septic_shock) || /septic\s+shock|صدمة\s*إنتانية|weak\s+thready\s+pulse|نبض\s*ضعيف/i.test(tx)) {
    shocked = true;
  }

  const flags = {
    immunocompromised: isYes(answers.immunocompromised),
    moderate_respiratory_distress: isYes(answers.moderate_respiratory_distress)
      || isYes(answers.cannot_speak_sentences)
      || isYes(answers.respiratory_distress),
    altered_loc: isYes(answers.altered_loc) || isYes(answers.loc_any)
      || (gcs != null && gcs < 15),
    poor_perfusion: isYes(answers.poor_perfusion) || isYes(answers.delayed_cap_refill)
      || /poor\s+perfusion|delayed\s+cap|تأثر\s*تروية|امتلاء\s*شعيري\s*متأخر/i.test(tx),
    postural_hypotension: isYes(answers.postural_hypotension),
    unexplained_tachycardia: isYes(answers.unexplained_tachycardia),
    expected_tachycardia: isYes(answers.expected_tachycardia)
      || isYes(answers.tachycardia_from_fever)
      || isYes(answers.crying),
    airway_threat: isYes(answers.airway_involvement) || isYes(answers.stridor),
    uncontrolled_hemorrhage: isYes(answers.uncontrolled_hemorrhage),
    penetrating_trunk: isYes(answers.penetrating_trunk),
    petechiae: isYes(answers.rash_petechiae),
    chronic_stable_vitals: chronicityFromAnswers(answers, ['vital_chronicity', 'hr_chronicity']) === 'chronic_stable',
  };

  return {
    facts,
    vitals: {
      hr: typeof hr === 'number' ? hr : null,
      rr: typeof rr === 'number' ? rr : null,
      sbp,
      spo2,
      temp: typeof temp === 'number' ? temp : null,
      gcs,
      pain,
      wbc,
      hr_qualitative_tachycardia: !!(hr == null && tachycardicCue),
      rr_qualitative_tachypnea: !!(rr == null && tachypneaCue),
      temp_qualitative_fever: !!(temp == null && feverCue),
    },
    appearance: { looks_unwell: looksUnwell, looks_well: looksWell, shocked },
    flags,
    isYes,
    isNo,
  };
}

export { isYes, isNo, toNum, answerText };
