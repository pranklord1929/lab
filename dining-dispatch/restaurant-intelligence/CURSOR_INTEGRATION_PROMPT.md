# Prompt Cursor — integrate the existing CDMX intelligence into the simple V0 front

Tu travailles dans :
`/Users/thediningdispatch/Desktop/03_MEXICO/TDD`

La donnée existante est dans :
`/Users/thediningdispatch/Desktop/03_MEXICO/TDD/restaurant-intelligence`

Mission : intégrer cette donnée au front Next.js SEO-first que tu es déjà en
train de construire, sans refaire le design et sans inventer de contenu.

## Avant de coder

1. Lis `AGENTS.md` dans le projet Next.js et les guides Next.js locaux qu'il
   exige pour les APIs que tu vas utiliser.
2. Lis entièrement :
   - `restaurant-intelligence/README.md`
   - `restaurant-intelligence/docs/SITE_DATA_CONTRACT.md`
   - `restaurant-intelligence/docs/DATA_AUDIT_2026-08-17.md`
   - `restaurant-intelligence/site-data/manifest.json`
3. Inspecte le code actuel et préserve la direction visuelle déjà construite.

## État actuel déjà audité — ne repars pas de zéro

Le front possède déjà une abstraction utile : `CatalogStore` dans
`lib/data/types.ts`, un `fixtureStore`, un `supabaseStore`, les routes
restaurants/collections, le sitemap, les metadata, le JSON-LD et les composants
de fiche. Conserve cette architecture et ajoute un `siteDataStore` serveur-only
au lieu de réécrire tout le site.

Attention : `content/fixtures.json` est uniquement une démo UI. Il contient
actuellement des affirmations subjectives et des données datées du 2026-08-17
(`last_verified`, menus/prix, conseils de réservation, FAQ, “best for”, etc.)
qui ne sont pas validées par le corpus audité. Ne fusionne pas ces valeurs avec
la vraie donnée, ne les ingère pas dans Supabase, et ne les publie pas. Garde le
fichier comme fixture explicitement non-production ou archive-le, mais retire-le
du chemin runtime par défaut. Ne lance ni `scripts/ingest.mjs` ni
`supabase/seed.sql` sur cette fixture.

## Source de données V0

Utilise uniquement `restaurant-intelligence/site-data/` :

- `index.json` pour listes, recherche et cartes ;
- `launch-candidates.json` pour les 100 premières fiches à brancher ;
- `restaurants/<slug>.json` pour les pages détail ;
- `collections.json` pour les collections objectives ;
- `qa/needs-review.json` uniquement pour le contrôle interne.

Ne lis jamais `archive/legacy-data` dans le front. Ne branche pas le navigateur
directement sur les tables Supabase brutes. N'ajoute aucune clé service-role.

`restaurant-intelligence/site-data` est déjà dans la racine du dépôt que
Vercel construira. Lis cette couche directement côté serveur et ne la duplique
pas dans `public/` ou dans un second dossier. Crée plutôt un script
`scripts/validate-restaurant-data.mjs`, ajoute `npm run data:check`, et exécute
ce contrôle avant `build`. Ce script doit refuser le build si les comptes,
l'unicité des slugs ou les garde-fous d'indexation dérivent. L'archive SQLite,
les raw payloads et le pipeline ne doivent jamais entrer dans le bundle web.

## Implémentation attendue

1. Crée une couche typée unique, par exemple `lib/restaurants/`, qui :
   - définit les types d'après le contrat réel ;
   - valide au minimum les champs indispensables à l'exécution ;
   - charge l'index et une fiche par slug côté serveur ;
   - expose `getRestaurant`, `getLaunchRestaurants`, `getCollections` et les
     helpers nécessaires ;
   - ne bundle pas les 876 fiches complètes dans le JavaScript client.
   Implémente-la comme un nouveau `siteDataStore` respectant au maximum
   l'interface `CatalogStore`, puis fais-en le store V0 par défaut. Le
   `supabaseStore` existant peut rester disponible, mais ne doit pas s'activer
   automatiquement sur un ancien projet dont le schéma ne correspond pas.
2. Branche `/restaurants/[slug]` sur les 100 `launch-candidates` pour la V0.
   Utilise les APIs Next.js 16 documentées localement. Les slugs viennent de la
   donnée ; ne les recalcule pas.
3. Chaque fiche peut afficher uniquement les faits présents : nom, quartier,
   adresse, cuisine, niveau de prix, horaires, site, Instagram, réservation,
   distinctions, menu candidat, provenance et dates d'observation.
4. Affiche les dates avec une formulation exacte du type `Menu observed on …`
   ou `Data last observed on …`. Ne dis jamais `verified today`.
