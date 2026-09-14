-- Backfill: content items, templates, and everything between them.
-- ------------------------------------------------------------------
-- These tables (content_items, content_field_values, templates,
-- template_tabs, template_fields, item_status_assignees) — plus
-- projects.next_item_number, and the functions app_can_edit_item,
-- content_items_assign_number, api_create_project and
-- api_duplicate_project — were created out-of-band (dashboard or a
-- squashed/deleted migration) rather than through tracked history, even
-- though they've been live and in active use since early on. This migration
-- exists so the database can be rebuilt from this repo, and so the RLS rules
-- gating every read/write of an item's fields — the single most
-- security-relevant policy in the app — can be reviewed and diffed from
-- source.
--
-- It reconstructs the ORIGINAL (not today's) shape of anything a LATER
-- tracked migration already alters, so replaying migration history in order
-- on an empty database reaches the exact same end state production has
-- today:
--   * content_items — created WITHOUT description/keywords; those are
--     added by the already-tracked 20260721090000_content_item_brief_fields.sql.
--   * templates — created WITHOUT description; added by the already-tracked
--     20260725120000_template_description.sql.
--   * content_items_select / content_field_values_select — created with
--     their ORIGINAL "project member or manage_projects" USING clause; the
--     already-tracked 20260730110000_item_visibility.sql replaces it with
--     app_can_view_item() via ALTER POLICY, which requires the policy to
--     already exist.
--   * content_items has no auto-due trigger yet here — tg_apply_auto_due()
--     isn't defined until 20260729140000_item_status_due_dates.sql. A
--     follow-up migration (20260729150000) adds that trigger at the point
--     in history where the function actually exists.
--
-- Four other live functions (api_get_item, api_list_items, api_list_projects,
-- api_save_field) are ALSO undocumented but are dead code — nothing in the
-- app calls them anymore — so they're deliberately left out of this backfill.

-- Item numbering needs a per-project counter, the same pattern
-- organizations.next_project_number already uses for projects themselves.
alter table public.projects
  add column next_item_number integer not null default 1;

comment on column public.projects.next_item_number is
  'Counter for per-project content-item numbering. Incremented under a row lock on insert.';

-- Also part of the same undocumented gap: content_items and
-- item_status_assignees below both need a composite FK to
-- (workflow_statuses.id, org_id) — the same pattern projects/templates
-- already use — but workflow.sql never added the unique constraint it
-- requires.
alter table public.workflow_statuses
  add constraint workflow_statuses_id_org_unique unique (id, org_id);

-- Templates -----------------------------------------------------------------
create table public.templates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  project_id  uuid not null,
  name        text not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint templates_name_not_blank check (btrim(name) <> ''),
  constraint templates_project_fk foreign key (project_id, org_id)
    references public.projects (id, org_id) on delete cascade,
  -- (id, org_id) is referenced by content_items' own (id, org_id) FK below —
  -- every cross-table FK in this schema pins org_id alongside the row id so
  -- a policy never needs a join just to confirm the org matches.
  constraint templates_id_org_unique unique (id, org_id),
  constraint templates_name_unique_per_project unique (project_id, name)
);

comment on table public.templates is
  'A content template: the shape (tabs + fields) new items of this kind start from.';

create index templates_project_idx on public.templates (project_id);
-- At most one default template per project.
create unique index templates_one_default_per_project
  on public.templates (project_id) where is_default;

create trigger templates_set_updated_at
  before update on public.templates
  for each row execute function public.set_updated_at();

alter table public.templates enable row level security;
alter table public.templates force row level security;

create policy templates_select
  on public.templates
  for select
  to authenticated
  using (
    org_id = (select public.app_org_id())
    and (
      public.app_is_project_member(project_id)
      or (select public.app_has_permission('manage_projects'))
    )
  );

create policy templates_write
  on public.templates
  for all
  to authenticated
  using (
    org_id = (select public.app_org_id())
    and public.app_is_project_member(project_id)
    and (select public.app_has_permission('manage_templates'))
  )
  with check (
    org_id = (select public.app_org_id())
    and public.app_is_project_member(project_id)
    and (select public.app_has_permission('manage_templates'))
  );

