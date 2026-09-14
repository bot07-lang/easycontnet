import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Module,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type UserContext } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../access/require-permission.decorator.js';
import { DatabaseService } from '../db/database.service.js';
import { DEFAULT_WORKFLOW } from '@content/shared';

// AuthGuard applied at the class level — RequirePermission no longer bundles
// it, so this is the only guard populating `req.user` for the @RequirePermission
// routes below (they have no other auth coverage of their own).
@Controller('projects')
@UseGuards(AuthGuard)
class ProjectsController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  @Get()
  list(@CurrentUser() user: UserContext) {
    return this.db.withUser(user, async (c) => {
      const { rows } = await c.query(
        `select id, project_number, name, description
           from public.projects
          where archived_at is null
          order by project_number`,
      );
      return rows;
    });
  }

  /**
   * Create a project. @RequirePermission is the code-level check (defense in
   * depth); api_create_project asserts the same permission in the database and
   * does the whole thing — project, default workflow, members — atomically.
   */
  @Post()
  @RequirePermission('manage_projects')
  async create(
    @CurrentUser() user: UserContext,
    @Body() body: { name?: string; memberIds?: string[] },
  ) {
    const name = body?.name?.trim();
    if (!name) throw new BadRequestException('Project name is required');

    return this.db.withUser(user, async (c) => {
      const { rows } = await c.query(
        `select public.api_create_project($1, $2::uuid[], $3::jsonb) as id`,
        [name, body.memberIds ?? [], JSON.stringify(DEFAULT_WORKFLOW)],
      );
      return { id: rows[0]?.id as string };
    });
  }

  /** Rename (Settings). RLS's update policy re-checks manage_projects. */
  @Patch(':id')
  @RequirePermission('manage_projects')
  async rename(
    @CurrentUser() user: UserContext,
    @Param('id') id: string,
    @Body() body: { name?: string },
  ) {
    const name = body?.name?.trim();
    if (!name) throw new BadRequestException('Name is required');
    return this.db.withUser(user, async (c) => {
      const { rowCount } = await c.query(
        `update public.projects set name = $2 where id = $1`,
        [id, name],
      );
      if (!rowCount) throw new BadRequestException('Project not found');
      return { ok: true };
    });
  }

  /** Archive (reversible — keeps all data). */
  @Post(':id/archive')
  @RequirePermission('manage_projects')
  archive(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.setArchived(user, id, true);
  }

  @Post(':id/restore')
  @RequirePermission('manage_projects')
  restore(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.setArchived(user, id, false);
  }

  /** Delete — irreversible. */
  @Delete(':id')
  @RequirePermission('manage_projects')
  remove(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.db.withUser(user, async (c) => {
      const { rowCount } = await c.query(`delete from public.projects where id = $1`, [id]);
      if (!rowCount) throw new BadRequestException('Project not found');
      return { ok: true };
    });
  }

  /** Duplicate structure into a new "(copy)" project. */
  @Post(':id/duplicate')
  @RequirePermission('manage_projects')
  duplicate(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.db.withUser(user, async (c) => {
      const { rows } = await c.query(`select public.api_duplicate_project($1) as id`, [id]);
      return { id: rows[0]?.id as string };
    });
  }

  private setArchived(user: UserContext, id: string, archived: boolean) {
    return this.db.withUser(user, async (c) => {
      const { rowCount } = await c.query(
        `update public.projects set archived_at = ${archived ? 'now()' : 'null'} where id = $1`,
        [id],
      );
      if (!rowCount) throw new BadRequestException('Project not found');
      return { ok: true };
    });
  }
}

/** Org members, for the assign-users picker. RLS scopes to the caller's org. */
@Controller('users')
@UseGuards(AuthGuard)
class UsersController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  @Get()
  list(@CurrentUser() user: UserContext) {
    return this.db.withUser(user, async (c) => {
      const { rows } = await c.query(
        `select p.id, p.full_name, r.name as role_name
           from public.profiles p
           join public.roles r on r.id = p.role_id
          where p.is_active
          order by p.full_name`,
      );
      return rows;
    });
  }
}

@Module({ controllers: [ProjectsController, UsersController] })
export class ProjectsModule {}
