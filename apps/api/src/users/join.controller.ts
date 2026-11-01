import { Body, Controller, Get, Post, Request } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { JoinService } from './join.service';

class JoinDto {
  @IsString() @MaxLength(20) code: string;
  @IsString() @MaxLength(120) fullName: string;
  @IsEmail() @MaxLength(120) email: string;
  @IsString() @MaxLength(20) jobTitle: string;
  @IsOptional() @IsString() @MaxLength(60) jobTitleOther?: string;
  @IsString() @MaxLength(30) branch: string;
  @IsOptional() @IsString() @MaxLength(60) branchOther?: string;
}

/** Client address as Caddy appended it (the last X-Forwarded-For entry), else the socket. */
function clientIp(req: { headers: Record<string, string | string[] | undefined>; ip?: string }) {
  const xff = req.headers['x-forwarded-for'];
  const list = (Array.isArray(xff) ? xff.join(',') : xff || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.at(-1) || req.ip || 'unknown';
}

/** Public staff sign-up (join link). No sign-in; closed unless an admin opened it with a pilot code. */
@Controller('join')
export class JoinController {
  constructor(private join: JoinService) {}

  @Get()
  status() { return this.join.publicStatus(); }

  @Post()
  submit(@Body() dto: JoinDto, @Request() req: { headers: Record<string, string | string[] | undefined>; ip?: string }) {
    return this.join.submit(dto, clientIp(req));
  }
}
