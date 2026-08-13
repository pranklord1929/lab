# PaneShift — audit consolidé de l'application

Date : 31 juillet 2026  
Périmètre : application AppKit, transport tmux, launchers, room locale à six agents, tests, état Git et comportement live.  
Méthode : lecture du code et des captures tmux, diagnostics CLI non destructifs, compilation et tests. Aucun contrôle distant de l'interface et aucune modification du code applicatif pendant cet audit.

## Verdict

PaneShift n'a pas aujourd'hui un problème cosmétique. Le produit repose sur une chaîne de communication non déterministe et non observée : le GUI simule un chat au-dessus de six interfaces terminal plein écran, envoie des frappes, capture leur rendu, puis essaie de deviner le début et la fin des réponses.

Cette chaîne comporte au moins trois pannes indépendantes :

1. un prompt peut rester dans le composer du vrai terminal sans être soumis ;
2. le fournisseur peut être vivant mais inutilisable, par exemple à cause d'un quota ou d'un menu interactif ;
3. le terminal et le parser peuvent posséder la bonne réponse tandis que le CHAT natif ne l'affiche toujours pas.

Les correctifs successifs ont traité des symptômes locaux, mais l'architecture n'offre ni accusé de réception, ni état de tour explicite, ni timeout, ni journal de diagnostic, ni test automatisé du chemin CHAT. Continuer à ajuster des délais ou des regex ne peut pas rendre l'ensemble fiable.

## Chaîne actuelle et points de rupture

```text
InputTextView
    ↓ submit()
TmuxController.sendLine()
    ↓ load-buffer / paste-buffer / sleep / Enter
TUI Codex, Claude ou Grok dans tmux
    ↓ capture-pane toutes les 1,2 s
productiveResponse()
    ↓ heuristiques sur le rendu visuel
PaneView.pendingPrompt / pendingCandidate / chatTurns
    ↓ setAttributedString()
NSTextView visible
```

| Étape | État actuel | Problème principal |
|---|---|---|
| Saisie native | Fonctionnelle visuellement | Le thread UI exécute des appels tmux synchrones |
| Soumission tmux | Non fiable | Un délai fixe de 120 ms remplace un accusé de réception |
| Fournisseur | Opaque | « process vivant » est confondu avec « agent disponible » |
| Lecture de réponse | Fragile | Le rendu TUI est utilisé comme protocole de données |
| Fin de tour | Heuristique | Prompt prêt ou texte stable pendant 1,5 s |
| Historique CHAT | Éphémère | Conservé seulement en mémoire dans chaque `PaneView` |
| Diagnostic | Absent | Les erreurs tmux sont supprimées et les transitions ne sont pas loguées |

## État live observé

Les six processus tmux étaient vivants (`pane_dead=0`), mais cela ne signifie pas que six agents fonctionnaient.

| Session | Pane | État réel observé | Résultat du parser CHAT |
|---|---:|---|---|
| CODEX-1 | `%0` | « salut » soumis, réponse `Salut 👋` présente | Réponse extraite correctement |
| CODEX-2 | `%3` | « yo » resté dans le composer, aucune réponse | Vide |
| CLAUDE-1 | `%1` | Limite mensuelle atteinte, écran `/rate-limit-options` ouvert | Erreur de quota extraite |
| CLAUDE-2 | `%4` | Même limite mensuelle et même menu interactif | Erreur de quota extraite |
| GROK-1 | `%2` | Réponse présente | Réponse extraite correctement |
| GROK-2 | `%5` | Réponses présentes pour `test` et `yo` | Réponse extraite correctement |

Conclusion importante :

- CODEX-2 prouve une panne de transport/soumission ;
- les deux Claude prouvent une panne de disponibilité fournisseur ;
- CODEX-1 et les Grok prouvent que, lorsque l'utilisateur ne voit rien malgré une réponse, la panne se situe après le terminal et parfois après le parser, donc dans l'état ou le rendu natif.

L'application n'expose pas l'état interne de `PaneView`. Il est donc impossible de distinguer après coup un `pendingPrompt` perdu, un refresh non appliqué et un rendu invisible. C'est précisément le déficit d'observabilité à corriger avant toute nouvelle retouche UI.

