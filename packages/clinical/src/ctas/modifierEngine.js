/**
 * Clarifying Question Engine — gap-driven questions by category:
 * CTAS modifier | patient direction | safety escalation.
 * Suppress known facts; max 3 questions; re-evaluate after each answer.
 */
import {
  normalizePathwayFamily,
  pathwaysAreAliases,
} from './clarifyingQuestionBank.js';
import { applyModifierLibraryEffects, getActiveModifiers } from './modifierLibrary.js';
import { computeLiveCTAS } from './vitalRanges.js';
import {
  buildKnownFacts,
  shouldSuppressQuestion,
  summarizeKnownFacts,
} from './knownFactsEngine.js';
import { resolveCtasDestination } from './ctasDestination.js';

export const MAX_QUESTIONS = 3;
export { resolveCtasDestination, CTAS_DESTINATIONS } from './ctasDestination.js';

function buildContextText(patient = {}, answers = {}, transcript = '') {
  const parts = [
    transcript,
    patient.chief_complaint,
    patient.transcription,
    patient.relevant_history,
    patient.allergies,
    patient.current_medications,
    answers._transcript,
    ...Object.entries(answers)
      .filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => `${k}: ${v}`),
  ];
  if (Array.isArray(patient.current_medications)) {
    parts.push(patient.current_medications.join(' '));
  }
  return parts.filter(Boolean).join(' \n ').toLowerCase();
}

/**
 * Exact / alias match first; family match only when both sides share the same
 * normalized family (so head LOC modifiers do not match limb_pain).
 */
function pathwayMatches(modifier, pathway) {
  if (!modifier.pathways?.length || modifier.pathways.includes('*')) return true;
  if (modifier.pathways.includes(pathway)) return true;
  if (modifier.pathways.some((p) => pathwaysAreAliases(p, pathway))) return true;
  const family = normalizePathwayFamily(pathway);
  return modifier.pathways.some((p) => {
    if (p === family) return true;
    return normalizePathwayFamily(p) === family;
  });
}

function ageMatches(modifier, patient = {}) {
  const age = parseFloat(patient.age);
  const pediatric = Number.isFinite(age) && age < 14;
  if (modifier.age_applicability === 'both' || !modifier.age_applicability) return true;
  if (modifier.age_applicability === 'pediatric') return pediatric;
  if (modifier.age_applicability === 'adult') {
    if (patient.gender === 'male' && modifier.field === 'possible_pregnancy') return false;
    return !pediatric;
  }
  return true;
}

function ctasLevelMatches(modifier, level) {
  const allowed = modifier.shown_when_ctas;
  if (!Array.isArray(allowed) || !allowed.length) return true;
  return allowed.includes(Number(level));
}

/**
 * Detect whether a modifier answer is already known from conversation / form.
 * @returns {{ known: boolean, value?: string, source?: string, status?: string, confidence?: number }}
 */
export function detectKnownModifier(modifier, { patient = {}, answers = {}, transcript = '' } = {}) {
  if (answers[modifier.field] != null && answers[modifier.field] !== '') {
    return {
      known: true,
      value: String(answers[modifier.field]),
      source: 'answers',
      status: 'known_positive',
      confidence: 1,
    };
  }
  if (patient[modifier.field] != null && patient[modifier.field] !== '') {
    return {
      known: true,
      value: String(patient[modifier.field]),
      source: 'patient',
      status: 'known_positive',
      confidence: 0.95,
    };
  }

  const facts = buildKnownFacts({
    patient,
    answers,
    transcript,
    modifiers: [modifier],
  });
  const fact = facts[modifier.field];
  if (fact && fact.status !== 'unknown' && fact.status !== 'uncertain') {
    const known = fact.status === 'known_positive'
      || fact.status === 'known_negative'
      || fact.status === 'probable';
    return {
      known,
      value: fact.value || undefined,
      source: fact.source,
      status: fact.status,
      confidence: fact.confidence,
    };
  }

  const ctx = buildContextText(patient, answers, transcript);
  if (!ctx.trim()) return { known: false, status: 'unknown' };

  for (const re of modifier.detect_patterns || []) {
    if (re.test(ctx)) {
      const negated = new RegExp(`(?:no|not|denies|بدون|لا\\s*(?:يوجد)?|ينفي).{0,24}(?:${re.source})`, 'i');
      if (negated.test(ctx)) {
        return { known: true, value: 'لا', source: 'transcript_negated', status: 'known_negative', confidence: 0.9 };
      }
      return { known: true, value: 'نعم', source: 'transcript', status: 'known_positive', confidence: 0.88 };
    }
  }

  for (const re of modifier.related_medications || []) {
    if (re.test(ctx)) {
      return { known: true, value: 'نعم', source: 'medication', status: 'probable', confidence: 0.75 };
    }
  }

  return { known: false, status: 'unknown' };
}

