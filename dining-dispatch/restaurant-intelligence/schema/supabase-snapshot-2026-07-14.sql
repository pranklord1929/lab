-- Schéma COMPLET du projet Supabase "Bistrot Bastards' Project" (pdbgbpqrpcveivhvxsus)
-- Dump généré le 2026-07-14 depuis les catalogues Postgres live (pas depuis les migrations).
-- Permet de reconstruire la base à l'identique sur n'importe quel Postgres 17
-- (Neon, Railway, RDS, self-hosted...), puis de recharger les données depuis
-- data/local_db/jsonl/ ou cdmx_local.sqlite.
-- Ordre d'exécution : extensions → fonctions → tables → contraintes → vues →
-- vue matérialisée → index → triggers.

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- (pg_stat_statements et supabase_vault : spécifiques Supabase, pas nécessaires ailleurs)

-- ============================================================
-- FONCTIONS (hors fonctions internes des extensions)
-- ============================================================
CREATE OR REPLACE FUNCTION public.photos_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.webhooks_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_restaurant_search_vector()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('spanish', coalesce(NEW.nombre, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(NEW.cuisine_type, '')), 'B') ||
    setweight(to_tsvector('spanish', coalesce(NEW.colonia, '')), 'C') ||
    setweight(to_tsvector('spanish', coalesce(NEW.alcaldia, '')), 'C');
  RETURN NEW;
END;
$function$;

-- ============================================================
-- TABLES
-- ============================================================
CREATE TABLE actions_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid,
  draft_id uuid,
  action text NOT NULL,
  payload jsonb,
  result jsonb,
  success boolean,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE brand_kits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  logo_url text,
  primary_color text,
  secondary_color text,
  primary_font text,
  pitch text,
  signature_items text,
  tone_of_voice text,
  words_to_use text,
  words_to_avoid text,
  reference_photos jsonb DEFAULT '[]'::jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  palette jsonb DEFAULT '[]'::jsonb,
  logo_variants jsonb DEFAULT '[]'::jsonb
);

CREATE TABLE clients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  owner_name text,
  neighborhood text,
  website_url text,
  website_repo text,
  instagram_handle text,
  google_place_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE drafts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  title text,
  body text,
  hashtags text,
  image_urls text[] DEFAULT ARRAY[]::text[],
  source_photos jsonb,
  target_metadata jsonb,
  generated_by_model text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  approved_at timestamp with time zone,
  published_at timestamp with time zone,
  rendered_png_url text,
  note text,
  instagram_post_id text,
  publish_attempts integer NOT NULL DEFAULT 0,
  last_publish_error text,
  last_publish_attempt_at timestamp with time zone
);

CREATE TABLE menu_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  source_url text NOT NULL,
  file_type text NOT NULL,
  raw_text text,
  langue text DEFAULT 'es'::text,
  confidence_score numeric(3,2),
  extraction_method text,
  statut text DEFAULT 'pending'::text,
  last_checked_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE menu_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  menu_document_id uuid,
  nom text NOT NULL,
  description text,
  prix numeric(10,2),
  devise text DEFAULT 'MXN'::text,
  categorie text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE photos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  filename text NOT NULL,
  relative_path text NOT NULL,
  thumbnail_path text,
  width integer,
  height integer,
  size_bytes bigint,
  mime_type text,
  exif_taken_at timestamp with time zone,
  exif_camera text,
  exif_lens text,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  caption text,
  alt_text text,
  source text DEFAULT 'archive'::text,
  used_in_post_ids text[] NOT NULL DEFAULT '{}'::text[],
  last_used_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE pipeline_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_name text NOT NULL,
  terminal text,
  status text NOT NULL,
  task text,
  blocker text,
  pct integer,
  records integer,
  notes text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE restaurant_duplicate_candidates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  master_id uuid,
  duplicate_id uuid,
  rule text NOT NULL,
  name_similarity numeric,
  distance_meters numeric,
  confidence numeric,
  payload jsonb,
  created_at timestamp with time zone DEFAULT now(),
  resolved_at timestamp with time zone,
  resolution text
);

CREATE TABLE restaurant_identities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  source text NOT NULL,
  source_id text NOT NULL,
  source_url text,
  confidence numeric(4,3),
  match_method text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE restaurant_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  url text NOT NULL,
  normalized_url text NOT NULL,
  host text,
  source text NOT NULL DEFAULT 'denue'::text,
  link_type text NOT NULL DEFAULT 'unknown'::text,
  provider text,
  status text NOT NULL DEFAULT 'candidate'::text,
  confidence_score numeric(4,3),
  http_status integer,
  final_url text,
  final_host text,
  content_type text,
  title text,
  checked_at timestamp with time zone,
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE restaurants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  denue_id text,
  nombre text NOT NULL,
  razon_social text,
  codigo_scian text,
  actividad text,
  estrato text,
  telefono text,
  correo_electronico text,
  sitio_web text,
  instagram text,
  facebook text,
  tipo_vialidad text,
  nom_vialidad text,
  numero_exterior text,
  numero_interior text,
  colonia text,
  alcaldia text,
  cp text,
  latitud numeric(10,7),
  longitud numeric(10,7),
  osm_id text,
  cuisine_type text,
  horaires text,
  google_place_id text,
  verified_open boolean,
  verified_at timestamp with time zone,
  categorie text,
  gamme_prix text,
  statut text NOT NULL DEFAULT 'actif'::text,
  source text NOT NULL DEFAULT 'denue'::text,
  prospect_statut text DEFAULT 'non_contacte'::text,
  contact_nom text,
  contact_poste text,
  derniere_contact timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  search_vector tsvector
);

CREATE TABLE schedules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  template_slug text,
  recurrence text,
  config jsonb DEFAULT '{}'::jsonb,
  active boolean DEFAULT true,
  last_generated_at timestamp with time zone,
  next_run_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE seo_publish_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_slug text NOT NULL,
  article_title text NOT NULL,
  article_slug text NOT NULL,
  article_url text,
  relay_url text,
  published_at timestamp with time zone NOT NULL DEFAULT now(),
  triggered_by text NOT NULL DEFAULT 'cron'::text
);

