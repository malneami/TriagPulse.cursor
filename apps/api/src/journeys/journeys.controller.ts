import {
  Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Gender, JourneyStatus } from '@prisma/client';
import { JourneysService } from './journeys.service';
import { RolesGuard, RequirePermission } from '../auth/roles.guard';

class CreateJourneyDto {
  @IsOptional() @IsString() patientNameAr?: string;
  @IsOptional() @IsString() patientNameEn?: string;
  @IsOptional() @IsInt() @Min(0) age?: number;
  @IsOptional() @IsEnum(Gender) gender?: Gender;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() modeOfArrival?: string;
}

class VisualTriageDto {
  @IsObject() sectionA: { breathing: string; consciousness: string; bleeding: string; skin: string; mobility: string };
  @IsObject() respiratorySymptoms: Record<string, boolean>;
  @IsString() monkeypoxRisk: string;
  @IsOptional() maskGiven?: boolean;
  @IsOptional() handHygieneDone?: boolean;
  @IsOptional() alertTeamNotified?: boolean;
  @IsOptional() @IsString() patientNameAr?: string;
  @IsOptional() @IsString() patientNameEn?: string;
  @IsOptional() @IsInt() age?: number;
  @IsOptional() @IsEnum(Gender) gender?: Gender;
  @IsOptional() @IsInt() vtDurationSec?: number;
}

class LinkEncounterDto {
  @IsString() @MaxLength(40) encounterNo: string;
}

class ReviewCtasDto {
  @IsInt() @Min(1) @Max(5) level: number;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
  @IsOptional() @IsBoolean() markSeen?: boolean;
  /** The patient changed after triage: recorded, but not counted against the nurse. */
  @IsOptional() @IsBoolean() conditionChanged?: boolean;
}

class UpdateStatusDto {
  @IsEnum(JourneyStatus) status: JourneyStatus;
}

@Controller('journeys')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class JourneysController {
  constructor(private journeysService: JourneysService) {}

  @Post()
  @RequirePermission('perform_triage')
  create(@Body() dto: CreateJourneyDto, @Request() req: { user: { id: string; full_name?: string; email?: string } }) {
    return this.journeysService.create(dto, req.user);
  }

  @Get()
  @RequirePermission('perform_triage')
  list(@Query('status') status: string | undefined, @Request() req: { user: { id: string; role: string } }) {
    if (status === 'active') return this.journeysService.findActive(req.user);
    return this.journeysService.findActive(req.user);
  }

  /** Triaged patients with no HIS encounter number yet (reconciliation list). */
  @Get('unlinked')
  @RequirePermission('perform_triage')
  unlinked(@Query('hours') hours?: string) {
    return this.journeysService.findUnlinked(Number(hours) || 24);
  }

  @Get(':id')
  @RequirePermission('perform_triage')
  findOne(@Param('id') id: string, @Request() req: { user: { id: string; role: string } }) {
    return this.journeysService.findOne(id, req.user);
  }

  @Post(':id/visual-triage')
  @RequirePermission('perform_triage')
  visualTriage(
    @Param('id') id: string,
    @Body() dto: VisualTriageDto,
    @Request() req: { user: { id: string; full_name?: string; email?: string; role: string } },
  ) {
    return this.journeysService.submitVisualTriage(id, dto, req.user);
  }

  @Patch(':id/status')
  @RequirePermission('perform_triage')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @Request() req: { user: { id: string; role: string } },
  ) {
    return this.journeysService.updateStatus(id, dto.status, req.user);
  }

  /** Scan or type the HIS encounter number (department-wide, audit-logged). */
  @Patch(':id/encounter')
  @RequirePermission('perform_triage')
  linkEncounter(
    @Param('id') id: string,
    @Body() dto: LinkEncounterDto,
    @Request() req: { user: { id: string; role: string; full_name?: string; email?: string } },
  ) {
    return this.journeysService.linkEncounter(id, dto.encounterNo, req.user);
  }

  /** Physician agrees with the triage level or re-triages it (reason required if different). */
  @Post(':id/ctas-review')
  @RequirePermission('review_ctas')
  reviewCtas(
    @Param('id') id: string,
    @Body() dto: ReviewCtasDto,
    @Request() req: { user: { id: string; role: string; full_name?: string; email?: string } },
  ) {
    return this.journeysService.reviewCtas(id, dto, req.user);
  }
}
