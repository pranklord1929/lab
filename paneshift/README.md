# PaneShift

Un lanceur autonome construit une mosaïque tmux 2×2 avec quatre agents, des
labels persistants et un menu de contrôle.
Le thème actif est le rendu clair d'origine ; une palette alternative peut être
sélectionnée plus tard dans le fichier de configuration.

## Vision produit

PaneShift est une console locale minimaliste pour les personnes qui pilotent
de gros projets avec plusieurs agents de code. Les cases représentent des rôles
durables ; Anthropic, OpenAI ou un fournisseur local sont interchangeables.

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

Si la session existe, elle est simplement rejointe. Sinon les quatre agents
définis dans la configuration sont lancés. Le raccourci direct `Ctrl+/` ouvre
la palette globale depuis n'importe quel volet (`Ctrl-b`, puis `g`, reste un
secours).

## Configurer un projet

Copier uniquement le modèle de configuration dans le nouveau projet :

```text
agent-room.example.conf → agent-room.conf
```

Adapter dans `agent-room.conf` le nom, le rôle, le dossier et les commandes
`ANTHROPIC_COMMAND` / `OPENAI_COMMAND` de chacun des quatre agents. Puis lancer :

```bash
./paneshift --config /chemin/du/projet/agent-room.conf
```

Le moteur n'impose pas de modèle : chaque commande fournisseur peut être
remplacée par une commande compatible. Le fichier de configuration ne doit pas
contenir de mot de passe ni de clé API.

## Router un rôle vers un fournisseur

Les cases représentent des rôles, pas des modèles. Cliquer sur un rôle dans le
panneau droit ouvre le choix de fournisseur. Anthropic et OpenAI sont affichés
comme providers, tandis que Claude Code et Codex sont seulement leurs runtimes.

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

## Prototype macOS natif

Un premier prototype d'interface macOS vit dans `Sources/PaneShiftApp`. Il garde
tmux comme moteur de session, mais déplace les interactions critiques dans une
fenêtre AppKit native :

- quatre panneaux focusables correspondant aux panes `1..4` de `:agents`, avec
  une esthétique proche de la Control Room tmux ;
- `Command+Shift+Right/Left` pour passer d'un panneau à l'autre ;
- sélection de sortie et `Command+C` via le presse-papiers macOS ;
- `Command+V` et glisser-déposer de fichiers vers le panneau actif/ciblé ;
- saisie directe dans le panneau actif, sans champ texte séparé ;
- rafraîchissement régulier par `tmux capture-pane`.

Lancer le prototype contre une room existante :

```bash
./paneshift-app --session bb
```

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
