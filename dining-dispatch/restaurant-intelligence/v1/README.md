# Dining Dispatch — catalog V1

Source : liste privée `Downloads/Private & Shared` (114 noms).
Croisée avec le corpus CDMX (SQLite + `site-data` 876).

Le front ne doit consommer que `v1/site-data/`.
Les 876 fiches de `restaurant-intelligence/site-data/` restent l’archive brute.

## Chiffres

| Statut | N |
|---|---:|
| Sur le site (fiche matchée) | 29 |
| Dans la SQLite, pas de fiche web | 40 |
| Match trop risqué | 17 |
| Absent de la base | 28 |
| **Total CSV** | **114** |

Aucun n’est `indexable`. Aucun n’a de review éditoriale.

## Fichiers

```
v1/
  manifest.json
  registry.json                 # les 114, avec statut + action
  allowlist.json                # les 29 slugs
  needs-scrape.json             # 40 + 17 + 28 à traiter
  source/mexico-restaurants.csv
  site-data/                    # contrat web, même forme que l’ancien site-data
    index.json                  # 29
    launch-candidates.json      # 29, ordre CSV
    collections.json            # 17 collections objectives, filtrées
    restaurants/<slug>.json     # 29 fiches complètes
    manifest.json
  CURSOR_PROMPT.md
```

## Règle

`registry.json` → `status === "on_site"` seulement sur le site.
Le reste attend un scrape. Ne pas inventer une fiche.
