import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { JoinController } from './join.controller';
import { JoinService } from './join.service';
import { AuditService } from '../audit/audit.service';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [UsersController, JoinController], providers: [UsersService, JoinService, AuditService] })
export class UsersModule {}
