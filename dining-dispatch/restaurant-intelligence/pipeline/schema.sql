-- ============================================================================
-- CDMX RESTAURANTS - schéma unifié
-- ============================================================================
-- Source de vérité unique pour la base. Tout est idempotent (IF NOT EXISTS),
-- ré-exécutable sans casse. Reflète l'état réel de la DB Supabase.
--
-- Architecture en 3 couches :
--   1. CANONIQUE   → restaurants (1 ligne par établissement réel)
--   2. ENRICHMENT  → restaurant_links, menu_documents, menu_items
--   3. STAGING     → source_records (raw scrapes), restaurant_identities (entity res)
-- ============================================================================

-- ─── helpers globaux ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COUCHE 1 — CANONIQUE
-- ============================================================================

-- Table principale : 1 ligne = 1 établissement (entité réelle, dédupliquée).
CREATE TABLE IF NOT EXISTS restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  denue_id TEXT UNIQUE,
  nombre TEXT NOT NULL,
  razon_social TEXT,
  codigo_scian TEXT,
  actividad TEXT,
  estrato TEXT,           -- DENUE : tranche d'employés (0-5, 6-10, 11-30, ...)

  telefono TEXT,
  correo_electronico TEXT,
  sitio_web TEXT,
  instagram TEXT,
  facebook TEXT,

  tipo_vialidad TEXT,
  nom_vialidad TEXT,
  numero_exterior TEXT,
  numero_interior TEXT,
  colonia TEXT,
  alcaldia TEXT,
  cp TEXT,

  latitud NUMERIC(10, 7),
  longitud NUMERIC(10, 7),

  osm_id TEXT,
  cuisine_type TEXT,
  horaires TEXT,

  google_place_id TEXT,
  verified_open BOOLEAN,
  verified_at TIMESTAMPTZ,

  categorie TEXT,         -- fine_dining, casual, street_food, bar, cafe, fast_food
  gamme_prix TEXT,        -- bas, moyen, haut

  statut TEXT NOT NULL DEFAULT 'actif',           -- actif, ferme, incertain
  source TEXT NOT NULL DEFAULT 'denue',            -- 1ère source qui a inséré

  prospect_statut TEXT DEFAULT 'non_contacte',
  contact_nom TEXT,
  contact_poste TEXT,
  derniere_contact TIMESTAMPTZ,
  notes TEXT,

  search_vector tsvector,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restaurants_alcaldia        ON restaurants(alcaldia);
CREATE INDEX IF NOT EXISTS idx_restaurants_statut          ON restaurants(statut);
CREATE INDEX IF NOT EXISTS idx_restaurants_source          ON restaurants(source);
CREATE INDEX IF NOT EXISTS idx_restaurants_prospect        ON restaurants(prospect_statut);
CREATE INDEX IF NOT EXISTS idx_restaurants_categorie       ON restaurants(categorie);
CREATE INDEX IF NOT EXISTS idx_restaurants_estrato         ON restaurants(estrato);
CREATE INDEX IF NOT EXISTS idx_restaurants_search_vector   ON restaurants USING gin (search_vector);
CREATE INDEX IF NOT EXISTS idx_restaurants_coords          ON restaurants(latitud, longitud);

DROP TRIGGER IF EXISTS restaurants_updated_at ON restaurants;
CREATE TRIGGER restaurants_updated_at
  BEFORE UPDATE ON restaurants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- COUCHE 2 — ENRICHMENT
-- ============================================================================

