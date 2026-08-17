-- Carnet personnel de restaurants.
--
-- Une sauvegarde n'est ni publique ni sociale. Elle appartient au membre et
-- ne peut viser qu'une fiche visible dans le catalogue qualifié de la beta.

create table if not exists public.saved_restaurants (
  user_id uuid not null references public.profiles(id) on delete cascade,
  restaurant_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, restaurant_id)
);

create index if not exists saved_restaurants_user_created_at_idx
  on public.saved_restaurants (user_id, created_at desc);

alter table public.saved_restaurants enable row level security;

drop policy if exists "Users read their saved restaurants" on public.saved_restaurants;
create policy "Users read their saved restaurants"
  on public.saved_restaurants for select
  using (auth.uid() = user_id);

drop policy if exists "Users save qualified restaurants" on public.saved_restaurants;
create policy "Users save qualified restaurants"
  on public.saved_restaurants for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.app_catalogue
      where id = restaurant_id
    )
  );

drop policy if exists "Users remove their saved restaurants" on public.saved_restaurants;
create policy "Users remove their saved restaurants"
  on public.saved_restaurants for delete
  using (auth.uid() = user_id);

revoke all on public.saved_restaurants from anon, authenticated;
grant select, insert, delete on public.saved_restaurants to authenticated;

comment on table public.saved_restaurants is
  'Private notebook bookmarks. Targets are constrained by RLS to app_catalogue, never the raw ingestion reservoir.';
