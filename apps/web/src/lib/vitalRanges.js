/**
 * Official CTAS Protocol Engine — 2025 3-Step Sequential Assessment
 * Step 1: Chief Complaint (CEDIS) → Step 2: Complaint Specific Modifier → Step 3: Primary Modifiers
 */
import { matchComplaint, CTAS_CONFIG as CTAS_CFG } from '@/lib/ctasDatabase';

// ─── Age group classification ────────────────────────────────────────────────
function getAgeGroup(age) {
  if (age == null || age === '') return 'adult';
  const a = parseFloat(age);
  if (isNaN(a)) return 'adult';
  if (a < 0.083) return 'neonate';      // < 1 month
  if (a < 0.25)  return 'infant_1_3m';  // 1–3 months
  if (a < 1)     return 'infant';
  if (a < 5)     return 'toddler';
  if (a < 12)    return 'child';
  if (a < 18)    return 'adolescent';
  if (a >= 70)   return 'elderly';
  return 'adult';
}

// Age-specific normal vital ranges
const AGE_NORMS = {
  neonate:     { HR: { low: 100, high: 180 }, RR: { low: 30, high: 60 }, SBP: { low: 60,  high: 90  } },
  infant_1_3m: { HR: { low: 100, high: 160 }, RR: { low: 30, high: 60 }, SBP: { low: 70,  high: 100 } },
  infant:      { HR: { low: 80,  high: 150 }, RR: { low: 24, high: 40 }, SBP: { low: 70,  high: 100 } },
  toddler:     { HR: { low: 70,  high: 130 }, RR: { low: 22, high: 34 }, SBP: { low: 80,  high: 115 } },
  child:       { HR: { low: 60,  high: 120 }, RR: { low: 18, high: 30 }, SBP: { low: 90,  high: 120 } },
  adolescent:  { HR: { low: 55,  high: 110 }, RR: { low: 12, high: 20 }, SBP: { low: 100, high: 135 } },
  adult:       { HR: { low: 60,  high: 100 }, RR: { low: 12, high: 20 }, SBP: { low: 100, high: 140 } },
  elderly:     { HR: { low: 55,  high: 100 }, RR: { low: 12, high: 20 }, SBP: { low: 100, high: 150 } },
};

// ─── CEDIS complaint mapping — now delegates to ctasDatabase ─────────────────
function mapComplaintToCEDIS(complaint) {
  if (!complaint) return null;
  const match = matchComplaint(complaint);
  if (match) {
    return {
      cedis: match.categoryKey,
      name_ar: match.complaint.label_ar,
      name_en: match.complaint.label_en,
      pathway: match.complaintKey,
      category: match.categoryKey,
      range: [match.complaint.default_ctas, match.complaint.default_ctas],
      default_ctas: match.complaint.default_ctas,
    };
  }
  return { cedis: 'GENERAL', name_ar: 'شكوى عامة', name_en: 'General Complaint', pathway: 'general', category: 'GENERAL', range: [4, 5], default_ctas: 4 };
}

