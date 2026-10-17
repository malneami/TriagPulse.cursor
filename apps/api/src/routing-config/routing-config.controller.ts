import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';
import { RoutingConfigService } from './routing-config.service';
import { RolesGuard, RequirePermission } from '../auth/roles.guard';

class PublishRoutingDto {
  @IsObject() config: Record<string, unknown>;
  @IsOptional() @IsString() changelog?: string;
}

class ZoneStatusDto {
  @IsString() department: string;
  @IsString() zone: string;
  @IsBoolean() busy: boolean;
}

type Req = { user: { id: string; full_name?: string; email?: string } };

@Controller('routing-config')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class RoutingConfigController {
  constructor(private service: RoutingConfigService) {}

  @Get('current')
  @RequirePermission('perform_triage')
  current() {
    return this.service.getCurrent();
  }

  @Get('history')
  @RequirePermission('manage_routing')
  history() {
    return this.service.listHistory();
  }

  @Post('publish')
  @RequirePermission('manage_routing')
  publish(@Body() dto: PublishRoutingDto, @Request() req: Req) {
    return this.service.publish(dto, req.user);
  }

  @Post('use-builtin')
  @RequirePermission('manage_routing')
  useBuiltin(@Request() req: Req) {
    return this.service.useBuiltin(req.user);
  }

  @Post('zone-status')
  @RequirePermission('set_zone_status')
  setBusy(@Body() dto: ZoneStatusDto, @Request() req: Req) {
    return this.service.setBusy(dto, req.user);
  }

  @Post(':id/activate')
  @RequirePermission('manage_routing')
  activate(@Param('id') id: string, @Request() req: Req) {
    return this.service.activate(id, req.user);
  }
}
