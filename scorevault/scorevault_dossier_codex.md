# ScoreVault — Dossier projet + instructions Codex

## 1. Résumé du projet

**ScoreVault** est un prototype de recherche crypto autour des pronostics sportifs entre amis.

L'idée : créer une ligue privée type **Mon Petit Prono / Mon Petit Gazon**, mais avec une logique on-chain inspirée de **Polymarket** :

- chaque joueur rejoint une ligue privée ;
- chaque joueur dépose une mise fixe, par exemple 50 USDC ;
- les fonds sont lockés dans un smart contract ;
- avant chaque match, les joueurs soumettent un score prédit ;
- les résultats officiels sont récupérés par un oracle ;
- à la fin de la compétition, la cagnotte est redistribuée automatiquement selon la précision des pronostics.

Le projet doit être présenté comme un **prototype expérimental à but de recherche**, pas comme un produit public de jeu d'argent.

---

## 2. Positionnement

Phrase simple :

> ScoreVault est un prototype de prediction league on-chain : Polymarket x Mon Petit Prono, appliqué aux scores de football entre amis.

Angle sérieux :

> Comment concevoir une compétition prédictive on-chain, avec fonds lockés, scoring transparent, mécanisme anti-triche, oracle de résolution et redistribution algorithmique ?

À éviter :

- esthétique casino ;
- promesse de gain facile ;
- branding de pari sportif public ;
- ton meme coin ;
- incitation au gambling.

À privilégier :

- Ethereum-native ;
- research lab ;
- cryptographie ;
- oracle design ;
- game theory ;
- smart contracts ;
- social prediction games.

---

## 3. Références conceptuelles

### Mon Petit Prono / Mon Petit Gazon

Inspiration sociale : ligues privées entre amis, pronostics sur scores, classement, points selon la précision.

Mécaniques intéressantes à reprendre :

- score exact ;
- bon vainqueur ;
- rareté du score ;
- compétition longue sur tout un tournoi ;
- classement entre amis.

### Polymarket

Inspiration crypto : événements réels, résolution par oracle, transparence des règles, règlement après résultat.

Polymarket utilise notamment UMA Optimistic Oracle pour la résolution : quelqu'un propose un résultat, d'autres peuvent le contester, puis la résolution devient finale si elle n'est pas disputée.

### Ethereum / smart contracts

Inspiration technique :

- USDC ou token de testnet ;
- vault de ligue ;
- fonds lockés ;
- règles immuables ;
- calcul automatique ;
- redistribution transparente.

---

## 4. Mécanique utilisateur

### Création de ligue

Un utilisateur crée une ligue privée :

- nom de la ligue ;
- compétition suivie, par exemple Coupe du Monde ;
- montant d'entrée, par exemple 50 USDC ;
- nombre maximum de joueurs ;
- modèle de distribution ;
- date limite d'inscription.

### Entrée dans la ligue

Chaque joueur :

1. connecte son wallet ;
2. rejoint la ligue via un lien privé ;
3. dépose le montant fixe ;
4. reçoit une confirmation d'entrée ;
5. peut ensuite soumettre ses prédictions.

### Soumission des scores

Avant chaque match :

- le joueur prédit le score exact ;
- la prédiction doit être soumise avant le coup d'envoi ;
- une fois la deadline passée, plus aucune modification n'est possible.

Exemple :

```text
France 2 - 1 Brésil
Argentine 1 - 1 Espagne
Allemagne 0 - 2 Portugal
```

---

## 5. Anti-triche : commit-reveal

Problème : si les prédictions sont publiques avant le match, les joueurs peuvent copier les autres.

Solution : utiliser un système **commit-reveal**.

### Phase 1 — Commit

Avant le match, le joueur n'envoie pas directement son score. Il envoie un hash :

```text
hash = keccak256(matchId + homeScore + awayScore + secret)
```

Le smart contract stocke uniquement ce hash.

### Phase 2 — Reveal

Après la deadline, le joueur révèle :

```text
matchId
homeScore
awayScore
secret
```

Le contrat vérifie que :

