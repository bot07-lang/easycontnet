-- Close a double-submit race in api_complete_status: it reads the item's
-- current status with a plain SELECT, then (possibly) advances it and inserts
-- a version snapshot. Two genuinely concurrent calls for the same item (e.g.
-- the same user double-submitting from two open tabs, not just a same-tab
-- double-click, which the UI already guards against) can both read the
-- pre-advance state before either commits, and both take the forward-advance
-- branch — item_status_completions is upserted so that part is harmless, but
-- the content_item_versions insert for the status-change snapshot is not
-- deduplicated, leaving two identical version entries in the item's history.
--
-- `select ... for update` on the item row serializes concurrent calls for
-- the SAME item: the second call blocks until the first commits, then reads
-- the now-current (post-advance) row, so its own logic naturally sees the
-- true state instead of a stale pre-advance snapshot. Calls for DIFFERENT
-- items are unaffected — the lock is scoped to one row.
create or replace function public.api_complete_status(
  p_item_id       uuid,
  p_expect_first  boolean,
  p_note          text    default null,
  p_send_forward  boolean default false,
  p_next_status_id uuid   default null,
  p_ratings       jsonb   default '[]'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_org        uuid := public.app_org_id();
  v_status     uuid;
  v_status_name text;
  v_new_name   text;
  v_project    uuid;
  v_is_first   boolean;
  v_assignees  int;
  v_completed  int;
  v_is_last    boolean;
  v_review     uuid;
  v_rating     jsonb;
  v_snap       jsonb;
  v_item_name  text;
  v_advanced   boolean := false;
begin
  if v_uid is null or v_org is null then
    raise exception 'Not authenticated';
  end if;

  select ci.current_status_id, ci.project_id, ci.name,
         s.name, coalesce(s.is_initial, false)
    into v_status, v_project, v_item_name, v_status_name, v_is_first
    from public.content_items ci
    left join public.workflow_statuses s on s.id = ci.current_status_id
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

  -- Submit only on the first status; approve only on later statuses.
  if p_expect_first and not v_is_first then
    raise exception 'Submit is only available on the first workflow status';
  end if;
  if (not p_expect_first) and v_is_first then
    raise exception 'Approve is not available on the first workflow status';
  end if;

  -- Only users ASSIGNED to the current status may complete it.
  if not exists (
    select 1 from public.item_status_assignees a
     where a.item_id = p_item_id and a.status_id = v_status and a.profile_id = v_uid
  ) then
    raise exception 'Only users assigned to this status can complete it' using errcode = '42501';
  end if;

  -- Record my completion (the checkmark).
  insert into public.item_status_completions (item_id, status_id, profile_id, org_id, note)
  values (p_item_id, v_status, v_uid, v_org, p_note)
  on conflict (item_id, status_id, profile_id)
    do update set note = excluded.note, completed_at = now();

  -- Am I the last assignee to complete this status?
  select count(*) into v_assignees
    from public.item_status_assignees a where a.item_id = p_item_id and a.status_id = v_status;
  select count(*) into v_completed
    from public.item_status_completions x where x.item_id = p_item_id and x.status_id = v_status;
  v_is_last := v_completed >= v_assignees;

  -- Record the review + any star ratings (the audit trail of a completion).
  insert into public.item_reviews
    (org_id, project_id, item_id, reviewer_id, from_status_id, from_status_name, note)
  values (v_org, v_project, p_item_id, v_uid, v_status, v_status_name, p_note)
  returning id into v_review;

  for v_rating in select * from jsonb_array_elements(coalesce(p_ratings, '[]'::jsonb)) loop
    if (v_rating ->> 'stars')::int between 1 and 5 then
      insert into public.item_review_ratings (review_id, rating_id, rating_name, stars)
      values (
        v_review,
        (v_rating ->> 'ratingId')::uuid,
        coalesce((select name from public.workflow_ratings where id = (v_rating ->> 'ratingId')::uuid), 'Rating'),
        (v_rating ->> 'stars')::int
      );
    end if;
  end loop;

  -- Send forward, if requested.
  if p_send_forward then
    if p_next_status_id is null then
      raise exception 'A target status is required to send the item forward';
    end if;
    if not exists (
      select 1 from public.workflow_statuses s
       where s.id = p_next_status_id and s.project_id = v_project
    ) then
      raise exception 'That status is not in this item''s project' using errcode = '42501';
    end if;

    update public.content_items
       set current_status_id = p_next_status_id, updated_at = now()
     where id = p_item_id;

    select s.name into v_new_name from public.workflow_statuses s where s.id = p_next_status_id;

    -- Version snapshot of the transition (matches manual status change).
    select coalesce(jsonb_object_agg(field_id, value), '{}'::jsonb) into v_snap
      from public.content_field_values where item_id = p_item_id;
    insert into public.content_item_versions
      (org_id, item_id, kind, label, item_name, status_name, from_status_name, snapshot, created_by)
    values (v_org, p_item_id, 'status_change', null, v_item_name, v_new_name, v_status_name, v_snap, v_uid);

    -- Leaving the status: clear its completions so a later return starts fresh.
    delete from public.item_status_completions where item_id = p_item_id and status_id = v_status;

    v_advanced := true;
  end if;

  return jsonb_build_object('advanced', v_advanced, 'isLast', v_is_last);
end;
$$;
