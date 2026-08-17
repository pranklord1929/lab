CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE VIEW tier_0_all AS
SELECT * FROM restaurants;

CREATE OR REPLACE VIEW tier_1_active AS
SELECT r.*
FROM restaurants r
WHERE r.statut = 'actif'
  AND NOT EXISTS (
    SELECT 1
    FROM source_records sr
    WHERE sr.matched_restaurant_id = r.id
      AND sr.source = 'cdmx_invea_suspendidos'
  );

CREATE OR REPLACE VIEW tier_2_real_food AS
SELECT r.*
FROM tier_1_active r
WHERE r.codigo_scian LIKE '7225%'
  AND NOT EXISTS (
    SELECT 1
    FROM source_records sr
    WHERE sr.matched_restaurant_id = r.id
      AND sr.source = 'cdmx_mercados_publicos'
  );

CREATE OR REPLACE VIEW tier_3_geo_premium AS
SELECT r.*
FROM tier_2_real_food r
WHERE upper(unaccent(coalesce(r.alcaldia, ''))) IN (
  'CUAUHTEMOC',
  'BENITO JUAREZ',
  'MIGUEL HIDALGO',
  'COYOACAN',
  'ALVARO OBREGON',
  'CUAJIMALPA DE MORELOS',
  'TLALPAN'
);

CREATE OR REPLACE VIEW tier_4_volume AS
SELECT r.*
FROM tier_3_geo_premium r
WHERE r.estrato IS NOT NULL
  AND regexp_replace(r.estrato, '\D', '', 'g') ~ '^\d+$'
  AND (regexp_replace(r.estrato, '\D', '', 'g'))::int >= 11;

CREATE OR REPLACE VIEW tier_5_enriched AS
SELECT r.*
FROM tier_4_volume r
WHERE r.google_place_id IS NOT NULL
   OR EXISTS (
     SELECT 1
     FROM restaurant_identities ri
     WHERE ri.restaurant_id = r.id
       AND ri.source IN ('foursquare','resy','opentable','michelin','editorial','worlds50best','chilango')
   );

CREATE OR REPLACE VIEW tier_6_qualified AS
SELECT r.*
FROM tier_5_enriched r
WHERE EXISTS (
  SELECT 1
  FROM source_records sr
  WHERE sr.matched_restaurant_id = r.id
    AND (
      CASE WHEN (sr.payload->>'rating') ~ '^[0-9]+(\.[0-9]+)?$' THEN (sr.payload->>'rating')::numeric END >= 4.0
      OR CASE WHEN (sr.payload->'rating'->>'average') ~ '^[0-9]+(\.[0-9]+)?$' THEN (sr.payload->'rating'->>'average')::numeric END >= 4.0
      OR CASE WHEN (sr.payload->'statistics'->'reviews'->'ratings'->'overall'->>'rating') ~ '^[0-9]+(\.[0-9]+)?$' THEN (sr.payload->'statistics'->'reviews'->'ratings'->'overall'->>'rating')::numeric END >= 4.0
    )
    AND COALESCE(
      CASE WHEN (sr.payload->>'userRatingCount') ~ '^\d+$' THEN (sr.payload->>'userRatingCount')::int END,
      CASE WHEN (sr.payload->>'reviewCount') ~ '^\d+$' THEN (sr.payload->>'reviewCount')::int END,
      CASE WHEN (sr.payload->'rating'->>'count') ~ '^\d+$' THEN (sr.payload->'rating'->>'count')::int END,
      CASE WHEN (sr.payload->'statistics'->'reviews'->>'allTimeTextReviewCount') ~ '^\d+$' THEN (sr.payload->'statistics'->'reviews'->>'allTimeTextReviewCount')::int END,
      0
    ) >= 50
);
