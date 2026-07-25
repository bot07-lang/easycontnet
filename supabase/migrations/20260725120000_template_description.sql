-- Templates can carry an optional description, shown on the template card and in
-- the builder header (matching EasyContent). Nullable; existing rows keep NULL.
alter table public.templates add column description text;
