-- Same bug as 20260918120000_workflow_write_no_membership_gate.sql, in the
-- templates tables: templates_write, template_tabs_write, and
-- template_fields_write ANDed app_is_project_member(project_id) together
-- with app_has_permission('manage_templates'). Membership has no owner
-- bypass, so the account owner (or any manage_templates holder viewing a
-- project only via manage_projects, not membership) got a silent RLS
-- rejection creating/editing templates on such a project.
--
-- Fix: drop the membership requirement from all three write policies.
-- manage_templates is the sole gate, matching projects_update_manager and
-- the already-fixed workflow write policies.

drop policy templates_write on public.templates;
drop policy template_tabs_write on public.template_tabs;
drop policy template_fields_write on public.template_fields;

create policy templates_write
  on public.templates
  for all
  to authenticated
  using (
    org_id = (select public.app_org_id())
    and (select public.app_has_permission('manage_templates'))
  )
  with check (
    org_id = (select public.app_org_id())
    and (select public.app_has_permission('manage_templates'))
  );

create policy template_tabs_write
  on public.template_tabs
  for all
  to authenticated
  using (
    (select public.app_has_permission('manage_templates'))
    and exists (
      select 1 from public.templates t
      where t.id = template_tabs.template_id
        and t.org_id = (select public.app_org_id())
    )
  )
  with check (
    (select public.app_has_permission('manage_templates'))
    and exists (
      select 1 from public.templates t
      where t.id = template_tabs.template_id
        and t.org_id = (select public.app_org_id())
    )
  );

create policy template_fields_write
  on public.template_fields
  for all
  to authenticated
  using (
    (select public.app_has_permission('manage_templates'))
    and exists (
      select 1 from public.template_tabs tb
      join public.templates t on t.id = tb.template_id
      where tb.id = template_fields.tab_id
        and t.org_id = (select public.app_org_id())
    )
  )
  with check (
    (select public.app_has_permission('manage_templates'))
    and exists (
      select 1 from public.template_tabs tb
      join public.templates t on t.id = tb.template_id
      where tb.id = template_fields.tab_id
        and t.org_id = (select public.app_org_id())
    )
  );
