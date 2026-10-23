import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, JourneyStatus, Gender, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import { assignDestination, calculateRespiratoryScore, physicianMayAct, physicianValidationEligible } from '@triagepulse/clinical';
import { randomUUID } from 'crypto';

/** Public tracking code: T + last 3 of the counter + last 3 of MRN (T017-••• until known). */
function publicTicketCode(ticketNo: number, mrnSuffix?: string | null) {
  const seq = `T${String(ticketNo % 1000).padStart(3, '0')}`;
  const suffix = /^\d{3}$/.test(String(mrnSuffix || '')) ? String(mrnSuffix) : '•••';
  return `${seq}-${suffix}`;
}

@Injectable()
export class JourneysService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async create(
    data: {
      age?: number;
      gender?: Gender;
      modeOfArrival?: string;
      encounterNo?: string;
      mrnSuffix?: string;
    },
    user: { id: string; full_name?: string; email?: string },
  ) {
    const encounterNo = data.encounterNo ? await this.checkEncounter(data.encounterNo) : null;
    const mrnSuffix = data.mrnSuffix ? this.checkMrnSuffix(data.mrnSuffix) : null;
    const journey = await this.prisma.patientJourney.create({
      data: {
        ...(encounterNo ? { encounterNo, encounterLinkedAt: new Date(), encounterLinkedById: user.id } : {}),
        ...(mrnSuffix ? { mrnSuffix } : {}),
        patientId: randomUUID(),
        createdById: user.id,
        age: data.age,
        gender: data.gender,
        modeOfArrival: data.modeOfArrival,
        currentStatus: JourneyStatus.visual_triage,
        currentLocation: 'ARRIVAL',
      },
    });
    await this.audit.log('PatientJourney', journey.id, 'journey_created', user, {
      patientId: journey.patientId,
      encounterLinked: !!encounterNo,
      mrnSuffixSet: !!mrnSuffix,
    });
    return journey;
  }

  async findOne(id: string, user: { id: string; role: string }) {
    const journey = await this.prisma.patientJourney.findUnique({ where: { id } });
    if (!journey) throw new NotFoundException('Journey not found');
    if (user.role !== 'admin' && journey.createdById !== user.id) {
      throw new ForbiddenException('Access denied');
    }
    return journey;
  }

  async findActive(user: { id: string; role: string }) {
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const where: Prisma.PatientJourneyWhereInput = {
      arrivalTime: { gte: cutoff },
      currentStatus: {
        notIn: [
          JourneyStatus.awaiting_his_link,
          JourneyStatus.pending_physician_validation,
          JourneyStatus.validated,
          JourneyStatus.awaiting_outcome_review,
          JourneyStatus.outcome_reviewed,
          JourneyStatus.closed,
          JourneyStatus.completed,
          JourneyStatus.seen,
        ],
      },
    };
    if (user.role !== 'admin') {
      where.OR = [{ createdById: user.id }, { currentStatus: { not: JourneyStatus.visual_triage } }];
    }
    return this.prisma.patientJourney.findMany({
      where,
      orderBy: { arrivalTime: 'asc' },
    });
  }

  async submitVisualTriage(
    id: string,
    data: {
      sectionA: { breathing: string; consciousness: string; bleeding: string; skin: string; mobility: string };
      respiratorySymptoms: Record<string, boolean>;
      monkeypoxRisk: string;
      maskGiven?: boolean;
      handHygieneDone?: boolean;
      alertTeamNotified?: boolean;
      age?: number;
      gender?: Gender;
      vtDurationSec?: number;
    },
    user: { id: string; full_name?: string; email?: string; role: string },
  ) {
    const journey = await this.findOne(id, user);
    const respiratoryScore = calculateRespiratoryScore(data.respiratorySymptoms);
    const destination = assignDestination({
      sectionA: data.sectionA,
      respiratoryScore,
      monkeypoxRisk: data.monkeypoxRisk,
      patientAge: data.age ?? journey.age,
    });

    const updated = await this.prisma.patientJourney.update({
      where: { id },
      data: {
        vtCompleted: true,
        vtCompletedAt: new Date(),
        vtDurationSec: data.vtDurationSec,
        vtSectionABreathing: data.sectionA.breathing,
        vtSectionAConsciousness: data.sectionA.consciousness,
        vtSectionABleeding: data.sectionA.bleeding,
        vtSectionASkin: data.sectionA.skin,
        vtSectionAMobility: data.sectionA.mobility,
        vtRespiratoryScore: respiratoryScore,
        vtRespiratorySymptoms: JSON.stringify(data.respiratorySymptoms),
        vtMonkeypoxRisk: data.monkeypoxRisk,
        vtDestination: destination.destination,
        vtDestinationAr: destination.destination_ar,
        vtDestinationEn: destination.destination_en,
        vtMaskGiven: data.maskGiven ?? false,
        vtHandHygieneDone: data.handHygieneDone ?? false,
        vtAlertTeamNotified: data.alertTeamNotified ?? false,
        age: data.age ?? journey.age,
        gender: data.gender ?? journey.gender,
        currentStatus: destination.bypass_registration ? JourneyStatus.awaiting_ctas : JourneyStatus.awaiting_ctas,
        currentLocation: destination.destination,
      },
    });

    await this.audit.log('PatientJourney', id, 'visual_triage_completed', user, {
      destination: destination.destination,
      respiratoryScore,
    });

    return { journey: updated, destination };
  }

  async updateStatus(id: string, status: JourneyStatus, user: { id: string; role: string; full_name?: string; email?: string }) {
    if (
      status === JourneyStatus.awaiting_his_link
      || status === JourneyStatus.pending_physician_validation
      || status === JourneyStatus.validated
      || status === JourneyStatus.awaiting_outcome_review
      || status === JourneyStatus.outcome_reviewed
      || status === JourneyStatus.closed
    ) {
      throw new BadRequestException('HIS handoff status is set when CTAS is saved, the visit number is linked, or the physician validates.');
    }
    // Marking a patient as seen is a department-wide board action (any user with
    // perform_triage); other status changes stay limited to the journey's creator.
    const journey = status === JourneyStatus.seen
      ? await this.prisma.patientJourney.findUnique({ where: { id } })
      : await this.findOne(id, user);
    if (!journey) throw new NotFoundException('Journey not found');
    if (status === JourneyStatus.seen && !physicianMayAct(user, journey.assignedPhysicianId)) {
      throw new ForbiddenException('This case is assigned to another physician');
    }
    if (status === JourneyStatus.seen) {
      await this.audit.log('PatientJourney', id, 'patient_seen', user, { ticketNo: journey.ticketNo });
    }
    // Stamp the CTAS start once, with server time, the first time triage begins.
    // Re-opening the patient must not restart the triage clock.
    const startingCtas = status === JourneyStatus.ctas_in_progress && !journey.ctasStartedAt;
    // 'seen' records when a physician saw the patient (door-to-doctor), once.
    const markingSeen = status === JourneyStatus.seen && !journey.seenAt;
    return this.prisma.patientJourney.update({
      where: { id },
      data: {
        currentStatus: status,
        ...(startingCtas ? { ctasStartedAt: new Date() } : {}),
        ...(markingSeen ? { seenAt: new Date() } : {}),
      },
    });
  }

  // ── HIS encounter number (Stage A) ─────────────────────────────────────
  /** Format of a scanned or typed encounter number. Override with ENCOUNTER_PATTERN. */
  private encounterPattern(): RegExp {
    // Default: HIS visit/voucher number (9–10 digits). Refuses the 7-digit file number
    // (use last 3 in the MRN box) and the 8-digit appointment / Ref. Invoice number.
    try { return new RegExp(process.env.ENCOUNTER_PATTERN || '^\\d{9,10}$'); } catch { return /^\d{9,10}$/; }
  }

  /** Cleans and checks an encounter number; 400 if malformed, 409 if another patient has it. */
  private async checkEncounter(raw: string, journeyId?: string): Promise<string> {
    const encounterNo = String(raw || '').trim().replace(/\s+/g, '').toUpperCase();
    if (!this.encounterPattern().test(encounterNo)) {
      throw new BadRequestException(/^\d{6,7}$/.test(encounterNo)
        ? 'This is the patient file number (MRN). Enter the last 3 digits in the MRN box — not as the visit number.'
        : 'Enter the visit or voucher number (9–10 digits).');
    }
    const other = await this.prisma.patientJourney.findUnique({ where: { encounterNo } });
    if (other && other.id !== journeyId) {
      throw new ConflictException(`Visit number ${encounterNo} is already linked to ${publicTicketCode(other.ticketNo, other.mrnSuffix)}.`);
    }
    return encounterNo;
  }

  /** Last 3 digits of the file number only. Never store a 6–7 digit MRN. */
  private checkMrnSuffix(raw: string): string {
    const v = String(raw || '').trim();
    if (!/^\d{3}$/.test(v)) {
      throw new BadRequestException('Enter the last 3 digits of the patient file number (MRN).');
    }
    return v;
  }

  /**
   * Links the HIS visit/voucher number and/or last-3 MRN to a journey. Department-wide
   * (any triage user: nurse or clerk at the desk), audit-logged. The same visit number
   * cannot sit on two patients. Full MRN is never stored.
   */
  async linkEncounter(
    id: string,
    body: { encounterNo?: string; mrnSuffix?: string },
    user: { id: string; role: string; full_name?: string; email?: string },
  ) {
    const journey = await this.prisma.patientJourney.findUnique({ where: { id } });
    if (!journey) throw new NotFoundException('Journey not found');

    const patch: Prisma.PatientJourneyUncheckedUpdateInput = {};
    let encounterAction: 'linked' | 'relinked' | null = null;

    const rawEnc = body.encounterNo != null ? String(body.encounterNo).trim() : '';
    if (rawEnc) {
      const encounterNo = await this.checkEncounter(rawEnc, id);
      if (journey.encounterNo !== encounterNo) {
        patch.encounterNo = encounterNo;
        patch.encounterLinkedAt = new Date();
        patch.encounterLinkedById = user.id;
        encounterAction = journey.encounterNo ? 'relinked' : 'linked';
        if (journey.ctasCompletedAt && !journey.ctasReviewedAt) {
          patch.currentStatus = JourneyStatus.pending_physician_validation;
        }
      }
    }

    const rawSuffix = body.mrnSuffix != null ? String(body.mrnSuffix).trim() : '';
    if (rawSuffix) {
      const mrnSuffix = this.checkMrnSuffix(rawSuffix);
      if (journey.mrnSuffix !== mrnSuffix) patch.mrnSuffix = mrnSuffix;
    }

    if (Object.keys(patch).length === 0) {
      if (rawEnc || rawSuffix) return journey;
      throw new BadRequestException(
        'Enter the visit or voucher number (9–10 digits), or the last 3 digits of the file number.',
      );
    }

    const updated = await this.prisma.patientJourney.update({ where: { id }, data: patch });
    if (encounterAction) {
      await this.audit.log('PatientJourney', id, encounterAction === 'relinked' ? 'encounter_relinked' : 'encounter_linked', user, {
        ticketNo: journey.ticketNo,
        previous: journey.encounterNo || null,
      });
    }
    if (patch.mrnSuffix) {
      await this.audit.log('PatientJourney', id, 'mrn_suffix_set', user, { ticketNo: journey.ticketNo });
    }
    return updated;
  }

  async findByEncounter(raw: string) {
    const encounterNo = String(raw || '').trim().replace(/\s+/g, '').toUpperCase();
    if (!this.encounterPattern().test(encounterNo)) {
      throw new BadRequestException('Enter the visit or voucher number (9–10 digits).');
    }
    const journey = await this.prisma.patientJourney.findUnique({ where: { encounterNo } });
    if (!journey) throw new NotFoundException('No patient has this visit or voucher number yet');
    return journey;
  }

  /** Completed CTAS still waiting for a HIS visit number (nurse handoff list). */
  async findUnlinked(hours = 24) {
    const cutoff = new Date(Date.now() - Math.min(Math.max(hours, 1), 72) * 3600 * 1000);
    return this.prisma.patientJourney.findMany({
      where: {
        currentStatus: JourneyStatus.awaiting_his_link,
        arrivalTime: { gte: cutoff },
      },
      orderBy: { arrivalTime: 'asc' },
      select: {
        id: true, patientId: true, ticketNo: true, mrnSuffix: true, age: true, gender: true,
        arrivalTime: true, ctasLevel: true, ctasCompletedAt: true, currentStatus: true, ctasReviewedAt: true,
      },
    });
  }

  // ── Physician validation of the nurse CTAS level ──────────────────────
  /**
   * Agree (same level) or disagree (a different level with a reason). The nurse's
   * CTAS on the journey and triage record is never overwritten; the physician
   * assessment is stored on CtasReview and clinicianFinalCtas for audit.
   */
  async reviewCtas(
    id: string,
    body: { level: number; reason?: string; conditionChanged?: boolean },
    user: { id: string; role: string; full_name?: string; email?: string },
  ) {
    const level = Number(body.level);
    if (!Number.isInteger(level) || level < 1 || level > 5) throw new BadRequestException('CTAS level must be 1–5');
    const journey = await this.prisma.patientJourney.findUnique({ where: { id } });
    if (!journey) throw new NotFoundException('Journey not found');
    if (journey.ctasReviewedAt) throw new ConflictException('This case has already been validated');
    if (!physicianValidationEligible({ ctasCompletedAt: journey.ctasCompletedAt, encounterNo: journey.encounterNo })) {
      throw new BadRequestException('Link a HIS visit / voucher number before physician validation.');
    }
    if (!physicianMayAct(user, journey.assignedPhysicianId)) {
      throw new ForbiddenException('This case is assigned to another physician');
    }
    const record = await this.prisma.triageRecord.findFirst({ where: { journeyId: id }, orderBy: { createdAt: 'desc' } });
    const nurseLevel = record?.nurseCtas ?? record?.ctasLevel ?? journey.ctasLevel;
    if (nurseLevel == null) throw new BadRequestException('This patient has no triage level yet');
    const agreed = level === nurseLevel;
    const reason = String(body.reason || '').trim().slice(0, 300) || null;
    if (!agreed && !reason) throw new BadRequestException('Give a short reason for the new level');
    const review = await this.prisma.ctasReview.create({
      data: {
        journeyId: id,
        triageRecordId: record?.id ?? null,
        nurseLevel,
        reviewedLevel: level,
        agreed,
        reason: agreed ? null : reason,
        conditionChanged: !agreed && !!body.conditionChanged,
        reviewerId: user.id,
        reviewerRole: user.role as UserRole,
      },
    });
    const claiming = !journey.assignedPhysicianId;
    const updated = await this.prisma.patientJourney.update({
      where: { id },
      data: {
        clinicianFinalCtas: level,
        physicianCtas: level,
        ctasReviewedAt: new Date(),
        currentStatus: JourneyStatus.awaiting_outcome_review,
        ...(claiming ? { assignedPhysicianId: user.id, assignedAt: new Date() } : {}),
      },
    });
    if (record) {
      await this.prisma.triageRecord.update({
        where: { id: record.id },
        data: {
          clinicianFinalCtas: level,
          clinicianReviewedAt: new Date(),
          reviewedBy: user.role,
          // The accuracy reference lives in its own fields, set only here (never at save).
          physicianCtas: level,
          physicianValidatedAt: review.createdAt,
          physicianConditionChanged: review.conditionChanged,
        },
      });
    }
    await this.audit.log('PatientJourney', id, agreed ? 'ctas_validated_agreed' : 'ctas_validated_disagreed', user, {
      ticketNo: journey.ticketNo, nurseLevel, physicianLevel: level, reviewId: review.id, conditionChanged: review.conditionChanged, claimed: claiming,
    });
    return { journey: updated, review };
  }
}
