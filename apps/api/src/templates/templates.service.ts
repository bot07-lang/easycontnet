import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../db/database.service.js';
import type { UserContext } from '../auth/auth.guard.js';

const RLS_VIOLATION = '42501';
const FK_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

/**
 * Templates are the product's "content types": a template owns tabs, and tabs
 * own fields. Everything is per-project (a template belongs to one project and
 * never crosses over). Writes require manage_templates; reads follow project
 * visibility. All of it runs through db.withUser so RLS is the real wall.
 */
@Injectable()
export class TemplatesService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** Templates in a project, enriched with tab/field/item counts for the grid. */
  async listTemplates(user: UserContext, projectId: string) {
    return this.db.withUser(user, async (c) => {
      const { rows } = await c.query(
        `select t.id, t.name, t.description, t.is_default, t.updated_at,
                (select count(*) from public.template_tabs tb where tb.template_id = t.id) as tab_count,
                (select count(*) from public.template_fields f
                   join public.template_tabs tb on tb.id = f.tab_id
                  where tb.template_id = t.id) as field_count,
                (select count(*) from public.content_items ci where ci.template_id = t.id) as item_count
           from public.templates t
          where t.project_id = $1
          order by t.is_default desc, t.name`,
        [projectId],
      );
      return rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        description: (r.description as string | null) ?? null,
        is_default: r.is_default as boolean,
        updated_at: r.updated_at as string,
        tab_count: Number(r.tab_count),
        field_count: Number(r.field_count),
        item_count: Number(r.item_count),
      }));
    });
  }

  /** A template's full structure: tabs, each with its ordered fields (for the builder). */
  async getTemplate(user: UserContext, templateId: string) {
    return this.db.withUser(user, async (c) => {
      const t = (
        await c.query(`select id, project_id, name, description, is_default from public.templates where id = $1`, [
          templateId,
        ])
      ).rows[0];
      if (!t) throw new NotFoundException('Template not found');

      const tabs = (
        await c.query(
          `select id, name, position, is_system, is_hidden
             from public.template_tabs where template_id = $1 order by position`,
          [templateId],
        )
      ).rows;

      const fields = (
        await c.query(
          `select f.id, f.tab_id, f.field_type, f.label, f.position, f.is_system,
                  f.is_visible, f.is_required, f.guidelines, f.is_plain_text,
                  f.recommended_length, f.recommended_length_units, f.choices, f.default_content
             from public.template_fields f
             join public.template_tabs tb on tb.id = f.tab_id
            where tb.template_id = $1
            order by f.position`,
          [templateId],
        )
      ).rows;

      return {
        id: t.id as string,
        projectId: t.project_id as string,
        name: t.name as string,
        description: (t.description as string | null) ?? null,
        isDefault: t.is_default as boolean,
        tabs: tabs.map((tb) => ({
          id: tb.id as string,
          name: tb.name as string,
          position: tb.position as number,
          isSystem: tb.is_system as boolean,
          isHidden: tb.is_hidden as boolean,
          fields: fields
            .filter((f) => f.tab_id === tb.id)
            .map((f) => ({
              id: f.id as string,
              type: f.field_type as string,
              label: f.label as string,
              position: f.position as number,
              isSystem: f.is_system as boolean,
              isVisible: f.is_visible as boolean,
              isRequired: f.is_required as boolean,
              guidelines: (f.guidelines as string | null) ?? undefined,
              isPlainText: f.is_plain_text as boolean,
              recommendedLength: (f.recommended_length as number | null) ?? undefined,
              recommendedLengthUnits: (f.recommended_length_units as string | null) ?? undefined,
              choices: Array.isArray(f.choices) ? (f.choices as string[]) : [],
              defaultContent: (f.default_content as string | null) ?? undefined,
            })),
        })),
      };
    });
  }

  /**
   * Create a template, provisioned with a "Main Content" system tab holding a
   * Title and a Content field — the minimum a content item needs, matching item
   * auto-provisioning. The first template in a project becomes the default.
   *
   * The "is it the first one" check and the insert are two separate statements,
   * so two concurrent creates in a brand-new project can both see count === 0
   * and both try to insert as default. The DB's `templates_one_default_per_project`
   * partial unique index is the real guard against that (only one can win) — the
   * loser's insert fails with a unique violation on that index specifically, and
   * we retry it once as non-default instead of surfacing an error for what is
   * otherwise a perfectly valid create.
   */
  async createTemplate(user: UserContext, projectId: string, name: string, description?: string | null) {
    try {
      return await this.db.withUser(user, async (c) => {
        const count = Number(
          (await c.query(`select count(*) from public.templates where project_id = $1`, [projectId]))
            .rows[0].count,
        );

        const insert = (isDefault: boolean) =>
          c.query(
            `insert into public.templates (org_id, project_id, name, description, is_default)
             values ($1, $2, $3, $4, $5) returning id`,
            [user.orgId, projectId, name.trim(), description?.trim() || null, isDefault],
          );

        // A savepoint so a lost race can roll back just the failed insert and
        // retry, without poisoning the whole transaction (any error otherwise
        // aborts every later statement, including provisionSystemStructure).
        await c.query('savepoint create_template');
        let templateId: string;
        try {
          templateId = (await insert(count === 0)).rows[0].id as string;
        } catch (err) {
          if (count === 0 && isDefaultConflict(err)) {
            await c.query('rollback to savepoint create_template');
            templateId = (await insert(false)).rows[0].id as string;
          } else {
            throw err;
          }
        }

        await this.provisionSystemStructure(c, user.orgId, templateId);
        return { id: templateId };
      });
    } catch (err) {
      throw mapWriteError(err);
    }
  }

  /** Deep-clone a template (its tabs and fields) into the same project. */
  async duplicateTemplate(user: UserContext, templateId: string) {
    try {
      return await this.db.withUser(user, async (c) => {
        const src = (
          await c.query(`select project_id, name from public.templates where id = $1`, [templateId])
        ).rows[0];
        if (!src) throw new NotFoundException('Template not found');

        const newId = (
          await c.query(
            `insert into public.templates (org_id, project_id, name, is_default)
             values ($1, $2, $3, false) returning id`,
            [user.orgId, src.project_id, `${src.name} (copy)`],
          )
        ).rows[0].id as string;

        const tabs = (
          await c.query(
            `select id, name, position, is_system, is_hidden from public.template_tabs where template_id = $1`,
            [templateId],
          )
        ).rows;

        for (const tab of tabs) {
          const newTabId = (
            await c.query(
              `insert into public.template_tabs (org_id, template_id, name, position, is_system, is_hidden)
               values ($1, $2, $3, $4, $5, $6) returning id`,
              [user.orgId, newId, tab.name, tab.position, tab.is_system, tab.is_hidden],
            )
          ).rows[0].id as string;

          await c.query(
            `insert into public.template_fields
               (org_id, tab_id, field_type, label, position, is_system, is_visible, is_required,
                guidelines, is_plain_text, recommended_length, recommended_length_units, choices, default_content)
             select $1, $2, field_type, label, position, is_system, is_visible, is_required,
                    guidelines, is_plain_text, recommended_length, recommended_length_units, choices, default_content
               from public.template_fields where tab_id = $3`,
            [user.orgId, newTabId, tab.id],
          );
        }

        return { id: newId };
      });
    } catch (err) {
      throw mapWriteError(err);
    }
  }

  /**
   * Clone a template into a DIFFERENT project (its tabs and fields), keeping the
   * name. RLS enforces that the caller is a member of the target project with
   * manage_templates — cloning across a project boundary they can't write to is
   * refused. Becomes the default only if the target has no templates yet.
   */
  async cloneToProject(user: UserContext, templateId: string, targetProjectId: string) {
    try {
      return await this.db.withUser(user, async (c) => {
        const src = (
          await c.query(`select project_id, name from public.templates where id = $1`, [templateId])
        ).rows[0];
        if (!src) throw new NotFoundException('Template not found');
        if (src.project_id === targetProjectId) {
          throw new ForbiddenException('Pick a different project — use Duplicate to copy within this one');
        }

        const targetCount = Number(
          (await c.query(`select count(*) from public.templates where project_id = $1`, [targetProjectId]))
            .rows[0].count,
        );

        const insert = (isDefault: boolean) =>
          c.query(
            `insert into public.templates (org_id, project_id, name, is_default)
             values ($1, $2, $3, $4) returning id`,
            [user.orgId, targetProjectId, src.name, isDefault],
          );

        // See createTemplate for why this needs a savepoint: two concurrent
        // clones into the same empty project can both lose the race for
        // is_default, and the loser should fall back to non-default instead
        // of failing outright.
        await c.query('savepoint clone_template');
        let newId: string;
        try {
          newId = (await insert(targetCount === 0)).rows[0].id as string;
        } catch (err) {
          if (targetCount === 0 && isDefaultConflict(err)) {
            await c.query('rollback to savepoint clone_template');
            newId = (await insert(false)).rows[0].id as string;
          } else {
            throw err;
          }
        }

        const tabs = (
          await c.query(
            `select id, name, position, is_system, is_hidden from public.template_tabs where template_id = $1`,
            [templateId],
          )
        ).rows;
        for (const tab of tabs) {
          const newTabId = (
            await c.query(
              `insert into public.template_tabs (org_id, template_id, name, position, is_system, is_hidden)
               values ($1, $2, $3, $4, $5, $6) returning id`,
              [user.orgId, newId, tab.name, tab.position, tab.is_system, tab.is_hidden],
            )
          ).rows[0].id as string;
          await c.query(
            `insert into public.template_fields
               (org_id, tab_id, field_type, label, position, is_system, is_visible, is_required,
                guidelines, is_plain_text, recommended_length, recommended_length_units, choices, default_content)
             select $1, $2, field_type, label, position, is_system, is_visible, is_required,
                    guidelines, is_plain_text, recommended_length, recommended_length_units, choices, default_content
               from public.template_fields where tab_id = $3`,
            [user.orgId, newTabId, tab.id],
          );
        }
        return { id: newId, projectId: targetProjectId };
      });
    } catch (err) {
      throw mapWriteError(err);
    }
  }

  /** Rename and/or set-as-default. Setting default clears the others in the project. */
  async updateTemplate(user: UserContext, templateId: string, patch: { name?: string; description?: string | null; isDefault?: boolean }) {
    try {
      return await this.db.withUser(user, async (c) => {
        const t = (
          await c.query(`select project_id from public.templates where id = $1`, [templateId])
        ).rows[0];
        if (!t) throw new NotFoundException('Template not found');

        if (patch.name !== undefined) {
          await c.query(`update public.templates set name = $1 where id = $2`, [patch.name.trim(), templateId]);
        }
        if (patch.description !== undefined) {
          await c.query(`update public.templates set description = $1 where id = $2`, [patch.description?.trim() || null, templateId]);
        }
        if (patch.isDefault === true) {
          await c.query(`update public.templates set is_default = (id = $1) where project_id = $2`, [
            templateId,
            t.project_id,
          ]);
        }
        return { ok: true as const };
      });
    } catch (err) {
      throw mapWriteError(err);
    }
  }

  /**
   * Delete a template. Blocked while content items still use it (the FK would
   * be violated) — surfaced as a clear message.
   */
  async deleteTemplate(user: UserContext, templateId: string) {
    try {
      return await this.db.withUser(user, async (c) => {
        const { rowCount } = await c.query(`delete from public.templates where id = $1`, [templateId]);
        if (!rowCount) throw new NotFoundException('Template not found');
        return { ok: true as const };
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === FK_VIOLATION) {
        throw new ForbiddenException('This template is in use by content items — reassign them first');
      }
      throw mapWriteError(err);
    }
  }

  /* -------------------------------------------------------------- fields */

  /** Update a field's settings (manage_templates). Partial. */
  async updateField(
    user: UserContext,
    fieldId: string,
    patch: {
      label?: string;
      isVisible?: boolean;
      isRequired?: boolean;
      isPlainText?: boolean;
      recommendedLength?: number | null;
      recommendedLengthUnits?: string;
      guidelines?: string | null;
      choices?: string[];
      defaultContent?: string | null;
    },
  ) {
    try {
      return await this.db.withUser(user, async (c) => {
        const col: Record<string, unknown> = {};
        if (patch.label !== undefined) col.label = patch.label.trim();
        if (patch.isVisible !== undefined) col.is_visible = patch.isVisible;
        if (patch.isRequired !== undefined) col.is_required = patch.isRequired;
        if (patch.isPlainText !== undefined) col.is_plain_text = patch.isPlainText;
        if (patch.recommendedLength !== undefined) col.recommended_length = patch.recommendedLength;
        if (patch.recommendedLengthUnits !== undefined) col.recommended_length_units = patch.recommendedLengthUnits;
        if (patch.guidelines !== undefined) col.guidelines = patch.guidelines;
        if (patch.choices !== undefined) col.choices = JSON.stringify(patch.choices);
        if (patch.defaultContent !== undefined) col.default_content = patch.defaultContent;

        const keys = Object.keys(col);
        if (!keys.length) return { ok: true as const };
        const sets = keys.map((k, i) => `${k} = $${i + 1}`);
        const vals = keys.map((k) => col[k]);
        vals.push(fieldId);
        const { rowCount } = await c.query(
          `update public.template_fields set ${sets.join(', ')} where id = $${vals.length}`,
          vals,
        );
        if (!rowCount) throw new NotFoundException('Field not found');
        return { ok: true as const };
      });
    } catch (err) {
      throw mapFieldError(err);
    }
  }

  /** Add a custom field to a tab (manage_templates). Always non-system. */
  async createField(user: UserContext, tabId: string, fieldType: string) {
    if (!ADDABLE_TYPES.has(fieldType)) throw new ForbiddenException('Unknown field type');
    try {
      return await this.db.withUser(user, async (c) => {
        const tab = (await c.query(`select id from public.template_tabs where id = $1`, [tabId])).rows[0];
        if (!tab) throw new NotFoundException('Tab not found');
        const position = Number(
          (await c.query(`select coalesce(max(position), 0) + 1024 as p from public.template_fields where tab_id = $1`, [tabId]))
            .rows[0].p,
        );
        const isText = fieldType === 'single_line_text' || fieldType === 'paragraph_text';
        // New fields start with a blank label — the builder shows a placeholder,
        // matching the reference (no prefilled name).
        const { rows } = await c.query(
          `insert into public.template_fields
             (org_id, tab_id, field_type, label, position, is_system, is_visible, is_required,
              is_plain_text, recommended_length_units, choices)
           values ($1, $2, $3, '', $4, false, true, false, $5, $6, '[]'::jsonb)
           returning id`,
          [user.orgId, tabId, fieldType, position, fieldType === 'paragraph_text', isText ? 'words' : null],
        );
        return { id: rows[0].id as string };
      });
    } catch (err) {
      throw mapFieldError(err);
    }
  }

  /** Delete a field (manage_templates). System fields cannot be deleted. */
  async deleteField(user: UserContext, fieldId: string) {
    try {
      return await this.db.withUser(user, async (c) => {
        const f = (await c.query(`select is_system from public.template_fields where id = $1`, [fieldId])).rows[0];
        if (!f) throw new NotFoundException('Field not found');
        if (f.is_system) throw new ForbiddenException('System fields cannot be deleted — hide them instead');
        await c.query(`delete from public.template_fields where id = $1`, [fieldId]);
        return { ok: true as const };
      });
    } catch (err) {
      throw mapFieldError(err);
    }
  }

  /** Move a field up or down within its tab by swapping positions with the neighbour. */
  async moveField(user: UserContext, fieldId: string, direction: 'up' | 'down') {
    try {
      return await this.db.withUser(user, async (c) => {
        const f = (
          await c.query(`select id, tab_id, position from public.template_fields where id = $1`, [fieldId])
        ).rows[0];
        if (!f) throw new NotFoundException('Field not found');
        const cmp = direction === 'up' ? '<' : '>';
        const order = direction === 'up' ? 'desc' : 'asc';
        const neighbor = (
          await c.query(
            `select id, position from public.template_fields
              where tab_id = $1 and position ${cmp} $2 order by position ${order} limit 1`,
            [f.tab_id, f.position],
          )
        ).rows[0];
        if (!neighbor) return { ok: true as const }; // already at the edge
        // Swap via a temporary slot so a unique (tab, position) index can't collide.
        await c.query(`update public.template_fields set position = -1 where id = $1`, [f.id]);
        await c.query(`update public.template_fields set position = $1 where id = $2`, [f.position, neighbor.id]);
        await c.query(`update public.template_fields set position = $1 where id = $2`, [neighbor.position, f.id]);
        return { ok: true as const };
      });
    } catch (err) {
      throw mapFieldError(err);
    }
  }

  /* ---------------------------------------------------------------- tabs */

  /** Add a custom tab (manage_templates). Non-system; custom tabs hold custom fields only. */
  async createTab(user: UserContext, templateId: string, name: string) {
    try {
      return await this.db.withUser(user, async (c) => {
        const t = (await c.query(`select id from public.templates where id = $1`, [templateId])).rows[0];
        if (!t) throw new NotFoundException('Template not found');
        const position = Number(
          (await c.query(`select coalesce(max(position), 0) + 1024 as p from public.template_tabs where template_id = $1`, [templateId]))
            .rows[0].p,
        );
        const { rows } = await c.query(
          `insert into public.template_tabs (org_id, template_id, name, position, is_system, is_hidden)
           values ($1, $2, $3, $4, false, false) returning id`,
          [user.orgId, templateId, name.trim(), position],
        );
        return { id: rows[0].id as string };
      });
    } catch (err) {
      throw mapFieldError(err);
    }
  }

  /** Rename and/or show/hide a tab (manage_templates). */
  async updateTab(user: UserContext, tabId: string, patch: { name?: string; isHidden?: boolean }) {
    try {
      return await this.db.withUser(user, async (c) => {
        const sets: string[] = [];
        const vals: unknown[] = [];
        if (patch.name !== undefined) { vals.push(patch.name.trim()); sets.push(`name = $${vals.length}`); }
        if (patch.isHidden !== undefined) { vals.push(patch.isHidden); sets.push(`is_hidden = $${vals.length}`); }
        if (!sets.length) return { ok: true as const };
        vals.push(tabId);
        const { rowCount } = await c.query(
          `update public.template_tabs set ${sets.join(', ')} where id = $${vals.length}`,
          vals,
        );
        if (!rowCount) throw new NotFoundException('Tab not found');
        return { ok: true as const };
      });
    } catch (err) {
      throw mapFieldError(err);
    }
  }

  /** Delete a tab (manage_templates). System tabs (Main Content, CMS Fields) cannot be deleted. */
  async deleteTab(user: UserContext, tabId: string) {
    try {
      return await this.db.withUser(user, async (c) => {
        const tab = (await c.query(`select is_system from public.template_tabs where id = $1`, [tabId])).rows[0];
        if (!tab) throw new NotFoundException('Tab not found');
        if (tab.is_system) throw new ForbiddenException('The Main Content and CMS Fields tabs cannot be deleted');
        await c.query(`delete from public.template_tabs where id = $1`, [tabId]);
        return { ok: true as const };
      });
    } catch (err) {
      throw mapFieldError(err);
    }
  }

  /**
   * Provision a new template's two system tabs and their system fields, matching
   * the reference: Main Content (Title, Content, Files) always visible, and
   * CMS Fields (Featured image, Excerpt, Tags, Slug, Meta title, Meta
   * description) hidden by default.
   */
  private async provisionSystemStructure(c: PoolClient, orgId: string, templateId: string) {
    const addTab = async (name: string, position: number, isHidden: boolean) =>
      (
        await c.query(
          `insert into public.template_tabs (org_id, template_id, name, position, is_system, is_hidden)
           values ($1, $2, $3, $4, true, $5) returning id`,
          [orgId, templateId, name, position, isHidden],
        )
      ).rows[0].id as string;

    const addField = async (
      tabId: string, type: string, label: string, position: number,
      opts: { units?: string; guidelines?: string } = {},
    ) =>
      c.query(
        `insert into public.template_fields
           (org_id, tab_id, field_type, label, position, is_system, is_visible, is_required,
            is_plain_text, recommended_length_units, guidelines, choices)
         values ($1, $2, $3, $4, $5, true, true, false, false, $6, $7, '[]'::jsonb)`,
        [orgId, tabId, type, label, position, opts.units ?? null, opts.guidelines ?? null],
      );

    const main = await addTab('Main Content', 1024, false);
    await addField(main, 'single_line_text', 'Title', 1024, { units: 'characters' });
    await addField(main, 'paragraph_text', 'Content', 2048, { units: 'words' });
    await addField(main, 'file_image_upload', 'Files', 3072);

    const cms = await addTab('CMS Fields', 2048, true);
    await addField(cms, 'single_image', 'Featured image', 1024);
    await addField(cms, 'paragraph_text', 'Excerpt', 2048, { units: 'words' });
    await addField(cms, 'single_line_text', 'Tags', 3072, { units: 'words' });
    await addField(cms, 'single_line_text', 'Custom post slug', 4096, { units: 'words' });
    await addField(cms, 'single_line_text', 'Meta title', 5120, { units: 'words' });
    await addField(cms, 'paragraph_text', 'Meta description', 6144, { units: 'words' });
  }
}

