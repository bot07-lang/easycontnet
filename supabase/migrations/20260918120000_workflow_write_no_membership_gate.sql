-- Fix: manage_workflow holders (including the account owner) could not edit
-- workflow statuses, reviewing roles, or ratings on a project they can see
-- but are not a MEMBER of.
--
-- workflow_statuses_write / status_reviewing_roles_write / workflow_ratings_write
-- ANDed app_is_project_member(project_id) together with app_has_permission
-- ('manage_workflow'). That membership check has no owner bypass (unlike
-- app_has_permission, which does), so a project-manager or even the org
-- owner got a silent RLS rejection ("could not save ... you may not have
-- permission") on any project they administer without also being a member.
--
-- The comment directly above the original policies already said changing
-- workflow "requires manage_workflow" — membership was never meant to be a
-- second gate. It's also inconsistent with projects_update_manager
-- (20260720100400_projects.sql), which lets a manage_projects holder update
-- a project they aren't a member of, with no membership check at all.
--
-- Fix: drop the membership requirement from all three write policies.
-- manage_workflow (which the owner always has, per
-- 20260730140000_editable_admin_owner_superuser.sql) is the sole gate, same
-- as projects_update_manager.

drop policy workflow_statuses_write on public.workflow_statuses;
drop policy status_reviewing_roles_write on public.status_reviewing_roles;
drop policy workflow_ratings_write on public.workflow_ratings;

create policy workflow_statuses_write
  on public.workflow_statuses for all to authenticated
  using (
    org_id = (select public.app_org_id())
    and (select public.app_has_permission('manage_workflow'))
  )
  with check (
    org_id = (select public.app_org_id())
    and (select public.app_has_permission('manage_workflow'))
  );

create policy status_reviewing_roles_write
  on public.status_reviewing_roles for all to authenticated
  using (
    (select public.app_has_permission('manage_workflow'))
    and exists (
      select 1 from public.workflow_statuses s
      where s.id = status_reviewing_roles.status_id
        and s.org_id = (select public.app_org_id())
    )
  )
  with check (
    (select public.app_has_permission('manage_workflow'))
    and exists (
      select 1 from public.workflow_statuses s
      where s.id = status_reviewing_roles.status_id
        and s.org_id = (select public.app_org_id())
    )
  );

create policy workflow_ratings_write
  on public.workflow_ratings for all to authenticated
  using (
    org_id = (select public.app_org_id())
    and (select public.app_has_permission('manage_workflow'))
  )
  with check (
    org_id = (select public.app_org_id())
    and (select public.app_has_permission('manage_workflow'))
  );
