-- Filter the city feed down to one restaurant.
--
-- A restaurant page is the same read as Home, scoped. It matches on
-- `dispatch_mentions` rather than on `dispatches.restaurant_id`, so a post
-- that mentions a restaurant appears on its page even when another restaurant
-- is its primary one. That is the whole point of the mentions table: one
-- canonical thread, several ways in.

begin;

drop function if exists public.city_feed(integer, integer, text);

create or replace function public.city_feed(
  feed_limit integer default 20,
  feed_offset integer default 0,
  feed_sort text default 'new',
  feed_restaurant uuid default null
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
      and (
        feed_restaurant is null
        or exists (
          select 1
          from public.dispatch_mentions as scope
          where scope.dispatch_id = d.id
            and scope.restaurant_id = feed_restaurant
        )
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

grant execute on function public.city_feed(integer, integer, text, uuid) to anon, authenticated;

commit;
