-- Make the seeding functions generic.
--
-- The previous versions hardcoded five role names, their permission lists,
-- four status names and their hex colours. Those are PRODUCT decisions that
-- will change, and baking them into SQL meant every tweak needed a migration.
--
-- They now live in packages/shared (DEFAULT_ROLES, DEFAULT_WORKFLOW) and are
-- passed in. What stays here is the part that genuinely belongs in the
-- database: doing the whole thing in ONE transaction, so an organization can
-- never exist half-built with no roles and nobody able to administer it.

drop function if exists public.create_organization(text, text, uuid, text);
drop function if exists public.seed_default_workflow(uuid);

-- create_organization ------------------------------------------------------
-- p_roles shape:
--   [{ name, description, position, isSystem, isEditable, isOwnerRole?,
--      permissions: [key, ...] }, ...]
create or replace function public.create_organization(
  p_slug          text,
  p_name          text,
  p_owner_user_id uuid,
  p_owner_name    text,
  p_roles         jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id        uuid;
  v_role          jsonb;
  v_role_id       uuid;
  v_owner_role_id uuid;
  v_unknown       text;
begin
  if jsonb_typeof(p_roles) <> 'array' or jsonb_array_length(p_roles) = 0 then
    raise exception 'p_roles must be a non-empty array';
  end if;

  -- Fail before creating anything if a permission key does not exist. The FK
  -- would catch it too, but the error would name a constraint rather than the
  -- offending key.
  select string_agg(distinct k, ', ') into v_unknown
  from jsonb_array_elements(p_roles) r,
       jsonb_array_elements_text(r -> 'permissions') k
  where k not in (select key from public.permissions);

  if v_unknown is not null then
    raise exception 'Unknown permission key(s): %', v_unknown;
  end if;

  if (select count(*) from jsonb_array_elements(p_roles) r
      where (r ->> 'isOwnerRole')::boolean) <> 1 then
    raise exception 'Exactly one role must be marked isOwnerRole';
  end if;

  insert into public.organizations (slug, name)
  values (p_slug, p_name)
  returning id into v_org_id;

  for v_role in select * from jsonb_array_elements(p_roles)
  loop
    insert into public.roles
      (org_id, name, description, position, is_system, is_editable)
    values (
      v_org_id,
      v_role ->> 'name',
      v_role ->> 'description',
      coalesce((v_role ->> 'position')::integer, 1024),
      coalesce((v_role ->> 'isSystem')::boolean, false),
      coalesce((v_role ->> 'isEditable')::boolean, true)
    )
    returning id into v_role_id;

    insert into public.role_permissions (role_id, permission_key)
    select v_role_id, k
    from jsonb_array_elements_text(v_role -> 'permissions') k;

    if coalesce((v_role ->> 'isOwnerRole')::boolean, false) then
      v_owner_role_id := v_role_id;
    end if;
  end loop;

  -- The owner: their role plus the ownership flag. Same person, two facts.
  insert into public.profiles (id, org_id, role_id, full_name, is_owner)
  values (p_owner_user_id, v_org_id, v_owner_role_id, p_owner_name, true);

  return v_org_id;
end;
$$;

comment on function public.create_organization is
  'Creates a tenant, its roles and its owner in one transaction. Role definitions are supplied by the caller (packages/shared DEFAULT_ROLES). Service role only.';

revoke execute on function public.create_organization(text, text, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_organization(text, text, uuid, text, jsonb)
  to service_role;

-- seed_project_workflow ----------------------------------------------------
-- p_statuses shape:
--   [{ name, color, position, isInitial?, isTerminal?, autoDueDays?,
--      readOnly?, reviewingRoles: [roleName, ...] }, ...]
--
-- Reviewing roles arrive as NAMES and are resolved to ids here, so the caller
-- stays readable and does not need to know the org's role ids.
create or replace function public.seed_project_workflow(
  p_project_id uuid,
  p_statuses   jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id    uuid;
  v_status    jsonb;
  v_status_id uuid;
  v_missing   text;
begin
  select org_id into v_org_id from public.projects where id = p_project_id;
  if v_org_id is null then
    raise exception 'Project % does not exist', p_project_id;
  end if;

  if jsonb_typeof(p_statuses) <> 'array' or jsonb_array_length(p_statuses) = 0 then
    raise exception 'p_statuses must be a non-empty array';
  end if;

  -- Catch a misspelled role name before creating anything. Silently skipping
  -- it would leave a status nobody can be assigned to, which looks like the
  -- workflow is broken rather than misconfigured.
  select string_agg(distinct n, ', ') into v_missing
  from jsonb_array_elements(p_statuses) s,
       jsonb_array_elements_text(s -> 'reviewingRoles') n
  where n not in (select name from public.roles where org_id = v_org_id);

  if v_missing is not null then
    raise exception 'Unknown role name(s) for this organization: %', v_missing;
  end if;

  for v_status in select * from jsonb_array_elements(p_statuses)
  loop
    insert into public.workflow_statuses
      (org_id, project_id, name, color, position,
       is_initial, is_terminal, auto_due_days, read_only)
    values (
      v_org_id,
      p_project_id,
      v_status ->> 'name',
      coalesce(v_status ->> 'color', '#9ca3af'),
      (v_status ->> 'position')::integer,
      coalesce((v_status ->> 'isInitial')::boolean, false),
      coalesce((v_status ->> 'isTerminal')::boolean, false),
      nullif(v_status ->> 'autoDueDays', '')::integer,
      coalesce((v_status ->> 'readOnly')::boolean, false)
    )
    returning id into v_status_id;

    insert into public.status_reviewing_roles (status_id, role_id)
    select v_status_id, r.id
    from jsonb_array_elements_text(v_status -> 'reviewingRoles') n
    join public.roles r on r.name = n and r.org_id = v_org_id;
  end loop;
end;
$$;

comment on function public.seed_project_workflow is
  'Gives a project a workflow ladder from caller-supplied definitions (packages/shared DEFAULT_WORKFLOW). Service role only.';

revoke execute on function public.seed_project_workflow(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.seed_project_workflow(uuid, jsonb)
  to service_role;
