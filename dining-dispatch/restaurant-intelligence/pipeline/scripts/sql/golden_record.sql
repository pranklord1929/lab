-- Golden record: one best-effort, traceable row per canonical restaurant.
-- Raw source_records remain immutable; this layer never overwrites restaurants.

CREATE OR REPLACE VIEW restaurant_golden_record AS
WITH latest_source AS (
  SELECT DISTINCT ON (matched_restaurant_id, source)
    matched_restaurant_id AS restaurant_id,
    source,
    jsonb_build_object(
      'name', name,
      'address', address,
      'phone', phone,
      'website', website,
      'latitude', latitude,
      'longitude', longitude,
      'payload', payload,
      'scrape_date', scrape_date
    ) AS record
  FROM source_records
  WHERE matched_restaurant_id IS NOT NULL
  ORDER BY matched_restaurant_id, source, scrape_date DESC, scraped_at DESC
), source_bundle AS (
  SELECT
    restaurant_id,
    jsonb_object_agg(source, record) AS sources
  FROM latest_source
  GROUP BY restaurant_id
), source_summary AS (
  SELECT
    matched_restaurant_id AS restaurant_id,
    COUNT(DISTINCT source) AS source_count,
    array_agg(DISTINCT source ORDER BY source) AS source_names,
    MAX(scraped_at) AS freshest_source_at
  FROM source_records
  WHERE matched_restaurant_id IS NOT NULL
  GROUP BY matched_restaurant_id
), best_links AS (
  SELECT
    restaurant_id,
    (array_agg(COALESCE(final_url, url) ORDER BY
      (status = 'valid') DESC, confidence_score DESC NULLS LAST, checked_at DESC NULLS LAST
    ) FILTER (WHERE link_type = 'official_site' AND status <> 'invalid'))[1] AS official_site,
    (array_agg(COALESCE(final_url, url) ORDER BY
      (status = 'valid') DESC, confidence_score DESC NULLS LAST, checked_at DESC NULLS LAST
    ) FILTER (WHERE provider = 'instagram' AND status <> 'invalid'))[1] AS instagram,
    (array_agg(COALESCE(final_url, url) ORDER BY
      (status = 'valid') DESC, confidence_score DESC NULLS LAST, checked_at DESC NULLS LAST
    ) FILTER (WHERE provider = 'facebook' AND status <> 'invalid'))[1] AS facebook
  FROM restaurant_links
  GROUP BY restaurant_id
), prepared AS (
  SELECT
    r.*,
    COALESCE(sb.sources, '{}'::jsonb) AS sources,
    ss.source_count,
    ss.source_names,
    ss.freshest_source_at,
    bl.official_site AS verified_link_website,
    bl.instagram AS verified_link_instagram,
    bl.facebook AS verified_link_facebook
  FROM restaurants r
  LEFT JOIN source_bundle sb ON sb.restaurant_id = r.id
  LEFT JOIN source_summary ss ON ss.restaurant_id = r.id
  LEFT JOIN best_links bl ON bl.restaurant_id = r.id
), resolved AS (
  SELECT
    p.*,
    COALESCE(
      NULLIF(p.sources->'google_places'->>'name', ''),
      NULLIF(p.sources->'google_places'->'payload'->'displayName'->>'text', ''),
      NULLIF(p.nombre, '')
    ) AS golden_name,
    COALESCE(
      NULLIF(p.sources->'google_places'->>'address', ''),
      NULLIF(p.sources->'google_places'->'payload'->>'formattedAddress', ''),
      NULLIF(concat_ws(', ',
        NULLIF(concat_ws(' ', p.tipo_vialidad, p.nom_vialidad, p.numero_exterior, p.numero_interior), ''),
        p.colonia, p.alcaldia, p.cp
      ), ''),
      NULLIF(p.sources->'michelin'->>'address', ''),
      NULLIF(p.sources->'opentable'->>'address', ''),
      NULLIF(p.sources->'resy'->>'address', '')
    ) AS golden_address,
    COALESCE(
      NULLIF(p.sources->'google_places'->'payload'->>'internationalPhoneNumber', ''),
      NULLIF(p.sources->'google_places'->'payload'->>'nationalPhoneNumber', ''),
      NULLIF(p.telefono, ''),
      NULLIF(p.sources->'opentable'->>'phone', ''),
      NULLIF(p.sources->'resy'->>'phone', ''),
      NULLIF(p.sources->'michelin'->>'phone', '')
    ) AS golden_phone,
    COALESCE(
      NULLIF(p.verified_link_website, ''),
      NULLIF(p.sources->'google_places'->'payload'->>'websiteUri', ''),
      NULLIF(p.sitio_web, ''),
      NULLIF(p.sources->'michelin'->>'website', ''),
      NULLIF(p.sources->'wikidata'->>'website', '')
    ) AS golden_website,
    COALESCE(
      NULLIF(p.verified_link_instagram, ''),
      NULLIF(p.instagram, ''),
      NULLIF(p.sources->'mexico_gastronomico'->'payload'->'instagram'->>0, '')
    ) AS golden_instagram,
    COALESCE(NULLIF(p.verified_link_facebook, ''), NULLIF(p.facebook, '')) AS golden_facebook,
    COALESCE(
      p.sources->'google_places'->'payload'->'regularOpeningHours'->'weekdayDescriptions',
      CASE WHEN NULLIF(p.horaires, '') IS NOT NULL THEN to_jsonb(p.horaires) END,
      p.sources->'michelin'->'payload'->'hoursOfOperation'
    ) AS golden_hours,
    COALESCE(
      NULLIF(p.sources->'google_places'->'payload'->>'primaryType', ''),
      NULLIF(p.cuisine_type, ''),
      NULLIF(p.sources->'michelin'->'payload'->>'cuisine', ''),
      NULLIF(p.sources->'opentable'->'payload'->>'cuisine', ''),
      NULLIF(p.sources->'resy'->'payload'->>'cuisine', ''),
      NULLIF(p.sources->'restaurantguru'->'payload'->>'cuisine', '')
    ) AS golden_cuisine,
    COALESCE(
      NULLIF(p.sources->'google_places'->>'latitude', '')::numeric,
      p.latitud
    ) AS golden_latitude,
    COALESCE(
      NULLIF(p.sources->'google_places'->>'longitude', '')::numeric,
      p.longitud
    ) AS golden_longitude,
    CASE
      WHEN (p.sources->'google_places'->'payload'->>'rating') ~ '^[0-9]+(\.[0-9]+)?$'
      THEN (p.sources->'google_places'->'payload'->>'rating')::numeric
      WHEN (p.sources->'opentable'->'payload'->>'rating') ~ '^[0-9]+(\.[0-9]+)?$'
      THEN (p.sources->'opentable'->'payload'->>'rating')::numeric
      WHEN (p.sources->'restaurantguru'->'payload'->>'rating') ~ '^[0-9]+(\.[0-9]+)?$'
      THEN (p.sources->'restaurantguru'->'payload'->>'rating')::numeric
    END AS golden_rating,
    COALESCE(
      CASE WHEN (p.sources->'google_places'->'payload'->>'userRatingCount') ~ '^\d+$'
        THEN (p.sources->'google_places'->'payload'->>'userRatingCount')::integer END,
      CASE WHEN (p.sources->'opentable'->'payload'->>'reviewCount') ~ '^\d+$'
        THEN (p.sources->'opentable'->'payload'->>'reviewCount')::integer END
    ) AS golden_review_count,
    COALESCE(
      NULLIF(p.sources->'google_places'->'payload'->>'priceLevel', ''),
      NULLIF(p.sources->'opentable'->'payload'->>'priceBandId', ''),
      NULLIF(p.sources->'resy'->'payload'->>'priceRangeId', ''),
      NULLIF(p.gamme_prix, '')
    ) AS golden_price,
    COALESCE(
      p.sources->'google_places'->'payload'->'photos',
      p.sources->'resy'->'payload'->'images',
      CASE WHEN NULLIF(p.sources->'restaurantguru'->'payload'->>'image', '') IS NOT NULL
        THEN jsonb_build_array(p.sources->'restaurantguru'->'payload'->>'image') END
    ) AS golden_photos,
    COALESCE(
      NULLIF(p.sources->'google_places'->'payload'->'editorialSummary'->>'text', ''),
      NULLIF(p.sources->'michelin'->'payload'->>'review', ''),
      NULLIF(p.sources->'opentable'->'payload'->>'description', '')
    ) AS golden_description
  FROM prepared p
)
SELECT
  id AS restaurant_id,
  golden_name AS name,
  golden_address AS address,
  golden_phone AS phone,
  golden_website AS website,
  golden_instagram AS instagram,
  golden_facebook AS facebook,
  golden_hours AS opening_hours,
  golden_cuisine AS cuisine,
  golden_latitude AS latitude,
  golden_longitude AS longitude,
  golden_rating AS rating,
  golden_review_count AS review_count,
  golden_price AS price_level,
  golden_photos AS photos,
  golden_description AS description,
  google_place_id,
  verified_open,
  statut,
  categorie,
  alcaldia,
  colonia,
  cp,
  COALESCE(source_count, 0) AS source_count,
  COALESCE(source_names, ARRAY[]::text[]) AS source_names,
  freshest_source_at,
  (
    (golden_phone IS NOT NULL)::int +
    (golden_website IS NOT NULL)::int +
    (golden_hours IS NOT NULL)::int +
    (golden_cuisine IS NOT NULL)::int +
    (golden_rating IS NOT NULL)::int +
    (golden_photos IS NOT NULL)::int +
    (golden_description IS NOT NULL)::int
  ) AS richness_score,
  jsonb_strip_nulls(jsonb_build_object(
    'name', CASE
      WHEN NULLIF(sources->'google_places'->>'name', '') IS NOT NULL
        OR NULLIF(sources->'google_places'->'payload'->'displayName'->>'text', '') IS NOT NULL THEN 'google_places'
      ELSE source END,
    'address', CASE
      WHEN golden_address IS NULL THEN NULL
      WHEN NULLIF(sources->'google_places'->>'address', '') IS NOT NULL
        OR NULLIF(sources->'google_places'->'payload'->>'formattedAddress', '') IS NOT NULL THEN 'google_places'
      WHEN NULLIF(concat_ws(', ', NULLIF(concat_ws(' ', tipo_vialidad, nom_vialidad, numero_exterior, numero_interior), ''), colonia, alcaldia, cp), '') IS NOT NULL THEN source
      WHEN NULLIF(sources->'michelin'->>'address', '') IS NOT NULL THEN 'michelin'
      WHEN NULLIF(sources->'opentable'->>'address', '') IS NOT NULL THEN 'opentable'
      ELSE 'resy' END,
    'phone', CASE
      WHEN golden_phone IS NULL THEN NULL
      WHEN NULLIF(sources->'google_places'->'payload'->>'internationalPhoneNumber', '') IS NOT NULL
        OR NULLIF(sources->'google_places'->'payload'->>'nationalPhoneNumber', '') IS NOT NULL THEN 'google_places'
      WHEN NULLIF(telefono, '') IS NOT NULL THEN source
      WHEN NULLIF(sources->'opentable'->>'phone', '') IS NOT NULL THEN 'opentable'
      WHEN NULLIF(sources->'resy'->>'phone', '') IS NOT NULL THEN 'resy'
      ELSE 'michelin' END,
    'website', CASE
      WHEN golden_website IS NULL THEN NULL
      WHEN verified_link_website IS NOT NULL THEN 'restaurant_links'
      WHEN NULLIF(sources->'google_places'->'payload'->>'websiteUri', '') IS NOT NULL THEN 'google_places'
      WHEN NULLIF(sitio_web, '') IS NOT NULL THEN source
      WHEN NULLIF(sources->'michelin'->>'website', '') IS NOT NULL THEN 'michelin'
      ELSE 'wikidata' END,
    'instagram', CASE
      WHEN golden_instagram IS NULL THEN NULL
      WHEN verified_link_instagram IS NOT NULL THEN 'restaurant_links'
      WHEN NULLIF(instagram, '') IS NOT NULL THEN source
      ELSE 'mexico_gastronomico' END,
    'facebook', CASE
      WHEN golden_facebook IS NULL THEN NULL
      WHEN verified_link_facebook IS NOT NULL THEN 'restaurant_links'
      ELSE source END,
    'opening_hours', CASE
      WHEN golden_hours IS NULL THEN NULL
      WHEN sources->'google_places'->'payload'->'regularOpeningHours'->'weekdayDescriptions' IS NOT NULL THEN 'google_places'
      WHEN NULLIF(horaires, '') IS NOT NULL THEN source
      ELSE 'michelin' END,
    'cuisine', CASE
      WHEN golden_cuisine IS NULL THEN NULL
      WHEN NULLIF(sources->'google_places'->'payload'->>'primaryType', '') IS NOT NULL THEN 'google_places'
      WHEN NULLIF(cuisine_type, '') IS NOT NULL THEN source
      WHEN NULLIF(sources->'michelin'->'payload'->>'cuisine', '') IS NOT NULL THEN 'michelin'
      WHEN NULLIF(sources->'opentable'->'payload'->>'cuisine', '') IS NOT NULL THEN 'opentable'
      WHEN NULLIF(sources->'resy'->'payload'->>'cuisine', '') IS NOT NULL THEN 'resy'
      ELSE 'restaurantguru' END,
    'coordinates', CASE
      WHEN golden_latitude IS NULL OR golden_longitude IS NULL THEN NULL
      WHEN NULLIF(sources->'google_places'->>'latitude', '') IS NOT NULL THEN 'google_places'
      ELSE source END,
    'rating', CASE
      WHEN golden_rating IS NULL THEN NULL
      WHEN (sources->'google_places'->'payload'->>'rating') ~ '^[0-9]+(\.[0-9]+)?$' THEN 'google_places'
      WHEN (sources->'opentable'->'payload'->>'rating') ~ '^[0-9]+(\.[0-9]+)?$' THEN 'opentable'
      ELSE 'restaurantguru' END,
    'price_level', CASE
      WHEN golden_price IS NULL THEN NULL
      WHEN NULLIF(sources->'google_places'->'payload'->>'priceLevel', '') IS NOT NULL THEN 'google_places'
      WHEN NULLIF(sources->'opentable'->'payload'->>'priceBandId', '') IS NOT NULL THEN 'opentable'
      WHEN NULLIF(sources->'resy'->'payload'->>'priceRangeId', '') IS NOT NULL THEN 'resy'
      ELSE source END,
    'photos', CASE
      WHEN golden_photos IS NULL THEN NULL
      WHEN sources->'google_places'->'payload'->'photos' IS NOT NULL THEN 'google_places'
      WHEN sources->'resy'->'payload'->'images' IS NOT NULL THEN 'resy'
      ELSE 'restaurantguru' END,
    'description', CASE
      WHEN golden_description IS NULL THEN NULL
      WHEN NULLIF(sources->'google_places'->'payload'->'editorialSummary'->>'text', '') IS NOT NULL THEN 'google_places'
      WHEN NULLIF(sources->'michelin'->'payload'->>'review', '') IS NOT NULL THEN 'michelin'
      ELSE 'opentable' END
  )) AS field_provenance,
  updated_at AS canonical_updated_at
FROM resolved;

DROP MATERIALIZED VIEW IF EXISTS restaurant_golden_record_mv;
CREATE MATERIALIZED VIEW restaurant_golden_record_mv AS
SELECT * FROM restaurant_golden_record;

CREATE UNIQUE INDEX restaurant_golden_record_mv_restaurant_id_idx
  ON restaurant_golden_record_mv (restaurant_id);
CREATE INDEX restaurant_golden_record_mv_richness_idx
  ON restaurant_golden_record_mv (richness_score DESC);
CREATE INDEX restaurant_golden_record_mv_sources_idx
  ON restaurant_golden_record_mv (source_count DESC);

CREATE OR REPLACE FUNCTION refresh_restaurant_golden_record()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY restaurant_golden_record_mv;
END;
$$;

REVOKE ALL ON FUNCTION refresh_restaurant_golden_record() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_restaurant_golden_record() TO service_role;
GRANT SELECT ON restaurant_golden_record_mv TO service_role;
