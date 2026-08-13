# PaneShift — audit V2 après refonte du moteur CHAT

Date : 31 juillet 2026  
Commit audité : `5a497ee` — `Rebuild CHAT on provider transcripts instead of screen scraping`  
Périmètre : application AppKit, `PaneShiftCore`, transport tmux, six sessions locales, diagnostics, tests, documentation et état Git.  
Nature de l'audit : lecture du code, tests automatisés, sondes headless contre les vraies sessions, inspection tmux et probes Swift ciblées. Aucun correctif applicatif n'a été appliqué.

## Verdict

La refonte est une vraie amélioration. Le CHAT ne dépend plus de l'écran dessiné par les TUI : il lit maintenant les journaux structurés de Claude, Codex et Grok, possède une machine à états explicite et sait représenter un envoi, une exécution, un blocage, un échec, une annulation et une fin de tour. Le bug historique du deuxième message est corrigé sur les sessions Codex et Grok testées.

L'application n'est toutefois pas encore fiable pour un usage quotidien sans surveillance. Trois défauts critiques subsistent :

1. les six pollers peuvent modifier simultanément un même moteur non synchronisé ; ThreadSanitizer confirme des courses de données et une duplication réelle de l'historique ;
2. lorsqu'un CLI quitte et rend la main à `zsh`, PaneShift peut envoyer le prompt dans le shell et l'exécuter comme une commande ;
3. lorsqu'un pane disparaît, la fenêtre native conserve sa topologie initiale et ne réconcilie pas la room : la room live est passée de six à cinq agents pendant l'audit.

Conclusion : l'architecture générale est désormais la bonne, mais il faut un passage de durcissement P0 centré sur la concurrence, l'identité de session et la santé réelle des processus avant de reprendre le polish UI.

## Ce qui a effectivement été corrigé depuis le premier audit

| Ancien défaut | État V2 |
|---|---|
| Parsing du rendu visuel `capture-pane` pour fabriquer CHAT | Corrigé : adaptateurs JSONL par fournisseur |
| Absence de machine à états | Corrigé : `submitting`, `running`, `completed`, `blocked`, `failed`, `cancelled` |
| Spinner infini sans accusé de réception | Largement corrigé : timeout de soumission à 12 s et erreur retryable |
| Réponse tronquée après une pause arbitraire de 1,5 s | Corrigé : fin de tour issue du transcript fournisseur |
| Buffer tmux global | Corrigé : buffer nommé, unique et supprimé après collage |
| Appels tmux de soumission sur le thread principal | Corrigé pour le chemin principal : tâche détachée |
| Historique vide après relance | Corrigé : reconstruction depuis le transcript |
| Aucun test Swift | Corrigé : cible `PaneShiftCoreTests`, 20 tests exécutés avec succès |
| Modèle choisi non transmis au routeur | Corrigé et couvert par le test shell |
| DropHover local configuré implicitement vers OVH | Corrigé dans la version actuelle |
| Deuxième prompt invisible ou bloqué | Corrigé sur CODEX-1, GROK-1 et GROK-2 pendant l'audit live |

## Méthode et résultats de test

### Validation automatisée

- `swift test --parallel` : 20 tests Swift listés et exécutés, tous passés.
- `bash tests/agent_room.test.sh` : passé.
- `swift build -Xswiftc -warnings-as-errors` : passé.
- `bash -n` sur les scripts principaux : passé.
- `git diff --check` : passé.
- `./paneshift-local --check` : passé au début de l'audit, puis a échoué après la disparition de CODEX-2 avec `expected 6 panes ... found 5`.

La suite actuelle est utile, mais reste déterministe et mono-thread. Elle ne couvre ni `TranscriptSession`, ni AppKit, ni les changements de fichier de session, ni les pannes tmux/process, ni la concurrence réelle des pollers.

### Matrice live

