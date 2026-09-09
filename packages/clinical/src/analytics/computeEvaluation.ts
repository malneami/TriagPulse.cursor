/**
 * Pure CPMAI evaluation metrics for TriagePulse AI Go/No-Go.
 * Expert/reference CTAS is preferred over nurse-as-truth.
 */
import {
  EVALUATION_THRESHOLDS,
  EVALUATION_THRESHOLDS_VERSION,
  gateHigherIsBetter,
  gateLowerIsBetter,
  gateZeroTolerance,
  type GateStatus,
} from './evaluationThresholds.js';

export type EvaluationCaseInput = {
  id: string;
  createdAt: string | Date;
  age?: number | null;
  gender?: string | null;
  chiefComplaint?: string | null;
  nurseCtas?: number | null;
  aiCtas?: number | null;
  aiRecommendedCtas?: number | null;
  rulesRecommendedCtas?: number | null;
  clinicianFinalCtas?: number | null;
  ctasLevel?: number | null;
  agreement?: boolean | null;
  overrideReason?: string | null;
  triageDurationMin?: number | null;
  doorToTriageMin?: number | null;
  missingFields?: unknown;
  assessmentTrail?: unknown;
  alertTriggered?: boolean | null;
  alertSummary?: string | null;
  redFlags?: unknown;
  validatedPayload?: unknown;
  disposition?: string | null;
  aiConfidence?: number | null;
  clinicalSummaryAr?: string | null;
  clinicalSummaryEn?: string | null;
};

export type NormalizedCase = {
  id: string;
  createdAt: Date;
  age: number | null;
  ageBand: 'pediatric' | 'adult' | 'elderly' | null;
  chiefComplaint: string | null;
  expert: number | null;
  human: number | null;
  ai: number | null;
  aiSource: 'ai' | 'rules' | null;
  underAi: boolean | null;
  overAi: boolean | null;
  underHuman: boolean | null;
  overHuman: boolean | null;
  criticalExpert: boolean;
  criticalCaughtAi: boolean | null;
  criticalMissedAsLowAi: boolean;
  triageDurationMin: number | null;
  doorToTriageMin: number | null;
  missingCount: number | null;
  clarifyingQuestionCount: number;
  duplicateQuestionCount: number;
  override: boolean;
  alertTriggered: boolean;
  hasTrail: boolean;
  destination: string | null;
  overrideReason: string | null;
};

function ageBand(age: number | null | undefined): NormalizedCase['ageBand'] {
  if (age == null || Number.isNaN(age)) return null;
  if (age < 14) return 'pediatric';
  if (age < 65) return 'adult';
  return 'elderly';
}

function expertFromPayload(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const v = p.expert_ctas ?? p.expertCtas ?? p.reference_ctas ?? p.referenceCtas;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
}

function resolveAi(c: EvaluationCaseInput): { level: number | null; source: 'ai' | 'rules' | null } {
  if (c.aiRecommendedCtas != null && Number.isFinite(Number(c.aiRecommendedCtas))) {
    return { level: Number(c.aiRecommendedCtas), source: 'ai' };
  }
  if (c.aiCtas != null && Number.isFinite(Number(c.aiCtas))) {
    return { level: Number(c.aiCtas), source: 'ai' };
  }
  if (c.rulesRecommendedCtas != null && Number.isFinite(Number(c.rulesRecommendedCtas))) {
    return { level: Number(c.rulesRecommendedCtas), source: 'rules' };
  }
  return { level: null, source: null };
}

function resolveExpert(c: EvaluationCaseInput): number | null {
  if (c.clinicianFinalCtas != null && Number.isFinite(Number(c.clinicianFinalCtas))) {
    return Number(c.clinicianFinalCtas);
  }
  return expertFromPayload(c.validatedPayload);
}

function resolveHuman(c: EvaluationCaseInput): number | null {
  if (c.nurseCtas != null && Number.isFinite(Number(c.nurseCtas))) return Number(c.nurseCtas);
  if (c.ctasLevel != null && Number.isFinite(Number(c.ctasLevel))) return Number(c.ctasLevel);
  return null;
}

function countMissing(missingFields: unknown): number | null {
  if (missingFields == null) return 0;
  if (Array.isArray(missingFields)) return missingFields.length;
  if (typeof missingFields === 'object') return Object.keys(missingFields as object).length;
  return null;
}

