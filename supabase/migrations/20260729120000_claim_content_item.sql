-- Claiming items (EasyContent parity)
-- ------------------------------------------------------------------
-- "If there's no one assigned to an item, any user with a reviewing role for
--  that item's current status can claim it" — i.e. self-assign to the current
--  status. A reviewer who can claim does NOT have manage_people_and_deadlines,
--  so they cannot insert an assignee row under RLS. This SECURITY DEFINER
--  function performs the claim with its own checks, bypassing that policy.

create or replace function public.api_claim_content_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_org    uuid := public.app_org_id();
  v_status uuid;
  v_project uuid;
  v_role   uuid;
begin
  if v_uid is null or v_org is null then
    raise exception 'Not authenticated';
  end if;

  select ci.current_status_id, ci.project_id
    into v_status, v_project
    from public.content_items ci
   where ci.id = p_item_id;
  if not found then
    raise exception 'Item not found';
  end if;

  if not public.app_is_project_member(v_project) then
    raise exception 'Not a member of this project' using errcode = '42501';
  end if;
  if v_status is null then
    raise exception 'This item has no current status';
  end if;

  -- Only claimable when NO ONE is assigned to any of the item's statuses.
  if exists (select 1 from public.item_status_assignees a where a.item_id = p_item_id) then
    raise exception 'This item is already assigned' using errcode = '42501';
  end if;

  -- The caller's role must be a reviewing role for the item's current status.
  select p.role_id into v_role from public.profiles p where p.id = v_uid;
  if not exists (
    select 1 from public.status_reviewing_roles r
     where r.status_id = v_status and r.role_id = v_role
  ) then
    raise exception 'Your role cannot claim items in this status' using errcode = '42501';
  end if;

  insert into public.item_status_assignees (item_id, status_id, profile_id, org_id)
  values (p_item_id, v_status, v_uid, v_org)
  on conflict do nothing;
end;
$$;

revoke execute on function public.api_claim_content_item(uuid) from public, anon;
grant execute on function public.api_claim_content_item(uuid) to authenticated;
