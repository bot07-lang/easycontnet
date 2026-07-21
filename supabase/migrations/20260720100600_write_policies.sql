-- Write policies.
--
-- Until now every table had only SELECT policies. With RLS forced and no
-- policy for an operation, Postgres denies it — so writes were failing closed,
-- which is safe but non-functional. This migration says who may write what.
--
-- The rules live here, in the database, rather than in the API. An API bug
-- then cannot produce a breach: the database refuses the write regardless of
-- what asked for it.
--
-- Note on recursion: the policy helpers are SECURITY DEFINER, so they read
-- profiles/role_permissions with RLS bypassed. Without that, a policy on
-- profiles that calls a function which reads profiles would recurse.

-- roles --------------------------------------------------------------------
create policy roles_insert
  on public.roles
  for insert
  to authenticated
  with check (
    org_id = (select public.app_org_id())
    and (select public.app_has_permission('manage_roles'))
    -- New roles are never system roles; only the seed creates those.
    and not is_system
  );

-- is_editable is what protects Admin. A holder of manage_roles can edit any
-- role EXCEPT one marked uneditable — so an org cannot break its own
-- administration by stripping permissions off Admin.
create policy roles_update
  on public.roles
  for update
  to authenticated
  using (
    org_id = (select public.app_org_id())
    and (select public.app_has_permission('manage_roles'))
    and is_editable
  )
  with check (
    org_id = (select public.app_org_id())
    -- Cannot promote a role into a protected one, nor demote out of it.
    and is_editable
  );

create policy roles_delete
  on public.roles
  for delete
  to authenticated
  using (
    org_id = (select public.app_org_id())
    and (select public.app_has_permission('manage_roles'))
    and not is_system
  );

-- role_permissions ---------------------------------------------------------
-- Granting and revoking permissions is a write to THIS table, not to roles.
-- Without these checks, Admin would look protected while its permissions
-- could still be stripped one row at a time.
create policy role_permissions_insert
  on public.role_permissions
  for insert
  to authenticated
  with check (
    (select public.app_has_permission('manage_roles'))
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.org_id = (select public.app_org_id())
        and r.is_editable
    )
  );

create policy role_permissions_delete
  on public.role_permissions
  for delete
  to authenticated
  using (
    (select public.app_has_permission('manage_roles'))
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.org_id = (select public.app_org_id())
        and r.is_editable
    )
  );

-- profiles -----------------------------------------------------------------
create policy profiles_insert
  on public.profiles
  for insert
  to authenticated
  with check (
    org_id = (select public.app_org_id())
    and (select public.app_has_permission('manage_users'))
    -- Ownership is conferred only by the service role, never by a request.
    and not is_owner
  );

create policy profiles_update_admin
  on public.profiles
  for update
  to authenticated
  using (
    org_id = (select public.app_org_id())
    and (select public.app_has_permission('manage_users'))
  )
  with check (org_id = (select public.app_org_id()));

create policy profiles_delete
  on public.profiles
  for delete
  to authenticated
  using (
    org_id = (select public.app_org_id())
    and (select public.app_has_permission('manage_users'))
    -- The owner cannot be deleted. Transfer ownership first.
    and not is_owner
  );

-- Column-level guard.
--
-- RLS grants access to a ROW; it cannot say which COLUMNS may change. Two
-- policies now permit updates to profiles — your own row, or any row if you
-- hold manage_users — so this trigger decides what each may actually alter.
--
-- Replaces the earlier version, which allowed privileged changes only to the
-- service role and would therefore have blocked legitimate admins.
create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean;
begin
  -- The service role performs system operations (org creation, ownership
  -- transfer) after its own checks.
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;

  -- Ownership never moves through an ordinary request.
  if new.is_owner is distinct from old.is_owner then
    raise exception 'Ownership can only be transferred by the system';
  end if;

  -- Nobody changes which org a profile belongs to, or its identity.
  if new.org_id is distinct from old.org_id
     or new.id is distinct from old.id then
    raise exception 'Profile identity and organization are immutable';
  end if;

  v_is_admin := public.app_has_permission('manage_users');

  -- Without manage_users you may edit your own display name and nothing else.
  if not v_is_admin then
    if new.role_id is distinct from old.role_id
       or new.is_active is distinct from old.is_active then
      raise exception 'Only users with manage_users can change roles or activation';
    end if;
    return new;
  end if;

  -- Admins may change role and activation, but the new role must belong to
  -- the same org — otherwise a user could be handed another tenant's role.
  if new.role_id is distinct from old.role_id then
    if not exists (
      select 1 from public.roles r
      where r.id = new.role_id
        and r.org_id = new.org_id
        and r.is_active
    ) then
      raise exception 'Role must be active and belong to the same organization';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.profiles_guard_privileged_columns()
  from public, anon, authenticated;

-- Same org check on insert, which the trigger above does not cover.
create or replace function public.profiles_validate_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.roles r
    where r.id = new.role_id
      and r.org_id = new.org_id
  ) then
    raise exception 'Role must belong to the same organization as the profile';
  end if;
  return new;
end;
$$;

revoke execute on function public.profiles_validate_insert()
  from public, anon, authenticated;

create trigger profiles_validate_insert
  before insert on public.profiles
  for each row execute function public.profiles_validate_insert();

-- projects -----------------------------------------------------------------
create policy projects_insert
  on public.projects
  for insert
  to authenticated
  with check (
    org_id = (select public.app_org_id())
    and (select public.app_has_permission('manage_projects'))
  );

-- Deletion is irreversible and separate from archiving, which is an UPDATE
-- of archived_at and covered by the existing update policy.
create policy projects_delete
  on public.projects
  for delete
  to authenticated
  using (
    org_id = (select public.app_org_id())
    and (select public.app_has_permission('manage_projects'))
  );

-- project_members ----------------------------------------------------------
create policy project_members_insert
  on public.project_members
  for insert
  to authenticated
  with check (
    (select public.app_has_permission('manage_projects'))
    and exists (
      select 1 from public.projects p
      where p.id = project_members.project_id
        and p.org_id = (select public.app_org_id())
    )
    -- The person being added must be in the same org.
    and exists (
      select 1 from public.profiles pr
      where pr.id = project_members.profile_id
        and pr.org_id = (select public.app_org_id())
    )
  );

create policy project_members_delete
  on public.project_members
  for delete
  to authenticated
  using (
    (select public.app_has_permission('manage_projects'))
    and exists (
      select 1 from public.projects p
      where p.id = project_members.project_id
        and p.org_id = (select public.app_org_id())
    )
  );

-- organizations ------------------------------------------------------------
-- Deliberately no INSERT or DELETE policy. Creating and destroying tenants is
-- a system operation performed by the API through the service role; a user
-- request must never be able to do either.
