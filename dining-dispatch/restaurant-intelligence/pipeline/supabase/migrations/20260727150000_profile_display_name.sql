-- A profile gets a display name and a factual summary of its activity.
--
-- The pseudonym is the identity the community votes on and reports; it stays
-- immutable in practice. A display name is what a member wants to be called.
-- Keeping them as two fields is what lets the profile show a person's name
-- once and their handle once, instead of the same string twice.

begin;

alter table public.profiles
  add column if not exists display_name text;

alter table public.profiles
  drop constraint if exists profiles_display_name_length,
  add constraint profiles_display_name_length
  check (
    display_name is null
    or char_length(btrim(display_name)) between 1 and 40
  );

comment on column public.profiles.display_name is
  'Freely chosen name. The pseudonym in `username` remains the stable identity.';

-- Counts belong in SQL. Deriving them by fetching rows and reducing them in
-- the client is what made the city pulse under-report: PostgREST caps the
-- rows it returns and the truncation is silent.
create or replace function public.profile_overview(profile_username text)
returns table (
  id uuid,
  username text,
  display_name text,
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
