import { Module } from '@nestjs/common';
import { OutcomesController } from './outcomes.controller';
import { OutcomesService } from './outcomes.service';
import { AuditService } from '../audit/audit.service';

@Module({
  controllers: [OutcomesController],
  providers: [OutcomesService, AuditService],
})
export class OutcomesModule {}