```text
keccak256(matchId + homeScore + awayScore + secret) == hash stocké
```

Si ça correspond, la prédiction est acceptée.

Bénéfice :

- personne ne peut voir les pronostics avant la deadline ;
- personne ne peut modifier son score après coup ;
- tout reste vérifiable on-chain.

---

## 6. Scoring proposé

Pour chaque match, on compare le score prédit au score réel.

### Distance de score

Formule simple :

```text
distance = abs(predictedHome - actualHome) + abs(predictedAway - actualAway)
```

Exemple :

```text
Prédiction : France 2 - 1 Brésil
Résultat :   France 3 - 1 Brésil
Distance = |2 - 3| + |1 - 1| = 1
```

### Points par match

Proposition simple :

```text
Score exact : 100 points
Bon résultat + bon écart : 70 points
Bon résultat seulement : 40 points
Très proche mais mauvais résultat : 20 points
Très mauvais pronostic : 0 à 10 points
```

### Variante plus algorithmique

```text
baseScore = max(0, 100 - distance * 25)
```

Puis bonus :

```text
+30 si bon résultat : victoire / nul / défaite
+20 si bon écart de buts
+50 si score exact
```

Score final par match :

```text
matchScore = baseScore + outcomeBonus + goalDifferenceBonus + exactScoreBonus
```

---

## 7. Distribution de la cagnotte

### Modèle A — Classement simple

```text
1er : 40% de la cagnotte
2e : 25%
3e : 15%
Top 25% suivants : 20% répartis entre eux
Bottom 50% : perdent leur mise
```

Avantage : très lisible.

Inconvénient : assez brutal, très winner-takes-all.

### Modèle B — Distribution continue recommandée

Chaque joueur reçoit une part proportionnelle à son score au carré :

```text
payout_i = pool * score_i² / sum(score_j²)
```

Avantage :

- récompense fortement les meilleurs ;
- évite qu'un seul joueur prenne tout ;
- donne une logique plus mathématique et élégante ;
- rend le classement intéressant jusqu'à la fin.

### Modèle C — Top quartile

Autre idée :

```text
Top 25% : gagnants nets
Milieu 50% : récupèrent une partie de leur mise
Bottom 25% : perdent l'essentiel
```

Ce modèle est plus social, mais plus arbitraire.

---

## 8. Oracle / résolution des résultats

Le projet doit pouvoir fonctionner en trois niveaux.

### Niveau 1 — Prototype off-chain

Pour la première version :

- résultats stockés dans un fichier JSON ;
- admin qui clique sur “Resolve match” ;
- simulation sans vraie crypto.

### Niveau 2 — API sportive

Version plus avancée :

- récupération automatique des scores via une API sportive ;
- résultat transmis au backend ;
- backend pousse le résultat au smart contract.

### Niveau 3 — Optimistic oracle

Version recherche crypto :

- quelqu'un propose le résultat ;
- il existe une période de contestation ;
- si personne ne conteste, le résultat devient final ;
- si contestation, arbitrage par mécanisme type UMA.

---

## 9. Architecture technique cible

### Frontend

Stack recommandée :

```text
Next.js
TypeScript
Tailwind CSS
Framer Motion optionnel
wagmi / viem pour wallet Ethereum
```

Pages principales :

```text
/
/whitepaper
/app
/app/create-league
/app/league/[id]
/app/leaderboard
/app/matches
```

### Smart contracts

Modules à prévoir :

```text
LeagueFactory
LeagueVault
PredictionCommitment
ScoreEngine
OracleAdapter
PayoutDistributor
```

### Backend optionnel

Pour prototype Codex : pas besoin de backend réel.

Utiliser :

- mock data ;
- fichiers TypeScript ;
- simulations locales ;
- faux wallet state ;
- faux leaderboard.

---

## 10. MVP à coder dans Codex

Objectif : créer un site qui explique le projet et donne l'impression d'un vrai prototype crypto research.

### Livrable attendu

Un site Next.js avec :

