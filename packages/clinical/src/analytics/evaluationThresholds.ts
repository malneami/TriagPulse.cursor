/**
 * Project-proposed CPMAI evaluation thresholds for TriagePulse AI Go/No-Go.
 * These are TriagePulse project values (not values prescribed by the CPMAI workbook).
 * Version bumps when governance revises gates.
 */
export const EVALUATION_THRESHOLDS_VERSION = '1.0.0';

export type GateStatus = 'go' | 'cautious' | 'no_go' | 'insufficient_data' | 'pending';

export const EVALUATION_THRESHOLDS = {
  /** Minimum expert-labeled cases before Major/Critical clinical gates are decisive */
  min_expert_labeled_cases: 20,
  min_critical_cases: 5,

  // Clinical — AI vs expert
  exact_ctas_agreement_pct: 90,
  ai_ctas_accuracy_pct: 90,
  ai_vs_human_agreement_pct: 90,
  under_triage_max_pct: 5,
  under_triage_cautious_pct: 8,
  over_triage_max_pct: 25,
  critical_sensitivity_go_pct: 98,
  critical_sensitivity_cautious_pct: 95,
  critical_fn_go_pct: 2,
  critical_fn_cautious_pct: 5,
  red_flag_sensitivity_pct: 95,
  destination_accuracy_pct: 90,

  // Workflow
  triage_time_reduction_pct: 20,
  clarifying_questions_max_avg: 3,
  duplicate_question_max_pct: 2,
  data_completeness_pct: 95,
  override_rate_max_pct: 30,
  adoption_pct: 80,
  workflow_interruption_max_pct: 5,
  staff_satisfaction_target: 4,

  // Technical (targets; some remain instrumentation-pending)
  ai_response_time_sec: 3,
  system_availability_pct: 99.5,
  failed_ai_requests_max_pct: 1,
  stt_completion_pct: 98,
  extraction_completeness_pct: 95,
  incorrect_extraction_max_pct: 5,
  rule_engine_success_pct: 99.5,
  audit_log_completeness_pct: 100,
  critical_alert_delivery_pct: 100,
  provider_confirmation_pct: 100,
} as const;

export type EvaluationThresholds = typeof EVALUATION_THRESHOLDS;

/** Higher-is-better percentage gate */
export function gateHigherIsBetter(
  value: number | null | undefined,
  goMin: number,
  cautiousMin: number,
): GateStatus {
  if (value == null || Number.isNaN(value)) return 'insufficient_data';
  if (value >= goMin) return 'go';
  if (value >= cautiousMin) return 'cautious';
  return 'no_go';
}

/** Lower-is-better percentage gate */
export function gateLowerIsBetter(
  value: number | null | undefined,
  goMax: number,
  cautiousMax: number,
): GateStatus {
  if (value == null || Number.isNaN(value)) return 'insufficient_data';
  if (value <= goMax) return 'go';
  if (value <= cautiousMax) return 'cautious';
  return 'no_go';
}

export function gateZeroTolerance(count: number | null | undefined): GateStatus {
  if (count == null) return 'insufficient_data';
  return count === 0 ? 'go' : 'no_go';
}