CREATE TABLE seo_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_slug text NOT NULL,
  article_title text NOT NULL,
  article_slug text NOT NULL,
  article_body_html text NOT NULL,
  meta_description text NOT NULL,
  target_keyword text NOT NULL,
  reading_minutes integer NOT NULL DEFAULT 3,
  publish_at timestamp with time zone NOT NULL,
  published_at timestamp with time zone,
  article_url text,
  relay_url text,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE source_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_id text NOT NULL,
  scrape_date date NOT NULL DEFAULT CURRENT_DATE,
  scraped_at timestamp with time zone NOT NULL DEFAULT now(),
  name text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  address text,
  phone text,
  website text,
  payload jsonb NOT NULL,
  processed_at timestamp with time zone,
  matched_restaurant_id uuid,
  match_confidence numeric(4,3),
  match_method text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE webhooks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  kind text NOT NULL,
  provider text NOT NULL DEFAULT 'make'::text,
  url text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE wines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  name text NOT NULL,
  domain text,
  appellation text,
  region text,
  country text DEFAULT 'France'::text,
  vintage integer,
  color text NOT NULL,
  style text,
  grapes text[],
  tasting_notes text,
  fabrice_note text,
  price_glass_cts integer,
  price_bottle_cts integer,
  available boolean DEFAULT true,
  featured_last_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- ============================================================
-- CONTRAINTES (clés primaires, uniques, étrangères, checks)
-- ============================================================
ALTER TABLE actions_log ADD CONSTRAINT actions_log_pkey PRIMARY KEY (id);
ALTER TABLE brand_kits ADD CONSTRAINT brand_kits_pkey PRIMARY KEY (id);
ALTER TABLE clients ADD CONSTRAINT clients_pkey PRIMARY KEY (id);
ALTER TABLE drafts ADD CONSTRAINT drafts_pkey PRIMARY KEY (id);
ALTER TABLE menu_documents ADD CONSTRAINT menu_documents_pkey PRIMARY KEY (id);
ALTER TABLE menu_items ADD CONSTRAINT menu_items_pkey PRIMARY KEY (id);
ALTER TABLE photos ADD CONSTRAINT photos_pkey PRIMARY KEY (id);
ALTER TABLE pipeline_events ADD CONSTRAINT pipeline_events_pkey PRIMARY KEY (id);
ALTER TABLE restaurant_duplicate_candidates ADD CONSTRAINT restaurant_duplicate_candidates_pkey PRIMARY KEY (id);
ALTER TABLE restaurant_identities ADD CONSTRAINT restaurant_identities_pkey PRIMARY KEY (id);
ALTER TABLE restaurant_links ADD CONSTRAINT restaurant_links_pkey PRIMARY KEY (id);
ALTER TABLE restaurants ADD CONSTRAINT restaurants_pkey PRIMARY KEY (id);
ALTER TABLE schedules ADD CONSTRAINT schedules_pkey PRIMARY KEY (id);
ALTER TABLE seo_publish_log ADD CONSTRAINT seo_publish_log_pkey PRIMARY KEY (id);
ALTER TABLE seo_queue ADD CONSTRAINT seo_queue_pkey PRIMARY KEY (id);
ALTER TABLE source_records ADD CONSTRAINT source_records_pkey PRIMARY KEY (id);
ALTER TABLE webhooks ADD CONSTRAINT webhooks_pkey PRIMARY KEY (id);
ALTER TABLE wines ADD CONSTRAINT wines_pkey PRIMARY KEY (id);

ALTER TABLE brand_kits ADD CONSTRAINT brand_kits_client_id_key UNIQUE (client_id);
ALTER TABLE clients ADD CONSTRAINT clients_slug_key UNIQUE (slug);
ALTER TABLE menu_documents ADD CONSTRAINT menu_documents_restaurant_id_source_url_key UNIQUE (restaurant_id, source_url);
ALTER TABLE photos ADD CONSTRAINT photos_client_filename_unique UNIQUE (client_id, filename);
ALTER TABLE restaurant_identities ADD CONSTRAINT restaurant_identities_source_source_id_key UNIQUE (source, source_id);
ALTER TABLE restaurant_links ADD CONSTRAINT restaurant_links_restaurant_id_normalized_url_key UNIQUE (restaurant_id, normalized_url);
ALTER TABLE restaurants ADD CONSTRAINT restaurants_denue_id_key UNIQUE (denue_id);
ALTER TABLE schedules ADD CONSTRAINT schedules_client_template_unique UNIQUE (client_id, template_slug);
ALTER TABLE source_records ADD CONSTRAINT source_records_source_source_id_scrape_date_key UNIQUE (source, source_id, scrape_date);
ALTER TABLE webhooks ADD CONSTRAINT webhooks_client_kind_provider_unique UNIQUE (client_id, kind, provider);

ALTER TABLE actions_log ADD CONSTRAINT actions_log_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE actions_log ADD CONSTRAINT actions_log_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE SET NULL;
ALTER TABLE brand_kits ADD CONSTRAINT brand_kits_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE drafts ADD CONSTRAINT drafts_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE menu_documents ADD CONSTRAINT menu_documents_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE;
ALTER TABLE menu_items ADD CONSTRAINT menu_items_menu_document_id_fkey FOREIGN KEY (menu_document_id) REFERENCES menu_documents(id) ON DELETE SET NULL;
ALTER TABLE menu_items ADD CONSTRAINT menu_items_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE;
ALTER TABLE photos ADD CONSTRAINT photos_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE restaurant_duplicate_candidates ADD CONSTRAINT restaurant_duplicate_candidates_duplicate_id_fkey FOREIGN KEY (duplicate_id) REFERENCES restaurants(id) ON DELETE SET NULL;
ALTER TABLE restaurant_duplicate_candidates ADD CONSTRAINT restaurant_duplicate_candidates_master_id_fkey FOREIGN KEY (master_id) REFERENCES restaurants(id) ON DELETE SET NULL;
ALTER TABLE restaurant_identities ADD CONSTRAINT restaurant_identities_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE;
ALTER TABLE restaurant_links ADD CONSTRAINT restaurant_links_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE;
ALTER TABLE schedules ADD CONSTRAINT schedules_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE source_records ADD CONSTRAINT source_records_matched_restaurant_id_fkey FOREIGN KEY (matched_restaurant_id) REFERENCES restaurants(id) ON DELETE SET NULL;
ALTER TABLE webhooks ADD CONSTRAINT webhooks_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE wines ADD CONSTRAINT wines_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE pipeline_events ADD CONSTRAINT pipeline_events_status_check CHECK ((status = ANY (ARRAY['working'::text, 'blocked'::text, 'done'::text, 'idle'::text])));

