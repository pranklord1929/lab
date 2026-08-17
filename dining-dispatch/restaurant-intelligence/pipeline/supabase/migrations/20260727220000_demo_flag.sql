-- Move the demo marker off the username and onto its own column.
--
-- Seeded accounts were recognisable only by a `demo_` prefix, so the purge
-- command depended on a naming convention. Testing the app as it will actually
-- feel means those accounts must read as ordinary members — and the moment
-- they are renamed, the prefix stops identifying anything.
--
-- `is_demo` is therefore the marker from now on: it survives a rename, cannot
-- be set by a client, and is what `npm run demo:purge` selects on.

begin;

alter table public.profiles
  add column if not exists is_demo boolean not null default false;

comment on column public.profiles.is_demo is
  'Seeded account. Never set by a client; only npm run demo:purge reads it.';

-- Flag the seeded cohort while the prefix still identifies it.
update public.profiles
set is_demo = true
where username like 'demo\_%';

-- A member must not be able to flag themselves, or unflag a seeded account.
-- The column is only writable by the service role.
revoke update (is_demo) on public.profiles from anon, authenticated;

create or replace function public.freeze_demo_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_demo is distinct from old.is_demo and auth.uid() is not null then
    raise exception using
      errcode = '42501',
      message = 'the demo flag cannot be changed by a member';
  end if;
  return new;
end;
$$;

revoke execute on function public.freeze_demo_flag() from public, anon, authenticated;

drop trigger if exists profiles_freeze_demo_flag on public.profiles;
create trigger profiles_freeze_demo_flag
  before update of is_demo on public.profiles
  for each row execute procedure public.freeze_demo_flag();

commit;
