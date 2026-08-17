-- `search_restaurants` : la saisie de l'utilisateur redevient du texte.
--
-- STAGING UNIQUEMENT. La production n'a pas reçu cette migration.
--
-- La signature actuelle interpole la requête directement dans un motif ILIKE.
-- `%` et `_` y sont des jokers : taper `_` renvoie n'importe quel caractère,
-- taper `%` renvoie tout le catalogue publié. Ce n'est pas une injection — la
-- fonction reste paramétrée et la frontière `public_catalogue` tient — mais
-- c'est une recherche qui ment sur ce qu'elle a trouvé, et un moyen commode
-- d'aspirer le catalogue en une requête.
--
-- Le contrat public ne change pas : mêmes paramètres, mêmes colonnes, même
-- classement. Seule l'interprétation des trois caractères change.

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
  with needle as (
    -- L'antislash d'abord, sinon on échapperait les échappements ajoutés
    -- juste après.
    select replace(replace(replace(coalesce(search_query, ''), '\', '\\'), '%', '\%'), '_', '\_') as pattern
  )
  select
    c.id, c.name, c.colonia, c.alcaldia, c.address, c.cuisine_key, c.lat, c.lng
  from public.public_catalogue c, needle n
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

grant execute on function public.search_restaurants(text, integer) to anon, authenticated;