-- ============================================================
-- VUES (l'ordre compte : les tiers s'enchaînent, puis score → search → MV → facettes)
-- ============================================================
CREATE OR REPLACE VIEW tier_0_all AS
 SELECT id, denue_id, nombre, razon_social, codigo_scian, actividad, estrato, telefono, correo_electronico, sitio_web, instagram, facebook, tipo_vialidad, nom_vialidad, numero_exterior, numero_interior, colonia, alcaldia, cp, latitud, longitud, osm_id, cuisine_type, horaires, google_place_id, verified_open, verified_at, categorie, gamme_prix, statut, source, prospect_statut, contact_nom, contact_poste, derniere_contact, notes, created_at, updated_at, search_vector
   FROM restaurants;

CREATE OR REPLACE VIEW tier_1_active AS
 SELECT id, denue_id, nombre, razon_social, codigo_scian, actividad, estrato, telefono, correo_electronico, sitio_web, instagram, facebook, tipo_vialidad, nom_vialidad, numero_exterior, numero_interior, colonia, alcaldia, cp, latitud, longitud, osm_id, cuisine_type, horaires, google_place_id, verified_open, verified_at, categorie, gamme_prix, statut, source, prospect_statut, contact_nom, contact_poste, derniere_contact, notes, created_at, updated_at, search_vector
   FROM restaurants r
  WHERE ((statut = 'actif'::text) AND (NOT (EXISTS ( SELECT 1
           FROM source_records sr
          WHERE ((sr.matched_restaurant_id = r.id) AND (sr.source = 'cdmx_invea_suspendidos'::text))))));

CREATE OR REPLACE VIEW tier_2_real_food AS
 SELECT id, denue_id, nombre, razon_social, codigo_scian, actividad, estrato, telefono, correo_electronico, sitio_web, instagram, facebook, tipo_vialidad, nom_vialidad, numero_exterior, numero_interior, colonia, alcaldia, cp, latitud, longitud, osm_id, cuisine_type, horaires, google_place_id, verified_open, verified_at, categorie, gamme_prix, statut, source, prospect_statut, contact_nom, contact_poste, derniere_contact, notes, created_at, updated_at, search_vector
   FROM tier_1_active r
  WHERE ((codigo_scian ~~ '7225%'::text) AND (NOT (EXISTS ( SELECT 1
           FROM source_records sr
          WHERE ((sr.matched_restaurant_id = r.id) AND (sr.source = 'cdmx_mercados_publicos'::text))))));

CREATE OR REPLACE VIEW tier_3_geo_premium AS
 SELECT id, denue_id, nombre, razon_social, codigo_scian, actividad, estrato, telefono, correo_electronico, sitio_web, instagram, facebook, tipo_vialidad, nom_vialidad, numero_exterior, numero_interior, colonia, alcaldia, cp, latitud, longitud, osm_id, cuisine_type, horaires, google_place_id, verified_open, verified_at, categorie, gamme_prix, statut, source, prospect_statut, contact_nom, contact_poste, derniere_contact, notes, created_at, updated_at, search_vector
   FROM tier_2_real_food r
  WHERE (upper(unaccent(COALESCE(alcaldia, ''::text))) = ANY (ARRAY['CUAUHTEMOC'::text, 'BENITO JUAREZ'::text, 'MIGUEL HIDALGO'::text, 'COYOACAN'::text, 'ALVARO OBREGON'::text, 'CUAJIMALPA DE MORELOS'::text, 'TLALPAN'::text]));

CREATE OR REPLACE VIEW tier_4_volume AS
 SELECT id, denue_id, nombre, razon_social, codigo_scian, actividad, estrato, telefono, correo_electronico, sitio_web, instagram, facebook, tipo_vialidad, nom_vialidad, numero_exterior, numero_interior, colonia, alcaldia, cp, latitud, longitud, osm_id, cuisine_type, horaires, google_place_id, verified_open, verified_at, categorie, gamme_prix, statut, source, prospect_statut, contact_nom, contact_poste, derniere_contact, notes, created_at, updated_at, search_vector
   FROM tier_3_geo_premium r
  WHERE (((estrato IS NOT NULL) AND (regexp_replace(estrato, '\D'::text, ''::text, 'g'::text) ~ '^\d+$'::text) AND ((regexp_replace(estrato, '\D'::text, ''::text, 'g'::text))::integer >= 11)) OR (EXISTS ( SELECT 1
           FROM source_records sr
          WHERE ((sr.matched_restaurant_id = r.id) AND (sr.source = ANY (ARRAY['michelin'::text, 'worlds50best'::text]))))));

CREATE OR REPLACE VIEW tier_5_enriched AS
 SELECT id, denue_id, nombre, razon_social, codigo_scian, actividad, estrato, telefono, correo_electronico, sitio_web, instagram, facebook, tipo_vialidad, nom_vialidad, numero_exterior, numero_interior, colonia, alcaldia, cp, latitud, longitud, osm_id, cuisine_type, horaires, google_place_id, verified_open, verified_at, categorie, gamme_prix, statut, source, prospect_statut, contact_nom, contact_poste, derniere_contact, notes, created_at, updated_at, search_vector
   FROM tier_4_volume r
  WHERE ((google_place_id IS NOT NULL) OR (EXISTS ( SELECT 1
           FROM restaurant_identities ri
          WHERE ((ri.restaurant_id = r.id) AND (ri.source = ANY (ARRAY['foursquare'::text, 'resy'::text, 'opentable'::text, 'michelin'::text, 'editorial'::text, 'worlds50best'::text, 'chilango'::text]))))));

