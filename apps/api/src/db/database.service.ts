import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';

/**
 * The single chokepoint for all database access — the original architecture.
 *
 * The pool logs in as Supabase's `postgres` role (which bypasses RLS), but user
 * queries never run with that privilege: `withUser` opens a transaction, drops
 * to the RLS-bound `authenticated` role, and sets the verified identity LOCAL
 * to that transaction. RLS then applies as that user, and because the settings
 * are transaction-local they cannot leak onto the next request that reuses the
 * pooled connection.
 *
 * Rule: never run a user request outside withUser. `privileged` is only for
 * trusted internal lookups (resolving who the caller is, before we can set
 * their identity) — never expose its results without a check.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    this.pool = new Pool({
      connectionString,
      max: 10,
      ssl: { rejectUnauthorized: false },
    });
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  /** Run `fn` as the given user, inside a transaction, with RLS enforced. */
  async withUser<T>(
    ctx: { userId: string; orgId: string; isOwner: boolean },
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const claims = JSON.stringify({
        sub: ctx.userId,
        role: 'authenticated',
        app_metadata: { org_id: ctx.orgId, is_owner: ctx.isOwner },
      });
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
      await client.query('set local role authenticated');
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Privileged, NOT RLS-scoped. Trusted internal lookups only. */
  async privileged<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
    const res = await this.pool.query(text, params);
    return res.rows as T[];
  }
}
