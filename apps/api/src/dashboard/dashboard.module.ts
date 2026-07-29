import { Controller, Get, Inject, Module, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, type UserContext } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { DatabaseService } from '../db/database.service.js';

/**
 * The "All Projects" account dashboard. Per project: a workflow-status
 * breakdown, active/overdue counts, last activity, members, and how many items
 * are waiting on the caller ("My items"). Plus a top-level "My Items" list of
 * everything assigned to the caller at its current status.
 *
 * RLS scopes all of it to the caller's org and visible projects. The
 * reference's "Recent Messages & Comments" section is omitted until comments
 * exist.
 */
@Controller('dashboard')
@UseGuards(AuthGuard)
class DashboardController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  @Get()
  get(@CurrentUser() user: UserContext, @Query('archived') archived?: string) {
    const wantArchived = archived === 'true';
    return this.db.withUser(user, async (c) => {
      const projects = (
        await c.query(
          `select
             p.id, p.project_number, p.name, p.description,
             (p.archived_at is not null) as archived,
             -- active = items not in a terminal status
             coalesce((
               select count(*) from public.content_items ci
               join public.workflow_statuses s on s.id = ci.current_status_id
               where ci.project_id = p.id and s.is_terminal = false), 0)::int as active_count,
             -- overdue = current status's due date is in the past
             coalesce((
               select count(distinct ci.id) from public.content_items ci
               join public.item_status_due_dates d
                 on d.item_id = ci.id and d.status_id = ci.current_status_id
               where ci.project_id = p.id and d.due_at is not null and d.due_at < now()), 0)::int as overdue_count,
             (select max(ci.updated_at) from public.content_items ci
                where ci.project_id = p.id) as last_activity,
             coalesce((
               select jsonb_agg(jsonb_build_object('name', pr.full_name) order by pr.full_name)
               from public.project_members pm
               join public.profiles pr on pr.id = pm.profile_id
               where pm.project_id = p.id), '[]'::jsonb) as members,
             coalesce((
               select count(*) from public.content_items ci
               join public.item_status_assignees a
                 on a.item_id = ci.id and a.status_id = ci.current_status_id
               where ci.project_id = p.id and a.profile_id = $1), 0)::int as my_items_count,
             coalesce((
               select jsonb_agg(
                 jsonb_build_object('name', s.name, 'color', s.color, 'count', b.cnt)
                 order by s.position)
               from (
                 select ci.current_status_id, count(*) as cnt
                 from public.content_items ci
                 where ci.project_id = p.id and ci.current_status_id is not null
                 group by ci.current_status_id
               ) b
               join public.workflow_statuses s on s.id = b.current_status_id), '[]'::jsonb
             ) as status_breakdown
           from public.projects p
           where ($2 and p.archived_at is not null)
              or (not $2 and p.archived_at is null)
           order by p.project_number`,
          [user.userId, wantArchived],
        )
      ).rows;

      const myItems = (
        await c.query(
          `select ci.id, ci.item_number, ci.name, ci.project_id,
                  p.name as project_name,
                  s.name as status_name, s.color as status_color
             from public.content_items ci
             join public.projects p on p.id = ci.project_id
             join public.item_status_assignees a
               on a.item_id = ci.id and a.status_id = ci.current_status_id
             left join public.workflow_statuses s on s.id = ci.current_status_id
            where a.profile_id = $1
            order by ci.updated_at desc`,
          [user.userId],
        )
      ).rows;

      return { projects, myItems };
    });
  }
}

@Module({ controllers: [DashboardController] })
export class DashboardModule {}
