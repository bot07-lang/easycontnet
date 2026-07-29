-- Auto Due (EasyContent parity)
-- ------------------------------------------------------------------
-- EC: "when a content item reaches a status with an auto due of N days, it will
-- automatically have a due date set N days from the current date" — including a
-- brand-new item entering the first status, even with nobody assigned.
--
-- Our due date used to live on item_status_assignees rows, so a status with no
-- assignees had nowhere to hold one. Move the due date to its own per-(item,
-- status) table (decoupled from assignees), and enforce auto-due with a trigger
-- that fires on item creation and every status change.

create table if not exists public.item_status_due_dates (
  item_id    uuid not null,
  status_id  uuid not null,
  org_id     uuid not null,
  due_at     timestamptz,
  updated_at timestamptz not null default now(),
  primary key (item_id, status_id),
  foreign key (item_id, org_id)   references public.content_items(id, org_id)     on delete cascade,
  foreign key (status_id, org_id) references public.workflow_statuses(id, org_id) on delete cascade
);

alter table public.item_status_due_dates enable row level security;
alter table public.item_status_due_dates force row level security;

-- Members may read due dates (the "Due" column / assign modal).
create policy item_status_due_dates_select
  on public.item_status_due_dates for select to authenticated
  using (
    org_id = public.app_org_id()
    and public.app_is_project_member(
      (select ci.project_id from public.content_items ci where ci.id = item_id))
  );

-- EC: due dates are edited with manage_people_and_deadlines. Auto-due writes go
-- through the SECURITY DEFINER trigger below, which bypasses RLS.
create policy item_status_due_dates_write
  on public.item_status_due_dates for all to authenticated
  using (
    org_id = public.app_org_id()
    and public.app_is_project_member(
      (select ci.project_id from public.content_items ci where ci.id = item_id))
    and (select public.app_has_permission('manage_people_and_deadlines'))
  )
  with check (
    org_id = public.app_org_id()
    and public.app_is_project_member(
      (select ci.project_id from public.content_items ci where ci.id = item_id))
    and (select public.app_has_permission('manage_people_and_deadlines'))
  );

-- One-time migration of any existing due dates off the assignee rows. All
-- assignees of a status shared the same value, so a min() collapses them.
insert into public.item_status_due_dates (item_id, status_id, org_id, due_at)
select item_id, status_id, org_id, min(due_at)
  from public.item_status_assignees
 where due_at is not null
 group by item_id, status_id, org_id
on conflict (item_id, status_id) do nothing;

-- Auto-due: when an item enters a status that has auto_due_days, set that
-- (item, status) due date to N days out — unless one is already set (a manual
-- due or an earlier auto-due is never clobbered).
create or replace function public.tg_apply_auto_due()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days int;
begin
  if new.current_status_id is null then
    return new;
  end if;
  -- On UPDATE, only act when the status actually changed.
  if tg_op = 'UPDATE' and new.current_status_id is not distinct from old.current_status_id then
    return new;
  end if;

  select auto_due_days into v_days
    from public.workflow_statuses where id = new.current_status_id;
  if v_days is null then
    return new;
  end if;

  insert into public.item_status_due_dates (item_id, status_id, org_id, due_at)
  values (new.id, new.current_status_id, new.org_id, now() + make_interval(days => v_days))
  on conflict (item_id, status_id) do nothing;

  return new;
end;
$$;

revoke execute on function public.tg_apply_auto_due() from public, anon, authenticated;

drop trigger if exists content_items_auto_due on public.content_items;
create trigger content_items_auto_due
  after insert or update of current_status_id on public.content_items
  for each row execute function public.tg_apply_auto_due();
