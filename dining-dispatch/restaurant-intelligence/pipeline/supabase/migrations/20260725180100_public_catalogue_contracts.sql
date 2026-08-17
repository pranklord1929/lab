-- Phase 1B (2/3) — Les contrats publics de remplacement.
--
-- NON APPLIQUÉE. Doit tourner AVANT la révocation (fichier 3/3) : on ne coupe
-- l'accès brut qu'une fois le remplacement en place.

-- ---------------------------------------------------------------------------
-- Catalogue public : la seule surface restaurant lisible par anon.
-- ---------------------------------------------------------------------------
-- Les conditions de publication sont déjà garanties par la contrainte
-- `catalogue_published_requires_review`. On les répète ici volontairement :
-- si un jour la contrainte est assouplie, la vue ne fuit pas pour autant.
create or replace view public.public_catalogue
with (security_invoker = true)
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
  m.coordinate_state
from public.catalogue_membership m
join public.restaurant_search_mv r on r.id = m.restaurant_id
where m.status = 'published'
  and m.coordinate_state in ('verified', 'corrected')
  and m.reviewed_by is not null
  and m.reviewed_at is not null;

comment on view public.public_catalogue is
  'Seule surface restaurant publique. Volontairement sans is_enriched, score, rank_overall, photo_refs ni business_status : ce sont des internes de pipeline, et les exposer inviterait le client à recalculer une frontière.';

-- ---------------------------------------------------------------------------
-- Menus : même frontière, sinon un restaurant rejeté reste atteignable par
-- ses plats.
-- ---------------------------------------------------------------------------
create or replace view public.public_menu_items
with (security_invoker = true)
as
select
  mi.restaurant_id,
  mi.nom,
  mi.description,
  mi.prix,
  mi.devise,
  mi.categorie
from public.menu_items mi
join public.public_catalogue c on c.id = mi.restaurant_id;

-- Repli historique : mêmes règles.
create or replace view public.public_menu_items_extracted
with (security_invoker = true)
as
select
  mle.restaurant_id,
  mle.nom,
  mle.prix,
  mle.devise
from public.menu_items_local_extracted mle
join public.public_catalogue c on c.id = mle.restaurant_id;

-- ---------------------------------------------------------------------------
-- Recherche : repointée sur le catalogue publié.
-- ---------------------------------------------------------------------------
-- Changements de contrat assumés par rapport à la version actuelle :
--   * `is_enriched` et `has_photo` disparaissent — sans objet quand chaque
--     ligne est curée ;
--   * `lat`/`lng` apparaissent — la carte en aura besoin et la signature
--     actuelle ne pouvait pas les fournir ;
--   * le dédoublonnage par (name, colonia) est retiré : sur le périmètre
--     strict il ne restait que 2 paires en double, qui relèvent d'une décision
--     de relecture, pas d'un coût de requête permanent.
drop function if exists public.search_restaurants(text, integer);

create or replace function public.search_restaurants(
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
  select
    c.id, c.name, c.colonia, c.alcaldia, c.address, c.cuisine_key, c.lat, c.lng
  from public.public_catalogue c
  where c.name ilike '%' || search_query || '%'
     or c.colonia ilike '%' || search_query || '%'
     or c.address ilike '%' || search_query || '%'
  order by
    case
      when lower(c.name) = lower(search_query) then 0
      when c.name ilike search_query || '%' then 1
      else 2
    end,
    c.review_count desc nulls last,
    c.name
  limit least(greatest(max_results, 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- Droits sur les nouveaux contrats.
-- ---------------------------------------------------------------------------
grant select on public.public_catalogue            to anon, authenticated;
grant select on public.public_menu_items           to anon, authenticated;
grant select on public.public_menu_items_extracted to anon, authenticated;
grant execute on function public.search_restaurants(text, integer) to anon, authenticated;
