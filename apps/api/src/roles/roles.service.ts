import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../db/database.service.js';
import type { UserContext } from '../auth/auth.guard.js';

const RLS_VIOLATION = '42501';
const UNIQUE_VIOLATION = '23505';

interface RoleMeta {
  id: string;
  org_id: string;
  is_system: boolean;
  is_editable: boolean;
}

/**
 * Org-wide roles & permissions (the "Team → Roles" screen). Every read/write
 * rides RLS as the caller: reads are own-org; writes require the `manage_roles`
 * permission (enforced by the DB policy AND the @RequirePermission guard).
 *
 * Two system-role protections layer on top of the permission gate here:
 *   - Admin (`is_editable = false`) cannot be renamed, re-permissioned or toggled.
 *   - System roles (`is_system = true`, i.e. Admin + Writer) cannot be
 *     deactivated or deleted — an org must never lose its ability to administer
 *     itself. They can still be edited (Writer) and duplicated.
 */
@Injectable()
export class RolesService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** The universal permission catalogue (grouped + ordered for the matrix). */
  listPermissions(user: UserContext) {
    return this.db.withUser(user, async (c) =>
      (
        await c.query(
          `select key, group_name, label, description, position
             from public.permissions order by position, label`,
        )
      ).rows,
    );
  }

  /** Every role in the caller's org, with the permission keys each holds. */
  listRoles(user: UserContext) {
    return this.db.withUser(user, async (c) =>
      (
        await c.query(
          `select r.id, r.name, r.description, r.is_active, r.is_system, r.is_editable, r.position,
                  coalesce((select jsonb_agg(rp.permission_key)
                            from public.role_permissions rp where rp.role_id = r.id), '[]'::jsonb) as permissions
             from public.roles r
            where r.org_id = $1
            order by r.position nulls last, r.name`,
          [user.orgId],
        )
      ).rows,
    );
  }

  async createRole(user: UserContext, name: string, description: string) {
    try {
      return await this.db.withUser(user, async (c) => {
        const pos = (
          await c.query(`select coalesce(max(position), 0) + 1024 as pos from public.roles where org_id = $1`, [user.orgId])
        ).rows[0].pos as number;
        const row = (
          await c.query(
            `insert into public.roles (org_id, name, description, position)
             values ($1, $2, $3, $4) returning id`,
            [user.orgId, name, description || null, pos],
          )
        ).rows[0];
        return { id: row.id as string };
      });
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  /** Rename / re-describe / activate-deactivate a role. */
  async updateRole(user: UserContext, id: string, patch: { name?: string; description?: string | null; isActive?: boolean }) {
    const role = await this.getRole(user, id);
    // Name / description edits need an editable role. Admin is locked.
    if ((patch.name !== undefined || patch.description !== undefined) && !role.is_editable) {
      throw new ForbiddenException('This role cannot be edited');
    }
    // Activate / deactivate is blocked on system roles.
    if (patch.isActive !== undefined && role.is_system) {
      throw new ForbiddenException('System roles cannot be deactivated');
    }
    const sets: string[] = [];
    const vals: unknown[] = [];
    const push = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (patch.name !== undefined) push('name', patch.name.trim());
    if (patch.description !== undefined) push('description', patch.description || null);
    if (patch.isActive !== undefined) push('is_active', patch.isActive);
    if (!sets.length) return { ok: true as const };
    vals.push(id);
    try {
      await this.db.withUser(user, async (c) => c.query(`update public.roles set ${sets.join(', ')} where id = $${vals.length}`, vals));
      return { ok: true as const };
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  /** Grant (on) or revoke (off) a single permission for a role — one matrix cell. */
  async setPermission(user: UserContext, id: string, key: string, on: boolean) {
    const role = await this.getRole(user, id);
    if (!role.is_editable) throw new ForbiddenException('This role cannot be edited');
    try {
      await this.db.withUser(user, async (c) => {
        if (on) {
          await c.query(
            `insert into public.role_permissions (role_id, permission_key) values ($1, $2)
             on conflict do nothing`,
            [id, key],
          );
        } else {
          await c.query(`delete from public.role_permissions where role_id = $1 and permission_key = $2`, [id, key]);
        }
      });
      return { ok: true as const };
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  /** Persist a new drag-and-drop order. */
  async reorder(user: UserContext, order: { id: string; position: number }[]) {
    await this.db.withUser(user, async (c) => {
      for (const { id, position } of order) {
        await c.query(`update public.roles set position = $1 where id = $2 and org_id = $3`, [position, id, user.orgId]);
      }
    });
    return { ok: true as const };
  }

  /** Duplicate a role (name + description + its full permission set). */
  async duplicate(user: UserContext, id: string) {
    await this.getRole(user, id); // exists + belongs to caller's org
    try {
      return await this.db.withUser(user, async (c) => {
        const src = (
          await c.query(`select name, description from public.roles where id = $1`, [id])
        ).rows[0];
        // Unique-per-org name: append "(copy)", then "(copy 2)"… until free.
        let name = `${src.name} (copy)`;
        for (let n = 2; ; n++) {
          const taken = (await c.query(`select 1 from public.roles where org_id = $1 and name = $2`, [user.orgId, name])).rows.length;
          if (!taken) break;
          name = `${src.name} (copy ${n})`;
        }
        const pos = (await c.query(`select coalesce(max(position), 0) + 1024 as pos from public.roles where org_id = $1`, [user.orgId])).rows[0].pos as number;
        const newId = (
          await c.query(
            `insert into public.roles (org_id, name, description, position) values ($1, $2, $3, $4) returning id`,
            [user.orgId, name, src.description, pos],
          )
        ).rows[0].id as string;
        await c.query(
          `insert into public.role_permissions (role_id, permission_key)
             select $1, permission_key from public.role_permissions where role_id = $2`,
          [newId, id],
        );
        return { id: newId };
      });
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  async deleteRole(user: UserContext, id: string) {
    const role = await this.getRole(user, id);
    if (role.is_system) throw new ForbiddenException('System roles cannot be deleted');
    try {
      await this.db.withUser(user, async (c) => c.query(`delete from public.roles where id = $1`, [id]));
      return { ok: true as const };
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  private async getRole(user: UserContext, id: string): Promise<RoleMeta> {
    const row = await this.db.withUser(user, async (c) =>
      (await c.query(`select id, org_id, is_system, is_editable from public.roles where id = $1`, [id])).rows[0],
    );
    if (!row || row.org_id !== user.orgId) throw new NotFoundException('Role not found');
    return row as RoleMeta;
  }

  private mapWriteError(err: unknown): Error {
    const code = (err as { code?: string }).code;
    if (code === RLS_VIOLATION) return new ForbiddenException('You need the “manage roles” permission');
    if (code === UNIQUE_VIOLATION) return new BadRequestException('A role with this name already exists');
    return err as Error;
  }
}
