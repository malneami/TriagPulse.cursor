import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { TriageService } from './triage.service';
import { RolesGuard, RequirePermission } from '../auth/roles.guard';

class EvaluateDto {
  @IsObject() patient: Record<string, unknown>;
  @IsOptional() @IsObject() answers?: Record<string, unknown>;
}

class SaveTriageDto {
  @IsUUID() journeyId: string;
  @IsObject() triageRecord: Record<string, unknown>;
  @IsOptional() @IsObject() journeyUpdate?: Record<string, unknown>;
}

@Controller('triage')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class TriageController {
  constructor(private triageService: TriageService) {}

  @Post('evaluate')
  @RequirePermission('perform_triage')
  evaluate(@Body() dto: EvaluateDto) {
    return this.triageService.evaluate(dto.patient, dto.answers || {});
  }

  @Post('save')
  @RequirePermission('perform_triage')
  save(
    @Body() dto: SaveTriageDto,
    @Request() req: { user: { id: string; full_name?: string; email?: string } },
  ) {
    return this.triageService.save(dto, req.user);
  }
}
