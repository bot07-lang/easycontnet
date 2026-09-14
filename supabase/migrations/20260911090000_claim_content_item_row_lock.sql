-- Close the same double-claim race in api_claim_content_item that
-- api_complete_status had (see 20260910120000_complete_status_row_lock.sql):
-- it reads the item's status with a plain SELECT, then checks whether anyone
-- is already assigned before inserting itself as the assignee. Two users
-- clicking "Claim" on the same unassigned item at the same time can both
-- pass the "not already assigned" check before either commits their insert,
-- leaving the item with two claimants when it should only ever have one.
--
-- `select ... for update` on the item row serializes concurrent calls for
-- the SAME item: the second call blocks until the first commits, then sees
-- the now-assigned row and correctly raises "already assigned" instead of
-- also claiming it.
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
   where ci.id = p_item_id
     for update of ci;
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