1. landing page premium ;
2. explication du mécanisme ;
3. schéma du flow utilisateur ;
4. mock interface de ligue ;
5. mock leaderboard ;
6. mock carte de match ;
7. section architecture smart contract ;
8. section legal / research disclaimer ;
9. page whitepaper simplifiée.

### Le site doit contenir

#### Hero

Titre :

```text
The on-chain prediction league for football tournaments.
```

Sous-titre :

```text
ScoreVault is a crypto research prototype where private leagues submit encrypted score predictions, lock funds in a smart contract, and settle rewards transparently through oracle-based match resolution.
```

CTA :

```text
Read the mechanism
View prototype
```

#### Section “How it works”

Flow :

```text
Create League → Deposit USDC → Commit Prediction → Reveal Score → Oracle Resolution → Final Payout
```

#### Section “Scoring Engine”

Inclure l'exemple France 2-1 Brésil vs France 3-1 Brésil.

#### Section “Smart Contract Architecture”

Afficher les modules :

```text
LeagueFactory
LeagueVault
PredictionCommitment
ScoreEngine
OracleAdapter
PayoutDistributor
```

#### Section “Research Questions”

Questions :

```text
How should prediction accuracy be measured?
How should rewards be distributed fairly?
How can commit-reveal prevent copying?
How should disputed match results be handled?
Can private prediction leagues remain transparent without becoming gambling products?
```

#### Section disclaimer

Texte obligatoire :

```text
ScoreVault is a research prototype. It is not a public gambling product, not available for real-money use, and should be tested only on testnets or with non-transferable points unless proper legal approvals are obtained.
```

---

## 11. Prompt Codex complet

Copier-coller ce prompt dans Codex :

```text
Build a production-ready Next.js website for a crypto research project called “ScoreVault”.

ScoreVault is an experimental on-chain prediction league for football tournaments. It combines the social mechanics of private football prediction leagues with Ethereum smart contracts, commit-reveal predictions, oracle-based match resolution, and algorithmic prize distribution.

Important positioning:
- This is a research prototype.
- It is not a public gambling product.
- It should not look like a casino or betting website.
- It should look like an Ethereum-native research lab project.
- Tone: serious, premium, technical, exciting.

Tech stack:
- Next.js App Router
- TypeScript
- Tailwind CSS
- No backend required
- Use static mock data
- Make the site responsive
- Make components clean and reusable

Visual direction:
- Dark premium UI
- Subtle Ethereum-inspired blue/green gradients
- Glassmorphism cards
- Clean diagrams
- Minimal typography
- No meme coin aesthetic
- No casino aesthetic

Create these pages:

1. Landing page at /
2. Whitepaper-style explanation page at /whitepaper
3. Prototype dashboard at /app

Landing page sections:

1. Hero
Title: “The on-chain prediction league for football tournaments.”
Subtitle: “ScoreVault is a crypto research prototype where private leagues submit encrypted score predictions, lock funds in a smart contract, and settle rewards transparently through oracle-based match resolution.”
Buttons: “Read the mechanism” and “View prototype”

2. Problem
Explain that football prediction games are fun but centralized. Users have to trust the platform to store predictions, enforce deadlines, calculate scores, manage prize pools, and distribute rewards.

3. Mechanism
Show the flow:
Create League → Deposit USDC → Commit Prediction → Reveal Score → Oracle Resolution → Final Payout

4. Scoring Engine
Explain this example:
Predicted: France 2 - 1 Brazil
Actual: France 3 - 1 Brazil
Distance = |2 - 3| + |1 - 1| = 1

Then explain:
- Exact score receives maximum points
- Correct outcome receives a bonus
- Correct goal difference receives a bonus
- Close predictions receive partial points
- Long-term accuracy across the tournament matters more than luck

5. Reward Distribution
Show two models:

Model A: Ranked payout
1st: 40%
2nd: 25%
3rd: 15%
Remaining top quartile: 20%

Model B: Continuous payout
payout_i = pool * score_i² / sum(score_j²)
Explain that this rewards top performers while avoiding a pure winner-takes-all structure.

6. Oracle Design
Explain three versions:
- Manual resolution for prototype
- Sports API resolution for advanced demo
- Optimistic oracle resolution for research version

7. Smart Contract Architecture
Display modules:
- LeagueFactory
- LeagueVault
- PredictionCommitment
- ScoreEngine
- OracleAdapter
- PayoutDistributor

8. Research Questions
List:
- How should prediction accuracy be measured?
- How should rewards be distributed fairly?
- How can commit-reveal prevent copying?
- How should disputed match results be handled?
- Can private prediction leagues remain transparent without becoming gambling products?

9. Disclaimer
Include this exact text:
“ScoreVault is a research prototype. It is not a public gambling product, not available for real-money use, and should be tested only on testnets or with non-transferable points unless proper legal approvals are obtained.”

Prototype dashboard at /app:
Create a mock app UI with:
- connected wallet card
- league card
- total pool: 1,250 USDC
- players: 25
- next match prediction card
- input boxes for home score and away score
- commit prediction button
- leaderboard table
- mock match resolution status

Mock leaderboard:
1. Vianney — 1,840 pts — projected payout 310 USDC
2. Jules — 1,720 pts — projected payout 270 USDC
3. Chloé — 1,610 pts — projected payout 220 USDC
4. Alex — 1,420 pts — projected payout 160 USDC
5. Paul — 1,210 pts — projected payout 90 USDC

Whitepaper page:
Create a structured explanation with these headings:
- Abstract
- Motivation
- User Flow
- Commit-Reveal Scheme
- Scoring Function
- Payout Function
- Oracle Resolution
- Legal and Research Limitations
- Future Work

Also create reusable components:
- HeroSection
- FlowDiagram
- ScoringCard
- ArchitectureGrid
- Leaderboard
- MatchPredictionCard
- DisclaimerCard

Add polished microcopy and realistic mock data. Make sure the design feels premium and credible.
```

