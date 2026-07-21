import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  applyDecorators,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';

const PERMISSION_KEY = 'required_permission';

/**
 * Guard that reads the @RequirePermission metadata and checks it against the
 * caller's permission set (loaded by AuthGuard). Runs before the handler, so a
 * caller without the permission is rejected early — the code-level half of
 * defense in depth. RLS still enforces independently at the database.
 */
@Injectable()
class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (!req.user) throw new ForbiddenException('Not authenticated');
    if (!req.user.permissions.has(required)) {
      throw new ForbiddenException(`Requires the "${required}" permission`);
    }
    return true;
  }
}

/** Require a permission for a route. Applies AuthGuard first, then the check. */
export function RequirePermission(permission: string) {
  return applyDecorators(
    SetMetadata(PERMISSION_KEY, permission),
    UseGuards(AuthGuard, PermissionGuard),
  );
}
