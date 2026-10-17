import { Injectable, CanActivate, ExecutionContext, ForbiddenException, SetMetadata } from '@nestjs/common';
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
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    // A temporary password (new account or admin reset) must be changed before any work.
    if (user?.mustChangePassword) throw new ForbiddenException('Change your temporary password first.');
    if (!permission) return true;
    if (!user?.role) return false;
    return canAccess(user.role as Role, permission);
  }
}