-- Template tabs ---------------------------------------------------------
create table public.template_tabs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  template_id uuid not null,
  name        text not null,
  position    integer not null,
  is_system   boolean not null default false,
  is_hidden   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint template_tabs_name_not_blank check (btrim(name) <> ''),
  constraint template_tabs_template_fk foreign key (template_id, org_id)
    references public.templates (id, org_id) on delete cascade,
  constraint template_tabs_id_org_unique unique (id, org_id),
  constraint template_tabs_position_unique unique (template_id, position)
);

comment on table public.template_tabs is
  'A named group of fields within a template — matching content items render one section per tab.';

create index template_tabs_template_idx on public.template_tabs (template_id, position);

create trigger template_tabs_set_updated_at
  before update on public.template_tabs
  for each row execute function public.set_updated_at();

alter table public.template_tabs enable row level security;
alter table public.template_tabs force row level security;

create policy template_tabs_select
  on public.template_tabs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.templates t
      where t.id = template_tabs.template_id
        and t.org_id = (select public.app_org_id())
        and (
          public.app_is_project_member(t.project_id)
          or (select public.app_has_permission('manage_projects'))
        )
    )
  );

create policy template_tabs_write
  on public.template_tabs
  for all
  to authenticated
  using (
    (select public.app_has_permission('manage_templates'))
    and exists (
      select 1 from public.templates t
      where t.id = template_tabs.template_id
        and t.org_id = (select public.app_org_id())
        and public.app_is_project_member(t.project_id)
    )
  )
  with check (
    (select public.app_has_permission('manage_templates'))
    and exists (
      select 1 from public.templates t
      where t.id = template_tabs.template_id
        and t.org_id = (select public.app_org_id())
        and public.app_is_project_member(t.project_id)
    )
  );

-- Template fields ---------------------------------------------------------
create table public.template_fields (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null,
  tab_id                    uuid not null,
  field_type                text not null,
  label                     text not null default '',
  position                  integer not null,
  is_system                 boolean not null default false,
  is_visible                boolean not null default true,
  is_required               boolean not null default false,
  guidelines                text,
  is_plain_text             boolean not null default false,
  recommended_length        integer,
  recommended_length_units  text,
  choices                   jsonb not null default '[]'::jsonb,
  default_content           text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint template_fields_type_valid check (field_type = any (array[
    'single_line_text', 'paragraph_text', 'file_image_upload', 'single_image',
    'checkboxes', 'radio_buttons', 'date', 'dropdown_select', 'heading', 'guidelines'
  ])),
  constraint template_fields_units_valid check (
    recommended_length_units is null or recommended_length_units = any (array['words', 'characters'])
  ),
  constraint template_fields_length_positive check (recommended_length is null or recommended_length >= 0),
  constraint template_fields_choices_is_array check (jsonb_typeof(choices) = 'array'),
  constraint template_fields_tab_fk foreign key (tab_id, org_id)
    references public.template_tabs (id, org_id) on delete cascade,
  constraint template_fields_id_org_unique unique (id, org_id),
  constraint template_fields_position_unique unique (tab_id, position)
);

comment on table public.template_fields is
  'One input on a template tab. field_type drives which editor control a content item renders for it.';

create index template_fields_tab_idx on public.template_fields (tab_id, position);

create trigger template_fields_set_updated_at
  before update on public.template_fields
  for each row execute function public.set_updated_at();

alter table public.template_fields enable row level security;
alter table public.template_fields force row level security;

create policy template_fields_select
  on public.template_fields
  for select
  to authenticated
  using (
    exists (
      select 1 from public.template_tabs tb
      join public.templates t on t.id = tb.template_id
      where tb.id = template_fields.tab_id
        and t.org_id = (select public.app_org_id())
        and (
          public.app_is_project_member(t.project_id)
          or (select public.app_has_permission('manage_projects'))
        )
    )
  );

create policy template_fields_write
  on public.template_fields
  for all
  to authenticated
  using (
    (select public.app_has_permission('manage_templates'))
    and exists (
      select 1 from public.template_tabs tb
      join public.templates t on t.id = tb.template_id
      where tb.id = template_fields.tab_id
        and t.org_id = (select public.app_org_id())
        and public.app_is_project_member(t.project_id)
    )
  )
  with check (
    (select public.app_has_permission('manage_templates'))
    and exists (
      select 1 from public.template_tabs tb
      join public.templates t on t.id = tb.template_id
      where tb.id = template_fields.tab_id
        and t.org_id = (select public.app_org_id())
        and public.app_is_project_member(t.project_id)
    )
  );

