import { BadRequestException, Controller, Get, Inject, Module, Param, Query, UseGuards } from '@nestjs/common';
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

  /**
   * The per-project Dashboard tab: project header + members, "My items"
   * scoped to this project, a recent status-change activity feed, recent
   * comments (the "Recent Messages & Comments" panel), the workflow funnel
   * (every status, including zero-count ones), per-member item load, and
   * average time-in-status (last 30 days vs. the 30 before).
   *
   * "Recent activity" and "Workflow velocity" both read from
   * content_item_versions (kind='status_change') — the single code path that
   * records every status transition (see api_advance_item_status). Velocity
   * reconstructs each item's status timeline from that log: a segment per
   * status, closed by the next transition or, for the current status, by
   * now(). Items with no logged transition yet use their own created_at as
   * the start of their (only) segment. The one gap this can't fill is the
   * status an item was in *before* its first logged transition on versions
   * created before `from_status_name` existed — those segments are skipped
   * rather than guessed.
   */
  @Get('project/:id')
  getProject(@CurrentUser() user: UserContext, @Param('id') projectId: string) {
    return this.db.withUser(user, async (c) => {
      const project = (
        await c.query(`select id, name from public.projects where id = $1`, [projectId])
      ).rows[0];
      if (!project) throw new BadRequestException('Project not found');

      const members = (
        await c.query(
          `select pr.id, pr.full_name as name, r.name as role_name
             from public.project_members pm
             join public.profiles pr on pr.id = pm.profile_id
             left join public.roles r on r.id = pr.role_id
            where pm.project_id = $1
            order by pr.full_name`,
          [projectId],
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
            where a.profile_id = $2 and ci.project_id = $1
            order by ci.updated_at desc`,
          [projectId, user.userId],
        )
      ).rows;

      const recentActivity = (
        await c.query(
          `select v.id, v.created_at, v.item_id, ci.item_number, v.item_name,
                  v.status_name as to_status_name,
                  pr.full_name as actor_name, r.name as actor_role
             from public.content_item_versions v
             join public.content_items ci on ci.id = v.item_id
             left join public.profiles pr on pr.id = v.created_by
             left join public.roles r on r.id = pr.role_id
            where v.kind = 'status_change' and ci.project_id = $1
            order by v.created_at desc
            limit 30`,
          [projectId],
        )
      ).rows;

      const recentComments = (
        await c.query(
          `select c.id, c.created_at, c.body, c.resolved, c.item_id, ci.item_number,
                  ci.name as item_name, pr.full_name as author_name
             from public.comments c
             join public.content_items ci on ci.id = c.item_id
             left join public.profiles pr on pr.id = c.author_id
            where ci.project_id = $1
            order by c.created_at desc
            limit 15`,
          [projectId],
        )
      ).rows;

      const workflowFunnel = (
        await c.query(
          `with counts as (
             select current_status_id, count(*) n
               from public.content_items
              where project_id = $1 and current_status_id is not null
              group by current_status_id
           ), total as (select coalesce(sum(n), 0) t from counts)
           select s.id, s.name, s.color, s.position, coalesce(c.n, 0)::int as count,
                  case when (select t from total) > 0
                       then round(coalesce(c.n, 0) * 100.0 / (select t from total))
                       else 0 end::int as pct
             from public.workflow_statuses s
             left join counts c on c.current_status_id = s.id
            where s.project_id = $1
            order by s.position`,
          [projectId],
        )
      ).rows;

      const teamUtilization = (
        await c.query(
          `select pm.profile_id, pr.full_name as name, r.name as role_name,
                  coalesce(cnt.n, 0)::int as items_count
             from public.project_members pm
             join public.profiles pr on pr.id = pm.profile_id
             left join public.roles r on r.id = pr.role_id
             left join (
               select a.profile_id, count(*) n
                 from public.item_status_assignees a
                 join public.content_items ci
                   on ci.id = a.item_id and ci.current_status_id = a.status_id
                where ci.project_id = $1
                group by a.profile_id
             ) cnt on cnt.profile_id = pm.profile_id
            where pm.project_id = $1
            order by items_count desc, pr.full_name asc`,
          [projectId],
        )
      ).rows;

      const velocityByStatus = (
        await c.query(
          `with versions as (
             select v.item_id, v.created_at, v.status_name, v.from_status_name,
                    lead(v.created_at) over (partition by v.item_id order by v.created_at) as next_at,
                    row_number() over (partition by v.item_id order by v.created_at) as rn
               from public.content_item_versions v
               join public.content_items ci on ci.id = v.item_id
              where v.kind = 'status_change' and ci.project_id = $1
           ),
           segments as (
             select item_id, from_status_name as status_name,
                    (select ci2.created_at from public.content_items ci2 where ci2.id = versions.item_id) as entered_at,
                    created_at as exited_at
               from versions
              where rn = 1 and from_status_name is not null
             union all
             select item_id, status_name, created_at as entered_at, coalesce(next_at, now()) as exited_at
               from versions
             union all
             select ci.id, s.name, ci.created_at, now()
               from public.content_items ci
               join public.workflow_statuses s on s.id = ci.current_status_id
              where ci.project_id = $1
                and not exists (
                  select 1 from public.content_item_versions v2
                   where v2.item_id = ci.id and v2.kind = 'status_change'
                )
           )
           select status_name,
                  avg(extract(epoch from (exited_at - entered_at)))
                    filter (where entered_at >= now() - interval '30 days') as avg_secs_30d,
                  avg(extract(epoch from (exited_at - entered_at)))
                    filter (where entered_at >= now() - interval '60 days'
                               and entered_at < now() - interval '30 days') as avg_secs_prev
             from segments
            group by status_name`,
          [projectId],
        )
      ).rows;
      const velocityByName = new Map(velocityByStatus.map((r) => [r.status_name, r]));
      const workflowVelocity = workflowFunnel.map((s) => {
        const v = velocityByName.get(s.name);
        return {
          id: s.id,
          name: s.name,
          color: s.color,
          avgSeconds30d: v?.avg_secs_30d != null ? Number(v.avg_secs_30d) : null,
          avgSecondsPrev: v?.avg_secs_prev != null ? Number(v.avg_secs_prev) : null,
        };
      });

      return {
        project: { ...project, members },
        myItems,
        recentActivity,
        recentComments,
        workflowFunnel,
        teamUtilization,
        workflowVelocity,
      };
    });
  }
}

@Module({ controllers: [DashboardController] })
export class DashboardModule {}
