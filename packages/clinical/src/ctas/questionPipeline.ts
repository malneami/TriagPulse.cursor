/**
 * Unified clarifying-question pipeline:
 * clarifying engine → clarifying bank → (optional) LLM fallback by caller.
 * Suppresses questions whose answers are already known from form/transcript.
 */
import { evaluateModifierEngine, MAX_QUESTIONS as ENGINE_MAX } from './modifierEngine.js';
import {
  getClarifyingQuestions,
  toUiQuestion,
  getBankQuestionById,
  normalizePathwayFamily,
} from './clarifyingQuestionBank.js';
import { resolveClinicalPathway } from './resolveClinicalPathway.js';
import { detectMentionedFields } from '../stt/transcriptAnalysis';
import type { CtasFieldKey } from '../stt/ctasFieldSchema';
import { detectSymptomChronicity } from './detectSymptomChronicity.js';

/** Bank fields that belong only on trauma / limb pathways. */
const TRAUMA_BANK_FIELDS = new Set([
  'high_energy_mechanism',
  'loc_any',
  'weight_bearing',
  'swelling_deformity',
  'moi_high_risk',
]);

const TRAUMA_OR_LIMB_FAMILIES = new Set(['head_trauma', 'limb_trauma', 'trauma']);

function filterTraumaBankFields(
  questions: Array<Record<string, unknown>>,
  pathway: string,
): Array<Record<string, unknown>> {
  const family = normalizePathwayFamily(pathway);
  if (TRAUMA_OR_LIMB_FAMILIES.has(family)) return questions;
  return questions.filter((q) => !TRAUMA_BANK_FIELDS.has(String(q.field || '')));
}

const PATIENT_FIELD_ALIASES: Record<string, string[]> = {
  hr: ['hr', 'heart_rate'],
  spo2: ['spo2', 'oxygen_saturation'],
  bp_systolic: ['bp_systolic', 'sbp'],
  rr: ['rr', 'respiratory_rate'],
  temperature: ['temperature', 'temp'],
  gcs: ['gcs'],
  pain_score: ['pain_score', 'pain'],
  chief_complaint: ['chief_complaint'],
  age: ['age'],
  patient_name_ar: ['patient_name_ar', 'name'],
  patient_name_en: ['patient_name_en', 'name'],
  symptom_chronicity: ['symptom_chronicity'],
  onset_duration: ['onset_duration'],
};

function maybePrependChronicityQuestion(
  questions: Array<Record<string, unknown>>,
  patient: Record<string, unknown>,
  answers: Record<string, unknown>,
  transcript: string,
  maxQuestions: number,
): Array<Record<string, unknown>> {
  const base = questions.filter((q) => q.field !== 'symptom_chronicity');
  const chron = detectSymptomChronicity({ patient, answers, transcript });
  if (!chron.question_needed || answers.symptom_chronicity || patient.symptom_chronicity) {
    return base.slice(0, maxQuestions);
  }
  const bankQ = getBankQuestionById?.('symptom_chronicity_baseline');
  const ui = bankQ ? toUiQuestion(bankQ) : null;
  if (!ui) return base.slice(0, maxQuestions);
  // Prefer CTAS-changing clinical gaps first; append chronicity if room remains
  if (base.length >= maxQuestions) {
    return base.slice(0, maxQuestions);
  }
  return [...base, ui as Record<string, unknown>].slice(0, maxQuestions);
}

function isFilled(patient: Record<string, unknown>, field: string): boolean {
  const aliases = PATIENT_FIELD_ALIASES[field] || [field];
  return aliases.some((k) => {
    const v = patient[k];
    return v != null && v !== '';
  });
}

/** Drop questions for fields already present on the patient form or mentioned+extracted. */
export function filterKnownQuestions(
  questions: Array<Record<string, unknown>>,
  patient: Record<string, unknown> = {},
  transcript = '',
): Array<Record<string, unknown>> {
  const mentioned = detectMentionedFields(transcript || String(patient.transcription || ''));
  return (questions || []).filter((q) => {
    const field = String(q.field || '');
    if (!field) return true;
    if (isFilled(patient, field)) return false;
    if (mentioned.has(field as CtasFieldKey) && isFilled(patient, field)) return false;
    return true;
  });
}

