# CDMX Restaurants — Architecture

Dataset d'intelligence économique sur les restaurants de Mexico City. Objectif final :
500 établissements premium avec menu, horaires, photo, réseaux sociaux, site web et
signaux financiers/économiques (volume, prix, popularité).

## Vue d'ensemble

```
                 ┌────────────────────────────────────────┐
   SCRAPING      │  scripts/sources/<source>.js           │  → produit data/raw/<source>/<date>.json
                 └────────────────────────────────────────┘
                                  │
                                  ▼
                 ┌────────────────────────────────────────┐
   STAGING       │  scripts/ingest.js                     │  → source_records (immutable JSONB)
                 └────────────────────────────────────────┘
                                  │
                                  ▼
                 ┌────────────────────────────────────────┐
   ENTITY RES    │  scripts/lib/match.js                  │  → restaurant_identities (mapping persistant)
                 └────────────────────────────────────────┘
                                  │
                                  ▼
                 ┌────────────────────────────────────────┐
   CANONIQUE     │  restaurants + restaurant_links        │  ← données enrichies, prêtes à exploiter
                 │  menu_documents + menu_items           │
                 └────────────────────────────────────────┘
```

## Couches DB

### Couche canonique
- `restaurants` — 1 ligne par établissement réel (57k actuellement, dont 3 273 dans la pool premium)
- `restaurant_links` — URLs liés (site, social, livraison, réservation, menu)
- `menu_documents` — menus collectés en texte brut
- `menu_items` — plats + prix structurés (extracteur LLM à venir)

### Couche staging (nouvelle)
- `source_records` — chaque scrape se vide ici en JSONB immutable. Trace complète.
- `restaurant_identities` — mapping persistant `(source, source_id) → restaurant_id`.
  Permet de re-scraper Rappi/Michelin/etc. sans refaire l'entity resolution à chaque pass.

## La pool premium

Définie dans `scripts/lib/pool.js` :
- **Alcaldías** : Cuauhtémoc, Benito Juárez, Miguel Hidalgo, Coyoacán, Álvaro Obregón, Cuajimalpa, Tlalpan
- **Estratos DENUE** : ≥ 11 employés (proxy "fait du volume")
- **Taille actuelle** : 3 273 restos → on en sélectionnera 500 à la fin

**Règle d'or** : tout script d'enrichissement coûteux (Google Places API, LLM,
crawl deep) **doit** filtrer sur la pool via `fetchPool()`. Sinon on brûle du
budget sur les 54k restos de bas niveau.

## Ajouter une nouvelle source (workflow Codex)

1. **Copier le template** :
   ```bash
   cp scripts/sources/_template.js scripts/sources/<source>.js
   ```
2. **Implémenter `scrape()`** dans ce fichier. Doit retourner un array où chaque objet a au minimum :
   - `source_id` (string, unique chez la source)
   - `name`
   - et idéalement : `latitude`, `longitude`, `address`, `phone`, `website`, `payload` (raw)
3. **Lancer le scrape** → écrit `data/raw/<source>/<date>.json` (rien en DB) :
   ```bash
   node scripts/sources/<source>.js
   ```
4. **Ingest** → pousse dans `source_records` puis fait l'entity resolution :
   ```bash
   npm run ingest -- --source=<source> --date=<YYYY-MM-DD>
   ```
   ou en dry-run pour vérifier :
   ```bash
   npm run ingest -- --source=<source> --date=<YYYY-MM-DD> --dry
   ```
5. **Vérifier l'impact** :
   ```bash
   npm run audit:pool
   ```

### Ce que Codex NE doit PAS faire
- ❌ Écrire directement dans `restaurants` (toujours passer par `ingest.js`)
- ❌ Faire un `ilike(nombre, name)` pour matcher (utiliser `lib/match.js`)
- ❌ Mettre des données dans `data/` à la racine (toujours sous `raw/<source>/`)
- ❌ Re-générer le wheel — utiliser `lib/supabase.js`, `lib/normalize.js`, `lib/match.js`