---

## 12. Prompt optionnel pour demander aussi les smart contracts

À lancer après le site si tu veux aller plus loin :

```text
Now add a Solidity smart contract prototype for ScoreVault.

Create contracts for:
- LeagueFactory
- LeagueVault
- PredictionCommitment
- ScoreEngine
- PayoutDistributor

Requirements:
- Use Solidity ^0.8.24
- Use USDC-like ERC20 interface
- Allow a creator to create a league
- Allow players to join by depositing a fixed entry fee
- Store prediction commitments as bytes32 hashes
- Allow reveal of predictions after deadline
- Store official match results through an admin-only mock oracle function
- Calculate scores using distance, outcome bonus, goal difference bonus and exact score bonus
- Calculate projected payout using score squared proportional distribution
- Include comments explaining every function
- This is for research only, not production
- Add tests with mock users and mock match results
```

---

## 13. Notes légales à garder dans le dossier

Le projet doit rester formulé comme :

```text
Research prototype
Testnet only
Non-transferable points possible
No public real-money deployment
No consumer-facing betting product
No gambling marketing
```

Formulation recommandée :

> This project explores the technical design space of on-chain prediction competitions. Any real-money deployment would require a full legal review and appropriate regulatory approvals.

---

## 14. Sources utiles

- Polymarket — Resolution docs: https://docs.polymarket.com/concepts/resolution
- UMA — Optimistic Oracle: https://uma.xyz/
- ANJ — opérateurs agréés en France: https://anj.fr/offre-de-jeu-et-marche/operateurs-agrees
- Économie.gouv — contrôle des jeux et paris en ligne: https://www.economie.gouv.fr/particuliers/mes-droits-conso/eviter-les-arnaques/comment-sont-controles-les-jeux-et-paris-en-ligne
- MPP Mondial — exemple de règles de scoring: https://ligue1.com/fr/articles/l1_article_5224-mpp-mondial-tout-savoir-sur-les-regles-26

---

## 15. Version ultra-courte du pitch

> ScoreVault is a crypto research prototype for private football prediction leagues. Players lock funds in a smart contract, submit encrypted score predictions, and receive algorithmic payouts based on their accuracy after oracle-based match resolution. The project explores commit-reveal systems, oracle design, scoring functions, and fair reward distribution in social prediction games.