-- Content items -------------------------------------------------------------
-- Assign the next per-project item number, same row-locking pattern as
-- projects_assign_number (the UPDATE takes a lock on the project row, so
-- concurrent inserts for the same project serialise here instead of racing).
create or replace function public.content_items_assign_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.projects
     set next_item_number = next_item_number + 1
   where id = new.project_id
  returning next_item_number - 1 into new.item_number;

  if new.item_number is null then
    raise exception 'Project % does not exist', new.project_id;
  end if;

  return new;
end;
$$;

revoke execute on function public.content_items_assign_number() from public, anon, authenticated;

-- description and keywords are added by the already-tracked
-- 20260721090000_content_item_brief_fields.sql, not here.
create table public.content_items (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null,
  project_id         uuid not null,
  item_number        integer not null,
  name               text not null,
  template_id        uuid,
  current_status_id  uuid,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint content_items_name_not_blank check (btrim(name) <> ''),
  constraint content_items_number_positive check (item_number > 0),
  constraint content_items_project_fk foreign key (project_id, org_id)
    references public.projects (id, org_id) on delete cascade,
  constraint content_items_status_fk foreign key (current_status_id, org_id)
    references public.workflow_statuses (id, org_id) on delete set null,
  constraint content_items_template_fk foreign key (template_id, org_id)
    references public.templates (id, org_id) on delete set null,
  constraint content_items_id_org_unique unique (id, org_id),
  constraint content_items_number_unique_per_project unique (project_id, item_number)
);

comment on table public.content_items is
  'A single piece of content moving through a project''s workflow.';
comment on column public.content_items.item_number is
  'Per-project sequential number. Never reused, even after deletion.';

create index content_items_project_idx on public.content_items (project_id);
create index content_items_status_idx on public.content_items (current_status_id);

create trigger content_items_assign_number
  before insert on public.content_items
  for each row execute function public.content_items_assign_number();

create trigger content_items_set_updated_at
  before update on public.content_items
  for each row execute function public.set_updated_at();

alter table public.content_items enable row level security;
alter table public.content_items force row level security;

-- ORIGINAL form — superseded by app_can_view_item() in the already-tracked
-- 20260730110000_item_visibility.sql (via ALTER POLICY, which needs this to
-- exist first). Do not "fix" this to match today's rule; that migration
-- does that on replay.
create policy content_items_select
  on public.content_items
  for select
  to authenticated
  using (
    org_id = (select public.app_org_id())
    and (
      public.app_is_project_member(project_id)
      or (select public.app_has_permission('manage_projects'))
    )
  );

create policy content_items_insert
  on public.content_items
  for insert
  to authenticated
  with check (
    org_id = (select public.app_org_id())
    and public.app_is_project_member(project_id)
    and (select public.app_has_permission('manage_content_items'))
  );

create policy content_items_update
  on public.content_items
  for update
  to authenticated
  using (
    org_id = (select public.app_org_id())
    and public.app_is_project_member(project_id)
  )
  with check (org_id = (select public.app_org_id()));

create policy content_items_delete
  on public.content_items
  for delete
  to authenticated
  using (
    org_id = (select public.app_org_id())
    and public.app_is_project_member(project_id)
    and (select public.app_has_permission('manage_content_items'))
  );

-- Item status assignees -----------------------------------------------------
create table public.item_status_assignees (
  item_id     uuid not null,
  status_id   uuid not null,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  org_id      uuid not null,
  due_at      timestamptz,

  primary key (item_id, status_id, profile_id),
  constraint item_status_assignees_item_fk foreign key (item_id, org_id)
    references public.content_items (id, org_id) on delete cascade,
  constraint item_status_assignees_status_fk foreign key (status_id, org_id)
    references public.workflow_statuses (id, org_id) on delete cascade
);

comment on table public.item_status_assignees is
  'Who is assigned to move an item through one of its workflow statuses.';

create index item_status_assignees_item_idx on public.item_status_assignees (item_id);
create index item_status_assignees_profile_idx on public.item_status_assignees (profile_id);

alter table public.item_status_assignees enable row level security;
alter table public.item_status_assignees force row level security;

create policy item_status_assignees_select
  on public.item_status_assignees
  for select
  to authenticated
  using (
    exists (
      select 1 from public.content_items ci
      where ci.id = item_status_assignees.item_id
        and ci.org_id = (select public.app_org_id())
        and (
          public.app_is_project_member(ci.project_id)
          or (select public.app_has_permission('manage_projects'))
        )
    )
  );

