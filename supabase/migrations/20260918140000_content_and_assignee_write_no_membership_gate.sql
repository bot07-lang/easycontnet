-- Same bug as 20260918120000 (workflow) and 20260918130000 (templates),
-- swept across the rest of the schema. Each of these ANDs
-- app_is_project_member(...) with a manage_* permission on a WRITE path,
-- while the matching SELECT policy for the same table allows
-- app_has_permission('manage_projects') as an alternative to membership.
-- That asymmetry silently blocked a manage_* holder — including the account
-- owner, who should never be locked out — from writing to a project they
-- can see but aren't a member of.
--
-- Fixed here, same approach as before (permission alone is the gate,
-- matching projects_update_manager):
--   1. status_default_assignees_write   (manage_people_and_deadlines)
--   2. content_items_insert             (manage_content_items)
--   3. content_items_delete             (manage_content_items)
--   4. item_status_assignees_write      (manage_people_and_deadlines)
--   5. app_can_edit_item()              (manage_content_items) — gates
--      content_field_values_write; editing a content item's field values
--   6. api_create_content_item()        (manage_content_items) — the "New
--      item" RPC had its own explicit membership check duplicating the RLS
--
-- NOT touched (checked and found to be consistent, not buggy): item_reviews,
-- item_review_ratings, comments, item_status_completions, and
-- item_status_due_dates all gate SELECT on pure membership too (no
-- manage_projects escape hatch), so requiring membership on their writes is
-- symmetric by design — those are participant actions, not org-wide
-- management actions.

-- 1. status_default_assignees_write ------------------------------------------
drop policy status_default_assignees_write on public.status_default_assignees;

create policy status_default_assignees_write
  on public.status_default_assignees for all to authenticated
  using (
    (select public.app_has_permission('manage_people_and_deadlines'))
    and exists (
      select 1 from public.workflow_statuses s
      where s.id = status_default_assignees.status_id
        and s.org_id = (select public.app_org_id())
    )
  )
  with check (
    (select public.app_has_permission('manage_people_and_deadlines'))
    and exists (
      select 1 from public.workflow_statuses s
      where s.id = status_default_assignees.status_id
        and s.org_id = (select public.app_org_id())
    )
  );

-- 2 & 3. content_items_insert / content_items_delete --------------------------
drop policy content_items_insert on public.content_items;
drop policy content_items_delete on public.content_items;

create policy content_items_insert
  on public.content_items
  for insert
  to authenticated
  with check (
    org_id = (select public.app_org_id())
    and (select public.app_has_permission('manage_content_items'))
  );

create policy content_items_delete
  on public.content_items
  for delete
  to authenticated
  using (
    org_id = (select public.app_org_id())
    and (select public.app_has_permission('manage_content_items'))
  );

-- 4. item_status_assignees_write ----------------------------------------------
drop policy item_status_assignees_write on public.item_status_assignees;

create policy item_status_assignees_write
  on public.item_status_assignees
  for all
  to authenticated
  using (
    (select public.app_has_permission('manage_people_and_deadlines'))
    and exists (
      select 1 from public.content_items ci
      where ci.id = item_status_assignees.item_id
        and ci.org_id = (select public.app_org_id())
    )
  )
  with check (
    (select public.app_has_permission('manage_people_and_deadlines'))
    and exists (
      select 1 from public.content_items ci
      where ci.id = item_status_assignees.item_id
        and ci.org_id = (select public.app_org_id())
    )
  );

-- 5. app_can_edit_item() -------------------------------------------------------
-- Drop the hard membership requirement; manage_content_items or being the
-- item's assigned reviewer is still required, same as before. (An assignee
-- is, in practice, always a project member — assignment is picked from
-- project members — so this only changes behaviour for the
-- manage_content_items branch.)
create or replace function public.app_can_edit_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.content_items ci
    left join public.workflow_statuses s on s.id = ci.current_status_id
    where ci.id = p_item_id
      and ci.org_id = (select public.app_org_id())
      and coalesce(s.read_only, false) = false
      and (
        (select public.app_has_permission('manage_content_items'))
        or exists (
          select 1 from public.item_status_assignees a
          where a.item_id = ci.id
            and a.status_id = ci.current_status_id
            and a.profile_id = (select auth.uid())
        )
      )
  );
$$;

-- 6. api_create_content_item() -------------------------------------------------
-- Drop the function's own explicit membership check (duplicated the RLS
-- flaw in code). manage_content_items alone is the gate, matching #2 above.
create or replace function public.api_create_content_item(
  p_project_id uuid,
  p_name text,
  p_template_id uuid default null,
  p_description text default null,
  p_keywords text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.app_org_id();
  v_uid uuid := auth.uid();
  v_tpl uuid;
  v_tab uuid;
  v_status uuid;
  v_item uuid;
begin
  if v_org is null or v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.app_has_permission('manage_content_items') then
    raise exception 'Requires the manage_content_items permission' using errcode = '42501';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Item name is required';
  end if;

  if p_template_id is not null then
    select id into v_tpl from public.templates
    where id = p_template_id and project_id = p_project_id;
    if v_tpl is null then
      raise exception 'Template not found in this project';
    end if;
  end if;

  if v_tpl is null then
    -- Lock the project row for the rest of this lookup-or-create sequence.
    perform 1 from public.projects where id = p_project_id for update;

    select id into v_tpl from public.templates
    where project_id = p_project_id and is_default limit 1;
  end if;
  if v_tpl is null then
    select id into v_tpl from public.templates where project_id = p_project_id limit 1;
  end if;
  if v_tpl is null then
    insert into public.templates (org_id, project_id, name, is_default)
    values (v_org, p_project_id, 'Article', true)
    returning id into v_tpl;

    insert into public.template_tabs (org_id, template_id, name, position, is_system)
    values (v_org, v_tpl, 'Main Content', 1024, true)
    returning id into v_tab;

    insert into public.template_fields
      (org_id, tab_id, field_type, label, position, is_system, is_required,
       guidelines, recommended_length, recommended_length_units)
    values (v_org, v_tab, 'single_line_text', 'Title', 1024, true, true,
            'Enter a descriptive title.', 60, 'characters');
    insert into public.template_fields
      (org_id, tab_id, field_type, label, position, is_system, is_required, guidelines)
    values (v_org, v_tab, 'paragraph_text', 'Content', 2048, true, true,
            'Write the body of the content.');
  end if;

  select id into v_status from public.workflow_statuses
  where project_id = p_project_id and is_initial;

  insert into public.content_items (org_id, project_id, name, template_id,
                                    current_status_id, created_by, description, keywords)
  values (v_org, p_project_id, p_name, v_tpl, v_status, v_uid,
          nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_keywords, '{}'))
  returning id into v_item;

  return v_item;
end;
$$;
