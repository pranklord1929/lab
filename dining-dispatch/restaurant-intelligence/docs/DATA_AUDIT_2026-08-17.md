# CDMX restaurant data audit — 2026-08-17

## Verdict

The previous project is a substantial restaurant-intelligence pipeline, not a
1,000-row spreadsheet. The broad local corpus contains 56,848 canonical
restaurants and a narrower, richer layer of 932 enriched records. The strict
beta rule yields exactly 876 candidates. This strict cohort is the correct V0
input for the new site; the broad corpus remains the research and refinement
asset.

The active working data, pipeline and schema have been copied into
`Desktop/03_MEXICO/TDD/restaurant-intelligence`. Redundant historical SQLite
backups (5.6 GB) were not duplicated; they remain in the original project.

## Local inventory

Snapshot: `archive/legacy-data/local_db/cdmx_local.sqlite`, last written
2026-07-19, 184.8 MB.

| Object | Rows |
|---|---:|
| `restaurants` | 56,848 |
| `restaurant_golden_record` | 56,848 |
| `restaurant_search_mv` | 56,796 |
| `source_records` | 11,655 |
| `restaurant_identities` | 6,225 |
| `restaurant_links` | 6,918 |
| `menu_documents` | 4,102 |
| `menu_items` | 30,666 |
| `menu_items_local_extracted` | 24,590 |
| `premium_enrichment_queue` | 932 |
| `top500_enrichment_status` | 500 |

The active legacy-data copy is about 874 MB. It includes the canonical SQLite
database, JSONL table exports, source snapshots, processed intermediates and
final exports. The copied pipeline is about 1.5 MB.

## Cohorts

- Enriched: 932 records with coordinates, address and neighborhood; 918 have
  photos, 910 hours, 923 a rating, 756 a website, 728 a cuisine, 699 a price
  level, 408 Instagram and 231 a source summary.
- Strict beta: 876 records matching `is_enriched + photo + rating >= 3.5 +
  reviews >= 20 + OPERATIONAL + address + hours`.
- Top 500: all 500 have a rating; 491 hours; 486 a phone; 494 photos; 449 a
  website; 292 a menu document; 210 a quality menu; 176 structured menu items.
- Site launch candidates: 100 deterministic candidates selected from the top
  500 using core completeness, at least three sources, a cuisine, a website,
  no high conflict, and either a menu document or a prestige signal. They are
  still not editorially approved or indexable.

## Provenance and freshness

The pipeline has integrated 22 named sources, including DENUE/INEGI as the
broad registry layer and Foursquare, Google Places, Resy, Michelin, OpenTable,
Rappi, Uber Eats, Reservándonos, Restaurant Guru, official websites and menus,
editorial lists and official tourism/industry sources as enrichment layers.

The most recent captured source and menu observations are from July 2026. No
field in the export is stamped as verified on 2026-08-17. The front must show
the actual `freshestSourceAt` or menu `observedAt` date and must never relabel
the export date as a verification date.

Each site record carries:

- source names and source count;
- field-level provenance from the golden record;
- the freshest observed source timestamp;
- menu source URLs, extraction confidence and observation timestamp where
  available;
- explicit QA flags.

## Supabase verification

The historical production project `CDMX_TDD` (`enknwdpjjkpjvhjkubju`) was
reachable on 2026-08-17 through the public catalogue credentials preserved in
the project history. Exact remote counts matched the local snapshot for:

- `restaurant_search_mv`: 56,796;
- `menu_items`: 30,666;
- `menu_items_local_extracted`: 24,590.

The stricter `app_catalogue` and `public_catalogue` views returned 404 on that
project, so the catalogue-boundary migrations are not confirmed there. The
currently authenticated Supabase CLI account lists only the separate `Jarvis`
project and does not provide administrative access to `CDMX_TDD`. Therefore
the local SQLite snapshot is the confirmed operational source for this V0
handoff; no live Supabase write or migration was attempted.

## Known quality debt

1. Human editorial is absent. `best for`, `avoid for`, ambience, ideal moment,
   reservation difficulty, advice and SEO FAQs remain empty by design.
2. The strict cohort still contains five records whose source category looks
   non-restaurant, plus four records across two duplicate name/neighborhood
   pairs. They are flagged, not silently deleted.
3. Many menus are extracted candidates, not guaranteed current official menus.
   The source and observation date must remain visible.
4. Some source categories are noisy (`shopping_mall`, `corporate_office`,
   etc.). Category is a QA signal, never sufficient proof by itself.
5. Cached third-party fields and media require a source-terms review before
   public redistribution. Google Places photo references were excluded from
   the site export; no image URL is fabricated.
6. The broad corpus has thousands of conflict and duplicate candidates. Never
   auto-merge or overwrite canonical entities from the front-end layer.

## Next data work

The refinement loop should operate on the 100 launch candidates first:

1. verify identity, open status, address, official site and reservation link;
2. refresh hours and menu from official sources;
3. resolve duplicates and non-restaurant false positives;
4. write the human Dining Dispatch review fields;
5. explicitly flip only reviewed records to indexable;
6. then expand to the remaining 776 strict-cohort records.

