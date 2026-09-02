-- Scope comment access to item access (EasyContent parity)
-- ------------------------------------------------------------------
-- "…all comments in content items they have access to." Previously the comment
-- policies were gated by project membership, which — after the item-visibility
-- change — is broader than actually being able to view the item. Re-key them to
-- app_can_view_item(item_id) so seeing/adding/managing a comment requires the
-- same access as viewing its content item. (manage_comments still gates
-- editing/deleting/resolving OTHER people's comments; authors keep their own.)

alter policy comments_select on public.comments
  using (public.app_can_view_item(item_id));

alter policy comments_insert on public.comments
  with check (author_id = (select auth.uid()) and public.app_can_view_item(item_id));

alter policy comments_update on public.comments
  using (
    public.app_can_view_item(item_id)
    and (author_id = (select auth.uid()) or (select public.app_has_permission('manage_comments')))
  )
  with check (public.app_can_view_item(item_id));

alter policy comments_delete on public.comments
  using (
    public.app_can_view_item(item_id)
    and (author_id = (select auth.uid()) or (select public.app_has_permission('manage_comments')))
  );
