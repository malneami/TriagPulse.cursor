/** STT triage session output contract (BUILD PROMPT). */

export type SttFieldKey =
  | 'name'
  | 'age'
  | 'sex'
  | 'chief_complaint'
  | 'onset_duration'
  | 'vital_signs'
  | 'pain_score'
  | 'allergies'
  | 'current_medications'
  | 'relevant_history'
  | 'acuity_proposed';

export interface SttFieldSlot<T = unknown> {
  value: T | null;
  confidence: number;
  source_span: string;
  edited_by_user: boolean;
}

export interface VitalSignEntry {
  type: 'BP' | 'HR' | 'Temp' | 'SpO2' | 'RR' | 'GCS' | 'Weight';
  value: string | number;
  unit?: string;
}

export interface LanguageSegment {
  lang: 'en' | 'ar' | 'mixed';
  text: string;
  start: number;
  end: number;
  confidence: number;
}

export interface CodedTerm {
  term: string;
  system: 'SNOMED' | 'ICD10';
  code: string;
}

export interface SttSessionOutput {
  session_id: string;
  language_segments: LanguageSegment[];
  full_transcript: string;
  fields: Record<SttFieldKey, SttFieldSlot>;
  completeness: { captured: number; total: number; missing: string[] };
  coded: CodedTerm[];
  low_confidence_spans: Array<{ text: string; confidence: number }>;
  model_version: string;
  timestamp: string;
  extraction_method?: 'rules' | 'hybrid';
  llm_used?: boolean;
  transcript_analysis?: import('./transcriptAnalysis').TranscriptCompletenessAnalysis;
}

export interface SttFieldDefinition {
  key: SttFieldKey;
  label_en: string;
  label_ar: string;
  required: boolean;
  type: 'text' | 'integer' | 'enum' | 'list' | 'vitals';
}
