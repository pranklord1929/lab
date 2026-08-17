-- Baseline relue du schéma communautaire.
--
-- Pourquoi ce fichier existe : `profiles`, `dispatches`, `dispatch_topics` et
-- `reactions` ont été créés à la main depuis `web/supabase/community.sql`,
-- jamais versionnés. Une base reconstruite depuis `supabase/migrations/` était
-- donc infidèle — il lui manquait toute la couche communautaire, y compris la
-- fonction `set_updated_at()` dont dépendent d'autres migrations.
--
-- Ce fichier est daté avant les migrations du catalogue (20260720…) pour
-- refléter l'ordre réel de création. Il est écrit en `if not exists` /
-- `or replace` : le rejouer sur la production ne modifierait rien.
--
-- Fidélité assumée : ce baseline reproduit ce que la PRODUCTION contient
-- réellement au 2026-07-25. `dispatch_reports`, présente dans
-- `web/supabase/20260719_beta_safety.sql`, n'a jamais été appliquée en
-- production ; elle est donc volontairement absente ici. La créer est une
-- décision produit ouverte (le bouton « Report » de l'app et du site ne peut
-- rien enregistrer sans elle).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  bio text,
  interests text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,24}$')
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

create table if not exists public.dispatches (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  restaurant_id uuid not null,
  restaurant_name text not null,
  restaurant_area text,
  body text not null,
  visited_on date not null default current_date,
  meal_time text,
  company text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dispatches_body_length check (char_length(body) between 20 and 4000),
  constraint dispatches_meal_time check (
    meal_time is null or meal_time in ('Breakfast', 'Lunch', 'Dinner', 'Late night')
  ),
  constraint dispatches_company check (
    company is null or company in ('Solo', 'Couple', 'Friends', 'Family', 'Business')
  )
);

create index if not exists dispatches_created_at_idx on public.dispatches (created_at desc);
create index if not exists dispatches_restaurant_id_idx on public.dispatches (restaurant_id, created_at desc);
create index if not exists dispatches_author_id_idx on public.dispatches (author_id, created_at desc);

create table if not exists public.dispatch_topics (
  dispatch_id uuid not null references public.dispatches(id) on delete cascade,
  topic text not null,
  primary key (dispatch_id, topic),
  constraint dispatch_topics_allowed check (
    topic in ('Food', 'Wine & Drinks', 'Vegetarian', 'Service', 'Atmosphere', 'Family', 'Groups', 'Value')
  )
);

create table if not exists public.reactions (
  dispatch_id uuid not null references public.dispatches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  created_at timestamptz not null default now(),
  primary key (dispatch_id, user_id, type),
  constraint reactions_type_allowed check (
    type in ('helpful', 'confirmed', 'different', 'outdated')
  )
);

-- ---------------------------------------------------------------------------
-- Fonctions et déclencheurs
-- ---------------------------------------------------------------------------

-- `search_path` figé et EXECUTE révoqué : reproduit le durcissement appliqué
-- en production le 2026-07-25.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists dispatches_set_updated_at on public.dispatches;
create trigger dispatches_set_updated_at
  before update on public.dispatches
  for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Sécurité au niveau ligne
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.dispatches enable row level security;
alter table public.dispatch_topics enable row level security;
alter table public.reactions enable row level security;

drop policy if exists "Profiles are public" on public.profiles;
create policy "Profiles are public" on public.profiles for select using (true);
drop policy if exists "Users update their profile" on public.profiles;
create policy "Users update their profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Dispatches are public" on public.dispatches;
create policy "Dispatches are public" on public.dispatches for select using (true);
drop policy if exists "Users create their dispatches" on public.dispatches;
create policy "Users create their dispatches" on public.dispatches for insert with check (auth.uid() = author_id);
drop policy if exists "Users update their dispatches" on public.dispatches;
create policy "Users update their dispatches" on public.dispatches for update using (auth.uid() = author_id) with check (auth.uid() = author_id);
drop policy if exists "Users delete their dispatches" on public.dispatches;
create policy "Users delete their dispatches" on public.dispatches for delete using (auth.uid() = author_id);

drop policy if exists "Topics are public" on public.dispatch_topics;
create policy "Topics are public" on public.dispatch_topics for select using (true);
drop policy if exists "Authors create dispatch topics" on public.dispatch_topics;
create policy "Authors create dispatch topics" on public.dispatch_topics for insert with check (
  exists (select 1 from public.dispatches where id = dispatch_id and author_id = auth.uid())
);
drop policy if exists "Authors delete dispatch topics" on public.dispatch_topics;
create policy "Authors delete dispatch topics" on public.dispatch_topics for delete using (
  exists (select 1 from public.dispatches where id = dispatch_id and author_id = auth.uid())
);

drop policy if exists "Reactions are public" on public.reactions;
create policy "Reactions are public" on public.reactions for select using (true);
drop policy if exists "Users create their reactions" on public.reactions;
create policy "Users create their reactions" on public.reactions for insert with check (auth.uid() = user_id);
drop policy if exists "Users delete their reactions" on public.reactions;
create policy "Users delete their reactions" on public.reactions for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Droits d'API
-- ---------------------------------------------------------------------------

grant select on public.profiles, public.dispatches, public.dispatch_topics, public.reactions
  to anon, authenticated;
grant insert, update, delete on public.dispatches, public.dispatch_topics, public.reactions
  to authenticated;
grant update on public.profiles to authenticated;
