import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { JourneysModule } from './journeys/journeys.module';
import { TriageModule } from './triage/triage.module';
import { TrackingModule } from './tracking/tracking.module';
import { SttModule } from './stt/stt.module';
import { ClinicalLibrariesModule } from './clinical-libraries/clinical-libraries.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { HealthController } from './health.controller';

/**
 * Resolved relative to process.cwd() (apps/api under `nest start`).
 * Order is precedence: for a key present in several files, the FIRST wins.
 */
export const ENV_FILE_PATHS = ['../../.env', '.env'];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ENV_FILE_PATHS,
    }),
    PrismaModule,
    AuthModule,
    JourneysModule,
    TriageModule,
    TrackingModule,
    SttModule,
    ClinicalLibrariesModule,
    AnalyticsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
