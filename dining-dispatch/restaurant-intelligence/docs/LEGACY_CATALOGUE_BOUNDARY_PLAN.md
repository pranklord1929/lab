# Phase 1B — Curated Catalogue Boundary (proposal, NOT applied)

Date: 2026-07-25 · Author: claude · **No SQL executed. No migration created.
No Supabase change made.** Approval required before any of this runs.

---

## 1. The honest finding: the authoritative source does not exist yet

I checked every candidate in the production serving project
(`CDMX_TDD` / `enknwdpjjkpjvhjkubju`), read-only:

| Candidate definition | Rows |
|---|---|
| Raw ingestion corpus (`restaurant_search_mv`) | 56 796 |
| `is_enriched` alone | 932 |
| `is_enriched` + `has_photo` | 918 |
| + Google rating present | 915 |
| + ≥ 20 reviews | 905 |
| + `business_status = OPERATIONAL` | 905 |
| + address present | 905 |
| + hours known | 898 |
| + rating ≥ 3.5 | **876** |
| `is_enriched` + score computed (`tier_6` lineage) | 725 |

**None of these is an authoritative curated source.** They are all derived
quality filters computed over the raw corpus, recomputed on every
`npm run search:refresh`, with no per-record review state, no human decision and
no audit trail. A filter is a heuristic; the brief asks for a *record*.

So the answer to "identify the actual authoritative source" is: **it has to be
created.** The ~800 figure is reachable — the natural gate lands at 876–905 —
but it must become a first-class table that a human can approve, reject and
correct one row at a time, not a `WHERE` clause.

Secondary finding, more urgent than the count: **the boundary is currently
unenforceable.** `restaurant_search_mv` is directly readable by the anon key —
verified from outside with the app's own publishable key. Changing only the
search function would leave the raw corpus fully queryable by anyone who reads
the app bundle. Any real fix must move the grant, not just the query.

---

## 2. Proposed design

Three objects, one principle: **the matview stays the raw ingestion snapshot;
the public surface is a separate, human-governed membership table.**

```
restaurant_search_mv          ← raw snapshot, refreshed by the pipeline
   (anon SELECT revoked)
            │
            │  JOIN ON restaurant_id
            ▼
catalogue_membership          ← authoritative, per-record, human-reviewable
   status, coordinate review, QA notes, who/when
            │
            ▼
public_catalogue (VIEW)       ← the ONLY thing anon can read
            │
            ▼
search_restaurants() RPC · iOS Today · iOS Search · later Map
```

Why a table and not a view: a view cannot record that *a person looked at this
restaurant's pin and confirmed it sits on the right building*. The brief
requires coordinate corrections reviewable one record at a time; that demands
per-row state.

---

## 3. Proposed SQL (for review — do not run yet)

### 3.1 Membership table

```sql
create table if not exists public.catalogue_membership (
  restaurant_id      uuid primary key,
  status             text not null default 'candidate',
  coordinate_state   text not null default 'unreviewed',
  -- Coordonnées corrigées à la main ; NULL = on garde celles du pipeline.
  lat_override       double precision,
  lng_override       double precision,
  qa_note            text,
  reviewed_by        uuid references auth.users(id),
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint catalogue_status_allowed
    check (status in ('candidate', 'published', 'rejected', 'needs_fix')),
  constraint catalogue_coordinate_state_allowed
    check (coordinate_state in ('unreviewed', 'verified', 'corrected', 'suspect')),
  constraint catalogue_override_pair
    check ((lat_override is null) = (lng_override is null)),
  -- Bornes de la Ville de Mexico : une correction hors zone est un bug de saisie.
  constraint catalogue_override_bbox check (
    lat_override is null or
    (lat_override between 19.0 and 19.9 and lng_override between -99.4 and -98.9)
  )
);

create index if not exists catalogue_membership_status_idx
  on public.catalogue_membership (status);

drop trigger if exists catalogue_membership_touch on public.catalogue_membership;
create trigger catalogue_membership_touch
  before update on public.catalogue_membership
  for each row execute procedure public.set_updated_at();
```

