import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { JourneysModule } from './journeys/journeys.module';
import { TriageModule } from './triage/triage.module';
import { TrackingModule } from './tracking/tracking.module';
import { SttModule } from './stt/stt.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    PrismaModule,
    AuthModule,
    JourneysModule,
    TriageModule,
    TrackingModule,
    SttModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
