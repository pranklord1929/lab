-- One feed function, and the end of the Field Note leftovers.
--
-- `saved_feed` was a copy of `city_feed` with one clause changed. Two
-- near-identical reads drift: a fix to sorting, to the mention payload or to
-- the catalogue boundary lands in one and not the other. It becomes a
-- parameter instead.
--
-- `dispatch_topics` holds zero rows. Topics were part of the guided Field Note
-- that the product replaced with a plain titled post, so the table, its grants
-- and the `new_topics` argument only describe a feature nobody can reach.

begin;

-- 1. A single feed read ------------------------------------------------------

drop function if exists public.saved_feed(integer);
drop function if exists public.city_feed(integer, integer, text, uuid, uuid);

create or replace function public.city_feed(
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
      -- The saved list is ordered by when it was saved, not when it was
      -- written, so that ordering has to travel with the row.
      (
        select saved.created_at
        from public.saved_posts as saved
        where saved.dispatch_id = d.id and saved.user_id = auth.uid()
      ) as saved_at
    from public.dispatches as d
    join public.profiles as p on p.id = d.author_id
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
        or exists (
          select 1
          from public.saved_posts as saved
          where saved.dispatch_id = d.id and saved.user_id = auth.uid()
        )
      )
  )
  select
    roots.id, roots.title, roots.body, roots.kind, roots.created_at,
    roots.author_id, roots.username, roots.restaurant_id,
    roots.restaurant_name, roots.restaurant_area, roots.reply_count,
    roots.upvote_count, roots.viewer_has_upvoted, roots.mentions
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

-- 2. Topics: remove a feature nobody can reach -------------------------------

create or replace function public.update_field_note(
  target_dispatch_id uuid,
  new_body text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  update public.dispatches
  set body = trim(new_body)
  where id = target_dispatch_id
    and author_id = caller
    and kind = 'field_note';

  if not found then
    raise exception using errcode = '42501', message = 'comment not editable';
  end if;
end;
$$;

revoke execute on function public.update_field_note(uuid, text) from public, anon;
grant execute on function public.update_field_note(uuid, text) to authenticated;

drop function if exists public.update_field_note(uuid, text, text[]);
drop table if exists public.dispatch_topics;

-- Columns from the guided Field Note. Nothing reads them.
alter table public.dispatches
  drop column if exists meal_time,
  drop column if exists company;

commit;
