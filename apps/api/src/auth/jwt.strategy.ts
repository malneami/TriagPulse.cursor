import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.module';
import { jwtSecretFrom } from './jwt-config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    config: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecretFrom(config),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: { sub: string; email: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    // Deactivation and role changes apply at once: every request reloads the account.
    if (!user || !user.active) throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      full_name: user.fullName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