create policy item_status_assignees_write
  on public.item_status_assignees
  for all
  to authenticated
  using (
    (select public.app_has_permission('manage_people_and_deadlines'))
    and exists (
      select 1 from public.content_items ci
      where ci.id = item_status_assignees.item_id
        and ci.org_id = (select public.app_org_id())
        and public.app_is_project_member(ci.project_id)
    )
  )
  with check (
    (select public.app_has_permission('manage_people_and_deadlines'))
    and exists (
      select 1 from public.content_items ci
      where ci.id = item_status_assignees.item_id
        and ci.org_id = (select public.app_org_id())
        and public.app_is_project_member(ci.project_id)
    )
  );

-- Content field values --------------------------------------------------
-- Whether the caller may EDIT an item's fields right now: a member of the
-- project, the item's current status isn't read-only, and either they hold
-- manage_content_items or they're personally assigned to the current status.
-- Never altered by a later migration (unlike content_items_select above) —
-- this is its one and only form.
create or replace function public.app_can_edit_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.content_items ci
    left join public.workflow_statuses s on s.id = ci.current_status_id
    where ci.id = p_item_id
      and ci.org_id = (select public.app_org_id())
      and public.app_is_project_member(ci.project_id)
      and coalesce(s.read_only, false) = false
      and (
        (select public.app_has_permission('manage_content_items'))
        or exists (
          select 1 from public.item_status_assignees a
          where a.item_id = ci.id
            and a.status_id = ci.current_status_id
            and a.profile_id = (select auth.uid())
        )
      )
  );
$$;

revoke execute on function public.app_can_edit_item(uuid) from public, anon;
grant execute on function public.app_can_edit_item(uuid) to authenticated;

create table public.content_field_values (
  item_id     uuid not null,
  field_id    uuid not null,
  org_id      uuid not null,
  value       jsonb not null default 'null'::jsonb,
  updated_at  timestamptz not null default now(),

  primary key (item_id, field_id),
  constraint content_field_values_item_fk foreign key (item_id, org_id)
    references public.content_items (id, org_id) on delete cascade,
  constraint content_field_values_field_fk foreign key (field_id, org_id)
    references public.template_fields (id, org_id) on delete cascade
);

comment on table public.content_field_values is
  'One field''s current value on one content item.';

create index content_field_values_item_idx on public.content_field_values (item_id);

create trigger content_field_values_set_updated_at
  before update on public.content_field_values
  for each row execute function public.set_updated_at();

alter table public.content_field_values enable row level security;
alter table public.content_field_values force row level security;

-- ORIGINAL form — superseded by app_can_view_item() in the already-tracked
-- 20260730110000_item_visibility.sql, same as content_items_select above.
create policy content_field_values_select
  on public.content_field_values
  for select
  to authenticated
  using (
    exists (
      select 1 from public.content_items ci
      where ci.id = content_field_values.item_id
        and ci.org_id = (select public.app_org_id())
        and (
          public.app_is_project_member(ci.project_id)
          or (select public.app_has_permission('manage_projects'))
        )
    )
  );

-- The single most security-relevant rule in the app: who may edit a
-- field's value. Assigned to the item's current status, or holds
-- manage_content_items — and never while that status is read-only.
create policy content_field_values_write
  on public.content_field_values
  for all
  to authenticated
  using (public.app_can_edit_item(item_id))
  with check (public.app_can_edit_item(item_id));

