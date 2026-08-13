# SEO Autopilot

Un outil en ligne de commande pour générer et publier automatiquement des articles SEO/GEO sur ton site GitHub.

**Ce que ça fait :**
1. Propose 5 sujets d'articles basés sur ta niche
2. Tu choisis le sujet qui t'intéresse
3. Il rédige un article complet, optimisé SEO et GEO (citable par les IA)
4. Il le commit directement sur ton repo GitHub → ton site se met à jour automatiquement

---

## Prérequis

- [Node.js](https://nodejs.org/) version 18 ou plus récente
- Un compte GitHub avec ton site hébergé dessus (GitHub Pages, Netlify, etc.)
- Une clé API Claude (Anthropic) — gratuite avec $5 de crédit sur [console.anthropic.com](https://console.anthropic.com)

---

## Installation

### 1. Récupérer le code

```bash
git clone https://github.com/thediningdispatch/seo-autopilot.git
cd seo-autopilot
npm install
```

### 2. Configurer le fichier `.env`

Copie le fichier d'exemple et remplis tes infos :

```bash
cp .env.example .env
```

Ouvre `.env` dans un éditeur de texte et remplis les champs :

```env
# Clé Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-...

# Ton compte GitHub
GITHUB_TOKEN=ghp_...
GITHUB_OWNER=ton-pseudo-github
GITHUB_REPO=nom-de-ton-repo

# Ton site
SITE_NAME=Mon Site
SITE_URL=https://mon-site.netlify.app
SITE_DESCRIPTION=Blog sur la photographie de voyage et les techniques en lumière naturelle
SITE_TONE=expert mais accessible, sans jargon inutile
```

> **Où trouver chaque clé ?**
> - **ANTHROPIC_API_KEY** → [console.anthropic.com/settings/api-keys](https://console.anthropic.com/settings/api-keys)
> - **GITHUB_TOKEN** → [github.com/settings/tokens](https://github.com/settings/tokens) → "Generate new token (classic)" → coche `repo`

### 3. Lancer l'outil

```bash
npm start
```

---

## Comment ça marche

L'outil te pose des questions simples dans le terminal :

```
╔══════════════════════════════════════╗
║        SEO Autopilot — CLI           ║
╚══════════════════════════════════════╝

Site    : Mon Site (https://mon-site.netlify.app)
GitHub  : jean/mon-site [main]
LLM     : Claude claude-sonnet-4-6

Génération de 5 sujets d'articles...

Sujets proposés :

  1. Les 10 meilleures destinations photo en Europe
     Angle   : Guide pratique avec conseils de lumière par saison
     Mot-clé : destinations photo Europe [informatif]

  2. Comment photographier le coucher de soleil sans surexposer
     Angle   : Technique pas à pas, réglages et erreurs à éviter
     Mot-clé : photographier coucher de soleil [informatif]

  ...

Choisis un sujet (1-5) ou tape "r" pour en avoir de nouveaux :
> 2

Rédaction de l'article...

────────────────────────────────────────────────────
Titre   : Comment photographier le coucher de soleil sans surexposer
Slug    : photographier-coucher-de-soleil
Meta    : Apprenez à maîtriser l'exposition...
Lecture : ~4 min
────────────────────────────────────────────────────

Publier cet article sur GitHub ? (o/n) :
> o

Commit en cours...
Article publié ! → https://mon-site.netlify.app/blog/photographier-coucher-de-soleil.html
```

---

## Structure du repo de ton site

Pour que l'outil fonctionne, ton site doit avoir cette structure minimale :

```
ton-site/
├── blog/
│   ├── index.html      ← index du blog (sera mis à jour automatiquement)
│   └── article-1.html
├── sitemap.xml         ← optionnel, mis à jour automatiquement
└── ...
```

**Important :** Dans ton `blog/index.html`, l'outil cherche l'ancre `BLOG_INDEX_ANCHOR` (par défaut `<div class="post-list">`) et y insère la carte du nouvel article juste après. Assure-toi que cet élément existe dans ton HTML.

---

## Personnaliser la mise en page des articles

Par défaut, l'outil génère un design minimaliste fonctionnel.

Pour utiliser **le style de ton propre site** :
1. Crée un fichier `template.html` à la racine du dossier `seo-autopilot/`
2. Construis ta page article avec les balises de ton site (header, footer, CSS)
3. Place les variables suivantes là où tu veux le contenu :

| Variable | Contenu |
|---|---|
| `{{TITLE}}` | Titre de l'article (échappé HTML) |
| `{{TITLE_RAW}}` | Titre brut (pour JSON-LD) |
| `{{META_DESCRIPTION}}` | Meta description (150-160 car.) |
| `{{TARGET_KEYWORD}}` | Mot-clé principal |
| `{{CONTENT}}` | Corps de l'article en HTML |
| `{{DATE_ISO}}` | Date au format `2026-06-25` |
| `{{DATE_FR}}` | Date au format `25 juin 2026` |
| `{{READING_MINUTES}}` | Temps de lecture estimé |
| `{{SLUG}}` | Slug de l'article |
| `{{ARTICLE_URL}}` | URL complète de l'article |
| `{{SITE_NAME}}` | Nom du site |
| `{{SITE_URL}}` | URL du site |
| `{{BLOG_DIR}}` | Dossier du blog |

**Exemple de template.html minimal :**

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>{{TITLE}} | {{SITE_NAME}}</title>
  <meta name="description" content="{{META_DESCRIPTION}}" />
  <link rel="canonical" href="{{ARTICLE_URL}}" />
  <link rel="stylesheet" href="../style.css" />
</head>
<body>
  <header><!-- ton header ici --></header>
  <main>
    <h1>{{TITLE}}</h1>
    <p>Publié le {{DATE_FR}} · {{READING_MINUTES}} min de lecture</p>
    {{CONTENT}}
  </main>
  <footer><!-- ton footer ici --></footer>
</body>
</html>
```

---

## Options avancées dans `.env`

| Variable | Défaut | Description |
|---|---|---|
| `LLM_PROVIDER` | `anthropic` | `anthropic` ou `deepseek` |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Modèle Claude à utiliser |
| `GITHUB_BRANCH` | `main` | Branche sur laquelle committer |
| `BLOG_DIR` | `blog` | Dossier des articles dans le repo |
| `BLOG_INDEX_PATH` | `blog/index.html` | Chemin vers l'index du blog |
| `BLOG_INDEX_ANCHOR` | `<div class="post-list">` | Ancre HTML d'injection dans l'index |
| `SITEMAP_PATH` | _(vide)_ | Chemin du sitemap.xml (optionnel) |

---

## Qu'est-ce que le GEO ?

Le **GEO** (Generative Engine Optimization) est l'optimisation pour les IA génératives comme ChatGPT, Perplexity ou Google AI Overview. En plus du SEO classique, cet outil génère des articles :

- **Factuels et directs** — les IA citent ce qui est clair et vérifiable
- **Bien structurés** — des sous-titres H2 précis facilitent l'extraction d'information
- **Autoritatifs** — un ton expert sans remplissage

En pratique : tes articles remontent à la fois sur Google ET dans les réponses des IA lorsque quelqu'un pose une question liée à ta niche.

---

## Dépannage

**"GITHUB_TOKEN manquant"**
→ Vérifie que ton `.env` est bien rempli et que tu n'as pas copié le `.env.example` sans le modifier.

**"Not Found" ou erreur GitHub 404**
→ Vérifie `GITHUB_OWNER` et `GITHUB_REPO` — attention aux majuscules.

**"Ancre introuvable dans l'index"**
→ Ouvre ton `blog/index.html` et cherche l'élément qui contient la liste d'articles. Copie-colle sa balise ouvrante dans `BLOG_INDEX_ANCHOR`.

**L'article a été créé mais l'index n'est pas à jour**
→ Vérifie `BLOG_INDEX_PATH` et `BLOG_INDEX_ANCHOR` dans ton `.env`.

---

## Licence

MIT — libre d'utilisation, modification et distribution.
