import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard, type UserContext } from './auth.guard.js';
import { CurrentUser } from './current-user.decorator.js';

/** Lets the frontend know who's signed in and what they're allowed to do, so
 *  it can hide UI the caller has no permission for — the API guards still
 *  enforce it either way, this just avoids showing dead ends. */
@Controller('auth')
@UseGuards(AuthGuard)
export class AuthController {
  @Get('me')
  me(@CurrentUser() user: UserContext) {
    return {
      userId: user.userId,
      orgId: user.orgId,
      isOwner: user.isOwner,
      roleId: user.roleId,
      permissions: [...user.permissions],
    };
  }
}
