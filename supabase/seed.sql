-- Dummy data for development.
--
-- Auth is deliberately not an MVP focus, but we still seed REAL Supabase auth
-- users rather than faking a user in code. Two reasons:
--   1. RLS needs a real token to read claims from — a fake user makes the
--      entire permission model untestable.
--   2. The four-gate model only means something if you can BE each role in
--      turn and watch what changes.
-- The app will have a dev-only user switcher instead of a login screen.
--
-- The seed is shaped so every person sees a DIFFERENT set of projects. If RLS
-- were switched off, everyone would see all four and every assertion below
-- fails at once — an empty database would let a broken policy pass silently.
--
--   Org A (Brightrays)          Org B (Acme)
--     Blog            #1          Campaign  #1
--     Landing Pages   #2
--
--     Priya   Admin/owner  -> member of Blog only
--     Ishita  Editor       -> member of Landing Pages only
--     Abuzar  Writer       -> member of Blog only
--                              Rahul  Admin/owner -> member of Campaign
--
-- Expected visibility:
--   Abuzar -> Blog                  (membership only)
--   Ishita -> Landing Pages         (membership only)
--   Priya  -> Blog + Landing Pages  (manage_projects: sees a project she is
--                                    NOT a member of)
--   Rahul  -> Campaign              (tenant wall)
--
-- Dev password for every seeded user: dev-password-not-secret
-- These accounts exist only in the development database.

begin;

-- Clean slate so the seed is re-runnable.
delete from auth.users where email like '%@seed.local';
delete from public.organizations where slug in ('brightrays', 'acme');

-- Auth users ---------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('dev-password-not-secret', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name),
  '', '', '', ''
from (values
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'priya@seed.local',  'Priya Sharma'),
  ('aaaaaaaa-0000-4000-8000-000000000002'::uuid, 'ishita@seed.local', 'Ishita Rao'),
  ('aaaaaaaa-0000-4000-8000-000000000003'::uuid, 'abuzar@seed.local', 'Abuzar Qureshi'),
  ('bbbbbbbb-0000-4000-8000-000000000001'::uuid, 'rahul@seed.local',  'Rahul Menon')
) as u(id, email, full_name);

-- Identities, required for email sign-in to work.
insert into auth.identities (
  provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.email like '%@seed.local';

-- Organizations, roles and owners ------------------------------------------
select public.create_organization(
  'brightrays', 'Brightrays',
  'aaaaaaaa-0000-4000-8000-000000000001', 'Priya Sharma'
);

select public.create_organization(
  'acme', 'Acme Agency',
  'bbbbbbbb-0000-4000-8000-000000000001', 'Rahul Menon'
);

-- Non-owner profiles -------------------------------------------------------
insert into public.profiles (id, org_id, role_id, full_name)
select 'aaaaaaaa-0000-4000-8000-000000000002', o.id, r.id, 'Ishita Rao'
from public.organizations o
join public.roles r on r.org_id = o.id and r.name = 'Editor'
where o.slug = 'brightrays';

insert into public.profiles (id, org_id, role_id, full_name)
select 'aaaaaaaa-0000-4000-8000-000000000003', o.id, r.id, 'Abuzar Qureshi'
from public.organizations o
join public.roles r on r.org_id = o.id and r.name = 'Writer'
where o.slug = 'brightrays';

-- Projects -----------------------------------------------------------------
insert into public.projects (org_id, name, description, created_by)
select o.id, 'Blog', 'Long-form articles and how-to guides.',
       'aaaaaaaa-0000-4000-8000-000000000001'
from public.organizations o where o.slug = 'brightrays';

insert into public.projects (org_id, name, description, created_by)
select o.id, 'Landing Pages', 'Campaign and product landing pages.',
       'aaaaaaaa-0000-4000-8000-000000000001'
from public.organizations o where o.slug = 'brightrays';

insert into public.projects (org_id, name, description, created_by)
select o.id, 'Campaign', 'Q3 acquisition campaign.',
       'bbbbbbbb-0000-4000-8000-000000000001'
from public.organizations o where o.slug = 'acme';

-- Membership ---------------------------------------------------------------
-- Deliberately partial. Priya is NOT a member of Landing Pages: her visibility
-- of it comes from manage_projects, which is exactly what we want to prove.
insert into public.project_members (project_id, profile_id)
select p.id, m.profile_id
from public.projects p
join public.organizations o on o.id = p.org_id
join (values
  ('brightrays', 'Blog',          'aaaaaaaa-0000-4000-8000-000000000001'::uuid),
  ('brightrays', 'Blog',          'aaaaaaaa-0000-4000-8000-000000000003'::uuid),
  ('brightrays', 'Landing Pages', 'aaaaaaaa-0000-4000-8000-000000000002'::uuid),
  ('acme',       'Campaign',      'bbbbbbbb-0000-4000-8000-000000000001'::uuid)
) as m(org_slug, project_name, profile_id)
  on m.org_slug = o.slug and m.project_name = p.name;

commit;
