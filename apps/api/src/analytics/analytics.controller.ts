import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AnalyticsService } from './analytics.service';
import { RolesGuard, RequirePermission } from '../auth/roles.guard';

@Controller('analytics')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class AnalyticsController {
  constructor(private service: AnalyticsService) {}

  @Get('agreement')
  @RequirePermission('view_clinical_analytics')
  agreement(@Query('days') days?: string) {
    return this.service.agreementSummary(days ? Number(days) : 30);
  }

  @Get('export/validated')
  @RequirePermission('view_clinical_analytics')
  exportValidated(
    @Query('limit') limit?: string,
    @Query('flaggedOnly') flaggedOnly?: string,
  ) {
    return this.service.exportValidated(
      limit ? Number(limit) : 200,
      flaggedOnly === 'true' || flaggedOnly === '1',
    );
  }

  @Get('evaluation')
  @RequirePermission('view_clinical_analytics')
  evaluation(@Query('days') days?: string) {
    return this.service.evaluationReport(days ? Number(days) : 30);
  }
}
