import { Injectable } from '@nestjs/common';
import { JourneyStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import { waitMins, waitTimeColor, isActiveJourney } from '@triagepulse/clinical';

@Injectable()
export class TrackingService {
  constructor(private prisma: PrismaService) {}

  async getBoard(user: { id: string; role: string }) {
    const journeys = await this.prisma.patientJourney.findMany({
      where: {
        currentStatus: { not: JourneyStatus.completed },
      },
      orderBy: [{ ctasLevel: 'asc' }, { arrivalTime: 'asc' }],
    });

    const active = journeys.filter((j) => isActiveJourney(j.arrivalTime));

    return active.map((j) => ({
      ...j,
      wait_mins: waitMins(j.arrivalTime, j.ctasLevel ?? j.clinicianFinalCtas),
      wait_color: waitTimeColor(waitMins(j.arrivalTime, j.ctasLevel ?? j.clinicianFinalCtas), j.ctasLevel),
    }));
  }
}
