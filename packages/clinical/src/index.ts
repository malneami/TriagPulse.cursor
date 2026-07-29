export { computeLiveCTAS, interpretHR, interpretSBP, interpretSpO2, interpretRR, interpretTemp, interpretGCS } from './ctas/vitalRanges.js';
export { matchComplaint, CTAS_CONFIG, CTAS_DB } from './ctas/ctasDatabase.js';
export {
  CLARIFYING_QUESTION_BANK,
  getClarifyingQuestions,
  resolveVisibleQuestions,
  normalizePathwayFamily,
  toUiQuestion,
  getBankQuestionById,
} from './ctas/clarifyingQuestionBank.js';
export { assignDestination, calculateRespiratoryScore } from './visual-triage/destinationEngine';
export type { DestinationResult, SectionA } from './visual-triage/destinationEngine';
export { detectRedFlags } from './alerts/redFlagEngine';
export type { RedFlagResult } from './alerts/redFlagEngine';
export { validateTriageReady, validateVitals, validateRegistration, getMissingTriageFields, REQUIRED_TRIAGE_FIELDS } from './validation/triageValidation';
export { createAuditEvent, appendAuditTrail } from './audit/auditLogger';
export { waitMins, waitTimeColor, isActiveJourney, ROLES, PERMISSIONS, canAccess } from './utils/shared';
export type { Role } from './utils/shared';
export {
  createEmptySttFields,
  extractFieldsFromTranscript,
  mergeFieldSlot,
  mergeLlmExtractIntoFields,
  buildSttSessionOutput,
  mapSttFieldsToPatient,
  mapSttSessionToPatientUpdates,
  computeCompleteness,
  clinicalSafetyDisclaimer,
  clampConfidence,
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
export type {
  SttFieldKey,
  SttFieldSlot,
  SttSessionOutput,
  LanguageSegment,
  VitalSignEntry,
  CodedTerm,
  SttFieldDefinition,
} from './stt/types';
