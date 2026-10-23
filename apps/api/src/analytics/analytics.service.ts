import { Injectable } from '@nestjs/common';
import { computeEvaluationReport, highAcuityOutcome } from '@triagepulse/clinical';
import { PrismaService } from '../prisma/prisma.module';

type ExportOutcome = {
  disposition: string;
  admissionLocation: string | null;
  dischargeDestination: string | null;
  finalDiagnosisCode: string | null;
  interventions: string[];
  icuWithin24h: string | null;
  death: string | null;
  resources: string[];
  resourceCount: number | null;
  return72h: string | null;
  reviewedAt: Date;
} | null;

/** Nurse (or engine) level compared with the reference: agree, under-triage or over-triage. */
function versusReference(level: number | null, reference: number | null): 'agree' | 'under' | 'over' | null {
  if (level == null || reference == null) return null;
  if (level === reference) return 'agree';
  // CTAS 1 is most urgent: a higher number than the reference is under-triage.
  return level > reference ? 'under' : 'over';
}

/**
 * One de-identified row of the accuracy dataset. Only physician-validated records reach here.
 * No names, ID, phone, visit number or MRN; the record id is a random UUID.
 */
function deIdentifyRecord(r: {
  id: string;
  createdAt: Date;
  age: number | null;
  gender: string | null;
  chiefComplaint: string | null;
  ctasLevel: number | null;
  nurseCtas: number | null;
  rulesRecommendedCtas: number | null;
  aiRecommendedCtas: number | null;
  physicianCtas: number | null;
  physicianValidatedAt: Date | null;
  physicianConditionChanged: boolean | null;
  agreement: boolean | null;
  overrideReason: string | null;
  flaggedForReview: boolean;
  triageDurationMin: number | null;
  libraryVersions: unknown;
  clinicalSummaryAr: string | null;
  clinicalSummaryEn: string | null;
  assessmentTrail: unknown;
  validatedPayload: unknown;
  aiConfidence: number | null;
  journey: { outcomeReview: ExportOutcome };
}) {
  const nurse = r.nurseCtas ?? r.ctasLevel;
  const engine = r.aiRecommendedCtas ?? r.rulesRecommendedCtas;
  const reference = r.physicianConditionChanged ? null : r.physicianCtas;
  const o = r.journey?.outcomeReview ?? null;
  return {
    record_id: r.id,
    created_at: r.createdAt.toISOString(),
    age_band: r.age == null ? null : r.age < 14 ? 'pediatric' : r.age < 65 ? 'adult' : 'elderly',
    gender: r.gender,
    chief_complaint: r.chiefComplaint,
    nurse_ctas: nurse,
    engine_ctas: engine,
    rules_recommended_ctas: r.rulesRecommendedCtas,
    ai_recommended_ctas: r.aiRecommendedCtas,
    physician_ctas: r.physicianCtas,
    physician_validated_at: r.physicianValidatedAt?.toISOString() ?? null,
    condition_changed: !!r.physicianConditionChanged,
    /** Scored against the physician level; null when the condition changed after triage. */
    nurse_vs_physician: versusReference(nurse, reference),
    engine_vs_physician: versusReference(engine, reference),
    nurse_accepted_engine: r.agreement,
    override_reason: r.overrideReason,
    flagged_for_review: r.flaggedForReview,
    triage_duration_min: r.triageDurationMin,
    library_versions: r.libraryVersions,
    clinical_summary_ar: r.clinicalSummaryAr,
    clinical_summary_en: r.clinicalSummaryEn,
    assessment_trail: r.assessmentTrail,
    validated_payload: r.validatedPayload,
    ai_confidence: r.aiConfidence,
    outcome: o
      ? {
          disposition: o.disposition,
          admission_location: o.admissionLocation,
          discharge_destination: o.dischargeDestination,
          final_diagnosis_icd10: o.finalDiagnosisCode,
          interventions: o.interventions,
          icu_within_24h: o.icuWithin24h,
          death: o.death,
          resources: o.resources,
          resource_count: o.resourceCount,
          return_72h: o.return72h,
          /** Any life-saving intervention, ICU within 24 h or death; null while still unknown. */
          high_acuity_outcome: highAcuityOutcome(o),
          reviewed_at: o.reviewedAt.toISOString(),
        }
      : null,
  };
}

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async agreementSummary(days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.triageRecord.findMany({
      where: { createdAt: { gte: since } },
      select: {
        agreement: true,
        overrideReason: true,
        flaggedForReview: true,
        rulesRecommendedCtas: true,
        aiRecommendedCtas: true,
        clinicianFinalCtas: true,
        ctasLevel: true,
        libraryVersions: true,
      },
    });

    const total = rows.length;
    const agreed = rows.filter((r) => r.agreement === true).length;
    const overridden = rows.filter((r) => r.agreement === false).length;
    const flagged = rows.filter((r) => r.flaggedForReview).length;

    const overrideThemes: Record<string, number> = {};
    for (const r of rows) {
      if (!r.overrideReason) continue;
      const key = r.overrideReason.trim().slice(0, 80) || 'unspecified';
      overrideThemes[key] = (overrideThemes[key] || 0) + 1;
    }

    const themeList = Object.entries(overrideThemes)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    return {
      days,
      total,
      agreed,
      overridden,
      flagged,
      agreement_rate: total ? Math.round((agreed / total) * 1000) / 10 : null,
      override_themes: themeList,
    };
  }

  /**
   * Accuracy dataset: only records a physician has validated (the reference). Unvalidated
   * records are left out, never scored against the nurse's own level.
   */
  async exportValidated(limit = 200, flaggedOnly = false) {
    const rows = await this.prisma.triageRecord.findMany({
      where: {
        physicianValidatedAt: { not: null },
        physicianCtas: { not: null },
        ...(flaggedOnly ? { flaggedForReview: true } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 1000),
      select: {
        id: true,
        createdAt: true,
        age: true,
        gender: true,
        chiefComplaint: true,
        ctasLevel: true,
        nurseCtas: true,
        rulesRecommendedCtas: true,
        aiRecommendedCtas: true,
        physicianCtas: true,
        physicianValidatedAt: true,
        physicianConditionChanged: true,
        agreement: true,
        overrideReason: true,
        flaggedForReview: true,
        triageDurationMin: true,
        libraryVersions: true,
        clinicalSummaryAr: true,
        clinicalSummaryEn: true,
        assessmentTrail: true,
        validatedPayload: true,
        aiConfidence: true,
        journey: {
          select: {
            outcomeReview: {
              select: {
                disposition: true,
                admissionLocation: true,
                dischargeDestination: true,
                finalDiagnosisCode: true,
                interventions: true,
                icuWithin24h: true,
                death: true,
                resources: true,
                resourceCount: true,
                return72h: true,
                reviewedAt: true,
              },
            },
          },
        },
      },
    });

    return {
      exported_at: new Date().toISOString(),
      count: rows.length,
      de_identified: true,
      reference: 'physician_validated_ctas',
      encounters: rows.map(deIdentifyRecord),
    };
  }

  async evaluationReport(days = 30) {
    const windowDays = Math.min(Math.max(Number(days) || 30, 1), 365);
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.triageRecord.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 2000,
      select: {
        id: true,
        createdAt: true,
        age: true,
        gender: true,
        chiefComplaint: true,
        nurseCtas: true,
        aiCtas: true,
        aiRecommendedCtas: true,
        rulesRecommendedCtas: true,
        clinicianFinalCtas: true,
        physicianCtas: true,
        physicianValidatedAt: true,
        physicianConditionChanged: true,
        ctasLevel: true,
        agreement: true,
        overrideReason: true,
        triageDurationMin: true,
        doorToTriageMin: true,
        missingFields: true,
        assessmentTrail: true,
        alertTriggered: true,
        alertSummary: true,
        redFlags: true,
        validatedPayload: true,
        disposition: true,
        aiConfidence: true,
        clinicalSummaryAr: true,
        clinicalSummaryEn: true,
      },
    });

    return computeEvaluationReport(
      rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        age: r.age,
        gender: r.gender,
        chiefComplaint: r.chiefComplaint,
        nurseCtas: r.nurseCtas,
        aiCtas: r.aiCtas,
        aiRecommendedCtas: r.aiRecommendedCtas,
        rulesRecommendedCtas: r.rulesRecommendedCtas,
        clinicianFinalCtas: r.clinicianFinalCtas,
        physicianCtas: r.physicianCtas,
        physicianValidatedAt: r.physicianValidatedAt,
        physicianConditionChanged: r.physicianConditionChanged,
        ctasLevel: r.ctasLevel,
        agreement: r.agreement,
        overrideReason: r.overrideReason,
        triageDurationMin: r.triageDurationMin,
        doorToTriageMin: r.doorToTriageMin,
        missingFields: r.missingFields,
        assessmentTrail: r.assessmentTrail,
        alertTriggered: r.alertTriggered,
        alertSummary: r.alertSummary,
        redFlags: r.redFlags,
        validatedPayload: r.validatedPayload,
        disposition: r.disposition,
        aiConfidence: r.aiConfidence,
        clinicalSummaryAr: r.clinicalSummaryAr,
        clinicalSummaryEn: r.clinicalSummaryEn,
      })),
      windowDays,
    );
  }
}
