import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, JourneyStatus, Gender, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import { assignDestination, calculateRespiratoryScore } from '@triagepulse/clinical';
import { randomUUID } from 'crypto';

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
    },
    user: { id: string; full_name?: string; email?: string },
  ) {
    const encounterNo = data.encounterNo ? await this.checkEncounter(data.encounterNo) : null;
    const journey = await this.prisma.patientJourney.create({
      data: {
        ...(encounterNo ? { encounterNo, encounterLinkedAt: new Date(), encounterLinkedById: user.id } : {}),
        patientId: randomUUID(),
        createdById: user.id,
        age: data.age,
        gender: data.gender,
        modeOfArrival: data.modeOfArrival,
        currentStatus: JourneyStatus.visual_triage,
        currentLocation: 'ARRIVAL',
      },
    });
    await this.audit.log('PatientJourney', journey.id, 'journey_created', user, { patientId: journey.patientId, encounterLinked: !!encounterNo });
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
      currentStatus: { notIn: [JourneyStatus.completed, JourneyStatus.seen] },
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
    // Marking a patient as seen is a department-wide board action (any user with
    // perform_triage); other status changes stay limited to the journey's creator.
    const journey = status === JourneyStatus.seen
      ? await this.prisma.patientJourney.findUnique({ where: { id } })
      : await this.findOne(id, user);
    if (!journey) throw new NotFoundException('Journey not found');
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
    // Default: the HIS "Transaction No." on the visit ticket (9–10 digits). This refuses the
    // 7-digit patient file number (the ticket's barcode) and the 8-digit appointment number.
    try { return new RegExp(process.env.ENCOUNTER_PATTERN || '^\\d{9,10}$'); } catch { return /^\d{9,10}$/; }
  }

  /** Cleans and checks an encounter number; 400 if malformed, 409 if another patient has it. */
  private async checkEncounter(raw: string, journeyId?: string): Promise<string> {
    const encounterNo = String(raw || '').trim().replace(/\s+/g, '').toUpperCase();
    if (!this.encounterPattern().test(encounterNo)) {
      throw new BadRequestException(/^\d{6,7}$/.test(encounterNo)
        ? 'This is the patient file number (MRN), not the Transaction No. Use the Transaction No. on the visit ticket.'
        : 'Enter the Transaction No. from the visit ticket (9–10 digits).');
    }
    const other = await this.prisma.patientJourney.findUnique({ where: { encounterNo } });
    if (other && other.id !== journeyId) {
      throw new ConflictException(`Encounter ${encounterNo} is already linked to ticket T${String(other.ticketNo % 1000).padStart(3, '0')}.`);
    }
    return encounterNo;
  }

  /**
   * Links the HIS encounter number to a journey. Department-wide (any triage user: nurse or
   * clerk at the desk), audit-logged. The same number cannot sit on two patients.
   */
  async linkEncounter(id: string, raw: string, user: { id: string; role: string; full_name?: string; email?: string }) {
    const journey = await this.prisma.patientJourney.findUnique({ where: { id } });
    if (!journey) throw new NotFoundException('Journey not found');
    const encounterNo = await this.checkEncounter(raw, id);
    if (journey.encounterNo === encounterNo) return journey;
    const updated = await this.prisma.patientJourney.update({
      where: { id },
      data: { encounterNo, encounterLinkedAt: new Date(), encounterLinkedById: user.id },
    });
    await this.audit.log('PatientJourney', id, journey.encounterNo ? 'encounter_relinked' : 'encounter_linked', user, {
      ticketNo: journey.ticketNo,
      previous: journey.encounterNo || null,
    });
    return updated;
  }

  async findByEncounter(raw: string) {
    const encounterNo = String(raw || '').trim().replace(/\s+/g, '').toUpperCase();
    if (!this.encounterPattern().test(encounterNo)) {
      throw new BadRequestException('Enter the Transaction No. from the visit ticket (9–10 digits).');
    }
    const journey = await this.prisma.patientJourney.findUnique({ where: { encounterNo } });
    if (!journey) throw new NotFoundException('No patient has this Transaction No. yet');
    return journey;
  }

  /** Triaged patients of the last `hours` with no encounter number yet (reconciliation list). */
  async findUnlinked(hours = 24) {
    const cutoff = new Date(Date.now() - Math.min(Math.max(hours, 1), 72) * 3600 * 1000);
    return this.prisma.patientJourney.findMany({
      where: { encounterNo: null, ctasLevel: { not: null }, arrivalTime: { gte: cutoff } },
      orderBy: { arrivalTime: 'asc' },
      select: {
        id: true, patientId: true, ticketNo: true, age: true, gender: true,
        arrivalTime: true, ctasLevel: true, ctasCompletedAt: true, currentStatus: true,
      },
    });
  }

  // ── Physician check of the triage level (Stage A reference) ───────────
  /**
   * The physician agrees with the triage level or re-triages it, with a reason when it
   * differs. Optionally marks the patient seen in the same step. The journey keeps the
   * nurse's level in the record; the board shows the reviewed level from now on.
   */
  async reviewCtas(
    id: string,
    body: { level: number; reason?: string; markSeen?: boolean; conditionChanged?: boolean },
    user: { id: string; role: string; full_name?: string; email?: string },
  ) {
    const level = Number(body.level);
    if (!Number.isInteger(level) || level < 1 || level > 5) throw new BadRequestException('CTAS level must be 1–5');
    const journey = await this.prisma.patientJourney.findUnique({ where: { id } });
    if (!journey) throw new NotFoundException('Journey not found');
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
    const markingSeen = !!body.markSeen && !journey.seenAt;
    const updated = await this.prisma.patientJourney.update({
      where: { id },
      data: {
        clinicianFinalCtas: level,
        ctasReviewedAt: new Date(),
        ...(agreed ? {} : { ctasLevel: level }),
        ...(body.markSeen ? { currentStatus: JourneyStatus.seen } : {}),
        ...(markingSeen ? { seenAt: new Date() } : {}),
      },
    });
    if (record) {
      await this.prisma.triageRecord.update({
        where: { id: record.id },
        data: { clinicianFinalCtas: level, clinicianReviewedAt: new Date(), reviewedBy: user.role },
      });
    }
    await this.audit.log('PatientJourney', id, agreed ? 'ctas_review_agreed' : 'ctas_retriaged', user, {
      ticketNo: journey.ticketNo, from: nurseLevel, to: level, reviewId: review.id, markSeen: !!body.markSeen, conditionChanged: review.conditionChanged,
    });
    return { journey: updated, review };
  }
}
