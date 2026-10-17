import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuditService } from '../audit/audit.service';

@Module({ controllers: [UsersController], providers: [UsersService, AuditService] })
export class UsersModule {}
