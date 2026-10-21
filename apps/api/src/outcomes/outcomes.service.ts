import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AdmissionLocation,
  DischargeDestination,
  DirectionAppropriate,
  JourneyStatus,
  OutcomeDisposition,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import {
  normalizeOutcomeReview,
  outcomeFieldSnapshot,
  outcomeReviewEligible,
  outcomeReviewMayAct,
  outcomeReviewVisible,
  redactIdentifiers,
  triageDurationSec,
} from '@triagepulse/clinical';

type Actor = { id: string; role: string; full_name?: string; email?: string };

function publicTicketCode(ticketNo: number, mrnSuffix?: string | null) {
  const seq = `T${String(ticketNo % 1000).padStart(3, '0')}`;
  const suffix = /^\d{3}$/.test(String(mrnSuffix || '')) ? String(mrnSuffix) : '•••';
  return `${seq}-${suffix}`;
}

const OUTCOME_STATUSES: JourneyStatus[] = [
  JourneyStatus.awaiting_outcome_review,
  JourneyStatus.outcome_reviewed,
  JourneyStatus.closed,
  JourneyStatus.validated,
];

const ROW_INCLUDE = {
  ctasReviews: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { nurseLevel: true, reviewedLevel: true, agreed: true },
  },
  triageRecords: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: {
      nurseCtas: true,
      ctasLevel: true,
      chiefComplaint: true,
      disposition: true,
      ctasStartedAt: true,
      ctasCompletedAt: true,
      createdById: true,
      createdBy: { select: { fullName: true } },
    },
  },
  outcomePhysician: { select: { id: true, fullName: true } },
  outcomeReview: { include: { reviewer: { select: { fullName: true } } } },
};

export type OutcomeListQuery = { status?: string; q?: string };