## Problèmes critiques

### C1 — La soumission d'un prompt n'est pas confirmée

`Sources/PaneShiftApp/main.swift:605-617` :

- charge le texte dans le buffer tmux global ;
- colle le buffer ;
- attend 120 ms ;
- envoie `Enter` ;
- retourne `true` si tmux a accepté la frappe, pas si le TUI a soumis le prompt.

Le prompt `yo` de CODEX-2 était encore dans le composer. C'est une reproduction directe du défaut.

Le délai fixe ne peut pas être rendu fiable : le temps de traitement du bracketed paste varie selon le fournisseur, la charge et le redraw. En mode distant, plusieurs commandes SSH synchrones aggravent encore le problème.

Correctif requis : une soumission asynchrone avec buffer tmux nommé, vérification que le composer a quitté l'état draft, retries bornés, puis erreur visible si aucun accusé de réception n'arrive.

### C2 — Le rendu visuel d'un TUI est utilisé comme protocole

`productiveResponse()` et `terminalAppearsReady()` (`main.swift:267-358`) dépendent de caractères et de textes d'interface comme `›`, `❯`, `Thought for`, `Worked for`, `Shift+Tab`, `Implement {feature}` et des bordures Unicode.

Conséquences :

- une mise à jour de Codex, Claude ou Grok peut casser le CHAT sans erreur de compilation ;
- une réponse peut être coupée si elle fait une pause supérieure à 1,5 s ;
- une réponse composée uniquement d'éléments filtrés laisse le spinner actif à vie ;
- les redraws Grok remplissent le scrollback de copies d'écran ;
- les erreurs, menus interactifs et réponses normales partagent le même chemin heuristique.

Correctif requis : adaptateurs par fournisseur utilisant en priorité leurs événements ou journaux structurés. Le projet sait déjà localiser les JSONL Codex et Claude pour les tokens ; cette source doit être évaluée pour les tours et réponses. Un fournisseur sans journal structuré doit avoir son propre adaptateur et ses propres fixtures, pas une regex universelle.

### C3 — Aucun test ne couvre la fonction centrale du produit

`Package.swift` ne définit aucun target de tests. `swift test` répond `error: no tests found`.

La suite `tests/agent_room.test.sh` couvre principalement la room tmux, la mémoire, les claims et le routing. Elle ne teste pas :

- deux prompts successifs ;
- le passage draft → submitted → running → completed ;
- le loader et la réactivation du champ ;
- une réponse avec pause ;
- un quota fournisseur ;
- un changement d'agent pendant une réponse ;
- un reload de l'app pendant un tour ;
- le rendu du transcript dans `NSTextView`.

Une suite verte ne dit donc rien sur le bug vécu par l'utilisateur.

### C4 — Le projet courant n'est pas reproductible depuis Git

État constaté :

- environ 1 000 lignes modifiées dans `Sources/PaneShiftApp/main.swift`, non commités ;
- `paneshift-local`, `paneshift-ovh`, `agent-room.local.conf`, `AGENTS.md`, `ARCHITECTURE.md` et `CLAUDE.md` non suivis ;
- `agent-room.example.conf` et `server.example.conf` suivis mais supprimés ;
- `ARCHITECTURE.md` ne contient qu'un placeholder ;
- sept autres fichiers suivis sont modifiés ou supprimés.

Une installation propre du commit courant ne peut pas reconstruire la room locale exécutée pendant l'audit. Avant toute nouvelle refonte, l'état actuel doit être sauvegardé sur une branche et les fichiers locaux, exemples et secrets clairement séparés.

### C5 — DropHover local possède un hôte OVH par défaut

`macos/PaneShiftDropHover.swift:404-405` utilise par défaut :

```text
ubuntu@152.228.144.109
/home/ubuntu/work/PANESHIFT/shots
```

`agent-room.sh:1295-1308` lance le helper local sans lui passer de mode local ou de destination. Si le helper tourne et qu'un fichier est déposé, il peut tenter un `scp` vers cet hôte ou échouer silencieusement.

Le PID enregistré pendant l'audit était obsolète et aucun helper actif n'a été trouvé, donc aucun transfert actif n'a été constaté. Le défaut reste néanmoins présent dans le code et doit être corrigé avant de réactiver DropHover.

