import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AdmissionLocation,
  DischargeDestination,
  DirectionAppropriate,
  JourneyStatus,
  OutcomeDeath,
  OutcomeDisposition,
  ReturnVisit72h,
  UserRole,
  YesNoUnknown,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import {
  highAcuityOutcome,
  normalizeOutcomeReview,
  outcomeCloseProblem,
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

export type OutcomeListQuery = {
  status?: string;
  q?: string;
  /** Arrival date range, YYYY-MM-DD (Riyadh days, inclusive). */
  from?: string;
  to?: string;
  /** Time-of-day window of arrival, HH:MM Riyadh time, inclusive; may cross midnight (22:00–06:00). */
  timeFrom?: string;
  timeTo?: string;
  /** Age range in years, inclusive. */
  ageMin?: string | number;
  ageMax?: string | number;
  /** 'unassigned' = no outcome physician yet. */
  assigned?: string;
};

/** Riyadh is UTC+3 all year: a Riyadh calendar day starts at 21:00 UTC the day before. */
function riyadhDayStart(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T00:00:00+03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** HH:MM of a moment in Riyadh time (UTC+3, no daylight saving). */
export function riyadhHHMM(t: Date): string {
  const r = new Date(t.getTime() + 3 * 3600 * 1000);
  return `${String(r.getUTCHours()).padStart(2, '0')}:${String(r.getUTCMinutes()).padStart(2, '0')}`;
}

/** True when the arrival time falls in the time-of-day window (either end optional; may wrap midnight). */
export function inTimeWindow(t: Date | null | undefined, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  if (!t) return false;
  const hm = riyadhHHMM(t);
  if (from && to) return from <= to ? hm >= from && hm <= to : hm >= from || hm <= to;
  if (from) return hm >= from;
  return hm <= (to as string);
}

function ageBound(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 130 ? n : null;
}

export const BULK_ASSIGN_LIMIT = 500;

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

  /** Date, age and assignment filters (admin uses them to pick a set of cases). */
  private filterWhere(query: OutcomeListQuery) {
    const where: Record<string, unknown> = {};
    const from = query.from ? riyadhDayStart(query.from) : null;
    const toStart = query.to ? riyadhDayStart(query.to) : null;
    if (query.from && !from) throw new BadRequestException('From date must be YYYY-MM-DD.');
    if (query.to && !toStart) throw new BadRequestException('To date must be YYYY-MM-DD.');
    if (from || toStart) {
      where.arrivalTime = {
        ...(from ? { gte: from } : {}),
        ...(toStart ? { lt: new Date(toStart.getTime() + 24 * 3600 * 1000) } : {}),
      };
    }
    const ageMin = ageBound(query.ageMin);
    const ageMax = ageBound(query.ageMax);
    if ((query.ageMin != null && query.ageMin !== '' && ageMin == null) || (query.ageMax != null && query.ageMax !== '' && ageMax == null)) {
      throw new BadRequestException('Age must be a whole number of years (0–130).');
    }
    if (ageMin != null && ageMax != null && ageMin > ageMax) throw new BadRequestException('Age from is above age to.');
    if (ageMin != null || ageMax != null) {
      where.age = { ...(ageMin != null ? { gte: ageMin } : {}), ...(ageMax != null ? { lte: ageMax } : {}) };
    }
    if (String(query.assigned || '').toLowerCase() === 'unassigned') where.outcomePhysicianId = null;
    return where;
  }

  private actorWhere(user: Actor) {
    if (user.role === 'physician') return { outcomePhysicianId: user.id };
    if (user.role === 'admin') return {};
    // Nurses do not record outcomes (the triage nurse must not record her own reference).
    return { id: '__none__' };
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
      throw new ForbiddenException('Only the physician assigned by an admin can complete outcome review (never the triage nurse).');
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
    arrivalTime: Date;
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
      finalDiagnosisCode: string | null;
      interventions: string[];
      icuWithin24h: YesNoUnknown | null;
      death: OutcomeDeath | null;
      resources: string[];
      resourceCount: number | null;
      return72h: ReturnVisit72h | null;
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
      arrivalTime: j.arrivalTime,
      closeProblem: j.outcomeReview ? outcomeCloseProblem(j.outcomeReview, j.arrivalTime) : 'Save the outcome review first.',
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
            finalDiagnosisCode: j.outcomeReview.finalDiagnosisCode,
            interventions: j.outcomeReview.interventions,
            icuWithin24h: j.outcomeReview.icuWithin24h,
            death: j.outcomeReview.death,
            resources: j.outcomeReview.resources,
            resourceCount: j.outcomeReview.resourceCount,
            return72h: j.outcomeReview.return72h,
            highAcuityOutcome: highAcuityOutcome(j.outcomeReview),
            source: j.outcomeReview.source,
            reviewedAt: j.outcomeReview.reviewedAt,
            updatedAt: j.outcomeReview.updatedAt,
            reviewerName: j.outcomeReview.reviewer.fullName,
          }
        : null,
    };
  }

  async list(query: OutcomeListQuery, user: Actor) {
    const timeFrom = query.timeFrom ? String(query.timeFrom) : '';
    const timeTo = query.timeTo ? String(query.timeTo) : '';
    if ((timeFrom && !HHMM.test(timeFrom)) || (timeTo && !HHMM.test(timeTo))) {
      throw new BadRequestException('Time must be HH:MM.');
    }
    const journeys = await this.prisma.patientJourney.findMany({
      where: {
        currentStatus: { in: this.statusFilter(query.status) },
        ctasReviewedAt: { not: null },
        encounterNo: { not: null },
        ...this.actorWhere(user),
        ...this.searchWhere(query.q),
        ...this.filterWhere(query),
      },
      orderBy: { ctasReviewedAt: 'desc' },
      include: ROW_INCLUDE,
    });
    return journeys
      .filter((j) => outcomeReviewVisible(user, this.assignmentOf(j)))
      .filter((j) => inTimeWindow(j.arrivalTime, timeFrom, timeTo))
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
    if (journey.triageRecords[0]?.createdById === physician.id) {
      throw new BadRequestException('The person who triaged this case cannot record its outcome.');
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

  /**
   * Assign one physician to a set of cases in one step (admin). Each case is checked like a
   * single assignment: it must be eligible, and the physician must not have triaged it.
   */
  async assignPhysicianBulk(journeyIds: string[], physicianId: string, user: Actor) {
    if (user.role !== 'admin') {
      throw new ForbiddenException('Only an admin can assign the outcome physician.');
    }
    const ids = [...new Set((journeyIds || []).map(String).filter(Boolean))];
    if (!ids.length) throw new BadRequestException('Select at least one case.');
    if (ids.length > BULK_ASSIGN_LIMIT) throw new BadRequestException(`Assign at most ${BULK_ASSIGN_LIMIT} cases at a time.`);
    const physician = await this.prisma.user.findUnique({ where: { id: physicianId } });
    if (!physician || !physician.active || physician.role !== UserRole.physician) {
      throw new BadRequestException('Select an active physician.');
    }
    const journeys = await this.prisma.patientJourney.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, ticketNo: true, ctasReviewedAt: true, encounterNo: true, outcomePhysicianId: true,
        triageRecords: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdById: true } },
      },
    });
    const found = new Map(journeys.map((j) => [j.id, j]));
    const skipped: Array<{ id: string; reason: string }> = [];
    const toAssign: typeof journeys = [];
    for (const id of ids) {
      const j = found.get(id);
      if (!j) { skipped.push({ id, reason: 'not_found' }); continue; }
      if (!outcomeReviewEligible({ ctasReviewedAt: j.ctasReviewedAt, encounterNo: j.encounterNo })) {
        skipped.push({ id, reason: 'not_eligible' }); continue;
      }
      if (j.triageRecords[0]?.createdById === physician.id) {
        skipped.push({ id, reason: 'triaged_by_this_physician' }); continue;
      }
      toAssign.push(j);
    }
    if (toAssign.length) {
      const now = new Date();
      await this.prisma.patientJourney.updateMany({
        where: { id: { in: toAssign.map((j) => j.id) } },
        data: { outcomePhysicianId: physician.id, outcomeAssignedAt: now, outcomeAssignedById: user.id },
      });
      for (const j of toAssign) {
        await this.audit.log('PatientJourney', j.id, 'outcome_physician_assigned', user, {
          ticketNo: j.ticketNo, physicianId: physician.id, previousPhysicianId: j.outcomePhysicianId, bulk: true,
        });
      }
    }
    return { assigned: toAssign.length, skipped };
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
      finalDiagnosisCode: parsed.value.finalDiagnosisCode,
      interventions: parsed.value.interventions,
      icuWithin24h: parsed.value.icuWithin24h as YesNoUnknown,
      death: parsed.value.death as OutcomeDeath,
      resources: parsed.value.resources,
      resourceCount: parsed.value.resourceCount,
      return72h: parsed.value.return72h as ReturnVisit72h,
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
          finalDiagnosisCode: journey.outcomeReview.finalDiagnosisCode ?? '',
          interventions: journey.outcomeReview.interventions,
          icuWithin24h: journey.outcomeReview.icuWithin24h ?? 'unknown',
          death: journey.outcomeReview.death ?? 'unknown',
          resources: journey.outcomeReview.resources,
          resourceCount: journey.outcomeReview.resourceCount ?? 0,
          return72h: journey.outcomeReview.return72h ?? 'unknown',
        })
      : null;
    if (close) {
      const problem = outcomeCloseProblem(parsed.value, journey.arrivalTime);
      if (problem) throw new BadRequestException(problem);
    }
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
    const problem = outcomeCloseProblem(journey.outcomeReview, journey.arrivalTime);
    if (problem) throw new BadRequestException(problem);
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
      'discharge_destination', 'final_diagnosis_icd10', 'final_diagnosis', 'reviewer_comment',
      'interventions', 'icu_within_24h', 'death', 'resources', 'resource_count', 'return_72h',
      'high_acuity_outcome',
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
        o?.finalDiagnosisCode,
        o?.finalDiagnosis,
        o?.reviewerComment,
        o?.interventions?.join('|'),
        o?.icuWithin24h,
        o?.death,
        o?.resources?.join('|'),
        o?.resourceCount,
        o?.return72h,
        o == null || o.highAcuityOutcome == null ? '' : o.highAcuityOutcome ? 'yes' : 'no',
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
