-- Backend beta: expose la cohorte qualifiée à l'app sans la faire passer pour
-- une cohorte relue humainement.
--
-- `public_catalogue` reste la frontière stricte des fiches publiées après
-- double relecture. `app_catalogue` est la surface beta: elle contient les
-- membres `candidate` et `published`, mais retire immédiatement tout rejet ou
-- toute fiche marquée `needs_fix`.

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
  m.coordinate_state
from public.catalogue_membership m
join public.restaurant_search_mv r on r.id = m.restaurant_id
where m.status in ('candidate', 'published');

comment on view public.app_catalogue is
  'Surface du produit beta: cohorte qualifiée issue de catalogue_membership. Candidate ne signifie pas relu; needs_fix et rejected sont exclus. Sans scores ni champs internes du pipeline.';

create or replace view public.app_menu_items
with (security_invoker = false, security_barrier = true)
as
select
  mi.restaurant_id,
  mi.nom,
  mi.description,
  mi.prix,
  mi.devise,
  mi.categorie
from public.menu_items mi
join public.app_catalogue c on c.id = mi.restaurant_id;

create or replace view public.app_menu_items_extracted
with (security_invoker = false, security_barrier = true)
as
select
  mle.restaurant_id,
  mle.nom,
  mle.prix,
  mle.devise
from public.menu_items_local_extracted mle
join public.app_catalogue c on c.id = mle.restaurant_id;

create or replace function public.search_app_restaurants(
  search_query text,
  max_results integer default 12
)
returns table (
  id uuid,
  name text,
  colonia text,
  alcaldia text,
  address text,
  cuisine_key text,
  lat double precision,
  lng double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  with needle as (
    select replace(replace(replace(coalesce(search_query, ''), '\', '\\'), '%', '\%'), '_', '\_') as pattern
  )
  select
    c.id, c.name, c.colonia, c.alcaldia, c.address, c.cuisine_key, c.lat, c.lng
  from public.app_catalogue c, needle n
  where c.name    ilike '%' || n.pattern || '%' escape '\'
     or c.colonia ilike '%' || n.pattern || '%' escape '\'
     or c.address ilike '%' || n.pattern || '%' escape '\'
  order by
    case
      when lower(c.name) = lower(search_query) then 0
      when c.name ilike n.pattern || '%' escape '\' then 1
      else 2
    end,
    c.review_count desc nulls last,
    c.name
  limit least(greatest(max_results, 1), 50);
$$;

grant select on public.app_catalogue to anon, authenticated;
grant select on public.app_menu_items to anon, authenticated;
grant select on public.app_menu_items_extracted to anon, authenticated;
grant execute on function public.search_app_restaurants(text, integer)
  to anon, authenticated;
