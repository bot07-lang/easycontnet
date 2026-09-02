-- Editable Admin role + owner super-user (EasyContent parity)
-- ------------------------------------------------------------------
-- EC leaves the Admin role's permissions EDITABLE (an admin can uncheck any of
-- them, which — since permissions are per-role — affects every admin). What
-- makes that safe is the account owner, who can never be locked out. We now:
--   1. make the Admin role editable, and
--   2. make the owner a true super-user: the is_owner flag grants ALL
--      permissions (not just manage_roles), so the owner always has everything
--      and can never be limited or locked out — even if the Admin role is
--      stripped. This supersedes the earlier manage_roles-only owner guarantee.
-- (A code-level guardrail additionally blocks removing manage_roles from the
--  LAST role that has it, to avoid an accidental all-admin lockout.)

-- 1. Admin role editable (existing orgs).
update public.roles set is_editable = true
where is_system and name = 'Admin' and is_editable = false;

-- 2. Owner has every permission.
create or replace function public.app_has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select public.app_is_owner())
    or exists (
      select 1
      from public.profiles p
      join public.role_permissions rp on rp.role_id = p.role_id
      where p.id = (select auth.uid())
        and p.is_active
        and rp.permission_key = p_key
    );
$$;
