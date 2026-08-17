# The Dining Dispatch — Restaurant Intelligence V0

This folder reunites the existing Mexico City restaurant-data work with a
portable, front-end-safe export. It is intentionally isolated from the simple
Next.js interface that now lives at the parent `TDD/` root.

## What is here

- `v1/` — **catalog V1 for the public site**: 114 names from the private
  Mexico City list, 29 matched fiches, scrape queue for the rest. The front
  should consume `v1/site-data/` only. See `v1/CURSOR_PROMPT.md`.
- `site-data/` — archive export of 876 machine-assembled candidates. Not the
  V1 runtime catalog.
- `archive/legacy-data/` — **canonical Mexico City dataset** (moved here
  2026-08-17 from `Desktop/02_DEV/CDMX_RESTAURANTS/data`). SQLite snapshot
  (56 848 restaurants), JSONL, raw sources, processed intermediates, exports
  and historical backups. Gitignored. The old path is a symlink.
- `pipeline/` — the existing ingestion, matching, deduplication, enrichment,
  menu extraction and Supabase migration code, copied without `.env` files or
  credentials.
- `schema/` — the captured Supabase schema.
- `scripts/export-site-data.mjs` — reproducibly rebuilds `site-data/` from the
  SQLite snapshot.
- `docs/` — audit, data contract, original architecture and the Cursor handoff.

## Regenerate the web export

From `Desktop/03_MEXICO/TDD`:

```bash
node restaurant-intelligence/scripts/export-site-data.mjs
node restaurant-intelligence/scripts/validate-site-data.mjs
```

The exporter fails if the strict cohort drifts away from the expected 876
records. Change that assertion only after reviewing and documenting a new
cohort rule.

## Publication boundary

These records are machine-assembled candidates, not human-reviewed Dining
Dispatch recommendations. Every record therefore starts with:

- `verification.status = "machine_assembled_candidate"`;
- `editorial.status = "not_reviewed"`;
- empty subjective/editorial fields;
- `seo.indexable = false`.

The front may render candidate pages for local review, but it must not invent
`best for`, `avoid for`, ambience, reservation advice, FAQs or a Dining
Dispatch verdict. A human decision is required before indexing a page.

## Confidentiality

`archive/legacy-data/` is deliberately gitignored. It contains raw source
payloads and the full confidential working database. Never move it into
`public/`, ship it to the browser, or commit it. The generated `site-data/`
contract contains only the narrow fields intended for product integration.
