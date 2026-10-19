import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.module';
import { jwtSecretFrom } from './jwt-config';
import { SessionsService } from './sessions.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    private sessions: SessionsService,
    config: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecretFrom(config),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: { sub: string; email: string; sid?: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    // Deactivation and role changes apply at once: every request reloads the account.
    if (!user || !user.active) throw new UnauthorizedException();
    // The token's sign-in session must still be open: sign-out, deactivation and password
    // changes end it, and a token without a session (older format) is refused (H3).
    if (!(await this.sessions.isActive(payload.sid, user.id))) throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      full_name: user.fullName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      sessionId: payload.sid,
    };
  }
}
