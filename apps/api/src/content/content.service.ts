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
