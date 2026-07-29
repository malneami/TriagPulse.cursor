import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma, JourneyStatus, Gender } from '@prisma/client';
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
      patientNameAr?: string;
      patientNameEn?: string;
      age?: number;
      gender?: Gender;
      phone?: string;
      modeOfArrival?: string;
    },
    user: { id: string; full_name?: string; email?: string },
  ) {
    const journey = await this.prisma.patientJourney.create({
      data: {
        patientId: randomUUID(),
        createdById: user.id,
        patientNameAr: data.patientNameAr,
        patientNameEn: data.patientNameEn,
        age: data.age,
        gender: data.gender,
        phone: data.phone,
        modeOfArrival: data.modeOfArrival,
        currentStatus: JourneyStatus.visual_triage,
        currentLocation: 'ARRIVAL',
      },
    });
    await this.audit.log('PatientJourney', journey.id, 'journey_created', user, { patientId: journey.patientId });
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
      currentStatus: { not: JourneyStatus.completed },
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
      patientNameAr?: string;
      patientNameEn?: string;
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
        patientNameAr: data.patientNameAr ?? journey.patientNameAr,
        patientNameEn: data.patientNameEn ?? journey.patientNameEn,
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

  async updateStatus(id: string, status: JourneyStatus, user: { id: string; role: string }) {
    await this.findOne(id, user);
    return this.prisma.patientJourney.update({
      where: { id },
      data: { currentStatus: status },
    });
  }
}
