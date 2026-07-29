import { Module } from '@nestjs/common';
import { TriageController } from './triage.controller';
import { TriageService } from './triage.service';
import { AuditService } from '../audit/audit.service';

@Module({
  controllers: [TriageController],
  providers: [TriageService, AuditService],
})
export class TriageModule {}