function categoryRank(category) {
  if (category === 'safety_escalation') return 0;
  if (category === 'ctas_modifier') return 1;
  return 2;
}

/**
 * Select only missing, clinically relevant modifiers. Cap at MAX_QUESTIONS.
 * @param {object} [opts]
 * @param {string} [opts.pathway]
 * @param {number} [opts.level]
 * @param {Record<string, unknown>} [opts.patient]
 * @param {Record<string, unknown>} [opts.answers]
 * @param {string} [opts.transcript]
 * @param {Record<string, unknown>|null} [opts.visualTriage]
 * @param {number} [opts.maxQuestions]
 * @param {Record<string, unknown>|null} [opts.knownFacts]
 * @param {boolean} [opts.skipCtasVerification] When true (Step 2 CTAS already chosen),
 *   do not ask further ctas_modifier questions for acuity re-verification — only
 *   safety_escalation + patient_direction gaps.
 */
export function selectMissingModifiers({
  pathway = 'general',
  level = 5,
  patient = {},
  answers = {},
  transcript = '',
  visualTriage = null,
  maxQuestions = MAX_QUESTIONS,
  knownFacts = null,
  skipCtasVerification = false,
} = {}) {
  const modifiers = getActiveModifiers();
  const facts = knownFacts || buildKnownFacts({
    patient,
    answers,
    transcript: transcript || patient?.transcription || '',
    visualTriage,
    modifiers,
  });

  const candidates = modifiers
    .filter((m) => pathwayMatches(m, pathway))
    .filter((m) => ageMatches(m, patient))
    .filter((m) => ctasLevelMatches(m, level))
    .map((m) => {
      const detected = detectKnownModifier(m, { patient, answers, transcript });
      const fact = facts[m.field];
      const category = m.question_category || 'ctas_modifier';
      const isUniversalDirection = category === 'patient_direction'
        && Array.isArray(m.pathways)
        && m.pathways.includes('*');
      // Gap-driven only: do not ask universal direction checklist items with no cue
      const noDirectionCue = isUniversalDirection
        && !(fact && fact.status !== 'unknown' && fact.status !== 'uncertain')
        && !detected.known
        && !(answers[m.field] != null && answers[m.field] !== '');
      const suppressed = shouldSuppressQuestion(
        fact || (detected.known
          ? { status: detected.status || 'known_positive', value: detected.value }
          : { status: 'unknown' }),
        category,
      ) || (detected.known && detected.status !== 'probable')
        || (detected.known && detected.status === 'probable' && category === 'patient_direction')
        || (skipCtasVerification && category === 'ctas_modifier')
        || (skipCtasVerification && noDirectionCue);
      return { modifier: m, detected, fact, category, suppressed };
    });

  const known = candidates.filter((c) => c.detected.known || (c.fact && c.fact.status !== 'unknown'));
  const missing = candidates
    .filter((c) => !c.suppressed)
    .sort((a, b) => {
      const cat = categoryRank(a.category) - categoryRank(b.category);
      if (cat !== 0) return cat;
      return (a.modifier.priority ?? 99) - (b.modifier.priority ?? 99);
    })
    .slice(0, maxQuestions);

  const autoAnswers = { ...answers };
  for (const k of known) {
    if (!k.detected.known && !(k.fact?.value)) continue;
    if (autoAnswers[k.modifier.field] == null || autoAnswers[k.modifier.field] === '') {
      autoAnswers[k.modifier.field] = k.detected.value || k.fact?.value;
    }
  }

  const questions = missing.map(({ modifier: m, category }) => ({
    id: m.id,
    field: m.field,
    text_ar: m.question_ar,
    text_en: m.question_en,
    answer_type: m.answer_type === 'multiple_choice' ? 'options' : m.answer_type,
    answer_options: (m.options || []).map((o) => o.value),
    clinical_relevance: m.clinical_explanation_en,
    clinical_relevance_ar: m.clinical_explanation_ar,
    reason_en: m.clinical_explanation_en,
    reason_ar: m.clinical_explanation_ar,
    question_category: category,
    category,
    potential_impact: category === 'ctas_modifier'
      ? 'May change proposed CTAS'
      : category === 'patient_direction'
        ? 'May change destination / review path (not CTAS alone)'
        : 'May trigger safety escalation',
    potential_impact_ar: category === 'ctas_modifier'
      ? 'قد يغيّر مستوى CTAS المقترح'
      : category === 'patient_direction'
        ? 'قد يغيّر الوجهة / مسار المراجعة (دون رفع CTAS وحده)'
        : 'قد يفعل تصعيداً أمنياً فورياً',
    source: 'modifier_engine',
    priority: m.priority,
    critical_alert: !!m.critical_alert,
    team_leader_review: !!m.team_leader_review,
    ctas_effect_yes: category === 'patient_direction' ? null : (m.ctas_effect_yes ?? null),
  }));

  return {
    questions,
    known_modifiers: known.map((k) => ({
      id: k.modifier.id,
      field: k.modifier.field,
      name: k.modifier.name,
      name_ar: k.modifier.name_ar,
      value: k.detected.value || k.fact?.value,
      source: k.detected.source || k.fact?.source,
      status: k.detected.status || k.fact?.status,
      category: k.category,
      explanation_en: k.modifier.clinical_explanation_en,
      explanation_ar: k.modifier.clinical_explanation_ar,
    })),
    known_facts: summarizeKnownFacts(facts),
    missing_modifier_ids: missing.map((m) => m.modifier.id),
    autoAnswers,
    level: Number(level) || 5,
    pathway,
  };
}

