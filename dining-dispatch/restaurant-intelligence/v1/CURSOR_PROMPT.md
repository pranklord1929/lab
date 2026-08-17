# Prompt Cursor — brancher le catalog V1

Tu travailles dans :
`/Users/thediningdispatch/Desktop/03_MEXICO/TDD`

La base V1 est déjà prête. Tu ne collectes rien. Tu ne matchs rien. Tu branches.

## Lire d’abord

1. `restaurant-intelligence/v1/README.md`
2. `restaurant-intelligence/v1/manifest.json`
3. `restaurant-intelligence/v1/registry.json`
4. `restaurant-intelligence/docs/SITE_DATA_CONTRACT.md`
5. `lib/data/index.ts` + `lib/data/site-data.ts` + `lib/restaurants/load.ts`

## Source runtime

Remplace la source du front.

Avant : `restaurant-intelligence/site-data/` (876 fiches, 100 launch).
Après : `restaurant-intelligence/v1/site-data/` (29 fiches, 17 collections).

Change `SITE_DATA_ROOT` dans `lib/restaurants/paths.ts` (ou équivalent) pour pointer vers `restaurant-intelligence/v1/site-data`.

Ne duplique pas les JSON dans `public/` ni `content/`. Lecture serveur uniquement.

## Comportement attendu

- Homepage, `/restaurants`, `/restaurants/[slug]`, collections : uniquement les 29 slugs de `v1/site-data/index.json`.
- Ordre = `launch-candidates.json` (ordre de la liste privée).
- Un slug hors allowlist → 404. `dynamicParams` ne doit pas ressusciter une fiche des 876.
- Sitemap : seulement `seo.indexable === true` (aujourd’hui : zéro).
- Collections : utiliser `v1/site-data/collections.json` tel quel. Ne pas régénérer date-night / vegetarian / business-dinner.
- Libellés : Source-dated / Last observed / nombre de sources. Jamais Verified / Confidence.
- Editorial vide → `Editorial review pending`. Pas de FAQ, best for, difficulté de résa inventés.
- Images absentes volontairement.

## Interdit

- Relire `restaurant-intelligence/site-data/` (les 876) au runtime.
- Relire `archive/legacy-data/` ou la SQLite depuis le front.
- Fusionner `content/fixtures.json`.
- Activer `supabaseStore` / `fixtureStore`.
- Inventer une fiche pour un nom de `registry.json` dont `status !== "on_site"`.
- Pousser, déployer.

## Copy

Retire les mentions « 876 candidates » et « 100 launch ».
Dis : catalog privé Mexico City, 29 fiches matchées, 0 indexées.

## Tests

- 29 slugs uniques, tous présents dans `v1/site-data/restaurants/`.
- `/restaurants/pujol` et `/restaurants/quintonil` chargent.
- `/restaurants/sud-777`, `/restaurants/lardo`, `/restaurants/expendio-de-maiz` → 404.
- Aucune fiche hors allowlist dans homepage / index / collections / sitemap.
- `npm run data:check` : mets à jour le validateur (29, plus 876/100).
- `npm run build` et lint passent.

À la fin : URLs localhost, fichiers modifiés, rien d’autre.