## Tiers funnel

Le funnel persistant est exposé en vues Postgres lecture seule pour séparer les niveaux de qualité.

- `tier_0_all` : tout `restaurants`
- `tier_1_active` : restos `actif`, sans signal de suspension INVEA
- `tier_2_real_food` : `codigo_scian LIKE '7225%'`, hors marchés publics
- `tier_3_geo_premium` : alcaldías premium
- `tier_4_volume` : `estrato >= 11`
- `tier_5_enriched` : signal d'enrichissement via Google Places ou identities premium
- `tier_6_qualified` : rating >= 4.0 et volume >= 50 sur au moins un signal source
- `restaurant_score` : score 0-100 sur la base de `tier_6_qualified`, avec `rank_overall` et `rank_alcaldia`

Cardinalités observées sur la base live :

- `tier_0_all` : 57 457
- `tier_1_active` : 57 405
- `tier_2_real_food` : 55 704
- `tier_3_geo_premium` : 7 785
- `tier_4_volume` : 1 701
- `tier_5_enriched` : 317
- `tier_6_qualified` : 220

Top 5 score observé :

- `RESTAURANTE PUJOL` — 74.10
- `RESTAURANTE QUINTONIL` — 70.87
- `LIMANTOUR` — 50.10
- `GUZINA OAXACA` — 45.77
- `PORFIRIO S RESTAURANTE` — 44.81

## Couche serving — le front (`web/`)

Un moteur de recherche Next.js calqué sur TheFork vit dans `web/`. Il ne lit
jamais `payload` directement : tout passe par une couche de vues.

```
restaurants + source_records (JSONB)
            │
            ▼
   VIEW restaurant_search        ← aplatit google_places / michelin / 50best /
            │                      opentable + restaurant_score en colonnes
            ▼
   MATVIEW restaurant_search_mv  ← snapshot indexé : 3,5 s → 1 ms
            │
            ▼
   web/ (Next.js, lecture serveur uniquement)
```

**Règle d'or n°2** : après tout `npm run ingest` ou script d'enrichissement,
lancer `npm run search:refresh`. Sinon le site sert l'ancien instantané.

### Golden record

`restaurant_golden_record_mv` fournit une fiche consolidée par restaurant sans
modifier le brut ni le canonique. Les champs sont choisis selon une priorité
explicite (liens vérifiés, Google, canonique, sources éditoriales) et
`field_provenance` indique la source retenue pour chaque valeur. Après une
ingestion, lancer `npm run golden:refresh`.

En local, `npm run golden:local` reconstruit la table SQLite
`restaurant_golden_record` depuis le snapshot `data/local_db/cdmx_local.sqlite`.
Cette commande doit être rejouée après chaque `npm run export:local`.

`npm run audit:conflicts-local` reconstruit ensuite la quarantaine SQLite
`restaurant_field_conflicts` (nom, adresse, téléphone, site et coordonnées).
L'audit ne modifie jamais les fiches canoniques ni les données brutes.

`npm run fix:matches-local` produit un dry-run des associations manifestement
fausses. `npm run fix:matches-local -- --execute` les délie localement et garde
leur état complet dans `source_match_quarantine` et
`identity_match_quarantine`, permettant un rollback.

`npm run dedupe:exact-local` audite les doublons partageant le même Google
Place ID à moins de 120 m. L'option `-- --execute` fusionne uniquement ces cas
et sauvegarde les lignes complètes dans `restaurant_merge_quarantine`.

Pour le top 500 local : `npm run web:top500-local` découvre gratuitement les
réseaux sociaux, menus et horaires des sites officiels,
`npm run menus:top500-local` extrait les nouveaux menus, puis
`npm run audit:top500-local` matérialise la couverture dans
`top500_enrichment_status`.