export { applyModifierLibraryEffects } from './modifierLibrary.js';

function suggestDestination({
  level,
  patient = {},
  answers = {},
  visualTriage = null,
  applied = [],
  directionApplied = [],
} = {}) {
  return resolveCtasDestination({
    level,
    age: patient.age,
    answers,
    visualDestination: visualTriage?.destination || visualTriage || patient.vt_destination || null,
    applied,
    directionApplied,
  });
}

function buildChangeExplanation(initialLevel, finalLevel, applied = [], directionApplied = []) {
  const destOnly = directionApplied.length > 0 && applied.length === 0 && initialLevel === finalLevel;
  if (destOnly) {
    const reasonsEn = directionApplied.map((a) => a.label_en).filter(Boolean).join('; ');
    const reasonsAr = directionApplied.map((a) => a.label_ar).filter(Boolean).join('؛ ');
    return {
      changed: false,
      destination_changed: true,
      ar: `مستوى CTAS بقي ${finalLevel}. توجيه الوجهة/المراجعة: ${reasonsAr}`,
      en: `CTAS remains Level ${finalLevel}. Destination/review guidance: ${reasonsEn}`,
    };
  }
  if (initialLevel === finalLevel) {
    return {
      changed: false,
      destination_changed: directionApplied.some((a) => a.destination_hint),
      ar: `المستوى المقترح بقي CTAS ${finalLevel}`,
      en: `Proposed CTAS remains Level ${finalLevel}`,
    };
  }
  const reasonsEn = applied.map((a) => a.label_en).filter(Boolean).join('; ');
  const reasonsAr = applied.map((a) => a.label_ar).filter(Boolean).join('؛ ');
  return {
    changed: true,
    destination_changed: !!directionApplied.length,
    ar: `تغير المستوى المقترح من CTAS ${initialLevel} إلى CTAS ${finalLevel} لأن: ${reasonsAr}`,
    en: `Proposed CTAS changed from Level ${initialLevel} to Level ${finalLevel} because: ${reasonsEn}`,
  };
}

