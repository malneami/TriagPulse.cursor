import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard';
import { WsAuthService } from './ws-auth.service';
import { SessionsService } from './sessions.service';
import { jwtExpiresInFrom, jwtSecretFrom } from './jwt-config';

@Module({
  imports: [
    PassportModule,
    // registerAsync: read the secret after ConfigModule has loaded .env,
    // so signing and verification always use the same value.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: jwtSecretFrom(config),
        signOptions: { expiresIn: jwtExpiresInFrom(config) as any },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy, RolesGuard, WsAuthService, SessionsService],
  controllers: [AuthController],
  exports: [AuthService, JwtModule, RolesGuard, WsAuthService, SessionsService],
})
export class AuthModule {}