## Problèmes élevés

### H1 — Pas de machine à états de tour

Le tour est représenté par trois propriétés éparses :

- `pendingPrompt` ;
- `pendingCandidate` ;
- `pendingCandidateChangedAt`.

Il manque des états explicites comme `submitting`, `submitted`, `running`, `completed`, `blocked`, `failed`, `cancelled` et `timedOut`. Sans eux, le GUI ne peut ni expliquer le problème ni récupérer proprement.

### H2 — Aucun timeout ni bouton d'annulation en CHAT

Si le prompt reste dans le composer ou si le parser ne produit rien, `pendingPrompt` reste défini, l'input reste désactivé et le spinner continue indéfiniment (`main.swift:996-1023`, `1111-1129`).

Il faut un timeout de soumission court, un timeout de réponse distinct, une erreur visible et une action Cancel/Retry.

### H3 — L'historique visible n'est pas la session réelle

`chatTurns` est un tableau privé en mémoire (`main.swift:745`). Au démarrage, CHAT ne reconstruit rien depuis tmux ou les journaux. Après un reload, l'écran est vide alors que les vraies conversations existent toujours.

Le même état n'est pas remis à zéro après un changement de fournisseur. Un nouveau provider peut donc afficher l'ancien transcript local ou conserver un spinner lié à l'ancienne session.

### H4 — Les erreurs tmux sont volontairement jetées

`TmuxController.tmux()` redirige `stderr` vers `FileHandle.nullDevice` (`main.swift:516`) et renvoie seulement un `String?`. L'application ne conserve ni commande, ni code de sortie, ni durée, ni identifiant de tour.

Les diagnostics actuels ne permettent donc pas de savoir pourquoi un message n'a pas été soumis.

### H5 — Le thread principal exécute des opérations bloquantes

`submit()` appelle `sendLine()` depuis l'acteur principal. Cette fonction lance plusieurs subprocess tmux et appelle `Thread.sleep`. `activate()` appelle aussi `controller.focus()` de façon synchrone. Les six `PaneView` font une capture synchrone pendant leur initialisation.

Résultat attendu : micro-freezes, focus retardé et interface qui semble sauter, surtout en SSH.

### H6 — Le buffer tmux utilisé pour les prompts est global et non nommé

`load-buffer -` puis `paste-buffer` utilise le buffer tmux par défaut. Deux clients ou deux opérations proches peuvent s'écraser. Chaque soumission doit utiliser un buffer nommé et unique, supprimé après collage.

### H7 — La sidebar confond présence, mémoire fraîche et disponibilité

La sidebar annonce six terminaux et affiche `6/6 live`, mais les deux Claude sont bloqués par quota et CODEX-2 avait un draft non soumis. Le champ `live` vient de la fraîcheur mémoire, pas de la capacité à répondre.

Il faut afficher séparément : process vivant, fournisseur prêt, occupé, bloqué par quota/menu, erreur de soumission.

### H8 — Le modèle choisi dans le GUI est ignoré

Le GUI envoie quatre arguments :

```text
switch <index> <provider> <model>
```

Mais le dispatcher `agent-room.sh:1689` appelle seulement :

```bash
switch_agent "${2:-}" "${3:-}"
```

Le quatrième argument n'atteint jamais `requested_model`. La confirmation du GUI peut donc annoncer un modèle qui n'est pas lancé.

### H9 — Le détecteur `pane_is_busy` produit des faux positifs

`agent-room.sh:1147-1160` compare deux captures espacées de 300 ms pour tout process non-shell. Un curseur, une horloge ou un redraw idle suffit à déclarer l'agent occupé et à bloquer un switch ou un shelve légitime.

### H10 — Plusieurs comportements restent codés pour quatre agents

- `PaneShiftDropHover.swift:242` utilise un modulo 4 ;
- les bindings `MouseDown1Control4` et `MouseDown1Control5` écrasent ceux des agents 5 et 6 (`agent-room.sh:469-474`) ;
- plusieurs textes README parlent encore de quatre rôles, quatre handoffs, une mosaïque 2×2 et un cinquième volet.

## Problèmes moyens et dette produit

