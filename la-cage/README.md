# La Cage

Dashboard resto + import documents (Excel / PDF) + agents en code.

| | |
|--|--|
| GitHub | https://github.com/thediningdispatch/la-cage *(privé)* |
| Prod | https://restaurant-ai-rocket.vercel.app |
| Local | http://localhost:3456 |

## Stack

Next.js 16 · TypeScript · Tailwind · **Supabase** (ou store local `data/`) · Vercel · GitHub

## Démarrer (toi / Louis)

```bash
git clone https://github.com/thediningdispatch/la-cage.git
cd la-cage
npm install
npm run dev
```

Sans clés Supabase → mode **local** (JSON dans `data/`). L’UI et l’import marchent tout de suite.

## Supabase (prod / partagé)

1. Projet sur [supabase.com](https://supabase.com)
2. SQL Editor → coller dans l’ordre :
   - `supabase/migrations/001_init.sql`
   - `supabase/migrations/002_rls.sql`
3. Storage : bucket `documents` (créé par le SQL si droits OK)
4. `.env.local` :

```bash
cp .env.example .env.local
# NEXT_PUBLIC_SUPABASE_URL=
# NEXT_PUBLIC_SUPABASE_ANON_KEY=
# SUPABASE_SERVICE_ROLE_KEY=
```

5. Même vars dans **Vercel → Project → Settings → Environment Variables** → Redeploy

`GET /api/health` → `"mode":"supabase"` quand c’est bon.

## Import fichiers

UI : bouton **Importer** (PDF, xlsx, csv)

API :

```bash
# multipart
curl -F "file=@samples/inventaire.xlsx" http://localhost:3456/api/documents

# re-parse
curl -X POST http://localhost:3456/api/documents/<id>/parse
```

Samples :

```bash
npm run samples
# → samples/inventaire.xlsx, paie.xlsx, factures.xlsx
```

| Type | Détection | Tables |
|------|-----------|--------|
| Excel inventaire | colonnes stock/par | `inventory_items` |
| Excel / PDF paie | salaire, net, heures | `payroll_entries` |
| Excel / PDF facture | HT/TTC, n° | `invoices` + `suppliers` |

## Agents

`src/agents/registry.ts` — code only.

```
GET /api/agents
GET /api/dashboard
GET /api/health
POST /api/documents
PATCH /api/alerts/:id
```

## Chez Louis

1. Collaborateur sur le repo GitHub  
2. clone → `npm install` → `npm run dev`  
3. Optionnel : mêmes clés Supabase pour partager la data  

## Google Drive (suite)

Service account + export vers `POST /api/documents` (base64 ou multipart). Le pipeline parse est déjà en place.
