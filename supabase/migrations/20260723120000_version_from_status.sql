-- Record the status an item moved *from* on a status-change version, so the
-- version history can show the transition (from → to). The existing status_name
-- already holds the status it moved *to*. Null for manual/auto versions and for
-- older rows created before this column existed (they render as a single dot).
alter table public.content_item_versions
  add column if not exists from_status_name text;

comment on column public.content_item_versions.from_status_name is
  'For status_change versions: the status the item moved from. status_name holds the destination. Null otherwise.';
