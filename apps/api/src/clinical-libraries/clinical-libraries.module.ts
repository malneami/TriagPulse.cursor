import { Module } from '@nestjs/common';
import { ClinicalLibrariesController } from './clinical-libraries.controller';
import { ClinicalLibrariesService } from './clinical-libraries.service';
import { AuthModule } from '../auth/auth.module';
import { AuditService } from '../audit/audit.service';

@Module({
  imports: [AuthModule],
  controllers: [ClinicalLibrariesController],
  providers: [ClinicalLibrariesService, AuditService],
  exports: [ClinicalLibrariesService],
})
export class ClinicalLibrariesModule {}