### M1 — Le mode « stabilité 1,5 s » peut tronquer une réponse

Une pause de génération supérieure à 1,5 seconde suffit à finaliser le tour. Les fragments suivants ne seront plus associés au prompt puisque `pendingPrompt` est ensuite remis à `nil`.

### M2 — `submit()` normalise un texte mais en envoie un autre

`pendingPrompt` reçoit `trimmed`, tandis que `sendLine()` reçoit `text` brut (`main.swift:1111-1125`). Les espaces et retours ajoutés peuvent désynchroniser la recherche du prompt.

### M3 — Seul l'agent sélectionné est rafraîchi

`refreshPaneOutputs()` capture uniquement `activeIndex` (`main.swift:1609-1633`). C'est économique, mais un tour lancé puis masqué ne progresse plus côté CHAT jusqu'au retour sur cet agent. Le vrai provider continue, l'UI locale prend du retard.

### M4 — Les données activity existent mais ne sont pas dessinées

`SidebarData` stocke les lignes `GRID`, mais `SidebarView.draw` n'affiche aucune heatmap. La fonctionnalité promise existe dans la sidebar tmux, pas dans l'application native actuelle.

### M5 — La télémétrie locale est incomplète

- RAM macOS reste `—` car `ram_usage` utilise `free -b` ;
- Grok est exclu de `refresh_token_telemetry` ;
- la découverte de logs Claude dépend de `lsof` et `rg` et échoue silencieusement s'ils manquent ;
- le premier format de `session_metrics` contient trois champs au lieu de quatre.

### M6 — Le README ne correspond plus au produit

Exemples de divergences : clic simple censé ouvrir le provider alors qu'il sélectionne la session, reset 2×2 alors que la room possède six agents, docking à droite documenté mais désactivé dans le code pour plus de quatre panes, « cinquième volet » alors que la room en contient sept avec la sidebar.

### M7 — Le launcher est un outil de développement, pas une app distribuable

Le lancement normal passe par `swift run`. Il n'existe pas d'app bundle versionnée, de version produit, de stockage de logs standard ni de mécanisme stable de relance. Le processus audité avait comme parent une session Codex, ce qui est acceptable pour le développement mais pas pour un outil quotidien.

## Ce qui fonctionne

- Les six processus provider restent isolés dans des worktrees distincts.
- La room locale utilise les abonnements existants et la configuration active demande le mode subscription-only.
- Les captures tmux et le parser simple extraient correctement les réponses live de CODEX-1, Grok-1, Grok-2 et les erreurs de quota Claude.
- `swift build -Xswiftc -warnings-as-errors` passe.
- `bash -n` passe sur les scripts principaux.
- `tests/agent_room.test.sh` passe pour les fonctions qu'il couvre.
- `git diff --check` ne trouve pas d'erreur d'espacement.
- L'application n'est pas particulièrement lourde au repos : environ 52 Mo de footprint constaté, avec un pic d'environ 136 Mo. La panne n'est pas une saturation CPU/RAM.

## Architecture recommandée

### 1. Introduire un noyau de conversation testable

```swift
enum TurnState {
    case idle
    case submitting(turnID: UUID)
    case running(turnID: UUID)
    case completed(turnID: UUID, response: String)
    case blocked(reason: String)
    case failed(reason: String, retryable: Bool)
}
```

Le view controller ne doit plus déduire cet état directement depuis un `NSTextView` ou un timer.

### 2. Créer un adaptateur par fournisseur

Chaque adaptateur doit fournir :

- la détection `ready / busy / blocked` ;
- la soumission avec accusé de réception ;
- la lecture structurée du transcript ;
- la détection de fin de tour ;
- la reprise après reload.

Le chemin tmux reste utile comme terminal réel et source de secours, mais ne doit plus être l'unique protocole métier du CHAT.

### 3. Rendre le transport asynchrone et vérifiable

Pour chaque prompt :

1. générer un `turnID` ;
2. créer un buffer tmux nommé ;
3. coller le prompt hors du main thread ;
4. vérifier que le draft a quitté le composer ;
5. retenter `Enter`/`C-m` avec backoff borné si nécessaire ;
6. émettre `submitted` ou `failed` ;
7. supprimer le buffer nommé.

