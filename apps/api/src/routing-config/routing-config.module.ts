import { Module } from '@nestjs/common';
import { RoutingConfigController } from './routing-config.controller';
import { RoutingConfigService } from './routing-config.service';
import { AuthModule } from '../auth/auth.module';
import { AuditService } from '../audit/audit.service';

@Module({
  imports: [AuthModule],
  controllers: [RoutingConfigController],
  providers: [RoutingConfigService, AuditService],
  exports: [RoutingConfigService],
})
export class RoutingConfigModule {}
