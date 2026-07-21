import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../db/database.service.js';
import type { UserContext } from '../auth/auth.guard.js';

// Postgres error codes we translate into a clean 403 rather than a 500.
const RLS_VIOLATION = '42501'; // insufficient_privilege (RLS WITH CHECK failed)
const FK_VIOLATION = '23503'; // foreign_key_violation (item not in caller's org)

/**
 * Content reads and writes, every one through db.withUser so RLS enforces the
 * four gates as the caller. RLS is the real wall; the code-level PolicyService
 * checks (in the controller) reject obvious cases earlier with clearer errors.
 */
@Injectable()
export class ContentService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async listItems(user: UserContext, projectId: string) {
    return this.db.withUser(user, async (c) => {
      const { rows } = await c.query(
        `select ci.id, ci.item_number, ci.name, ci.updated_at,
                t.name as template_name,
                s.name as status_name, s.color as status_color, s.is_terminal,
                (ci.current_status_id is not null
                 and exists (select 1 from public.item_status_assignees a
                             where a.item_id = ci.id and a.status_id = ci.current_status_id
                               and a.profile_id = $2)) as mine,
                coalesce((
                  select jsonb_agg(jsonb_build_object('name', pr.full_name) order by pr.full_name)
                  from public.item_status_assignees a
                  join public.profiles pr on pr.id = a.profile_id
                  where a.item_id = ci.id and a.status_id = ci.current_status_id
                ), '[]'::jsonb) as people,
                (select min(a.due_at) from public.item_status_assignees a
                 where a.item_id = ci.id and a.status_id = ci.current_status_id) as next_due_date
           from public.content_items ci
           left join public.templates t on t.id = ci.template_id
           left join public.workflow_statuses s on s.id = ci.current_status_id
          where ci.project_id = $1
          order by ci.item_number desc`,
        [projectId, user.userId],
      );
      return rows;
    });
  }

  async getItem(user: UserContext, itemId: string) {
    return this.db.withUser(user, async (c) => {
      const item = await this.loadItem(c, itemId);
      if (!item) throw new NotFoundException('Item not found');

      const { rows: tabs } = await c.query(
        `select id, name, position from public.template_tabs
          where template_id = $1 and is_hidden = false
          order by position`,
        [item.template_id],
      );

      const { rows: fields } = await c.query(
        `select f.id, f.tab_id, f.field_type, f.label, f.position,
                f.is_system, f.is_required, f.guidelines, f.is_plain_text,
                f.recommended_length, f.recommended_length_units, f.choices,
                f.default_content, v.value
           from public.template_fields f
           join public.template_tabs tb on tb.id = f.tab_id
           left join public.content_field_values v
                  on v.field_id = f.id and v.item_id = $2
          where tb.template_id = $1 and f.is_visible = true
          order by f.position`,
        [item.template_id, itemId],
      );

      return {
        id: item.id,
        itemNumber: item.item_number,
        name: item.name,
        status: item.status_name
          ? { name: item.status_name, color: item.status_color }
          : null,
        tabs: tabs.map((tb) => ({
          id: tb.id,
          name: tb.name,
          fields: fields
            .filter((f) => f.tab_id === tb.id)
            .map((f) => ({
              id: f.id,
              type: f.field_type,
              label: f.label,
              isRequired: f.is_required,
              isSystem: f.is_system,
              guidelines: f.guidelines ?? undefined,
              isPlainText: f.is_plain_text,
              recommendedLength: f.recommended_length ?? undefined,
              recommendedLengthUnits: f.recommended_length_units ?? undefined,
              choices: Array.isArray(f.choices) ? f.choices : [],
              value: f.value ?? (f.default_content ?? null),
            })),
        })),
      };
    });
  }

  /**
   * Save one field value. RLS's write policy runs the four-gate edit rule, so
   * an insert the caller isn't allowed to make affects zero rows / is rejected;
   * we surface that as a 404 rather than trusting an app-side check alone.
   */
  async saveFieldValue(user: UserContext, itemId: string, fieldId: string, value: unknown) {
    try {
      return await this.db.withUser(user, async (c) => {
        const { rowCount } = await c.query(
          `insert into public.content_field_values (item_id, field_id, org_id, value)
           values ($1, $2, $3, $4::jsonb)
           on conflict (item_id, field_id)
           do update set value = excluded.value, updated_at = now()`,
          [itemId, fieldId, user.orgId, JSON.stringify(value ?? null)],
        );
        if (!rowCount) throw new NotFoundException('Cannot save this field');
        return { ok: true };
      });
    } catch (err) {
      // RLS refused the write, or the item is outside the caller's org.
      const code = (err as { code?: string }).code;
      if (code === RLS_VIOLATION || code === FK_VIOLATION) {
        throw new ForbiddenException('You cannot edit this item');
      }
      throw err;
    }
  }

  /** Templates in a project, for the create-item picker. */
  async listTemplates(user: UserContext, projectId: string) {
    return this.db.withUser(user, async (c) => {
      const { rows } = await c.query(
        `select id, name, is_default from public.templates
          where project_id = $1 order by is_default desc, name`,
        [projectId],
      );
      return rows;
    });
  }

  /** Create a content item with an optional template (null = Blank/minimal). */
  async createItem(
    user: UserContext,
    projectId: string,
    name: string,
    templateId: string | null,
    description: string | null,
    keywords: string[],
  ) {
    try {
      return await this.db.withUser(user, async (c) => {
        const { rows } = await c.query(
          `select public.api_create_content_item($1, $2, $3, $4, $5::text[]) as id`,
          [projectId, name, templateId, description, keywords],
        );
        return { id: rows[0]?.id as string };
      });
    } catch (err) {
      if ((err as { code?: string }).code === RLS_VIOLATION) {
        throw new ForbiddenException('You cannot create items in this project');
      }
      throw err;
    }
  }

  /**
   * Delete a content item. RLS's delete policy requires manage_content_items +
   * project membership; field values and assignees cascade away. Zero rows means
   * the caller couldn't see or delete it.
   */
  async deleteItem(user: UserContext, itemId: string) {
    try {
      return await this.db.withUser(user, async (c) => {
        const { rowCount } = await c.query(
          `delete from public.content_items where id = $1`,
          [itemId],
        );
        if (!rowCount) throw new NotFoundException('Item not found');
        return { ok: true as const };
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === RLS_VIOLATION || code === FK_VIOLATION) {
        throw new ForbiddenException('You cannot delete this item');
      }
      throw err;
    }
  }

  /** Rename a content item (manage_content_items). */
  async renameItem(user: UserContext, itemId: string, name: string) {
    try {
      return await this.db.withUser(user, async (c) => {
        const { rowCount } = await c.query(
          `update public.content_items set name = $2, updated_at = now() where id = $1`,
          [itemId, name.trim()],
        );
        if (!rowCount) throw new NotFoundException('Item not found');
        return { ok: true as const };
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === RLS_VIOLATION || code === FK_VIOLATION) throw new ForbiddenException('You cannot rename this item');
      throw err;
    }
  }

  /**
   * Manual status change (manage_content_items). Any status → any status in the
   * item's own project. Per the docs this "clears all reviews" — there is no
   * reviews feature yet, so that is a no-op today. Assignees are stored per
   * status, so moving current_status_id automatically makes the target status's
   * assignees the item's current people.
   */
  async changeStatus(user: UserContext, itemId: string, statusId: string) {
    try {
      return await this.db.withUser(user, async (c) => {
        const valid = await c.query(
          `select 1 from public.content_items ci
             join public.workflow_statuses s on s.id = $2 and s.project_id = ci.project_id
            where ci.id = $1`,
          [itemId, statusId],
        );
        if (!valid.rowCount) throw new NotFoundException('That status is not in this item’s project');
        const { rowCount } = await c.query(
          `update public.content_items set current_status_id = $2, updated_at = now() where id = $1`,
          [itemId, statusId],
        );
        if (!rowCount) throw new ForbiddenException('You cannot change this item');
        return { ok: true as const };
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === RLS_VIOLATION || code === FK_VIOLATION) throw new ForbiddenException('You cannot change this item');
      throw err;
    }
  }

  /**
   * Everything the assign-people panel needs: the item's project ladder with,
   * per status, its reviewing roles and the item's current assignees; plus the
   * project members (with role) so the UI can offer only those whose role is a
   * reviewing role for a given status (gate 3).
   */
  async getAssignmentInfo(user: UserContext, itemId: string) {
    return this.db.withUser(user, async (c) => {
      const item = (
        await c.query(`select project_id, current_status_id from public.content_items where id = $1`, [itemId])
      ).rows[0];
      if (!item) throw new NotFoundException('Item not found');

      const statuses = (
        await c.query(
          `select s.id, s.name, s.color, s.position, s.is_initial, s.is_terminal,
                  coalesce((select jsonb_agg(rr.role_id) from public.status_reviewing_roles rr where rr.status_id = s.id), '[]'::jsonb) as reviewing_role_ids,
                  coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.full_name) order by pr.full_name)
                            from public.item_status_assignees a join public.profiles pr on pr.id = a.profile_id
                            where a.item_id = $1 and a.status_id = s.id), '[]'::jsonb) as assignees
             from public.workflow_statuses s where s.project_id = $2 order by s.position`,
          [itemId, item.project_id],
        )
      ).rows;

      const members = (
        await c.query(
          `select pr.id, pr.full_name as name, pr.role_id
             from public.project_members pm join public.profiles pr on pr.id = pm.profile_id
            where pm.project_id = $1 order by pr.full_name`,
          [item.project_id],
        )
      ).rows;

      return { currentStatusId: item.current_status_id as string | null, statuses, members };
    });
  }

  /**
   * Replace the item's assignees for one status (manage_people_and_deadlines).
   * RLS enforces the permission and project membership.
   */
  async setStatusAssignees(user: UserContext, itemId: string, statusId: string, profileIds: string[]) {
    try {
      return await this.db.withUser(user, async (c) => {
        await c.query(`delete from public.item_status_assignees where item_id = $1 and status_id = $2`, [itemId, statusId]);
        for (const pid of profileIds) {
          await c.query(
            `insert into public.item_status_assignees (item_id, status_id, profile_id, org_id) values ($1, $2, $3, $4)`,
            [itemId, statusId, pid, user.orgId],
          );
        }
        return { ok: true as const };
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === RLS_VIOLATION || code === FK_VIOLATION) throw new ForbiddenException('You cannot assign people to this item');
      throw err;
    }
  }

  private async loadItem(c: PoolClient, itemId: string) {
    const { rows } = await c.query(
      `select ci.id, ci.item_number, ci.name, ci.template_id,
              s.name as status_name, s.color as status_color
         from public.content_items ci
         left join public.workflow_statuses s on s.id = ci.current_status_id
        where ci.id = $1`,
      [itemId],
    );
    return rows[0] as
      | { id: string; item_number: number; name: string; template_id: string | null;
          status_name: string | null; status_color: string | null }
      | undefined;
  }
}
