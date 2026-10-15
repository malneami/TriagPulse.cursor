import { Injectable } from '@nestjs/common';
import { JourneyStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import { waitMins, waitTimeColor, isActiveJourney } from '@triagepulse/clinical';

@Injectable()
export class TrackingService {
  constructor(private prisma: PrismaService) {}

  /**
   * Everyone in the department from the last 12 hours who has not yet been
   * seen by a physician: waiting for triage, in triage, and triaged (completed)
   * patients waiting for a doctor. 'seen' patients leave the board.
   */
  async getBoard(user: { id: string; role: string }) {
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const journeys = await this.prisma.patientJourney.findMany({
      where: {
        currentStatus: { not: JourneyStatus.seen },
        arrivalTime: { gte: cutoff },
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
