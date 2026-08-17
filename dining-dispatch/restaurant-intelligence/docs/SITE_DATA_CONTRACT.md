# Site data contract

The front consumes `site-data/`, never `archive/legacy-data/` and never raw
Supabase tables from the browser.

## Files

- `manifest.json` — export timestamp, counts, cohort rule, guardrails and
  source-level inventory.
- `index.json` — lightweight summaries for search, cards and routing.
- `launch-candidates.json` — the first 100 records to review and wire into the
  V0 experience. Candidate does not mean published.
- `restaurants/<slug>.json` — one full restaurant record per route, with
  menu candidates, links, provenance, QA and blank editorial fields.
- `collections.json` — objective collections derived from launch candidates:
  neighborhood, borough, cuisine and documented distinctions. No subjective
  date-night/business-dinner collection is generated.
- `qa/needs-review.json` — records with missing fields, possible false-positive
  categories, duplicate pairs or other explicit QA work.

## Important field semantics

- `experience.sourceSummary` is source-derived context. It is not a Dining
  Dispatch review and must not be labeled as one.
- `menu.state` can be `structured_candidate`,
  `local_extraction_candidate`, `document_only` or `missing`.
- `menu.observedAt` is the newest menu-document check date. It is not the site
  export date and not a promise that the menu is current today.
- `verification.status = machine_assembled_candidate` means a record was
  assembled by the data pipeline and still requires human review.
- `editorial.*` is empty by design. Never backfill it from ratings, summaries
  or an LLM without an explicit editorial workflow.
- `seo.launchEligible` is a technical completeness shortlist.
- `seo.indexable` remains `false` for every generated record. A separate human
  decision must set it to true.
- `internalQuality.*` may be used for QA ordering only. Do not expose internal
  scores or pipeline flags as consumer-facing claims.
- `media.publicImageUrl` is null. The export deliberately excludes Google
  Places photo references.

## Allowed derivations

- address, neighborhood, borough and map links;
- cuisine and price-level filters;
- documented Michelin/World's 50 Best distinctions;
- objective neighborhood/borough/cuisine collection pages;
- menu display with its source and observation date;
- `Restaurant` JSON-LD using only present factual fields.

## Forbidden derivations

- “worth it”, “best for”, “romantic”, “tourist-friendly”, “business dinner” or
  similar judgments from rating, price, cuisine or review count;
- current/verified wording based on the export date;
- fabricated FAQ answers, reservation difficulty or recommended lead time;
- consumer-facing use of internal rank, richness score or QA score;
- public delivery of raw payloads, source records, photo references, secrets or
  the SQLite archive.

