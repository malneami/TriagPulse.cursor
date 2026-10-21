import { Injectable, NotFoundException } from '@nestjs/common';
import { Gender, JourneyStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import {
  computeLiveCTAS, detectRedFlags, getLibraryVersions, redactIdentifiers, stripIdentifiers, validateTriageReady,
  statusAfterCtasComplete,
} from '@triagepulse/clinical';

/**
 * The triage record comes from the client as loose JSON. Coerce it to the column types
 * so a blank or unexpected value is stored as "not recorded" instead of failing the
 * whole save (e.g. sex not captured arrived as "" and Prisma rejected the enum).
 */
function toNum(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
function toInt(v: unknown): number | undefined {
  const n = toNum(v);
  return n === undefined ? undefined : Math.round(n);
}
function toGender(v: unknown): Gender | undefined {
  return v === 'male' || v === 'female' ? (v as Gender) : undefined;
}
/** Free text is stored only after ID/phone numbers and spoken names are removed (PDPL). */
function safeText(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? redactIdentifiers(v) : undefined;
}
/** JSON blobs are stored without identifier keys and with redacted strings (PDPL). */
function safeJson<T>(v: T): T | undefined {
  return v == null ? undefined : stripIdentifiers(v);
}

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
    },
    user: { id: string; full_name?: string; email?: string },
  ) {
    const journey = await this.prisma.patientJourney.findUnique({ where: { id: data.journeyId } });
    if (!journey) throw new NotFoundException('Journey not found');

    const clinicianName = user.full_name || user.email || user.id;
    // Identifier keys (name, ID, phone, MRN…) are dropped before anything is read from it.
    const record = stripIdentifiers(data.triageRecord ?? {}) as Record<string, unknown>;

    const result = await this.prisma.$transaction(async (tx) => {
      const triageRecord = await tx.triageRecord.create({
        data: {
          journeyId: data.journeyId,
          createdById: user.id,
          arrivalTime: journey.arrivalTime,
          age: toInt(record.age) ?? journey.age ?? undefined,
          gender: toGender(record.gender) ?? journey.gender ?? undefined,
          chiefComplaint: safeText(record.chief_complaint),
          hr: toInt(record.hr),
          bpSystolic: toInt(record.bp_systolic),
          bpDiastolic: toInt(record.bp_diastolic),
          spo2: toInt(record.spo2),
          rr: toInt(record.rr),
          temperature: toNum(record.temperature),
          gcs: toInt(record.gcs),
          painScore: toInt(record.pain_score),
          transcription: safeText(record.transcription),
          ctasLevel: toInt(record.ctas_level),
          ctasNameAr: record.ctas_name_ar as string | undefined,
          ctasNameEn: record.ctas_name_en as string | undefined,
          maxWaitTime: record.max_wait_time as string | undefined,
          clinicalSummaryAr: safeText(record.clinical_summary_ar),
          redFlags: record.red_flags as object | undefined,
          disposition: safeText(record.disposition),
          nurseName: clinicianName,
          aiCtas: toInt(record.ai_ctas),
          nurseCtas: toInt(record.nurse_ctas),
          agreement: record.agreement as boolean | undefined,
          overrideReason: safeText(record.override_reason),
          flaggedForReview: (record.flagged_for_review as boolean) ?? false,
          triageDurationMin: toInt(record.triage_duration_min),
          patientId: journey.patientId,
          rulesRecommendedCtas: toInt(record.rules_recommended_ctas),
          aiRecommendedCtas: toInt(record.ai_recommended_ctas),
          clinicianFinalCtas: toInt(record.clinician_final_ctas),
          clinicianReviewedAt: new Date(),
          reviewedBy: clinicianName,
          ctasStartedAt: record.ctas_started_at ? new Date(record.ctas_started_at as string) : undefined,
          ctasCompletedAt: new Date(),
          doorToTriageMin: toInt(record.door_to_triage_min),
          alertTriggered: (record.alert_triggered as boolean) ?? false,
          alertTriggeredAt: record.alert_triggered_at ? new Date(record.alert_triggered_at as string) : undefined,
          alertAcknowledgedAt: record.alert_acknowledged_at ? new Date(record.alert_acknowledged_at as string) : undefined,
          alertResponseSec: toInt(record.alert_response_sec),
          alertSummary: safeText(record.alert_summary),
          aiConfidence: toNum(record.ai_confidence),
          safetyNote: safeText(record.safety_note),
          missingFields: record.missing_fields as object | undefined,
          assessmentTrail: typeof record.assessment_trail_json === 'string'
            ? (() => { try { return safeJson(JSON.parse(record.assessment_trail_json as string)); } catch { return record.assessment_trail_json; } })()
            : (record.assessment_trail_json as object | undefined)
              ?? (record.assessment_trail as object | undefined),
          libraryVersions: (record.library_versions as object | undefined)
            ?? getLibraryVersions(),
          clinicalSummaryEn: safeText(record.clinical_summary_en),
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
          currentStatus: statusAfterCtasComplete(journey.encounterNo) as JourneyStatus,
          ctasCompletedAt: new Date(),
          ctasLevel: toInt(record.clinician_final_ctas) ?? toInt(record.ctas_level),
          clinicianFinalCtas: toInt(record.clinician_final_ctas),
          rulesRecommendedCtas: toInt(record.rules_recommended_ctas),
          aiRecommendedCtas: toInt(record.ai_recommended_ctas),
          chiefComplaint: record.chief_complaint as string | undefined,
          alertAcknowledgedAt: record.alert_acknowledged_at ? new Date(record.alert_acknowledged_at as string) : undefined,
          alertAcknowledgedBy: record.alert_acknowledged_by as string | undefined ?? clinicianName,
          // Leave ctasReviewedAt null so the case enters the physician validation queue.
          incompleteDataFlags: (record.missing_fields as object | string | undefined) ?? undefined,
          // Final patient direction (nurse-confirmed), shown on the journey.
          currentLocation: typeof record.disposition === 'string' ? record.disposition : undefined,
          // Only these server-derived fields are written to the journey. The client can
          // no longer send arbitrary journey columns (mass-assignment fix, review B3).
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
