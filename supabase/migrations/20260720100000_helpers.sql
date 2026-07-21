-- Helper functions used by every RLS policy.
--
-- Supabase already gives us auth.uid() and auth.jwt(); these build on them
-- rather than reinventing them. Custom claims (org_id, is_owner) are injected
-- into the token by the custom access token hook, and land in app_metadata.
--
-- All are STABLE so Postgres evaluates them once per query, not once per row.
-- All fail closed: no token, or a token missing the claim, resolves to NULL,
-- and every policy comparing against NULL denies.

-- The caller's organization (tenant). The entire tenant wall rests on this.
create or replace function public.app_org_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(
    coalesce(
      auth.jwt() -> 'app_metadata' ->> 'org_id',
      auth.jwt() ->> 'org_id'
    ), ''
  )::uuid;
$$;

-- Whether the caller owns their org. An account flag, not a role:
-- the owner always keeps role management, so nobody can lock themselves out.
create or replace function public.app_is_owner()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'is_owner')::boolean,
    (auth.jwt() ->> 'is_owner')::boolean,
    false
  );
$$;

-- Shared trigger to keep updated_at honest.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.app_org_id is
  'Caller''s tenant, read from the verified JWT. NULL when absent, so policies fail closed.';