Le front n'affiche par défaut que les fiches `is_enriched` (~930 : celles qui ont
une photo et une note Google). Les 57k autres sont accessibles via un filtre.
Ce périmètre grandit mécaniquement à mesure que la pool est enrichie.

Détails, écarts avec TheFork et note de sécurité : voir `web/README.md`.

## Layout des fichiers

```
CDMX_RESTAURANTS/
├── schema.sql                   ← source de vérité unique du schéma DB
├── ARCHITECTURE.md              ← ce fichier
├── package.json                 ← raccourcis npm pour chaque source/pipeline
├── .env                         ← SUPABASE_URL + SUPABASE_SERVICE_KEY (gitignored)
│
├── data/
│   ├── raw/<source>/<date>.json ← dumps immutables (un par scrape)
│   ├── processed/               ← intermediates régénérables
│   └── exports/                 ← outputs finaux (top 500, etc.)
│
├── scripts/
│   ├── lib/                     ← utilities partagées (importer dans nouvelles sources)
│   │   ├── supabase.js          ← client + upsertBatch + sanitizeText
│   │   ├── normalize.js         ← normalizeName/Url/Phone + distanceMeters + nameSimilarity
│   │   ├── match.js             ← resolveEntity + persistIdentity
│   │   └── pool.js              ← fetchPool + poolStats + PREMIUM_*
│   │
│   ├── sources/
│   │   ├── _template.js         ← template à copier pour ajouter une source
│   │   └── ...                  ← nouvelles sources Codex
│   │
│   ├── ingest.js                ← raw → source_records → entity resolution (générique)
│   ├── audit_db.js              ← stats globales
│   ├── audit_pool.js            ← stats de la pool premium (à lancer souvent)
│   │
│   ├── scrape_*.js              ← scrapers legacy (à migrer progressivement vers sources/)
│   ├── enrich_*.js              ← scripts d'enrichissement par source
│   ├── crawl_*.js               ← crawlers sur les sites officiels
│   ├── verify_*.js              ← vérifications (Google, websites)
│   ├── discover_menus.js        ← découverte des liens menu
│   ├── extract_menu_text.js     ← extraction texte des PDFs/HTML menus
│   └── push_collected_data.js   ← legacy : push des fichiers data/processed/
```

## Sources actuellement intégrées

| Source           | Type             | Statut       | Notes |
|------------------|------------------|--------------|-------|
| DENUE (INEGI)    | registre fiscal  | ✅ 57 168    | base broad, contient `estrato` → notre signal taille |
| OSM              | crowdsourcé      | ✅ 1 578     | bons GPS et cuisine_type |
| Rappi            | livraison        | ✅ 212       | scrapé en API directe (token Playwright) |
| Michelin         | guide qualité    | ✅ 200/198   | 200 snapshots stagés, 198 matchés |
| World's 50 Best  | prestige/ranking | ✅ 15/12     | Latin America restaurants + North America bars, signal A/A+ |
| OpenTable        | réservations     | ✅ 206/102   | signal premium, prix, cuisine, reviews |
| Resy             | réservations     | ✅ 867/632   | forte couverture CDMX, GPS + téléphone |
| CANIRAC          | registre métier  | ✅ 296/53    | SafeTravels historique ; matching strict nom + CP |
| Wikidata         | notable/CC0      | ✅ 24/17     | sites, cuisines, images, dates de création |
| Star Wine List   | vin/premium      | ✅ 37/11     | établissements CDMX ; matching exact unique uniquement |
| HappyCow         | vegan/spécialisé | ✅ 10/1      | top 10 CDMX, notes, avis, téléphone et adresse |
| Tesoros de México| qualité officielle| ✅ 11/5     | restaurants CDMX nommés dans l’annuaire SECTUR 2020 |
| La Liste         | prestige/scoring | ✅ 9/6       | Top 1000 édition 2026, scores officiels CDMX |
| México Gastronómico | guide national | ✅ 79/35    | sélection CDMX 2026, quartiers + 79 Instagram |
| TripAdvisor      | reviews/photos   | ⏳            | scraper écrit, pas encore lancé en --import |
| TheFork          | réservations     | 🚫 bloqué     | anti-bot ; à reprendre via extension Chrome |
| Uber Eats        | livraison        | ⏳            | scraper écrit |
| Reservándonos    | réservations     | ✅ 357/62     | 357 profils détaillés : GPS, téléphone, prix, horaires, cuisines, galeries |
| DiDi Food web    | livraison/SEO    | ✅ 163/22     | pages publiques uniquement ; adresses, notes et catégories CDMX |
| RestaurantGuru   | rankings broad   | ✅ 1 288/111 | index complet ; détails bloqués par anti-bot |
| Instagram bios   | enrichissement   | ✅ 101       | bios + external URLs des profils déjà identifiés |

