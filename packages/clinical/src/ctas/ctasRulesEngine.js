/**
 * Deterministic CTAS Rules Engine — official hierarchy:
 * Step 0 Critical visual → Step 1 Chief complaint → Step 2 Complaint-specific
 * → Step 3 Primary modifiers → Step 4 Min acuity (lowest numerical CTAS).
 *
 * Never averages or counts findings to invent a level.
 * LLM must not assign CTAS; this engine is the sole scorer.
 */
import { CTAS_CONFIG } from './ctasDatabase.js';
import { matchComplaint, resolveChiefComplaint } from './resolveChiefComplaint.js';
import { applyModifierLibraryEffects } from './modifierLibrary.js';
import { resolveCtasHintsFromAnswers } from './clarifyingQuestionBank.js';
import { getAgeGroup, isPediatricAgeGroup, getNorms } from './ageNorms.js';
import { normalizeClinicalFacts, isYes, answerText } from './factNormalizer.js';
import { evaluateSirsCriteria, evaluateAdultFeverModifier } from './rules/adultFeverRules.js';
import { evaluateHemodynamicModifier } from './rules/hemodynamicRules.js';
import {
  detectSymptomChronicity,
  isChronicUnchanged,
  isAcuteAcuity,
} from './detectSymptomChronicity.js';