| Agent | Test réalisé | Résultat |
|---|---|---|
| CODEX-1 | Deux prompts successifs, réponse exacte attendue | Passé deux fois ; états `submitting → running → completed` |
| GROK-1 | Deux prompts successifs, réponse exacte attendue | Passé deux fois |
| GROK-2 | Prompt multiligne | Passé |
| GROK-2 | Commande longue puis annulation par `Escape` | État local `cancelled`, input libéré |
| CLAUDE-1 | Session bloquée par quota | Historique correctement affiché `blocked`, mais une nouvelle soumission est encore autorisée puis finit `failed` |
| CLAUDE-2 | Même quota et menu interactif | Même résultat |
| CODEX-2 | CLI déjà revenu à `zsh` | Le prompt a été interprété par le shell, puis a expiré côté CHAT |
| CODEX-2 | Après disparition du pane | La sonde refuse proprement : `agent 4 not found`; l'app déjà ouverte conserve néanmoins son ancien `PaneView` |

### Consommation observée

- Application native : environ 54 à 112 Mo RSS selon l'outil de mesure, 8 threads.
- CPU au repos : généralement 0 %, avec des pointes observées jusqu'à environ 2,2 % au tick de refresh.
- Une sonde transcript isolée : environ 0,16 s, 14 Mo RSS maximum.
- Cinq CLI encore vivants au moment de la mesure : environ 541 Mo RSS cumulés, hors app et tmux.
- Aucun `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `GROK_API_KEY`, `AWS_SECRET_ACCESS_KEY` ou `AZURE_OPENAI_API_KEY` n'a été trouvé dans l'environnement des cinq processus fournisseurs inspectés. Le fonctionnement observé reste donc conforme au mode abonnement CLI demandé.

L'application elle-même n'est pas lourde. Le coût principal vient logiquement des cinq ou six CLI abonnements conservés en mémoire.

## Défauts critiques

### C1 — Courses de données dans le polling des transcripts

`PaneView.pollTranscript()` lance une nouvelle `Task.detached` à chaque refresh sans drapeau `inFlight`. `refreshPaneOutputs()` l'appelle pour tous les panes environ toutes les 1,2 s. Les objets partagés `TranscriptSession` et `TranscriptTailer` sont déclarés `@unchecked Sendable`, tandis que `ConversationEngine` est une classe mutable sans acteur, verrou ou file série.

Une probe ThreadSanitizer a lancé 12 pollers concurrents sur une même session, 20 lectures chacun. Résultat :

- 29 alertes `ThreadSanitizer: data race` ;
- accès concurrents confirmés dans `TranscriptTailer.reset()`, `TranscriptTailer.poll(_:)`, `TranscriptSession.poll(...)` et `ConversationEngine.updateHealth()` ;
- processus terminé avec le code 134 sous TSan ;
- 78 tours reconstruits alors que l'historique réel est très inférieur, preuve que le défaut ne se limite pas à une alerte théorique.

Impact possible : réponses dupliquées, historique corrompu, offset de fichier perdu, états qui régressent, crash intermittent, spinner ou input incohérent.

Correctif P0 : faire de `TranscriptSession` un `actor`, ou imposer une file série propre à chaque pane ; supprimer `@unchecked Sendable` ; ajouter un `pollInFlight` par session ; ne publier vers AppKit qu'un snapshot immuable et `Sendable`.

### C2 — Un prompt CHAT peut devenir une commande shell

Pendant l'audit, le pane CODEX-2 était encore vivant au sens tmux (`pane_dead=0`) mais son processus courant était `zsh`, le CLI Codex ayant quitté. La métadonnée du pane disait toujours `OPENAI`. PaneShift a collé le prompt dans ce shell ; `zsh` a répondu `command not found` pour les phrases de test.

Le transport vérifie seulement que tmux accepte `load-buffer`, `paste-buffer` et `Enter`. Il ne vérifie ni le processus de premier plan ni l'identité du CLI. Une phrase ressemblant à une commande valide pourrait donc être exécutée dans le worktree avec les droits de l'utilisateur.

Impact : mauvais comportement systématique après un exit provider et risque d'exécution locale involontaire.

Correctif P0 : avant chaque soumission, vérifier le process foreground et sa descendance (`codex`, `claude`, `grok`) ; refuser tout envoi vers un shell ; invalider la santé du pane ; proposer `RESTART AGENT`. La vérification doit être faite dans la même opération logique que l'envoi pour limiter la course TOCTOU.

### C3 — La topologie native ne suit pas la topologie tmux

Après l'échec de CODEX-2, son pane `%3` a disparu. La room ne contenait plus que cinq agents et le pane de contrôle. Les preuves concordent :

- `paneshift-local --check` : exit 1, cinq panes trouvés au lieu de six ;
- `agent-room.sh status` : `CODEX-2 — missing — pane not found` ;
- `--transcript-probe` : agents 1, 2, 3, 5 et 6 uniquement ;
- `--send-probe --agent 4` : erreur immédiate et propre.

La fenêtre AppKit construit pourtant `paneViews` une seule fois au lancement. `refreshPaneMetadata()` met à jour les identifiants qu'il retrouve, mais ne supprime pas les panes disparus et ne crée pas les nouveaux. Une app déjà ouverte peut donc continuer d'afficher et de cibler un `PaneView` mort.

Correctif P0 : réconcilier périodiquement la collection native avec la liste tmux par index logique d'agent ; afficher un état `missing`; empêcher toute soumission ; permettre un respawn ; reconstruire proprement la vue lorsque l'identifiant tmux change.

## Défauts élevés

### H1 — Une rotation de session du même fournisseur mélange les historiques

`TranscriptSession.refreshLocationIfNeeded()` détecte un nouveau fichier primaire et remet les tailers à zéro, mais n'appelle pas `engine.clear()`. `PaneView.updateMetadata()` ne fait un `rebind` que si le fournisseur ou le worktree change.

Un `/clear`, restart ou respawn Codex→Codex peut donc charger la nouvelle session à la suite de l'ancienne et conserver un état actif de la session précédente.

Correctif : traiter l'identifiant du transcript comme une identité de session ; sur rotation, terminer explicitement l'ancien tour, vider ou archiver l'ancien moteur, puis publier le nouveau snapshot.

### H2 — Grok perd l'ordre chronologique entre messages et fins de tour

Grok écrit les messages dans `chat_history.jsonl` et les frontières dans `events.jsonl`. `TranscriptSession` parse d'abord tous les messages du fichier primaire, puis ajoute tous les événements du companion. Les timestamps ne sont pas fusionnés.

Probe reproductible avec deux tours, le premier terminé et le second annulé :

```text
first: cancelled
second: completed
```

Les outcomes sont appliqués aux mauvais tours. Correctif : donner un timestamp ou un numéro monotone à chaque `TranscriptEvent`, fusionner et trier les deux flux avant ingestion ; ajouter une fixture avec au moins deux tours et deux outcomes différents.

### H3 — Un fournisseur `blocked` accepte encore de nouvelles soumissions

L'en-tête sait afficher `ProviderHealth.blocked`, mais `submit()` vérifie seulement l'absence de tour actif. Les deux Claude bloqués par leur limite mensuelle ont accepté un nouveau prompt dans leur menu `/rate-limit-options`, puis ont fini en `failed` après le timeout au lieu de rester `blocked`.

Correctif : rendre le champ non éditable lorsque `health == blocked`; afficher l'action utile (`OPEN TERM`, `RESTART`, `RESOLVE LIMIT`) ; ne jamais envoyer un prompt de conversation dans un menu interactif.

### H4 — La détection de blocage produit des faux positifs sur le contenu normal

`blockReason(in:)` cherche des fragments très larges dans toute réponse, notamment `rate limit`. Une réponse normale contenant :

```text
A rate limit controls request volume.
```

a été classée `blocked(reason: "rate limited")`.

Correctif : s'appuyer sur les événements/erreurs structurés du fournisseur ; à défaut, utiliser des signatures ancrées et spécifiques aux écrans d'erreur, jamais des mots quelconques dans une réponse métier.

### H5 — Les rappels injectés multilignes ne sont pas retirés

`PromptText.stripReminders()` utilise `<tag>.*?</tag>` sans option permettant à `.` de traverser les retours à la ligne. La fixture existante ne teste qu'une seule ligne. Probe reproduite :

```text
<system-reminder>line one
line two</system-reminder>real prompt
```

Le bloc complet reste visible. Cela peut exposer du contexte injecté dans CHAT et empêcher l'accusé de réception de correspondre au prompt envoyé.

Correctif : parser les blocs XML-like, ou utiliser une regex `(?s)` bornée ; ajouter tous les tags actuels en fixtures mono et multilignes.

### H6 — Un caractère UTF-8 coupé entre deux polls peut être perdu définitivement

`TranscriptTailer.poll()` convertit chaque nouveau bloc `Data` séparément. Si la lecture s'arrête au milieu d'un scalaire UTF-8, `String(data:, encoding: .utf8)` renvoie `nil`; le code remplace alors le bloc par une chaîne vide tout en avançant l'offset jusqu'à la fin du fichier. Les octets ne seront jamais relus.

Impact : une ligne JSON contenant un emoji ou un caractère accentué peut être supprimée ou rendue invalide selon le timing d'écriture.

Correctif : conserver un carry binaire (`Data`), ne décoder que les lignes complètes, et n'avancer l'offset logique qu'après préservation de tous les octets.

### H7 — Le journal de diagnostic ne décrit pas le cycle réel des tours

La documentation et le commentaire du composant annoncent des transitions, codes tmux et durées. Le code n'enregistre que quelques actions UI : `pane.rebind`, `turn.submitting`, l'échec tmux immédiat, `turn.cancelled` et `turn.retry`.

Après plusieurs tours live terminés pendant l'audit, `~/.local/state/paneshift/paneshift.jsonl` ne contenait que deux lignes `turn.submitting`. Aucun `running`, `completed`, `blocked`, timeout, code de retour ou durée.

Correctif : journaliser chaque transition au niveau du moteur, avec `pane`, `provider`, `session_id`, `turn_id`, état précédent/suivant, durée, cause et code tmux — toujours sans contenu de prompt/réponse.

### H8 — CHAT montre encore des commentaires intermédiaires non productifs

Les adaptateurs ajoutent toutes les entrées assistant. La fixture Claude attend explicitement `Je vérifie.` puis `Quatre.`. Un tour Grok live a affiché un message de progression du type `Checking project context…` avant la réponse finale.

Cela contredit le besoin produit : loader pendant le travail, puis seulement le résultat utile. Correctif : distinguer `progress`, `tool`, `analysis` et `final`; garder la progression dans un indicateur compact ou un panneau de détail optionnel, et n'afficher par défaut que la réponse finale.

### H9 — STOP annule localement même si le fournisseur continue

`interrupt()` envoie toujours `Escape`, quel que soit le fournisseur, puis `cancelActiveTurn()` ferme immédiatement le tour local sans confirmation. Cela a fonctionné pour Grok pendant le test, mais les TUI peuvent demander `Ctrl+C` ou changer de raccourci.

Si l'interruption est ignorée, la réponse tardive devient orpheline ou peut se rattacher au tour suivant. Correctif : stratégie d'interruption par provider, attente d'un outcome `aborted` ou d'un état idle confirmé, puis timeout explicite.

### H10 — Le signal `terminalIsBusy` est obsolète pour les agents masqués

Seul le terminal actif reçoit un `capture-pane` régulier. Les transcripts des six agents sont pollés, mais le timeout de réponse reçoit `terminalIsBusy(lastRaw)` où `lastRaw` peut être ancien ou vide pour un agent masqué.

Le timeout actuel de 900 s limite la fréquence du problème, mais la décision reste fondée sur un écran obsolète. La santé doit venir du transcript/process, pas du dernier rendu de la vue active.

## Défauts moyens et dette technique

### M1 — Les polls peuvent s'empiler plus vite qu'ils ne finissent

Il existe un garde `paneRefreshInFlight` pour la capture du terminal actif, mais aucun équivalent pour chaque transcript. Une localisation Codex lente ou un gros historique suffit à empiler des tâches détachées. C'est le déclencheur direct de C1.

### M2 — Le locator Codex ne considère que les 40 sessions les plus récentes

83 rollouts Codex existaient pendant l'audit. Le locator trie tous les fichiers, puis n'inspecte le `cwd` que sur les 40 plus récents. Une session longue peut devenir introuvable si plus de 40 autres rollouts sont créés après elle.

Correctif : mémoriser l'identité dès le lancement, lier via PID/fichier ouvert, ou indexer toutes les métadonnées avec un cache invalidé proprement.

### M3 — Le changement d'attachement peut ne pas rafraîchir l'en-tête

`TranscriptSession.poll()` retourne `true` uniquement si `engine.turns` change. Trouver ou perdre un transcript sans changement de tours ne déclenche pas nécessairement `syncChatState()`. Le texte `no session yet` peut donc rester affiché après attachement, ou l'inverse.

### M4 — La signature de rendu est trop faible

Le cache UI utilise seulement `turn.id`, le nom d'état et `response.count`. Une réponse remplacée par une autre de même longueur, ou une correction de prompt, ne provoque pas de rendu.

Correctif : snapshot versionné par le moteur ou hash stable de tous les champs visibles.

### M5 — Le champ est vidé avant la vérification d'un tour actif

`submit()` fait `input.string = ""` avant `guard session.engine.activeTurn == nil`. L'UI rend normalement le champ non éditable pendant un tour, mais un double événement ou un appel programmatique peut faire perdre le texte sans envoi.

### M6 — Les délais de transport restent fixes

Le transport attend 60 ms après un éventuel `Ctrl+C`, puis 120 ms après le paste avant `Enter`. L'accusé transcript rend désormais l'échec visible, mais pas impossible. Un envoi raté coûte encore 12 secondes et demande un retry manuel.

### M7 — Le compteur de retry du moteur n'est pas utilisé

`PendingSubmission.retries` existe mais aucune logique ne l'incrémente ou ne l'exploite. Soit implémenter des retries bornés et idempotents, soit supprimer ce faux contrat.

### M8 — Le chargement initial lit l'intégralité du transcript

Au premier attachement, le tailer part de l'offset zéro, parse tout, puis garde 200 tours. Sur des sessions de plusieurs dizaines ou centaines de Mo, le travail est effectué hors main thread mais peut consommer fortement CPU/mémoire et aggraver l'empilement des polls.

Correctif : retrouver une fenêtre de lignes/tours récents sans casser les objets JSONL, ou persister un index local.

### M9 — Le scan Codex complet est répété toutes les cinq secondes par pane

Chaque session Codex énumère et trie l'arbre `~/.codex/sessions`. Avec deux agents Codex, le travail est dupliqué ; avec les courses actuelles, plusieurs scans peuvent se superposer. Centraliser le locator et mettre en cache la liste par mtime de répertoire.

### M10 — Les diagnostics ont une durabilité et des permissions faibles

Les écritures sont asynchrones sans flush de terminaison, donc les derniers événements peuvent disparaître à la fermeture. Le fichier observé était en mode `0644`, lisible par d'autres comptes locaux. Même sans contenu conversationnel, mieux vaut `0600`.

### M11 — L'indicateur `live` de la sidebar ne signifie pas `ready`

La sidebar se fonde surtout sur la fraîcheur mémoire. Elle pouvait présenter les agents comme live alors que Claude était bloqué et CODEX-2 dans un shell ou absent. Afficher séparément `process`, `provider`, `conversation` et `memory`.

### M12 — La documentation mélange encore plusieurs générations du produit

Le README décrit par endroits une mosaïque 2×2, quatre handoffs et des interactions historiques, tout en documentant plus bas la nouvelle app à six panneaux. `ARCHITECTURE.md` est encore un placeholder d'une phrase.

### M13 — L'état Git n'est pas proprement reproductible

Le cœur de la refonte est maintenant commit, ce qui est un progrès majeur. Mais les launchers/configurations nécessaires à la room locale (`paneshift-local`, `agent-room.local.conf`, `AGENTS.md`, etc.) restent non suivis, tandis que deux exemples suivis sont supprimés. Une clone propre ne reproduit pas exactement la room auditée.

## Lacunes de tests

Les 20 tests actuels couvrent correctement la machine à états et les adaptateurs sur des cas simples. Il manque au minimum :

1. un test ThreadSanitizer ou Swift concurrency sur `TranscriptSession` ;
2. une garantie qu'un seul poll est actif par session ;
3. une rotation de fichier du même provider ;
4. deux tours Grok avec fusion chronologique de `chat_history` et `events` ;
5. un split au milieu d'un scalaire UTF-8 ;
6. un `system-reminder` multiligne ;
7. une réponse normale qui parle de `rate limit` sans bloquer le provider ;
8. un provider qui quitte vers le shell ;
9. un pane qui disparaît puis réapparaît avec un nouvel identifiant ;
10. une tentative de submit sur un provider bloqué ;
11. STOP ignoré, STOP confirmé et réponse tardive après STOP ;
12. une session énorme et le budget mémoire/temps correspondant ;
13. un test AppKit de deux soumissions, focus, loader, scroll et copie ;
14. un test du journal : toutes les transitions, ordre, durées et permissions.

## Plan de correction recommandé

### P0 — Fiabilité et sécurité

1. Sérialiser chaque `TranscriptSession` dans un actor et interdire deux polls simultanés.
2. Ajouter une vérification de process fournisseur avant envoi ; bloquer tout shell inattendu.
3. Réconcilier dynamiquement les panes natifs avec tmux, avec états `missing` et `restarting`.
4. Fusionner chronologiquement les deux journaux Grok.
5. Désactiver l'input pour `blocked`, `missing`, `shell` et menus interactifs.

Critère de sortie P0 : zéro race sous TSan, aucun prompt envoyé à un shell, deux tours successifs sur chaque provider disponible, disparition/respawn d'un pane sans relancer l'app.

### P1 — Exactitude des données

1. Donner une vraie identité aux sessions et vider le moteur lors d'une rotation.
2. Corriger le tailer UTF-8 et les rappels multilignes.
3. Remplacer les regex de quota par des signaux structurés.
4. Confirmer réellement l'interruption provider.
5. Journaliser toutes les transitions et rendre le fichier privé.
6. Étendre la suite avec toutes les fixtures ci-dessus.

### P2 — Produit et minimalisme

1. Afficher par défaut uniquement la réponse finale productive.
2. Mettre les pensées, outils et progression derrière un détail optionnel.
3. Uniformiser `loading`, `blocked`, `failed`, `missing` et `retry` sans faire sauter la mise en page.
4. Mettre README et architecture au niveau du produit actuel.
5. Versionner une configuration exemple reproductible sans secrets et fournir un bundle d'app stable.

## Priorité produit

Ne pas refaire le design maintenant. La bonne séquence est :

```text
actor par session
→ garde process/provider
→ réconciliation tmux
→ ordre Grok + identité de session
→ tests de panne
→ réponses finales seulement
→ polish UI
```

La refonte a supprimé la faiblesse architecturale la plus grave du premier audit — le screen scraping comme protocole. Le prochain gain ne viendra pas d'un nouveau redesign, mais de rendre ce moteur transcript séquentiel, conscient du vrai process et résilient aux changements de session.

