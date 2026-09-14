import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../access/require-permission.decorator.js';
import { AuthGuard, type UserContext } from '../auth/auth.guard.js';
import { RolesService } from './roles.service.js';

/**
 * Roles & Permissions management. Every route requires the `manage_roles`
 * permission (checked by the guard here AND enforced independently by RLS).
 *
 * AuthGuard applied here at the class level (RequirePermission no longer
 * bundles it) — every route below also carries @RequirePermission, so this is
 * the only guard that populates `req.user` for them.
 */
@Controller()
@UseGuards(AuthGuard)
export class RolesController {
  constructor(@Inject(RolesService) private readonly roles: RolesService) {}

  /** The universal permission catalogue (grouped + ordered). */
  @Get('permissions')
  @RequirePermission('manage_roles')
  permissions(@CurrentUser() user: UserContext) {
    return this.roles.listPermissions(user);
  }

  /** Every role in the org, with the permission keys each holds. */
  @Get('roles')
  @RequirePermission('manage_roles')
  list(@CurrentUser() user: UserContext) {
    return this.roles.listRoles(user);
  }

  @Post('roles')
  @RequirePermission('manage_roles')
  create(@CurrentUser() user: UserContext, @Body() body: { name?: string; description?: string }) {
    const name = body?.name?.trim();
    if (!name) throw new BadRequestException('name is required');
    return this.roles.createRole(user, name, body?.description?.trim() ?? '');
  }

  /** Persist a drag-and-drop reorder. Declared before :id so it isn't shadowed. */
  @Put('roles/reorder')
  @RequirePermission('manage_roles')
  reorder(@CurrentUser() user: UserContext, @Body() body: { order?: { id: string; position: number }[] }) {
    return this.roles.reorder(user, body?.order ?? []);
  }

  @Patch('roles/:id')
  @RequirePermission('manage_roles')
  update(
    @CurrentUser() user: UserContext,
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string | null; isActive?: boolean },
  ) {
    return this.roles.updateRole(user, id, body ?? {});
  }

  /** Toggle one permission for one role (a single matrix cell). */
  @Put('roles/:id/permissions')
  @RequirePermission('manage_roles')
  setPermission(
    @CurrentUser() user: UserContext,
    @Param('id') id: string,
    @Body() body: { key?: string; on?: boolean },
  ) {
    if (!body?.key) throw new BadRequestException('key is required');
    return this.roles.setPermission(user, id, body.key, !!body.on);
  }

  @Post('roles/:id/duplicate')
  @RequirePermission('manage_roles')
  duplicate(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.roles.duplicate(user, id);
  }

  @Delete('roles/:id')
  @RequirePermission('manage_roles')
  remove(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.roles.deleteRole(user, id);
  }
}