-- Tous les URLs liés à un resto : site officiel, social, livraison, menu, etc.
-- 1 resto peut en avoir plusieurs (même type) de sources différentes.
CREATE TABLE IF NOT EXISTS restaurant_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,

  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  host TEXT,
  source TEXT NOT NULL DEFAULT 'denue',     -- d'où vient le lien (denue, osm, crawl, ig_scrape, rappi, ...)

  link_type TEXT NOT NULL DEFAULT 'unknown', -- official_site, reservation, delivery, review, social, menu, contact, unknown
  provider TEXT,                             -- website, opentable, ubereats, rappi, instagram, facebook, ...
  status TEXT NOT NULL DEFAULT 'candidate',  -- candidate, valid, invalid, parked, timeout
  confidence_score NUMERIC(4, 3),

  http_status INTEGER,
  final_url TEXT,
  final_host TEXT,
  content_type TEXT,
  title TEXT,
  checked_at TIMESTAMPTZ,
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (restaurant_id, normalized_url)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_links_restaurant ON restaurant_links(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_links_type       ON restaurant_links(link_type);
CREATE INDEX IF NOT EXISTS idx_restaurant_links_provider   ON restaurant_links(provider);
CREATE INDEX IF NOT EXISTS idx_restaurant_links_status     ON restaurant_links(status);
CREATE INDEX IF NOT EXISTS idx_restaurant_links_host       ON restaurant_links(host);
CREATE INDEX IF NOT EXISTS idx_restaurant_links_confidence ON restaurant_links(confidence_score);

DROP TRIGGER IF EXISTS restaurant_links_updated_at ON restaurant_links;
CREATE TRIGGER restaurant_links_updated_at
  BEFORE UPDATE ON restaurant_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Menus collectés depuis le web (PDF / HTML / images), texte brut extrait.
CREATE TABLE IF NOT EXISTS menu_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,

  source_url TEXT NOT NULL,
  file_type TEXT NOT NULL,                  -- pdf, html, image, unknown
  raw_text TEXT,
  langue TEXT DEFAULT 'es',
  confidence_score NUMERIC(4, 3),
  extraction_method TEXT,                   -- website_crawl, pdf_parse, ocr, llm

  statut TEXT DEFAULT 'pending',            -- pending, fetched, extracted, failed
  last_checked_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (restaurant_id, source_url)
);

