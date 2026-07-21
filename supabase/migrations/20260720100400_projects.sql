-- Projects and their membership.
--
-- Projects are numbered PER ORG: every org's first project is 1. The number is
-- what appears in URLs (app.com/brightrays/projects/1) so people can say
-- "open project 3" out loud — the uuid stays internal.
--
-- Note how `manage_projects` works below: it grants visibility of every project
-- row in the org, but project *content* (Phase 1 tables) will require actual
-- membership. That reproduces the documented "administrative access is not
-- content access" behaviour without special-casing — the projects row IS the
-- metadata.

-- Per-org counter for project numbering.
alter table public.organizations
  add column next_project_number integer not null default 1;

comment on column public.organizations.next_project_number is
  'Counter for per-org project numbering. Incremented under a row lock on insert.';

-- Does the current user's role grant this permission?
-- STABLE so Postgres evaluates it once per query rather than once per row.
-- SECURITY DEFINER so it can read roles/role_permissions without those tables
-- needing policies that would recurse back into this function.
create or replace function public.app_has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id
    where p.id = (select auth.uid())
      and p.is_active
      and rp.permission_key = p_key
  );
$$;

comment on function public.app_has_permission is
  'Whether the caller''s role grants the given permission key. Fails closed.';

revoke execute on function public.app_has_permission(text) from public;
grant execute on function public.app_has_permission(text) to authenticated;

-- Projects ---------------------------------------------------------------
create table public.projects (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  -- Assigned by trigger. Human-facing identifier, unique within the org.
  project_number integer not null,
  name           text not null,
  description    text,
  -- Archive is reversible and keeps all data. Deletion is a separate,
  -- irreversible action performed through the API.
  archived_at    timestamptz,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint projects_name_not_blank check (btrim(name) <> ''),
  constraint projects_number_positive check (project_number > 0),
  -- Belt and braces behind the row lock: if two inserts ever raced past the
  -- counter, this makes the second one fail loudly instead of duplicating.
  constraint projects_number_unique_per_org unique (org_id, project_number)
);

comment on table public.projects is
  'Projects are rows scoped to an org. Archiving sets archived_at; it does not delete.';
comment on column public.projects.project_number is
  'Per-org sequential number shown in URLs. Never reused, even after deletion.';

create index projects_org_id_idx on public.projects (org_id);
create index projects_active_idx on public.projects (org_id) where archived_at is null;

-- Assign the next per-org project number.
-- The UPDATE takes a row lock on the org, so concurrent inserts for the same
-- org serialise here rather than racing for the same number.
create or replace function public.projects_assign_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.organizations
     set next_project_number = next_project_number + 1
   where id = new.org_id
  returning next_project_number - 1 into new.project_number;

  if new.project_number is null then
    raise exception 'Organization % does not exist', new.org_id;
  end if;

  return new;
end;
$$;

revoke execute on function public.projects_assign_number() from public, authenticated;

create trigger projects_assign_number
  before insert on public.projects
  for each row execute function public.projects_assign_number();

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- Membership -------------------------------------------------------------
create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  added_at   timestamptz not null default now(),
  added_by   uuid references public.profiles(id) on delete set null,
  primary key (project_id, profile_id)
);

comment on table public.project_members is
  'Gate 1 of the permission model: membership. Without a row here, no content access.';

create index project_members_profile_id_idx on public.project_members (profile_id);

-- Is the caller a member of this project?
-- SECURITY DEFINER to avoid projects <-> project_members policy recursion.
create or replace function public.app_is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.profile_id = (select auth.uid())
  );
$$;

revoke execute on function public.app_is_project_member(uuid) from public;
grant execute on function public.app_is_project_member(uuid) to authenticated;

-- RLS ----------------------------------------------------------------------
alter table public.projects enable row level security;
alter table public.projects force row level security;

-- Two ways to see a project row:
--   1. you are a member of it, or
--   2. you hold manage_projects (metadata-only visibility across the org).
-- Both are additionally walled to your own org.
create policy projects_select_member_or_manager
  on public.projects
  for select
  to authenticated
  using (
    org_id = (select public.app_org_id())
    and (
      public.app_is_project_member(id)
      or (select public.app_has_permission('manage_projects'))
    )
  );

create policy projects_update_manager
  on public.projects
  for update
  to authenticated
  using (
    org_id = (select public.app_org_id())
    and (select public.app_has_permission('manage_projects'))
  )
  with check (org_id = (select public.app_org_id()));

alter table public.project_members enable row level security;
alter table public.project_members force row level security;

-- You can see the membership of projects you can see.
create policy project_members_select_visible
  on public.project_members
  for select
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_members.project_id
        and p.org_id = (select public.app_org_id())
        and (
          public.app_is_project_member(p.id)
          or (select public.app_has_permission('manage_projects'))
        )
    )
  );
