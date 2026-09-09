/** Versioned clinical library contract — data editable via admin publish. */

export interface LibraryMeta {
  version: string;
  published_at?: string | null;
  published_by?: string | null;
  source: 'builtin' | 'published';
}

export interface RedFlagThresholds {
  spo2_critical: number;
  spo2_urgent: number;
  gcs_critical: number;
  gcs_urgent: number;
  sbp_critical: number;
  sbp_urgent: number;
  hr_severe: number;
  rr_severe: number;
  pain_severe: number;
  pain_unstable_sbp: number;
  pain_unstable_hr: number;
}

export interface RedFlagTextRule {
  id: string;
  terms: string[];
  level: number;
  label_ar: string;
  label_en: string;
  active: boolean;
}

export interface RedFlagLibrary {
  version: string;
  thresholds: RedFlagThresholds;
  text_rules: RedFlagTextRule[];
}

/** Serializable modifier (RegExp patterns stored as strings). */
export interface SerializableModifier {
  id: string;
  name: string;
  name_ar: string;
  pathways: string[];
  age_applicability: 'adult' | 'pediatric' | 'both';
  field: string;
  detect_patterns: string[];
  related_medications?: string[];
  question_ar: string;
  question_en: string;
  answer_type: 'yes_no' | 'options' | 'multiple_choice';
  options: Array<{
    value: string;
    label_ar: string;
    label_en: string;
    ctas_effect?: number | null;
    destination_hint?: string | null;
  }>;
  ctas_effect_yes?: number | null;
  destination_effect?: string | null;
  critical_alert?: boolean;
  team_leader_review?: boolean;
  question_category?: 'ctas_modifier' | 'patient_direction' | 'safety_escalation';
  shown_when_ctas?: number[];
  clinical_explanation_ar: string;
  clinical_explanation_en: string;
  priority: number;
  active: boolean;
  protocol_source: string;
  version: string;
  review_date: string;
}

export interface ModifierLibraryBundle {
  version: string;
  modifiers: SerializableModifier[];
}

export interface ClinicalLibraryBundle {
  version: string;
  modifiers: ModifierLibraryBundle;
  red_flags: RedFlagLibrary;
  meta: LibraryMeta;
}

export interface LibraryVersionsSnapshot {
  bundle: string;
  modifiers: string;
  red_flags: string;
  source: 'builtin' | 'published';
  published_at?: string | null;
}
