# Endpoints publics utilisés

On n’attaque rien. On rejoue les mêmes JSON que les sites chargent dans le navigateur.

## Michelin Guide — Algolia (le plus utile)

Le front `guide.michelin.com` cherche ici :

```
POST https://8NVHRD7ONV-dsn.algolia.net/1/indexes/prod-restaurants-es/query
x-algolia-application-id: 8NVHRD7ONV
x-algolia-api-key: 3222e669cf890dc73fa5f38241117ba5   # search-only, déjà dans le JS public
filters: sites:mx
```

Champs : nom, rue, CP, tel, site, GPS, distinction, green star, cuisines, texte inspecteur, booking URL.

Sortie : `michelin-algolia-cdmx.json`, `michelin-by-catalog-name.json`.

**72 / 114** noms du catalog ont au moins un hit.

## Reservándonos — listing API

```
GET https://reservandonos.com/api/places-by-filter?page=N&mode=web
```

Profils : `https://reservandonos.com/lugar/<slug>` + `__NUXT_DATA__` (horaires, galerie, menu PDF).

Dump local juillet : 357 CDMX, presque tous avec `schedule`.

## OpenTable

Pas d’API partenaire. Le site Next.js expose `__NEXT_DATA__` + JSON-LD Restaurant (adresse, tel, horaires).  
Dump local : 206 restos CDMX (`raw/opentable/2026-06-29.json`).  
**24** matchs catalog. Curl direct souvent bloqué (HTTP/2 / bot). Playwright déjà dans le pipeline.

## Resy

```
POST https://api.resy.com/3/venuesearch/search
```

Sans header `Authorization: ResyAPI api_key="…"` → 419. La clé est dans le JS public de resy.com ; le scraper existant la capture en session navigateur.  
Dump local : 867 venues. **18** matchs catalog.

## Fichiers

| Fichier | Rôle |
|---|---|
| `michelin-algolia-cdmx.json` | Hits guide CDMX live |
| `michelin-by-catalog-name.json` | Query par nom Notion |
| `michelin-overlay-site-data.json` | Overlay pour les 29 fiches |
| `catalog-source-matches.json` | Recoupement 4 sources × 114 |
| `reservandonos-live-cdmx.json` | Listing live (30 premières pages) |
