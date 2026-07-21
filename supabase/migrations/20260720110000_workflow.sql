-- The workflow engine's configuration: statuses, who may act on them, who is
-- assigned by default, and the rating criteria reviewers are prompted for.
--
-- This completes gate 3 of the four-gate permission model. Gate 4 (per-item
-- assignment) arrives with content items.
--
-- Observed from a real EasyContent Workflow screen, which corrected two of my
-- assumptions:
--   * Status colours are IDENTITY, not deadline state. Each status has its own
--     configured colour, and a content item's dot is simply its current
--     status's colour.
--   * The first and last statuses are PINNED — no drag handle — and the
--     terminal status has no reviewing roles at all, because nobody works on
--     an item that has come to rest.

-- Lets child tables carry org_id and prove it matches their project, rather
-- than trusting application code to keep them consistent.
alter table public.projects
  add constraint projects_id_org_unique unique (id, org_id);

alter table public.projects
  add column auto_complete_on_publish boolean not null default false;

comment on column public.projects.auto_complete_on_publish is
  'Move an item to the terminal status automatically once published to a CMS.';

-- Statuses -----------------------------------------------------------------
create table public.workflow_statuses (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  project_id    uuid not null,
  name          text not null,
  -- Status identity colour, shown as a dot beside the status and beside every
  -- content item currently in it.
  color         text not null default '#9CA3AF',
  -- Sparse steps so a status can be dragged between two others with a single
  -- update rather than renumbering the ladder.
  position      integer not null,
  -- First and last are pinned in the UI: an item must enter somewhere and
  -- come to rest somewhere.
  is_initial    boolean not null default false,
  is_terminal   boolean not null default false,
  -- Null means no automatic deadline. When set, entering this status stamps a
  -- due date this many days out.
  auto_due_days integer,
  -- Overrides everything: items here cannot be edited by anyone, whatever
  -- their permissions. Used to freeze content for client review or publishing.
  read_only     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint workflow_statuses_name_not_blank check (btrim(name) <> ''),
  constraint workflow_statuses_color_hex check (color ~* '^#[0-9a-f]{6}$'),
  constraint workflow_statuses_auto_due_positive
    check (auto_due_days is null or auto_due_days > 0),
  -- A status cannot be both the entry and the exit.
  constraint workflow_statuses_not_both_ends
    check (not (is_initial and is_terminal)),
  constraint workflow_statuses_name_unique_per_project unique (project_id, name),
  constraint workflow_statuses_position_unique_per_project unique (project_id, position),
  -- Guarantees the status and its project belong to the same org.
  constraint workflow_statuses_project_fk
    foreign key (project_id, org_id)
    references public.projects (id, org_id) on delete cascade
);

comment on table public.workflow_statuses is
  'The per-project status ladder. Each project has its own; they never propagate between projects.';
comment on column public.workflow_statuses.read_only is
  'Hard override: items in this status cannot be edited by any user, regardless of permissions.';

create index workflow_statuses_project_position_idx
  on public.workflow_statuses (project_id, position);

-- Exactly one entry and one exit per project.
create unique index workflow_statuses_one_initial
  on public.workflow_statuses (project_id) where is_initial;
create unique index workflow_statuses_one_terminal
  on public.workflow_statuses (project_id) where is_terminal;

create trigger workflow_statuses_set_updated_at
  before update on public.workflow_statuses
  for each row execute function public.set_updated_at();

-- Reviewing roles — GATE 3 --------------------------------------------------
-- Which ROLES (not users) may be assigned to or claim an item in this status.
-- This is how the same role behaves differently across projects: the role is
-- constant, but which statuses it can act on varies per project.
create table public.status_reviewing_roles (
  status_id uuid not null references public.workflow_statuses(id) on delete cascade,
  role_id   uuid not null references public.roles(id) on delete cascade,
  primary key (status_id, role_id)
);

comment on table public.status_reviewing_roles is
  'Gate 3: roles permitted to work on items in a given status. Empty means nobody — fails closed.';

create index status_reviewing_roles_role_idx on public.status_reviewing_roles (role_id);

-- A terminal status has no reviewing roles: nobody works on a finished item.
create or replace function public.status_reviewing_roles_reject_terminal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.workflow_statuses s
    where s.id = new.status_id and s.is_terminal
  ) then
    raise exception 'A terminal status cannot have reviewing roles';
  end if;
  return new;
end;
$$;

revoke execute on function public.status_reviewing_roles_reject_terminal()
  from public, anon, authenticated;

create trigger status_reviewing_roles_reject_terminal
  before insert or update on public.status_reviewing_roles
  for each row execute function public.status_reviewing_roles_reject_terminal();

