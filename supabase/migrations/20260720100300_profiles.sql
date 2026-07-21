-- Profiles: our app's user record, one per Supabase auth user.
--
-- Supabase owns authentication (auth.users). This table owns everything the
-- app needs to know: which org they belong to, what role they hold, and
-- whether they own the org.
--
-- `role_id` is NOT NULL because a user holds exactly one role, always. There
-- is deliberately no per-project role — per-project variation comes from
-- binding roles to workflow statuses (Phase 1).

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  -- restrict, not cascade: deleting a role that people still hold should fail
  -- loudly rather than silently orphan them.
  role_id     uuid not null references public.roles(id) on delete restrict,
  full_name   text not null,
  -- Owner is an account flag, not a role. The owner always retains role
  -- management so an org can never lock itself out of its own administration.
  is_owner    boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint profiles_full_name_not_blank check (btrim(full_name) <> '')
);

comment on table public.profiles is
  'App user record extending auth.users. One role, one org, per user.';
comment on column public.profiles.is_owner is
  'Account flag, not a role. Exactly one per org. Cannot be deactivated.';

create index profiles_org_id_idx on public.profiles (org_id);
create index profiles_role_id_idx on public.profiles (role_id);

-- Exactly one owner per org, enforced by the database rather than by hope.
create unique index profiles_one_owner_per_org
  on public.profiles (org_id)
  where is_owner;

-- The owner cannot be deactivated — that would orphan the org's administration.
alter table public.profiles
  add constraint profiles_owner_must_be_active
  check (not is_owner or is_active);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- RLS ----------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

-- You can see everyone in your own org (needed for assignee pickers,
-- comment authorship, and the team screen) and nobody outside it.
create policy profiles_select_own_org
  on public.profiles
  for select
  to authenticated
  using (org_id = (select public.app_org_id()));

-- You may edit your own display name. Everything that matters — role,
-- org, owner flag, active flag — is changed by the API through the service
-- role after a permission check, never directly by the user.
create policy profiles_update_self
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Privilege guard: block self-escalation through the policy above.
-- Without this, a user could update their own row to change role_id,
-- is_owner, is_active or org_id. The policy permits the row; this trigger
-- constrains which columns may actually move.
create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The service role (used by the API after its own permission checks) and
  -- superuser are exempt; everyone else is held to display-name changes.
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;

  if new.role_id  is distinct from old.role_id
     or new.org_id   is distinct from old.org_id
     or new.is_owner is distinct from old.is_owner
     or new.is_active is distinct from old.is_active
     or new.id       is distinct from old.id then
    raise exception 'Privileged profile columns cannot be changed directly';
  end if;

  return new;
end;
$$;

revoke execute on function public.profiles_guard_privileged_columns() from public, authenticated;

create trigger profiles_guard_privileged_columns
  before update on public.profiles
  for each row execute function public.profiles_guard_privileged_columns();
