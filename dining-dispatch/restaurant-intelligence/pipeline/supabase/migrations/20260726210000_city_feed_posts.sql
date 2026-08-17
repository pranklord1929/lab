-- The city feed: posts with a title, mentioning one or more restaurants.
--
-- This is the social primitive the product is built on. A post is a titled
-- root comment; replies stay untitled and inherit their parent's restaurant.
-- `restaurant_id` remains the post's primary restaurant, so every existing RLS
-- policy, the thread trigger and the restaurant page keep working unchanged.
-- Additional restaurants are recorded as mentions, which is what later allows
-- one canonical thread to surface in several thematic communities.

begin;

-- 1. Titles -----------------------------------------------------------------

alter table public.dispatches
  add column if not exists title text;

-- Existing demo and beta posts are already written as questions. Their first
-- sentence is a faithful title, so no contribution is rewritten or lost.
update public.dispatches
set title = left(
      btrim(split_part(replace(replace(body, e'\n', ' '), '  ', ' '), '. ', 1)),
      120
    )
where parent_id is null
  and title is null
  and kind = 'field_note';

-- Anything too short to make a sentence falls back to a bounded body excerpt.
update public.dispatches
set title = left(btrim(regexp_replace(body, e'\\s+', ' ', 'g')), 120)
where parent_id is null
  and kind = 'field_note'
  and (title is null or char_length(btrim(title)) < 3);

alter table public.dispatches
  drop constraint if exists dispatches_title_shape,
  add constraint dispatches_title_shape
  check (
    -- A reply is part of a conversation, not a new subject.
    (parent_id is not null and title is null)
    or
    -- A post opens a subject and must name it.
    (parent_id is null and kind = 'field_note'
       and title is not null
       and char_length(btrim(title)) between 3 and 120)
    or
    -- A quick signal is a single line; a title would only repeat it.
    (parent_id is null and kind = 'quick_signal' and title is null)
  );

comment on column public.dispatches.title is
  'Subject line of a root post. Null on replies and on quick signals.';

-- 2. Restaurant mentions ----------------------------------------------------

create table if not exists public.dispatch_mentions (
  dispatch_id uuid not null
    references public.dispatches(id) on delete cascade,
  restaurant_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (dispatch_id, restaurant_id)
);

comment on table public.dispatch_mentions is
  'Restaurants a post refers to. The primary restaurant is also stored here so a single join answers "which posts mention this restaurant".';

create index if not exists dispatch_mentions_restaurant_idx
  on public.dispatch_mentions (restaurant_id);

-- Every existing root post mentions its own restaurant.
insert into public.dispatch_mentions (dispatch_id, restaurant_id, created_at)
select d.id, d.restaurant_id, d.created_at
from public.dispatches as d
where d.parent_id is null
on conflict do nothing;

alter table public.dispatch_mentions enable row level security;

-- Mentions are visible exactly where their post is visible.
drop policy if exists "Mentions of qualified posts are public" on public.dispatch_mentions;
create policy "Mentions of qualified posts are public"
  on public.dispatch_mentions
  for select
  using (
    exists (
      select 1
      from public.dispatches as d
      join public.app_catalogue as catalogue on catalogue.id = d.restaurant_id
      where d.id = dispatch_mentions.dispatch_id
    )
  );

-- Only the author of a root post may attach a mention, and only to a
-- restaurant the app catalogue actually exposes.
drop policy if exists "Authors mention qualified restaurants" on public.dispatch_mentions;
create policy "Authors mention qualified restaurants"
  on public.dispatch_mentions
  for insert
  with check (
    exists (
      select 1
      from public.dispatches as d
      where d.id = dispatch_mentions.dispatch_id
        and d.author_id = auth.uid()
        and d.parent_id is null
    )
    and exists (
      select 1
      from public.app_catalogue as catalogue
      where catalogue.id = dispatch_mentions.restaurant_id
    )
  );

drop policy if exists "Authors remove their mentions" on public.dispatch_mentions;
create policy "Authors remove their mentions"
  on public.dispatch_mentions
  for delete
  using (
    exists (
      select 1
      from public.dispatches as d
      where d.id = dispatch_mentions.dispatch_id
        and d.author_id = auth.uid()
    )
  );

grant select on public.dispatch_mentions to anon, authenticated;
grant insert, delete on public.dispatch_mentions to authenticated;

-- A post always keeps a mention of its own primary restaurant, whatever the
-- client sends. Removing it would hide the post from its own restaurant page.
create or replace function public.protect_primary_mention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  primary_restaurant uuid;
begin
  select d.restaurant_id into primary_restaurant
  from public.dispatches as d
  where d.id = old.dispatch_id;

  if found and primary_restaurant = old.restaurant_id then
    raise exception using
      errcode = '23514',
      message = 'the primary restaurant mention cannot be removed';
  end if;

  return old;
end;
$$;

revoke execute on function public.protect_primary_mention() from public, anon, authenticated;

drop trigger if exists dispatch_mentions_protect_primary on public.dispatch_mentions;
create trigger dispatch_mentions_protect_primary
  before delete on public.dispatch_mentions
  for each row execute procedure public.protect_primary_mention();

-- 3. Feed reads -------------------------------------------------------------

-- The city feed is a root-only, recency-ordered read. A partial index keeps it
-- cheap regardless of how many replies the threads accumulate.
create index if not exists dispatches_root_feed_idx
  on public.dispatches (created_at desc)
  where parent_id is null;

create or replace function public.city_feed(
  feed_limit integer default 20,
  feed_before timestamptz default null
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
  mentions jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
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
    and (feed_before is null or d.created_at < feed_before)
    and exists (
      select 1 from public.app_catalogue as catalogue
      where catalogue.id = d.restaurant_id
    )
  order by d.created_at desc
  limit least(greatest(coalesce(feed_limit, 20), 1), 50);
$$;

grant execute on function public.city_feed(integer, timestamptz) to anon, authenticated;

commit;