CREATE OR REPLACE VIEW tier_6_qualified AS
 SELECT id, denue_id, nombre, razon_social, codigo_scian, actividad, estrato, telefono, correo_electronico, sitio_web, instagram, facebook, tipo_vialidad, nom_vialidad, numero_exterior, numero_interior, colonia, alcaldia, cp, latitud, longitud, osm_id, cuisine_type, horaires, google_place_id, verified_open, verified_at, categorie, gamme_prix, statut, source, prospect_statut, contact_nom, contact_poste, derniere_contact, notes, created_at, updated_at, search_vector
   FROM tier_5_enriched r
  WHERE (EXISTS ( SELECT 1
           FROM source_records sr
          WHERE ((sr.matched_restaurant_id = r.id) AND ((
                CASE
                    WHEN ((sr.payload ->> 'rating'::text) ~ '^[0-9]+(\.[0-9]+)?$'::text) THEN ((sr.payload ->> 'rating'::text))::numeric
                    ELSE NULL::numeric
                END >= 4.0) OR (
                CASE
                    WHEN (((sr.payload -> 'rating'::text) ->> 'average'::text) ~ '^[0-9]+(\.[0-9]+)?$'::text) THEN (((sr.payload -> 'rating'::text) ->> 'average'::text))::numeric
                    ELSE NULL::numeric
                END >= 4.0) OR (
                CASE
                    WHEN ((((((sr.payload -> 'statistics'::text) -> 'reviews'::text) -> 'ratings'::text) -> 'overall'::text) ->> 'rating'::text) ~ '^[0-9]+(\.[0-9]+)?$'::text) THEN ((((((sr.payload -> 'statistics'::text) -> 'reviews'::text) -> 'ratings'::text) -> 'overall'::text) ->> 'rating'::text))::numeric
                    ELSE NULL::numeric
                END >= 4.0)) AND (COALESCE(
                CASE
                    WHEN ((sr.payload ->> 'userRatingCount'::text) ~ '^\d+$'::text) THEN ((sr.payload ->> 'userRatingCount'::text))::integer
                    ELSE NULL::integer
                END,
                CASE
                    WHEN ((sr.payload ->> 'reviewCount'::text) ~ '^\d+$'::text) THEN ((sr.payload ->> 'reviewCount'::text))::integer
                    ELSE NULL::integer
                END,
                CASE
                    WHEN (((sr.payload -> 'rating'::text) ->> 'count'::text) ~ '^\d+$'::text) THEN (((sr.payload -> 'rating'::text) ->> 'count'::text))::integer
                    ELSE NULL::integer
                END,
                CASE
                    WHEN ((((sr.payload -> 'statistics'::text) -> 'reviews'::text) ->> 'allTimeTextReviewCount'::text) ~ '^\d+$'::text) THEN ((((sr.payload -> 'statistics'::text) -> 'reviews'::text) ->> 'allTimeTextReviewCount'::text))::integer
                    ELSE NULL::integer
                END, 0) >= 50))));