function toVital(v, min, max) {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function pushCandidate(candidates, item) {
  if (!item || item.level == null || !Number.isFinite(item.level)) return;
  candidates.push({
    level: Math.max(1, Math.min(5, Number(item.level))),
    source: item.source || item.rule_id || 'rule',
    label_en: item.label_en || item.explanation_en || item.source,
    label_ar: item.label_ar || item.explanation_ar || item.label_en,
    rule_id: item.rule_id || null,
    evidence: item.evidence || null,
  });
}

function mapComplaint(complaint, { transcript = '', confirmedKey = null, pendingConfirmation = false } = {}) {
  if (!complaint && !confirmedKey) {
    return {
      cedis: null,
      name_ar: null,
      name_en: null,
      pathway: null,
      default_ctas: null,
      why_en: 'Chief complaint not selected',
      why_ar: 'لم تُحدَّد الشكوى الرئيسية',
      secondary: [],
      needs_confirmation: false,
    };
  }
  const resolution = resolveChiefComplaint({
    chiefComplaint: complaint || '',
    transcript,
    confirmedKey,
  });
  const match = matchComplaint(complaint || '', { transcript, confirmedKey });
  if (match) {
    return {
      cedis: match.categoryKey,
      name_ar: match.complaint.label_ar,
      name_en: match.complaint.label_en,
      pathway: match.complaintKey,
      default_ctas: match.complaint.default_ctas,
      category: match.categoryKey,
      why_en: resolution.status === 'confirmed'
        ? `Provider-confirmed CEDIS ${match.complaintKey}`
        : `Auto-mapped CEDIS ${match.complaintKey} (confidence ${match.confidence ?? 'n/a'})`,
      why_ar: resolution.status === 'confirmed'
        ? `تأكيد المزود لشكوى CEDIS ${match.complaintKey}`
        : `ربط تلقائي بشكوى CEDIS ${match.complaintKey}`,
      secondary: (resolution.candidates || []).slice(1).map((c) => ({
        pathway: c.complaintKey,
        confidence: c.confidence,
        label_en: c.label_en,
      })),
      match,
      resolution,
      needs_confirmation: false,
    };
  }
  if (resolution.needs_confirmation || pendingConfirmation) {
    return {
      cedis: null,
      name_ar: null,
      name_en: null,
      pathway: null,
      default_ctas: null,
      why_en: 'Chief complaint needs provider confirmation — pathway CTAS deferred',
      why_ar: 'الشكوى تحتاج تأكيد المزود — تأجيل CTAS المسار',
      secondary: (resolution.candidates || []).map((c) => ({
        pathway: c.complaintKey,
        confidence: c.confidence,
        label_en: c.label_en,
        label_ar: c.label_ar,
      })),
      resolution,
      needs_confirmation: true,
    };
  }
  return {
    cedis: 'GENERAL',
    name_ar: 'شكوى عامة',
    name_en: 'General Complaint',
    pathway: 'general',
    default_ctas: 4,
    why_en: 'No CEDIS match — general pathway (primary modifiers still apply)',
    why_ar: 'لا تطابق CEDIS — مسار عام',
    secondary: [],
    resolution,
    needs_confirmation: false,
  };
}

function parseBaselineSpo2(patient = {}, answers = {}, transcript = '') {
  const direct = parseFloat(patient.baseline_spo2 ?? answers.baseline_spo2);
  if (Number.isFinite(direct)) return direct;
  const tx = `${transcript || ''} ${patient.transcription || ''} ${patient.onset_duration || ''}`;
  const m = tx.match(/(?:baseline|usual|normally|معتاد|خط\s*الأساس)[^\d]{0,24}(\d{2})\s*%/i)
    || tx.match(/(\d{2})\s*%\s*(?:baseline|usual|at\s+home|منزلي|معتاد)/i);
  if (m) {
    const n = parseFloat(m[1]);
    if (n >= 70 && n <= 100) return n;
  }
  return null;
}

function hypoxiaShouldApply({ spo2, chronicity, baselineSpo2, homeOxygen }) {
  if (spo2 == null) return { apply: false, suppressed: false };
  // Life-threatening hypoxia always applies
  if (spo2 < 88) return { apply: true, suppressed: false, reason: 'critical_hypoxia' };
  if (isAcuteAcuity(chronicity?.status) || !isChronicUnchanged(chronicity?.status)) {
    return { apply: true, suppressed: false };
  }
  if (baselineSpo2 != null && Math.abs(spo2 - baselineSpo2) <= 3) {
    return { apply: false, suppressed: true, reason: 'within_chronic_baseline' };
  }
  // Home O₂ + chronic unchanged without numeric baseline — suppress mild (90–94) floor only
  if (homeOxygen && baselineSpo2 == null && spo2 >= 90 && spo2 < 95) {
    return { apply: false, suppressed: true, reason: 'home_o2_chronic_unchanged' };
  }
  return { apply: true, suppressed: false };
}

function isFeverPathway(pathway, complaint) {
  const p = String(pathway || '');
  const c = String(complaint || '').toLowerCase();
  return p.includes('fever') || /\bfever\b|حمى|سخون/.test(c);
}

/** Step 0 — critical visual / ABCDE (alerts + candidate floors; does not skip Step 1). */
function evaluateStep0({ vitals, flags, appearance }) {
  const alerts = [];
  const candidates = [];
  const applied = [];

  if (flags.airway_threat) {
    alerts.push({ ar: 'اضطراب مجرى الهواء', en: 'Airway compromise' });
    pushCandidate(candidates, { level: 1, rule_id: 'step0_airway', label_en: 'Airway threat → CTAS 1', label_ar: 'تهديد مجرى الهواء → CTAS 1' });
    applied.push({ label_en: 'Airway threat', label_ar: 'تهديد مجرى الهواء', result: 'CTAS 1 override' });
  }
  // SpO₂ floors applied in evaluateRespiratoryPrimary with chronicity gate;
  // Step 0 only forces critical <88 (never suppressed).
  if (vitals.spo2 != null && vitals.spo2 < 88) {
    alerts.push({ ar: `SpO₂ ${vitals.spo2}% حرج`, en: `SpO₂ ${vitals.spo2}% critical` });
    pushCandidate(candidates, { level: 1, rule_id: 'step0_hypoxia', label_en: `SpO₂ ${vitals.spo2}% → CTAS 1`, label_ar: `SpO₂ ${vitals.spo2}% → CTAS 1` });
  } else if (vitals.spo2 != null && vitals.spo2 < 90 && !vitals._suppress_spo2_floor) {
    pushCandidate(candidates, { level: 1, rule_id: 'step0_breathing', label_en: `Breathing compromised SpO₂ ${vitals.spo2}%`, label_ar: 'تنفس مضطرب' });
  }
  if (vitals.gcs != null && vitals.gcs <= 8) {
    alerts.push({ ar: `GCS ${vitals.gcs}`, en: `GCS ${vitals.gcs} — unconscious` });
    pushCandidate(candidates, { level: 1, rule_id: 'step0_disability', label_en: `GCS ${vitals.gcs} → CTAS 1`, label_ar: `GCS ${vitals.gcs} → CTAS 1` });
  } else if (vitals.gcs != null && vitals.gcs < 13) {
    pushCandidate(candidates, { level: 2, rule_id: 'step0_loc', label_en: `Reduced consciousness GCS ${vitals.gcs}`, label_ar: 'انخفاض الوعي' });
  }
  if (vitals.sbp != null && vitals.sbp < 70) {
    alerts.push({ ar: `صدمة ضغط ${vitals.sbp}`, en: `Shock SBP ${vitals.sbp}` });
    pushCandidate(candidates, { level: 1, rule_id: 'step0_circulation_shock', label_en: `SBP ${vitals.sbp} shock`, label_ar: 'صدمة دورانية' });
  } else if (vitals.sbp != null && vitals.sbp < 90) {
    pushCandidate(candidates, { level: 2, rule_id: 'step0_hypotension', label_en: `Hypotension SBP ${vitals.sbp}`, label_ar: 'انخفاض الضغط' });
  }
  if (flags.uncontrolled_hemorrhage) {
    alerts.push({ ar: 'نزيف غير مسيطر عليه', en: 'Uncontrolled hemorrhage' });
    pushCandidate(candidates, { level: 1, rule_id: 'step0_hemorrhage', label_en: 'Uncontrolled hemorrhage → CTAS 1', label_ar: 'نزيف → CTAS 1' });
  }
  if (flags.penetrating_trunk) {
    pushCandidate(candidates, { level: 1, rule_id: 'step0_penetrating', label_en: 'Penetrating trunk → CTAS 1', label_ar: 'إصابة نافذة → CTAS 1' });
  }
  if (appearance.shocked) {
    alerts.push({ ar: 'مظهر صدمي', en: 'Shocked appearance' });
    pushCandidate(candidates, { level: 1, rule_id: 'step0_shocked_look', label_en: 'Immediate life-threatening shocked appearance', label_ar: 'مظهر مهدد للحياة' });
  }

  return {
    stable: alerts.length === 0 && candidates.every((c) => c.level > 2),
    alerts,
    candidates,
    applied,
    note_en: alerts.length ? `Critical visual alerts: ${alerts.map((a) => a.en).join(', ')}` : 'No immediate life-threatening visual findings',
    note_ar: alerts.length ? `تنبيهات بصرية: ${alerts.map((a) => a.ar).join('، ')}` : 'لا توجد علامات بصرية مهددة فوراً',
  };
}

function evaluateComplaintSpecific({ complaint, selectedModifier, answers, pathway }) {
  const applied = [];
  const candidates = [];

  if (selectedModifier?.ctas) {
    const item = {
      level: selectedModifier.ctas,
      rule_id: 'step2_selected_modifier',
      label_en: `${selectedModifier.modifier || 'Selected modifier'} → CTAS ${selectedModifier.ctas}`,
      label_ar: `${selectedModifier.modifier || 'معدّل محدد'} → CTAS ${selectedModifier.ctas}`,
      evidence: { selectedModifier },
      confidence: 1,
      source: 'complaint_specific',
    };
    pushCandidate(candidates, item);
    applied.push({ ...item, result: `CTAS ${selectedModifier.ctas} min`, name: selectedModifier.modifier });
    return { candidates, applied, level: selectedModifier.ctas, from_modifier: true };
  }

  // Pathway heuristic baseline (pre-selection) — complaint default, not final without modifiers
  const baseline = complaint?.default_ctas ?? 4;
  pushCandidate(candidates, {
    level: baseline,
    rule_id: 'step2_complaint_baseline',
    label_en: `Complaint baseline CTAS ${baseline}`,
    label_ar: `خط أساس الشكوى CTAS ${baseline}`,
    source: 'complaint_specific',
  });
  applied.push({
    label_en: `Complaint pathway ${pathway || 'general'} baseline`,
    label_ar: `مسار الشكوى ${pathway || 'عام'}`,
    result: 'noted',
    level: baseline,
  });

  // Limited pathway cues when modifier not yet selected
  if (pathway === 'chest_pain_cardiac' || pathway === 'chest_pain') {
    pushCandidate(candidates, { level: 2, rule_id: 'step2_chest_cardiac', label_en: 'Cardiac chest pain features → CTAS 2', label_ar: 'ألم صدري قلبي → CTAS 2' });
  }
  if (isYes(answers.radiation)) {
    pushCandidate(candidates, { level: 2, rule_id: 'step2_radiation', label_en: 'Pain radiation → CTAS 2', label_ar: 'إشعاع الألم → CTAS 2' });
  }
  if (isYes(answers.rigidity_guarding)) {
    pushCandidate(candidates, { level: 2, rule_id: 'step2_abdomen', label_en: 'Abdominal rigidity → CTAS 2', label_ar: 'صلابة بطنية → CTAS 2' });
  }
  if (isYes(answers.thunderclap) || isYes(answers.worst_headache_ever)) {
    pushCandidate(candidates, { level: 2, rule_id: 'step2_thunderclap', label_en: 'Thunderclap headache → CTAS 2', label_ar: 'صداع رعدي → CTAS 2' });
  }

  const level = candidates.reduce((min, c) => Math.min(min, c.level), baseline);
  return { candidates, applied, level, from_modifier: false };
}

function evaluateRespiratoryPrimary({ vitals, flags, norms, chronicity, baselineSpo2, homeOxygen }) {
  const candidates = [];
  const applied = [];
  if (vitals.spo2 != null) {
    const gate = hypoxiaShouldApply({
      spo2: vitals.spo2,
      chronicity,
      baselineSpo2,
      homeOxygen,
    });
    if (gate.suppressed) {
      applied.push({
        label_en: `SpO₂ ${vitals.spo2}% within chronic baseline — acute hypoxia floor suppressed`,
        label_ar: `SpO₂ ${vitals.spo2}% ضمن خط الأساس المزمن — كُبح سقف نقص الأكسجين الحاد`,
        result: 'chronicity_gate',
        evidence: { baselineSpo2, chronicity: chronicity?.status, reason: gate.reason },
      });
    } else if (vitals.spo2 < 88) {
      pushCandidate(candidates, { level: 1, rule_id: 'resp_critical_hypoxia', label_en: `SpO₂ ${vitals.spo2}% critical hypoxia`, label_ar: 'نقص أكسجين حرج' });
      applied.push({ label_en: `SpO₂ ${vitals.spo2}% — critical hypoxia`, label_ar: `SpO₂ ${vitals.spo2}% — نقص حرج`, result: 'CTAS 1 override' });
    } else if (vitals.spo2 < 92) {
      pushCandidate(candidates, { level: 2, rule_id: 'resp_severe_hypoxia', label_en: `SpO₂ ${vitals.spo2}% → CTAS 2`, label_ar: 'نقص أكسجين شديد' });
      applied.push({ label_en: `SpO₂ ${vitals.spo2}% → CTAS 2`, label_ar: `SpO₂ ${vitals.spo2}% → CTAS 2`, result: 'CTAS 2 min' });
    } else if (vitals.spo2 < 95) {
      pushCandidate(candidates, { level: 3, rule_id: 'resp_mild_hypoxia', label_en: `SpO₂ ${vitals.spo2}% → CTAS 3`, label_ar: 'نقص أكسجين خفيف' });
      applied.push({ label_en: `SpO₂ ${vitals.spo2}% → CTAS 3`, label_ar: `SpO₂ ${vitals.spo2}% → CTAS 3`, result: 'CTAS 3 min' });
    }
  }
  if (flags.moderate_respiratory_distress) {
    pushCandidate(candidates, { level: 2, rule_id: 'resp_mod_distress', label_en: 'Moderate respiratory distress → CTAS 2', label_ar: 'ضيق تنفس متوسط → CTAS 2' });
  }
  if (vitals.rr != null && vitals.rr > norms.RR.high) {
    pushCandidate(candidates, { level: 3, rule_id: 'resp_tachypnea', label_en: `RR ${vitals.rr} tachypnea → CTAS 3`, label_ar: 'تسرع تنفس → CTAS 3' });
  }
  return { candidates, applied };
}

function evaluateLocPrimary({ vitals, flags }) {
  const candidates = [];
  const applied = [];
  if (vitals.gcs != null) {
    if (vitals.gcs <= 8) {
      pushCandidate(candidates, { level: 1, rule_id: 'loc_unconscious', label_en: `GCS ${vitals.gcs} → CTAS 1`, label_ar: 'فقدان وعي' });
      applied.push({ label_en: `GCS ${vitals.gcs} unconscious`, label_ar: `GCS ${vitals.gcs}`, result: 'CTAS 1 override' });
    } else if (vitals.gcs <= 12) {
      pushCandidate(candidates, { level: 2, rule_id: 'loc_impaired', label_en: `GCS ${vitals.gcs} → CTAS 2`, label_ar: 'ضعف وعي' });
      applied.push({ label_en: `GCS ${vitals.gcs} → CTAS 2`, label_ar: `GCS ${vitals.gcs}`, result: 'CTAS 2 min' });
    } else if (vitals.gcs <= 14) {
      pushCandidate(candidates, { level: 3, rule_id: 'loc_mild', label_en: `GCS ${vitals.gcs} → CTAS 3`, label_ar: 'وعي منخفض قليلاً' });
    }
  } else if (flags.altered_loc) {
    pushCandidate(candidates, { level: 2, rule_id: 'loc_altered_flag', label_en: 'Altered LOC → CTAS 2', label_ar: 'اضطراب وعي → CTAS 2' });
  }
  return { candidates, applied };
}

function evaluatePainPrimary({ vitals, answers, isPediatric, chronicity }) {
  const candidates = [];
  const applied = [];
  const pain = vitals.pain;
  if (pain == null) return { candidates, applied };
  const central = /central|مركزي|داخلي/.test(answerText(answers.pain_location));
  const chronic = isChronicUnchanged(chronicity?.status)
    || /chronic|مزمن/.test(answerText(answers.pain_duration_type));
  // Acute-on-chronic / worse / new → allow pain upgrades
  const allowAcutePain = !chronic || isAcuteAcuity(chronicity?.status);
  if (pain >= 8) {
    if (isPediatric && allowAcutePain) {
      pushCandidate(candidates, { level: 2, rule_id: 'pain_ped_severe', label_en: `Severe pediatric pain ${pain}/10 → CTAS 2`, label_ar: 'ألم شديد أطفال' });
    } else if (central && allowAcutePain) {
      pushCandidate(candidates, { level: 2, rule_id: 'pain_central_acute', label_en: `Severe central acute pain → CTAS 2`, label_ar: 'ألم مركزي حاد شديد' });
    } else if (allowAcutePain) {
      pushCandidate(candidates, { level: 3, rule_id: 'pain_severe', label_en: `Severe pain ${pain}/10 → CTAS 3`, label_ar: 'ألم شديد' });
    } else {
      applied.push({
        label_en: `Severe pain ${pain}/10 — chronic unchanged, acute pain upgrade suppressed`,
        label_ar: `ألم شديد ${pain}/10 — مزمن مستقر، كُبح ترقية الألم الحاد`,
        result: 'chronicity_gate',
      });
    }
  } else if (pain >= 4 && allowAcutePain) {
    pushCandidate(candidates, { level: 4, rule_id: 'pain_moderate', label_en: `Moderate pain → CTAS 4`, label_ar: 'ألم متوسط' });
  } else if (pain >= 1) {
    pushCandidate(candidates, { level: 5, rule_id: 'pain_mild', label_en: `Mild pain ${pain}/10 → CTAS 5`, label_ar: 'ألم خفيف' });
    applied.push({ label_en: `Pain ${pain}/10 mild`, label_ar: `ألم ${pain}/10`, result: 'noted' });
  }
  return { candidates, applied };
}

function evaluatePediatricFeverBands({ vitals, ageGroup, appearance, flags }) {
  const candidates = [];
  const applied = [];
  const temp = vitals.temp;
  if (temp == null || temp < 38.0) return { candidates, applied };

  if (ageGroup === 'neonate') {
    pushCandidate(candidates, { level: 1, rule_id: 'ped_neonate_fever', label_en: 'Neonatal fever → CTAS 1 (configured band)', label_ar: 'حمى مولود → CTAS 1' });
    applied.push({ label_en: 'Neonatal fever sepsis protocol', label_ar: 'حمى مولودية', result: 'CTAS 1 override' });
  } else if (ageGroup === 'infant_1_3m') {
    pushCandidate(candidates, { level: 2, rule_id: 'ped_infant_fever', label_en: 'Infant 1–3m fever → CTAS 2', label_ar: 'حمى رضيع 1–3 أشهر → CTAS 2' });
  } else if (flags.poor_perfusion || appearance.shocked) {
    pushCandidate(candidates, { level: 1, rule_id: 'ped_fever_poor_perfusion', label_en: 'Febrile child with poor perfusion → CTAS 1', label_ar: 'طفل محموم مع سوء تروية' });
  } else if (appearance.looks_unwell || flags.moderate_respiratory_distress) {
    pushCandidate(candidates, { level: 2, rule_id: 'ped_fever_unwell', label_en: 'Febrile child looks unwell → CTAS 2', label_ar: 'طفل محموم يبدو معتلاً → CTAS 2' });
  } else {
    // Age-appropriate tachycardia alone must not force adult CTAS 1/2
    pushCandidate(candidates, { level: 3, rule_id: 'ped_fever_stable', label_en: 'Pediatric fever without compromise → CTAS 3 pending appearance', label_ar: 'حمى أطفال دون اضطراب → CTAS 3' });
  }
  return { candidates, applied };
}

function collectCtasChangingGaps({ normalized, sirs, hemo, feverResult, isPediatric, hasFever }) {
  const gaps = [];
  if (!hasFever && !isFeverPathway('', '')) return gaps;
  if (hasFever || feverResult?.level != null) {
    if (normalized.appearance.looks_unwell == null) {
      gaps.push({ field: 'looks_unwell', reason_en: 'Appearance distinguishes CTAS 3 vs 4 (and supports CTAS 2 pathways)', reason_ar: 'المظهر يميز CTAS 3 عن 4' });
    }
    if (!isPediatric && sirs && sirs.criteria.respiratory_rate === 'unknown') {
      gaps.push({ field: 'rr', reason_en: 'Measured RR needed for SIRS count (could reach CTAS 2 at ≥3)', reason_ar: 'معدل التنفس مطلوب لعدّ SIRS' });
    }
    if (normalized.flags.immunocompromised !== true && normalized.flags.immunocompromised !== false
      && !isYes(normalized.flags.immunocompromised)) {
      // only if answer missing
    }
    if (hemo?.tachycardia_class?.needs_clarification) {
      gaps.push({ field: 'unexplained_tachycardia', reason_en: 'Is tachycardia expected (fever/pain) or unexplained?', reason_ar: 'هل تسرع القلب متوقع أم غير مفسَّر؟' });
    }
    if (normalized.vitals.sbp == null && hasFever) {
      gaps.push({ field: 'bp_systolic', reason_en: 'BP needed to exclude hypotension / shock', reason_ar: 'الضغط لاستبعاد الصدمة' });
    }
  }
  return gaps.slice(0, 6);
}

/**
 * Main deterministic CTAS evaluation.
 */
export function evaluateCtasRules({ patient = {}, answers = {}, transcript = '' } = {}) {
  if (!patient) return null;

  const hasValidVital = (
    toVital(patient.hr, 20, 250) !== null
    || toVital(patient.spo2, 40, 100) !== null
    || toVital(patient.bp_systolic, 40, 300) !== null
    || toVital(patient.gcs, 3, 15) !== null
  );
  if (!patient.chief_complaint && !hasValidVital) return null;

  const ageGroup = getAgeGroup(patient.age);
  const isPediatric = isPediatricAgeGroup(ageGroup);
  const norms = getNorms(ageGroup);
  const selectedModifier = answers._selectedModifier || null;

  const tx = `${transcript || ''} ${patient.transcription || ''}`;
  const chronicity = detectSymptomChronicity({ patient, answers, transcript: tx });
  const baselineSpo2 = parseBaselineSpo2(patient, answers, tx);
  const homeOxygen = isYes(answers.home_oxygen)
    || /home\s+oxygen|on\s+o2\s+at\s+home|أكسجين\s*منزلي/i.test(tx);

  const normalized = normalizeClinicalFacts({ patient, answers, transcript });
  // Align vital chronicity flag with five-state detector
  if (isChronicUnchanged(chronicity.status)) {
    normalized.flags.chronic_stable_vitals = true;
  } else if (isAcuteAcuity(chronicity.status)) {
    normalized.flags.chronic_stable_vitals = false;
  }

  const complaint = mapComplaint(patient.chief_complaint, {
    transcript: tx,
    confirmedKey: patient.confirmed_complaint_key || null,
  });
  const pathway = complaint.pathway || 'general';

  // Merge septic shock flag
  normalized.flags.septic_shock = isYes(answers.septic_shock)
    || (
      normalized.appearance.shocked === true
      && isFeverPathway(pathway, patient.chief_complaint)
      && normalized.vitals.sbp != null
      && normalized.vitals.sbp < 90
    );

  const hasFever = isFeverPathway(pathway, patient.chief_complaint)
    || (normalized.vitals.temp != null && normalized.vitals.temp >= 38.0)
    || !!normalized.vitals.temp_qualitative_fever;

  const spo2Gate = hypoxiaShouldApply({
    spo2: normalized.vitals.spo2,
    chronicity,
    baselineSpo2,
    homeOxygen,
  });
  if (spo2Gate.suppressed) {
    normalized.vitals._suppress_spo2_floor = true;
  }

  // ── Step 0 ──
  const step0 = evaluateStep0({
    vitals: normalized.vitals,
    flags: normalized.flags,
    appearance: normalized.appearance,
  });

  // ── Step 1 ──
  const step1Incomplete = !patient.chief_complaint || !!complaint.needs_confirmation;
  const step1 = {
    complaint,
    incomplete: step1Incomplete,
    note_en: !patient.chief_complaint
      ? 'Unable to finalize CTAS without chief complaint selection'
      : complaint.needs_confirmation
        ? 'Confirm chief complaint before pathway CTAS'
        : complaint.why_en,
    note_ar: !patient.chief_complaint
      ? 'لا يمكن إتمام CTAS دون اختيار الشكوى'
      : complaint.needs_confirmation
        ? 'أكد الشكوى قبل CTAS المسار'
        : complaint.why_ar,
  };

  // ── Step 2 — when confirmation pending, still apply provisional most-urgent default ──
  let step2;
  if (complaint.needs_confirmation) {
    const provisional = complaint.resolution?.provisional_default_ctas
      ?? (complaint.resolution?.candidates || []).reduce(
        (min, c) => Math.min(min, Number(c.default_ctas) || 5),
        5,
      );
    const candidates = [];
    const applied = [{
      label_en: 'Pathway deferred pending complaint confirmation',
      label_ar: 'تأجيل المسار بانتظار تأكيد الشكوى',
      result: 'pending',
    }];
    if (provisional != null && provisional < 5) {
      pushCandidate(candidates, {
        level: provisional,
        rule_id: 'step2_provisional_pending_confirm',
        label_en: `Provisional CTAS ${provisional} from most-urgent candidate (confirm complaint)`,
        label_ar: `CTAS مؤقت ${provisional} من أقرب مرشح (أكد الشكوى)`,
        source: 'complaint_specific',
      });
      applied.push({
        label_en: `Provisional acuity floor CTAS ${provisional}`,
        label_ar: `حد مؤقت CTAS ${provisional}`,
        result: `CTAS ${provisional} min`,
      });
    }
    step2 = { candidates, applied, level: provisional < 5 ? provisional : null, from_modifier: false };
  } else {
    step2 = evaluateComplaintSpecific({
      complaint,
      selectedModifier,
      answers,
      pathway,
    });
  }

  // ── Step 3 primary modifiers (independent) ──
  const sirs = evaluateSirsCriteria({
    vitals: normalized.vitals,
    ageGroup,
    isPediatric,
  });

  const hemo = evaluateHemodynamicModifier({
    vitals: normalized.vitals,
    flags: normalized.flags,
    appearance: normalized.appearance,
    ageGroup,
    isPediatric,
    chronicityStable: !!normalized.flags.chronic_stable_vitals,
  });

  const feverAdult = (!isPediatric && hasFever)
    ? evaluateAdultFeverModifier({
      vitals: normalized.vitals,
      appearance: normalized.appearance,
      flags: normalized.flags,
      sirs,
      hemodynamic: hemo,
      hasFeverContext: hasFever,
    })
    : null;

  const feverPed = (isPediatric && hasFever)
    ? evaluatePediatricFeverBands({
      vitals: normalized.vitals,
      ageGroup,
      appearance: normalized.appearance,
      flags: normalized.flags,
    })
    : { candidates: [], applied: [] };

  const resp = evaluateRespiratoryPrimary({
    vitals: normalized.vitals,
    flags: normalized.flags,
    norms,
    chronicity,
    baselineSpo2,
    homeOxygen,
  });
  const loc = evaluateLocPrimary({ vitals: normalized.vitals, flags: normalized.flags });
  const pain = evaluatePainPrimary({ vitals: normalized.vitals, answers, isPediatric, chronicity });

  // Library CTAS effects only (destination-only excluded inside applyModifierLibraryEffects)
  const lib = applyModifierLibraryEffects(answers, 5);
  // Clarifying hints — skip sirs_criteria_count boolean fake ≥3
  const rawHints = resolveCtasHintsFromAnswers(answers);
  const safeHints = (rawHints.hints || []).filter((h) => h.field !== 'sirs_criteria_count');

  const primaryCandidates = [];
  pushCandidate(primaryCandidates, hemo.level != null ? {
    level: hemo.level,
    rule_id: hemo.rule_id,
    label_en: hemo.explanation_en,
    label_ar: hemo.explanation_ar,
    evidence: hemo.evidence,
    source: 'primary_hemodynamic',
  } : null);
  if (feverAdult?.level != null) {
    pushCandidate(primaryCandidates, {
      level: feverAdult.level,
      rule_id: feverAdult.rule_id,
      label_en: feverAdult.explanation_en,
      label_ar: feverAdult.explanation_ar,
      evidence: feverAdult.evidence,
      source: 'primary_fever',
    });
  }
  for (const c of feverPed.candidates || []) pushCandidate(primaryCandidates, { ...c, source: 'primary_fever_ped' });
  for (const c of resp.candidates) pushCandidate(primaryCandidates, { ...c, source: 'primary_respiratory' });
  for (const c of loc.candidates) pushCandidate(primaryCandidates, { ...c, source: 'primary_loc' });
  for (const c of pain.candidates) pushCandidate(primaryCandidates, { ...c, source: 'primary_pain' });

  for (const a of lib.applied || []) {
    if (a.ctas_effect != null) {
      pushCandidate(primaryCandidates, {
        level: a.ctas_effect,
        rule_id: a.id || 'modifier_library',
        label_en: a.label_en,
        label_ar: a.label_ar,
        source: 'modifier_library',
      });
    }
  }
  for (const h of safeHints) {
    pushCandidate(primaryCandidates, {
      level: h.ctas_hint,
      rule_id: `hint_${h.field}`,
      label_en: `${h.text_en} → CTAS ${h.ctas_hint}`,
      label_ar: h.text_ar,
      source: 'clarifying_hint',
    });
  }

  // Immuno + fever shortcut already inside feverAdult; also population immuno
  if (!isPediatric && hasFever && isYes(answers.immunocompromised)) {
    pushCandidate(primaryCandidates, {
      level: 2,
      rule_id: 'pop_immuno_fever',
      label_en: 'Immunocompromised + fever → CTAS 2',
      label_ar: 'نقص مناعة + حمى → CTAS 2',
      source: 'primary_fever',
    });
  }

  // ── Step 4 — min acuity ──
  const allCandidates = [
    ...step0.candidates,
    ...step2.candidates,
    ...primaryCandidates,
  ];

  let proposed = allCandidates.reduce((min, c) => Math.min(min, c.level), 5);
  if (!Number.isFinite(proposed) || allCandidates.length === 0) {
    proposed = complaint.default_ctas || 5;
  }
  proposed = Math.max(1, Math.min(5, proposed));

  // Incomplete complaint: still propose from vitals/primary but flag
  const cfg = CTAS_CONFIG[proposed] || CTAS_CONFIG[5];

  const justification_en = buildJustificationEn({
    proposed,
    feverAdult,
    hemo,
    sirs,
    allCandidates,
    hasFever,
    isPediatric,
  });
  const justification_ar = buildJustificationAr({ proposed, feverAdult, hemo, sirs });

  const missing = collectCtasChangingGaps({
    normalized,
    sirs,
    hemo,
    feverResult: feverAdult,
    isPediatric,
    hasFever,
  });
  if (step1Incomplete) {
    missing.unshift({
      field: 'chief_complaint',
      reason_en: 'Chief complaint required before final CTAS',
      reason_ar: 'الشكوى الرئيسية مطلوبة قبل CTAS النهائي',
    });
  }

  const primaryApplied = [
    ...(hemo.level != null ? [{
      label_en: hemo.explanation_en,
      label_ar: hemo.explanation_ar,
      result: `CTAS ${hemo.level} min`,
      domain: 'hemodynamic',
    }] : [{
      label_en: hemo.explanation_en,
      label_ar: hemo.explanation_ar,
      result: 'noted',
      domain: 'hemodynamic',
    }]),
    ...(feverAdult ? [{
      label_en: feverAdult.explanation_en,
      label_ar: feverAdult.explanation_ar,
      result: feverAdult.level != null ? `CTAS ${feverAdult.level} min` : 'noted',
      domain: 'fever',
      sirs,
    }] : []),
    ...feverPed.applied,
    ...resp.applied,
    ...loc.applied,
    ...pain.applied,
  ];

  const assessment_trail = {
    step0_critical_visual: {
      stable: step0.stable,
      alerts: step0.alerts,
      flags: step0.alerts.map((a) => ({ ar: a.ar, en: a.en })),
      note_ar: step0.note_ar,
      note_en: step0.note_en,
      candidates: step0.candidates,
    },
    // Back-compat aliases for LiveCTASPanel
    step1_first_look: {
      stable: step0.stable,
      flags: step0.alerts.map((a) => ({ ar: a.ar, en: a.en })),
      note_ar: step0.note_ar,
      note_en: step0.note_en,
    },
    step1_chief_complaint: step1,
    step2_complaint: {
      cedis: complaint.cedis ? `${complaint.cedis} — ${complaint.name_en}` : 'unset',
      name_ar: complaint.name_ar || '—',
      name_en: complaint.name_en || '—',
      initial_range: complaint.default_ctas ? `CTAS ${complaint.default_ctas}` : '—',
      pathway: complaint.needs_confirmation ? null : pathway,
      reason_ar: step2.applied[0]?.label_ar || complaint.why_ar,
      reason_en: step2.applied[0]?.label_en || complaint.why_en,
      why_selected_en: complaint.why_en,
      why_selected_ar: complaint.why_ar,
      modifiers: step2.applied,
      candidates: step2.candidates,
      needs_confirmation: !!complaint.needs_confirmation,
    },
    complaint_resolution: {
      status: complaint.resolution?.status || (complaint.needs_confirmation ? 'needs_confirmation' : 'auto'),
      selected_key: complaint.pathway || null,
      candidates: complaint.resolution?.candidates || complaint.secondary || [],
      needs_confirmation: !!complaint.needs_confirmation,
      version: complaint.resolution?.version || null,
    },
    chronicity: {
      status: chronicity.status,
      source: chronicity.source,
      confidence: chronicity.confidence,
      question_asked: false,
      question_needed: !!chronicity.question_needed,
      matched: chronicity.matched || null,
      baseline_spo2: baselineSpo2,
      home_oxygen: !!homeOxygen,
      spo2_floor_suppressed: !!spo2Gate.suppressed,
      influence: {
        pain_acute_allowed: !isChronicUnchanged(chronicity.status) || isAcuteAcuity(chronicity.status),
        hemo_stable: !!normalized.flags.chronic_stable_vitals,
      },
    },
    step3_first_order: {
      applied: primaryApplied,
      level_after: primaryCandidates.reduce((m, c) => Math.min(m, c.level), 5),
      hemodynamic: hemo,
      fever: feverAdult,
      sirs,
      respiratory: resp.applied,
      consciousness: loc.applied,
      pain: pain.applied,
    },
    step3_primary_modifiers: {
      hemodynamic: hemo,
      fever: feverAdult,
      fever_pediatric: feverPed,
      sirs,
      respiratory: resp,
      loc,
      pain,
    },
    step4_final: {
      candidates: allCandidates,
      proposed_ctas: proposed,
      justification_en,
      justification_ar,
      method: 'min_acuity_no_counting',
    },
    // Legacy empty shells so UI does not break
    step4_second_order: { applied: safeHints.map((h) => ({
      label_en: `${h.text_en} → CTAS ${h.ctas_hint}`,
      label_ar: h.text_ar,
      result: `CTAS ${h.ctas_hint} min`,
      source: 'ctas_hint',
    })), level_after: proposed },
    step5_population: { age_group: ageGroup, applied: [], level_after: proposed },
    step6_life_threats: {
      threats: step0.alerts,
      override: step0.alerts.some((a) => /shock|unconscious|airway|hypoxia|hemorrhage/i.test(a.en)),
    },
    final_level: proposed,
    missing_ctas_changing: missing,
    normalized_facts: normalized.facts,
    direction_separate: true,
    engine: 'ctasRulesEngine_v1',
  };

  const driving = allCandidates
    .filter((c) => c.level === proposed)
    .sort((a, b) => a.source.localeCompare(b.source))[0];

  return {
    level: proposed,
    ctas_level: proposed,
    ctas_ar: cfg.ar,
    ctas_en: cfg.en,
    max_wait_ar: cfg.wait_ar,
    max_wait_en: cfg.wait_en,
    max_wait_min: cfg.wait_min,
    hex: cfg.hex,
    primary_determinant_ar: driving?.label_ar || justification_ar,
    primary_determinant_en: driving?.label_en || justification_en,
    red_flags: step0.alerts.map((a) => a.ar),
    modifiers: primaryApplied,
    clinical_summary_ar: `${complaint.name_ar || 'شكوى'} — ${cfg.ar} (CTAS ${proposed}) — ${cfg.wait_ar}`,
    clinical_summary_en: `${complaint.name_en || 'Complaint'} — ${cfg.en} (CTAS ${proposed}) — ${cfg.wait_en}`,
    assessment_trail,
    justification_en,
    justification_ar,
    missing_ctas_changing: missing,
    data_complete: !!(patient.chief_complaint && patient.hr && patient.spo2 && patient.bp_systolic),
    incomplete_complaint: step1Incomplete,
    sirs,
    hemodynamic: hemo,
    fever: feverAdult,
  };
}

function buildJustificationEn({ proposed, feverAdult, hemo, sirs, allCandidates, hasFever, isPediatric }) {
  const parts = [`Proposed CTAS ${proposed}.`];
  if (feverAdult?.explanation_en) parts.push(feverAdult.explanation_en);
  else if (hasFever && isPediatric) parts.push('Pediatric fever pathway used age-configured bands (not adult SIRS cutoffs).');
  if (hemo?.explanation_en) parts.push(`Hemodynamic: ${hemo.explanation_en}`);
  if (sirs && !sirs.not_applicable) {
    parts.push(`SIRS known positive=${sirs.known_positive_count} (temp/HR/RR/WBC each counted once; WBC unknown not assumed abnormal).`);
  }
  if (feverAdult?.candidates_rejected?.ctas_1) {
    parts.push(`CTAS 1 not supported: ${feverAdult.candidates_rejected.ctas_1}.`);
  }
  if (feverAdult?.candidates_rejected?.ctas_2) {
    parts.push(`CTAS 2 not supported: ${feverAdult.candidates_rejected.ctas_2}.`);
  }
  parts.push(`Final level is the highest-acuity (lowest number) among ${allCandidates.length} valid modifier candidates — no averaging or abnormality counting.`);
  return parts.join(' ');
}

function buildJustificationAr({ proposed, feverAdult, hemo, sirs }) {
  const parts = [`المستوى المقترح CTAS ${proposed}.`];
  if (feverAdult?.explanation_ar) parts.push(feverAdult.explanation_ar);
  if (hemo?.explanation_ar) parts.push(hemo.explanation_ar);
  if (sirs && !sirs.not_applicable) {
    parts.push(`معايير SIRS الإيجابية المعروفة=${sirs.known_positive_count}.`);
  }
  return parts.join(' ');
}

export { getAgeGroup, AGE_NORMS } from './ageNorms.js';
