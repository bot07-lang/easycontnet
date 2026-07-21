import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Module,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type UserContext } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../access/require-permission.decorator.js';
import { DatabaseService } from '../db/database.service.js';
import { DEFAULT_WORKFLOW } from '@content/shared';

@Controller('projects')
class ProjectsController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  @Get()
  @UseGuards(AuthGuard)
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