CREATE OR REPLACE VIEW restaurant_score AS
 WITH qualified AS (
         SELECT * FROM tier_6_qualified
        ), michelin AS (
         SELECT sr.matched_restaurant_id AS restaurant_id,
            max(COALESCE(((sr.payload ->> 'michelinStars'::text))::integer, 0)) AS michelin_stars
           FROM source_records sr
          WHERE ((sr.matched_restaurant_id IS NOT NULL) AND (sr.source = 'michelin'::text))
          GROUP BY sr.matched_restaurant_id
        ), worlds50best AS (
         SELECT sr.matched_restaurant_id AS restaurant_id,
            count(DISTINCT (sr.payload ->> 'awardBody'::text)) FILTER (WHERE (COALESCE((sr.payload ->> 'signalTier'::text), ''::text) = ANY (ARRAY['A'::text, 'A+'::text]))) AS award_count
           FROM source_records sr
          WHERE ((sr.matched_restaurant_id IS NOT NULL) AND (sr.source = 'worlds50best'::text))
          GROUP BY sr.matched_restaurant_id
        ), volume AS (
         SELECT sr.matched_restaurant_id AS restaurant_id,
            max(GREATEST(COALESCE(
                CASE
                    WHEN ((sr.payload ->> 'userRatingCount'::text) ~ '^\d+$'::text) THEN ((sr.payload ->> 'userRatingCount'::text))::integer
                    ELSE NULL::integer
                END, 0), COALESCE(
                CASE
                    WHEN ((sr.payload ->> 'reviewCount'::text) ~ '^\d+$'::text) THEN ((sr.payload ->> 'reviewCount'::text))::integer
                    ELSE NULL::integer
                END, 0), COALESCE(
                CASE
                    WHEN (((sr.payload -> 'rating'::text) ->> 'count'::text) ~ '^\d+$'::text) THEN (((sr.payload -> 'rating'::text) ->> 'count'::text))::integer
                    ELSE NULL::integer
                END, 0), COALESCE(
                CASE
                    WHEN ((((sr.payload -> 'statistics'::text) -> 'reviews'::text) ->> 'allTimeTextReviewCount'::text) ~ '^\d+$'::text) THEN ((((sr.payload -> 'statistics'::text) -> 'reviews'::text) ->> 'allTimeTextReviewCount'::text))::integer
                    ELSE NULL::integer
                END, 0))) AS max_user_rating_count,
            max(GREATEST(COALESCE(
                CASE
                    WHEN ((sr.payload ->> 'rating'::text) ~ '^[0-9]+(\.[0-9]+)?$'::text) THEN ((sr.payload ->> 'rating'::text))::numeric
                    ELSE NULL::numeric
                END, (0)::numeric), COALESCE(
                CASE
                    WHEN (((sr.payload -> 'rating'::text) ->> 'average'::text) ~ '^[0-9]+(\.[0-9]+)?$'::text) THEN (((sr.payload -> 'rating'::text) ->> 'average'::text))::numeric
                    ELSE NULL::numeric
                END, (0)::numeric), COALESCE(
                CASE
                    WHEN ((((((sr.payload -> 'statistics'::text) -> 'reviews'::text) -> 'ratings'::text) -> 'overall'::text) ->> 'rating'::text) ~ '^[0-9]+(\.[0-9]+)?$'::text) THEN ((((((sr.payload -> 'statistics'::text) -> 'reviews'::text) -> 'ratings'::text) -> 'overall'::text) ->> 'rating'::text))::numeric
                    ELSE NULL::numeric
                END, (0)::numeric))) AS max_rating
           FROM source_records sr
          WHERE (sr.matched_restaurant_id IS NOT NULL)
          GROUP BY sr.matched_restaurant_id
        ), cross_source AS (
         SELECT ri.restaurant_id,
            count(DISTINCT ri.source) AS identity_sources
           FROM restaurant_identities ri
          WHERE ((ri.match_method = 'identity_cached'::text) AND (ri.source = ANY (ARRAY['foursquare'::text, 'resy'::text, 'opentable'::text, 'michelin'::text, 'editorial'::text, 'worlds50best'::text, 'chilango'::text])))
          GROUP BY ri.restaurant_id
        ), completion AS (
         SELECT r_1.id AS restaurant_id,
            ((((
                CASE
                    WHEN (NULLIF(TRIM(BOTH FROM r_1.sitio_web), ''::text) IS NOT NULL) THEN 1
                    ELSE 0
                END +
                CASE
                    WHEN (NULLIF(TRIM(BOTH FROM r_1.instagram), ''::text) IS NOT NULL) THEN 1
                    ELSE 0
                END) +
                CASE
                    WHEN (NULLIF(TRIM(BOTH FROM r_1.horaires), ''::text) IS NOT NULL) THEN 1
                    ELSE 0
                END) +
                CASE
                    WHEN (NULLIF(TRIM(BOTH FROM r_1.telefono), ''::text) IS NOT NULL) THEN 1
                    ELSE 0
                END) +
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM menu_items mi
                      WHERE (mi.restaurant_id = r_1.id))) THEN 1
                    ELSE 0
                END) AS completion_hits
           FROM qualified r_1
        ), editorial AS (
         SELECT sr.matched_restaurant_id AS restaurant_id,
            count(DISTINCT sr.source) FILTER (WHERE (sr.source = ANY (ARRAY['editorial'::text, 'chilango'::text, 'worlds50best'::text]))) AS editorial_sources
           FROM source_records sr
          WHERE (sr.matched_restaurant_id IS NOT NULL)
          GROUP BY sr.matched_restaurant_id
        )
 SELECT r.*,
    LEAST((25)::bigint, ((COALESCE(m.michelin_stars, 0) * 8) + (COALESCE(w.award_count, (0)::bigint) * 5))) AS signal_prestige,
    LEAST((20)::numeric, round(((log((10)::numeric, (GREATEST(COALESCE(v.max_user_rating_count, 0), 1))::numeric) / 5.0) * (20)::numeric), 2)) AS signal_volume,
    LEAST((20)::numeric, GREATEST((0)::numeric, round((((COALESCE(v.max_rating, (0)::numeric) - 3.5) / 1.5) * (20)::numeric), 2))) AS signal_quality,
    LEAST((15)::bigint, (COALESCE(cs.identity_sources, (0)::bigint) * 3)) AS signal_cross_source,
    round((((COALESCE(c.completion_hits, 0))::numeric / (5)::numeric) * (10)::numeric), 2) AS signal_completion,
    LEAST((10)::bigint, (COALESCE(e.editorial_sources, (0)::bigint) * 3)) AS signal_editorial,
    round(((((((LEAST((25)::bigint, ((COALESCE(m.michelin_stars, 0) * 8) + (COALESCE(w.award_count, (0)::bigint) * 5))))::numeric + LEAST((20)::numeric, round(((log((10)::numeric, (GREATEST(COALESCE(v.max_user_rating_count, 0), 1))::numeric) / 5.0) * (20)::numeric), 2))) + LEAST((20)::numeric, GREATEST((0)::numeric, round((((COALESCE(v.max_rating, (0)::numeric) - 3.5) / 1.5) * (20)::numeric), 2)))) + (LEAST((15)::bigint, (COALESCE(cs.identity_sources, (0)::bigint) * 3)))::numeric) + round((((COALESCE(c.completion_hits, 0))::numeric / (5)::numeric) * (10)::numeric), 2)) + (LEAST((10)::bigint, (COALESCE(e.editorial_sources, (0)::bigint) * 3)))::numeric), 2) AS score,
    row_number() OVER (ORDER BY (round(((((((LEAST((25)::bigint, ((COALESCE(m.michelin_stars, 0) * 8) + (COALESCE(w.award_count, (0)::bigint) * 5))))::numeric + LEAST((20)::numeric, round(((log((10)::numeric, (GREATEST(COALESCE(v.max_user_rating_count, 0), 1))::numeric) / 5.0) * (20)::numeric), 2))) + LEAST((20)::numeric, GREATEST((0)::numeric, round((((COALESCE(v.max_rating, (0)::numeric) - 3.5) / 1.5) * (20)::numeric), 2)))) + (LEAST((15)::bigint, (COALESCE(cs.identity_sources, (0)::bigint) * 3)))::numeric) + round((((COALESCE(c.completion_hits, 0))::numeric / (5)::numeric) * (10)::numeric), 2)) + (LEAST((10)::bigint, (COALESCE(e.editorial_sources, (0)::bigint) * 3)))::numeric), 2)) DESC, r.nombre) AS rank_overall,
    row_number() OVER (PARTITION BY r.alcaldia ORDER BY (round(((((((LEAST((25)::bigint, ((COALESCE(m.michelin_stars, 0) * 8) + (COALESCE(w.award_count, (0)::bigint) * 5))))::numeric + LEAST((20)::numeric, round(((log((10)::numeric, (GREATEST(COALESCE(v.max_user_rating_count, 0), 1))::numeric) / 5.0) * (20)::numeric), 2))) + LEAST((20)::numeric, GREATEST((0)::numeric, round((((COALESCE(v.max_rating, (0)::numeric) - 3.5) / 1.5) * (20)::numeric), 2)))) + (LEAST((15)::bigint, (COALESCE(cs.identity_sources, (0)::bigint) * 3)))::numeric) + round((((COALESCE(c.completion_hits, 0))::numeric / (5)::numeric) * (10)::numeric), 2)) + (LEAST((10)::bigint, (COALESCE(e.editorial_sources, (0)::bigint) * 3)))::numeric), 2)) DESC, r.nombre) AS rank_alcaldia
   FROM ((((((qualified r
     LEFT JOIN michelin m ON ((m.restaurant_id = r.id)))
     LEFT JOIN worlds50best w ON ((w.restaurant_id = r.id)))
     LEFT JOIN volume v ON ((v.restaurant_id = r.id)))
     LEFT JOIN cross_source cs ON ((cs.restaurant_id = r.id)))
     LEFT JOIN completion c ON ((c.restaurant_id = r.id)))
     LEFT JOIN editorial e ON ((e.restaurant_id = r.id)));

