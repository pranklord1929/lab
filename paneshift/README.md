# PaneShift

Un lanceur autonome construit une mosaïque tmux configurable — 3×2 et six agents
dans la room locale — avec des
labels persistants et un menu de contrôle.
Le thème actif est le rendu clair d'origine ; une palette alternative peut être
sélectionnée plus tard dans le fichier de configuration.

## Vision produit

PaneShift est une console locale minimaliste pour les personnes qui pilotent
de gros projets avec plusieurs agents de code. Les cases représentent des rôles
durables ; Anthropic, OpenAI, Grok ou un fournisseur local sont interchangeables.

Le modèle n'est pas un contrôle de la Control Room. Chaque fournisseur gère son
runtime et son modèle ; le panneau ne sert qu'à router un rôle vers un
fournisseur. Cela permet de comparer les fournisseurs sans reconfigurer chaque
conversation.

La première version vise trois principes :

- utiliser les CLI déjà authentifiés localement, sans imposer une facturation
  API supplémentaire ;
- rendre les actions ordinaires visibles et cliquables ;
- conserver le code, Git et les handoffs comme sources de vérité, afin qu'un
  changement de fournisseur ne casse pas le projet.

L'architecture reste volontairement séparée en quatre couches : configuration
de l'équipe, état de coordination, adaptateurs fournisseurs et interface tmux.
Cette séparation permettra de remplacer un jour tmux par une application plus
grand public sans modifier la définition des équipes.

## Lancer une Control Room

PaneShift reçoit la configuration du projet explicitement :

```bash
./paneshift --config /chemin/du/projet/agent-room.conf
```

Si la session existe, elle est simplement rejointe. Sinon tous les agents
définis dans la configuration sont lancés. Le raccourci direct `Ctrl+/` ouvre
la palette globale depuis n'importe quel volet (`Ctrl-b`, puis `g`, reste un
secours).

## Deux versions : locale et OVH

Le GUI se lance dans l'un de deux modes **explicites**, jamais devinés d'après
la présence d'un fichier :

```bash
./paneshift-local            # tout sur ce Mac, aucun serveur, aucune clé API
./paneshift-ovh              # réveille l'instance OVHcloud et s'y branche en SSH
```

- **`paneshift-local`** monte la room localement à partir de
  `agent-room.local.conf` (deux Codex, deux Claude et deux Grok),
  ignore complètement `~/.config/paneshift/server.conf`, et ancre la fenêtre sur
  la moitié droite de l'écran (`PANESHIFT_DOCK_RIGHT=0` pour désactiver). En
  room locale, une image déposée n'est jamais envoyée sur le réseau : seul son
  chemin local est inséré dans le pane visé.
- **`paneshift-ovh`** lit `~/.config/paneshift/server.conf`, réveille le serveur
  si besoin, monte la room à distance et branche le GUI en SSH.

Le travail se fait **uniquement sur la version locale**. La version OVH n'est pas
touchée au quotidien : le jour du ship, on lui applique les changements validés
en local. Rien à supprimer entre les deux — `server.conf` reste prêt pour OVH.

### Suivre les changements en direct

Ajouter `--watch` recompile et relance le GUI à chaque modification des sources
Swift, pour voir chaque changement s'afficher tout seul à droite de l'écran :

```bash
./paneshift-local --watch
```

## Configurer un projet

Copier uniquement le modèle de configuration dans le nouveau projet :

```text
agent-room.example.conf → agent-room.conf
```

Adapter dans `agent-room.conf` le nom, le rôle, le dossier et les commandes
`ANTHROPIC_COMMAND` / `OPENAI_COMMAND` / `GROK_COMMAND` de chaque agent. Puis lancer :

```bash
./paneshift --config /chemin/du/projet/agent-room.conf
```

Avec `ROOM_SUBSCRIPTION_ONLY=1`, PaneShift retire explicitement les variables de
clés API OpenAI, Anthropic et xAI avant chaque lancement. Codex utilise alors la
connexion ChatGPT, Claude la connexion claude.ai et Grok la connexion grok.com.