function clarifyingStats(trail: unknown): { asked: number; duplicates: number } {
  if (!trail || typeof trail !== 'object') return { asked: 0, duplicates: 0 };
  const t = trail as Record<string, unknown>;
  const clarifying = (t.clarifying || t.modifier_engine) as Record<string, unknown> | undefined;
  const shown = clarifying?.questions_shown;
  const ids: string[] = [];
  if (Array.isArray(shown)) {
    for (const q of shown) {
      if (typeof q === 'string') ids.push(q);
      else if (q && typeof q === 'object' && (q as { id?: string }).id) ids.push(String((q as { id: string }).id));
      else if (q && typeof q === 'object' && (q as { field?: string }).field) ids.push(String((q as { field: string }).field));
    }
  }
  const seen = new Set<string>();
  let duplicates = 0;
  for (const id of ids) {
    if (seen.has(id)) duplicates += 1;
    else seen.add(id);
  }
  return { asked: ids.length, duplicates };
}

function destinationFromTrail(c: EvaluationCaseInput): string | null {
  if (c.disposition) return String(c.disposition);
  const trail = c.assessmentTrail;
  if (!trail || typeof trail !== 'object') return null;
  const t = trail as Record<string, unknown>;
  const me = t.modifier_engine as Record<string, unknown> | undefined;
  const dest = me?.suggested_destination as Record<string, unknown> | undefined;
  if (dest?.destination_en) return String(dest.destination_en);
  if (dest?.destination) return String(dest.destination);
  return null;
}

export function normalizeEvaluationCase(c: EvaluationCaseInput): NormalizedCase {
  const expert = resolveExpert(c);
  const human = resolveHuman(c);
  const { level: ai, source: aiSource } = resolveAi(c);
  const criticalExpert = expert != null && expert <= 2;
  const clarifying = clarifyingStats(c.assessmentTrail);
  return {
    id: c.id,
    createdAt: c.createdAt instanceof Date ? c.createdAt : new Date(c.createdAt),
    age: c.age ?? null,
    ageBand: ageBand(c.age),
    chiefComplaint: c.chiefComplaint ?? null,
    expert,
    human,
    ai,
    aiSource,
    underAi: expert != null && ai != null ? ai > expert : null,
    overAi: expert != null && ai != null ? ai < expert : null,
    underHuman: expert != null && human != null ? human > expert : null,
    overHuman: expert != null && human != null ? human < expert : null,
    criticalExpert,
    criticalCaughtAi: criticalExpert && ai != null ? ai <= 2 : null,
    criticalMissedAsLowAi: !!(criticalExpert && ai != null && ai >= 4),
    triageDurationMin: c.triageDurationMin ?? null,
    doorToTriageMin: c.doorToTriageMin ?? null,
    missingCount: countMissing(c.missingFields),
    clarifyingQuestionCount: clarifying.asked,
    duplicateQuestionCount: clarifying.duplicates,
    override: c.agreement === false || !!(c.overrideReason && String(c.overrideReason).trim()),
    alertTriggered: !!c.alertTriggered,
    hasTrail: !!c.assessmentTrail,
    destination: destinationFromTrail(c),
    overrideReason: c.overrideReason ?? null,
  };
}

