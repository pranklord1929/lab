CREATE OR REPLACE VIEW restaurant_score AS
WITH qualified AS (
  SELECT * FROM tier_6_qualified
),
michelin AS (
  SELECT
    sr.matched_restaurant_id AS restaurant_id,
    MAX(COALESCE((sr.payload->>'michelinStars')::int, 0)) AS michelin_stars
  FROM source_records sr
  WHERE sr.matched_restaurant_id IS NOT NULL
    AND sr.source = 'michelin'
  GROUP BY 1
),
worlds50best AS (
  SELECT
    sr.matched_restaurant_id AS restaurant_id,
    COUNT(DISTINCT sr.payload->>'awardBody') FILTER (
      WHERE COALESCE(sr.payload->>'signalTier', '') IN ('A', 'A+')
    ) AS award_count
  FROM source_records sr
  WHERE sr.matched_restaurant_id IS NOT NULL
    AND sr.source = 'worlds50best'
  GROUP BY 1
),
volume AS (
  SELECT
    sr.matched_restaurant_id AS restaurant_id,
    MAX(
      GREATEST(
        COALESCE(CASE WHEN (sr.payload->>'userRatingCount') ~ '^\d+$' THEN (sr.payload->>'userRatingCount')::int END, 0),
        COALESCE(CASE WHEN (sr.payload->>'reviewCount') ~ '^\d+$' THEN (sr.payload->>'reviewCount')::int END, 0),
        COALESCE(CASE WHEN (sr.payload->'rating'->>'count') ~ '^\d+$' THEN (sr.payload->'rating'->>'count')::int END, 0),
        COALESCE(CASE WHEN (sr.payload->'statistics'->'reviews'->>'allTimeTextReviewCount') ~ '^\d+$' THEN (sr.payload->'statistics'->'reviews'->>'allTimeTextReviewCount')::int END, 0)
      )
    ) AS max_user_rating_count,
    MAX(
      GREATEST(
        COALESCE(CASE WHEN (sr.payload->>'rating') ~ '^[0-9]+(\.[0-9]+)?$' THEN (sr.payload->>'rating')::numeric END, 0),
        COALESCE(CASE WHEN (sr.payload->'rating'->>'average') ~ '^[0-9]+(\.[0-9]+)?$' THEN (sr.payload->'rating'->>'average')::numeric END, 0),
        COALESCE(CASE WHEN (sr.payload->'statistics'->'reviews'->'ratings'->'overall'->>'rating') ~ '^[0-9]+(\.[0-9]+)?$' THEN (sr.payload->'statistics'->'reviews'->'ratings'->'overall'->>'rating')::numeric END, 0)
      )
    ) AS max_rating
  FROM source_records sr
  WHERE sr.matched_restaurant_id IS NOT NULL
  GROUP BY 1
),
cross_source AS (
  SELECT
    ri.restaurant_id,
    COUNT(DISTINCT ri.source) AS identity_sources
  FROM restaurant_identities ri
  WHERE ri.match_method = 'identity_cached'
    AND ri.source IN ('foursquare','resy','opentable','michelin','editorial','worlds50best','chilango')
  GROUP BY 1
),
completion AS (
  SELECT
    r.id AS restaurant_id,
    (
      (CASE WHEN NULLIF(trim(r.sitio_web), '') IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN NULLIF(trim(r.instagram), '') IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN NULLIF(trim(r.horaires), '') IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN NULLIF(trim(r.telefono), '') IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN EXISTS (SELECT 1 FROM menu_items mi WHERE mi.restaurant_id = r.id) THEN 1 ELSE 0 END)
    ) AS completion_hits
  FROM qualified r
),
editorial AS (
  SELECT
    sr.matched_restaurant_id AS restaurant_id,
    COUNT(DISTINCT sr.source) FILTER (WHERE sr.source IN ('editorial', 'chilango', 'worlds50best')) AS editorial_sources
  FROM source_records sr
  WHERE sr.matched_restaurant_id IS NOT NULL
  GROUP BY 1
)
SELECT
  r.*,
  LEAST(25, COALESCE(m.michelin_stars, 0) * 8 + COALESCE(w.award_count, 0) * 5) AS signal_prestige,
  LEAST(20, ROUND((LOG(10, GREATEST(COALESCE(v.max_user_rating_count, 0), 1)) / 5.0) * 20, 2)) AS signal_volume,
  LEAST(20, GREATEST(0, ROUND(((COALESCE(v.max_rating, 0) - 3.5) / 1.5) * 20, 2))) AS signal_quality,
  LEAST(15, COALESCE(cs.identity_sources, 0) * 3) AS signal_cross_source,
  ROUND((COALESCE(c.completion_hits, 0)::numeric / 5) * 10, 2) AS signal_completion,
  LEAST(10, COALESCE(e.editorial_sources, 0) * 3) AS signal_editorial,
  ROUND(
    LEAST(25, COALESCE(m.michelin_stars, 0) * 8 + COALESCE(w.award_count, 0) * 5) +
    LEAST(20, ROUND((LOG(10, GREATEST(COALESCE(v.max_user_rating_count, 0), 1)) / 5.0) * 20, 2)) +
    LEAST(20, GREATEST(0, ROUND(((COALESCE(v.max_rating, 0) - 3.5) / 1.5) * 20, 2))) +
    LEAST(15, COALESCE(cs.identity_sources, 0) * 3) +
    ROUND((COALESCE(c.completion_hits, 0)::numeric / 5) * 10, 2) +
    LEAST(10, COALESCE(e.editorial_sources, 0) * 3),
    2
  ) AS score,
  ROW_NUMBER() OVER (
    ORDER BY
      ROUND(
        LEAST(25, COALESCE(m.michelin_stars, 0) * 8 + COALESCE(w.award_count, 0) * 5) +
        LEAST(20, ROUND((LOG(10, GREATEST(COALESCE(v.max_user_rating_count, 0), 1)) / 5.0) * 20, 2)) +
        LEAST(20, GREATEST(0, ROUND(((COALESCE(v.max_rating, 0) - 3.5) / 1.5) * 20, 2))) +
        LEAST(15, COALESCE(cs.identity_sources, 0) * 3) +
        ROUND((COALESCE(c.completion_hits, 0)::numeric / 5) * 10, 2) +
        LEAST(10, COALESCE(e.editorial_sources, 0) * 3),
        2
      ) DESC,
      r.nombre ASC
  ) AS rank_overall,
  ROW_NUMBER() OVER (
    PARTITION BY r.alcaldia
    ORDER BY
      ROUND(
        LEAST(25, COALESCE(m.michelin_stars, 0) * 8 + COALESCE(w.award_count, 0) * 5) +
        LEAST(20, ROUND((LOG(10, GREATEST(COALESCE(v.max_user_rating_count, 0), 1)) / 5.0) * 20, 2)) +
        LEAST(20, GREATEST(0, ROUND(((COALESCE(v.max_rating, 0) - 3.5) / 1.5) * 20, 2))) +
        LEAST(15, COALESCE(cs.identity_sources, 0) * 3) +
        ROUND((COALESCE(c.completion_hits, 0)::numeric / 5) * 10, 2) +
        LEAST(10, COALESCE(e.editorial_sources, 0) * 3),
        2
      ) DESC,
      r.nombre ASC
  ) AS rank_alcaldia
FROM qualified r
LEFT JOIN michelin m ON m.restaurant_id = r.id
LEFT JOIN worlds50best w ON w.restaurant_id = r.id
LEFT JOIN volume v ON v.restaurant_id = r.id
LEFT JOIN cross_source cs ON cs.restaurant_id = r.id
LEFT JOIN completion c ON c.restaurant_id = r.id
LEFT JOIN editorial e ON e.restaurant_id = r.id;
