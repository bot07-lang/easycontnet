-- Close a race in api_create_content_item's default-template creation.
--
-- For a brand-new project (no templates yet), a "create item" call with no
-- explicit template auto-creates a default one. Two such calls arriving
-- close together — realistically the first two items ever created in a
-- project — can both see no template exists yet and both attempt to INSERT
-- one with is_default = true.
--
-- templates_one_default_per_project (a unique index on (project_id) where
-- is_default) means this was never a silent duplicate — the second INSERT
-- would raise a raw "duplicate key value violates unique constraint" error
-- straight at the caller, failing their item creation outright instead of
-- succeeding with the template the first call created.
--
-- `select ... for update` on the project row serializes concurrent calls
-- for the SAME project through the default-template lookup-or-create
-- sequence: the second call blocks until the first commits, then its own
-- lookup finds the template the first call just created instead of racing
-- to insert a second one. Calls that pass an explicit p_template_id skip
-- this entirely — only the auto-detect path has anything to serialize.
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
  if not public.app_is_project_member(p_project_id) then
    raise exception 'Not a member of this project' using errcode = '42501';
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
