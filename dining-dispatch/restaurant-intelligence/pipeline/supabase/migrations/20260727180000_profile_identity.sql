-- Avatars, and a display name that cannot be borrowed.
--
-- No image upload. An avatar is a chosen symbol on a chosen colour, both drawn
-- from closed sets. That means no storage, no upload path, no image moderation
-- and no cost, while still giving every member something recognisable of their
-- own. The sets are enforced here rather than in the client: the symbol name
-- is rendered by the app, so an arbitrary string is the client trusting data
-- it should not.

begin;

alter table public.profiles
  add column if not exists avatar_symbol text,
  add column if not exists avatar_tint text;

alter table public.profiles
  drop constraint if exists profiles_avatar_symbol_allowed,
  add constraint profiles_avatar_symbol_allowed
  check (
    avatar_symbol is null
    or avatar_symbol in (
      'fork.knife', 'wineglass', 'cup.and.saucer', 'birthday.cake',
      'carrot', 'fish', 'leaf', 'flame', 'mug', 'popcorn',
      'frying.pan', 'takeoutbag.and.cup.and.straw'
    )
  );

alter table public.profiles
  drop constraint if exists profiles_avatar_tint_allowed,
  add constraint profiles_avatar_tint_allowed
  check (
    avatar_tint is null
    or avatar_tint in ('gold', 'clay', 'olive', 'plum', 'ember', 'ink')
  );

comment on column public.profiles.avatar_symbol is
  'Culinary glyph, from a closed set. Null means derive one from the username.';
comment on column public.profiles.avatar_tint is
  'Background key, from a closed set. Null means derive one from the username.';

-- Two members must not be able to present the same name.
create unique index if not exists profiles_display_name_unique
  on public.profiles (lower(btrim(display_name)))
  where display_name is not null;

-- And a display name must not be someone else's pseudonym. Uniqueness alone
-- would still let a member display another member's handle, which is the
-- impersonation this product can least afford: the pseudonym is the identity
-- votes and reports attach to.
create or replace function public.enforce_display_name_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.display_name is null then
    return new;
  end if;

  if exists (
    select 1
    from public.profiles as other
    where other.id <> new.id
      and lower(other.username) = lower(btrim(new.display_name))
  ) then
    raise exception using
      errcode = '23505',
      message = 'That name belongs to another member.';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_display_name_identity()
  from public, anon, authenticated;

drop trigger if exists profiles_display_name_identity on public.profiles;
create trigger profiles_display_name_identity
  before insert or update of display_name on public.profiles
  for each row execute procedure public.enforce_display_name_identity();

-- Answering "is this name free?" must not require reading the profiles table.
create or replace function public.display_name_available(
  candidate text,
  for_profile uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.profiles as p
    where (for_profile is null or p.id <> for_profile)
      and (
        lower(btrim(p.display_name)) = lower(btrim(candidate))
        or lower(p.username) = lower(btrim(candidate))
      )
  );
$$;

grant execute on function public.display_name_available(text, uuid) to authenticated;

commit;
