-- Reviewer ratings ("Approve and Complete review").
--
-- When a reviewer approves an item from a review status, they grade it against
-- that status's criteria (public.workflow_ratings) and may leave a note. This
-- records those submissions:
--   item_reviews         — one approval event (who, which item, from which status, note)
--   item_review_ratings  — the per-criterion star scores for that event
--
-- Criteria DEFINITIONS already exist (workflow_ratings, managed in Workflow
-- Settings). This adds the submitted grades, plus seeds the three default
-- criteria on every project's "Editorial Review" status.

-- One approval event -----------------------------------------------------------
create table public.item_reviews (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  project_id       uuid not null,
  item_id          uuid not null references public.content_items(id) on delete cascade,
  reviewer_id      uuid not null references public.profiles(id),
  from_status_id   uuid references public.workflow_statuses(id) on delete set null,
  from_status_name text,
  note             text,
  created_at       timestamptz not null default now()
);
create index item_reviews_item_idx on public.item_reviews (item_id, created_at desc);

-- Per-criterion stars for one event. rating_name is denormalised so the review
-- survives a criterion later being renamed or deleted.
create table public.item_review_ratings (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.item_reviews(id) on delete cascade,
  rating_id   uuid references public.workflow_ratings(id) on delete set null,
  rating_name text not null,
  stars       integer not null check (stars between 1 and 5)
);
create index item_review_ratings_review_idx on public.item_review_ratings (review_id);

-- RLS: visible to project members; written by members with manage_content_items
-- (the same permission that advances status). --------------------------------
alter table public.item_reviews enable row level security;
alter table public.item_reviews force row level security;

create policy item_reviews_select
  on public.item_reviews for select to authenticated
  using (
    org_id = (select public.app_org_id())
    and public.app_is_project_member(project_id)
  );

create policy item_reviews_write
  on public.item_reviews for all to authenticated
  using (
    org_id = (select public.app_org_id())
    and public.app_is_project_member(project_id)
    and (select public.app_has_permission('manage_content_items'))
  )
  with check (
    org_id = (select public.app_org_id())
    and public.app_is_project_member(project_id)
    and (select public.app_has_permission('manage_content_items'))
  );

alter table public.item_review_ratings enable row level security;
alter table public.item_review_ratings force row level security;

create policy item_review_ratings_select
  on public.item_review_ratings for select to authenticated
  using (
    exists (
      select 1 from public.item_reviews rv
      where rv.id = item_review_ratings.review_id
        and rv.org_id = (select public.app_org_id())
        and public.app_is_project_member(rv.project_id)
    )
  );

create policy item_review_ratings_write
  on public.item_review_ratings for all to authenticated
  using (
    exists (
      select 1 from public.item_reviews rv
      where rv.id = item_review_ratings.review_id
        and rv.org_id = (select public.app_org_id())
        and public.app_is_project_member(rv.project_id)
        and (select public.app_has_permission('manage_content_items'))
    )
  )
  with check (
    exists (
      select 1 from public.item_reviews rv
      where rv.id = item_review_ratings.review_id
        and rv.org_id = (select public.app_org_id())
        and public.app_is_project_member(rv.project_id)
        and (select public.app_has_permission('manage_content_items'))
    )
  );

-- Backfill: give every existing project's "Editorial Review" status the three
-- default criteria, unless it already has some. -------------------------------
insert into public.workflow_ratings (org_id, project_id, status_id, name, position)
select s.org_id, s.project_id, s.id, c.name, c.position
from public.workflow_statuses s
cross join (values
  ('Content/Value', 1024),
  ('Spelling/Grammar', 2048),
  ('Format/Structure', 3072)
) as c(name, position)
where lower(s.name) = 'editorial review'
  and not exists (select 1 from public.workflow_ratings r where r.status_id = s.id);

-- New projects: let seed_project_workflow also create rating criteria from a
-- status def's optional `ratings: [{ name, description?, position? }]` array. --
create or replace function public.seed_project_workflow(
  p_project_id uuid,
  p_statuses   jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id    uuid;
  v_status    jsonb;
  v_status_id uuid;
  v_missing   text;
begin
  select org_id into v_org_id from public.projects where id = p_project_id;
  if v_org_id is null then
    raise exception 'Project % does not exist', p_project_id;
  end if;

  if jsonb_typeof(p_statuses) <> 'array' or jsonb_array_length(p_statuses) = 0 then
    raise exception 'p_statuses must be a non-empty array';
  end if;

  select string_agg(distinct n, ', ') into v_missing
  from jsonb_array_elements(p_statuses) s,
       jsonb_array_elements_text(s -> 'reviewingRoles') n
  where n not in (select name from public.roles where org_id = v_org_id);

  if v_missing is not null then
    raise exception 'Unknown role name(s) for this organization: %', v_missing;
  end if;

  for v_status in select * from jsonb_array_elements(p_statuses)
  loop
    insert into public.workflow_statuses
      (org_id, project_id, name, color, position,
       is_initial, is_terminal, auto_due_days, read_only)
    values (
      v_org_id,
      p_project_id,
      v_status ->> 'name',
      coalesce(v_status ->> 'color', '#9ca3af'),
      (v_status ->> 'position')::integer,
      coalesce((v_status ->> 'isInitial')::boolean, false),
      coalesce((v_status ->> 'isTerminal')::boolean, false),
      nullif(v_status ->> 'autoDueDays', '')::integer,
      coalesce((v_status ->> 'readOnly')::boolean, false)
    )
    returning id into v_status_id;

    insert into public.status_reviewing_roles (status_id, role_id)
    select v_status_id, r.id
    from jsonb_array_elements_text(v_status -> 'reviewingRoles') n
    join public.roles r on r.name = n and r.org_id = v_org_id;

    -- Optional rating criteria for this status.
    insert into public.workflow_ratings (org_id, project_id, status_id, name, description, position)
    select v_org_id, p_project_id, v_status_id,
           rt ->> 'name', rt ->> 'description',
           coalesce((rt ->> 'position')::integer, 1024)
    from jsonb_array_elements(coalesce(v_status -> 'ratings', '[]'::jsonb)) rt;
  end loop;
end;
$$;

revoke execute on function public.seed_project_workflow(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.seed_project_workflow(uuid, jsonb)
  to service_role;
