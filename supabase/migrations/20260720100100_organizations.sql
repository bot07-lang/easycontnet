-- Organizations: the tenant root. Every other table hangs off this.
--
-- `slug` is the org's short name. Today it sits in the URL path
-- (app.com/brightrays/projects); later it can become a subdomain
-- (brightrays.app.com) with no migration — only routing changes.
--
-- Because it will one day be a subdomain, it is constrained to DNS rules now
-- and reserved words are blocked from day one. Once a customer owns "api",
-- switching on subdomains would collide with our own API host, and that is
-- unfixable after the fact.

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- DNS-safe: lowercase alphanumeric and hyphens, no leading/trailing hyphen.
  constraint organizations_slug_format check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  -- 63 chars is the DNS label limit. Free to enforce now, mandatory later.
  constraint organizations_slug_length check (char_length(slug) between 3 and 63),
  constraint organizations_slug_not_reserved check (
    slug not in (
      'www', 'api', 'app', 'admin', 'mail', 'smtp', 'ftp',
      'static', 'cdn', 'assets', 'media', 'files', 'img',
      'help', 'docs', 'support', 'blog', 'status', 'about',
      'staging', 'dev', 'test', 'demo', 'preview',
      'auth', 'login', 'signup', 'account', 'billing',
      'dashboard', 'internal', 'system', 'root', 'null', 'undefined'
    )
  ),
  constraint organizations_name_not_blank check (btrim(name) <> '')
);

comment on table public.organizations is
  'Tenant root. Orgs are rows, never separate tables or databases.';
comment on column public.organizations.slug is
  'URL identifier. Path segment today, subdomain later. DNS-constrained and reserved-word protected.';

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- RLS ----------------------------------------------------------------------
-- FORCE so the table owner is subject to policies too. Without it, the owner
-- silently bypasses RLS and the wall is decorative.

alter table public.organizations enable row level security;
alter table public.organizations force row level security;

-- You can only ever see your own org. The (select ...) wrapper makes Postgres
-- evaluate the claim once per query rather than once per row.
create policy organizations_select_own
  on public.organizations
  for select
  to authenticated
  using (id = (select public.app_org_id()));

-- Only the owner may rename their org. Both USING and WITH CHECK: without
-- WITH CHECK, an update could move the row to a different id.
create policy organizations_update_own
  on public.organizations
  for update
  to authenticated
  using (id = (select public.app_org_id()) and (select public.app_is_owner()))
  with check (id = (select public.app_org_id()));

-- No INSERT or DELETE policy: orgs are created and removed by the API through
-- the service role, never directly by a user request.
