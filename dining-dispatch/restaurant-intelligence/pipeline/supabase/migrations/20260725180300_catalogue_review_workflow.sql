-- Phase 1C — Relecture humaine du catalogue curaté.
--
-- Destiné au staging en premier. Le journal et la fonction sont privés : ils
-- sont appelés uniquement par l'outil local qui détient la clé service-role.

alter table public.catalogue_membership
  add column if not exists identity_state text not null default 'unreviewed';

alter table public.catalogue_membership
  drop constraint if exists catalogue_identity_state_allowed;
alter table public.catalogue_membership
  add constraint catalogue_identity_state_allowed
  check (identity_state in ('unreviewed', 'verified', 'suspect'));

alter table public.catalogue_membership
  drop constraint if exists catalogue_published_requires_review;
alter table public.catalogue_membership
  add constraint catalogue_published_requires_review check (
    status <> 'published' or (
      coordinate_state in ('verified', 'corrected')
      and identity_state = 'verified'
      and reviewed_by is not null
      and reviewed_at is not null
    )
  );

create table if not exists public.catalogue_review_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.catalogue_membership(restaurant_id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  action text not null,
  note text,
  state_before jsonb not null,
  state_after jsonb not null,
  created_at timestamptz not null default now(),
  constraint catalogue_review_action_allowed check (action in (
    'coordinate_verified', 'coordinate_corrected', 'coordinate_suspect',
    'identity_verified', 'identity_suspect', 'rejected', 'published'
  ))
);

create index if not exists catalogue_review_events_restaurant_idx
  on public.catalogue_review_events (restaurant_id, created_at desc);

alter table public.catalogue_review_events enable row level security;
revoke all on public.catalogue_review_events from public, anon, authenticated;

create or replace function public.apply_catalogue_review(
  p_restaurant_id uuid,
  p_reviewer_id uuid,
  p_action text,
  p_note text default null,
  p_lat double precision default null,
  p_lng double precision default null
)
returns public.catalogue_membership
language plpgsql
security definer
set search_path = public
as $$
declare
  before_state jsonb;
  after_row public.catalogue_membership;
begin
  if not exists (select 1 from public.profiles where id = p_reviewer_id) then
    raise exception 'Unknown catalogue reviewer';
  end if;

  select jsonb_build_object(
    'status', status,
    'coordinate_state', coordinate_state,
    'identity_state', identity_state,
    'lat_override', lat_override,
    'lng_override', lng_override
  )
  into before_state
  from public.catalogue_membership
  where restaurant_id = p_restaurant_id
  for update;

  if before_state is null then
    raise exception 'Unknown catalogue member';
  end if;

  if p_action = 'coordinate_verified' then
    update public.catalogue_membership
    set coordinate_state = 'verified', lat_override = null, lng_override = null,
        status = case when status = 'needs_fix' then 'candidate' else status end
    where restaurant_id = p_restaurant_id;
  elsif p_action = 'coordinate_corrected' then
    if p_lat is null or p_lng is null
       or p_lat not between 19.0 and 19.9 or p_lng not between -99.4 and -98.9 then
      raise exception 'Corrected coordinates must be inside the Mexico City bounds';
    end if;
    update public.catalogue_membership
    set coordinate_state = 'corrected', lat_override = p_lat, lng_override = p_lng,
        status = case when status = 'needs_fix' then 'candidate' else status end
    where restaurant_id = p_restaurant_id;
  elsif p_action = 'coordinate_suspect' then
    update public.catalogue_membership
    set coordinate_state = 'suspect', status = 'needs_fix'
    where restaurant_id = p_restaurant_id;
  elsif p_action = 'identity_verified' then
    update public.catalogue_membership
    set identity_state = 'verified'
    where restaurant_id = p_restaurant_id;
  elsif p_action = 'identity_suspect' then
    update public.catalogue_membership
    set identity_state = 'suspect', status = 'needs_fix'
    where restaurant_id = p_restaurant_id;
  elsif p_action = 'rejected' then
    update public.catalogue_membership
    set status = 'rejected'
    where restaurant_id = p_restaurant_id;
  elsif p_action = 'published' then
    update public.catalogue_membership
    set status = 'published', reviewed_by = p_reviewer_id, reviewed_at = now()
    where restaurant_id = p_restaurant_id;
  else
    raise exception 'Unsupported catalogue review action';
  end if;

  select * into after_row
  from public.catalogue_membership
  where restaurant_id = p_restaurant_id;

  insert into public.catalogue_review_events (
    restaurant_id, reviewer_id, action, note, state_before, state_after
  ) values (
    p_restaurant_id, p_reviewer_id, p_action, nullif(trim(p_note), ''), before_state,
    jsonb_build_object(
      'status', after_row.status,
      'coordinate_state', after_row.coordinate_state,
      'identity_state', after_row.identity_state,
      'lat_override', after_row.lat_override,
      'lng_override', after_row.lng_override
    )
  );

  return after_row;
end;
$$;

revoke all on function public.apply_catalogue_review(uuid, uuid, text, text, double precision, double precision)
  from public, anon, authenticated;

create or replace view public.public_catalogue
with (security_invoker = false, security_barrier = true)
as
select
  m.restaurant_id as id,
  r.name, r.colonia, r.alcaldia, r.address,
  coalesce(m.lat_override, r.lat) as lat,
  coalesce(m.lng_override, r.lng) as lng,
  r.phone, r.website, r.instagram, r.rating, r.review_count, r.price_level,
  r.summary, r.hours, r.google_maps_uri, r.cuisine_key, r.michelin_cuisine,
  r.opentable_cuisine, r.michelin_distinction, r.michelin_stars,
  r.bib_gourmand, r.in_worlds_50_best, r.w50_rank, r.opentable_url,
  m.coordinate_state
from public.catalogue_membership m
join public.restaurant_search_mv r on r.id = m.restaurant_id
where m.status = 'published'
  and m.coordinate_state in ('verified', 'corrected')
  and m.identity_state = 'verified'
  and m.reviewed_by is not null
  and m.reviewed_at is not null;
