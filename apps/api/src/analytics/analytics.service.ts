import { Injectable } from '@nestjs/common';
import { computeEvaluationReport } from '@triagepulse/clinical';
import { PrismaService } from '../prisma/prisma.module';

/** Strip direct identifiers for governed export. */
function deIdentifyRecord(r: {
  id: string;
  createdAt: Date;
  age: number | null;
  gender: string | null;
  chiefComplaint: string | null;
  ctasLevel: number | null;
  rulesRecommendedCtas: number | null;
  aiRecommendedCtas: number | null;
  clinicianFinalCtas: number | null;
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
}) {
  return {
    record_id: r.id,
    created_at: r.createdAt.toISOString(),
    age_band: r.age == null ? null : r.age < 14 ? 'pediatric' : r.age < 65 ? 'adult' : 'elderly',
    gender: r.gender,
    chief_complaint: r.chiefComplaint,
    rules_recommended_ctas: r.rulesRecommendedCtas,
    ai_recommended_ctas: r.aiRecommendedCtas,
    clinician_final_ctas: r.clinicianFinalCtas ?? r.ctasLevel,
    agreement: r.agreement,
    override_reason: r.overrideReason,
    flagged_for_review: r.flaggedForReview,
    triage_duration_min: r.triageDurationMin,
    library_versions: r.libraryVersions,
    clinical_summary_ar: r.clinicalSummaryAr,
    clinical_summary_en: r.clinicalSummaryEn,
    assessment_trail: r.assessmentTrail,
    validated_payload: r.validatedPayload,
    ai_confidence: r.aiConfidence,
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

  async exportValidated(limit = 200, flaggedOnly = false) {
    const rows = await this.prisma.triageRecord.findMany({
      where: flaggedOnly ? { flaggedForReview: true } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 1000),
      select: {
        id: true,
        createdAt: true,
        age: true,
        gender: true,
        chiefComplaint: true,
        ctasLevel: true,
        rulesRecommendedCtas: true,
        aiRecommendedCtas: true,
        clinicianFinalCtas: true,
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
      },
    });

    return {
      exported_at: new Date().toISOString(),
      count: rows.length,
      de_identified: true,
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
