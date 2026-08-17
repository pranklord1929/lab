-- Account ownership and user-generated-content safety.
--
-- App Store distribution requires account deletion inside the app and a way
-- for a member to block abusive contributors. Both operations are owner-scoped
-- and enforced in the database.

create table if not exists public.blocked_users (
  user_id uuid not null references public.profiles(id) on delete cascade,
  blocked_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_user_id),
  constraint blocked_users_not_self check (user_id <> blocked_user_id)
);

create index if not exists blocked_users_owner_created_at_idx
  on public.blocked_users (user_id, created_at desc);

alter table public.blocked_users enable row level security;

drop policy if exists "Users read their blocks" on public.blocked_users;
create policy "Users read their blocks"
  on public.blocked_users for select
  using (auth.uid() = user_id);

drop policy if exists "Users create their blocks" on public.blocked_users;
create policy "Users create their blocks"
  on public.blocked_users for insert
  with check (auth.uid() = user_id and blocked_user_id <> auth.uid());

drop policy if exists "Users remove their blocks" on public.blocked_users;
create policy "Users remove their blocks"
  on public.blocked_users for delete
  using (auth.uid() = user_id);

revoke all on public.blocked_users from anon, authenticated;
grant select, insert, delete on public.blocked_users to authenticated;

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  delete from auth.users where id = caller;
  if not found then
    raise exception using errcode = '42501', message = 'account not found';
  end if;
end;
$$;

revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

comment on table public.blocked_users is
  'Private owner-scoped block list used to hide abusive contributors and their reactions.';
comment on function public.delete_own_account() is
  'Deletes the authenticated auth.users row; profile and community ownership cascades remove associated data.';
