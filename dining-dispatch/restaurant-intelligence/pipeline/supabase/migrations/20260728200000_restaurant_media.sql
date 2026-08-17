-- Free restaurant cover photos for the app catalogue only.
-- Hosted in Supabase Storage (public_url). Never Google Places Media API.

begin;

create table if not exists public.restaurant_media (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null
    references public.catalogue_membership(restaurant_id) on delete cascade,
  public_url text not null,
  source text not null,
  source_url text,
  width integer,
  height integer,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint restaurant_media_public_url_https check (
    public_url ~* '^https?://'
  ),
  constraint restaurant_media_source_allowed check (
    source in (
      'official_website',
      'reservandonos',
      'michelin',
      'resy',
      'wikidata',
      'opentable',
      'manual',
      'other'
    )
  )
);

create unique index if not exists restaurant_media_restaurant_sort_uidx
  on public.restaurant_media (restaurant_id, sort_order);

create index if not exists restaurant_media_restaurant_idx
  on public.restaurant_media (restaurant_id);

comment on table public.restaurant_media is
  'Cover / gallery images for catalogue restaurants. public_url only (Storage or free CDN rehosted).';

alter table public.restaurant_media enable row level security;

drop policy if exists "Restaurant media is public for catalogue members" on public.restaurant_media;
create policy "Restaurant media is public for catalogue members"
  on public.restaurant_media for select
  using (
    exists (
      select 1
      from public.catalogue_membership m
      where m.restaurant_id = restaurant_media.restaurant_id
        and m.status in ('candidate', 'published')
    )
  );

-- Writes are service-role only (seed scripts). No authenticated insert.
revoke all on public.restaurant_media from public, anon, authenticated;
grant select on public.restaurant_media to anon, authenticated;

-- Cover on the beta catalogue surface.
create or replace view public.app_catalogue
with (security_invoker = false, security_barrier = true)
as
select
  m.restaurant_id                     as id,
  r.name,
  r.colonia,
  r.alcaldia,
  r.address,
  coalesce(m.lat_override, r.lat)     as lat,
  coalesce(m.lng_override, r.lng)     as lng,
  r.phone,
  r.website,
  r.instagram,
  r.rating,
  r.review_count,
  r.price_level,
  r.summary,
  r.hours,
  r.google_maps_uri,
  r.cuisine_key,
  r.michelin_cuisine,
  r.opentable_cuisine,
  r.michelin_distinction,
  r.michelin_stars,
  r.bib_gourmand,
  r.in_worlds_50_best,
  r.w50_rank,
  r.opentable_url,
  m.status as catalogue_status,
  m.coordinate_state,
  (
    select rm.public_url
    from public.restaurant_media rm
    where rm.restaurant_id = m.restaurant_id
    order by rm.sort_order, rm.created_at
    limit 1
  ) as cover_url
from public.catalogue_membership m
join public.restaurant_search_mv r on r.id = m.restaurant_id
where m.status in ('candidate', 'published');

comment on view public.app_catalogue is
  'Surface du produit beta: cohorte qualifiée + cover_url (Storage) quand disponible.';

grant select on public.app_catalogue to anon, authenticated;

commit;
