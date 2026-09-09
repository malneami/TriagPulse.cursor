import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';
import { ClinicalLibrariesService } from './clinical-libraries.service';
import { RolesGuard, RequirePermission } from '../auth/roles.guard';

class PublishLibraryDto {
  @IsOptional() @IsString() version?: string;
  @IsArray() modifiers: unknown[];
  @IsOptional() @IsString() modifiers_version?: string;
  @IsObject() red_flags: Record<string, unknown>;
  @IsOptional() @IsString() changelog?: string;
}

@Controller('clinical-libraries')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ClinicalLibrariesController {
  constructor(private service: ClinicalLibrariesService) {}

  @Get('current')
  @RequirePermission('perform_triage')
  current() {
    return this.service.getCurrent();
  }

  @Get('history')
  @RequirePermission('manage_clinical_libraries')
  history() {
    return this.service.listHistory();
  }

  @Get(':id')
  @RequirePermission('manage_clinical_libraries')
  getOne(@Param('id') id: string) {
    return this.service.getPublish(id);
  }

  @Post('publish')
  @RequirePermission('manage_clinical_libraries')
  publish(
    @Body() dto: PublishLibraryDto,
    @Request() req: { user: { id: string; full_name?: string; email?: string } },
  ) {
    return this.service.publish(dto as unknown as Parameters<ClinicalLibrariesService['publish']>[0], req.user);
  }

  @Post(':id/activate')
  @RequirePermission('manage_clinical_libraries')
  activate(
    @Param('id') id: string,
    @Request() req: { user: { id: string; full_name?: string; email?: string } },
  ) {
    return this.service.activate(id, req.user);
  }
}