### 4. Persister et reconstruire le transcript

Au minimum, conserver par pane un petit journal local `turnID`, prompt, statut, réponse et session provider. Au mieux, reconstruire depuis les logs structurés du provider et utiliser le journal PaneShift seulement pour la corrélation.

### 5. Ajouter une observabilité locale sobre

Un fichier JSONL rotatif doit enregistrer sans contenu sensible : timestamp, pane, provider, turnID, transition d'état, durée, exit status tmux et motif d'échec. Aucun prompt complet n'est nécessaire pour diagnostiquer la plomberie.

## Plan de correction recommandé

### Phase 0 — Stabiliser et rendre observable

1. sauvegarder l'état Git actuel sur une branche dédiée ;
2. ajouter la machine à états et le journal de transitions ;
3. ajouter timeout, Cancel et Retry ;
4. afficher l'état provider réel ;
5. neutraliser le fallback OVH de DropHover en local.

### Phase 1 — Fiabiliser le transport

1. déplacer tous les appels tmux hors du main thread ;
2. utiliser des buffers nommés ;
3. vérifier la soumission au lieu d'attendre 120 ms ;
4. conserver TERM comme fallback explicite ;
5. tester deux tours consécutifs sur chaque provider.

### Phase 2 — Remplacer le scraping générique

1. créer `CodexAdapter`, `ClaudeAdapter` et `GrokAdapter` ;
2. exploiter les événements/logs structurés disponibles ;
3. conserver des fixtures réelles anonymisées pour les cas TUI restants ;
4. reconstruire les chats après reload et après changement d'agent.

### Phase 3 — Assainir le projet

1. séparer configuration locale, exemples versionnés et secrets ;
2. remplir `ARCHITECTURE.md` ;
3. remettre README et comportement en cohérence ;
4. versionner les launchers nécessaires ;
5. créer une app bundle et un cycle de release reproductible.

## Tests d'acceptation obligatoires

Le CHAT ne doit plus être considéré comme réparé tant que ces scénarios ne passent pas automatiquement :

1. deux prompts courts successifs sur Codex ;
2. deux prompts successifs sur Grok ;
3. provider bloqué par quota : état `blocked`, aucun spinner infini ;
4. prompt long, multiligne, accents et emoji ;
5. paste lent : accusé de réception ou erreur, jamais un draft silencieux ;
6. réponse avec pause supérieure à cinq secondes sans troncature ;
7. changement d'agent pendant une réponse puis retour ;
8. reload de l'app pendant une réponse ;
9. changement de provider : ancien transcript isolé, modèle demandé réellement lancé ;
10. aucun transfert réseau lors d'un drop en mode local ;
11. navigation correcte entre les six agents ;
12. erreur tmux injectée : message visible et retry possible.

## Ordre de priorité final

| Priorité | Action | Pourquoi |
|---:|---|---|
| 1 | Machine à états + logs | Sans preuve interne, chaque nouveau fix reste aveugle |
| 2 | Soumission avec accusé de réception | Corrige le prompt réellement bloqué dans CODEX-2 |
| 3 | Timeout / Cancel / Retry | Supprime les spinners infinis et rend l'app récupérable |
| 4 | Santé provider réelle | Distingue quota Claude, draft Codex et agent prêt |
| 5 | Adaptateurs structurés | Élimine la dépendance au chrome TUI |
| 6 | Tests CHAT automatisés | Empêche le retour du bug au deuxième message |
| 7 | Persistance du transcript | Rend le reload et le switch fiables |
| 8 | Assainissement Git et launchers | Rend le produit reproductible |
| 9 | Bugs secondaires six agents / télémétrie | Termine la cohérence du produit |

## Conclusion

La bonne interface est récupérable et il n'est pas nécessaire de repartir du design. En revanche, la plomberie CHAT doit être reconstruite autour d'états explicites et d'événements vérifiables. Le terminal réel peut rester derrière chaque session, mais PaneShift ne doit plus traiter une capture d'écran texte comme une API fiable.

Le prochain travail pertinent n'est pas un nouveau patch de délai. C'est la Phase 0, suivie d'un test automatisé de deux tours Codex qui échoue avant le correctif et passe après.
