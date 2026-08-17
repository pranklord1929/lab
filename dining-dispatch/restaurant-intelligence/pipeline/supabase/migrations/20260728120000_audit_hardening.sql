-- Audit follow-ups: freeze public pseudonyms after onboarding, close grant
-- overreach on catalogue views, and stop anonymous name-oracle RPC access.
--
-- Nothing here changes the happy path of the beta app. It closes doors that
-- RLS alone (or view non-updatability alone) was quietly holding shut.

begin;

-- 1. Pseudonym is the stable community identity. Members may only leave the
-- temporary `new_diner_*` handle; a chosen handle cannot be rewritten later.
create or replace function public.freeze_profile_username()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.username is not distinct from new.username then
    return new;
  end if;

  -- First real choice: temporary onboarding handle → permanent handle.
  if old.username ~* '^new_diner_'
     and new.username !~* '^new_diner_'
     and new.username ~ '^[A-Za-z0-9_]{3,24}$' then
    return new;
  end if;

  raise exception using
    errcode = '23514',
    message = 'username cannot be changed once chosen';
end;
$$;

revoke execute on function public.freeze_profile_username()
  from public, anon, authenticated;

drop trigger if exists profiles_freeze_username on public.profiles;
create trigger profiles_freeze_username
  before update of username on public.profiles
  for each row execute procedure public.freeze_profile_username();

comment on function public.freeze_profile_username() is
  'Allows only the onboarding transition from new_diner_* to a permanent handle.';

-- 2. Name availability is for signed-in members editing their profile, not an
-- anonymous oracle of every pseudonym and display name.
revoke execute on function public.display_name_available(text, uuid)
  from public, anon;
grant execute on function public.display_name_available(text, uuid)
  to authenticated;

-- 3. Catalogue views are read contracts. They are not updatable today (join
-- views), but they still held full DML grants — the same class of hole as
-- anon TRUNCATE on community tables.
revoke insert, update, delete, truncate, references, trigger
  on public.app_catalogue from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.app_menu_items from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.app_menu_items_extracted from anon, authenticated;

grant select on public.app_catalogue to anon, authenticated;
grant select on public.app_menu_items to anon, authenticated;
grant select on public.app_menu_items_extracted to anon, authenticated;

-- 4. Profiles are created only by handle_new_user. Members never insert rows.
revoke insert on public.profiles from anon, authenticated;

-- 5. Mentions and saved lists are insert/delete (or insert only) — not update.
revoke update on public.dispatch_mentions from authenticated;
revoke update on public.saved_posts from authenticated;
revoke update on public.saved_restaurants from authenticated;

commit;