Le moteur n'impose pas de modèle : chaque commande fournisseur peut être
remplacée par une commande compatible. Le fichier de configuration ne doit pas
contenir de mot de passe ni de clé API.

## Router un rôle vers un fournisseur

Les cases représentent des rôles, pas des modèles. Cliquer sur un rôle dans le
panneau droit ouvre le choix de fournisseur. Anthropic, OpenAI et Grok sont
affichés comme providers ; Claude Code, Codex et Grok Build sont leurs runtimes.

```bash
./paneshift --config /chemin/du/projet/agent-room.conf switch 1 openai
./paneshift --config /chemin/du/projet/agent-room.conf switch 3 anthropic
```

Le choix est sauvegardé localement par projet et par Control Room : une nouvelle
session redémarre donc avec le dernier routing choisi. Une bascule n'est jamais
autorisée pendant qu'un agent travaille. Une fois l'agent inactif, la confirmation
dit explicitement qu'une **nouvelle session** du provider remplacera le chat
actuel.

## Interface souris

Aucune commande n'est nécessaire dans l'usage normal :

- cliquer sur `◆ CONTROL ROOM` en bas à gauche ouvre le menu général ;
- faire un clic droit dans un agent ouvre son menu local ;
- un clic sur un rôle ouvre directement son choix de provider ;
- un changement ouvre une confirmation claire avant de démarrer un nouveau chat ;
- zoom, copie et collage sont disponibles dans le même menu.
- les séparateurs centraux se déplacent directement par cliquer-glisser : la
  barre verticale ajuste la largeur et la barre horizontale ajuste la hauteur ;
- les deux moitiés de la barre verticale se resynchronisent au relâchement pour
  rester un seul axe continu ;
- « Réinitialiser les tailles » restaure instantanément la mosaïque 2×2 égale.
- Sur macOS, lors d’un glisser depuis Finder, une flèche cyan fine apparaît
  automatiquement dans le volet qui est réellement survolé. Il suffit de
  relâcher : aucun choix de destination ni texte intermédiaire.

Les projets peuvent fournir leur propre raccourci, comme `bbctl`, uniquement
comme adaptateur et pour l'automatisation.

Un panneau de contrôle permanent occupe le bord droit de la mosaïque et affiche :

- un bouton coloré par rôle avec son provider actif (`ANTHROPIC` ou `OPENAI`) ;
  cliquer dessus ouvre le sélecteur de provider et de modèle de ce terminal ;
- les modèles proposés viennent uniquement de `AGENT_N_ANTHROPIC_MODELS` et
  `AGENT_N_OPENAI_MODELS` dans la configuration. Un choix est persistant mais
  démarre toujours un nouveau chat, après confirmation, et reste bloqué si
  l'agent travaille ;
- `RÉINITIALISER LES TAILLES` pour restaurer le carré 2×2 ;
- la durée de la room en cours, le record des rooms déjà observées, le nombre
  de rooms et une série de jours actifs ;
- une grille verticale de sessions de code sur douze semaines, compacte comme
  celle de GitHub et placée sous `RESET LAYOUT` ; son intensité combine présence
  de session et volume de tokens lu depuis les journaux locaux des runtimes ;
- l'usage CPU et RAM du serveur, ainsi que l'usage GPU lorsqu'un pilote le rend
  disponible ;
- la dépense OVHcloud Public Cloud déjà consommée sur le mois et la prévision
  de facture, actualisées au plus une fois par heure via les routes officielles
  `usage/current` et `usage/forecast` ;
- un indicateur de progression de session (`MOMENTUM STARTING`, `MOMENTUM
  BUILDING`, `DEEP WORK IN FLOW`, puis `COMPOUNDING CONTEXT`) avec le temps et
  le nombre d’agents synchronisés ;
- un indicateur passif de destination au survol pour les captures sur macOS ;
- un raccourci de remise à zéro de la mosaïque.

