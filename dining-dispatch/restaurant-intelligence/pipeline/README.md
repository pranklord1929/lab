# Legacy data pipeline snapshot

This is the reusable ingestion and enrichment pipeline copied from
`Desktop/02_DEV/CDMX_RESTAURANTS` on 2026-08-17. It includes source adapters,
entity resolution, deduplication, golden-record construction, menu extraction,
QA scripts and Supabase migrations.

The `data` symlink points to the local, gitignored archive at
`../archive/legacy-data`. Run legacy npm commands from this `pipeline/`
directory only after reading `../docs/LEGACY_ARCHITECTURE.md` and `AGENTS.md`.

No credentials were copied. Any future `.env` must remain local and any paid
API call or production database write requires an explicit decision.

