import { Module } from '@nestjs/common';
import { SttController } from './stt.controller';
import { SttService } from './stt.service';
import { SttGateway } from './stt.gateway';
import { SttRealtimeService } from './stt-realtime.service';
import { AuditService } from '../audit/audit.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [SttController],
  providers: [SttService, SttRealtimeService, SttGateway, AuditService],
  exports: [SttService, SttRealtimeService],
})
export class SttModule {}
