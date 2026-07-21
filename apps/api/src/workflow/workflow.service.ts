import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../db/database.service.js';
import type { UserContext } from '../auth/auth.guard.js';

const RLS_VIOLATION = '42501';
const UNIQUE_VIOLATION = '23505';

/**
 * Workflow configuration reads and writes: the per-project status ladder, its
 * reviewing-roles matrix, auto-due / read-only settings, default assignees, and
 * the 5-star rating criteria. Everything runs through db.withUser so RLS is the
 * real wall — note the deliberate permission split it enforces:
 *   - statuses, reviewing roles, ratings → manage_workflow
 *   - default assignees                  → manage_people_and_deadlines
 * (configuring the ladder and staffing it are separate responsibilities.)
 */
@Injectable()
export class WorkflowService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** The whole Workflow settings page for one project, in a single read. */
  async getWorkflow(user: UserContext, projectId: string) {
    return this.db.withUser(user, async (c) => {
      const project = (
        await c.query(
          `select id, name, auto_complete_on_publish
             from public.projects where id = $1`,
          [projectId],
        )
      ).rows[0];
      if (!project) throw new NotFoundException('Project not found');

      // Matrix columns: every role in the org.
      const roles = (
        await c.query(
          `select id, name, is_active from public.roles
            where org_id = $1 order by is_system desc, name`,
          [user.orgId],
        )
      ).rows;

      // Default-assignee picker source: this project's members.
      const members = (
        await c.query(
          `select pr.id, pr.full_name as name
             from public.project_members pm
             join public.profiles pr on pr.id = pm.profile_id
            where pm.project_id = $1
            order by pr.full_name`,
          [projectId],
        )
      ).rows;

      const statuses = (
        await c.query(
          `select s.id, s.name, s.color, s.position, s.is_initial, s.is_terminal,
                  s.auto_due_days, s.read_only,
                  coalesce((
                    select jsonb_agg(rr.role_id)
                    from public.status_reviewing_roles rr
                    where rr.status_id = s.id), '[]'::jsonb) as reviewing_role_ids,
                  coalesce((
                    select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.full_name)
                                     order by pr.full_name)
                    from public.status_default_assignees da
                    join public.profiles pr on pr.id = da.profile_id
                    where da.status_id = s.id), '[]'::jsonb) as default_assignees
             from public.workflow_statuses s
            where s.project_id = $1
            order by s.position`,
          [projectId],
        )
      ).rows;

      const ratings = (
        await c.query(
          `select r.id, r.name, r.description, r.position,
                  r.status_id, s.name as status_name, s.color as status_color
             from public.workflow_ratings r
             join public.workflow_statuses s on s.id = r.status_id
            where r.project_id = $1
            order by r.position, r.created_at`,
          [projectId],
        )
      ).rows;

      return {
        project: { id: project.id, name: project.name },
        auto_complete_on_publish: project.auto_complete_on_publish as boolean,
        roles,
        members,
        statuses,
        ratings,
      };
    });
  }

  /**
   * Update a status's configuration (manage_workflow). Name, colour, auto-due,
   * read-only, and the reviewing-roles set. Reviewing roles are replaced
   * wholesale. Default assignees are handled separately — different permission.
   */
  async updateStatus(
    user: UserContext,
    statusId: string,
    patch: {
      name?: string;
      color?: string;
      autoDueDays?: number | null;
      readOnly?: boolean;
      reviewingRoleIds?: string[];
    },
  ) {
    try {
      return await this.db.withUser(user, async (c) => {
        const existing = (
          await c.query(
            `select id, is_terminal from public.workflow_statuses where id = $1`,
            [statusId],
          )
        ).rows[0];
        if (!existing) throw new NotFoundException('Status not found');

        const sets: string[] = [];
        const vals: unknown[] = [];
        const push = (frag: string, val: unknown) => {
          vals.push(val);
          sets.push(`${frag} = $${vals.length}`);
        };
        if (patch.name !== undefined) push('name', patch.name.trim());
        if (patch.color !== undefined) push('color', patch.color);
        if (patch.autoDueDays !== undefined) push('auto_due_days', patch.autoDueDays);
        if (patch.readOnly !== undefined) push('read_only', patch.readOnly);

        if (sets.length) {
          vals.push(statusId);
          const { rowCount } = await c.query(
            `update public.workflow_statuses set ${sets.join(', ')} where id = $${vals.length}`,
            vals,
          );
          if (!rowCount) throw new ForbiddenException('You cannot edit this workflow');
        }

        if (patch.reviewingRoleIds !== undefined) {
          // A terminal status has no reviewing roles (DB trigger enforces this
          // too); guard here for a clean message.
          if (existing.is_terminal && patch.reviewingRoleIds.length) {
            throw new ForbiddenException('The final status cannot have reviewing roles');
          }
          await c.query(`delete from public.status_reviewing_roles where status_id = $1`, [statusId]);
          for (const roleId of patch.reviewingRoleIds) {
            await c.query(
              `insert into public.status_reviewing_roles (status_id, role_id) values ($1, $2)`,
              [statusId, roleId],
            );
          }
        }

        return { ok: true as const };
      });
    } catch (err) {
      throw mapWriteError(err);
    }
  }

  /**
   * Create a new status (manage_workflow). It is always a middle status —
   * never initial or terminal — so it slots in just before the terminal one.
   * We free the terminal's position slot by pushing it up, then drop the new
   * status into the vacated slot, keeping the ladder ordered without a full
   * renumber.
   */
  async createStatus(
    user: UserContext,
    projectId: string,
    patch: {
      name: string;
      color: string;
      autoDueDays?: number | null;
      readOnly?: boolean;
      reviewingRoleIds?: string[];
    },
  ) {
    try {
      return await this.db.withUser(user, async (c) => {
        const terminal = (
          await c.query(
            `select id, position from public.workflow_statuses
              where project_id = $1 and is_terminal`,
            [projectId],
          )
        ).rows[0];

        let position: number;
        if (terminal) {
          await c.query(`update public.workflow_statuses set position = position + 2048 where id = $1`, [
            terminal.id,
          ]);
          position = terminal.position;
        } else {
          position = (
            await c.query(
              `select coalesce(max(position), 0) + 1024 as p from public.workflow_statuses where project_id = $1`,
              [projectId],
            )
          ).rows[0].p;
        }

        const { rows } = await c.query(
          `insert into public.workflow_statuses
             (org_id, project_id, name, color, position, auto_due_days, read_only)
           values ($1, $2, $3, $4, $5, $6, $7)
           returning id`,
          [
            user.orgId,
            projectId,
            patch.name.trim(),
            patch.color,
            position,
            patch.autoDueDays ?? null,
            patch.readOnly ?? false,
          ],
        );
        const statusId = rows[0].id as string;

        for (const roleId of patch.reviewingRoleIds ?? []) {
          await c.query(
            `insert into public.status_reviewing_roles (status_id, role_id) values ($1, $2)`,
            [statusId, roleId],
          );
        }
        return { id: statusId };
      });
    } catch (err) {
      throw mapWriteError(err);
    }
  }

  /**
   * Delete a status (manage_workflow). The initial and terminal statuses are
   * pinned and cannot be removed — an item must have somewhere to enter and to
   * rest. Content items in a deleted status would violate their FK, so the DB
   * rejects deletion while any item still sits there; we surface that clearly.
   */
  async deleteStatus(user: UserContext, statusId: string) {
    try {
      return await this.db.withUser(user, async (c) => {
        const s = (
          await c.query(
            `select is_initial, is_terminal from public.workflow_statuses where id = $1`,
            [statusId],
          )
        ).rows[0];
        if (!s) throw new NotFoundException('Status not found');
        if (s.is_initial || s.is_terminal) {
          throw new ForbiddenException('The first and last statuses cannot be deleted');
        }
        const { rowCount } = await c.query(`delete from public.workflow_statuses where id = $1`, [statusId]);
        if (!rowCount) throw new ForbiddenException('You cannot delete this status');
        return { ok: true as const };
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23503') {
        throw new ForbiddenException('This status still has content items in it — move them first');
      }
      throw mapWriteError(err);
    }
  }

  /** Create a rating criterion (manage_workflow). */
  async createRating(
    user: UserContext,
    projectId: string,
    patch: { name: string; description: string | null; statusId: string },
  ) {
    try {
      return await this.db.withUser(user, async (c) => {
        const { rows } = await c.query(
          `insert into public.workflow_ratings (org_id, project_id, status_id, name, description, position)
           values ($1, $2, $3, $4, $5,
                   (select coalesce(max(position), 0) + 1024 from public.workflow_ratings where project_id = $2))
           returning id`,
          [user.orgId, projectId, patch.statusId, patch.name.trim(), patch.description],
        );
        return { id: rows[0].id as string };
      });
    } catch (err) {
      throw mapWriteError(err, 'You cannot add ratings to this workflow');
    }
  }

  /** Update a rating criterion (manage_workflow). */
  async updateRating(
    user: UserContext,
    ratingId: string,
    patch: { name?: string; description?: string | null; statusId?: string },
  ) {
    try {
      return await this.db.withUser(user, async (c) => {
        const sets: string[] = [];
        const vals: unknown[] = [];
        const push = (frag: string, val: unknown) => { vals.push(val); sets.push(`${frag} = $${vals.length}`); };
        if (patch.name !== undefined) push('name', patch.name.trim());
        if (patch.description !== undefined) push('description', patch.description);
        if (patch.statusId !== undefined) push('status_id', patch.statusId);
        if (!sets.length) return { ok: true as const };
        vals.push(ratingId);
        const { rowCount } = await c.query(
          `update public.workflow_ratings set ${sets.join(', ')} where id = $${vals.length}`,
          vals,
        );
        if (!rowCount) throw new NotFoundException('Rating not found');
        return { ok: true as const };
      });
    } catch (err) {
      throw mapWriteError(err, 'You cannot edit this rating');
    }
  }

  /** Delete a rating criterion (manage_workflow). */
  async deleteRating(user: UserContext, ratingId: string) {
    try {
      return await this.db.withUser(user, async (c) => {
        const { rowCount } = await c.query(`delete from public.workflow_ratings where id = $1`, [ratingId]);
        if (!rowCount) throw new NotFoundException('Rating not found');
        return { ok: true as const };
      });
    } catch (err) {
      throw mapWriteError(err, 'You cannot delete this rating');
    }
  }

  /**
   * Replace a status's default assignees (manage_people_and_deadlines). Kept
   * separate from updateStatus because it is a different responsibility and a
   * different permission — a user may configure the ladder without being able
   * to staff it, or vice versa.
   */
  async setDefaultAssignees(user: UserContext, statusId: string, profileIds: string[]) {
    try {
      return await this.db.withUser(user, async (c) => {
        const status = (
          await c.query(`select id from public.workflow_statuses where id = $1`, [statusId])
        ).rows[0];
        if (!status) throw new NotFoundException('Status not found');

        await c.query(`delete from public.status_default_assignees where status_id = $1`, [statusId]);
        for (const profileId of profileIds) {
          await c.query(
            `insert into public.status_default_assignees (status_id, profile_id) values ($1, $2)`,
            [statusId, profileId],
          );
        }
        return { ok: true as const };
      });
    } catch (err) {
      throw mapWriteError(err, 'You cannot set default assignees for this status');
    }
  }
}

function mapWriteError(err: unknown, forbiddenMsg = 'You cannot edit this workflow'): unknown {
  const code = (err as { code?: string }).code;
  if (code === RLS_VIOLATION) return new ForbiddenException(forbiddenMsg);
  if (code === UNIQUE_VIOLATION) return new ForbiddenException('A status with that name already exists');
  return err;
}
