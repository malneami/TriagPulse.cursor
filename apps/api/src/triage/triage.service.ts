import { Injectable, NotFoundException } from '@nestjs/common';
import { Gender, JourneyStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import { computeLiveCTAS, detectRedFlags, getLibraryVersions, validateTriageReady } from '@triagepulse/clinical';

@Injectable()
export class TriageService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  evaluate(patient: Record<string, unknown>, answers: Record<string, unknown> = {}) {
    const ctas = computeLiveCTAS(patient, answers);
    const redFlags = detectRedFlags(patient, answers);
    const validation = validateTriageReady(patient);
    return { ctas, redFlags, validation };
  }

  async save(
    data: {
      journeyId: string;
      triageRecord: Record<string, unknown>;
      journeyUpdate?: Record<string, unknown>;
    },
    user: { id: string; full_name?: string; email?: string },
  ) {
    const journey = await this.prisma.patientJourney.findUnique({ where: { id: data.journeyId } });
    if (!journey) throw new NotFoundException('Journey not found');

    const clinicianName = user.full_name || user.email || user.id;
    const record = data.triageRecord;

    const result = await this.prisma.$transaction(async (tx) => {
      const triageRecord = await tx.triageRecord.create({
        data: {
          journeyId: data.journeyId,
          createdById: user.id,
          arrivalTime: journey.arrivalTime,
          patientNameAr: (record.patient_name_ar as string) ?? journey.patientNameAr,
          patientNameEn: (record.patient_name_en as string) ?? journey.patientNameEn,
          mrn: record.mrn as string | undefined,
          age: (record.age as number) ?? journey.age ?? undefined,
          gender: (record.gender as Gender) ?? journey.gender ?? undefined,
          nationality: record.nationality as string | undefined,
          phone: record.phone as string | undefined,
          insurance: record.insurance as string | undefined,
          chiefComplaint: record.chief_complaint as string | undefined,
          hr: record.hr as number | undefined,
          bpSystolic: record.bp_systolic as number | undefined,
          bpDiastolic: record.bp_diastolic as number | undefined,
          spo2: record.spo2 as number | undefined,
          rr: record.rr as number | undefined,
          temperature: record.temperature as number | undefined,
          gcs: record.gcs as number | undefined,
          painScore: record.pain_score as number | undefined,
          transcription: record.transcription as string | undefined,
          ctasLevel: record.ctas_level as number | undefined,
          ctasNameAr: record.ctas_name_ar as string | undefined,
          ctasNameEn: record.ctas_name_en as string | undefined,
          maxWaitTime: record.max_wait_time as string | undefined,
          clinicalSummaryAr: record.clinical_summary_ar as string | undefined,
          redFlags: record.red_flags as object | undefined,
          disposition: record.disposition as string | undefined,
          nurseName: clinicianName,
          aiCtas: record.ai_ctas as number | undefined,
          nurseCtas: record.nurse_ctas as number | undefined,
          agreement: record.agreement as boolean | undefined,
          overrideReason: record.override_reason as string | undefined,
          flaggedForReview: (record.flagged_for_review as boolean) ?? false,
          triageDurationMin: record.triage_duration_min as number | undefined,
          patientId: journey.patientId,
          rulesRecommendedCtas: record.rules_recommended_ctas as number | undefined,
          aiRecommendedCtas: record.ai_recommended_ctas as number | undefined,
          clinicianFinalCtas: record.clinician_final_ctas as number | undefined,
          clinicianReviewedAt: new Date(),
          reviewedBy: clinicianName,
          ctasStartedAt: record.ctas_started_at ? new Date(record.ctas_started_at as string) : undefined,
          ctasCompletedAt: new Date(),
          doorToTriageMin: record.door_to_triage_min as number | undefined,
          alertTriggered: (record.alert_triggered as boolean) ?? false,
          alertTriggeredAt: record.alert_triggered_at ? new Date(record.alert_triggered_at as string) : undefined,
          alertAcknowledgedAt: record.alert_acknowledged_at ? new Date(record.alert_acknowledged_at as string) : undefined,
          alertResponseSec: record.alert_response_sec as number | undefined,
          alertSummary: record.alert_summary as string | undefined,
          aiConfidence: record.ai_confidence as number | undefined,
          safetyNote: record.safety_note as string | undefined,
          missingFields: record.missing_fields as object | undefined,
          assessmentTrail: typeof record.assessment_trail_json === 'string'
            ? (() => { try { return JSON.parse(record.assessment_trail_json as string); } catch { return record.assessment_trail_json; } })()
            : (record.assessment_trail_json as object | undefined)
              ?? (record.assessment_trail as object | undefined),
          libraryVersions: (record.library_versions as object | undefined)
            ?? getLibraryVersions(),
          clinicalSummaryEn: record.clinical_summary_en as string | undefined,
          validatedPayload: (record.validated_payload as object | undefined) ?? {
            rules_recommended_ctas: record.rules_recommended_ctas,
            ai_recommended_ctas: record.ai_recommended_ctas,
            clinician_final_ctas: record.clinician_final_ctas,
            agreement: record.agreement,
            override_reason: record.override_reason,
            library_versions: record.library_versions ?? getLibraryVersions(),
            triage_duration_min: record.triage_duration_min,
            modifier_answers: (record.assessment_trail as { clarifying?: { answers?: unknown } } | undefined)
              ?.clarifying?.answers
              ?? null,
          },
        },
      });

      const updatedJourney = await tx.patientJourney.update({
        where: { id: data.journeyId },
        data: {
          currentStatus: JourneyStatus.completed,
          ctasCompletedAt: new Date(),
          ctasLevel: (record.clinician_final_ctas as number) ?? (record.ctas_level as number),
          clinicianFinalCtas: record.clinician_final_ctas as number | undefined,
          rulesRecommendedCtas: record.rules_recommended_ctas as number | undefined,
          aiRecommendedCtas: record.ai_recommended_ctas as number | undefined,
          chiefComplaint: record.chief_complaint as string | undefined,
          alertAcknowledgedAt: record.alert_acknowledged_at ? new Date(record.alert_acknowledged_at as string) : undefined,
          alertAcknowledgedBy: record.alert_acknowledged_by as string | undefined ?? clinicianName,
          ...(data.journeyUpdate || {}),
        },
      });

      return { triageRecord, updatedJourney };
    });

    await this.audit.log('TriageRecord', result.triageRecord.id, 'triage_saved', user, {
      journeyId: data.journeyId,
      ctasLevel: result.triageRecord.clinicianFinalCtas ?? result.triageRecord.ctasLevel,
    });

    return {
      success: true,
      triage_record_id: result.triageRecord.id,
      journey_id: result.updatedJourney.id,
    };
  }
}
