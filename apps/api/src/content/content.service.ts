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
        // The status the item is moving *from*, captured before the update so the
        // version can show the from → to transition.
        const fromStatus = (
          await c.query(
            `select s.name from public.content_items ci
               left join public.workflow_statuses s on s.id = ci.current_status_id
              where ci.id = $1`,
            [itemId],
          )
        ).rows[0]?.name ?? null;
        const { rowCount } = await c.query(
          `update public.content_items set current_status_id = $2, updated_at = now() where id = $1`,
          [itemId, statusId],
        );
        if (!rowCount) throw new ForbiddenException('You cannot change this item');
        // A status change auto-creates a version, per the reference.
        await this.snapshot(c, user, itemId, 'status_change', null, fromStatus);
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

  /* ------------------------------------------------------------- versions */

  /** List an item's saved versions (newest first). */
  async listVersions(user: UserContext, itemId: string) {
    return this.db.withUser(user, async (c) => {
      const { rows } = await c.query(
        `select v.id, v.kind, v.label, v.item_name, v.status_name, v.from_status_name, v.created_at,
                pr.full_name as created_by_name, ro.name as created_by_role,
                ws.color as status_color, fws.color as from_status_color
           from public.content_item_versions v
           left join public.profiles pr on pr.id = v.created_by
           left join public.roles ro on ro.id = pr.role_id
           left join public.content_items ci on ci.id = v.item_id
           left join public.workflow_statuses ws on ws.name = v.status_name and ws.project_id = ci.project_id
           left join public.workflow_statuses fws on fws.name = v.from_status_name and fws.project_id = ci.project_id
          where v.item_id = $1
          order by v.created_at desc`,
        [itemId],
      );
      return rows;
    });
  }

  /** Snapshot the item's current field values into a version. */
  async saveVersion(user: UserContext, itemId: string, kind: 'manual' | 'status_change', label?: string | null) {
    return this.db.withUser(user, (c) => this.snapshot(c, user, itemId, kind, label ?? null));
  }

  /** The stored snapshot for one version (field_id → value), plus its metadata. */
  async getVersion(user: UserContext, versionId: string) {
    return this.db.withUser(user, async (c) => {
      const { rows } = await c.query(
        `select id, item_id, kind, label, item_name, status_name, snapshot, created_at
           from public.content_item_versions where id = $1`,
        [versionId],
      );
      if (!rows[0]) throw new NotFoundException('Version not found');
      return rows[0];
    });
  }

  /** Rename a version (manage its label). */
  async renameVersion(user: UserContext, versionId: string, label: string) {
    return this.db.withUser(user, async (c) => {
      const { rowCount } = await c.query(
        `update public.content_item_versions set label = $2 where id = $1`,
        [versionId, label.trim() || null],
      );
      if (!rowCount) throw new NotFoundException('Version not found');
      return { ok: true as const };
    });
  }

  /** Delete a version (RLS write policy = project membership). */
  async deleteVersion(user: UserContext, versionId: string) {
    try {
      return await this.db.withUser(user, async (c) => {
        const { rowCount } = await c.query(
          `delete from public.content_item_versions where id = $1`,
          [versionId],
        );
        if (!rowCount) throw new NotFoundException('Version not found');
        return { ok: true as const };
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === RLS_VIOLATION || code === FK_VIOLATION) throw new ForbiddenException('You cannot delete this version');
      throw err;
    }
  }

  /**
   * Copy a version's snapshot into a brand-new content item in the same project
   * and template. The new item starts fresh — initial status, its own version
   * history — only the field values are carried over, matching the reference.
   */
  async copyVersionToItem(user: UserContext, versionId: string, name: string) {
    try {
      return await this.db.withUser(user, async (c) => {
        const v = (
          await c.query(
            `select v.snapshot, ci.project_id, ci.template_id
               from public.content_item_versions v
               join public.content_items ci on ci.id = v.item_id
              where v.id = $1`,
            [versionId],
          )
        ).rows[0];
        if (!v) throw new NotFoundException('Version not found');

        const newId = (
          await c.query(`select public.api_create_content_item($1, $2, $3, $4, $5::text[]) as id`, [
            v.project_id,
            name.trim() || 'Untitled',
            v.template_id,
            null,
            [],
          ])
        ).rows[0]?.id as string;

        // Seed the new item's field values from the snapshot (only fields that
        // still exist on the template).
        await c.query(
          `insert into public.content_field_values (item_id, field_id, org_id, value)
           select $1, (s.key)::uuid, $2, s.value
             from jsonb_each($3::jsonb) as s
            where exists (select 1 from public.template_fields f where f.id = (s.key)::uuid)
           on conflict (item_id, field_id)
           do update set value = excluded.value, updated_at = now()`,
          [newId, user.orgId, JSON.stringify(v.snapshot)],
        );
        return { id: newId };
      });
    } catch (err) {
      if ((err as { code?: string }).code === RLS_VIOLATION) {
        throw new ForbiddenException('You cannot create items in this project');
      }
      throw err;
    }
  }

  /**
   * Restore a version: first snapshot the current state as a backup, then write
   * the version's field values back onto the item. manage_content_items lets the
   * field-value writes pass the four-gate edit rule for every field.
   */
  async restoreVersion(user: UserContext, itemId: string, versionId: string) {
    try {
      return await this.db.withUser(user, async (c) => {
        const v = (
          await c.query(`select snapshot from public.content_item_versions where id = $1 and item_id = $2`, [
            versionId,
            itemId,
          ])
        ).rows[0];
        if (!v) throw new NotFoundException('Version not found');

        // Back up the current state before overwriting it.
        await this.snapshot(c, user, itemId, 'manual', 'Backup before restore');

        // Write the version's values back (only for fields that still exist).
        await c.query(
          `insert into public.content_field_values (item_id, field_id, org_id, value)
           select $1, (s.key)::uuid, $2, s.value
             from jsonb_each($3::jsonb) as s
            where exists (select 1 from public.template_fields f where f.id = (s.key)::uuid)
           on conflict (item_id, field_id)
           do update set value = excluded.value, updated_at = now()`,
          [itemId, user.orgId, JSON.stringify(v.snapshot)],
        );
        return { ok: true as const };
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === RLS_VIOLATION || code === FK_VIOLATION) throw new ForbiddenException('You cannot restore this item');
      throw err;
    }
  }

  /** Shared snapshot helper — captures current field values + item/status name. */
  private async snapshot(
    c: PoolClient,
    user: UserContext,
    itemId: string,
    kind: 'manual' | 'status_change',
    label: string | null,
    fromStatusName: string | null = null,
  ) {
    const meta = (
      await c.query(
        `select ci.name, s.name as status_name
           from public.content_items ci
           left join public.workflow_statuses s on s.id = ci.current_status_id
          where ci.id = $1`,
        [itemId],
      )
    ).rows[0];
    if (!meta) throw new NotFoundException('Item not found');

    const snap = (
      await c.query(
        `select coalesce(jsonb_object_agg(field_id, value), '{}'::jsonb) as snapshot
           from public.content_field_values where item_id = $1`,
        [itemId],
      )
    ).rows[0].snapshot;

    const { rows } = await c.query(
      `insert into public.content_item_versions
         (org_id, item_id, kind, label, item_name, status_name, from_status_name, snapshot, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [user.orgId, itemId, kind, label, meta.name, meta.status_name, fromStatusName, snap, user.userId],
    );
    return { id: rows[0].id as string };
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
