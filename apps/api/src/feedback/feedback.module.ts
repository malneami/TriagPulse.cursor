import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { AuditService } from '../audit/audit.service';

@Module({
  controllers: [FeedbackController],
  providers: [FeedbackService, AuditService],
})
export class FeedbackModule {}
