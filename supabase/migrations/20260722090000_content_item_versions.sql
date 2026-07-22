-- Version history for content items. A version is a snapshot of the item's
-- field values at a point in time. Types: manual (Save version), status_change
-- (auto on transition), auto (WordPress sync, later). "current" is not stored —
-- it is the live content_field_values.
create table public.content_item_versions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  item_id     uuid not null references public.content_items(id) on delete cascade,
  kind        text not null check (kind in ('manual', 'status_change', 'auto')),
  label       text,
  item_name   text not null default '',
  status_name text,
  snapshot    jsonb not null default '{}'::jsonb,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

create index content_item_versions_item_idx
  on public.content_item_versions (item_id, created_at desc);

comment on table public.content_item_versions is
  'Snapshots of a content item''s field values. current version is live (not stored here).';

alter table public.content_item_versions enable row level security;
alter table public.content_item_versions force row level security;

create policy content_item_versions_select
  on public.content_item_versions for select to authenticated
  using (
    org_id = (select public.app_org_id())
    and exists (
      select 1 from public.content_items ci
      where ci.id = item_id
        and (public.app_is_project_member(ci.project_id) or (select public.app_has_permission('manage_projects')))
    )
  );

create policy content_item_versions_write
  on public.content_item_versions for all to authenticated
  using (
    org_id = (select public.app_org_id())
    and exists (select 1 from public.content_items ci where ci.id = item_id and public.app_is_project_member(ci.project_id))
  )
  with check (
    org_id = (select public.app_org_id())
    and exists (select 1 from public.content_items ci where ci.id = item_id and public.app_is_project_member(ci.project_id))
  );
