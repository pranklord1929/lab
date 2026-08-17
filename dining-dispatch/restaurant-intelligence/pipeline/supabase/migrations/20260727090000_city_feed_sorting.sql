-- Sorting and viewer vote state for the city feed.
--
-- Two things were missing to make the feed behave like a real social feed:
-- the reader could not tell which posts they had already upvoted, and there
-- was no way to surface anything other than the most recent post. Both are
-- read-side concerns, so nothing about how a post is stored changes here.

begin;

-- The old signature is replaced rather than overloaded: leaving both would let
-- PostgREST resolve to the stale one depending on which arguments a client
-- happens to send.
drop function if exists public.city_feed(integer, timestamptz);

create or replace function public.city_feed(
  feed_limit integer default 20,
  feed_offset integer default 0,
  feed_sort text default 'new'
)
returns table (
  id uuid,
  title text,
  body text,
  kind text,
  created_at timestamptz,
  author_id uuid,
  username text,
  restaurant_id uuid,
  restaurant_name text,
  restaurant_area text,
  reply_count integer,
  upvote_count integer,
  viewer_has_upvoted boolean,
  mentions jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with roots as (
    select
      d.id,
      d.title,
      d.body,
      d.kind,
      d.created_at,
      d.author_id,
      p.username,
      d.restaurant_id,
      d.restaurant_name,
      d.restaurant_area,
      (
        select count(*)::integer
        from public.dispatches as reply
        where reply.root_id = d.id
          and reply.id <> d.id
      ) as reply_count,
      (
        select count(*)::integer
        from public.reactions as reaction
        where reaction.dispatch_id = d.id
          and reaction.type = 'helpful'
      ) as upvote_count,
      exists (
        select 1
        from public.reactions as mine
        where mine.dispatch_id = d.id
          and mine.type = 'helpful'
          and mine.user_id = auth.uid()
      ) as viewer_has_upvoted,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', catalogue.id,
              'name', catalogue.name,
              'area', coalesce(catalogue.colonia, catalogue.alcaldia)
            )
            order by catalogue.name
          )
          from public.dispatch_mentions as mention
          join public.app_catalogue as catalogue on catalogue.id = mention.restaurant_id
          where mention.dispatch_id = d.id
        ),
        '[]'::jsonb
      ) as mentions
    from public.dispatches as d
    join public.profiles as p on p.id = d.author_id
    where d.parent_id is null
      and exists (
        select 1 from public.app_catalogue as catalogue
        where catalogue.id = d.restaurant_id
      )
  )
  select
    roots.id,
    roots.title,
    roots.body,
    roots.kind,
    roots.created_at,
    roots.author_id,
    roots.username,
    roots.restaurant_id,
    roots.restaurant_name,
    roots.restaurant_area,
    roots.reply_count,
    roots.upvote_count,
    roots.viewer_has_upvoted,
    roots.mentions
  from roots
  order by
    -- `hot` follows Reddit's shape: the logarithm flattens the gap between a
    -- runaway thread and a good one, while recency keeps moving the feed. A
    -- reply counts as much as an upvote, because a question that started a
    -- conversation is exactly what this product wants to surface.
    case when feed_sort = 'hot' then
      log(greatest(roots.upvote_count + roots.reply_count, 1)::numeric)
        + extract(epoch from roots.created_at) / 45000
    end desc nulls last,
    case when feed_sort = 'top' then
      roots.upvote_count + roots.reply_count
    end desc nulls last,
    roots.created_at desc
  limit least(greatest(coalesce(feed_limit, 20), 1), 50)
  offset greatest(coalesce(feed_offset, 0), 0);
$$;

grant execute on function public.city_feed(integer, integer, text) to anon, authenticated;

commit;
