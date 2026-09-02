-- Item visibility (EasyContent parity)
-- ------------------------------------------------------------------
-- manage_projects grants PROJECT (metadata) visibility only — NOT content-item
-- visibility. An item is visible when the project is visible to the caller AND
-- they have item-level access: manage_content_items, view_all_content_items, or
-- an assignment to that item. So a manage_projects-only user sees the project
-- shell but "no items available" until they're assigned or given a content
-- permission. Previously the item + field-value SELECT policies allowed
-- "member OR manage_projects", which wrongly showed all items to a
-- manage_projects-only user (and to any member regardless of assignment).

create or replace function public.app_can_view_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.content_items ci
    where ci.id = p_item_id
      and ci.org_id = (select public.app_org_id())
      -- the project must be visible at all…
      and (public.app_is_project_member(ci.project_id)
           or (select public.app_has_permission('manage_projects')))
      -- …and the caller must have item-level access.
      and (
        (select public.app_has_permission('manage_content_items'))
        or (select public.app_has_permission('view_all_content_items'))
        or exists (
          select 1 from public.item_status_assignees a
          where a.item_id = ci.id and a.profile_id = (select auth.uid())
        )
      )
  );
$$;

revoke execute on function public.app_can_view_item(uuid) from public, anon;
grant execute on function public.app_can_view_item(uuid) to authenticated;

alter policy content_items_select on public.content_items
  using (public.app_can_view_item(id));

alter policy content_field_values_select on public.content_field_values
  using (public.app_can_view_item(item_id));
