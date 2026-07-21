import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Request } from 'express';
import { DatabaseService } from '../db/database.service.js';

export interface UserContext {
  userId: string;
  orgId: string;
  isOwner: boolean;
  roleId: string;
  /** Permission keys this user's role grants. Used for the code-level checks. */
  permissions: Set<string>;
}

declare module 'express' {
  interface Request {
    user?: UserContext;
  }
}

/**
 * Verifies the Supabase token and resolves the caller: org, role, owner flag,
 * and the set of permissions their role grants. The permission set powers the
 * code-level PolicyService checks (defense in depth); RLS enforces the same
 * rules again at the database.
 *
 * Verification goes through Supabase (auth.getUser) so we hold no JWT secret.
 * The profile + permission lookup is a trusted privileged read — RLS can't
 * scope it, since we don't yet know the org. Fails closed.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly supabase: SupabaseClient;

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {
    const url = process.env.SUPABASE_URL;
    const anon = process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY not set');
    this.supabase = createClient(url, anon, { auth: { persistSession: false } });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Missing bearer token');

    const { data, error } = await this.supabase.auth.getUser(token);
    if (error || !data.user) throw new UnauthorizedException('Invalid token');

    const rows = await this.db.privileged<{
      org_id: string;
      is_owner: boolean;
      role_id: string;
      is_active: boolean;
      permission_key: string | null;
    }>(
      `select p.org_id, p.is_owner, p.role_id, p.is_active, rp.permission_key
         from public.profiles p
         left join public.role_permissions rp on rp.role_id = p.role_id
        where p.id = $1`,
      [data.user.id],
    );

    const first = rows[0];
    if (!first) throw new UnauthorizedException('No profile for this user');
    if (!first.is_active) throw new UnauthorizedException('Account is deactivated');

    const permissions = new Set(
      rows.map((r) => r.permission_key).filter((k): k is string => !!k),
    );
    // Owner always retains role management — anti-lockout, mirrors RLS.
    if (first.is_owner) permissions.add('manage_roles');

    req.user = {
      userId: data.user.id,
      orgId: first.org_id,
      isOwner: first.is_owner,
      roleId: first.role_id,
      permissions,
    };
    return true;
  }
}
