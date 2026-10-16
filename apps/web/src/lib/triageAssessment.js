/**
 * Display-side rules that sit on top of the CTAS engine. Pure functions with the
 * clinical package passed in, so the same logic runs in the browser and in the
 * scenario validation script (scripts/validate-triage-scenarios.mjs).
 *
 * The engine decides acuity. This module only decides what may be SHOWN:
 * - never a default low level when CTAS-changing data is missing ("CTAS pending")
 * - an early level when findings already point to CTAS 1-3 ("at least")
 * - the patient direction from the approved routing rules, kept separate from CTAS
 * - which missing items to ask the nurse to mention next
 */

/** Fields that can change CTAS. If any is missing, CTAS 4-5 is never shown. */
export const CORE_KEYS = ['age', 'chief_complaint', 'pain_score', 'hr', 'bp_systolic', 'spo2', 'rr', 'temperature', 'gcs'];

/** Order in which missing items are prompted during dictation (highest CTAS impact first). */
export const PROMPT_ORDER = ['chief_complaint', 'spo2', 'rr', 'hr', 'bp_systolic', 'gcs', 'temperature', 'pain_score', 'age', 'weight'];

const PROMPT_LABELS = {
  chief_complaint: { ar: 'الشكوى الرئيسية', en: 'chief complaint' },
  spo2: { ar: 'تشبع الأكسجين', en: 'oxygen saturation' },
  rr: { ar: 'معدل التنفس', en: 'respiratory rate' },
  hr: { ar: 'النبض', en: 'heart rate' },
  bp_systolic: { ar: 'ضغط الدم', en: 'blood pressure' },
  gcs: { ar: 'مستوى الوعي (GCS)', en: 'GCS' },
  temperature: { ar: 'الحرارة', en: 'temperature' },
  pain_score: { ar: 'درجة الألم', en: 'pain score' },
  age: { ar: 'العمر', en: 'age' },
  weight: { ar: 'الوزن', en: 'weight' },
};

export function isPediatricAge(age) {
  const n = parseFloat(age);
  return Number.isFinite(n) && n < 14;
}

/**
 * @param {object} input
 * @param {object} input.patient
 * @param {number|null} input.liveLevel       computeLiveCTAS level
 * @param {number|null} input.evalLevel       modifier-engine updated level
 * @param {object|null} input.modifierEvaluation
 * @param {object} input.answers              clarifying answers (engine values only)
 * @param {object|null} input.visualTriage
 * @param {object} clinical                   the @triagepulse/clinical exports
 */
export function deriveAssessment({
  patient, liveLevel = null, evalLevel = null, modifierEvaluation = null, answers = {}, visualTriage = null,
  complaints = null,
}, clinical) {
  // Most urgent wins between the live rules result and the modifier engine.
  const levels = [liveLevel, evalLevel].filter((n) => n != null);
  const engineLevel = levels.length ? Math.min(...levels) : null;

  const missingFields = clinical.CTAS_REQUIRED_FIELDS.filter((f) => !f.check(patient));
  const missingKeys = missingFields.map((f) => f.key);
  const coreMissing = CORE_KEYS.filter((k) => missingKeys.includes(k));

  let level = null;
  let atLeast = false;
  if (engineLevel != null) {
    if (patient.chief_complaint && coreMissing.length === 0) level = engineLevel;
    else if (engineLevel <= 3) { level = engineLevel; atLeast = coreMissing.length > 0; }
  }

  const pediatric = isPediatricAge(patient.age);
  const direction = level != null
    ? clinical.resolveCtasDestination({
        level,
        age: patient.age,
        answers,
        visualDestination: visualTriage,
        applied: modifierEvaluation?.applied_modifiers || [],
        directionApplied: modifierEvaluation?.direction_applied || [],
        // Every complaint heard (not only the primary one) counts for the routing guide.
        complaints: complaints?.length
          ? complaints
          : [{ key: patient.confirmed_complaint_key || null, text: patient.chief_complaint || '' }],
      })
    : null;
  const rule = (modifierEvaluation?.direction_applied || []).find((d) => d.destination_hint);
  const directionReason = !direction ? null
    : direction.from_isolation_hold ? 'عزل تنفسي من الفرز البصري · Respiratory isolation from visual triage'
      : direction.from_routing_guide ? `دليل توجيه الأطفال: ${direction.from_routing_guide.label_ar} → الملاحظة · Paediatric routing guide: ${direction.from_routing_guide.label_en} → Observation`
      : direction.from_direction_rule && rule ? (rule.label_ar || rule.label_en)
        : `CTAS ${level} · ${pediatric ? 'مسار الأطفال · pediatric routing' : 'مسار البالغين · adult routing'}`;

  return {
    engineLevel,
    level,
    atLeast,
    pending: level == null,
    missingFields,
    missingKeys,
    coreMissing,
    pediatric,
    direction,
    directionReason,
    critical: (level != null && level <= 2) || !!modifierEvaluation?.critical_alert,
  };
}

/**
 * What to ask the nurse to mention next while recording: at most two items, in
 * CTAS-impact order. Weight is only prompted for children.
 */
export function nextPrompt(missingKeys, patient) {
  const pediatric = isPediatricAge(patient.age);
  const keys = PROMPT_ORDER
    .filter((k) => missingKeys.includes(k))
    .filter((k) => k !== 'weight' || pediatric)
    .slice(0, 2);
  if (!keys.length) return null;
  return {
    keys,
    ar: `اذكر: ${keys.map((k) => PROMPT_LABELS[k].ar).join(' و')}`,
    en: `Please mention ${keys.map((k) => PROMPT_LABELS[k].en).join(' and ')}`,
  };
}
