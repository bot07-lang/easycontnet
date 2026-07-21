-- Tighten function execution grants.
--
-- The schema reset restored Supabase's stock default privileges, which include
-- `grant all on functions to anon`. That silently made every function we create
-- callable by unauthenticated callers through /rest/v1/rpc/. Revoking from
-- PUBLIC does not undo an explicit grant to anon, so all four functions ended
-- up exposed.
--
-- Two fixes: revoke what leaked, and stop the default from re-granting it.

-- Stop future functions being handed to anon automatically.
alter default privileges in schema public
  revoke execute on functions from anon;

-- Trigger functions: never callable directly by anyone. Postgres invokes them
-- as part of the trigger regardless of EXECUTE grants.
revoke execute on function public.projects_assign_number()
  from public, anon, authenticated;
revoke execute on function public.profiles_guard_privileged_columns()
  from public, anon, authenticated;

-- Policy helpers: authenticated needs EXECUTE because RLS policies call them
-- in the caller's context. anon does not — it has no session to evaluate.
revoke execute on function public.app_has_permission(text) from anon;
revoke execute on function public.app_is_project_member(uuid) from anon;
revoke execute on function public.app_org_id() from anon;
revoke execute on function public.app_is_owner() from anon;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- Confirm the intended grants are in place.
grant execute on function public.app_has_permission(text) to authenticated;
grant execute on function public.app_is_project_member(uuid) to authenticated;
grant execute on function public.app_org_id() to authenticated;
grant execute on function public.app_is_owner() to authenticated;