## Sources à ajouter (idées pour Codex)

- **Google Places API** — **PAUSE COÛTS** : ne plus appeler sans autorisation explicite
- **Foursquare / Swarm** — popularité crowdsourcée
- **Yelp** — reviews + rating + price_level (mais coverage MX limitée)
- **SevenRooms / Tock** — réservations premium complémentaires
- **Wine Folly / Sherry Gross** — listes éditoriales fine dining
- **Mexico Travel Channel / Mexico Desconocido** — rédactionnel local
- **Reseñas Polanco / Time Out México** — listes éditoriales locales
- **Pesquisa de registres fiscaux** — déjà fait (DENUE) ; secondaire : INEGI economic census, SAT public lists
- **Instagram followers/engagement** — proxy popularité, à scraper en batch sur la pool
- **Google Trends** — recherche du nom + colonia, signal demande
- **CANIRAC actuel** — carte officielle trouvée, mais son API publique renvoie actuellement 0 restaurant
- **Distintivo H** — annuaire officiel trouvé mais agrégé par société, inutilisable pour un matching restaurant sûr

## Pour info — schéma `source_records`

```sql
source_records (
  id, source, source_id, scrape_date, scraped_at,
  name, latitude, longitude, address, phone, website,
  payload jsonb,                  -- l'enregistrement brut tel quel
  processed_at, matched_restaurant_id, match_confidence, match_method,
  UNIQUE (source, source_id, scrape_date)
)
```

L'ingester remplit `processed_at` + `matched_restaurant_id` après l'entity resolution.
Si `match_method = 'new_insert'`, c'est un resto à créer dans `restaurants` (à faire
dans un 2e temps, après revue manuelle si confiance basse).

## Pipeline local de qualité (sans API payante)

Le snapshot SQLite conserve les tables sources et ajoute des couches dérivées,
entièrement régénérables :

- `npm run golden:local` : reconstruit le golden record ;
- `npm run audit:conflicts-local` : matérialise les conflits par champ ;
- `npm run audit:menus-local` : classe les menus en `high`, `review`, `rejected` ;
- `npm run menu-items:local` : extrait prudemment les plats/prix vers
  `menu_items_local_extracted` sans modifier `menu_items` ;
- `npm run audit:top500-local` : reconstruit la couverture et les priorités top 500.
- `npm run candidates:local` : consolide les `new_insert` dans
  `restaurant_candidate_pool` et garde leurs membres dans
  `restaurant_candidate_members`, sans promotion automatique ;
- `npm run ingest:local -- --source=X --date=YYYY-MM-DD` : stage et matche un raw
  directement dans SQLite, sans Supabase et sans insertion canonique automatique ;
- `npm run backup:local` : crée une copie SQLite cohérente avec manifeste SHA-256.

Les quarantaines `source_match_quarantine` et `restaurant_merge_quarantine`
conservent la traçabilité des associations retirées et des neuf fusions exactes.

Les commandes npm Google sont volontairement verrouillées par
`scripts/google_spend_blocked.js` afin d'éviter toute dépense accidentelle.