Le panneau est un cinquième volet tmux étroit, réservé à l'interface : il ne
lance aucun agent et ne compte pas comme une session de travail.

Le panneau ne lit jamais les quotas en envoyant des commandes dans les chats :
cette technique pouvait interrompre une saisie et dépendait de textes d'interface
instables. Pour Codex, PaneShift lit le fichier JSONL actuellement ouvert par le
processus ; pour Claude, il récupère le journal attribué au slot. Les tokens sont
des tokens traités, cache inclus, et non un coût. Les quotas et prix restent donc
volontairement séparés tant qu'un export officiel n'est pas configuré.

La ligne OVH est également séparée des tokens : OVH facture les ressources
allouées au serveur, pas son pourcentage CPU instantané. Pour l'activer, définir
`OVH_CLOUD_PROJECT`, `OVH_APPLICATION_KEY`, `OVH_APPLICATION_SECRET` et
`OVH_CONSUMER_KEY` dans l'environnement qui lance PaneShift. Le jeton OVH doit
être en lecture seule et limité à `GET /cloud/project/<project>/usage/current`
et `GET /cloud/project/<project>/usage/forecast`. Les secrets ne doivent jamais
être placés dans `agent-room.conf`. Sans ces variables, la sidebar affiche
explicitement `OVH à configurer`.

Le slot principal peut aussi envelopper son TUI avec `tui-color-filter.py`. La
configuration actuelle remplace uniquement le fond brique du composer Codex en
cours de travail (`#893F39`) par un lavande pastel (`#EEE7FF`), sans modifier
les couleurs des trois autres agents.

## Fournisseur local ou open source

Chaque slot possède aussi un champ optionnel `AGENT_N_LOCAL_COMMAND`. Tant qu'il
est vide, aucun bouton supplémentaire n'encombre l'interface. Lorsqu'une
commande compatible est renseignée — par exemple un agent utilisant Ollama — le
bouton « Utiliser un moteur local… » apparaît automatiquement dans le menu du
terminal concerné.

## Copier-coller et captures

- Une sélection de texte à la souris est immédiatement copiée dans le
  presse-papiers système ; sur macOS, `⌘V` fonctionne donc sans étape
  supplémentaire.
- `Ctrl+V` colle directement dans le volet actif ; `Ctrl-b`, puis `v`, reste
  le secours tmux.
- Sans sélection active, `Ctrl+C` conserve son rôle normal d'interruption.
- Pour envoyer une capture dans un autre chat, il suffit de la faire glisser
  sur le volet voulu : une ligne et une flèche cyan fines le signalent pendant
  le survol, sans bloquer les clics ni intercepter le fichier. PaneShift laisse
  Finder déposer directement dans le terminal ; le runtime reçoit donc l’image
  ou son chemin selon sa prise en charge.

Le petit compagnon macOS `paneshift-hover` est compilé localement au premier
lancement, dans le cache utilisateur. Il ne lit ni ne copie les fichiers et ne
collecte aucune donnée ; `ROOM_DROP_HOVER=0` le désactive si besoin.

Le presse-papiers utilise `pbcopy`/`pbpaste` sur macOS, `wl-copy` sous Wayland
ou `xclip` sous X11 lorsqu'ils sont disponibles.

## Pilotage au clavier

- Les commandes slash restent celles du runtime actif et ne sont jamais
  déclenchées automatiquement par la Control Room.
- `Ctrl+/` ouvre la palette globale PaneShift : agents, providers et remise à
  zéro des tailles.
- Les mêmes actions restent cliquables dans la barre latérale ; aucune commande
  shell n'est nécessaire pendant le travail courant.

## Live memory

PaneShift sépare la mémoire durable du projet de la mémoire vive des runtimes :

- `PROJECT_STATE.md`, `DECISIONS.md`, les quatre handoffs et Git constituent le
  contrat durable, commun à Anthropic, OpenAI et aux providers locaux ;