export interface QuestionPipelineResult {
  questions: Array<Record<string, unknown>>;
  source: 'modifier_engine' | 'bank' | 'empty';
  level: number;
  modifier_evaluation: ReturnType<typeof evaluateModifierEngine> | null;
  autoAnswers: Record<string, unknown>;
  known_modifiers: unknown[];
  known_facts?: unknown[];
}

/**
 * Run clarifying engine first; if no missing modifiers, fall back to bank.
 * Caller may invoke LLM only when source === 'empty'.
 */
export function runClarifyingQuestionPipeline({
  patient = {},
  answers = {},
  transcript = '',
  pathway = 'general',
  level = 5,
  selectedModifier = null,
  maxQuestions = ENGINE_MAX,
  visualTriage = null,
}: {
  patient?: Record<string, unknown>;
  answers?: Record<string, unknown>;
  transcript?: string;
  pathway?: string;
  level?: number;
  selectedModifier?: unknown;
  maxQuestions?: number;
  visualTriage?: Record<string, unknown> | null;
} = {}): QuestionPipelineResult {
  const tx = transcript || String(patient.transcription || '');
  const resolved = resolveClinicalPathway({
    patient,
    transcript: tx,
    preferredPathway: pathway && pathway !== 'general' ? pathway : null,
  });
  const effectivePathway = resolved.pathway;

  // Step 2 complaint modifier already set proposed CTAS — do not ask more
  // engine ctas_modifier questions solely to re-verify acuity.
  // Pathway bank still runs for clinical completeness after lock.
  // Exception: fever pathway still needs appearance / immuno gaps (CTAS-changing).
  const feverPathway = effectivePathway === 'fever'
    || effectivePathway === 'fever_unspecified'
    || effectivePathway.includes('fever');
  const skipCtasVerification = !!selectedModifier && !feverPathway;
  const evaluation = evaluateModifierEngine({
    patient,
    answers: { ...answers, _selectedModifier: selectedModifier },
    transcript: tx,
    pathway: effectivePathway,
    initialLevel: level,
    maxQuestions,
    visualTriage,
    skipCtasVerification,
  });

  if (evaluation.questions?.length) {
    const questions = filterKnownQuestions(evaluation.questions as Array<Record<string, unknown>>, patient, tx);
    const withChron = maybePrependChronicityQuestion(questions, patient, answers, tx, maxQuestions);
    return {
      questions: withChron,
      source: withChron.length ? 'modifier_engine' : 'empty',
      level: evaluation.initial_ctas,
      modifier_evaluation: evaluation,
      autoAnswers: evaluation.autoAnswers || {},
      known_modifiers: evaluation.known_modifiers || [],
      known_facts: evaluation.known_facts || [],
    };
  }

  const stringAnswers: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers || {})) {
    if (v == null || v === '') continue;
    stringAnswers[k] = String(v);
  }
  const bank = getClarifyingQuestions({ level, pathway: effectivePathway, answers: stringAnswers });
  const bankQs = filterKnownQuestions(
    (bank.questions || []) as Array<Record<string, unknown>>,
    patient,
    tx,
  );

  // Trauma/limb bank fields only when pathway family is trauma or limb
  const safeBankQs = filterTraumaBankFields(bankQs, effectivePathway);

  if (bank.source === 'bank' && safeBankQs.length) {
    const withChron = maybePrependChronicityQuestion(safeBankQs, patient, answers, tx, maxQuestions);
    return {
      questions: withChron,
      source: 'bank',
      level: bank.level,
      modifier_evaluation: evaluation,
      autoAnswers: evaluation.autoAnswers || {},
      known_modifiers: evaluation.known_modifiers || [],
      known_facts: evaluation.known_facts || [],
    };
  }

  const withChron = maybePrependChronicityQuestion([], patient, answers, tx, maxQuestions);
  return {
    questions: withChron,
    source: withChron.length ? 'bank' : 'empty',
    level: Number(level) || 5,
    modifier_evaluation: evaluation,
    autoAnswers: evaluation.autoAnswers || {},
    known_modifiers: evaluation.known_modifiers || [],
    known_facts: evaluation.known_facts || [],
  };
}
