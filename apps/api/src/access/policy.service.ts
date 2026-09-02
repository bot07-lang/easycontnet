import { ForbiddenException, Injectable } from '@nestjs/common';
import type { UserContext } from '../auth/auth.guard.js';

/**
 * The single place for code-level permission decisions — the API half of
 * defense in depth. RLS enforces the same rules in the database (the wall this
 * cannot be bypassed around); this layer rejects early with a clear message and
 * catches mistakes before a query ever runs.
 *
 * Never scatter ad-hoc permission checks in controllers — route them here.
 */
@Injectable()
export class PolicyService {
  /** Does the caller have this permission? The account owner is a super-user —
   *  they always pass, so they can never be locked out. */
  can(user: UserContext, permission: string): boolean {
    return user.isOwner || user.permissions.has(permission);
  }

  /** Assert a permission, or throw 403 with a specific message. */
  require(user: UserContext, permission: string): void {
    if (!this.can(user, permission)) {
      throw new ForbiddenException(`Requires the "${permission}" permission`);
    }
  }
}
