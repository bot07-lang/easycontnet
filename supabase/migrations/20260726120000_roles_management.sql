-- Roles & Permissions management (the "Team → Roles" screen).
--
-- Reads were already permitted (own-org select on roles + role_permissions).
-- This migration adds:
--   1. A `position` column on roles so the list is drag-reorderable.
--   2. Write RLS policies on roles + role_permissions, gated by the
--      `manage_roles` permission within the caller's org.
--
-- System-role protections (Admin is not editable; system roles cannot be
-- deleted) are enforced in the API service on top of this permission gate.

-- 1. Ordering for the roles list ------------------------------------------
alter table public.roles add column if not exists position integer;

-- Backfill: system roles first (Admin pinned top, Writer near the end by name),
-- then the rest by creation order. Sparse steps so a role can be dragged between
-- two others in a single update.
with ordered as (
  select id, row_number() over (order by is_system desc, created_at, name) * 1024 as pos
  from public.roles
)
update public.roles r set position = o.pos from ordered o
where o.id = r.id and r.position is null;

create index if not exists roles_org_position_idx on public.roles (org_id, position);

-- 2. Write access for manage_roles holders --------------------------------
create policy roles_write
  on public.roles for all to authenticated
  using (
    org_id = (select public.app_org_id())
    and (select public.app_has_permission('manage_roles'))
  )
  with check (
    org_id = (select public.app_org_id())
    and (select public.app_has_permission('manage_roles'))
  );

create policy role_permissions_write
  on public.role_permissions for all to authenticated
  using (
    (select public.app_has_permission('manage_roles'))
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.org_id = (select public.app_org_id())
    )
  )
  with check (
    (select public.app_has_permission('manage_roles'))
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.org_id = (select public.app_org_id())
    )
  );
