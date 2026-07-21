import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { UserContext } from './auth.guard.js';

/** Injects the verified caller resolved by AuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserContext => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.user) throw new Error('CurrentUser used without AuthGuard');
    return req.user;
  },
);