- `agent-memory.sh` conserve localement les quatre derniers runs de chaque rôle
  sous `.agent-context/runtime/memory/` ;
- un `BOOTSTRAP.md` compact est régénéré avant chaque nouveau runtime et son
  chemin est exposé dans `AGENT_MEMORY_FILE` ;
- les snapshots sont automatiques avant une bascule provider, au détachement et
  toutes les quinze minutes ;
- les claims atomiques refusent deux rôles sur le même fichier ou dossier.

La sidebar actualise ses lignes en place toutes les cinq secondes (sans effacer
l'écran, donc sans effet de hot reload). Elle affiche les signaux utiles :
rôles frais sur quatre, runs conservés, claims, collisions et âge de la dernière
synchronisation. Le bouton `SYNC MEMORY` force un snapshot immédiat des quatre
rôles.

### Commandes mémoire disponibles

La CLI mémoire reçoit la même configuration que la room :

```bash
./agent-memory.sh --config /chemin/du/projet/agent-room.conf init
./agent-memory.sh --config /chemin/du/projet/agent-room.conf bootstrap "$AGENT_SLOT"
./agent-memory.sh --config /chemin/du/projet/agent-room.conf claim "$AGENT_SLOT" "web/src/lib" "corriger la recherche"
./agent-memory.sh --config /chemin/du/projet/agent-room.conf snapshot "$AGENT_SLOT" milestone
./agent-memory.sh --config /chemin/du/projet/agent-room.conf release "$AGENT_SLOT"
./agent-memory.sh --config /chemin/du/projet/agent-room.conf checkpoint "$AGENT_SLOT" milestone
./agent-memory.sh --config /chemin/du/projet/agent-room.conf validate "$AGENT_SLOT"
./agent-memory.sh --config /chemin/du/projet/agent-room.conf events 50
./agent-memory.sh --config /chemin/du/projet/agent-room.conf export /chemin/memoire.tar.gz
./agent-memory.sh --config /chemin/du/projet/agent-room.conf import /chemin/memoire.tar.gz
./agent-memory.sh --config /chemin/du/projet/agent-room.conf health
./agent-memory.sh --config /chemin/du/projet/agent-room.conf doctor
```

Un projet peut fournir un adaptateur tel que `./bbctl memory ...`. Cet
adaptateur n'est pas une commande globale : utiliser son chemin relatif s'il
n'est pas installé dans le `PATH`.

`snapshot-room [raison] [secondes]` capture les quatre rôles. Le second
paramètre évite une nouvelle capture lorsque le dernier snapshot de room est
plus récent que ce délai. Un heartbeat est un filet de sécurité ; un
`milestone`, une bascule de provider ou un arrêt volontaire sont les vrais
checkpoints de reprise.

### Contrat de mémoire structuré

La mémoire a trois niveaux :

1. **Source durable et partageable** : code et Git, `PROJECT_STATE.md`,
   `DECISIONS.md` et handoffs. Ces fichiers doivent être versionnés pour
   survivre à un changement de machine.
2. **Checkpoint local de reprise** : `runtime/memory/<slot>/runs/`, `latest.md`
   et `BOOTSTRAP.md`. Il capture le handoff, le commit, l'état Git et la raison
   de la sauvegarde, mais n'est pas une seconde source de vérité.
3. **Coordination éphémère** : claims, fraîcheur, routage et télémétrie. Cet
   état peut être reconstruit et reste hors Git.

Un handoff reste court et remplace l'état précédent : tâche, statut, périmètre,
résultat, fichiers, commit, vérifications, blocages et prochaine action. Les
détails historiques appartiennent aux commits et, à terme, au journal
d'événements.

### Format local v2

`schema-version` identifie le format local. `events.tsv` est le journal
append-only des snapshots, bootstraps, claims et releases, avec horodatage,
slot, provider et session. `claims.tsv` stocke chaque réservation comme une
lease : propriétaire, périmètre, tâche, création, expiration et room. Refaire le
même claim le renouvelle ; une lease expirée est purgée lors de la prochaine
opération sur les claims. Les écritures passent par des fichiers temporaires et
des remplacements atomiques ; les verrous abandonnés ont leur propre TTL.

Les snapshots portent déjà slot, rôle, provider, raison et commit. La capture
des 100 dernières lignes du terminal est activée par défaut et subit une
expurgation heuristique des clés, tokens Bearer et clés privées. Elle peut être
désactivée avec `ROOM_MEMORY_CAPTURE_TERMINAL=0`.

### Export et import

`export <archive.tar.gz>` rassemble l'architecture, les règles agents, l'état
global, les décisions, les handoffs et la mémoire locale. Il crée aussi un
fichier `.sha256`. `import` vérifie cette empreinte lorsqu'elle est présente,
refuse les chemins d'archive dangereux, restaure sous la racine du projet puis
réinitialise le contrat local.

Cet export est portable et contrôlé par empreinte, mais **pas chiffré**. Il
contient les captures déjà présentes dans les checkpoints. Le stocker dans un
emplacement privé, transmettre aussi son `.sha256`, relire son contenu avant
partage et chiffrer le fichier avec un outil externe si nécessaire. Une version
future devra ajouter un manifeste détaillé signé, le chiffrement natif et une
rétention indépendante des checkpoints, du journal et de la télémétrie.

Les snapshots peuvent contenir des noms de fichiers, le statut Git, le texte du
handoff et une capture de terminal. Garder `runtime/` local avec des permissions
restrictives, ne jamais y copier `.env`, jetons ou transcripts provider, et
relire tout futur export avant partage. L'expurgation actuelle réduit le risque,
mais ne garantit pas de reconnaître tous les formats de secrets.

### Test de reprise à froid

Un test manuel minimal part d'un clone propre, sans historique de chat :

1. copier uniquement les fichiers versionnés et une configuration sans secret ;
2. exécuter `init`, puis `doctor` et `bootstrap <slot>` ;
3. faire lire le bootstrap à un provider différent ;
4. lui faire identifier tâche, périmètre, dernier commit, changements non
   commités et prochaine vérification, sans contexte oral ;
5. acquérir puis libérer un claim factice et vérifier `health` ;
6. confirmer qu'aucun secret ni chemin de l'ancienne machine n'est requis.

Pour tester le transport complet, exporter la mémoire, copier l'archive et son
`.sha256` sur une seconde machine, l'importer dans un clone jetable, puis refaire
les étapes 2 à 6. Ne jamais tester un import pour la première fois dans le seul
exemplaire d'un projet actif.

## Faire évoluer le setup

- `agent-room.sh` contient le moteur commun et les fonctions tmux.
- `agent-memory.sh` contient la mémoire provider-agnostic, les snapshots et les
  claims de périmètre.
- `agent-room.conf` contient uniquement l'équipe de ce projet.
- `agent-room.example.conf` est le modèle partageable.
- `paneshift` est le point d'entrée public ; `agent-room.sh` conserve le moteur
  historique pour la compatibilité.

`tmux` est ici un moteur d'exécution remplaçable, pas le format du produit :
les noms, rôles, dossiers et commandes des agents vivent dans la configuration.
Une future interface graphique pourra donc réutiliser ce contrat sans modifier
la définition des équipes.

## Application macOS native

L'interface macOS vit dans `Sources/PaneShiftApp`. Elle garde tmux comme moteur
de session, mais déplace les interactions critiques dans une fenêtre AppKit :

- six panneaux correspondant aux panes `1..6` de `:agents`, un seul visible à la
  fois, tous conservant leur état ;
- `Command+Shift+Right/Left` pour passer d'un panneau à l'autre ;
- sélection de sortie et `Command+C` via le presse-papiers macOS ;
- `Command+V` et glisser-déposer de fichiers vers le panneau actif/ciblé ;
- deux modes par panneau : `CHAT` (champ de saisie) et `TERM` (le vrai terminal,
  clavier direct).

Lancer l'app contre une room existante :

```bash
./paneshift-app --session bb
```

### D'où vient le contenu du mode CHAT

CHAT **ne lit plus l'écran du terminal**. Chaque CLI tient son propre journal de
session structuré, et c'est lui qui est lu :

| Fournisseur | Journal | Fin de tour |
|---|---|---|
| Claude Code | `~/.claude/projects/<dossier>/<session>.jsonl` | `stop_reason: end_turn` |
| Codex | `~/.codex/sessions/AAAA/MM/JJ/rollout-*.jsonl` | `task_complete` |
| Grok | `~/.grok/sessions/<dossier>/<session>/chat_history.jsonl` | `turn_ended` |

La jointure entre un pane tmux et son journal se fait par le **répertoire de
travail** de l'agent, unique à chaque worktree.

Conséquences concrètes :

- une réponse qui marque une pause n'est plus tronquée : la fin de tour est un
  événement du fournisseur, pas un délai de 1,5 s sans changement à l'écran ;
- un prompt resté dans le composer est détecté — il n'apparaît jamais dans le
  journal — et signalé au bout de quelques secondes avec un bouton `RETRY`,
  au lieu d'un spinner infini ;
- un fournisseur bloqué (quota, `/login`) est affiché comme **bloqué** dans
  l'en-tête du panneau, pas comme un agent disponible ;
- l'historique est reconstruit au lancement depuis le journal réel, et remis à
  zéro lors d'un changement de fournisseur ;
- ce qui est tapé directement dans `TERM` apparaît aussi dans `CHAT` ;
- les six agents avancent en parallèle, même masqués.

`STOP` interrompt le tour en cours, `RETRY` renvoie le dernier prompt.

### Diagnostic

Voir exactement ce que CHAT lit pour chaque agent, et quel fichier :

```bash
./.build/debug/PaneShiftApp --session paneshift-local --transcript-probe
./.build/debug/PaneShiftApp --session paneshift-local --transcript-probe --agent 3
```

`transcript: NOT FOUND` signifie que le CLI n'a encore ouvert aucune session
(par exemple un agent qui n'a jamais reçu de prompt accepté).

Les transitions d'état de la plomberie (envoi, échec, annulation, changement de
fournisseur) sont journalisées, **sans aucun contenu de prompt ni de réponse**,
dans `~/.local/state/paneshift/paneshift.jsonl`.

### Quand un agent meurt

Un pane tmux vivant ne veut pas dire un agent vivant. Si le CLI quitte — Codex
sur une limite d'usage, par exemple — le pane retombe sur un shell, et tout
prompt y devient une **commande shell** (`zsh: command not found: Réponds`).

PaneShift refuse désormais cette situation à trois niveaux :

- l'en-tête du panneau affiche **⚠︎ process exited**, la sidebar affiche
  `EXITED` (CLI morte) ou `GONE` (pane disparu) ;
- l'envoi est bloqué avant le collage **et** re-vérifié juste avant le `Enter`,
  car le CLI peut mourir entre les deux ; le texte collé est alors effacé plutôt
  que soumis, donc rien n'est jamais exécuté par le shell ;
- `doctor` teste la **santé des process**, pas seulement la présence des panes,
  et relance le CLI manquant :

```bash
./agent-room.sh --config ./agent-room.local.conf --session paneshift-local doctor
```

Un agent est considéré mort si son shell est au premier plan **et n'a aucun
processus enfant** — un CLI lancé via un script wrapper n'est donc pas pris à
tort pour un agent mort.

### La sidebar se recharge toute seule

La sidebar est une boucle bash lancée à la création de la room : elle exécutait
la version du script présente à ce moment-là. Toute correction apportée ensuite
à la télémétrie ou à la grille restait invisible jusqu'à une réinstallation
manuelle — c'est ce qui a fait croire pendant une session que les tokens Grok
n'étaient pas comptés alors que le code était correct. Elle se ré-exécute
maintenant d'elle-même dès que `agent-room.sh` change.

### Tests

```bash
./tests/core.sh                      # cœur conversationnel (24 tests)
bash tests/agent_room.test.sh        # room tmux, mémoire, routage
```

`tests/core.sh` compile hors du dépôt, dans `~/Library/Caches/PaneShift/build`.
Raison : le projet vit sous `~/Desktop`, synchronisé par iCloud, dont le file
provider appose `com.apple.FinderInfo` sur les bundles créés. `codesign` refuse
alors de signer le bundle de tests :

```text
PaneShiftCoreTests.xctest: resource fork, Finder information, or similar
detritus not allowed
```

`xattr -c` ne suffit pas — l'attribut revient à chaque reconstruction sur place.
Construire hors de l'arborescence synchronisée supprime la cause.

### Serveur OVH à la demande

Pour une room distante, copier `server.example.conf` vers
`~/.config/paneshift/server.conf` sur le Mac, protéger le fichier avec
`chmod 600`, puis lancer simplement :

```bash
./paneshift-app --watch
```

Le lanceur effectue uniquement une mise à jour Git en avance rapide lorsque le
dépôt Mac est propre. Il réactive ensuite l'instance OVH si nécessaire, attend
le retour de SSH, recrée la room distante et connecte le prototype natif à son
tmux via `--ssh`. Les changements publiés de la sidebar deviennent donc visibles
au lancement puis ses données s'actualisent toutes les cinq secondes.

Le bouton `SAVE & SHELVE SERVER` est l'arrêt économique : il refuse de continuer
si un agent travaille, capture la mémoire des quatre rôles, synchronise le disque
et met l'instance en `shelve`. Un simple arrêt ou une pause OVH ne convient pas,
car les ressources restent alors facturées. Le `shelve` libère le calcul et ne
laisse que le snapshot à payer ; `unshelve` reprend la facturation et restaure le
serveur au lancement suivant.

Le Mac doit disposer du client officiel `ovhcloud`, authentifié sur le projet,
avec les seuls droits nécessaires pour lire l'instance et exécuter
`shelve`/`unshelve`. Aucun identifiant OVH ne doit être committé. La commande
`./paneshift-server status` vérifie SSH sans modifier le serveur ; les commandes
`wake` et `shelve` pilotent explicitement son cycle de vie.

Vérifier seulement que le backend voit les quatre panes :

```bash
./paneshift-app --session bb --check
```

Ce prototype n'est pas encore un émulateur de terminal complet : il affiche les
sorties capturées et envoie les frappes via tmux. Il permet déjà de tester le
feeling produit macOS/geek sans abandonner tmux ; la prochaine étape est
d'intégrer un vrai composant terminal/PTY pour obtenir le rendu ANSI, le curseur
et le scroll d'un terminal complet.

## Isolation des espaces de travail

Le mode sûr est un Git worktree distinct par rôle. PaneShift bloque les
répertoires partagés sauf si `ROOM_ALLOW_SHARED_WORKSPACES=1` est posé
explicitement dans la configuration. Cette exception existe encore pour la
Control Room actuelle, mais elle ne protège pas des conflits d'écriture : les
agents doivent alors être répartis sur des fichiers distincts.

Commandes disponibles :

```bash
./paneshift --config /chemin/du/projet/agent-room.conf status
./paneshift --config /chemin/du/projet/agent-room.conf focus 1
./paneshift --config /chemin/du/projet/agent-room.conf zoom 4
./paneshift --config /chemin/du/projet/agent-room.conf theme
./paneshift --config /chemin/du/projet/agent-room.conf doctor
./agent-memory.sh --config /chemin/du/projet/agent-room.conf health
```

## License

[PaneShift is open source software released under the MIT License.](./LICENSE)

Copyright (c) 2026 pranklord.

## Verify

```bash
bash scripts/verify.sh
```
