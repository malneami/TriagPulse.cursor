import { Body, Controller, Get, Param, Patch, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { RolesGuard, RequirePermission } from '../auth/roles.guard';
import { UsersService } from './users.service';
import { JoinService } from './join.service';

class CreateUserDto {
  @IsEmail() @MaxLength(120) email: string;
  @IsString() @MaxLength(120) fullName: string;
  @IsEnum(UserRole) role: UserRole;
  @IsString() @MaxLength(128) password: string;
  /** Physicians only: may be assigned outcome reviews. */
  @IsOptional() @IsBoolean() outcomeReviewer?: boolean;
}
class UpdateUserDto {
  @IsOptional() @IsString() @MaxLength(120) fullName?: string;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @IsBoolean() active?: boolean;
  /** Physicians only: may be assigned outcome reviews. */
  @IsOptional() @IsBoolean() outcomeReviewer?: boolean;
}
class ApproveRequestDto {
  @IsEnum(UserRole) role: UserRole;
  @IsOptional() @IsBoolean() outcomeReviewer?: boolean;
}
class JoinSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(20) code?: string;
}
class ResetPasswordDto {
  @IsString() @MaxLength(128) password: string;
}

type Req = { user: { id: string; role: string; full_name?: string; email?: string } };

/** Staff accounts (admin only). */
@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@RequirePermission('manage_security')
export class UsersController {
  constructor(private users: UsersService, private join: JoinService) {}

  @Get()
  list() { return this.users.list(); }

  // ── Join link: sign-up requests and the pilot code ─────────────────────
  @Get('requests')
  requests(@Query('status') status?: string) { return this.join.listRequests(status); }

  @Post('requests/:id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveRequestDto, @Request() req: Req) { return this.join.approve(id, dto, req.user); }

  @Post('requests/:id/reject')
  reject(@Param('id') id: string, @Request() req: Req) { return this.join.reject(id, req.user); }

  @Get('join-settings')
  joinSettings() { return this.join.adminSettings(); }

  @Put('join-settings')
  updateJoinSettings(@Body() dto: JoinSettingsDto, @Request() req: Req) { return this.join.updateSettings(dto, req.user); }

  @Post()
  create(@Body() dto: CreateUserDto, @Request() req: Req) { return this.users.create(dto, req.user); }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Request() req: Req) { return this.users.update(id, dto, req.user); }

  @Post(':id/reset-password')
  reset(@Param('id') id: string, @Body() dto: ResetPasswordDto, @Request() req: Req) { return this.users.resetPassword(id, dto.password, req.user); }

  @Post(':id/unlock')
  unlock(@Param('id') id: string, @Request() req: Req) { return this.users.unlock(id, req.user); }
}
