-- create_organization(): the one way a tenant comes into existence.
--
-- Creating an org is not a single insert — it must also produce the roles that
-- make the org usable and the owner who administers it. Doing that in one
-- transaction means an org can never exist in a half-built state with no roles
-- and nobody able to log in.
--
-- Service role only. Tenant creation must never be reachable from a user
-- request, which is why organizations has no INSERT policy.
--
-- The default matrix below is our design. EasyContent publishes only two of
-- these cells, so the rest is judgement, informed by a real account's Roles
-- screen. Defaults start restrictive: an org can loosen a permission with one
-- tick, but rarely thinks to tighten one.

create or replace function public.create_organization(
  p_slug          text,
  p_name          text,
  p_owner_user_id uuid,
  p_owner_name    text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id   uuid;
  v_admin_id uuid;
  v_role_id  uuid;
begin
  insert into public.organizations (slug, name)
  values (p_slug, p_name)
  returning id into v_org_id;

  ------------------------------------------------------------------
  -- Admin — every permission. Protected: cannot be edited or deleted,
  -- so an org can never strip its own administration away.
  ------------------------------------------------------------------
  insert into public.roles (org_id, name, description, position, is_system, is_editable)
  values (v_org_id, 'Admin', 'Full access to the account.', 1024, true, false)
  returning id into v_admin_id;

  insert into public.role_permissions (role_id, permission_key)
  select v_admin_id, key from public.permissions;

  ------------------------------------------------------------------
  -- Content Manager — runs content operations, not the account.
  -- No roles, billing, credits, migration, integrations or AI prompts.
  ------------------------------------------------------------------
  insert into public.roles (org_id, name, description, position, is_system, is_editable)
  values (v_org_id, 'Content Manager',
          'Runs content operations across projects.', 2048, false, true)
  returning id into v_role_id;

  insert into public.role_permissions (role_id, permission_key)
  select v_role_id, unnest(array[
    'manage_projects', 'manage_users', 'use_ai_features',
    'manage_workflow', 'manage_categories', 'manage_templates',
    'manage_structures', 'manage_asset_library',
    'manage_people_and_deadlines', 'manage_documentation',
    'view_briefs', 'manage_briefs',
    'view_all_content_items', 'manage_content_items', 'publish_content',
    'share_content', 'manage_comments',
    'view_publishing_calendar', 'view_communication_report',
    'view_account_report', 'view_content_report'
  ]);

  ------------------------------------------------------------------
  -- Editor — edits and reviews content within projects.
  -- No manage_workflow: changing the status ladder is structural.
  -- No publish_content: shipping is a separate responsibility.
  ------------------------------------------------------------------
  insert into public.roles (org_id, name, description, position, is_system, is_editable)
  values (v_org_id, 'Editor',
          'Edits and reviews content within assigned projects.', 3072, false, true)
  returning id into v_role_id;

  insert into public.role_permissions (role_id, permission_key)
  select v_role_id, unnest(array[
    'use_ai_features',
    'manage_categories', 'manage_templates', 'manage_structures',
    'manage_asset_library', 'manage_people_and_deadlines', 'manage_documentation',
    'view_briefs', 'manage_briefs',
    'view_all_content_items', 'manage_content_items',
    'share_content', 'manage_comments',
    'view_publishing_calendar', 'view_content_report'
  ]);

  ------------------------------------------------------------------
  -- Subject Matter Expert — reviews for accuracy.
  -- view_all_content_items is read-only but carries comment rights,
  -- which is exactly a reviewer's job.
  ------------------------------------------------------------------
  insert into public.roles (org_id, name, description, position, is_system, is_editable)
  values (v_org_id, 'Subject Matter Expert',
          'Reviews content for accuracy and leaves feedback.', 4096, false, true)
  returning id into v_role_id;

  insert into public.role_permissions (role_id, permission_key)
  select v_role_id, unnest(array[
    'view_briefs',
    'view_all_content_items',
    'view_publishing_calendar'
  ]);

  ------------------------------------------------------------------
  -- Writer — drafts content.
  --
  -- Deliberately NO manage_content_items. A writer edits the items they
  -- are ASSIGNED to (gate 4 of the permission model), which needs no
  -- permission at all. manage_content_items would grant edit rights over
  -- every item in the project regardless of assignment — a reasonable
  -- choice for a small trusting team, but wrong as a shipped default.
  ------------------------------------------------------------------
  insert into public.roles (org_id, name, description, position, is_system, is_editable)
  values (v_org_id, 'Writer',
          'Claims briefs and drafts the content items assigned to them.', 5120, true, true)
  returning id into v_role_id;

  insert into public.role_permissions (role_id, permission_key)
  select v_role_id, unnest(array[
    'use_ai_features',
    'manage_asset_library',
    'view_briefs',
    'view_publishing_calendar'
  ]);

  ------------------------------------------------------------------
  -- The owner. Admin role plus the ownership flag: the same person,
  -- two separate facts.
  ------------------------------------------------------------------
  insert into public.profiles (id, org_id, role_id, full_name, is_owner)
  values (p_owner_user_id, v_org_id, v_admin_id, p_owner_name, true);

  return v_org_id;
end;
$$;

comment on function public.create_organization is
  'Creates a tenant with its default roles, permission matrix and owner, in one transaction. Service role only.';

revoke execute on function public.create_organization(text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_organization(text, text, uuid, text)
  to service_role;

-- A readable view of the matrix, so it can be inspected in the Supabase table
-- editor without joining uuids by hand.
create or replace view public.role_matrix as
select
  o.slug            as org,
  r.name            as role,
  r.position        as role_position,
  p.group_name      as permission_group,
  p.label           as permission,
  (rp.role_id is not null) as granted
from public.roles r
join public.organizations o on o.id = r.org_id
cross join public.permissions p
left join public.role_permissions rp
       on rp.role_id = r.id and rp.permission_key = p.key
order by o.slug, r.position, p.position;

comment on view public.role_matrix is
  'Readable role x permission grid for inspection. Reads through the caller''s RLS.';
