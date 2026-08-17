-- Photos on discussions.
--
-- Demo posts inherit the restaurant's Google Places photo ref (already in
-- restaurant_search_mv). Real members will later upload into Storage; the
-- same table holds either a places_ref or a public_url.
--
-- Profile avatars stay symbolic (no photo upload path).

begin;

create table if not exists public.dispatch_media (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.dispatches(id) on delete cascade,
  -- Google Places resource name: places/.../photos/...
  places_ref text,
  -- Fully qualified HTTPS URL (Supabase Storage public object, or external).
  public_url text,
  width integer,
  height integer,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint dispatch_media_has_source check (
    places_ref is not null or public_url is not null
  ),
  constraint dispatch_media_places_ref_shape check (
    places_ref is null
    or places_ref ~ '^places/[A-Za-z0-9_-]+/photos/[A-Za-z0-9_-]+'
  )
);

create index if not exists dispatch_media_dispatch_sort_idx
  on public.dispatch_media (dispatch_id, sort_order);

comment on table public.dispatch_media is
  'Images attached to a discussion. Prefer public_url when hosted; places_ref is resolved by the app photo proxy.';

alter table public.dispatch_media enable row level security;

-- Anyone may see media of a visible (qualified catalogue) post.
drop policy if exists "Media of qualified posts is public" on public.dispatch_media;
create policy "Media of qualified posts is public"
  on public.dispatch_media for select
  using (
    exists (
      select 1
      from public.dispatches as d
      join public.app_catalogue as catalogue on catalogue.id = d.restaurant_id
      where d.id = dispatch_media.dispatch_id
    )
  );

-- Authors attach media only to their own root posts for now.
drop policy if exists "Authors add media to their posts" on public.dispatch_media;
create policy "Authors add media to their posts"
  on public.dispatch_media for insert
  with check (
    exists (
      select 1
      from public.dispatches as d
      where d.id = dispatch_media.dispatch_id
        and d.author_id = auth.uid()
        and d.parent_id is null
    )
  );

drop policy if exists "Authors remove their media" on public.dispatch_media;
create policy "Authors remove their media"
  on public.dispatch_media for delete
  using (
    exists (
      select 1
      from public.dispatches as d
      where d.id = dispatch_media.dispatch_id
        and d.author_id = auth.uid()
    )
  );

grant select on public.dispatch_media to anon, authenticated;
grant insert, delete on public.dispatch_media to authenticated;

-- Read restaurant photos without exposing restaurant_search_mv to anon.
create or replace function public.restaurant_primary_photo_ref(p_restaurant_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.photo_ref
  from public.restaurant_search_mv as m
  where m.id = p_restaurant_id
    and m.photo_ref is not null
    and length(m.photo_ref) > 0
  limit 1;
$$;

revoke all on function public.restaurant_primary_photo_ref(uuid) from public, anon, authenticated;
grant execute on function public.restaurant_primary_photo_ref(uuid) to anon, authenticated;

-- Primary image for a post: explicit media first, else restaurant photo.
create or replace function public.dispatch_primary_image(p_dispatch_id uuid)
returns table (public_url text, places_ref text)
language sql
stable
security definer
set search_path = ''
as $$
  select dm.public_url, dm.places_ref
  from public.dispatch_media as dm
  where dm.dispatch_id = p_dispatch_id
  order by dm.sort_order, dm.created_at
  limit 1;
$$;

-- When no row in dispatch_media, fall back to the restaurant photo.
create or replace function public.dispatch_feed_image(p_dispatch_id uuid, p_restaurant_id uuid)
returns table (image_url text, image_ref text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    media.public_url as image_url,
    coalesce(media.places_ref, public.restaurant_primary_photo_ref(p_restaurant_id)) as image_ref
  from (select 1) as _
  left join lateral (
    select dm.public_url, dm.places_ref
    from public.dispatch_media as dm
    where dm.dispatch_id = p_dispatch_id
    order by dm.sort_order, dm.created_at
    limit 1
  ) as media on true;
$$;

revoke all on function public.dispatch_feed_image(uuid, uuid) from public;
grant execute on function public.dispatch_feed_image(uuid, uuid) to anon, authenticated;

-- Seed demo root posts with their restaurant photo (idempotent).
insert into public.dispatch_media (dispatch_id, places_ref, sort_order)
select d.id, m.photo_ref, 0
from public.dispatches as d
join public.profiles as p on p.id = d.author_id
join public.restaurant_search_mv as m on m.id = d.restaurant_id
where coalesce(p.is_demo, false)
  and d.parent_id is null
  and m.photo_ref is not null
  and m.photo_ref ~ '^places/[A-Za-z0-9_-]+/photos/[A-Za-z0-9_-]+'
  and not exists (
    select 1 from public.dispatch_media as existing
    where existing.dispatch_id = d.id
  );

-- city_feed gains image_url / image_ref for the Home timeline.
drop function if exists public.city_feed(integer, integer, text, uuid, uuid, boolean);

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
  mentions jsonb,
  image_url text,
  image_ref text
)
language sql
stable
security invoker
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
    roots.author_id, roots.username, roots.restaurant_id,
    roots.restaurant_name, roots.restaurant_area, roots.reply_count,
    roots.upvote_count, roots.viewer_has_upvoted, roots.mentions,
    roots.image_url, roots.image_ref
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

-- Public Storage bucket for future member uploads (avatars stay symbolic).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-media',
  'post-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read post media" on storage.objects;
create policy "Public read post media"
  on storage.objects for select
  using (bucket_id = 'post-media');

drop policy if exists "Members upload post media" on storage.objects;
create policy "Members upload post media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Members delete own post media" on storage.objects;
create policy "Members delete own post media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;
