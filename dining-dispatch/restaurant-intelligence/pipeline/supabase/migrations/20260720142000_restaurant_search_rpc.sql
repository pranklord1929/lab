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
  is_enriched boolean,
  has_photo boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with matches as (
    select
      r.id,
      r.name,
      r.colonia,
      r.alcaldia,
      r.address,
      r.cuisine_key,
      r.is_enriched,
      r.has_photo,
      r.review_count,
      row_number() over (
        partition by lower(r.name), lower(coalesce(r.colonia, ''))
        order by r.is_enriched desc, r.has_photo desc, r.review_count desc nulls last
      ) as duplicate_rank
    from public.restaurant_search_mv r
    where r.name ilike '%' || search_query || '%'
       or r.colonia ilike '%' || search_query || '%'
       or r.address ilike '%' || search_query || '%'
  )
  select
    m.id,
    m.name,
    m.colonia,
    m.alcaldia,
    m.address,
    m.cuisine_key,
    m.is_enriched,
    m.has_photo
  from matches m
  where m.duplicate_rank = 1
  order by
    case
      when lower(m.name) = lower(search_query) then 0
      when m.name ilike search_query || '%' then 1
      else 2
    end,
    m.is_enriched desc,
    m.has_photo desc,
    m.name
  limit least(greatest(max_results, 1), 50);
$$;

grant execute on function public.search_restaurants(text, integer) to anon, authenticated;