5. La section `The Dining Dispatch Review` doit afficher un état neutre
   `Editorial review pending` tant que `editorial.status !== "reviewed"`.
   N'invente aucun `best for`, `avoid for`, ambiance, moment idéal, type de
   visiteur, conseil de réservation ou FAQ.
   En particulier, supprime les defaults trompeurs du hydrateur actuel : une
   difficulté de réservation absente ne doit pas devenir `moderate`, et une
   fiche machine ne doit pas devenir `published: true` par défaut.
6. Pour les menus :
   - distingue visuellement `structured_candidate`,
     `local_extraction_candidate`, `document_only` et `missing` ;
   - affiche la source et `observedAt` lorsqu'elles existent ;
   - ne présente jamais un prix comme actuel si la date/source manque ;
   - groupe les plats par catégorie seulement si la catégorie existe.
7. Les images sont absentes volontairement. N'essaie pas de reconstruire les
   références Google Places et ne mets pas d'image distante inventée. Utilise
   le traitement visuel neutre déjà prévu par le design.
8. Branche les collections objectives fournies : quartier, borough, cuisine,
   Michelin et World's 50 Best. Ne génère pas encore `date night`, `business
   dinner`, `tourist-friendly` ou autres collections subjectives.
9. Génère les metadata et le JSON-LD `Restaurant` uniquement avec les champs
   factuels présents. Omet tout champ absent au lieu d'utiliser un placeholder.
10. Respecte la frontière SEO :
    - toutes les fiches sont `noindex,follow` tant que
      `seo.indexable !== true` ;
    - le sitemap n'inclut que les fiches explicitement indexables ;
    - n'utilise pas `launchEligible` comme équivalent de validation humaine ;
    - les pages candidates peuvent être visibles en localhost pour QA.
    Le `sitemap.ts` actuel inclut toutes les fiches : corrige-le. Le fallback de
    `generateMetadata` dit actuellement “Verified menu, hours…” : retire cette
    affirmation. Étends `pageMetadata` pour accepter un robots par page si
    nécessaire ; le `defaultMetadata` global indexable ne doit pas écraser le
    `noindex` des fiches candidates.
11. La homepage peut montrer 6 à 12 launch candidates, en restant factuelle.
    Elle ne doit pas transformer le classement interne en palmarès éditorial.
    Remplace aussi les libellés actuels `Verified`, `Last verified` et
    `Confidence` par des libellés exacts (`Source-dated`, `Last observed`,
    nombre de sources) tant que la fiche n'a pas de validation humaine. Ne
    montre pas `internalQuality` comme une note de confiance publique.
12. Adapte `RestaurantFiche` sans jeter son design :
    - l'en-tête ne doit plus dire `Verified` pour une candidate ;
    - le panneau Trust montre sources, provenance et dates d'observation ;
    - Review/FAQ/réservation subjective restent en attente si vides ;
    - le menu affiche son état d'extraction et non `Verified` ;
    - le JSON-LD omet FAQ, menu, image ou tout autre champ qui n'est pas
      réellement soutenu par la fiche.
13. Désactive pour l'instant les collections de fixture subjectives
    (`date-night`, `business-dinner`, `vegetarian`, etc.). Utilise uniquement
    les 81 collections objectives fournies, et garde toutes les collections
    candidates hors sitemap tant qu'elles ne sont pas explicitement validées.

## Garde-fous techniques

- Ne modifie pas le paquet source `restaurant-intelligence/site-data` à la
  main. Toute évolution de donnée doit venir de
  `node restaurant-intelligence/scripts/export-site-data.mjs`.
- Ne révèle jamais `internalQuality`, les raw payloads ou les clés.
- Ne connecte pas le build à une API payante.
- Ne pousse pas et ne déploie pas dans cette passe. Termine par un localhost
  fonctionnel et un rapport de fichiers modifiés.
- Ne remplace pas le design actuel par un template générique.

## Tests d'acceptation

Ajoute ou exécute des contrôles qui prouvent :

- 876 slugs uniques dans l'index ;
- exactement 100 launch candidates ;
- une fiche `quintonil` et une fiche `pujol` se chargent sans erreur ;
- aucune fiche non relue n'est indexable ni présente dans le sitemap ;
- aucune valeur éditoriale subjective n'est fabriquée ;
- le build de production et le lint passent ;
- les pages détail ne chargent pas le catalogue complet côté client.

À la fin, donne-moi : le résultat du build/lint/tests, les URLs localhost à
ouvrir, les fichiers modifiés et les éventuels blocages de donnée restants.
