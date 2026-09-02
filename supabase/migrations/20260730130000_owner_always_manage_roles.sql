-- Owner always has manage_roles (EasyContent parity)
-- ------------------------------------------------------------------
-- EC: "the account owner will always have this privilege (manage roles)
-- regardless of their actual permissions." The API layer already guarantees
-- this (AuthGuard adds manage_roles for is_owner), but the DB function only
-- looked at the role's permissions — so an owner moved onto a role without
-- manage_roles would keep access at the API layer yet be blocked at the DB
-- (RLS) layer. Honor the owner flag here too, so the guarantee holds at every
-- layer. Only manage_roles is affected; every other permission is unchanged.

create or replace function public.app_has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (p_key = 'manage_roles' and (select public.app_is_owner()))
    or exists (
      select 1
      from public.profiles p
      join public.role_permissions rp on rp.role_id = p.role_id
      where p.id = (select auth.uid())
        and p.is_active
        and rp.permission_key = p_key
    );
$$;
