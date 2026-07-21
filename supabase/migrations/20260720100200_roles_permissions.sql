-- Roles and permissions.
--
-- Two things to know about this design:
--
-- 1. `permissions` is a GLOBAL catalogue — the fixed vocabulary of things a
--    role can be granted. It has no org_id because the list is identical for
--    every tenant. Only the *grants* (role_permissions) are per-org.
--
-- 2. Roles are ORG-GLOBAL. A user holds exactly one role across their whole
--    org and cannot hold a different role per project. Per-project variation
--    comes later, from binding a role to different workflow statuses in
--    different projects (see the workflow module in Phase 1).

-- Permission catalogue --------------------------------------------------
create table public.permissions (
  key         text primary key,
  group_name  text not null check (
                group_name in ('account', 'project', 'briefs', 'content', 'reports')),
  label       text not null,
  description text not null,
  position    integer not null,
  -- False while the feature this guards does not exist yet. The roles screen
  -- shows these disabled rather than offering a checkbox that does nothing.
  -- Flip to true in the migration that ships the feature.
  is_implemented boolean not null default true
);

comment on table public.permissions is
  'Global catalogue of grantable permissions. Reference data, identical for every org.';
comment on column public.permissions.is_implemented is
  'False when the guarded feature is not built yet. UI disables these.';

insert into public.permissions (key, group_name, label, description, position) values
  -- Account (5)
  ('manage_projects', 'account', 'Manage projects',
   'Create, edit, archive and delete projects. Grants METADATA-ONLY visibility of every project in the org — not their content, activity, messages or briefs.', 10),
  ('manage_users', 'account', 'Manage users',
   'Invite, edit, deactivate and remove users. Create and delete teams.', 20),
  ('manage_roles', 'account', 'Manage roles',
   'Create and edit roles and their permissions. Effectively admin: a holder can grant themselves anything.', 30),
  ('manage_integrations', 'account', 'Manage integrations',
   'Configure third-party integrations, API keys and webhooks.', 40),
  ('access_content_migration', 'account', 'Access content migration tool',
   'Import content in bulk from external sources.', 50),

  -- Project (7)
  ('manage_workflow', 'project', 'Manage workflow',
   'Add, edit, reorder and remove workflow statuses, and set their reviewing roles.', 60),
  ('manage_categories', 'project', 'Manage categories',
   'Create, edit and delete content categories within a project.', 70),
  ('manage_templates', 'project', 'Manage templates',
   'Create and edit templates, tabs and fields.', 80),
  ('manage_structures', 'project', 'Manage structures',
   'Add or remove fields on an individual content item using a custom structure.', 90),
  ('manage_asset_library', 'project', 'Manage asset library',
   'View, upload, download and delete files, and manage folders.', 100),
  ('manage_people_and_deadlines', 'project', 'Manage people and deadlines',
   'Assign people to workflow statuses and set due dates. The ONLY permission that grants assignment.', 110),
  ('manage_documentation', 'project', 'Manage documentation',
   'Create and edit project documentation and style guides.', 120),

  -- Briefs (2)
  ('view_briefs', 'briefs', 'View briefs',
   'See briefs and claim them.', 130),
  ('manage_briefs', 'briefs', 'Manage briefs',
   'Create, edit and delete briefs.', 140),

  -- Content (5)
  ('view_all_content_items', 'content', 'View all content items',
   'Read-only access to every content item in assigned projects. Also permits viewing, adding, replying to and resolving comments.', 150),
  ('manage_content_items', 'content', 'Manage content items',
   'Edit any item regardless of assignment or reviewing role, and change status manually. Does NOT grant assignment (see manage_people_and_deadlines) or custom-structure field editing (see manage_structures).', 160),
  ('publish_content', 'content', 'Publish content',
   'Publish an item to a connected CMS, regardless of its workflow status. Requires assignment to the active status unless paired with manage_content_items.', 170),
  ('share_content', 'content', 'Share content',
   'Create shareable links for external review. Requires assignment to the active status unless paired with manage_content_items.', 180),
  ('manage_comments', 'content', 'Manage comments',
   'Edit, delete, resolve and unresolve OTHER people''s comments. Everyone with view access can already manage their own.', 190),

  -- Reports (4)
  ('view_publishing_calendar', 'reports', 'View publishing calendar',
   'See the content calendar and its due dates.', 200),
  ('view_communication_report', 'reports', 'View communication report',
   'See all messages and comments across the entire org, INCLUDING projects the holder is not a member of. Ignores project scoping by design.', 210),
  ('view_account_report', 'reports', 'View account report',
   'Account-level analytics. Not yet implemented.', 220),
  ('view_content_report', 'reports', 'View content report',
   'Workflow status distribution and cumulative flow across the org.', 230);

-- Features not built yet. Kept in the catalogue so the vocabulary is settled,
-- but flagged so the roles screen does not offer checkboxes that do nothing.
update public.permissions
   set is_implemented = false
 where key in ('view_briefs', 'manage_briefs', 'view_account_report');

alter table public.permissions enable row level security;
alter table public.permissions force row level security;

-- Reference data: readable by any signed-in user, writable by nobody.
create policy permissions_select_all
  on public.permissions
  for select
  to authenticated
  using (true);

-- Roles -----------------------------------------------------------------
create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  description text,
  -- Inactive roles cannot be assigned. Used for the two roles that ship
  -- switched off (Content Manager, Subject Matter Expert).
  is_active   boolean not null default true,
  -- System roles cannot be deleted. Admin additionally cannot be edited,
  -- so that an org can never lose its ability to administer itself.
  is_system   boolean not null default false,
  is_editable boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint roles_name_not_blank check (btrim(name) <> ''),
  constraint roles_name_unique_per_org unique (org_id, name)
);

comment on table public.roles is
  'Org-global roles. A user holds exactly one; there is no per-project role.';

create index roles_org_id_idx on public.roles (org_id);

create trigger roles_set_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

alter table public.roles enable row level security;
alter table public.roles force row level security;

create policy roles_select_own_org
  on public.roles
  for select
  to authenticated
  using (org_id = (select public.app_org_id()));

-- Role grants ------------------------------------------------------------
create table public.role_permissions (
  role_id        uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

comment on table public.role_permissions is
  'Which permissions each role holds. The per-org half of the permission model.';

create index role_permissions_role_id_idx on public.role_permissions (role_id);

alter table public.role_permissions enable row level security;
alter table public.role_permissions force row level security;

-- Visible only through a role belonging to your org.
create policy role_permissions_select_own_org
  on public.role_permissions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.org_id = (select public.app_org_id())
    )
  );
