import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DatabaseService } from '../db/database.service.js';
import type { UserContext } from '../auth/auth.guard.js';

// Postgres error codes we translate into a clean 403 rather than a 500.
const RLS_VIOLATION = '42501';
const FK_VIOLATION = '23503';

const BUCKET = 'content-files';
const DOWNLOAD_TTL = 60 * 60; // signed download URLs live one hour

interface FileRow {
  id: string;
  name: string;
  mime: string | null;
  size_bytes: string | number | null;
  folder: string | null;
  storage_path: string;
  created_at: string;
  uploaded_by?: string | null;
  uploaded_by_role?: string | null;
  linked_items?: { id: string; name: string }[];
}

/**
 * Project file library. Metadata lives in public.project_files (RLS-scoped, so
 * every read/write rides the project-membership gate as the caller); the bytes
 * live in the private content-files bucket. The API is the only thing that
 * touches storage — with the service role — and hands the browser short-lived
 * signed URLs, so the bucket never needs to be public.
 *
 * Upload is two steps to sidestep Vercel's ~4.5MB function body cap: the API
 * issues a signed upload URL (permission-checked), the browser PUTs the bytes
 * straight to Storage, then the API records the metadata row.
 */
@Injectable()
export class FilesService {
  private cachedStorage: SupabaseClient | null = null;

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  // Created lazily so a missing service key doesn't crash the whole API on
  // boot — only file operations fail, and with a clear 503.
  private get storage(): SupabaseClient {
    if (this.cachedStorage) return this.cachedStorage;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new ServiceUnavailableException('File storage is not configured (SUPABASE_SERVICE_ROLE_KEY missing)');
    }
    this.cachedStorage = createClient(url, key, { auth: { persistSession: false } });
    return this.cachedStorage;
  }

  /** Confirm the caller may write to this project (member + same org) via RLS. */
  private async assertProjectWritable(user: UserContext, projectId: string) {
    const rows = await this.db.withUser(user, async (c) =>
      (
        await c.query(
          `select 1 from public.projects
            where id = $1 and org_id = $2 and public.app_is_project_member(id)`,
          [projectId, user.orgId],
        )
      ).rows,
    );
    if (!rows.length) throw new ForbiddenException('You are not a member of this project');
  }

  /** Step 1 of upload: a permission-checked signed URL the browser PUTs to. */
  async createUploadUrl(user: UserContext, projectId: string, name: string) {
    await this.assertProjectWritable(user, projectId);
    const path = `${user.orgId}/${projectId}/${randomUUID()}-${sanitize(name)}`;
    const { data, error } = await this.storage.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new BadRequestException(error?.message ?? 'Could not create an upload URL');
    return { path, token: data.token, signedUrl: data.signedUrl };
  }

  /**
   * Step 2 of upload: record the metadata after the browser stored the bytes.
   * RLS enforces membership + org; the path-prefix check stops a client from
   * recording a row that points at another tenant's object.
   */
  async recordFile(
    user: UserContext,
    input: { projectId: string; path: string; name: string; mime?: string | null; size?: number | null; folder?: string | null },
  ) {
    if (!input.path.startsWith(`${user.orgId}/${input.projectId}/`)) {
      throw new BadRequestException('Invalid storage path');
    }
    try {
      const row = await this.db.withUser(user, async (c) =>
        (
          await c.query<FileRow>(
            `insert into public.project_files
               (org_id, project_id, folder, storage_path, name, mime, size_bytes, uploaded_by)
             values ($1, $2, $3, $4, $5, $6, $7, $8)
             returning id, name, mime, size_bytes, folder, storage_path, created_at`,
            [
              user.orgId,
              input.projectId,
              input.folder?.trim() || null,
              input.path,
              input.name,
              input.mime ?? null,
              input.size ?? null,
              user.userId,
            ],
          )
        ).rows[0],
      );
      if (!row) throw new ForbiddenException('Cannot add this file');
      return this.withUrl(row);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === RLS_VIOLATION || code === FK_VIOLATION) throw new ForbiddenException('Cannot add this file');
      throw err;
    }
  }

  /** A project's library files, each with a short-lived signed download URL. */
  async listFiles(user: UserContext, projectId: string) {
    const rows = await this.db.withUser(user, async (c) =>
      (
        await c.query<FileRow>(
          `select f.id, f.name, f.mime, f.size_bytes, f.folder, f.storage_path, f.created_at,
                  pr.full_name as uploaded_by, r.name as uploaded_by_role,
                  coalesce((
                    select jsonb_agg(distinct jsonb_build_object('id', ci.id, 'name', ci.name))
                      from public.content_field_values v
                      join public.content_items ci on ci.id = v.item_id
                     where ci.project_id = f.project_id
                       and v.value @> jsonb_build_array(jsonb_build_object('id', f.id::text))
                  ), '[]'::jsonb) as linked_items
             from public.project_files f
             left join public.profiles pr on pr.id = f.uploaded_by
             left join public.roles r on r.id = pr.role_id
            where f.project_id = $1
            order by f.created_at desc`,
          [projectId],
        )
      ).rows,
    );
    return Promise.all(rows.map((r) => this.withUrl(r)));
  }

  /** Distinct folders in a project's library — for the "Assign a folder" picker. */
  async listFolders(user: UserContext, projectId: string) {
    const rows = await this.db.withUser(user, async (c) =>
      (
        await c.query<{ folder: string }>(
          `select distinct folder from public.project_files
            where project_id = $1 and folder is not null order by folder`,
          [projectId],
        )
      ).rows,
    );
    return rows.map((r) => r.folder);
  }

  /** Delete a library file: remove the row (RLS) then the stored object. */
  async deleteFile(user: UserContext, id: string) {
    const row = await this.db.withUser(user, async (c) =>
      (
        await c.query<{ storage_path: string }>(
          `delete from public.project_files where id = $1 returning storage_path`,
          [id],
        )
      ).rows[0],
    );
    if (!row) throw new NotFoundException('File not found');
    await this.storage.storage.from(BUCKET).remove([row.storage_path]);
    return { ok: true };
  }

  /** Shape a row for the client and attach a signed download URL. */
  private async withUrl(row: FileRow) {
    const { data } = await this.storage.storage.from(BUCKET).createSignedUrl(row.storage_path, DOWNLOAD_TTL);
    return {
      id: row.id,
      name: row.name,
      mime: row.mime,
      sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
      folder: row.folder ?? null,
      uploadedBy: row.uploaded_by ?? null,
      uploadedByRole: row.uploaded_by_role ?? null,
      linkedItems: row.linked_items ?? [],
      createdAt: row.created_at,
      url: data?.signedUrl ?? null,
    };
  }

  /** Move a file to a folder (or clear it with null). */
  async updateFile(user: UserContext, id: string, folder: string | null) {
    const row = await this.db.withUser(user, async (c) =>
      (
        await c.query<{ id: string }>(
          `update public.project_files set folder = $2 where id = $1 returning id`,
          [id, folder?.trim() || null],
        )
      ).rows[0],
    );
    if (!row) throw new NotFoundException('File not found');
    return { ok: true as const };
  }
}

/** Keep object keys filesystem/URL-safe; the uuid prefix guarantees uniqueness. */
function sanitize(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'file';
}
