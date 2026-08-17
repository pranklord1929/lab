-- Production restaurant catalogue used by The Dining Dispatch web app.
-- This migration is additive: it deliberately leaves the community tables
-- (profiles, dispatches, reactions and dispatch_topics) untouched.

create extension if not exists pg_trgm;

create table if not exists public.restaurant_search_mv (
  id uuid primary key,
  name text not null,
  colonia text,
  alcaldia text,
  address text,
  lat double precision,
  lng double precision,
  phone text,
  website text,
  instagram text,
  rating double precision,
  review_count integer,
  price_level integer,
  photo_ref text,
  photo_refs jsonb,
  photo_count integer not null default 0,
  summary text,
  hours jsonb,
  google_maps_uri text,
  business_status text,
  cuisine_key text,
  michelin_cuisine text,
  opentable_cuisine text,
  michelin_distinction text,
  michelin_stars integer not null default 0,
  bib_gourmand boolean not null default false,
  michelin_url text,
  in_worlds_50_best boolean not null default false,
  w50_rank text,
  w50_list text,
  opentable_url text,
  score double precision,
  rank_overall integer,
  is_enriched boolean not null default false,
  has_photo boolean not null default false
);

create index if not exists restaurant_search_name_trgm_idx
  on public.restaurant_search_mv using gin (name gin_trgm_ops);
create index if not exists restaurant_search_colonia_trgm_idx
  on public.restaurant_search_mv using gin (colonia gin_trgm_ops);
create index if not exists restaurant_search_address_trgm_idx
  on public.restaurant_search_mv using gin (address gin_trgm_ops);
create index if not exists restaurant_search_rank_idx
  on public.restaurant_search_mv (is_enriched desc, has_photo desc, review_count desc nulls last);

create table if not exists public.menu_items (
  id uuid primary key,
  restaurant_id uuid not null,
  menu_document_id uuid,
  nom text not null,
  description text,
  prix double precision,
  devise text,
  categorie text,
  created_at timestamptz
);

create index if not exists menu_items_restaurant_idx
  on public.menu_items (restaurant_id, categorie, nom);

create table if not exists public.menu_items_local_extracted (
  id uuid primary key,
  restaurant_id uuid not null,
  menu_document_id uuid,
  nom text not null,
  prix double precision,
  devise text,
  extraction_method text,
  created_at timestamptz
);

create index if not exists menu_items_local_restaurant_idx
  on public.menu_items_local_extracted (restaurant_id, nom);

alter table public.restaurant_search_mv enable row level security;
alter table public.menu_items enable row level security;
alter table public.menu_items_local_extracted enable row level security;

drop policy if exists "Restaurant catalogue is public" on public.restaurant_search_mv;
create policy "Restaurant catalogue is public"
  on public.restaurant_search_mv for select using (true);

drop policy if exists "Menus are public" on public.menu_items;
create policy "Menus are public"
  on public.menu_items for select using (true);

drop policy if exists "Extracted menus are public" on public.menu_items_local_extracted;
create policy "Extracted menus are public"
  on public.menu_items_local_extracted for select using (true);

grant select on public.restaurant_search_mv to anon, authenticated;
grant select on public.menu_items to anon, authenticated;
grant select on public.menu_items_local_extracted to anon, authenticated;
