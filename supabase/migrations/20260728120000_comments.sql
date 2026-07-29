-- Comments on content items (item / field / text / file anchored), with threads
-- (parent_id), resolve, and RLS gated by project membership + manage_comments.

create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default public.app_org_id(),
  item_id     uuid not null references public.content_items(id) on delete cascade,
  -- where the comment is anchored
  anchor      text not null default 'item' check (anchor in ('item', 'field', 'text', 'file')),
  field_id    uuid references public.template_fields(id) on delete cascade,   -- field / text anchors
  file_id     uuid references public.project_files(id) on delete cascade,     -- file anchor
  text_anchor jsonb,                                                          -- highlighted range (text anchor)
  parent_id   uuid references public.comments(id) on delete cascade,          -- reply → thread
  author_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null,
  resolved    boolean not null default false,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index comments_item_idx on public.comments (item_id);
create index comments_parent_idx on public.comments (parent_id);

create trigger comments_set_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

alter table public.comments enable row level security;
alter table public.comments force row level security;

-- The item's project drives visibility (Gate 1: membership).
-- SELECT: any member of the comment's item's project.
create policy comments_select on public.comments
  for select to authenticated
  using (
    public.app_is_project_member((select ci.project_id from public.content_items ci where ci.id = item_id))
  );

-- INSERT: a member may add a comment as themselves.
create policy comments_insert on public.comments
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.app_is_project_member((select ci.project_id from public.content_items ci where ci.id = item_id))
  );

-- UPDATE (edit / resolve): own comment, or manage_comments for others'.
create policy comments_update on public.comments
  for update to authenticated
  using (
    public.app_is_project_member((select ci.project_id from public.content_items ci where ci.id = item_id))
    and (author_id = (select auth.uid()) or (select public.app_has_permission('manage_comments')))
  )
  with check (
    public.app_is_project_member((select ci.project_id from public.content_items ci where ci.id = item_id))
  );

-- DELETE: own comment, or manage_comments for others'.
create policy comments_delete on public.comments
  for delete to authenticated
  using (
    public.app_is_project_member((select ci.project_id from public.content_items ci where ci.id = item_id))
    and (author_id = (select auth.uid()) or (select public.app_has_permission('manage_comments')))
  );