### 3.2 The only public surface

```sql
create or replace view public.public_catalogue as
select
  m.restaurant_id                            as id,
  r.name, r.colonia, r.alcaldia, r.address,
  coalesce(m.lat_override, r.lat)            as lat,
  coalesce(m.lng_override, r.lng)            as lng,
  r.phone, r.website, r.instagram,
  r.rating, r.review_count, r.price_level,
  r.summary, r.hours, r.google_maps_uri,
  r.cuisine_key, r.michelin_cuisine, r.opentable_cuisine,
  r.michelin_distinction, r.michelin_stars, r.bib_gourmand,
  r.in_worlds_50_best, r.w50_rank, r.opentable_url,
  m.coordinate_state
from public.catalogue_membership m
join public.restaurant_search_mv r on r.id = m.restaurant_id
where m.status = 'published';
```

Deliberately absent from the view: `is_enriched`, `score`, `rank_overall`,
`photo_refs`, `business_status`. They are pipeline internals; exposing them
invites the app to re-derive a boundary client-side, which is exactly the
mistake being corrected.

### 3.3 Moving the grant — the part that actually enforces anything

```sql
revoke select on public.restaurant_search_mv from anon, authenticated;
grant  select on public.public_catalogue      to anon, authenticated;

-- La table de gouvernance n'est pas publique : personne ne lit les rejets,
-- les notes de QA ni l'identité du relecteur.
alter table public.catalogue_membership enable row level security;
-- Aucune policy = aucun accès via l'API. L'édition se fait avec la clé secrète.
```

Menus must follow the same boundary, otherwise a rejected restaurant stays
reachable through its dishes:

```sql
create or replace view public.public_menu_items as
select mi.restaurant_id, mi.nom, mi.description, mi.prix, mi.devise, mi.categorie
from public.menu_items mi
join public.catalogue_membership m
  on m.restaurant_id = mi.restaurant_id and m.status = 'published';

revoke select on public.menu_items, public.menu_items_local_extracted
  from anon, authenticated;
grant  select on public.public_menu_items to anon, authenticated;
```

### 3.4 Search function repointed

```sql
create or replace function public.search_restaurants(
  search_query text,
  max_results integer default 12
)
returns table (
  id uuid, name text, colonia text, alcaldia text,
  address text, cuisine_key text, lat double precision, lng double precision
)
language sql stable security invoker set search_path = public
as $$
  select c.id, c.name, c.colonia, c.alcaldia, c.address, c.cuisine_key, c.lat, c.lng
  from public.public_catalogue c
  where c.name ilike '%' || search_query || '%'
     or c.colonia ilike '%' || search_query || '%'
     or c.address ilike '%' || search_query || '%'
  order by
    case
      when lower(c.name) = lower(search_query) then 0
      when c.name ilike search_query || '%' then 1
      else 2
    end,
    c.review_count desc nulls last,
    c.name
  limit least(greatest(max_results, 1), 50);
$$;
```

Two contract changes to flag, because the web prototype also calls this
function: `is_enriched` and `has_photo` disappear (meaningless once every row is
curated), and `lat`/`lng` are added — which the Map phase needs and which the
current signature cannot provide. The dedupe-by-`(name, colonia)` step is
dropped: I measured only **2 duplicate pairs** across the 905-row gate
(`Bisquets Obregón` and `La Isla del Dragón`, both in Centro), so duplicates
become a QA decision on two records rather than a permanent query cost.

---

## 4. Backfill and QA plan

**Seeding is a proposal, not a promotion.** Every row lands as `candidate`;
nothing becomes public until a human moves it.

```sql
insert into public.catalogue_membership (restaurant_id, status, qa_note)
select r.id, 'candidate', 'seeded 2026-07-25: enriched + photo + rating + >=20 reviews + operational + address'
from public.restaurant_search_mv r
where r.is_enriched
  and r.has_photo
  and r.rating is not null
  and r.review_count >= 20
  and r.business_status = 'OPERATIONAL'
  and r.address is not null
on conflict (restaurant_id) do nothing;
```