CREATE OR REPLACE VIEW restaurant_search AS
 WITH gp AS (
         SELECT DISTINCT ON (source_records.matched_restaurant_id) source_records.matched_restaurant_id AS restaurant_id,
            source_records.payload
           FROM source_records
          WHERE ((source_records.source = 'google_places'::text) AND (source_records.matched_restaurant_id IS NOT NULL))
          ORDER BY source_records.matched_restaurant_id, source_records.scrape_date DESC, source_records.scraped_at DESC
        ), mi AS (
         SELECT DISTINCT ON (source_records.matched_restaurant_id) source_records.matched_restaurant_id AS restaurant_id,
            source_records.payload
           FROM source_records
          WHERE ((source_records.source = 'michelin'::text) AND (source_records.matched_restaurant_id IS NOT NULL))
          ORDER BY source_records.matched_restaurant_id, source_records.scrape_date DESC, source_records.scraped_at DESC
        ), w50 AS (
         SELECT DISTINCT ON (source_records.matched_restaurant_id) source_records.matched_restaurant_id AS restaurant_id,
            source_records.payload
           FROM source_records
          WHERE ((source_records.source = 'worlds50best'::text) AND (source_records.matched_restaurant_id IS NOT NULL))
          ORDER BY source_records.matched_restaurant_id, source_records.scrape_date DESC, source_records.scraped_at DESC
        ), ot AS (
         SELECT DISTINCT ON (source_records.matched_restaurant_id) source_records.matched_restaurant_id AS restaurant_id,
            source_records.payload
           FROM source_records
          WHERE ((source_records.source = 'opentable'::text) AND (source_records.matched_restaurant_id IS NOT NULL))
          ORDER BY source_records.matched_restaurant_id, source_records.scrape_date DESC, source_records.scraped_at DESC
        )
 SELECT r.id,
    COALESCE(NULLIF(((gp.payload -> 'displayName'::text) ->> 'text'::text), ''::text), r.nombre) AS name,
    r.colonia,
    r.alcaldia,
    COALESCE((gp.payload ->> 'formattedAddress'::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, r.tipo_vialidad, r.nom_vialidad, NULLIF(r.numero_exterior, '0'::text))), ''::text)) AS address,
    r.latitud AS lat,
    r.longitud AS lng,
    COALESCE((gp.payload ->> 'nationalPhoneNumber'::text), r.telefono) AS phone,
    COALESCE((gp.payload ->> 'websiteUri'::text), r.sitio_web) AS website,
    r.instagram,
    ((gp.payload ->> 'rating'::text))::numeric AS rating,
    ((gp.payload ->> 'userRatingCount'::text))::integer AS review_count,
        CASE (gp.payload ->> 'priceLevel'::text)
            WHEN 'PRICE_LEVEL_INEXPENSIVE'::text THEN 1
            WHEN 'PRICE_LEVEL_MODERATE'::text THEN 2
            WHEN 'PRICE_LEVEL_EXPENSIVE'::text THEN 3
            WHEN 'PRICE_LEVEL_VERY_EXPENSIVE'::text THEN 4
            ELSE NULL::integer
        END AS price_level,
    (((gp.payload -> 'photos'::text) -> 0) ->> 'name'::text) AS photo_ref,
    ( SELECT jsonb_agg((e.value ->> 'name'::text)) AS jsonb_agg
           FROM jsonb_array_elements((gp.payload -> 'photos'::text)) e(value)) AS photo_refs,
    COALESCE(jsonb_array_length((gp.payload -> 'photos'::text)), 0) AS photo_count,
    ((gp.payload -> 'editorialSummary'::text) ->> 'text'::text) AS summary,
    ((gp.payload -> 'regularOpeningHours'::text) -> 'weekdayDescriptions'::text) AS hours,
    (gp.payload ->> 'googleMapsUri'::text) AS google_maps_uri,
    (gp.payload ->> 'businessStatus'::text) AS business_status,
    COALESCE(
        CASE
            WHEN (((gp.payload ->> 'primaryType'::text) IS NOT NULL) AND ((gp.payload ->> 'primaryType'::text) <> ALL (ARRAY['restaurant'::text, 'food'::text, 'point_of_interest'::text]))) THEN regexp_replace((gp.payload ->> 'primaryType'::text), '_restaurant$'::text, ''::text)
            ELSE NULL::text
        END, NULLIF(lower(split_part(r.cuisine_type, ';'::text, 1)), ''::text)) AS cuisine_key,
    (mi.payload ->> 'cuisine'::text) AS michelin_cuisine,
    (ot.payload ->> 'cuisine'::text) AS opentable_cuisine,
    (mi.payload ->> 'distinction'::text) AS michelin_distinction,
    COALESCE(((mi.payload ->> 'michelinStars'::text))::integer, 0) AS michelin_stars,
    COALESCE(((mi.payload ->> 'bibGourmand'::text))::boolean, false) AS bib_gourmand,
    (mi.payload ->> 'michelinUrl'::text) AS michelin_url,
    (w50.payload IS NOT NULL) AS in_worlds_50_best,
    (w50.payload ->> 'rank'::text) AS w50_rank,
    (w50.payload ->> 'listTitle'::text) AS w50_list,
    (ot.payload ->> 'profileLink'::text) AS opentable_url,
    rs.score,
    rs.rank_overall,
    (gp.payload IS NOT NULL) AS is_enriched,
    ((((gp.payload -> 'photos'::text) -> 0) ->> 'name'::text) IS NOT NULL) AS has_photo
   FROM (((((restaurants r
     LEFT JOIN gp ON ((gp.restaurant_id = r.id)))
     LEFT JOIN mi ON ((mi.restaurant_id = r.id)))
     LEFT JOIN w50 ON ((w50.restaurant_id = r.id)))
     LEFT JOIN ot ON ((ot.restaurant_id = r.id)))
     LEFT JOIN restaurant_score rs ON ((rs.id = r.id)))
  WHERE ((r.statut = 'actif'::text) AND (COALESCE((gp.payload ->> 'businessStatus'::text), 'OPERATIONAL'::text) <> 'CLOSED_PERMANENTLY'::text));

