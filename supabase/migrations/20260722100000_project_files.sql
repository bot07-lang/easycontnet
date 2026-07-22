-- Project file library. Files are project-scoped (not org-wide), matching the
-- reference: a content item's Files field either reuses a library file or
-- uploads a new one into the project's library.
--
-- The bytes live in a private Storage bucket; this table is the metadata +
-- access control. Access rides the same gates as the rest of the project: you
-- must be a member of the project (or hold manage_projects for metadata-only
-- visibility). The API mediates all storage access with the service role and
-- hands out short-lived signed URLs, so the bucket itself stays private and
-- needs no storage.objects policies for this flow.

-- Private bucket for content files. 50 MB per-object cap; all mime types.
insert into storage.buckets (id, name, public, file_size_limit)
values ('content-files', 'content-files', false, 52428800)
on conflict (id) do nothing;

create table public.project_files (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  project_id   uuid not null references public.projects(id) on delete cascade,
  -- Optional "Assign a folder" grouping within the project library.
  folder       text,
  -- Object key inside the content-files bucket:
  -- {org_id}/{project_id}/{uuid}-{name}. Unique so a metadata row maps 1:1 to a
  -- stored object.
  storage_path text not null unique,
  name         text not null,
  mime         text,
  size_bytes   bigint,
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint project_files_name_not_blank check (btrim(name) <> '')
);

comment on table public.project_files is
  'Project-scoped file library. Bytes live in the content-files bucket at storage_path; this row is the metadata and access control.';

create index project_files_project_idx on public.project_files (project_id, created_at desc);
create index project_files_folder_idx on public.project_files (project_id, folder);

alter table public.project_files enable row level security;
alter table public.project_files force row level security;

-- Visible to project members, plus manage_projects for metadata-only reach.
create policy project_files_select
  on public.project_files for select to authenticated
  using (
    org_id = (select public.app_org_id())
    and (public.app_is_project_member(project_id) or (select public.app_has_permission('manage_projects')))
  );

-- Writable by any project member (attaching a file to your content is part of
-- editing). The standalone library-management UI will layer manage_asset_library
-- on top in the API; the row-level gate here is membership + org.
create policy project_files_write
  on public.project_files for all to authenticated
  using (
    org_id = (select public.app_org_id())
    and public.app_is_project_member(project_id)
  )
  with check (
    org_id = (select public.app_org_id())
    and public.app_is_project_member(project_id)
  );