function pct(num: number, den: number): number | null {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10;
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

function rateStatus(
  value: number | null,
  targetLabel: string,
  kind: 'higher' | 'lower',
  go: number,
  cautious: number,
): { value: number | null; target: string; status: GateStatus } {
  const status = kind === 'higher'
    ? gateHigherIsBetter(value, go, cautious)
    : gateLowerIsBetter(value, go, cautious);
  return { value, target: targetLabel, status };
}

export type KpiRow = {
  id: string;
  label_en: string;
  label_ar: string;
  human: number | null;
  ai: number | null;
  target: string;
  importance: 'critical' | 'major' | 'important' | 'supporting';
  status: GateStatus;
  unit?: string;
  note?: string;
};

export function computeEvaluationReport(casesIn: EvaluationCaseInput[], days = 30) {
  const T = EVALUATION_THRESHOLDS;
  const cases = casesIn.map(normalizeEvaluationCase);
  const labeled = cases.filter((c) => c.expert != null);
  const withAi = labeled.filter((c) => c.ai != null);
  const withHuman = labeled.filter((c) => c.human != null);
  const critical = labeled.filter((c) => c.criticalExpert);
  const criticalWithAi = critical.filter((c) => c.ai != null);

  const aiExact = withAi.filter((c) => c.ai === c.expert).length;
  const humanExact = withHuman.filter((c) => c.human === c.expert).length;
  const aiHumanAgree = cases.filter((c) => c.ai != null && c.human != null && c.ai === c.human).length;
  const aiHumanDen = cases.filter((c) => c.ai != null && c.human != null).length;

  const aiUnder = withAi.filter((c) => c.underAi).length;
  const aiOver = withAi.filter((c) => c.overAi).length;
  const humanUnder = withHuman.filter((c) => c.underHuman).length;
  const humanOver = withHuman.filter((c) => c.overHuman).length;

  const criticalCaught = criticalWithAi.filter((c) => c.criticalCaughtAi).length;
  const criticalFn = criticalWithAi.filter((c) => c.criticalCaughtAi === false).length;
  const missedAsLow = criticalWithAi.filter((c) => c.criticalMissedAsLowAi).length;

  // Confusion-style for critical class (AI)
  const tp = criticalCaught;
  const fn = criticalFn;
  const fp = withAi.filter((c) => !c.criticalExpert && c.ai != null && c.ai <= 2).length;
  const tn = withAi.filter((c) => !c.criticalExpert && c.ai != null && c.ai > 2).length;
  const precision = pct(tp, tp + fp);
  const recall = pct(tp, tp + fn);
  const f1 = precision != null && recall != null && (precision + recall) > 0
    ? Math.round((2 * precision * recall) / (precision + recall) * 10) / 10
    : null;
  const fnr = pct(fn, tp + fn);
  const fpr = pct(fp, fp + tn);

  const aiAccuracy = pct(aiExact, withAi.length);
  const humanAccuracy = pct(humanExact, withHuman.length);
  const aiVsHuman = pct(aiHumanAgree, aiHumanDen);
  const underAiPct = pct(aiUnder, withAi.length);
  const overAiPct = pct(aiOver, withAi.length);
  const underHumanPct = pct(humanUnder, withHuman.length);
  const overHumanPct = pct(humanOver, withHuman.length);
  const criticalSens = pct(criticalCaught, criticalWithAi.length);
  const criticalFnPct = pct(criticalFn, criticalWithAi.length);

  const durations = cases.map((c) => c.triageDurationMin).filter((n): n is number => n != null && n > 0 && n < 240);
  const avgTriageTime = avg(durations);
  // Without a stored pre-AI baseline, reduction is not inventable — report null with note
  const triageTimeReduction: number | null = null;

  const clarifyingTotals = cases.reduce((s, c) => s + c.clarifyingQuestionCount, 0);
  const clarifyingAvg = cases.length ? Math.round((clarifyingTotals / cases.length) * 10) / 10 : null;
  const dupTotal = cases.reduce((s, c) => s + c.duplicateQuestionCount, 0);
  const dupPct = clarifyingTotals ? pct(dupTotal, clarifyingTotals) : null;

  const completenessScores = cases.map((c) => {
    if (c.missingCount == null) return null;
    const filled = Math.max(0, 10 - c.missingCount);
    return (filled / 10) * 100;
  }).filter((n): n is number => n != null);
  const completeness = completenessScores.length
    ? Math.round(completenessScores.reduce((a, b) => a + b, 0) / completenessScores.length * 10) / 10
    : null;

  const overridePct = pct(cases.filter((c) => c.override).length, cases.length);
  const trailPct = pct(cases.filter((c) => c.hasTrail).length, cases.length);
  const confirmPct = pct(cases.filter((c) => c.human != null || c.expert != null).length, cases.length);
  const ruleSuccessPct = pct(cases.filter((c) => c.hasTrail || c.ai != null).length, Math.max(cases.length, 1));

  const insufficientClinical = labeled.length < T.min_expert_labeled_cases
    || criticalWithAi.length < T.min_critical_cases;

  const clinical_kpis: KpiRow[] = [
    {
      id: 'exact_ctas_agreement',
      label_en: 'Exact CTAS Agreement (AI vs expert)',
      label_ar: 'اتفاق CTAS التام (AI مقابل الخبير)',
      human: null,
      ai: aiAccuracy,
      ...rateStatus(aiAccuracy, `≥${T.exact_ctas_agreement_pct}%`, 'higher', T.exact_ctas_agreement_pct, T.exact_ctas_agreement_pct - 5),
      importance: 'major',
      unit: '%',
    },
    {
      id: 'human_ctas_accuracy',
      label_en: 'Human CTAS Accuracy (nurse vs expert)',
      label_ar: 'دقة CTAS البشري (ممرض مقابل خبير)',
      human: humanAccuracy,
      ai: null,
      target: 'Benchmark',
      importance: 'supporting',
      status: humanAccuracy == null ? 'insufficient_data' : 'go',
      unit: '%',
    },
    {
      id: 'ai_ctas_accuracy',
      label_en: 'AI CTAS Accuracy (AI vs expert)',
      label_ar: 'دقة CTAS للذكاء الاصطناعي',
      human: null,
      ai: aiAccuracy,
      ...rateStatus(aiAccuracy, `≥${T.ai_ctas_accuracy_pct}%`, 'higher', T.ai_ctas_accuracy_pct, T.ai_ctas_accuracy_pct - 5),
      importance: 'major',
      unit: '%',
    },
    {
      id: 'ai_vs_human_agreement',
      label_en: 'AI vs Human Agreement',
      label_ar: 'اتفاق AI مع الممرض',
      human: null,
      ai: aiVsHuman,
      ...rateStatus(aiVsHuman, `≥${T.ai_vs_human_agreement_pct}%`, 'higher', T.ai_vs_human_agreement_pct, T.ai_vs_human_agreement_pct - 5),
      importance: 'supporting',
      unit: '%',
      note: 'Supporting only — both may be wrong without expert reference',
    },
    {
      id: 'under_triage_ai',
      label_en: 'Under-triage Rate (AI)',
      label_ar: 'معدل نقص الفرز (AI)',
      human: underHumanPct,
      ai: underAiPct,
      ...rateStatus(underAiPct, `≤${T.under_triage_max_pct}%`, 'lower', T.under_triage_max_pct, T.under_triage_cautious_pct),
      importance: 'critical',
      unit: '%',
    },
    {
      id: 'over_triage_ai',
      label_en: 'Over-triage Rate (AI)',
      label_ar: 'معدل فرط الفرز (AI)',
      human: overHumanPct,
      ai: overAiPct,
      ...rateStatus(overAiPct, `≤${T.over_triage_max_pct}%`, 'lower', T.over_triage_max_pct, T.over_triage_max_pct + 10),
      importance: 'important',
      unit: '%',
    },
    {
      id: 'critical_sensitivity',
      label_en: 'Critical-case Sensitivity (CTAS 1–2)',
      label_ar: 'حساسية الحالات الحرجة',
      human: null,
      ai: criticalSens,
      ...rateStatus(
        criticalSens,
        `≥${T.critical_sensitivity_go_pct}%`,
        'higher',
        T.critical_sensitivity_go_pct,
        T.critical_sensitivity_cautious_pct,
      ),
      importance: 'critical',
      unit: '%',
    },
    {
      id: 'critical_fn_rate',
      label_en: 'Critical-case False-Negative Rate',
      label_ar: 'معدل السلبيات الكاذبة للحالات الحرجة',
      human: null,
      ai: criticalFnPct,
      ...rateStatus(
        criticalFnPct,
        `≤${T.critical_fn_go_pct}%`,
        'lower',
        T.critical_fn_go_pct,
        T.critical_fn_cautious_pct,
      ),
      importance: 'critical',
      unit: '%',
    },
    {
      id: 'red_flag_sensitivity',
      label_en: 'Red-Flag Detection Sensitivity',
      label_ar: 'حساسية اكتشاف العلامات الحمراء',
      human: null,
      ai: null,
      target: `≥${T.red_flag_sensitivity_pct}%`,
      importance: 'critical',
      status: 'insufficient_data',
      note: 'Requires gold-standard red-flag labels — provisional',
    },
    {
      id: 'destination_accuracy',
      label_en: 'Destination Accuracy',
      label_ar: 'دقة الوجهة',
      human: null,
      ai: null,
      target: `≥${T.destination_accuracy_pct}%`,
      importance: 'major',
      status: 'insufficient_data',
      note: 'Requires expert destination labels — provisional',
    },
    {
      id: 'correction_rate',
      label_en: 'Upgrade/Downgrade (provider correction) Rate',
      label_ar: 'معدل تصحيح الخبير/المزود',
      human: null,
      ai: overridePct,
      ...rateStatus(overridePct, `≤${T.override_rate_max_pct}%`, 'lower', T.override_rate_max_pct, T.override_rate_max_pct + 15),
      importance: 'major',
      unit: '%',
    },
  ];

  if (insufficientClinical) {
    for (const row of clinical_kpis) {
      if (row.importance === 'critical' || row.importance === 'major') {
        if (row.status !== 'insufficient_data' && row.ai == null && row.human == null) continue;
        if (labeled.length < T.min_expert_labeled_cases && row.status !== 'pending') {
          row.note = (row.note ? `${row.note}; ` : '')
            + `Need ≥${T.min_expert_labeled_cases} expert-labeled cases (have ${labeled.length})`;
          if (row.status === 'go' || row.status === 'cautious') {
            // keep numeric status but flag sample
          }
        }
      }
    }
  }

  const safety_gates = [
    {
      id: 'critical_sensitivity',
      label_en: 'Critical-case sensitivity',
      label_ar: 'حساسية الحالات الحرجة',
      value: criticalSens,
      status: gateHigherIsBetter(
        criticalSens,
        T.critical_sensitivity_go_pct,
        T.critical_sensitivity_cautious_pct,
      ),
      go: `≥${T.critical_sensitivity_go_pct}%`,
      cautious: `${T.critical_sensitivity_cautious_pct}–${T.critical_sensitivity_go_pct - 0.1}%`,
      no_go: `<${T.critical_sensitivity_cautious_pct}%`,
      veto: true,
    },
    {
      id: 'critical_fn',
      label_en: 'Critical false-negative rate',
      label_ar: 'سلبيات كاذبة للحالات الحرجة',
      value: criticalFnPct,
      status: gateLowerIsBetter(criticalFnPct, T.critical_fn_go_pct, T.critical_fn_cautious_pct),
      go: `≤${T.critical_fn_go_pct}%`,
      cautious: `>${T.critical_fn_go_pct}–${T.critical_fn_cautious_pct}%`,
      no_go: `>${T.critical_fn_cautious_pct}%`,
      veto: true,
    },
    {
      id: 'serious_under_triage',
      label_en: 'Serious under-triage',
      label_ar: 'نقص فرز خطير',
      value: underAiPct,
      status: gateLowerIsBetter(underAiPct, T.under_triage_max_pct, T.under_triage_cautious_pct),
      go: `≤${T.under_triage_max_pct}%`,
      cautious: `≤${T.under_triage_cautious_pct}%`,
      no_go: `>${T.under_triage_cautious_pct}%`,
      veto: true,
    },
    {
      id: 'missed_critical_as_low',
      label_en: 'CTAS 1–2 missed as CTAS 4–5',
      label_ar: 'حرج مُصنَّف كـ CTAS 4–5',
      value: missedAsLow,
      status: gateZeroTolerance(missedAsLow),
      go: '0',
      cautious: '—',
      no_go: 'Any',
      veto: true,
    },
    {
      id: 'red_flag_failure',
      label_en: 'Red-flag alert failure',
      label_ar: 'فشل تنبيه العلامة الحمراء',
      value: null,
      status: 'insufficient_data' as GateStatus,
      go: '0 significant',
      cautious: 'Isolated',
      no_go: 'Recurrent',
      veto: true,
      note: 'Gold-standard red-flag labels required',
    },
    {
      id: 'provider_override',
      label_en: 'Provider override available',
      label_ar: 'تجاوز المزود متاح',
      value: 100,
      status: 'go' as GateStatus,
      go: 'Always',
      cautious: '—',
      no_go: 'Not available',
      veto: true,
      note: 'Product always requires clinician confirmation',
    },
    {
      id: 'audit_trail',
      label_en: 'Audit trail completeness',
      label_ar: 'اكتمال مسار التدقيق',
      value: trailPct,
      status: gateHigherIsBetter(trailPct, 95, 80),
      go: 'Complete',
      cautious: 'Minor gaps',
      no_go: 'Major gaps',
      veto: true,
    },
  ];

  const workflow_kpis = [
    {
      id: 'avg_triage_time',
      label_en: 'Average Triage Time',
      label_ar: 'متوسط زمن الفرز',
      value: avgTriageTime,
      target: '≥20–30% reduction vs baseline',
      status: avgTriageTime == null ? 'insufficient_data' : 'pending',
      unit: 'min',
      note: 'Baseline pre-AI duration not stored — reduction pending',
    },
    {
      id: 'time_reduction',
      label_en: 'Triage Time Reduction',
      label_ar: 'انخفاض زمن الفرز',
      value: triageTimeReduction,
      target: `≥${T.triage_time_reduction_pct}%`,
      status: 'pending' as GateStatus,
      unit: '%',
      note: 'Requires human baseline window',
    },
    {
      id: 'clarifying_per_case',
      label_en: 'Clarifying Questions per Case',
      label_ar: 'أسئلة توضيحية لكل حالة',
      value: clarifyingAvg,
      target: `≤${T.clarifying_questions_max_avg}`,
      status: clarifyingAvg == null
        ? 'insufficient_data'
        : clarifyingAvg <= T.clarifying_questions_max_avg
          ? 'go'
          : clarifyingAvg <= T.clarifying_questions_max_avg + 1
            ? 'cautious'
            : 'no_go',
      unit: 'count',
    },
    {
      id: 'duplicate_questions',
      label_en: 'Duplicate Question Rate',
      label_ar: 'معدل الأسئلة المكررة',
      value: dupPct,
      target: `<${T.duplicate_question_max_pct}%`,
      status: gateLowerIsBetter(dupPct, T.duplicate_question_max_pct, T.duplicate_question_max_pct + 3),
      unit: '%',
    },
    {
      id: 'data_completeness',
      label_en: 'Mandatory Data Completeness',
      label_ar: 'اكتمال البيانات الإلزامية',
      value: completeness,
      target: `≥${T.data_completeness_pct}%`,
      status: gateHigherIsBetter(completeness, T.data_completeness_pct, T.data_completeness_pct - 10),
      unit: '%',
    },
    {
      id: 'override_rate',
      label_en: 'Provider Override Rate',
      label_ar: 'معدل تجاوز المزود',
      value: overridePct,
      target: 'Decreasing trend',
      status: gateLowerIsBetter(overridePct, T.override_rate_max_pct, T.override_rate_max_pct + 15),
      unit: '%',
    },
    {
      id: 'staff_satisfaction',
      label_en: 'Staff Satisfaction',
      label_ar: 'رضا الطاقم',
      value: null,
      target: `≥${T.staff_satisfaction_target}/5`,
      status: 'pending' as GateStatus,
      note: 'Survey not in database — placeholder target only',
    },
  ];

  const technical_kpis = [
    {
      id: 'ai_response_time',
      label_en: 'AI response time',
      label_ar: 'زمن استجابة AI',
      value: null,
      target: `≤${T.ai_response_time_sec}s`,
      status: 'pending' as GateStatus,
      note: 'Instrumentation pending',
    },
    {
      id: 'system_availability',
      label_en: 'System availability',
      label_ar: 'توافر النظام',
      value: null,
      target: `≥${T.system_availability_pct}%`,
      status: 'pending' as GateStatus,
      note: 'Instrumentation pending — do not invent uptime',
    },
    {
      id: 'extraction_completeness',
      label_en: 'Structured extraction completeness',
      label_ar: 'اكتمال الاستخراج المنظم',
      value: completeness,
      target: `≥${T.extraction_completeness_pct}%`,
      status: gateHigherIsBetter(completeness, T.extraction_completeness_pct, T.extraction_completeness_pct - 10),
    },
    {
      id: 'rule_engine_success',
      label_en: 'Rule-engine execution success',
      label_ar: 'نجاح محرك القواعد',
      value: ruleSuccessPct,
      target: `≥${T.rule_engine_success_pct}%`,
      status: gateHigherIsBetter(ruleSuccessPct, T.rule_engine_success_pct, 95),
    },
    {
      id: 'audit_completeness',
      label_en: 'Audit-log completeness',
      label_ar: 'اكتمال سجل التدقيق',
      value: trailPct,
      target: `${T.audit_log_completeness_pct}%`,
      status: gateHigherIsBetter(trailPct, 100, 90),
    },
    {
      id: 'provider_confirmation',
      label_en: 'Provider-confirmation capture',
      label_ar: 'التقاط تأكيد المزود',
      value: confirmPct,
      target: `${T.provider_confirmation_pct}%`,
      status: gateHigherIsBetter(confirmPct, 95, 80),
    },
    {
      id: 'alert_delivery',
      label_en: 'Critical-alert delivery success',
      label_ar: 'نجاح توصيل التنبيه الحرج',
      value: null,
      target: `${T.critical_alert_delivery_pct}%`,
      status: 'pending' as GateStatus,
      note: 'Requires delivery ack telemetry',
    },
  ];

  // Safety veto
  const safetyNoGo = safety_gates.some((g) => g.veto && g.status === 'no_go');
  const safetyCautious = safety_gates.some((g) => g.veto && g.status === 'cautious');

  const valueRows = [...clinical_kpis, ...workflow_kpis, ...technical_kpis];
  const decidable = valueRows.filter((r) => r.status === 'go' || r.status === 'cautious' || r.status === 'no_go');
  const met = decidable.filter((r) => r.status === 'go').length;
  const majorityMet = decidable.length ? met / decidable.length >= 0.5 : false;

  let overall_decision: 'go' | 'cautious_go' | 'no_go' | 'insufficient_data' = 'insufficient_data';
  if (labeled.length === 0) {
    overall_decision = 'insufficient_data';
  } else if (safetyNoGo) {
    overall_decision = 'no_go';
  } else if (safetyCautious || !majorityMet || insufficientClinical) {
    overall_decision = 'cautious_go';
  } else {
    overall_decision = 'go';
  }

  const scorecard = [
    {
      domain: 'Clinical Value',
      domain_ar: 'القيمة السريرية',
      question_en: 'Does AI improve CTAS accuracy or consistency over current practice?',
      status: aiAccuracy != null && humanAccuracy != null
        ? (aiAccuracy >= humanAccuracy && aiAccuracy >= T.ai_ctas_accuracy_pct ? 'go' : aiAccuracy >= T.ai_ctas_accuracy_pct - 5 ? 'cautious' : 'no_go')
        : 'insufficient_data',
    },
    {
      domain: 'Clinical Safety',
      domain_ar: 'السلامة السريرية',
      question_en: 'Are critical-case sensitivity and under-triage within approved safety limits?',
      status: safetyNoGo ? 'no_go' : safetyCautious ? 'cautious' : criticalSens == null ? 'insufficient_data' : 'go',
    },
    {
      domain: 'Workflow Value',
      domain_ar: 'قيمة سير العمل',
      question_en: 'Does AI reduce triage time or documentation burden?',
      status: clarifyingAvg != null && clarifyingAvg <= T.clarifying_questions_max_avg
        ? (completeness != null && completeness >= T.data_completeness_pct - 10 ? 'go' : 'cautious')
        : 'pending',
    },
    {
      domain: 'Data Availability',
      domain_ar: 'توفر البيانات',
      question_en: 'Are sufficient validated adult and pediatric cases available?',
      status: labeled.length >= T.min_expert_labeled_cases
        ? (cases.some((c) => c.ageBand === 'pediatric') ? 'go' : 'cautious')
        : 'cautious',
    },
    {
      domain: 'Data Quality',
      domain_ar: 'جودة البيانات',
      question_en: 'Are age, vitals, modifiers and expert CTAS labels reliable?',
      status: completeness != null && completeness >= 85 ? 'go' : completeness != null ? 'cautious' : 'insufficient_data',
    },
    {
      domain: 'Data Coverage',
      domain_ar: 'تغطية البيانات',
      question_en: 'Are enough high-risk, low-risk, pediatric and edge cases represented?',
      status: critical.length >= T.min_critical_cases
        ? (labeled.length >= T.min_expert_labeled_cases ? 'go' : 'cautious')
        : 'cautious',
    },
    {
      domain: 'Technology',
      domain_ar: 'التقنية',
      question_en: 'Is the platform stable, fast and auditable?',
      status: trailPct != null && trailPct >= 90 ? 'cautious' : 'pending',
    },
    {
      domain: 'Clinical Adoption',
      domain_ar: 'التبني السريري',
      question_en: 'Can clinicians use it without disrupting triage?',
      status: confirmPct != null && confirmPct >= 80 ? 'go' : 'cautious',
    },
    {
      domain: 'Operational Fit',
      domain_ar: 'الملاءمة التشغيلية',
      question_en: 'Does the output integrate appropriately with ED patient direction?',
      status: 'pending',
    },
  ];

  // Monthly trends
  const byMonth: Record<string, NormalizedCase[]> = {};
  for (const c of labeled) {
    const key = `${c.createdAt.getUTCFullYear()}-${String(c.createdAt.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(c);
  }
  const trends = Object.keys(byMonth).sort().map((month) => {
    const rows = byMonth[month];
    const withA = rows.filter((c) => c.ai != null);
    const crit = rows.filter((c) => c.criticalExpert && c.ai != null);
    const exact = withA.filter((c) => c.ai === c.expert).length;
    const under = withA.filter((c) => c.underAi).length;
    const fn = crit.filter((c) => c.criticalCaughtAi === false).length;
    const ov = rows.filter((c) => c.override).length;
    const comp = rows.map((c) => (c.missingCount == null ? null : ((10 - c.missingCount) / 10) * 100))
      .filter((n): n is number => n != null);
    return {
      month,
      n: rows.length,
      ai_accuracy: pct(exact, withA.length),
      under_triage: pct(under, withA.length),
      critical_fn: pct(fn, crit.length),
      override_rate: pct(ov, rows.length),
      completeness: comp.length ? Math.round(comp.reduce((a, b) => a + b, 0) / comp.length * 10) / 10 : null,
      clarifying_avg: rows.length
        ? Math.round((rows.reduce((s, c) => s + c.clarifyingQuestionCount, 0) / rows.length) * 10) / 10
        : null,
    };
  });

  const comparison = [
    { domain: 'CTAS Accuracy', domain_ar: 'دقة CTAS', human: humanAccuracy, ai: aiAccuracy, diff: humanAccuracy != null && aiAccuracy != null ? Math.round((aiAccuracy - humanAccuracy) * 10) / 10 : null },
    { domain: 'Critical Sensitivity', domain_ar: 'حساسية الحالات الحرجة', human: null, ai: criticalSens, diff: null },
    { domain: 'Under-triage', domain_ar: 'نقص الفرز', human: underHumanPct, ai: underAiPct, diff: underHumanPct != null && underAiPct != null ? Math.round((aiUnderPctDiff(underAiPct, underHumanPct)) * 10) / 10 : null },
    { domain: 'Over-triage', domain_ar: 'فرط الفرز', human: overHumanPct, ai: overAiPct, diff: overHumanPct != null && overAiPct != null ? Math.round((overAiPct - overHumanPct) * 10) / 10 : null },
    { domain: 'Average Triage Time', domain_ar: 'متوسط زمن الفرز', human: null, ai: avgTriageTime, diff: null, unit: 'min' },
    { domain: 'Data Completeness', domain_ar: 'اكتمال البيانات', human: null, ai: completeness, diff: null },
    { domain: 'Destination Accuracy', domain_ar: 'دقة الوجهة', human: null, ai: null, diff: null },
  ];

  const case_reviews = labeled
    .filter((c) => c.ai != null || c.human != null)
    .slice(0, 100)
    .map((c) => ({
      record_id: c.id,
      created_at: c.createdAt.toISOString(),
      age_band: c.ageBand,
      chief_complaint: c.chiefComplaint,
      human_ctas: c.human,
      ai_ctas: c.ai,
      ai_source: c.aiSource,
      expert_ctas: c.expert,
      delta_ai_expert: c.ai != null && c.expert != null ? c.ai - c.expert : null,
      override_reason: c.overrideReason,
      destination: c.destination,
      under_triage_ai: c.underAi,
      critical_missed_as_low: c.criticalMissedAsLowAi,
    }));

  const hero_cards = [
    {
      id: 'critical_sensitivity',
      label_en: 'Critical Sensitivity',
      label_ar: 'حساسية الحالات الحرجة',
      value: criticalSens,
      unit: '%',
      status: gateHigherIsBetter(criticalSens, T.critical_sensitivity_go_pct, T.critical_sensitivity_cautious_pct),
    },
    {
      id: 'under_triage',
      label_en: 'Under-triage',
      label_ar: 'نقص الفرز',
      value: underAiPct,
      unit: '%',
      status: gateLowerIsBetter(underAiPct, T.under_triage_max_pct, T.under_triage_cautious_pct),
    },
    {
      id: 'ai_accuracy',
      label_en: 'CTAS Accuracy (AI)',
      label_ar: 'دقة CTAS (AI)',
      value: aiAccuracy,
      unit: '%',
      status: gateHigherIsBetter(aiAccuracy, T.ai_ctas_accuracy_pct, T.ai_ctas_accuracy_pct - 5),
    },
    {
      id: 'time_reduction',
      label_en: 'Triage Time Reduction',
      label_ar: 'انخفاض زمن الفرز',
      value: triageTimeReduction,
      unit: '%',
      status: 'pending' as GateStatus,
      note: 'Baseline pending',
    },
  ];

  return {
    days,
    generated_at: new Date().toISOString(),
    thresholds_version: EVALUATION_THRESHOLDS_VERSION,
    thresholds_used: T,
    overall_decision,
    sample_sizes: {
      total_records: cases.length,
      expert_labeled: labeled.length,
      with_ai: withAi.length,
      with_human: withHuman.length,
      critical_expert: critical.length,
      critical_with_ai: criticalWithAi.length,
      pediatric: cases.filter((c) => c.ageBand === 'pediatric').length,
      adult: cases.filter((c) => c.ageBand === 'adult').length,
      min_expert_required: T.min_expert_labeled_cases,
      min_critical_required: T.min_critical_cases,
      insufficient_clinical_sample: insufficientClinical,
    },
    confusion_critical: {
      tp, fn, fp, tn, precision, recall, f1, fnr, fpr,
    },
    hero_cards,
    clinical_kpis,
    safety_gates,
    workflow_kpis,
    technical_kpis,
    comparison,
    scorecard,
    trends,
    case_reviews,
  };
}

function aiUnderPctDiff(ai: number, human: number) {
  return ai - human;
}
