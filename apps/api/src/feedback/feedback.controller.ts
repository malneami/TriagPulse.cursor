import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { RolesGuard, RequirePermission } from '../auth/roles.guard';
import { FeedbackService } from './feedback.service';

class RespondDto {
  @IsIn(['understood', 'disputed']) action: 'understood' | 'disputed';
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

type Req = { user: { id: string; role: string; full_name?: string; email?: string } };

@Controller('feedback')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class FeedbackController {
  constructor(private feedback: FeedbackService) {}

  /** "My triage": the signed-in nurse's own month, never anyone else's. */
  @Get('me')
  @RequirePermission('view_own_feedback')
  mine(@Request() req: Req, @Query('month') month?: string) {
    return this.feedback.mine(req.user, month);
  }

  @Post(':reviewId/respond')
  @RequirePermission('view_own_feedback')
  respond(@Param('reviewId') reviewId: string, @Body() dto: RespondDto, @Request() req: Req) {
    return this.feedback.respond(req.user, reviewId, dto.action, dto.comment);
  }

  /** Department totals and disputed cases, without names. */
  @Get('department')
  @RequirePermission('view_clinical_analytics')
  department(@Query('month') month?: string) {
    return this.feedback.department(month);
  }
}
