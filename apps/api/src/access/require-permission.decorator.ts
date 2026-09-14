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
import { PolicyService } from './policy.service.js';

const PERMISSION_KEY = 'required_permission';

/**
 * Guard that reads the @RequirePermission metadata and checks it against the
 * caller's permission set (loaded by AuthGuard, which every controller using
 * this decorator applies at the class level — see the note on RequirePermission
 * below). Runs before the handler, so a caller without the permission is
 * rejected early — the code-level half of defense in depth. RLS still enforces
 * independently at the database.
 *
 * Delegates the actual yes/no to PolicyService rather than re-deriving it here,
 * so there is exactly one place that defines what "has this permission" means.
 */
@Injectable()
class PermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PolicyService) private readonly policy: PolicyService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (!req.user) throw new ForbiddenException('Not authenticated');
    this.policy.require(req.user, required);
    return true;
  }
}

/**
 * Require a permission for a route. Every controller that uses this decorator
 * on any route MUST apply `@UseGuards(AuthGuard)` at the class level (all of
 * them already do, except RolesController and ProjectsController, which apply
 * it explicitly since none of their routes need it un-gated) — this guard
 * only checks `req.user`, it does not populate it. Deliberately does NOT
 * bundle AuthGuard itself: controllers that already apply it at the class
 * level would otherwise run it a second time on every permission-gated route
 * (extra Supabase auth + DB round-trip per request, for no benefit).
 */
export function RequirePermission(permission: string) {
  return applyDecorators(
    SetMetadata(PERMISSION_KEY, permission),
    UseGuards(PermissionGuard),
  );
}
