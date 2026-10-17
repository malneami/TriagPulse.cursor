import { Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { RolesGuard, RequirePermission } from '../auth/roles.guard';
import { UsersService } from './users.service';

class CreateUserDto {
  @IsEmail() @MaxLength(120) email: string;
  @IsString() @MaxLength(120) fullName: string;
  @IsEnum(UserRole) role: UserRole;
  @IsString() @MaxLength(128) password: string;
}
class UpdateUserDto {
  @IsOptional() @IsString() @MaxLength(120) fullName?: string;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @IsBoolean() active?: boolean;
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
  constructor(private users: UsersService) {}

  @Get()
  list() { return this.users.list(); }

  @Post()
  create(@Body() dto: CreateUserDto, @Request() req: Req) { return this.users.create(dto, req.user); }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Request() req: Req) { return this.users.update(id, dto, req.user); }

  @Post(':id/reset-password')
  reset(@Param('id') id: string, @Body() dto: ResetPasswordDto, @Request() req: Req) { return this.users.resetPassword(id, dto.password, req.user); }

  @Post(':id/unlock')
  unlock(@Param('id') id: string, @Request() req: Req) { return this.users.unlock(id, req.user); }
}