-- Default assignees ---------------------------------------------------------
-- Applied automatically when an item enters this status. Overridable per item.
create table public.status_default_assignees (
  status_id  uuid not null references public.workflow_statuses(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (status_id, profile_id)
);

comment on table public.status_default_assignees is
  'Auto-applied assignees when an item enters this status. Per-item assignment overrides them.';

create index status_default_assignees_profile_idx
  on public.status_default_assignees (profile_id);

-- Ratings -------------------------------------------------------------------
-- Five-star criteria a reviewer is prompted for when approving from a given
-- status. Observed on a real account: three criteria on Editorial Review.
create table public.workflow_ratings (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  project_id  uuid not null,
  status_id   uuid not null references public.workflow_statuses(id) on delete cascade,
  name        text not null,
  description text,
  position    integer not null default 1024,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint workflow_ratings_name_not_blank check (btrim(name) <> ''),
  constraint workflow_ratings_project_fk
    foreign key (project_id, org_id)
    references public.projects (id, org_id) on delete cascade
);

comment on table public.workflow_ratings is
  'Five-star criteria reviewers are prompted for when approving from a status.';

create index workflow_ratings_status_position_idx
  on public.workflow_ratings (status_id, position);

create trigger workflow_ratings_set_updated_at
  before update on public.workflow_ratings
  for each row execute function public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Reading workflow configuration follows project visibility. Changing it
-- requires manage_workflow.

alter table public.workflow_statuses enable row level security;
alter table public.workflow_statuses force row level security;

create policy workflow_statuses_select
  on public.workflow_statuses for select to authenticated
  using (
    org_id = (select public.app_org_id())
    and (
      public.app_is_project_member(project_id)
      or (select public.app_has_permission('manage_projects'))
    )
  );

create policy workflow_statuses_write
  on public.workflow_statuses for all to authenticated
  using (
    org_id = (select public.app_org_id())
    and public.app_is_project_member(project_id)
    and (select public.app_has_permission('manage_workflow'))
  )
  with check (
    org_id = (select public.app_org_id())
    and public.app_is_project_member(project_id)
    and (select public.app_has_permission('manage_workflow'))
  );

alter table public.status_reviewing_roles enable row level security;
alter table public.status_reviewing_roles force row level security;

create policy status_reviewing_roles_select
  on public.status_reviewing_roles for select to authenticated
  using (
    exists (
      select 1 from public.workflow_statuses s
      where s.id = status_reviewing_roles.status_id
        and s.org_id = (select public.app_org_id())
        and (
          public.app_is_project_member(s.project_id)
          or (select public.app_has_permission('manage_projects'))
        )
    )
  );

create policy status_reviewing_roles_write
  on public.status_reviewing_roles for all to authenticated
  using (
    (select public.app_has_permission('manage_workflow'))
    and exists (
      select 1 from public.workflow_statuses s
      where s.id = status_reviewing_roles.status_id
        and s.org_id = (select public.app_org_id())
        and public.app_is_project_member(s.project_id)
    )
  )
  with check (
    (select public.app_has_permission('manage_workflow'))
    and exists (
      select 1 from public.workflow_statuses s
      where s.id = status_reviewing_roles.status_id
        and s.org_id = (select public.app_org_id())
        and public.app_is_project_member(s.project_id)
    )
  );

alter table public.status_default_assignees enable row level security;
alter table public.status_default_assignees force row level security;

create policy status_default_assignees_select
  on public.status_default_assignees for select to authenticated
  using (
    exists (
      select 1 from public.workflow_statuses s
      where s.id = status_default_assignees.status_id
        and s.org_id = (select public.app_org_id())
        and (
          public.app_is_project_member(s.project_id)
          or (select public.app_has_permission('manage_projects'))
        )
    )
  );

-- Assignment is governed by manage_people_and_deadlines, not manage_workflow:
-- configuring the ladder and staffing it are separate responsibilities.
create policy status_default_assignees_write
  on public.status_default_assignees for all to authenticated
  using (
    (select public.app_has_permission('manage_people_and_deadlines'))
    and exists (
      select 1 from public.workflow_statuses s
      where s.id = status_default_assignees.status_id
        and s.org_id = (select public.app_org_id())
        and public.app_is_project_member(s.project_id)
    )
  )
  with check (
    (select public.app_has_permission('manage_people_and_deadlines'))
    and exists (
      select 1 from public.workflow_statuses s
      where s.id = status_default_assignees.status_id
        and s.org_id = (select public.app_org_id())
        and public.app_is_project_member(s.project_id)
    )
  );

alter table public.workflow_ratings enable row level security;
alter table public.workflow_ratings force row level security;

create policy workflow_ratings_select
  on public.workflow_ratings for select to authenticated
  using (
    org_id = (select public.app_org_id())
    and (
      public.app_is_project_member(project_id)
      or (select public.app_has_permission('manage_projects'))
    )
  );

create policy workflow_ratings_write
  on public.workflow_ratings for all to authenticated
  using (
    org_id = (select public.app_org_id())
    and public.app_is_project_member(project_id)
    and (select public.app_has_permission('manage_workflow'))
  )
  with check (
    org_id = (select public.app_org_id())
    and public.app_is_project_member(project_id)
    and (select public.app_has_permission('manage_workflow'))
  );
