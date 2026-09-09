export { computeLiveCTAS, interpretHR, interpretSBP, interpretSpO2, interpretRR, interpretTemp, interpretGCS } from './ctas/vitalRanges.js';
export { evaluateCtasRules } from './ctas/ctasRulesEngine.js';
export { normalizeClinicalFacts } from './ctas/factNormalizer.js';
export { evaluateSirsCriteria, evaluateAdultFeverModifier, ADULT_FEVER_RULES_META } from './ctas/rules/adultFeverRules.js';
export { evaluateHemodynamicModifier, HEMODYNAMIC_RULES_META } from './ctas/rules/hemodynamicRules.js';
export { getAgeGroup, AGE_NORMS, isPediatricAgeGroup } from './ctas/ageNorms.js';
export { CTAS_CONFIG, CTAS_DB } from './ctas/ctasDatabase.js';
export {
  matchComplaint,
  resolveChiefComplaint,
  getComplaintByKey,
  listAllComplaints,
  COMPLAINT_RESOLVER_VERSION,
  AUTO_MIN,
  AUTO_MARGIN,
} from './ctas/resolveChiefComplaint.js';
export {
  detectSymptomChronicity,
  chronicityCanChangeCtas,
  getChronicityClarifyingQuestion,
  isChronicUnchanged,
  isAcuteAcuity,
  SYMPTOM_CHRONICITY_VERSION,
} from './ctas/detectSymptomChronicity.js';
export { resolveClinicalPathway } from './ctas/resolveClinicalPathway.js';
export {
  CLARIFYING_QUESTION_BANK,
  getClarifyingQuestions,
  resolveVisibleQuestions,
  resolveCtasHintsFromAnswers,
  normalizePathwayFamily,
  pathwaysAreAliases,
  toUiQuestion,
  getBankQuestionById,
} from './ctas/clarifyingQuestionBank.js';
export {
  CTAS_MODIFIER_LIBRARY,
  MODIFIER_LIBRARY_VERSION,
  getActiveModifiers,
  applyModifierLibraryEffects,
} from './ctas/modifierLibrary.js';
export {
  detectKnownModifier,
  selectMissingModifiers,
  evaluateModifierEngine,
  rescoreWithModifierAnswers,
  MAX_QUESTIONS,
  resolveCtasDestination,
  CTAS_DESTINATIONS,
} from './ctas/modifierEngine.js';
export {
  buildKnownFacts,
  getFact,
  shouldSuppressQuestion,
  summarizeKnownFacts,
} from './ctas/knownFactsEngine.js';
export { assignDestination, calculateRespiratoryScore, generatePatientId } from './visual-triage/destinationEngine';
export type { DestinationResult, SectionA } from './visual-triage/destinationEngine';
export { detectRedFlags } from './alerts/redFlagEngine';
export type { RedFlagResult } from './alerts/redFlagEngine';
export { validateTriageReady, validateVitals, validateRegistration, getMissingTriageFields, REQUIRED_TRIAGE_FIELDS } from './validation/triageValidation';
export { createAuditEvent, appendAuditTrail, serializeAuditTrail } from './audit/auditLogger';
export { waitMins, waitTimeColor, isActiveJourney, ROLES, PERMISSIONS, canAccess } from './utils/shared';
export type { Role } from './utils/shared';
export {
  EVALUATION_THRESHOLDS,
  EVALUATION_THRESHOLDS_VERSION,
  gateHigherIsBetter,
  gateLowerIsBetter,
  gateZeroTolerance,
} from './analytics/evaluationThresholds';
export type { GateStatus, EvaluationThresholds } from './analytics/evaluationThresholds';
export {
  computeEvaluationReport,
  normalizeEvaluationCase,
} from './analytics/computeEvaluation';
export type {
  EvaluationCaseInput,
  NormalizedCase,
  KpiRow,
} from './analytics/computeEvaluation';
export {
  buildBuiltinClinicalBundle,
  getCurrentClinicalBundle,
  exportBuiltinModifiers,
  applyClinicalLibraryBundle,
  getLibraryVersions,
  resetClinicalLibrariesToBuiltin,
  serializeModifier,
} from './libraries/bundle';
export { buildDefaultRedFlagLibrary, RED_FLAG_LIBRARY_VERSION, DEFAULT_RED_FLAG_THRESHOLDS } from './libraries/redFlagLibrary';
export { buildNarrativeClinicalSummary } from './stt/clinicalSummary';
export type { NarrativeSummary, NarrativeSummaryInput } from './stt/clinicalSummary';
export { runClarifyingQuestionPipeline, filterKnownQuestions } from './ctas/questionPipeline';
export type {
  ClinicalLibraryBundle,
  RedFlagLibrary,
  RedFlagThresholds,
  SerializableModifier,
  LibraryVersionsSnapshot,
} from './libraries/types';
export {
  createEmptySttFields,
  extractFieldsFromTranscript,
  mergeFieldSlot,
  mergeVitalSignEntries,
  mergeLlmExtractIntoFields,
  buildSttSessionOutput,
  mapSttFieldsToPatient,
  mapSttSessionToPatientUpdates,
  computeCompleteness,
  clinicalSafetyDisclaimer,
  clampConfidence,
  normalizeSpokenNumbers,
} from './stt/extractFields';
export {
  LLM_CTAS_JSON_SCHEMA,
  buildLlmExtractPrompt,
  normalizeLlmExtractResult,
} from './stt/llmExtractSchema';
export type { LlmCtasExtractResult } from './stt/llmExtractSchema';
export {
  analyzeTranscriptCompleteness,
  detectMentionedFields,
} from './stt/transcriptAnalysis';
export type { TranscriptCompletenessAnalysis } from './stt/transcriptAnalysis';
export {
  CTAS_REQUIRED_FIELDS,
  CTAS_REQUIRED_FIELD_KEYS,
  PATIENT_KEY_TO_CTAS,
  computeCtasCompleteness,
  getCtasMissingLabels,
} from './stt/ctasFieldSchema';
export type { CtasFieldKey, CtasFieldDefinition } from './stt/ctasFieldSchema';
export {
  STT_FIELD_DEFINITIONS,
  STT_REQUIRED_KEYS,
  CLINICAL_STT_VOCABULARY,
  buildCodeSwitchPrompt,
  buildMixedSttPrompt,
  buildArabicSttPrompt,
  buildEnglishSttPrompt,
  resolveSttPrompt,
  detectTranscriptLanguage,
  conservativeTranscriptCleanup,
  segmentTranscriptByLanguage,
} from './stt/vocabulary';
export { mapClinicalCodes } from './stt/coding';
export {
  createRealtimeConfigState,
  reduceRealtimeEvent,
  isTurnDetectionRejection,
} from './stt/realtimeEvents';
export type { RealtimeConfigState, RealtimeTranscriptionEcho } from './stt/realtimeEvents';
export type {
  SttFieldKey,
  SttFieldSlot,
  SttSessionOutput,
  LanguageSegment,
  VitalSignEntry,
  CodedTerm,
  SttFieldDefinition,
} from './stt/types';
