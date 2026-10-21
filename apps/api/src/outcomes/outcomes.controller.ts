import {
  Body, Controller, Get, Param, Post, Put, Query, Request, Res, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { RolesGuard, RequirePermission } from '../auth/roles.guard';
import { OutcomesService } from './outcomes.service';

class OutcomeReviewDto {
  @IsString() disposition: string;
  @IsOptional() @IsString() @MaxLength(120) admissionSpecialty?: string;
  @IsOptional() @IsString() admissionLocation?: string;
  @IsOptional() @IsString() @MaxLength(120) hospitalUnitName?: string;
  @IsOptional() @IsString() dischargeDestination?: string;
  @IsOptional() @IsString() @MaxLength(500) finalDiagnosis?: string;
  @IsOptional() @IsString() @MaxLength(500) reviewerComment?: string;
  @IsOptional() @IsString() directionAppropriate?: string;
  @IsOptional() @IsString() @MaxLength(500) directionComment?: string;
  @IsOptional() @IsBoolean() close?: boolean;
}

class AssignPhysicianDto {
  @IsString() physicianId: string;
}

type ReqUser = { user: { id: string; role: string; full_name?: string; email?: string } };

@Controller('outcomes')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class OutcomesController {
  constructor(private outcomes: OutcomesService) {}

  @Get('export.csv')
  @RequirePermission('review_outcome')
  async exportCsv(
    @Res() res: Response,
    @Request() req: ReqUser,
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    const csv = await this.outcomes.exportCsv({ status, q }, req.user);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="triagepulse-outcomes.csv"');
    res.send(csv);
  }

  @Get('awaiting-count')
  @RequirePermission('review_outcome')
  awaitingCount(@Request() req: ReqUser) {
    return this.outcomes.awaitingCount(req.user).then((count) => ({ count }));
  }

  @Get('physicians')
  @RequirePermission('assign_outcome_physician')
  listPhysicians() {
    return this.outcomes.listPhysicians();
  }

  @Get()
  @RequirePermission('review_outcome')
  list(
    @Request() req: ReqUser,
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    return this.outcomes.list({ status, q }, req.user);
  }

  @Put(':journeyId')
  @RequirePermission('review_outcome')
  upsert(
    @Param('journeyId') journeyId: string,
    @Body() dto: OutcomeReviewDto,
    @Request() req: ReqUser,
  ) {
    return this.outcomes.upsert(journeyId, { ...dto }, req.user, !!dto.close);
  }

  @Post(':journeyId/close')
  @RequirePermission('review_outcome')
  close(
    @Param('journeyId') journeyId: string,
    @Request() req: ReqUser,
  ) {
    return this.outcomes.close(journeyId, req.user);
  }

  @Post(':journeyId/assign')
  @RequirePermission('assign_outcome_physician')
  assign(
    @Param('journeyId') journeyId: string,
    @Body() dto: AssignPhysicianDto,
    @Request() req: ReqUser,
  ) {
    return this.outcomes.assignPhysician(journeyId, dto.physicianId, req.user);
  }
}
