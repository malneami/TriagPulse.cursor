import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuditService } from '../audit/audit.service';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [UsersController], providers: [UsersService, AuditService] })
export class UsersModule {}
