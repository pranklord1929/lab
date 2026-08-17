-- Count the city pulse in the database.
--
-- The client used to fetch one row per comment and de-duplicate restaurant ids
-- in memory. PostgREST caps how many rows it will return, so the count was
-- silently truncated: Home read `200 restaurants discussed` when the real
-- figure was several times that. Counting belongs where the rows are.

begin;

create or replace function public.city_pulse()
returns table (
  notes_today integer,
  notes_this_week integer,
  documented_restaurants integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    -- The day boundary is Mexico City's, not the device's: a diner in Paris
    -- reading at 01:00 should see the same "today" as the city being written
    -- about.
    count(*) filter (
      where d.created_at >= date_trunc(
        'day', timezone('America/Mexico_City', now())
      ) at time zone 'America/Mexico_City'
    )::integer,
    count(*) filter (where d.created_at >= now() - interval '7 days')::integer,
    count(distinct d.restaurant_id)::integer
  from public.dispatches as d
  where exists (
    select 1 from public.app_catalogue as catalogue
    where catalogue.id = d.restaurant_id
  );
$$;

grant execute on function public.city_pulse() to anon, authenticated;

commit;