/**
 * Full clarifying-engine evaluation after initial CTAS.
 * @param {object} [opts]
 * @param {Record<string, unknown>} [opts.patient]
 * @param {Record<string, unknown>} [opts.answers]
 * @param {string} [opts.transcript]
 * @param {string} [opts.pathway]
 * @param {number} [opts.initialLevel]
 * @param {number} [opts.maxQuestions]
 * @param {Record<string, unknown>|null} [opts.visualTriage]
 * @param {boolean} [opts.skipCtasVerification]
 * @returns {{
 *   initial_ctas: number,
 *   updated_ctas: number,
 *   ctas_changed: boolean,
 *   live_result: object|null,
 *   questions: Array<Record<string, unknown>>,
 *   known_modifiers: Array<Record<string, unknown>>,
 *   known_facts: Array<Record<string, unknown>>,
 *   missing_modifier_ids: string[],
 *   autoAnswers: Record<string, unknown>,
 *   applied_modifiers: Array<Record<string, unknown>>,
 *   direction_applied: Array<Record<string, unknown>>,
 *   safety_applied: Array<Record<string, unknown>>,
 *   answer_impacts: Array<Record<string, unknown>>,
 *   explanation: object,
 *   suggested_destination: object|null,
 *   destination_changed: boolean,
 *   team_leader_review: boolean,
 *   critical_alert: boolean,
 *   provider_confirmation_required: boolean,
 *   pathway: string,
 * }}
 */
