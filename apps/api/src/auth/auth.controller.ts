import { Body, Controller, Get, Headers, HttpCode, HttpException, HttpStatus, Ip, Post, Request, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request as ExpressRequest, Response } from 'express';
import { allowLoginAttempt } from './login-limit';
import { AuthGuard } from '@nestjs/passport';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './session-config';

class ChangePasswordDto {
  @IsString() @MaxLength(128) currentPassword: string;
  @IsString() @MaxLength(128) newPassword: string;
}

class LoginDto {
  @IsString()
  email: string;

  @IsString()
  @MinLength(4)
  password: string;
}

/** Reads one cookie without a cookie library (only the auth routes need it). */
function readCookie(req: ExpressRequest, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()) || undefined; } catch { return undefined; }
    }
  }
  return undefined;
}

/**
 * Sign-in sessions (review H3):
 * - login: short access token in the body (kept in page memory only) + renewal token in an
 *   HttpOnly, SameSite=Strict cookie limited to /api/auth, so page scripts cannot read it;
 * - refresh: new access token, rotated cookie (needs the X-TriagePulse-Refresh header, which
 *   a cross-site form or link cannot send);
 * - logout: ends this device's session on the server; logout-all: every device.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private sessions: SessionsService,
    private jwt: JwtService,
  ) {}

  private setRefreshCookie(res: Response, token: string) {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.sessions.cookieSecure,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: this.sessions.maxAgeMs,
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: this.sessions.cookieSecure, sameSite: 'strict', path: REFRESH_COOKIE_PATH });
  }

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!allowLoginAttempt(ip || 'unknown', dto.email)) {
      throw new HttpException('Too many sign-in attempts. Wait a minute and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const { refreshToken, ...body } = await this.authService.login(dto.email, dto.password, userAgent);
    this.setRefreshCookie(res, refreshToken);
    return body;
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Request() req: ExpressRequest,
    @Headers('x-triagepulse-refresh') marker: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (marker !== '1') throw new UnauthorizedException();
    try {
      const { refreshToken, ...body } = await this.authService.refresh(readCookie(req, REFRESH_COOKIE));
      // null = another tab renewed a moment ago and the browser already has the new cookie.
      if (refreshToken) this.setRefreshCookie(res, refreshToken);
      return body;
    } catch (err) {
      this.clearRefreshCookie(res);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Request() req: ExpressRequest,
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    // The access token may already have expired; its session id is still enough to end it.
    let sessionId: string | undefined;
    if (authorization?.startsWith('Bearer ')) {
      try {
        const payload = await this.jwt.verifyAsync(authorization.slice(7), { algorithms: ['HS256'], ignoreExpiration: true });
        sessionId = typeof payload?.sid === 'string' ? payload.sid : undefined;
      } catch { /* bad token: the cookie alone is used */ }
    }
    await this.authService.logout(readCookie(req, REFRESH_COOKIE), sessionId);
    this.clearRefreshCookie(res);
    return { ok: true };
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(@Request() req: { user: { id: string } }, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.logoutEverywhere(req.user.id);
    this.clearRefreshCookie(res);
    return result;
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('change-password')
  changePassword(@Body() dto: ChangePasswordDto, @Request() req: { user: { id: string; sessionId?: string } }) {
    return this.authService.changePassword(req.user.id, dto.currentPassword, dto.newPassword, req.user.sessionId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  me(@Request() req: { user: { id: string } }) {
    return this.authService.me(req.user.id);
  }
}
