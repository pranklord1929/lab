-- Save a discussion, not just a restaurant.
--
-- The Saved tab could only ever hold restaurants, so a member who wanted to
-- come back to a conversation had no way to keep it. Mirrors
-- `saved_restaurants`: private to its owner, and limited to what the app
-- catalogue actually exposes.

begin;

create table if not exists public.saved_posts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  dispatch_id uuid not null references public.dispatches(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, dispatch_id)
);

comment on table public.saved_posts is
  'Discussions a member keeps. Private to its owner.';

create index if not exists saved_posts_user_created_idx
  on public.saved_posts (user_id, created_at desc);

alter table public.saved_posts enable row level security;

drop policy if exists "Members read their saved posts" on public.saved_posts;
create policy "Members read their saved posts"
  on public.saved_posts
  for select
  using (auth.uid() = user_id);

-- Only root posts can be saved: saving a reply out of its thread would keep a
-- fragment that reads as nonsense on its own.
drop policy if exists "Members save visible posts" on public.saved_posts;
create policy "Members save visible posts"
  on public.saved_posts
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.dispatches as d
      join public.app_catalogue as catalogue on catalogue.id = d.restaurant_id
      where d.id = saved_posts.dispatch_id
        and d.parent_id is null
    )
  );

drop policy if exists "Members remove their saved posts" on public.saved_posts;
create policy "Members remove their saved posts"
  on public.saved_posts
  for delete
  using (auth.uid() = user_id);

revoke all on public.saved_posts from anon;
grant select, insert, delete on public.saved_posts to authenticated;

-- The saved list is the feed shape, so a saved discussion renders with the
-- same card as everywhere else instead of a second, thinner row type.
create or replace function public.saved_feed(feed_limit integer default 50)
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
    ),
    (
      select count(*)::integer
      from public.reactions as reaction
      where reaction.dispatch_id = d.id and reaction.type = 'helpful'
    ),
    exists (
      select 1 from public.reactions as mine
      where mine.dispatch_id = d.id
        and mine.type = 'helpful'
        and mine.user_id = auth.uid()
    ),
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
    )
  from public.saved_posts as saved
  join public.dispatches as d on d.id = saved.dispatch_id
  join public.profiles as p on p.id = d.author_id
  where saved.user_id = auth.uid()
    and exists (
      select 1 from public.app_catalogue as catalogue
      where catalogue.id = d.restaurant_id
    )
  order by saved.created_at desc
  limit least(greatest(coalesce(feed_limit, 50), 1), 100);
$$;

grant execute on function public.saved_feed(integer) to authenticated;

commit;