Expected: **905 candidates**. Applying `rating >= 3.5` and `hours is not null`
at review time is what brings it to the ~876 the brief describes — my
recommendation is to seed wide and let review subtract, never the reverse.

Review passes, in order:

1. **Coordinate pass.** One record at a time, pin against the address. Set
   `coordinate_state` to `verified`, or `corrected` with `lat_override`/
   `lng_override`, or `suspect` → `status = 'needs_fix'`. Prioritise the 24
   coordinate clusters I found where 3–5 restaurants share an exact position
   (food courts and markets — legitimate, but they must be confirmed as such
   rather than assumed).
2. **Identity pass.** Reject DENUE names still in raw capitals, obvious
   duplicates, permanently closed rooms.
3. **Publish pass.** `status = 'published'` only for rows that cleared both.

Rollback is one statement: `update catalogue_membership set status='candidate'`
restores an empty public surface without touching a single restaurant record.

---

## 5. Tests before the boundary goes live

Run against a Supabase **branch**, never production first:

| # | Test | Expected |
|---|---|---|
| 1 | anon `GET /rest/v1/restaurant_search_mv` | **404 / permission denied** |
| 2 | anon `GET /rest/v1/menu_items` | **404 / permission denied** |
| 3 | anon `GET /rest/v1/public_catalogue?select=id` | 200, count = published rows |
| 4 | anon `GET /rest/v1/catalogue_membership` | **404** (governance is private) |
| 5 | `search_restaurants('Pujol')` | returns Pujol **only if published** |
| 6 | `search_restaurants('taqueria')` | zero rows outside the published set |
| 7 | Row with `lat_override` set | view returns the override, not the raw pin |
| 8 | Row flipped to `rejected` | vanishes from view, RPC and menus |
| 9 | `refresh materialized view restaurant_search_mv` | membership and overrides survive |
| 10 | Restaurant dropped from the matview | view row disappears; membership row kept |
| 11 | iOS Today, Search, restaurant detail | no empty screens, no decode errors |

Test 9 matters most: the pipeline refreshes that matview regularly, and the
whole design is worthless if a refresh silently wipes human review.

---

## 6. iOS changes this implies (also not applied)

| File | Change |
|---|---|
| `AppModel.swift` | `restaurant_search_mv` → `public_catalogue` in `needsFreshRead()` and `restaurant(id:)`; menus → `public_menu_items` |
| `Models.swift` | `Restaurant` drops `isEnriched`, `score`-derived fields; `RestaurantHit` gains `lat`/`lng`, drops `isEnriched` |
| `SearchView.swift` | remove the `Known table` / `Needs notes` badge — meaningless once every result is curated |
| `TodayView.swift` | `needsFreshRead` ordering must move server-side; `score` will no longer be readable client-side |

Ordering is the one open design question: Today currently ranks
"needs a fresh read" by `score`, which the view deliberately hides. Either the
view exposes a coarse `prominence` bucket, or the ordering moves into a
dedicated RPC. I lean towards the RPC — it keeps ranking logic out of the
client and out of the public contract.

---

## 7. What I need from you before touching anything

1. **Approve the gate.** Seed at 905 candidates and let review subtract, or seed
   tighter at 876?
2. **Approve the grant revocation.** This is the irreversible-feeling step: the
   web prototype reads `restaurant_search_mv` directly and **will break**. It is
   frozen per your instruction, but confirm that is acceptable.
3. **Decide who reviews.** 905 records at ~20 s each is roughly 5 hours of human
   work. If that is too much, the alternative is to publish a smaller first
   batch (say the 220 with a computed score) and grow it.
4. **Confirm the branch.** I would apply all of this to a Supabase branch first
   and run the 11 tests there; production only after you see the results.
