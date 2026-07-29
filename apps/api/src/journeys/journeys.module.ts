import { Module } from '@nestjs/common';
import { JourneysController } from './journeys.controller';
import { JourneysService } from './journeys.service';
import { AuditService } from '../audit/audit.service';

@Module({
  controllers: [JourneysController],
  providers: [JourneysService, AuditService],
  exports: [JourneysService],
})
export class JourneysModule {}