CREATE OR REPLACE VIEW restaurant_field_divergence AS
 SELECT r.id,
    r.nombre,
    r.gamme_prix AS legacy_gamme,
    (sr_google.payload ->> 'priceLevel'::text) AS google_price,
    COALESCE((sr_fsq.payload ->> 'price'::text), (sr_fsq.payload ->> 'price_tier'::text)) AS fsq_price,
    COALESCE((sr_ot.payload ->> 'priceBand'::text), ((sr_ot.payload -> 'raw'::text) ->> 'priceBand'::text)) AS ot_price,
    r.horaires AS legacy_horaires,
    ((sr_google.payload -> 'regularOpeningHours'::text) ->> 'weekdayDescriptions'::text) AS google_hours,
    COALESCE(((sr_fsq.payload -> 'hours'::text) ->> 'display'::text), (sr_fsq.payload ->> 'hours'::text)) AS fsq_hours,
    COALESCE((sr_ot.payload ->> 'hours'::text), ((sr_ot.payload -> 'raw'::text) ->> 'hours'::text)) AS ot_hours,
    r.sitio_web AS legacy_website,
    (sr_google.payload ->> 'websiteUri'::text) AS google_website,
    COALESCE((sr_fsq.payload ->> 'website'::text), (sr_fsq.payload ->> 'url'::text)) AS fsq_website,
    COALESCE((sr_ot.payload ->> 'profileLink'::text), ((sr_ot.payload -> 'raw'::text) ->> 'profileLink'::text)) AS ot_website,
    r.telefono AS legacy_phone,
    COALESCE((sr_google.payload ->> 'internationalPhoneNumber'::text), (sr_google.payload ->> 'nationalPhoneNumber'::text)) AS google_phone,
    COALESCE((sr_fsq.payload ->> 'tel'::text), ((sr_fsq.payload -> 'contact'::text) ->> 'phone'::text)) AS fsq_phone,
    COALESCE((sr_ot.payload ->> 'phone'::text), ((sr_ot.payload -> 'raw'::text) ->> 'phone'::text)) AS ot_phone
   FROM (((restaurants r
     LEFT JOIN LATERAL ( SELECT source_records.payload
           FROM source_records
          WHERE ((source_records.matched_restaurant_id = r.id) AND (source_records.source = 'google_places'::text))
          ORDER BY source_records.scrape_date DESC, source_records.scraped_at DESC
         LIMIT 1) sr_google ON (true))
     LEFT JOIN LATERAL ( SELECT source_records.payload
           FROM source_records
          WHERE ((source_records.matched_restaurant_id = r.id) AND (source_records.source = 'foursquare'::text))
          ORDER BY source_records.scrape_date DESC, source_records.scraped_at DESC
         LIMIT 1) sr_fsq ON (true))
     LEFT JOIN LATERAL ( SELECT source_records.payload
           FROM source_records
          WHERE ((source_records.matched_restaurant_id = r.id) AND (source_records.source = 'opentable'::text))
          ORDER BY source_records.scrape_date DESC, source_records.scraped_at DESC
         LIMIT 1) sr_ot ON (true))
  WHERE ((sr_google.payload IS NOT NULL) OR (sr_fsq.payload IS NOT NULL) OR (sr_ot.payload IS NOT NULL));

-- ============================================================
-- VUE MATÉRIALISÉE + vues de facettes qui en dépendent
-- ============================================================
CREATE MATERIALIZED VIEW restaurant_search_mv AS
 SELECT id, name, colonia, alcaldia, address, lat, lng, phone, website, instagram, rating, review_count, price_level, photo_ref, photo_refs, photo_count, summary, hours, google_maps_uri, business_status, cuisine_key, michelin_cuisine, opentable_cuisine, michelin_distinction, michelin_stars, bib_gourmand, michelin_url, in_worlds_50_best, w50_rank, w50_list, opentable_url, score, rank_overall, is_enriched, has_photo
   FROM restaurant_search;

CREATE OR REPLACE VIEW restaurant_facet_alcaldias AS
 SELECT alcaldia,
    (count(*))::integer AS total_count,
    (count(*) FILTER (WHERE is_enriched))::integer AS enriched_count
   FROM restaurant_search_mv
  WHERE (alcaldia IS NOT NULL)
  GROUP BY alcaldia
  ORDER BY ((count(*) FILTER (WHERE is_enriched))::integer) DESC, ((count(*))::integer) DESC;

CREATE OR REPLACE VIEW restaurant_facet_cuisines AS
 SELECT cuisine_key,
    (count(*))::integer AS total_count,
    (count(*) FILTER (WHERE is_enriched))::integer AS enriched_count
   FROM restaurant_search_mv
  WHERE (cuisine_key IS NOT NULL)
  GROUP BY cuisine_key
 HAVING (count(*) FILTER (WHERE is_enriched) > 0)
  ORDER BY ((count(*) FILTER (WHERE is_enriched))::integer) DESC;

CREATE OR REPLACE FUNCTION public.refresh_restaurant_search()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '600s'
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY restaurant_search_mv;
END;
$function$;

