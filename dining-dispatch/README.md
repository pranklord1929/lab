# The Dining Dispatch Intelligence — V0

SEO-first restaurant intelligence for Mexico City. Public site is the proof; the database is the asset.

## Run

```bash
npm install
npm run dev
```

`npm run build` must pass. With no Supabase env vars, the app reads `content/fixtures.json` (3 template restaurants) so local UI and CI work without Docker.

## Stack

- Next.js App Router (SSR / static params)
- Deepstate visual system (`vendor/deepstate`)
- Supabase Postgres schema ready for ~700 restaurants
- Vercel-compatible

No login, comments, booking engine, map, mobile app, or public API.

## Data

Canonical CDMX dataset (SQLite, raw sources, backups):

`restaurant-intelligence/archive/legacy-data/`

Web contract the site actually reads (876 candidates, 100 launch):

`restaurant-intelligence/site-data/`

`lib/data` uses `siteDataStore` by default. Do not read the SQLite archive from the browser.

`content/fixtures.json` is a leftover UI template. It is not the runtime source.

### Supabase (dedicated project — not Jarvis)

1. `npx supabase start` in this repo, or create a new remote project.
2. Apply `supabase/migrations/20260817120000_init.sql`.
3. Load fixtures: `npx supabase db reset` (uses `supabase/seed.sql`) **or** ingest (below).
4. Copy `.env.example` to `.env.local` and set:

```
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

RLS: public `SELECT` on published restaurants and their child rows. No anon writes.

### Ingest ~700 restaurants

Shape is a nested document (see `lib/types.ts` → `RestaurantDocument` / `CatalogDocument`):

```json
{
  "collections": [{ "slug": "best-restaurants-roma-norte", "title": "..." }],
  "restaurants": [{
    "slug": "quintonil",
    "name": "Quintonil",
    "neighborhood": "Polanco",
    "price_range": "$$$$",
    "menus": [],
    "verifications": [],
    "notes": [],
    "faqs": [],
    "collection_slugs": ["best-mexican-restaurants"]
  }]
}
```

A JSON array of restaurants, or NDJSON (one restaurant per line), also works.

```bash
# SQL dump (no credentials)
npm run seed:sql

# Upsert into Postgres (service role, never a public key)
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run ingest -- content/import/cdmx.json
```

Upsert key is `slug`. Menus, verifications, notes, FAQs, and collection memberships for that restaurant are replaced on each ingest.

Drop files in `content/import/`.