@Injectable()
export class OutcomesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private statusFilter(status?: string): JourneyStatus[] {
    const key = String(status || 'awaiting').toLowerCase();
    if (key === 'all') return OUTCOME_STATUSES;
    if (key === 'reviewed') return [JourneyStatus.outcome_reviewed];
    if (key === 'closed') return [JourneyStatus.closed];
    return [JourneyStatus.awaiting_outcome_review, JourneyStatus.validated];
  }

  private searchWhere(q?: string) {
    const raw = String(q || '').trim();
    if (!raw) return {};
    const compact = raw.replace(/\s+/g, '');
    const digits = compact.replace(/\D/g, '');
    const ticketMatch = compact.match(/t?(\d{1,6})$/i);
    const or: object[] = [
      { encounterNo: { contains: compact, mode: 'insensitive' as const } },
    ];
    if (/^\d{3}$/.test(digits)) or.push({ mrnSuffix: digits });
    if (ticketMatch) or.push({ ticketNo: Number(ticketMatch[1]) });
    return { OR: or };
  }

  private actorWhere(user: Actor) {
    if (user.role === 'physician') return { outcomePhysicianId: user.id };
    if (user.role === 'nurse') return { triageRecords: { some: { createdById: user.id } } };
    return {};
  }

  private assignmentOf(j: {
    outcomePhysicianId?: string | null;
    triageRecords: Array<{ createdById?: string | null }>;
  }) {
    return {
      ctasNurseId: j.triageRecords[0]?.createdById ?? null,
      outcomePhysicianId: j.outcomePhysicianId ?? null,
    };
  }

  private assertMayAct(user: Actor, journey: {
    outcomePhysicianId?: string | null;
    triageRecords: Array<{ createdById?: string | null }>;
  }) {
    if (!outcomeReviewMayAct(user, this.assignmentOf(journey))) {
      throw new ForbiddenException('Only the CTAS nurse or the assigned physician can complete outcome review.');
    }
  }

  private async requireEligible(id: string) {
    const journey = await this.prisma.patientJourney.findUnique({
      where: { id },
      include: ROW_INCLUDE,
    });
    if (!journey) throw new NotFoundException('Journey not found');
    if (!outcomeReviewEligible({ ctasReviewedAt: journey.ctasReviewedAt, encounterNo: journey.encounterNo })) {
      throw new BadRequestException('Outcome review is only for cases with physician CTAS validation and a HIS visit number.');
    }
    return journey;
  }

  private mapRow(j: {
    id: string;
    ticketNo: number;
    mrnSuffix: string | null;
    encounterNo: string | null;
    ctasCompletedAt: Date | null;
    ctasStartedAt: Date | null;
    age: number | null;
    gender: string | null;
    chiefComplaint: string | null;
    ctasLevel: number | null;
    currentStatus: JourneyStatus;
    currentLocation: string | null;
    outcomePhysicianId: string | null;
    outcomePhysician: { id: string; fullName: string } | null;
    ctasReviews: Array<{ nurseLevel: number; reviewedLevel: number; agreed: boolean }>;
    triageRecords: Array<{
      nurseCtas: number | null;
      ctasLevel: number | null;
      chiefComplaint: string | null;
      disposition: string | null;
      ctasStartedAt: Date | null;
      ctasCompletedAt: Date | null;
      createdById: string;
      createdBy: { fullName: string };
    }>;
    outcomeReview: {
      disposition: OutcomeDisposition;
      admissionSpecialty: string | null;
      admissionLocation: AdmissionLocation | null;
      hospitalUnitName: string | null;
      dischargeDestination: DischargeDestination | null;
      finalDiagnosis: string | null;
      reviewerComment: string | null;
      directionAppropriate: DirectionAppropriate | null;
      directionComment: string | null;
      source: string;
      reviewedAt: Date;
      updatedAt: Date;
      reviewer: { fullName: string };
    } | null;
  }, user: Actor) {
    const rec = j.triageRecords[0];
    const review = j.ctasReviews[0];
    const started = rec?.ctasStartedAt ?? j.ctasStartedAt;
    const completed = rec?.ctasCompletedAt ?? j.ctasCompletedAt;
    const assignment = this.assignmentOf(j);
    return {
      id: j.id,
      ticketNo: j.ticketNo,
      mrnSuffix: j.mrnSuffix,
      encounterNo: j.encounterNo,
      ctasCompletedAt: j.ctasCompletedAt,
      age: j.age,
      gender: j.gender,
      chiefComplaint: rec?.chiefComplaint ?? j.chiefComplaint,
      nurseCtas: rec?.nurseCtas ?? rec?.ctasLevel ?? j.ctasLevel,
      physicianCtas: review?.reviewedLevel ?? null,
      agreed: review?.agreed ?? null,
      triageDurationSec: triageDurationSec(started, completed),
      direction: rec?.disposition ?? j.currentLocation,
      currentStatus: j.currentStatus,
      ctasNurseId: rec?.createdById ?? null,
      ctasNurseName: rec?.createdBy?.fullName ?? null,
      outcomePhysicianId: j.outcomePhysicianId,
      outcomePhysicianName: j.outcomePhysician?.fullName ?? null,
      canAct: outcomeReviewMayAct(user, assignment),
      outcome: j.outcomeReview
        ? {
            disposition: j.outcomeReview.disposition,
            admissionSpecialty: j.outcomeReview.admissionSpecialty,
            admissionLocation: j.outcomeReview.admissionLocation,
            hospitalUnitName: j.outcomeReview.hospitalUnitName,
            dischargeDestination: j.outcomeReview.dischargeDestination,
            finalDiagnosis: j.outcomeReview.finalDiagnosis,
            reviewerComment: j.outcomeReview.reviewerComment,
            directionAppropriate: j.outcomeReview.directionAppropriate,
            directionComment: j.outcomeReview.directionComment,
            source: j.outcomeReview.source,
            reviewedAt: j.outcomeReview.reviewedAt,
            updatedAt: j.outcomeReview.updatedAt,
            reviewerName: j.outcomeReview.reviewer.fullName,
          }
        : null,
    };
  }

  async list(query: OutcomeListQuery, user: Actor) {
    const journeys = await this.prisma.patientJourney.findMany({
      where: {
        currentStatus: { in: this.statusFilter(query.status) },
        ctasReviewedAt: { not: null },
        encounterNo: { not: null },
        ...this.actorWhere(user),
        ...this.searchWhere(query.q),
      },
      orderBy: { ctasReviewedAt: 'desc' },
      include: ROW_INCLUDE,
    });
    return journeys
      .filter((j) => outcomeReviewVisible(user, this.assignmentOf(j)))
      .map((j) => this.mapRow(j, user));
  }

  async awaitingCount(user: Actor) {
    const journeys = await this.prisma.patientJourney.findMany({
      where: {
        currentStatus: { in: [JourneyStatus.awaiting_outcome_review, JourneyStatus.validated] },
        ctasReviewedAt: { not: null },
        encounterNo: { not: null },
        ...this.actorWhere(user),
      },
      select: {
        outcomePhysicianId: true,
        triageRecords: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdById: true } },
      },
    });
    return journeys.filter((j) => outcomeReviewVisible(user, this.assignmentOf(j))).length;
  }

  async listPhysicians() {
    return this.prisma.user.findMany({
      where: { role: UserRole.physician, active: true },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
  }

  async assignPhysician(journeyId: string, physicianId: string, user: Actor) {
    if (user.role !== 'admin') {
      throw new ForbiddenException('Only an admin can assign the outcome physician.');
    }
    const journey = await this.requireEligible(journeyId);
    const physician = await this.prisma.user.findUnique({ where: { id: physicianId } });
    if (!physician || !physician.active || physician.role !== UserRole.physician) {
      throw new BadRequestException('Select an active physician.');
    }
    await this.prisma.patientJourney.update({
      where: { id: journeyId },
      data: {
        outcomePhysicianId: physician.id,
        outcomeAssignedAt: new Date(),
        outcomeAssignedById: user.id,
      },
    });
    await this.audit.log('PatientJourney', journeyId, 'outcome_physician_assigned', user, {
      ticketNo: journey.ticketNo,
      physicianId: physician.id,
      previousPhysicianId: journey.outcomePhysicianId,
    });
    const fresh = await this.requireEligible(journeyId);
    return this.mapRow(fresh, user);
  }

  async upsert(
    journeyId: string,
    body: Record<string, unknown>,
    user: Actor,
    close = false,
  ) {
    const journey = await this.requireEligible(journeyId);
    this.assertMayAct(user, journey);
    const parsed = normalizeOutcomeReview(body);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    const fields = {
      disposition: parsed.value.disposition as OutcomeDisposition,
      admissionSpecialty: parsed.value.admissionSpecialty,
      admissionLocation: parsed.value.admissionLocation as AdmissionLocation | null,
      hospitalUnitName: parsed.value.hospitalUnitName,
      dischargeDestination: parsed.value.dischargeDestination as DischargeDestination | null,
      finalDiagnosis: redactIdentifiers(parsed.value.finalDiagnosis || '') || null,
      reviewerComment: redactIdentifiers(parsed.value.reviewerComment || '') || null,
      directionAppropriate: parsed.value.directionAppropriate as DirectionAppropriate | null,
      directionComment: redactIdentifiers(parsed.value.directionComment || '') || null,
      source: 'his_manual',
      reviewerId: user.id,
      reviewedAt: new Date(),
    };
    const previous = journey.outcomeReview
      ? outcomeFieldSnapshot({
          disposition: journey.outcomeReview.disposition,
          admissionSpecialty: journey.outcomeReview.admissionSpecialty,
          admissionLocation: journey.outcomeReview.admissionLocation,
          hospitalUnitName: journey.outcomeReview.hospitalUnitName,
          dischargeDestination: journey.outcomeReview.dischargeDestination,
          finalDiagnosis: journey.outcomeReview.finalDiagnosis,
          reviewerComment: journey.outcomeReview.reviewerComment,
          directionAppropriate: journey.outcomeReview.directionAppropriate,
          directionComment: journey.outcomeReview.directionComment,
        })
      : null;
    const stayClosed = close || journey.currentStatus === JourneyStatus.closed;
    const nextStatus = stayClosed ? JourneyStatus.closed : JourneyStatus.outcome_reviewed;
    await this.prisma.$transaction([
      this.prisma.outcomeReview.upsert({
        where: { journeyId },
        create: { journeyId, ...fields },
        update: fields,
      }),
      this.prisma.patientJourney.update({
        where: { id: journeyId },
        data: { currentStatus: nextStatus },
      }),
    ]);
    await this.audit.log('PatientJourney', journeyId, previous ? 'outcome_updated' : 'outcome_saved', user, {
      ticketNo: journey.ticketNo,
      previous,
      next: outcomeFieldSnapshot(parsed.value),
      closed: close,
    });
    if (close) {
      await this.audit.log('PatientJourney', journeyId, 'outcome_closed', user, { ticketNo: journey.ticketNo });
    }
    const fresh = await this.requireEligible(journeyId);
    return this.mapRow(fresh, user);
  }

  async close(journeyId: string, user: Actor) {
    const journey = await this.requireEligible(journeyId);
    this.assertMayAct(user, journey);
    if (!journey.outcomeReview) {
      throw new BadRequestException('Save the outcome review before closing the case.');
    }
    await this.prisma.patientJourney.update({
      where: { id: journeyId },
      data: { currentStatus: JourneyStatus.closed },
    });
    await this.audit.log('PatientJourney', journeyId, 'outcome_closed', user, { ticketNo: journey.ticketNo });
    const fresh = await this.requireEligible(journeyId);
    return this.mapRow(fresh, user);
  }

  async exportCsv(query: OutcomeListQuery, user: Actor) {
    const rows = await this.list(query, user);
    const headers = [
      'case_id', 'encounter_no', 'mrn_suffix', 'ctas_completed_at', 'age', 'sex',
      'chief_complaint', 'nurse_ctas', 'physician_ctas', 'agreement',
      'triage_duration_sec', 'direction', 'status',
      'ctas_nurse', 'assigned_physician',
      'disposition', 'admission_specialty', 'admission_location', 'hospital_unit',
      'discharge_destination', 'final_diagnosis', 'reviewer_comment',
      'direction_appropriate', 'direction_comment', 'source', 'reviewer_name', 'reviewed_at',
    ];
    const lines = [headers.join(',')];
    for (const r of rows) {
      const o = r.outcome;
      const cells = [
        publicTicketCode(r.ticketNo, r.mrnSuffix),
        r.encounterNo,
        r.mrnSuffix,
        r.ctasCompletedAt ? new Date(r.ctasCompletedAt).toISOString() : '',
        r.age,
        r.gender,
        r.chiefComplaint,
        r.nurseCtas,
        r.physicianCtas,
        r.agreed == null ? '' : r.agreed ? 'agree' : 'disagree',
        r.triageDurationSec,
        r.direction,
        r.currentStatus,
        r.ctasNurseName,
        r.outcomePhysicianName,
        o?.disposition,
        o?.admissionSpecialty,
        o?.admissionLocation,
        o?.hospitalUnitName,
        o?.dischargeDestination,
        o?.finalDiagnosis,
        o?.reviewerComment,
        o?.directionAppropriate,
        o?.directionComment,
        o?.source,
        o?.reviewerName,
        o?.reviewedAt ? new Date(o.reviewedAt).toISOString() : '',
      ];
      lines.push(cells.map(csvCell).join(','));
    }
    return `\uFEFF${lines.join('\r\n')}`;
  }
}

function csvCell(value: unknown): string {
  if (value == null || value === '') return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