-- ============================================================
-- INDEX (hors index créés implicitement par les contraintes)
-- ============================================================
CREATE INDEX drafts_instagram_post_id_idx ON public.drafts USING btree (instagram_post_id) WHERE (instagram_post_id IS NOT NULL);
CREATE INDEX drafts_published_at_idx ON public.drafts USING btree (published_at) WHERE (published_at IS NOT NULL);
CREATE INDEX drafts_scheduled_idx ON public.drafts USING btree (client_id, status, last_publish_attempt_at) WHERE ((status = 'scheduled'::text) AND (instagram_post_id IS NULL));
CREATE INDEX idx_duplicate_candidates_duplicate ON public.restaurant_duplicate_candidates USING btree (duplicate_id);
CREATE INDEX idx_duplicate_candidates_master ON public.restaurant_duplicate_candidates USING btree (master_id);
CREATE INDEX idx_duplicate_candidates_rule ON public.restaurant_duplicate_candidates USING btree (rule);
CREATE INDEX idx_duplicate_candidates_unresolved ON public.restaurant_duplicate_candidates USING btree (rule, confidence) WHERE (resolved_at IS NULL);
CREATE INDEX idx_menu_documents_restaurant ON public.menu_documents USING btree (restaurant_id);
CREATE INDEX idx_menu_documents_statut ON public.menu_documents USING btree (statut);
CREATE INDEX idx_menu_items_restaurant ON public.menu_items USING btree (restaurant_id);
CREATE INDEX idx_restaurant_identities_restaurant ON public.restaurant_identities USING btree (restaurant_id);
CREATE INDEX idx_restaurant_identities_source ON public.restaurant_identities USING btree (source);
CREATE INDEX idx_restaurant_links_confidence ON public.restaurant_links USING btree (confidence_score);
CREATE INDEX idx_restaurant_links_host ON public.restaurant_links USING btree (host);
CREATE INDEX idx_restaurant_links_provider ON public.restaurant_links USING btree (provider);
CREATE INDEX idx_restaurant_links_restaurant ON public.restaurant_links USING btree (restaurant_id);
CREATE INDEX idx_restaurant_links_status ON public.restaurant_links USING btree (status);
CREATE INDEX idx_restaurant_links_type ON public.restaurant_links USING btree (link_type);
CREATE INDEX idx_restaurants_alcaldia ON public.restaurants USING btree (alcaldia);
CREATE INDEX idx_restaurants_categorie ON public.restaurants USING btree (categorie);
CREATE INDEX idx_restaurants_coords ON public.restaurants USING btree (latitud, longitud);
CREATE INDEX idx_restaurants_prospect ON public.restaurants USING btree (prospect_statut);
CREATE INDEX idx_restaurants_scian ON public.restaurants USING btree (codigo_scian);
CREATE INDEX idx_restaurants_search ON public.restaurants USING gin (search_vector);
CREATE INDEX idx_restaurants_statut ON public.restaurants USING btree (statut);
CREATE INDEX idx_rsmv_alcaldia ON public.restaurant_search_mv USING btree (alcaldia);
CREATE INDEX idx_rsmv_colonia_trgm ON public.restaurant_search_mv USING gin (colonia gin_trgm_ops);
CREATE INDEX idx_rsmv_cuisine ON public.restaurant_search_mv USING btree (cuisine_key);
CREATE INDEX idx_rsmv_enriched ON public.restaurant_search_mv USING btree (is_enriched);
CREATE UNIQUE INDEX idx_rsmv_id ON public.restaurant_search_mv USING btree (id);
CREATE INDEX idx_rsmv_michelin ON public.restaurant_search_mv USING btree (michelin_distinction) WHERE (michelin_distinction IS NOT NULL);
CREATE INDEX idx_rsmv_name_trgm ON public.restaurant_search_mv USING gin (name gin_trgm_ops);
CREATE INDEX idx_rsmv_price ON public.restaurant_search_mv USING btree (price_level);
CREATE INDEX idx_rsmv_rating ON public.restaurant_search_mv USING btree (rating DESC NULLS LAST);
CREATE INDEX idx_rsmv_reviews ON public.restaurant_search_mv USING btree (review_count DESC NULLS LAST);
CREATE INDEX idx_rsmv_score ON public.restaurant_search_mv USING btree (score DESC NULLS LAST);
CREATE INDEX idx_rsmv_w50 ON public.restaurant_search_mv USING btree (in_worlds_50_best) WHERE in_worlds_50_best;
CREATE INDEX idx_source_records_coords ON public.source_records USING btree (latitude, longitude);
CREATE INDEX idx_source_records_matched ON public.source_records USING btree (matched_restaurant_id);
CREATE INDEX idx_source_records_payload_gin ON public.source_records USING gin (payload);
CREATE INDEX idx_source_records_processed ON public.source_records USING btree (processed_at);
CREATE INDEX idx_source_records_scrape_date ON public.source_records USING btree (scrape_date);
CREATE INDEX idx_source_records_source ON public.source_records USING btree (source);
CREATE INDEX photos_client_id_idx ON public.photos USING btree (client_id);
CREATE INDEX photos_last_used_idx ON public.photos USING btree (last_used_at DESC NULLS LAST);
CREATE INDEX photos_tags_gin_idx ON public.photos USING gin (tags);
CREATE INDEX photos_taken_at_idx ON public.photos USING btree (exif_taken_at DESC NULLS LAST);
CREATE INDEX schedules_client_id_idx ON public.schedules USING btree (client_id);
CREATE INDEX schedules_next_run_at_idx ON public.schedules USING btree (next_run_at) WHERE (active = true);
CREATE INDEX seo_publish_log_client_slug_idx ON public.seo_publish_log USING btree (client_slug, published_at DESC);
CREATE INDEX seo_queue_client_status ON public.seo_queue USING btree (client_slug, status);
CREATE INDEX seo_queue_publish_at ON public.seo_queue USING btree (publish_at) WHERE (status = 'pending'::text);
CREATE INDEX webhooks_lookup_idx ON public.webhooks USING btree (client_id, kind, provider, active);
CREATE INDEX wines_available_idx ON public.wines USING btree (available) WHERE (available = true);
CREATE INDEX wines_client_id_idx ON public.wines USING btree (client_id);
CREATE INDEX wines_featured_last_idx ON public.wines USING btree (featured_last_at);

-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE TRIGGER photos_set_updated_at_trg BEFORE UPDATE ON public.photos FOR EACH ROW EXECUTE FUNCTION photos_set_updated_at();
CREATE TRIGGER restaurant_identities_updated_at BEFORE UPDATE ON public.restaurant_identities FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER restaurant_links_updated_at BEFORE UPDATE ON public.restaurant_links FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER restaurants_search_vector BEFORE INSERT OR UPDATE ON public.restaurants FOR EACH ROW EXECUTE FUNCTION update_restaurant_search_vector();
CREATE TRIGGER restaurants_updated_at BEFORE UPDATE ON public.restaurants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER webhooks_updated_at_trg BEFORE UPDATE ON public.webhooks FOR EACH ROW EXECUTE FUNCTION webhooks_set_updated_at();