// ─── Step 2: Complaint level — from selectedModifier (official) or pathway heuristic ──
function getLevelFromComplaintPathway(pathway, vitals, answers, selectedModifier) {
  // If the nurse already selected the Step 2 modifier, use it directly
  if (selectedModifier?.ctas) {
    return {
      level: selectedModifier.ctas,
      reason_ar: selectedModifier.modifier,
      reason_en: selectedModifier.modifier,
      from_modifier: true,
    };
  }

  const spo2 = toNum(vitals.spo2);
  const gcs  = toNum(vitals.gcs);
  const pain = toNum(vitals.pain_score);

  // Heuristic fallback used before nurse selects modifier
  switch (pathway) {
    case 'chest_pain_cardiac': return { level: 2, reason_ar: 'ألم صدري قلبي', reason_en: 'Chest Pain (Cardiac Features)' };
    case 'shortness_of_breath': {
      if (spo2 && spo2 < 90) return { level: 1, reason_ar: 'توقف تنفس / نقص أكسجين حرج', reason_en: 'Severe hypoxia / resp arrest' };
      if (spo2 && spo2 < 92) return { level: 2, reason_ar: 'ضيق تنفس شديد', reason_en: 'SOB Severe' };
      return { level: 3, reason_ar: 'ضيق تنفس خفيف-متوسط', reason_en: 'SOB Mild/Moderate' };
    }
    case 'stroke_cva': return { level: 2, reason_ar: 'أعراض سكتة دماغية', reason_en: 'Stroke/CVA symptoms' };
    case 'altered_loc': {
      if (gcs && gcs <= 8)  return { level: 1, reason_ar: 'اضطراب وعي شديد', reason_en: 'Severe Altered LOC' };
      return { level: 2, reason_ar: 'اضطراب الوعي', reason_en: 'Altered LOC' };
    }
    case 'seizure': return { level: 2, reason_ar: 'تشنجات — لا يزال يتشنج', reason_en: 'Seizure' };
    case 'cardiac_arrest_non_traumatic':
    case 'cardiac_arrest_traumatic':
    case 'respiratory_arrest': return { level: 1, reason_ar: 'سكتة / توقف', reason_en: 'Arrest' };
    case 'fever': {
      if (isYes(answers.immunocompromised)) return { level: 2, reason_ar: 'حمى مع نقص المناعة', reason_en: 'Fever — Immunocompromised' };
      if (isYes(answers.sirs_criteria_count) && isYes(answers.looks_unwell)) return { level: 2, reason_ar: 'حمى — Looks Septic', reason_en: 'Fever — Looks Septic' };
      if (isYes(answers.looks_unwell)) return { level: 3, reason_ar: 'حمى — Looks Unwell', reason_en: 'Fever — Looks Unwell' };
      return { level: 4, reason_ar: 'حمى — Looks Well', reason_en: 'Fever — Looks Well' };
    }
    case 'headache': {
      if (isYes(answers.thunderclap) || isYes(answers.worst_headache_ever)) return { level: 2, reason_ar: 'صداع رعدي — اشتباه SAH', reason_en: 'Thunderclap headache — SAH risk' };
      if (isYes(answers.fever_neck_stiffness)) return { level: 2, reason_ar: 'صداع + حمى + تيبس الرقبة', reason_en: 'Headache + fever + neck stiffness' };
      return { level: 3, reason_ar: 'صداع', reason_en: 'Headache' };
    }
    case 'allergic_reaction': {
      if (isYes(answers.airway_involvement) || isYes(answers.stridor)) return { level: 1, reason_ar: 'تأق مع اضطراب مجرى الهواء', reason_en: 'Anaphylaxis — airway' };
      return { level: 3, reason_ar: 'تفاعل تحسسي', reason_en: 'Allergic reaction' };
    }
    case 'abdominal_pain': {
      if (isYes(answers.rigidity_guarding)) return { level: 2, reason_ar: 'ألم بطني مع توتر', reason_en: 'Abdominal rigidity' };
      return { level: 3, reason_ar: 'ألم بطني', reason_en: 'Abdominal pain' };
    }
    case 'multisystem_trauma_blunt':
    case 'multisystem_trauma_penetrating':
    case 'head_injury': {
      if (isYes(answers.penetrating_trunk)) return { level: 1, reason_ar: 'رضح نافذ في الجذع', reason_en: 'Penetrating trunk trauma' };
      if (isYes(answers.loc_any) || isYes(answers.high_energy_mechanism)) return { level: 2, reason_ar: 'رضح بآلية عالية', reason_en: 'High energy trauma / LOC' };
      return { level: 3, reason_ar: 'رضح', reason_en: 'Trauma' };
    }
    default:
      return { level: 4, reason_ar: 'شكوى غير محددة', reason_en: 'Undifferentiated complaint' };
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function toNum(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// Returns null if value is missing OR physiologically implausible (including zero for vitals)

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

function answerHas(v, terms = []) {
  const t = answerText(v);
  return terms.some((term) => t.includes(String(term).toLowerCase()));
}

function isCentralPainAnswer(v) {
  return answerHas(v, ['central', 'مركزي', 'داخلي', 'inside']);
}

function isChronicPainAnswer(v) {
  return answerHas(v, ['chronic', 'مزمن', 'recurring']);
}

function isDeformityAnswer(v) {
  return answerHas(v, ['deformity', 'تشوه']);
}

function toVital(v, min, max) {
  const n = toNum(v);
  if (n === null) return null;
  if (n < min || n > max) return null; // out of physiological range — treat as not entered
  return n;
}

function countAbnormalVitals(patient, ageGroup) {
  const norms = AGE_NORMS[ageGroup] || AGE_NORMS.adult;
  let count = 0;
  const hr   = toVital(patient.hr,   20,  250);
  const rr   = toVital(patient.rr,    4,   60);
  const sbp  = toVital(patient.bp_systolic, 40, 300);
  const spo2 = toVital(patient.spo2,  40,  100);
  const temp = toVital(patient.temperature, 32, 43);
  const gcs  = toVital(patient.gcs,   3,   15);
  if (hr   && (hr  < norms.HR.low  || hr  > norms.HR.high))  count++;
  if (rr   && (rr  < norms.RR.low  || rr  > norms.RR.high))  count++;
  if (sbp  && sbp  < norms.SBP.low)                          count++;
  if (spo2 && spo2 < 95)                                     count++;
  if (temp && (temp < 35.0 || temp >= 38.5))                 count++;
  if (gcs  && gcs  < 15)                                     count++;
  return count;
}

// ─── STEP 3: First Order Modifiers ───────────────────────────────────────────
function applyFirstOrderModifiers(patient, ageGroup, levelIn, answers = {}) {
  let level = levelIn;
  const applied = [];
  const spo2 = toVital(patient.spo2,        40,  100);
  const rr   = toVital(patient.rr,           4,   60);
  const sbp  = toVital(patient.bp_systolic,  40,  300);
  const hr   = toVital(patient.hr,           20,  250);
  const gcs  = toVital(patient.gcs,          3,   15);
  const temp = toVital(patient.temperature,  32,  43);
  const pain = toVital(patient.pain_score,   0,   10);
  const norms = AGE_NORMS[ageGroup] || AGE_NORMS.adult;

  // 3A Respiratory
  if (spo2 !== null) {
    if (spo2 < 88) {
      level = 1;
      applied.push({ label_ar: `SpO₂ ${spo2}% — نقص أكسجين حرج`, label_en: `SpO₂ ${spo2}% — critical hypoxia`, result: 'CTAS 1 override', value: `${spo2}%` });
    } else if (spo2 < 92) {
      if (level > 2) { level = 2; applied.push({ label_ar: `SpO₂ ${spo2}% — نقص أكسجين شديد`, label_en: `SpO₂ ${spo2}% — severe hypoxia → CTAS 2`, result: 'CTAS 2 min', value: `${spo2}%` }); }
    } else if (spo2 < 95) {
      if (level > 3) { level = 3; applied.push({ label_ar: `SpO₂ ${spo2}% — نقص أكسجين خفيف`, label_en: `SpO₂ ${spo2}% — mild hypoxia → CTAS 3`, result: 'CTAS 3 min', value: `${spo2}%` }); }
    } else {
      applied.push({ label_ar: `SpO₂ ${spo2}% — طبيعي`, label_en: `SpO₂ ${spo2}% — normal`, result: 'no modifier', value: `${spo2}%` });
    }
  }
  if (rr !== null && rr > norms.RR.high && level > 3) {
    level = 3;
    applied.push({ label_ar: `RR ${rr}/min — تسرع تنفس`, label_en: `RR ${rr}/min — tachypnea → CTAS 3`, result: 'CTAS 3 min', value: `${rr}/min` });
  }

  // 3B Hemodynamic
  if (sbp !== null) {
    if (sbp < 70) {
      level = 1;
      applied.push({ label_ar: `ضغط ${sbp} — صدمة حرجة`, label_en: `SBP ${sbp} — critical shock`, result: 'CTAS 1 override', value: `${sbp}mmHg` });
    } else if (sbp < 90 || (hr !== null && hr > 130 && sbp < 100)) {
      if (level > 2) { level = 2; applied.push({ label_ar: `ضغط ${sbp} — عدم استقرار ديناميكي`, label_en: `SBP ${sbp} — hemodynamic instability → CTAS 2`, result: 'CTAS 2 min', value: `${sbp}mmHg` }); }
    } else {
      applied.push({ label_ar: `الضغط مستقر`, label_en: `BP stable — no modifier`, result: 'no modifier', value: sbp ? `${sbp}mmHg` : '—' });
    }
  }
  if (hr !== null) {
    if (hr > 120 || hr < 50) {
      if (level > 3) { level = 3; applied.push({ label_ar: `HR ${hr} — اضطراب نظم تنبيهي`, label_en: `HR ${hr} — rhythm concern → CTAS 3`, result: 'CTAS 3 min', value: `${hr}bpm` }); }
    } else if (hr > 100) {
      applied.push({ label_ar: `HR ${hr} — تسرع خفيف`, label_en: `HR ${hr} — mild tachycardia`, result: 'noted', value: `${hr}bpm` });
    } else {
      applied.push({ label_ar: `HR ${hr} — طبيعي`, label_en: `HR ${hr} — normal`, result: 'no modifier', value: `${hr}bpm` });
    }
  }

  // 3C Consciousness
  if (gcs !== null) {
    if (gcs <= 8) {
      level = 1;
      applied.push({ label_ar: `GCS ${gcs} — فقدان وعي`, label_en: `GCS ${gcs} — unconscious`, result: 'CTAS 1 override', value: `${gcs}/15` });
    } else if (gcs <= 12) {
      if (level > 2) { level = 2; applied.push({ label_ar: `GCS ${gcs} — ضعف وعي`, label_en: `GCS ${gcs} — impaired LOC → CTAS 2`, result: 'CTAS 2 min', value: `${gcs}/15` }); }
    } else if (gcs <= 14) {
      if (level > 3) { level = 3; applied.push({ label_ar: `GCS ${gcs} — وعي منخفض قليلاً`, label_en: `GCS ${gcs} — mildly impaired → CTAS 3`, result: 'CTAS 3 min', value: `${gcs}/15` }); }
    } else {
      applied.push({ label_ar: `GCS ${gcs} — طبيعي`, label_en: `GCS ${gcs} — normal`, result: 'no modifier', value: `${gcs}/15` });
    }
  }

  // 3D Temperature
  if (temp !== null) {
    if (temp >= 41.0) {
      if (level > 2) { level = 2; applied.push({ label_ar: `حرارة ${temp}°C — فرط حرارة`, label_en: `Temp ${temp}°C — hyperpyrexia → CTAS 2`, result: 'CTAS 2 min', value: `${temp}°C` }); }
    } else if (temp < 35.0) {
      if (level > 2) { level = 2; applied.push({ label_ar: `حرارة ${temp}°C — انخفاض حرارة`, label_en: `Temp ${temp}°C — hypothermia → CTAS 2`, result: 'CTAS 2 min', value: `${temp}°C` }); }
    } else if (temp >= 38.5) {
      applied.push({ label_ar: `حرارة ${temp}°C — حمى`, label_en: `Temp ${temp}°C — fever`, result: 'noted', value: `${temp}°C` });
    } else {
      applied.push({ label_ar: `حرارة ${temp}°C — طبيعي`, label_en: `Temp ${temp}°C — normal`, result: 'no modifier', value: `${temp}°C` });
    }
  }

  // 3E Pain — CTAS 2025 Pain Assessment Matrix (p.29)
  if (pain !== null) {
    const isCentral = isCentralPainAnswer(answers.pain_location);
    const isChronic = isChronicPainAnswer(answers.pain_duration_type);
    const isPed = ageGroup !== 'adult' && ageGroup !== 'elderly';

    if (pain >= 8) {
      if (isPed) {
        // Pediatric: Acute→2, Chronic→3
        if (!isChronic) {
          if (level > 2) { level = 2; applied.push({ label_ar: `ألم ${pain}/10 شديد حاد (أطفال) → CTAS 2`, label_en: `Severe acute pain ${pain}/10 (pediatric) → CTAS 2`, result: 'CTAS 2 min', value: `${pain}/10` }); }
        } else {
          if (level > 3) { level = 3; applied.push({ label_ar: `ألم ${pain}/10 شديد مزمن (أطفال) → CTAS 3`, label_en: `Severe chronic pain ${pain}/10 (pediatric) → CTAS 3`, result: 'CTAS 3 min', value: `${pain}/10` }); }
        }
      } else {
        // Adult: Central+Acute→2, Central+Chronic→3, Peripheral+Acute→3, Peripheral+Chronic→4
        if (isCentral && !isChronic) {
          if (level > 2) { level = 2; applied.push({ label_ar: `ألم ${pain}/10 شديد مركزي حاد → CTAS 2`, label_en: `Severe central acute pain ${pain}/10 → CTAS 2`, result: 'CTAS 2 min', value: `${pain}/10` }); }
        } else if (isCentral && isChronic) {
          if (level > 3) { level = 3; applied.push({ label_ar: `ألم ${pain}/10 شديد مركزي مزمن → CTAS 3`, label_en: `Severe central chronic pain ${pain}/10 → CTAS 3`, result: 'CTAS 3 min', value: `${pain}/10` }); }
        } else if (!isCentral && !isChronic) {
          if (level > 3) { level = 3; applied.push({ label_ar: `ألم ${pain}/10 شديد محيطي حاد → CTAS 3`, label_en: `Severe peripheral acute pain ${pain}/10 → CTAS 3`, result: 'CTAS 3 min', value: `${pain}/10` }); }
        } else {
          // Peripheral + Chronic — fallback or hemodynamic concern
          if (sbp !== null && (sbp < 100 || (hr !== null && hr > 110))) {
            if (level > 2) { level = 2; applied.push({ label_ar: `ألم ${pain}/10 مع عدم استقرار ديناميكي → CTAS 2`, label_en: `Pain ${pain}/10 with hemodynamic instability → CTAS 2`, result: 'CTAS 2 min', value: `${pain}/10` }); }
          } else {
            if (level > 4) { level = 4; applied.push({ label_ar: `ألم ${pain}/10 شديد محيطي مزمن → CTAS 4`, label_en: `Severe peripheral chronic pain ${pain}/10 → CTAS 4`, result: 'CTAS 4 min', value: `${pain}/10` }); }
          }
        }
      }
    } else if (pain >= 4) {
      if (isPed) {
        if (!isChronic) {
          if (level > 3) { level = 3; applied.push({ label_ar: `ألم ${pain}/10 متوسط حاد (أطفال) → CTAS 3`, label_en: `Moderate acute pain ${pain}/10 (pediatric) → CTAS 3`, result: 'CTAS 3 min', value: `${pain}/10` }); }
        } else {
          if (level > 4) { level = 4; applied.push({ label_ar: `ألم ${pain}/10 متوسط مزمن (أطفال) → CTAS 4`, label_en: `Moderate chronic pain ${pain}/10 (pediatric) → CTAS 4`, result: 'CTAS 4 min', value: `${pain}/10` }); }
        }
      } else {
        if (isCentral && !isChronic) {
          if (level > 3) { level = 3; applied.push({ label_ar: `ألم ${pain}/10 متوسط مركزي حاد → CTAS 3`, label_en: `Moderate central acute pain ${pain}/10 → CTAS 3`, result: 'CTAS 3 min', value: `${pain}/10` }); }
        } else if (isCentral && isChronic) {
          if (level > 4) { level = 4; applied.push({ label_ar: `ألم ${pain}/10 متوسط مركزي مزمن → CTAS 4`, label_en: `Moderate central chronic pain ${pain}/10 → CTAS 4`, result: 'CTAS 4 min', value: `${pain}/10` }); }
        } else {
          if (level > 4) { level = 4; applied.push({ label_ar: `ألم ${pain}/10 متوسط محيطي → CTAS 4`, label_en: `Moderate peripheral pain ${pain}/10 → CTAS 4`, result: 'CTAS 4 min', value: `${pain}/10` }); }
        }
      }
    } else {
      // Mild (1-3) — CTAS 4 if central/acute, else 5
      if (!isChronic && isCentral) {
        if (level > 4) { level = 4; applied.push({ label_ar: `ألم ${pain}/10 خفيف مركزي حاد → CTAS 4`, label_en: `Mild central acute pain ${pain}/10 → CTAS 4`, result: 'CTAS 4 min', value: `${pain}/10` }); }
      } else {
        applied.push({ label_ar: `ألم ${pain}/10 — خفيف`, label_en: `Pain ${pain}/10 — mild`, result: 'no modifier', value: `${pain}/10` });
      }
    }
  }

  return { level, applied };
}

// ─── STEP 4: Second Order Modifiers ──────────────────────────────────────────
/** Map CEDIS complaint keys (e.g. chest_pain_cardiac) to Step-4 family buckets. */
function pathwayFamily(pathway) {
  const p = String(pathway || 'general');
  if (p.startsWith('chest_pain') || p === 'palpitations' || p === 'cool_pulseless_limb') return 'chest_pain';
  if (p.includes('stroke') || p === 'tia') return 'stroke_symptoms';
  if (
    p.includes('trauma') || p === 'head_injury' || p === 'traumatic_back_spine'
    || p === 'sexual_assault'
  ) return 'trauma';
  if (p.includes('headache') || p === 'migraine') return 'headache';
  if (p.includes('allerg') || p === 'anaphylaxis') return 'allergic_reaction';
  if (p.includes('fever') || p === 'urti_complaints') return 'fever';
  if (p.includes('abdominal') || p === 'flank_pain') return 'abdominal_pain';
  if (p === 'limb_pain') return 'limb_pain';
  if (p === 'back_pain') return 'back_pain';
  if (
    p.includes('dyspnea') || p.includes('shortness') || p.includes('asthma')
    || p.includes('copd') || p.includes('respirat')
  ) return 'dyspnea';
  return p || 'general';
}

function applySecondOrderModifiers(pathway, answers, levelIn) {
  let level = levelIn;
  const applied = [];
  const family = pathwayFamily(pathway);

  if (family === 'chest_pain') {
    if (isYes(answers.radiation) && isYes(answers.diaphoresis)) {
      if (level > 2) { level = 2; applied.push({ label_ar: 'إشعاع + تعرق → ACS → CTAS 2', label_en: 'Radiation + diaphoresis → ACS high risk → CTAS 2' }); }
    } else if (isYes(answers.radiation) && level > 2) {
      level = 2; applied.push({ label_ar: 'إشعاع الألم → اشتباه قلبي → CTAS 2', label_en: 'Pain radiation → cardiac concern → CTAS 2' });
    }
    if (isYes(answers.prior_cardiac_history) && level > 2) {
      level = 2; applied.push({ label_ar: 'تاريخ قلبي سابق → CTAS 2', label_en: 'Prior cardiac history → CTAS 2' });
    }
    if (isYes(answers.on_blood_thinners) && level > 2) {
      level = 2; applied.push({ label_ar: 'مضادات التخثر → CTAS 2 حد أدنى', label_en: 'Anticoagulants → CTAS 2 minimum' });
    }
  }

  if (family === 'stroke_symptoms') {
    if (isYes(answers.fast_face) || isYes(answers.fast_arm) || isYes(answers.fast_speech)) {
      const pos = [answers.fast_face, answers.fast_arm, answers.fast_speech].filter(isYes).length;
      if (pos >= 2 && level > 1) { level = 1; applied.push({ label_ar: `${pos} علامات FAST إيجابية → CTAS 1`, label_en: `${pos} FAST signs positive → CTAS 1` }); }
      else if (level > 2) { level = 2; applied.push({ label_ar: 'علامة FAST إيجابية → CTAS 2', label_en: 'FAST sign positive → CTAS 2' }); }
    }
  }

  if (family === 'trauma') {
    if (isYes(answers.high_energy_mechanism)) {
      const newL = Math.max(1, level - 1);
      if (newL < level) { applied.push({ label_ar: 'آلية عالية الطاقة → ترقية مستوى', label_en: 'High energy mechanism → upgrade one level' }); level = newL; }
    }
    if (isYes(answers.loc_any) && level > 2) {
      level = 2; applied.push({ label_ar: 'فقدان وعي → CTAS 2', label_en: 'Any LOC → CTAS 2' });
    }
    if (isYes(answers.penetrating_trunk)) {
      level = 1; applied.push({ label_ar: 'إصابة نافذة في الجذع → CTAS 1', label_en: 'Penetrating trunk injury → CTAS 1' });
    }
  }

  if (family === 'headache') {
    if (isYes(answers.thunderclap) || isYes(answers.worst_headache_ever)) {
      if (level > 2) { level = 2; applied.push({ label_ar: 'صداع رعدي / الأشد على الإطلاق → نزيف تحت العنكبوتية → CTAS 2', label_en: 'Thunderclap/worst-ever → SAH risk → CTAS 2' }); }
    }
    if (isYes(answers.fever_neck_stiffness) && level > 2) {
      level = 2; applied.push({ label_ar: 'حمى + تيبس رقبة → التهاب سحايا → CTAS 2', label_en: 'Fever + neck stiffness → meningitis → CTAS 2' });
    }
  }

  if (family === 'allergic_reaction') {
    if ((isYes(answers.airway_involvement) || isYes(answers.stridor)) && level > 1) {
      level = 1; applied.push({ label_ar: 'إشراك مجرى الهواء → تأق → CTAS 1', label_en: 'Airway involvement → anaphylaxis → CTAS 1' });
    }
    if (isYes(answers.prior_anaphylaxis) && level > 2) {
      level = 2; applied.push({ label_ar: 'تاريخ تأق سابق → CTAS 2', label_en: 'Prior anaphylaxis history → CTAS 2' });
    }
  }

  if (family === 'fever') {
    if (isYes(answers.immunocompromised) && level > 2) {
      level = 2; applied.push({ label_ar: 'نقص مناعة + حمى → CTAS 2', label_en: 'Immunocompromised + fever → CTAS 2' });
    }
    if (isYes(answers.rash_petechiae) && level > 2) {
      level = 2; applied.push({ label_ar: 'طفح نقطي → اشتباه التهاب سحايا → CTAS 2', label_en: 'Petechial rash → meningitis risk → CTAS 2' });
    }
    // CTAS 2025: Looks Septic (3+ SIRS) → CTAS 2
    if (isYes(answers.sirs_criteria_count) && isYes(answers.looks_unwell) && level > 2) {
      level = 2; applied.push({ label_ar: '≥ 3 معايير SIRS → Looks Septic → CTAS 2', label_en: '≥3 SIRS criteria → Looks Septic → CTAS 2' });
    }
    // Looks Unwell: <3 SIRS but ill-appearing → CTAS 3
    if (isYes(answers.looks_unwell) && level > 3) {
      level = 3; applied.push({ label_ar: 'حمى — يبدو معتلاً → CTAS 3', label_en: 'Fever — Looks Unwell → CTAS 3' });
    }
    if (isYes(answers.chills) && level > 3) {
      level = 3; applied.push({ label_ar: 'قشعريرة → CTAS 3 حد أدنى', label_en: 'Rigors → CTAS 3 minimum' });
    }
    // Bleeding disorder + fever → CTAS 2 (immunocompromised includes neutropenia)
    if (isYes(answers.bleeding_disorder_history) && level > 2) {
      level = 2; applied.push({ label_ar: 'اضطراب نزيف + حمى → CTAS 2', label_en: 'Bleeding disorder + fever → CTAS 2' });
    }
  }

  if (family === 'abdominal_pain') {
    if (isYes(answers.rigidity_guarding) && level > 2) {
      level = 2; applied.push({ label_ar: 'صلابة بطنية → اشتباه بطن حاد → CTAS 2', label_en: 'Abdominal rigidity → acute abdomen → CTAS 2' });
    }
  }

  if (family === 'dyspnea') {
    if (isYes(answers.cannot_speak_sentences) && level > 2) {
      level = 2; applied.push({ label_ar: 'عجز عن إكمال جملة → ضيق تنفس شديد → CTAS 2', label_en: 'Cannot speak sentences → severe dyspnea → CTAS 2' });
    }
    if (isYes(answers.stridor) && level > 1) {
      level = 1; applied.push({ label_ar: 'صرير → تهديد مجرى الهواء → CTAS 1', label_en: 'Stridor → airway threat → CTAS 1' });
    }
    if ((answers.dyspnea_type === 'في الراحة / At rest' || answers.dyspnea_type === 'كلاهما / Both') && level > 2) {
      level = 2; applied.push({ label_ar: 'ضيق تنفس في الراحة → CTAS 2', label_en: 'Dyspnea at rest → CTAS 2' });
    }
  }

  // Limb pain, back pain, and general complaints — QA-driven second order modifiers
  if (family === 'limb_pain' || family === 'back_pain' || family === 'general' || family === 'trauma') {
    if (isYes(answers.functional_impairment) && level > 3) {
      level = 3; applied.push({ label_ar: 'صعوبة المشي / تقييد الحركة → CTAS 3', label_en: 'Functional impairment → CTAS 3' });
    }
    if ((isYes(answers.trauma_mechanism) || answers.trauma_mechanism === 'yes_trauma') && level > 3) {
      level = 3; applied.push({ label_ar: 'إصابة أو سقوط مؤكد → CTAS 3', label_en: 'Confirmed trauma / fall → CTAS 3' });
    }
    if ((isNo(answers.weight_bearing) || answers.weight_bearing === 'no') && level > 3) {
      level = 3; applied.push({ label_ar: 'عدم القدرة على تحمل الوزن → CTAS 3 (Ottawa)', label_en: 'Cannot bear weight → CTAS 3 (Ottawa rules)' });
    }
    if (isDeformityAnswer(answers.swelling_deformity) && level > 3) {
      level = 3; applied.push({ label_ar: 'تشوه ظاهر → اشتباه كسر → CTAS 3', label_en: 'Visible deformity → suspected fracture → CTAS 3' });
    }
    if (isYes(answers.neurovascular_compromise) && level > 2) {
      level = 2; applied.push({ label_ar: 'ضعف وعائي عصبي → CTAS 2', label_en: 'Neurovascular compromise → CTAS 2' });
    }
  }

  // Universal QA modifiers — apply to any pathway
  if (isYes(answers.uncontrolled_bleeding) && level > 2) {
    level = 2; applied.push({ label_ar: 'نزيف غير مسيطر عليه → CTAS 2', label_en: 'Uncontrolled bleeding → CTAS 2' });
  }
  if (isYes(answers.syncope) && level > 2) {
    level = 2; applied.push({ label_ar: 'إغماء مؤكد → CTAS 2', label_en: 'Confirmed syncope → CTAS 2' });
  }

  return { level, applied };
}

// ─── STEP 5: Special Population Modifiers ────────────────────────────────────
function applyPopulationModifiers(patient, answers, ageGroup, levelIn) {
  let level = levelIn;
  const applied = [];
  const age   = toNum(patient.age);
  const temp  = toNum(patient.temperature);
  const abnormCount = countAbnormalVitals(patient, ageGroup);

  // Neonate — CTAS 2025 Frailty Modifier (p.30)
  if (ageGroup === 'neonate') {
    if (level > 2) { level = 2; applied.push({ label_ar: 'مولود ≤ 7 أيام — معدّل الهشاشة → CTAS 2', label_en: 'Neonate ≤ 7 days — Frailty modifier → CTAS 2' }); }
    if (temp !== null && temp >= 38.0) {
      level = 1; applied.push({ label_ar: 'حمى مولودية → بروتوكول الإنتان → CTAS 1', label_en: 'Neonatal fever → sepsis protocol → CTAS 1' });
    }
  }

  // Infant < 3 months
  if (ageGroup === 'infant_1_3m') {
    if (temp !== null && temp >= 38.0 && level > 2) {
      level = 2; applied.push({ label_ar: 'رضيع < 3 أشهر مع حمى → CTAS 2', label_en: 'Infant < 3 months with fever → CTAS 2' });
    }
  }

  // Frailty — CTAS 2025 (p.30): wheelchair-bound, fully dependent, terminal illness, cachexia, >80
  if (isYes(answers.frailty) && level > 3) {
    level = 3; applied.push({ label_ar: 'معيار الهشاشة — محتاج رعاية كاملة / كرسي متحرك / مرض نهائي → CTAS 3', label_en: 'Frailty modifier — fully dependent/wheelchair/terminal → CTAS 3' });
  }
  // Age > 80 unless obviously robust
  if (age !== null && age > 80 && level > 3) {
    level = 3; applied.push({ label_ar: 'عمر > 80 — معدّل الهشاشة → CTAS 3', label_en: 'Age > 80 — Frailty modifier → CTAS 3' });
  }

  // Elderly
  if (ageGroup === 'elderly' || (age !== null && age >= 70)) {
    const elderlyComplaints = ['chest_pain', 'dyspnea', 'altered_loc', 'stroke_symptoms'];
    if (patient.chief_complaint) {
      const pathway = mapComplaintToCEDIS(patient.chief_complaint)?.pathway;
      if (elderlyComplaints.includes(pathway)) {
        const newL = Math.max(1, level - 1);
        if (newL < level) { applied.push({ label_ar: 'عمر ≥ 70 + شكوى قلبية/تنفسية/عصبية → ترقية مستوى', label_en: 'Age ≥ 70 + cardiac/respiratory/neuro → upgrade one level' }); level = newL; }
      }
    }
    applied.push({ label_ar: 'مسن — خطر تظاهر غير نمطي', label_en: 'Elderly — atypical presentation risk noted' });
  }

  // Immunocompromised
  if (isYes(answers.immunocompromised) && temp !== null && temp >= 38.0 && level > 2) {
    level = 2; applied.push({ label_ar: 'نقص مناعة + حمى → CTAS 2', label_en: 'Immunocompromised + fever → CTAS 2' });
  }

  // Anticoagulated
  if (isYes(answers.on_blood_thinners)) {
    const pathway = mapComplaintToCEDIS(patient.chief_complaint)?.pathway;
    if ((pathway === 'headache' || pathway === 'trauma') && level > 2) {
      level = 2; applied.push({ label_ar: 'مضادات التخثر + صداع/رضح → CTAS 2', label_en: 'Anticoagulated + headache/trauma → CTAS 2' });
    }
  }

  // Multiple abnormal vitals
  if (abnormCount >= 2) {
    const newL = Math.max(1, level - 1);
    if (newL < level) {
      applied.push({ label_ar: `${abnormCount} علامات حيوية شاذة → ترقية مستوى`, label_en: `${abnormCount} abnormal vitals → upgrade one level` });
      level = newL;
    }
  }

  return { level, applied };
}

// ─── STEP 6: Immediate Life Threat Check ─────────────────────────────────────
function checkImmediateLifeThreats(patient, answers) {
  const threats = [];
  const sbp  = toVital(patient.bp_systolic, 40, 300);
  const spo2 = toVital(patient.spo2,        40, 100);
  const gcs  = toVital(patient.gcs,         3,  15);
  const temp = toVital(patient.temperature, 32, 43);
  const ageGroup = getAgeGroup(patient.age);

  if (gcs  !== null && gcs  <= 8)  threats.push({ ar: `GCS ${gcs} — فقدان الوعي`, en: `GCS ${gcs} — unconscious` });
  if (spo2 !== null && spo2 < 85)  threats.push({ ar: `SpO₂ ${spo2}% — نقص أكسجين حرج`, en: `SpO₂ ${spo2}% — critical hypoxia` });
  if (sbp  !== null && sbp  < 70)  threats.push({ ar: `ضغط ${sbp} — صدمة قاتلة`, en: `SBP ${sbp} — fatal shock` });
  if (ageGroup === 'neonate' && temp !== null && temp >= 38.0)
    threats.push({ ar: 'حمى مولودية — بروتوكول الإنتان', en: 'Neonatal fever — sepsis protocol' });
  if (isYes(answers.airway_involvement) || isYes(answers.stridor))
    threats.push({ ar: 'اضطراب مجرى الهواء', en: 'Airway compromise' });
  if (isYes(answers.uncontrolled_hemorrhage))
    threats.push({ ar: 'نزيف لا يمكن السيطرة عليه', en: 'Uncontrolled major hemorrhage' });
  if (isYes(answers.penetrating_trunk))
    threats.push({ ar: 'إصابة نافذة في الجذع', en: 'Penetrating trunk injury' });

  return threats;
}

// ─── STEP 1: Critical First Look ─────────────────────────────────────────────
function assessFirstLook(patient) {
  // Derive from available vitals — a rough proxy for visual assessment
  const spo2 = toVital(patient.spo2,        40,  100);
  const gcs  = toVital(patient.gcs,         3,   15);
  const sbp  = toVital(patient.bp_systolic, 40,  300);
  const hr   = toVital(patient.hr,          20,  250);

  const flags = [];
  let minLevel = null; // null = not yet determined

  if (spo2 !== null && spo2 < 90) { flags.push({ ar: 'تنفس مضطرب', en: 'Breathing compromised' }); if (!minLevel || minLevel > 1) minLevel = 1; }
  if (gcs  !== null && gcs  < 13) { flags.push({ ar: 'مستوى الوعي منخفض', en: 'Reduced consciousness' }); if (!minLevel || minLevel > (gcs <= 8 ? 1 : 2)) minLevel = gcs <= 8 ? 1 : 2; }
  if (sbp  !== null && sbp  < 90) { flags.push({ ar: 'انخفاض الضغط — قلق على الانضباط الوعائي', en: 'Hypotension — perfusion concern' }); if (!minLevel || minLevel > 2) minLevel = 2; }
  if (hr   !== null && hr   > 130){ flags.push({ ar: 'تسرع قلب شديد', en: 'Severe tachycardia' }); if (!minLevel || minLevel > 2) minLevel = 2; }

  return {
    stable: flags.length === 0,
    flags,
    min_level_from_first_look: minLevel,
    note_ar: flags.length === 0 ? 'جميع مؤشرات النظرة الأولى طبيعية' : `تنبيهات النظرة الأولى: ${flags.map(f => f.ar).join('، ')}`,
    note_en: flags.length === 0 ? 'All 5 first-look indicators normal on arrival' : `First look flags: ${flags.map(f => f.en).join(', ')}`,
  };
}

// CTAS_CONFIG imported from ctasDatabase as CTAS_CFG
const CTAS_CONFIG = CTAS_CFG;

// ─── MAIN EXPORT: computeLiveCTAS ────────────────────────────────────────────
// answers may include `_selectedModifier` — the Step 2 modifier chosen by the nurse
export function computeLiveCTAS(patient, answers = {}) {
  if (!patient) return null;

  // Minimum data gate — need chief complaint OR at least one physiologically valid vital
  const hasValidVital = (
    toVital(patient.hr,          20, 250) !== null ||
    toVital(patient.spo2,        40, 100) !== null ||
    toVital(patient.bp_systolic, 40, 300) !== null ||
    toVital(patient.gcs,         3,  15)  !== null
  );
  if (!patient.chief_complaint && !hasValidVital) return null;

  const ageGroup = getAgeGroup(patient.age);

  // ── STEP 1 ──
  const step1 = assessFirstLook(patient);

  // ── STEP 2 ── (selectedModifier passed via answers._selectedModifier)
  const cedis = mapComplaintToCEDIS(patient.chief_complaint);
  const selectedModifier = answers._selectedModifier || null;
  const complaintResult = getLevelFromComplaintPathway(cedis?.pathway || 'general', patient, answers, selectedModifier);
  let levelAfterStep2 = complaintResult.level;
  // Apply first-look minimum
  if (step1.min_level_from_first_look !== null) {
    levelAfterStep2 = Math.min(levelAfterStep2, step1.min_level_from_first_look);
  }

  // ── STEP 3 ──
  const step3 = applyFirstOrderModifiers(patient, ageGroup, levelAfterStep2, answers);
  const levelAfterStep3 = step3.level;

  // ── STEP 4 ──
  const step4 = applySecondOrderModifiers(cedis?.pathway || 'general', answers, levelAfterStep3);
  const levelAfterStep4 = step4.level;

  // ── STEP 5 ──
  const step5 = applyPopulationModifiers(patient, answers, ageGroup, levelAfterStep4);
  const levelAfterStep5 = step5.level;

  // ── STEP 6 ──
  const threats = checkImmediateLifeThreats(patient, answers);
  const finalLevel = threats.length > 0 ? 1 : Math.max(1, Math.min(5, levelAfterStep5));

  // ── STEP 7: assemble output ──
  const cfg = CTAS_CONFIG[finalLevel];

  const allModifiers = [...step3.applied, ...step4.applied, ...step5.applied];

  const primaryDeterminantAr = threats.length > 0
    ? threats[0].ar
    : (step4.applied[0]?.label_ar || step3.applied.find(m => m.result !== 'no modifier' && m.result !== 'noted')?.label_ar || complaintResult.reason_ar);
  const primaryDeterminantEn = threats.length > 0
    ? threats[0].en
    : (step4.applied[0]?.label_en || step3.applied.find(m => m.result !== 'no modifier' && m.result !== 'noted')?.label_en || complaintResult.reason_en);

  const redFlags = threats.length > 0
    ? threats.map(t => t.ar)
    : step3.applied.filter(m => m.result === 'CTAS 1 override' || m.result === 'CTAS 2 min').map(m => m.label_ar);

  const assessment_trail = {
    step1_first_look: {
      stable: step1.stable,
      flags: step1.flags,
      note_ar: step1.note_ar,
      note_en: step1.note_en,
    },
    step2_complaint: {
      cedis: cedis ? `${cedis.cedis} — ${cedis.name_en}` : 'G99 — General',
      name_ar: cedis?.name_ar || 'شكوى عامة',
      initial_range: cedis ? `CTAS ${cedis.range[0]}–${cedis.range[1]}` : 'CTAS 4–5',
      pathway: cedis?.pathway || 'general',
      reason_ar: complaintResult.reason_ar,
      reason_en: complaintResult.reason_en,
    },
    step3_first_order: {
      applied: step3.applied,
      level_after: levelAfterStep3,
    },
    step4_second_order: {
      applied: step4.applied,
      level_after: levelAfterStep4,
    },
    step5_population: {
      age_group: ageGroup,
      applied: step5.applied,
      level_after: levelAfterStep5,
    },
    step6_life_threats: {
      threats,
      override: threats.length > 0,
    },
    final_level: finalLevel,
  };

  return {
    level: finalLevel,
    ctas_level: finalLevel,
    ctas_ar: cfg.ar,
    ctas_en: cfg.en,
    max_wait_ar: cfg.wait_ar,
    max_wait_en: cfg.wait_en,
    max_wait_min: cfg.wait_min,
    hex: cfg.hex,
    primary_determinant_ar: primaryDeterminantAr,
    primary_determinant_en: primaryDeterminantEn,
    red_flags: redFlags,
    modifiers: allModifiers,
    clinical_summary_ar: `${cedis?.name_ar || 'شكوى'} — ${cfg.ar} (CTAS ${finalLevel}) — ${cfg.wait_ar}`,
    clinical_summary_en: `${cedis?.name_en || 'Complaint'} — ${cfg.en} (CTAS ${finalLevel}) — ${cfg.wait_en}`,
    assessment_trail,
    data_complete: !!(patient.chief_complaint && patient.hr && patient.spo2 && patient.bp_systolic),
  };
}

// Re-export for backward compat
export { computeLiveCTAS as default };

// ─── Vital sign interpreters (used by VitalsForm) ────────────────────────────
export function interpretHR(hr, age) {
  const g = getAgeGroup(age);
  const n = AGE_NORMS[g] || AGE_NORMS.adult;
  const v = parseFloat(hr);
  if (isNaN(v)) return null;
  if (v > n.HR.high * 1.3 || v < n.HR.low * 0.7) return { status: 'critical', color: 'text-red-600', bg: 'bg-red-50', label: v > n.HR.high ? 'تسرع شديد' : 'بطء شديد' };
  if (v > n.HR.high || v < n.HR.low) return { status: 'abnormal', color: 'text-amber-600', bg: 'bg-amber-50', label: v > n.HR.high ? 'تسرع' : 'بطء' };
  return { status: 'normal', color: 'text-green-600', bg: 'bg-green-50', label: 'طبيعي' };
}

export function interpretSBP(sbp) {
  const v = parseFloat(sbp);
  if (isNaN(v)) return null;
  if (v < 70)  return { status: 'critical', color: 'text-red-600',   bg: 'bg-red-50',   label: 'صدمة' };
  if (v < 90)  return { status: 'critical', color: 'text-red-600',   bg: 'bg-red-50',   label: 'انخفاض حرج' };
  if (v < 100) return { status: 'abnormal', color: 'text-amber-600', bg: 'bg-amber-50', label: 'انخفاض' };
  if (v > 180) return { status: 'critical', color: 'text-red-600',   bg: 'bg-red-50',   label: 'ارتفاع حرج' };
  if (v > 140) return { status: 'abnormal', color: 'text-amber-600', bg: 'bg-amber-50', label: 'ارتفاع' };
  return { status: 'normal', color: 'text-green-600', bg: 'bg-green-50', label: 'طبيعي' };
}

export function interpretSpO2(spo2) {
  const v = parseFloat(spo2);
  if (isNaN(v)) return null;
  if (v < 88) return { status: 'critical', color: 'text-red-600',   bg: 'bg-red-50',   label: 'نقص حرج' };
  if (v < 92) return { status: 'critical', color: 'text-red-600',   bg: 'bg-red-50',   label: 'نقص شديد' };
  if (v < 95) return { status: 'abnormal', color: 'text-amber-600', bg: 'bg-amber-50', label: 'نقص خفيف' };
  return { status: 'normal', color: 'text-green-600', bg: 'bg-green-50', label: 'طبيعي' };
}

export function interpretRR(rr, age) {
  const g = getAgeGroup(age);
  const n = AGE_NORMS[g] || AGE_NORMS.adult;
  const v = parseFloat(rr);
  if (isNaN(v)) return null;
  if (v > n.RR.high * 1.5 || v < 6) return { status: 'critical', color: 'text-red-600',   bg: 'bg-red-50',   label: v > n.RR.high ? 'تسرع شديد' : 'بطء شديد' };
  if (v > n.RR.high || v < n.RR.low) return { status: 'abnormal', color: 'text-amber-600', bg: 'bg-amber-50', label: v > n.RR.high ? 'تسرع' : 'بطء' };
  return { status: 'normal', color: 'text-green-600', bg: 'bg-green-50', label: 'طبيعي' };
}

export function interpretTemp(temp) {
  const v = parseFloat(temp);
  if (isNaN(v)) return null;
  if (v >= 41.0 || v < 34.0) return { status: 'critical', color: 'text-red-600',   bg: 'bg-red-50',   label: v >= 41 ? 'فرط حرارة' : 'انخفاض حرج' };
  if (v >= 38.5 || v < 35.0) return { status: 'abnormal', color: 'text-amber-600', bg: 'bg-amber-50', label: v >= 38.5 ? 'حمى' : 'انخفاض حرارة' };
  if (v >= 37.5) return { status: 'abnormal', color: 'text-amber-600', bg: 'bg-amber-50', label: 'حرارة مرتفعة قليلاً' };
  return { status: 'normal', color: 'text-green-600', bg: 'bg-green-50', label: 'طبيعي' };
}

export function interpretGCS(gcs) {
  const v = parseFloat(gcs);
  if (isNaN(v)) return null;
  if (v <= 8)  return { status: 'critical', color: 'text-red-600',   bg: 'bg-red-50',   label: 'فقدان وعي' };
  if (v <= 12) return { status: 'critical', color: 'text-red-600',   bg: 'bg-red-50',   label: 'ضعف وعي' };
  if (v <= 14) return { status: 'abnormal', color: 'text-amber-600', bg: 'bg-amber-50', label: 'وعي منخفض قليلاً' };
  return { status: 'normal', color: 'text-green-600', bg: 'bg-green-50', label: 'طبيعي' };
}