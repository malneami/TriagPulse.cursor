import {
  Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsEnum, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';
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
    @Body('status') status: JourneyStatus,
    @Request() req: { user: { id: string; role: string } },
  ) {
    return this.journeysService.updateStatus(id, status, req.user);
  }
}