-- Project-level API functions -------------------------------------------
-- These belong with projects.sql structurally, but are undocumented for the
-- same reason as the tables above; api_duplicate_project also needs
-- templates/tabs/fields to exist, so both live here rather than earlier.
create or replace function public.api_create_project(
  p_name text,
  p_member_ids uuid[],
  p_workflow jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.app_org_id();
  v_uid uuid := auth.uid();
  v_proj uuid;
  v_status jsonb;
  v_status_id uuid;
  v_member uuid;
begin
  if v_org is null or v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.app_has_permission('manage_projects') then
    raise exception 'Requires the manage_projects permission' using errcode = '42501';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Project name is required';
  end if;

  insert into public.projects (org_id, name, created_by)
  values (v_org, p_name, v_uid)
  returning id into v_proj;

  for v_status in select * from jsonb_array_elements(p_workflow)
  loop
    insert into public.workflow_statuses
      (org_id, project_id, name, color, position,
       is_initial, is_terminal, auto_due_days, read_only)
    values (
      v_org, v_proj, v_status ->> 'name',
      coalesce(v_status ->> 'color', '#9ca3af'),
      (v_status ->> 'position')::int,
      coalesce((v_status ->> 'isInitial')::boolean, false),
      coalesce((v_status ->> 'isTerminal')::boolean, false),
      nullif(v_status ->> 'autoDueDays', '')::int,
      coalesce((v_status ->> 'readOnly')::boolean, false)
    )
    returning id into v_status_id;

    insert into public.status_reviewing_roles (status_id, role_id)
    select v_status_id, r.id
    from jsonb_array_elements_text(v_status -> 'reviewingRoles') n
    join public.roles r on r.name = n and r.org_id = v_org;
  end loop;

  -- Creator is always a member.
  insert into public.project_members (project_id, profile_id, added_by)
  values (v_proj, v_uid, v_uid)
  on conflict do nothing;

  if p_member_ids is not null then
    foreach v_member in array p_member_ids loop
      insert into public.project_members (project_id, profile_id, added_by)
      select v_proj, v_member, v_uid
      where exists (
        select 1 from public.profiles pr where pr.id = v_member and pr.org_id = v_org
      )
      on conflict do nothing;
    end loop;
  end if;

  return v_proj;
end;
$$;

revoke execute on function public.api_create_project(text, uuid[], jsonb) from public, anon;
grant execute on function public.api_create_project(text, uuid[], jsonb) to authenticated;

create or replace function public.api_duplicate_project(p_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.app_org_id();
  v_uid uuid := auth.uid();
  v_src_name text;
  v_new uuid;
  r_status record;
  r_tpl record;
  r_tab record;
  v_new_status uuid;
  v_new_tpl uuid;
  v_new_tab uuid;
begin
  if v_org is null or v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.app_has_permission('manage_projects') then
    raise exception 'Requires the manage_projects permission' using errcode = '42501';
  end if;

  select name into v_src_name from public.projects
  where id = p_project_id and org_id = v_org;
  if v_src_name is null then
    raise exception 'Project not found';
  end if;

  insert into public.projects (org_id, name, created_by)
  values (v_org, left(v_src_name || ' (copy)', 200), v_uid)
  returning id into v_new;

  -- Workflow statuses + their reviewing roles.
  for r_status in
    select * from public.workflow_statuses where project_id = p_project_id order by position
  loop
    insert into public.workflow_statuses
      (org_id, project_id, name, color, position, is_initial, is_terminal,
       auto_due_days, read_only)
    values (v_org, v_new, r_status.name, r_status.color, r_status.position,
            r_status.is_initial, r_status.is_terminal, r_status.auto_due_days, r_status.read_only)
    returning id into v_new_status;

    insert into public.status_reviewing_roles (status_id, role_id)
    select v_new_status, role_id from public.status_reviewing_roles
    where status_id = r_status.id;
  end loop;

  -- Templates -> tabs -> fields.
  for r_tpl in
    select * from public.templates where project_id = p_project_id
  loop
    insert into public.templates (org_id, project_id, name, is_default)
    values (v_org, v_new, r_tpl.name, r_tpl.is_default)
    returning id into v_new_tpl;

    for r_tab in
      select * from public.template_tabs where template_id = r_tpl.id order by position
    loop
      insert into public.template_tabs
        (org_id, template_id, name, position, is_system, is_hidden)
      values (v_org, v_new_tpl, r_tab.name, r_tab.position, r_tab.is_system, r_tab.is_hidden)
      returning id into v_new_tab;

      insert into public.template_fields
        (org_id, tab_id, field_type, label, position, is_system, is_visible,
         is_required, guidelines, is_plain_text, recommended_length,
         recommended_length_units, choices, default_content)
      select v_org, v_new_tab, field_type, label, position, is_system, is_visible,
             is_required, guidelines, is_plain_text, recommended_length,
             recommended_length_units, choices, default_content
      from public.template_fields where tab_id = r_tab.id;
    end loop;
  end loop;

  -- Creator becomes a member of the copy.
  insert into public.project_members (project_id, profile_id, added_by)
  values (v_new, v_uid, v_uid) on conflict do nothing;

  return v_new;
end;
$$;

revoke execute on function public.api_duplicate_project(uuid) from public, anon;
grant execute on function public.api_duplicate_project(uuid) to authenticated;
