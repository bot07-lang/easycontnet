-- Replace a project's member list (the Project Settings "Assigned users"
-- checklist). project_members has a SELECT policy only — direct
-- insert/delete from the authenticated role has never been allowed, matching
-- api_create_project's own pattern of writing membership through a
-- SECURITY DEFINER function rather than table-level RLS.
create or replace function public.api_set_project_members(
  p_project_id uuid,
  p_profile_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.app_org_id();
  v_uid uuid := auth.uid();
begin
  if v_org is null or v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.app_has_permission('manage_projects') then
    raise exception 'Requires the manage_projects permission' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) then
    raise exception 'Project not found';
  end if;

  delete from public.project_members
   where project_id = p_project_id
     and profile_id <> all (coalesce(p_profile_ids, array[]::uuid[]));

  insert into public.project_members (project_id, profile_id, added_by)
  select p_project_id, pr.id, v_uid
    from unnest(coalesce(p_profile_ids, array[]::uuid[])) as pid(id)
    join public.profiles pr on pr.id = pid.id and pr.org_id = v_org
  on conflict do nothing;
end;
$$;

revoke execute on function public.api_set_project_members(uuid, uuid[]) from public, anon;
grant execute on function public.api_set_project_members(uuid, uuid[]) to authenticated;
