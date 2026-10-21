import { Injectable } from '@nestjs/common';
import { JourneyStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import { isActiveJourney, triageDurationSec } from '@triagepulse/clinical';

@Injectable()
export class TrackingService {
  constructor(private prisma: PrismaService) {}

  /**
   * Last 24 hours: nurse CTAS work, completed CTAS awaiting a HIS visit number,
   * and HIS-linked cases awaiting physician validation. Validated cases leave.
   */
  async getBoard(_user: { id: string; role: string }) {
    const hours = 24;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const journeys = await this.prisma.patientJourney.findMany({
      where: {
        currentStatus: {
          in: [
            JourneyStatus.visual_triage,
            JourneyStatus.awaiting_ctas,
            JourneyStatus.ctas_in_progress,
            JourneyStatus.awaiting_his_link,
            JourneyStatus.pending_physician_validation,
          ],
        },
        arrivalTime: { gte: cutoff },
      },
      orderBy: [{ ctasLevel: 'asc' }, { arrivalTime: 'asc' }],
      include: {
        assignedPhysician: { select: { id: true, fullName: true, role: true } },
        triageRecords: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            nurseCtas: true,
            ctasLevel: true,
            chiefComplaint: true,
            hr: true,
            bpSystolic: true,
            spo2: true,
            rr: true,
            temperature: true,
            gcs: true,
            painScore: true,
            ctasStartedAt: true,
            ctasCompletedAt: true,
          },
        },
      },
    });

    const active = journeys.filter((j) => isActiveJourney(j.arrivalTime, hours));

    return active.map((j) => {
      const rec = j.triageRecords[0];
      const started = rec?.ctasStartedAt ?? j.ctasStartedAt;
      const completed = rec?.ctasCompletedAt ?? j.ctasCompletedAt;
      const { triageRecords, ...rest } = j;
      return {
        ...rest,
        nurseCtas: rec?.nurseCtas ?? rec?.ctasLevel ?? j.ctasLevel,
        chiefComplaint: rec?.chiefComplaint ?? j.chiefComplaint,
        hr: rec?.hr ?? null,
        bpSystolic: rec?.bpSystolic ?? null,
        spo2: rec?.spo2 ?? null,
        rr: rec?.rr ?? null,
        temperature: rec?.temperature ?? null,
        gcs: rec?.gcs ?? null,
        painScore: rec?.painScore ?? null,
        triage_duration_sec: triageDurationSec(started, completed),
      };
    });
  }
}
