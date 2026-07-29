import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TrackingService } from './tracking.service';
import { RolesGuard, RequirePermission } from '../auth/roles.guard';

@Controller('tracking')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class TrackingController {
  constructor(private trackingService: TrackingService) {}

  @Get('board')
  @RequirePermission('perform_triage')
  getBoard(@Request() req: { user: { id: string; role: string } }) {
    return this.trackingService.getBoard(req.user);
  }
}