// Field types a user may add (all ten custom types). System-only fields are
// provisioned, never added through this path.
const ADDABLE_TYPES = new Set([
  'heading', 'guidelines', 'single_line_text', 'paragraph_text', 'file_image_upload',
  'single_image', 'checkboxes', 'radio_buttons', 'date', 'dropdown_select',
]);

function mapFieldError(err: unknown): unknown {
  const code = (err as { code?: string }).code;
  if (code === RLS_VIOLATION) return new ForbiddenException('You cannot manage this template');
  return err;
}

/** True when `err` is the unique-violation from `templates_one_default_per_project`
 *  (two concurrent creates racing for "first template in the project"), as opposed
 *  to any other unique violation (e.g. a duplicate name). */
function isDefaultConflict(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string };
  return e.code === UNIQUE_VIOLATION && e.constraint === 'templates_one_default_per_project';
}

function mapWriteError(err: unknown): unknown {
  const e = err as { code?: string; constraint?: string };
  if (e.code === RLS_VIOLATION) return new ForbiddenException('You cannot manage templates in this project');
  if (e.code === UNIQUE_VIOLATION) {
    // Distinguish by constraint — a stray default-index conflict (createTemplate/
    // cloneToProject already retry past this; anything left here is unexpected)
    // shouldn't be blamed on the name.
    return e.constraint === 'templates_one_default_per_project'
      ? new ForbiddenException('Another template just became the default — try again')
      : new ForbiddenException('A template with that name already exists');
  }
  return err;
}
