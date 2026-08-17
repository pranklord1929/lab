-- The profile read carries the avatar it is about to render.
--
-- profile_overview() predates avatars, so the screen had the name and counts
-- but had to guess the glyph. Returning it here keeps the profile a single
-- round trip.

begin;

drop function if exists public.profile_overview(text);

create or replace function public.profile_overview(profile_username text)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_symbol text,
  avatar_tint text,
  bio text,
  interests text[],
  created_at timestamptz,
  post_count integer,
  comment_count integer,
  upvotes_received integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_symbol,
    p.avatar_tint,
    p.bio,
    p.interests,
    p.created_at,
    (
      select count(*)::integer
      from public.dispatches as d
      where d.author_id = p.id and d.parent_id is null
    ) as post_count,
    (
      select count(*)::integer
      from public.dispatches as d
      where d.author_id = p.id and d.parent_id is not null
    ) as comment_count,
    (
      select count(*)::integer
      from public.reactions as r
      join public.dispatches as d on d.id = r.dispatch_id
      where d.author_id = p.id and r.type = 'helpful'
    ) as upvotes_received
  from public.profiles as p
  where lower(p.username) = lower(btrim(profile_username))
  limit 1;
$$;

grant execute on function public.profile_overview(text) to anon, authenticated;

commit;