CREATE INDEX IF NOT EXISTS idx_menu_documents_restaurant ON menu_documents(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_menu_documents_statut     ON menu_documents(statut);
CREATE INDEX IF NOT EXISTS idx_menu_documents_file_type  ON menu_documents(file_type);
CREATE INDEX IF NOT EXISTS idx_menu_documents_raw_text   ON menu_documents USING gin (to_tsvector('simple', coalesce(raw_text, '')));

DROP TRIGGER IF EXISTS menu_documents_updated_at ON menu_documents;
CREATE TRIGGER menu_documents_updated_at
  BEFORE UPDATE ON menu_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Plats / prix structurés extraits des menu_documents.
-- À remplir par un extracteur LLM dans un 2e temps.
CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  menu_document_id UUID REFERENCES menu_documents(id) ON DELETE SET NULL,

  nom TEXT NOT NULL,
  description TEXT,
  categorie TEXT,
  prix NUMERIC(10, 2),
  devise TEXT DEFAULT 'MXN',

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant ON menu_items(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_nom        ON menu_items USING gin (to_tsvector('simple', nom));


-- ============================================================================
-- COUCHE 3 — STAGING & ENTITY RESOLUTION (nouveau)
-- ============================================================================

-- Raw dump immutable d'un scrape. 1 ligne = 1 enregistrement venant d'une source
-- externe, AVANT toute déduplication ou rapprochement.
-- Un fichier data/raw/<source>/<date>.json donne ~N lignes ici.
CREATE TABLE IF NOT EXISTS source_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  source TEXT NOT NULL,                     -- denue, osm, rappi, michelin, tripadvisor, ubereats, thefork, restaurantguru, instagram, google_places, ...
  source_id TEXT NOT NULL,                  -- id unique chez la source (rappi store_id, michelin slug, osm node id, ...)
  scrape_date DATE NOT NULL DEFAULT current_date,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Signaux normalisés pour faciliter l'entity resolution. Tous nullable.
  name TEXT,
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  address TEXT,
  phone TEXT,
  website TEXT,

  payload JSONB NOT NULL,                   -- l'enregistrement brut tel quel

  processed_at TIMESTAMPTZ,                 -- date à laquelle on a fait l'entity resolution
  matched_restaurant_id UUID REFERENCES restaurants(id) ON DELETE SET NULL,
  match_confidence NUMERIC(4, 3),
  match_method TEXT,                        -- denue_id, coords_50m, name_alcaldia, fuzzy_name, manual, new_insert

  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (source, source_id, scrape_date)
);

CREATE INDEX IF NOT EXISTS idx_source_records_source            ON source_records(source);
CREATE INDEX IF NOT EXISTS idx_source_records_scrape_date       ON source_records(scrape_date);
CREATE INDEX IF NOT EXISTS idx_source_records_processed         ON source_records(processed_at);
CREATE INDEX IF NOT EXISTS idx_source_records_matched           ON source_records(matched_restaurant_id);
CREATE INDEX IF NOT EXISTS idx_source_records_coords            ON source_records(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_source_records_payload_gin       ON source_records USING gin (payload);


-- Mapping persistant entre une entité externe et un restaurant canonique.
-- Ex: ('rappi', '12345') ↔ restaurant_id=abc. Permet de re-scraper Rappi sans
-- refaire l'entity resolution à chaque fois.
CREATE TABLE IF NOT EXISTS restaurant_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,

  source TEXT NOT NULL,                     -- rappi, michelin, osm, tripadvisor, google_places, ...
  source_id TEXT NOT NULL,
  source_url TEXT,                          -- URL canonique chez la source si pertinent

  confidence NUMERIC(4, 3),
  match_method TEXT,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_identities_restaurant ON restaurant_identities(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_identities_source     ON restaurant_identities(source);

DROP TRIGGER IF EXISTS restaurant_identities_updated_at ON restaurant_identities;
CREATE TRIGGER restaurant_identities_updated_at
  BEFORE UPDATE ON restaurant_identities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- COUCHE 4 — DATA QUALITY
-- ============================================================================

-- Paires suspectes de doublons. Cette table est une quarantaine : elle ne merge
-- rien directement. Les scripts y écrivent des candidats, puis un humain valide
-- ou rejette la paire via resolved_at + resolution.
CREATE TABLE IF NOT EXISTS restaurant_duplicate_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id UUID REFERENCES restaurants(id),
  duplicate_id UUID REFERENCES restaurants(id),
  rule TEXT NOT NULL,           -- name_coords, name_phone, name_address, same_place_id
  name_similarity NUMERIC,
  distance_meters NUMERIC,
  confidence NUMERIC,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolution TEXT               -- merged, kept_distinct, ignored
);

CREATE INDEX IF NOT EXISTS idx_duplicate_candidates_rule       ON restaurant_duplicate_candidates(rule);
CREATE INDEX IF NOT EXISTS idx_duplicate_candidates_master     ON restaurant_duplicate_candidates(master_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_candidates_duplicate  ON restaurant_duplicate_candidates(duplicate_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_candidates_unresolved ON restaurant_duplicate_candidates(rule, confidence)
  WHERE resolved_at IS NULL;

-- Vue d'audit des champs redondants entre canonique + sources enrichies.
CREATE OR REPLACE VIEW restaurant_field_divergence AS
SELECT
  r.id,
  r.nombre,
  r.gamme_prix AS legacy_gamme,
  sr_google.payload->>'priceLevel' AS google_price,
  COALESCE(sr_fsq.payload->>'price', sr_fsq.payload->>'price_tier') AS fsq_price,
  COALESCE(sr_ot.payload->>'priceBand', sr_ot.payload->'raw'->>'priceBand') AS ot_price,
  r.horaires AS legacy_horaires,
  sr_google.payload->'regularOpeningHours'->>'weekdayDescriptions' AS google_hours,
  COALESCE(sr_fsq.payload->'hours'->>'display', sr_fsq.payload->>'hours') AS fsq_hours,
  COALESCE(sr_ot.payload->>'hours', sr_ot.payload->'raw'->>'hours') AS ot_hours,
  r.sitio_web AS legacy_website,
  sr_google.payload->>'websiteUri' AS google_website,
  COALESCE(sr_fsq.payload->>'website', sr_fsq.payload->>'url') AS fsq_website,
  COALESCE(sr_ot.payload->>'profileLink', sr_ot.payload->'raw'->>'profileLink') AS ot_website,
  r.telefono AS legacy_phone,
  COALESCE(sr_google.payload->>'internationalPhoneNumber', sr_google.payload->>'nationalPhoneNumber') AS google_phone,
  COALESCE(sr_fsq.payload->>'tel', sr_fsq.payload->'contact'->>'phone') AS fsq_phone,
  COALESCE(sr_ot.payload->>'phone', sr_ot.payload->'raw'->>'phone') AS ot_phone
FROM restaurants r
LEFT JOIN LATERAL (
  SELECT payload
  FROM source_records
  WHERE matched_restaurant_id = r.id AND source = 'google_places'
  ORDER BY scrape_date DESC, scraped_at DESC
  LIMIT 1
) sr_google ON true
LEFT JOIN LATERAL (
  SELECT payload
  FROM source_records
  WHERE matched_restaurant_id = r.id AND source = 'foursquare'
  ORDER BY scrape_date DESC, scraped_at DESC
  LIMIT 1
) sr_fsq ON true
LEFT JOIN LATERAL (
  SELECT payload
  FROM source_records
  WHERE matched_restaurant_id = r.id AND source = 'opentable'
  ORDER BY scrape_date DESC, scraped_at DESC
  LIMIT 1
) sr_ot ON true
WHERE sr_google.payload IS NOT NULL
   OR sr_fsq.payload IS NOT NULL
   OR sr_ot.payload IS NOT NULL;


-- ============================================================================
-- COUCHE 5 — SERVING (front de recherche, dossier web/)
-- ============================================================================
-- `restaurant_search` aplatit les payloads JSONB des sources enrichies en
-- colonnes directement consommables. Le front ne fouille jamais dans `payload`.
--
-- ATTENTION : cette vue rejoue `restaurant_score` (window functions + regex sur
-- JSONB) à chaque requête → ~3,5 s, au-delà du statement_timeout de PostgREST.
-- Le front lit donc `restaurant_search_mv`, sa version matérialisée (~1 ms).
--
-- Après tout ingest/enrichissement :  npm run search:refresh
--
-- La définition complète des objets ci-dessous vit dans les migrations Supabase
-- (create_restaurant_search_view, materialize_restaurant_search,
--  create_search_facet_views, prefer_google_display_name_v2,
--  refresh_function_timeout). Résumé :
--
--   VIEW  restaurant_search           -- jointure restaurants + google_places +
--                                     -- michelin + worlds50best + opentable + score
--   MATVIEW restaurant_search_mv      -- snapshot indexé de la vue ci-dessus
--   VIEW  restaurant_facet_cuisines   -- facettes de filtre (cuisine → nb de restos)
--   VIEW  restaurant_facet_alcaldias  -- facettes de filtre (quartier → nb de restos)
--   FUNC  refresh_restaurant_search() -- REFRESH CONCURRENTLY, réservé à service_role
--
-- Colonnes notables de restaurant_search_mv :
--   name          -- displayName Google (casé/accentué), repli sur DENUE.nombre
--   rating        -- note Google sur 5 (PAS sur 10 comme TheFork)
--   price_level   -- 1..4 dérivé de priceLevel Google
--   photo_ref(s)  -- références photo Google, à servir via le proxy /api/photo
--   cuisine_key   -- primaryType Google nettoyé, repli sur cuisine_type OSM
--   is_enriched   -- true si une fiche google_places existe (≈ 930 restos)
--   has_photo     -- true si au moins une photo
