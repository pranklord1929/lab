-- Expose author avatar (symbol + tint) on city_feed so Home shows people, not restaurant initials.

begin;

drop function if exists public.city_feed(integer, integer, text, uuid, uuid, boolean);

create function public.city_feed(
  feed_limit integer default 20,
  feed_offset integer default 0,
  feed_sort text default 'new',
  feed_restaurant uuid default null,
  feed_author uuid default null,
  feed_saved_only boolean default false
)
returns table (
  id uuid,
  title text,
  body text,
  kind text,
  created_at timestamptz,
  author_id uuid,
  username text,
  avatar_symbol text,
  avatar_tint text,
  restaurant_id uuid,
  restaurant_name text,
  restaurant_area text,
  reply_count integer,
  upvote_count integer,
  viewer_has_upvoted boolean,
  mentions jsonb,
  image_url text,
  image_ref text
)
language sql
stable
set search_path = ''
as $$
  with saved as (
    select * from public.my_saved_posts()
  ),
  roots as (
    select
      d.id,
      d.title,
      d.body,
      d.kind,
      d.created_at,
      d.author_id,
      p.username,
      p.avatar_symbol,
      p.avatar_tint,
      d.restaurant_id,
      d.restaurant_name,
      d.restaurant_area,
      (
        select count(*)::integer
        from public.dispatches as reply
        where reply.root_id = d.id and reply.id <> d.id
      ) as reply_count,
      (
        select count(*)::integer
        from public.reactions as reaction
        where reaction.dispatch_id = d.id and reaction.type = 'helpful'
      ) as upvote_count,
      exists (
        select 1 from public.reactions as mine
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
      ) as mentions,
      (select saved.saved_at from saved where saved.dispatch_id = d.id) as saved_at,
      img.image_url,
      img.image_ref
    from public.dispatches as d
    join public.profiles as p on p.id = d.author_id
    left join lateral public.dispatch_feed_image(d.id, d.restaurant_id) as img on true
    where d.parent_id is null
      and exists (
        select 1 from public.app_catalogue as catalogue
        where catalogue.id = d.restaurant_id
      )
      and (feed_author is null or d.author_id = feed_author)
      and (
        feed_restaurant is null
        or exists (
          select 1
          from public.dispatch_mentions as scope
          where scope.dispatch_id = d.id
            and scope.restaurant_id = feed_restaurant
        )
      )
      and (
        not coalesce(feed_saved_only, false)
        or exists (select 1 from saved where saved.dispatch_id = d.id)
      )
  )
  select
    roots.id, roots.title, roots.body, roots.kind, roots.created_at,
    roots.author_id, roots.username, roots.avatar_symbol, roots.avatar_tint,
    roots.restaurant_id, roots.restaurant_name, roots.restaurant_area,
    roots.reply_count, roots.upvote_count, roots.viewer_has_upvoted,
    roots.mentions, roots.image_url, roots.image_ref
  from roots
  order by
    case when coalesce(feed_saved_only, false) then roots.saved_at end desc nulls last,
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

grant execute on function public.city_feed(integer, integer, text, uuid, uuid, boolean)
  to anon, authenticated;

comment on function public.city_feed(integer, integer, text, uuid, uuid, boolean) is
  'City home feed. Includes author avatar_symbol / avatar_tint for profile chips.';

commit;