export function evaluateModifierEngine({
  patient = {},
  answers = {},
  transcript = '',
  pathway,
  initialLevel,
  maxQuestions = MAX_QUESTIONS,
  visualTriage = null,
  skipCtasVerification = false,
} = {}) {
  const path = pathway
    || patient?.assessment_pathway
    || 'general';

  const tx = transcript || patient?.transcription || '';
  const modifiers = getActiveModifiers();
  const knownFacts = buildKnownFacts({
    patient,
    answers,
    transcript: tx,
    visualTriage,
    modifiers,
  });

  const baselineAnswers = { ...answers };
  const baseline = computeLiveCTAS(patient, baselineAnswers);
  const startLevel = Number(initialLevel) || baseline?.level || 5;

  const selection = selectMissingModifiers({
    pathway: path,
    level: startLevel,
    patient,
    answers: baselineAnswers,
    transcript: tx,
    visualTriage,
    maxQuestions,
    knownFacts,
    skipCtasVerification,
  });

  const scoringAnswers = {
    ...selection.autoAnswers,
    _selectedModifier: answers._selectedModifier,
  };

  const live = computeLiveCTAS(patient, scoringAnswers);
  let levelAfterRules = live?.level ?? startLevel;
  const libEffects = applyModifierLibraryEffects(scoringAnswers, levelAfterRules);
  const finalLevel = libEffects.level;

  const applied = [
    ...(live?.assessment_trail?.step2_complaint?.modifiers || []).filter(
      (m) => m.result && m.result !== 'noted' && m.result !== 'no modifier',
    ),
    ...(live?.assessment_trail?.step3_first_order?.applied || []).filter(
      (m) => m.result && m.result !== 'noted' && m.result !== 'no modifier',
    ),
    ...(live?.assessment_trail?.step4_second_order?.applied || []).filter(
      (m) => m.source === 'ctas_hint' || /→ CTAS/i.test(m.label_en || ''),
    ),
    ...(live?.assessment_trail?.step4_final?.candidates || [])
      .filter((c) => c.level <= (live?.level ?? 5) && /radiation|إشعاع/i.test(c.label_en || c.label_ar || ''))
      .map((c) => ({
        label_en: c.label_en,
        label_ar: c.label_ar,
        field: 'radiation',
        result: `CTAS ${c.level} min`,
        source: c.source,
      })),
    ...libEffects.applied,
  ];

  const seen = new Set();
  const uniqueApplied = applied.filter((a) => {
    const key = a.field || a.label_en;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const directionApplied = libEffects.direction_applied || [];
  const safetyApplied = libEffects.safety_applied || [];

  const explanation = buildChangeExplanation(
    startLevel,
    finalLevel,
    libEffects.applied.length ? libEffects.applied : uniqueApplied.slice(0, 3),
    directionApplied,
  );

  const destination = suggestDestination({
    level: finalLevel,
    patient,
    answers: scoringAnswers,
    visualTriage,
    applied: libEffects.applied,
    directionApplied,
  });
  const needsTeamLeader = libEffects.applied.some((a) => a.team_leader_review)
    || directionApplied.some((a) => a.team_leader_review)
    || selection.questions.some((q) => q.team_leader_review);
  const critical = libEffects.applied.some((a) => a.critical_alert)
    || safetyApplied.some((a) => a.critical_alert || a.safety_alert)
    || selection.questions.some((q) => q.critical_alert);

  return {
    initial_ctas: startLevel,
    updated_ctas: finalLevel,
    ctas_changed: startLevel !== finalLevel,
    live_result: live
      ? {
          ...live,
          level: finalLevel,
          ctas_level: finalLevel,
        }
      : null,
    questions: selection.questions,
    known_modifiers: selection.known_modifiers,
    known_facts: selection.known_facts,
    missing_modifier_ids: selection.missing_modifier_ids,
    autoAnswers: selection.autoAnswers,
    applied_modifiers: uniqueApplied,
    direction_applied: directionApplied,
    safety_applied: safetyApplied,
    answer_impacts: [
      ...libEffects.applied.map((a) => ({ ...a, impact: 'ctas' })),
      ...directionApplied.map((a) => ({ ...a, impact: 'destination' })),
      ...safetyApplied.map((a) => ({ ...a, impact: 'safety' })),
    ],
    explanation,
    suggested_destination: destination,
    destination_changed: !!explanation.destination_changed || !!directionApplied.length,
    team_leader_review: needsTeamLeader,
    critical_alert: critical,
    provider_confirmation_required: true,
    pathway: path,
  };
}

/**
 * Re-run full engine after nurse answers (reselect gaps + rescore by category).
 * @param {object} [opts]
 * @param {Record<string, unknown>} [opts.patient]
 * @param {Record<string, unknown>} [opts.answers]
 * @param {number} [opts.initialLevel]
 * @param {string} [opts.pathway]
 * @param {string} [opts.transcript]
 * @param {Record<string, unknown>|null} [opts.visualTriage]
 * @param {number} [opts.maxQuestions]
 * @param {boolean} [opts.skipCtasVerification]
 */
export function rescoreWithModifierAnswers({
  patient = {},
  answers = {},
  initialLevel,
  pathway,
  transcript = '',
  visualTriage = null,
  maxQuestions = MAX_QUESTIONS,
  skipCtasVerification = false,
} = {}) {
  return evaluateModifierEngine({
    patient,
    answers,
    transcript: transcript || patient?.transcription || '',
    pathway,
    initialLevel,
    maxQuestions,
    visualTriage,
    skipCtasVerification,
  });
}
