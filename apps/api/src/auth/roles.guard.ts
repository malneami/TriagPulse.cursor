import { Injectable, CanActivate, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, canAccess } from '@triagepulse/clinical';

export const PERMISSION_KEY = 'permission';
export const RequirePermission = (permission: string) => SetMetadata(PERMISSION_KEY, permission);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission) return true;
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user?.role) return false;
    return canAccess(user.role as Role, permission);
  }
}
