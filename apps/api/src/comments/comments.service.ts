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
const CHECK_VIOLATION = '23514';

export interface NewComment {
  body?: string;
  anchor?: 'item' | 'field' | 'text' | 'file';
  fieldId?: string | null;
  fileId?: string | null;
  textAnchor?: unknown;
  parentId?: string | null;
}

/**
 * Comments on a content item — item / field / text / file anchored, threaded via
 * parent_id, with resolve. Everything rides RLS as the caller: any project member
 * may view + add + reply + resolve/edit/delete their OWN; editing/deleting/
 * resolving OTHERS' requires `manage_comments` (enforced by the DB policy).
 */
@Injectable()
export class CommentsService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** All comments for an item (flat; the client threads them by parent_id). */
  async list(user: UserContext, itemId: string) {
    return this.db.withUser(user, async (c) => {
      const { rows } = await c.query(
        `select cm.id, cm.item_id, cm.anchor, cm.field_id, cm.file_id, cm.text_anchor,
                cm.parent_id, cm.author_id, pr.full_name as author_name, ro.name as author_role,
                cm.body, cm.resolved, cm.resolved_by, cm.resolved_at,
                cm.created_at, cm.updated_at,
                -- May the caller edit / delete / resolve this comment? Own comment
                -- or the manage_comments permission (mirrors the comments RLS).
                (cm.author_id = $2 or (select public.app_has_permission('manage_comments'))) as can_manage
           from public.comments cm
           join public.profiles pr on pr.id = cm.author_id
           left join public.roles ro on ro.id = pr.role_id
          where cm.item_id = $1
          order by cm.created_at asc`,
        [itemId, user.userId],
      );
      return rows;
    });
  }

  async add(user: UserContext, itemId: string, input: NewComment) {
    const body = (input.body ?? '').trim();
    if (!body) throw new BadRequestException('Comment body is required');
    // There's no global ValidationPipe / DTO validation in this app, so a
    // malformed `anchor` would otherwise only be caught by the DB's `check`
    // constraint — surfacing as an unhandled 500 instead of a clean 400.
    const validAnchors = ['item', 'field', 'text', 'file'];
    if (input.anchor !== undefined && !validAnchors.includes(input.anchor)) {
      throw new BadRequestException(`anchor must be one of: ${validAnchors.join(', ')}`);
    }
    try {
      return await this.db.withUser(user, async (c) => {
        const { rows } = await c.query(
          `insert into public.comments
             (item_id, anchor, field_id, file_id, text_anchor, parent_id, author_id, body, org_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, public.app_org_id())
           returning id`,
          [
            itemId,
            input.anchor ?? 'item',
            input.fieldId ?? null,
            input.fileId ?? null,
            input.textAnchor ?? null,
            input.parentId ?? null,
            user.userId,
            body,
          ],
        );
        return { id: rows[0].id as string };
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === RLS_VIOLATION) throw new ForbiddenException('You cannot comment on this item');
      // Defense in depth for anything the upfront check above didn't catch
      // (e.g. a future constraint) — still a client-input problem, not a 500.
      if (code === CHECK_VIOLATION) throw new BadRequestException('Invalid comment data');
      throw err;
    }
  }

  /** Edit a comment's body (own comment, or manage_comments for others'). */
  async edit(user: UserContext, commentId: string, body: string) {
    const text = (body ?? '').trim();
    if (!text) throw new BadRequestException('Comment body is required');
    return this.db.withUser(user, async (c) => {
      const { rowCount } = await c.query(
        `update public.comments set body = $2 where id = $1`,
        [commentId, text],
      );
      if (!rowCount) throw new NotFoundException('Comment not found or not editable');
      return { ok: true as const };
    });
  }

  async remove(user: UserContext, commentId: string) {
    return this.db.withUser(user, async (c) => {
      const { rowCount } = await c.query(`delete from public.comments where id = $1`, [commentId]);
      if (!rowCount) throw new NotFoundException('Comment not found or not deletable');
      return { ok: true as const };
    });
  }

  /** Resolve / unresolve (own comment, or manage_comments for others'). */
  async setResolved(user: UserContext, commentId: string, resolved: boolean) {
    return this.db.withUser(user, async (c) => {
      const { rowCount } = await c.query(
        `update public.comments
            set resolved = $2,
                resolved_by = case when $2 then $3::uuid else null end,
                resolved_at = case when $2 then now() else null end
          where id = $1`,
        [commentId, resolved, user.userId],
      );
      if (!rowCount) throw new NotFoundException('Comment not found');
      return { ok: true as const };
    });
  }
}
