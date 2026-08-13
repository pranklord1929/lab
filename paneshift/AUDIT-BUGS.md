# Audit PaneShift — test live + revue code

**Date :** 2026-07-31 (soir)  
**Branche :** `agent/chat-transcript-engine` (`5a497ee` Rebuild CHAT on provider transcripts…)  
**Méthode :** lecture du code actuel, `swift build`, probes CLI non-GUI, room live `paneshift-local` (6 agents), suite shell `tests/agent_room.test.sh`.  
**Rien n’a été modifié dans le code applicatif** (hors ce fichier d’audit).

---

## Verdict

L’architecture CHAT a **beaucoup changé** depuis l’audit précédent. Le screen-scraping (`productiveResponse`) a été remplacé par un moteur `PaneShiftCore` qui lit les transcripts JSONL des CLI. C’est la bonne direction : Grok et Codex « sains » répondent correctement de bout en bout.

En revanche, la room live montre encore des **pannes dures** :

1. un agent peut être **mort** (seul un shell) sans que l’UI le dise ;
2. une soumission peut **ne jamais entrer** dans le transcript → échec à 12 s ;
3. le premier attachement à un fichier de session peut **annuler** un tour en cours ;
4. les tests unitaires Swift **ne tournent pas** sur cette machine (codesign / xctest).

| Agent | Processus live | Transcript | send-probe |
|-------|----------------|------------|------------|
| CODEX-1 | `codex` OK | trouvé | **OK** `CODEX1_WARM` |
| CLAUDE-1 | `claude` OK (quota) | trouvé | **FAIL** submitting → failed (prompt jamais ack) |
| GROK-1 | `grok` OK | trouvé | **OK** `AUDIT_PROBE_OK` |
| CODEX-2 | **zsh seul — codex mort** | parfois trouvé | **FAIL** (paste dans un shell vide) |
| CLAUDE-2 | `claude` OK (quota) | trouvé | non re-testé ; même classe que CLAUDE-1 |
| GROK-2 | `grok` OK | trouvé | historique OK au probe |

---

## Ce qui a été corrigé depuis l’ancien AUDIT-BUGS

| Ancien bug | État actuel |
|------------|-------------|
| `switch` ignore le modèle (`$4`) | **Corrigé** — `switch_agent "${2:-}" "${3:-}" "${4:-}"` |
| Drop-hover → IP OVH hardcodée | **Corrigé** — `remoteHost` optionnel ; local = chemin local |
| Cycle DropHover `% 4` | **Corrigé** — modulo sur le nombre de panes agents |
| Bindings Control4/5 vs agents 5–6 | **Corrigé** — boutons après le dernier agent |
| `pane_is_busy` redraw 0,3 s | **Corrigé** — grep de patterns busy seulement |
| `PANESHIFT_DOCK_RIGHT` si >4 panes | **Corrigé** — dock sans gate sur le count |
| CHAT stuck spinner / 1,5 s trunc | **Remplacé** par engine + timeouts 12 s / 900 s |
| Historique après switch | **Corrigé** — `session.rebind` + `engine.clear()` |
| `session_metrics` 3 champs | **Corrigé** — 4 champs même sans fichier |
| RAM macOS `—` | **Corrigé** — `vm_stat` / `sysctl` sur Darwin |
| Grille GRID non peinte | **Corrigé** — `SidebarView` dessine le calendrier |

---

## Tests exécutés

```text
swift build                          → OK (~10 s)
swift test                           → FAIL (codesign / bundle xctest)
bash tests/agent_room.test.sh        → OK
PaneShiftApp --check                 → 1:%0 … 6:%5 OK
--transcript-probe                   → 6 agents lus (CODEX-2 d’abord NOT FOUND)
--send-probe --agent 3 (Grok)        → completed, AUDIT_PROBE_OK
--send-probe --agent 4 (Codex-2)     → cancelled puis failed (process mort)
--send-probe --agent 2 (Claude)      → failed submitting (pas d’ack)
--send-probe --agent 1 (Codex-1)     → completed, CODEX1_WARM
agent-room doctor                    → 6 panes OK
```

**Note infrastructure :** `swift test` échoue avec  
`resource fork, Finder information, or similar detritus not allowed` / bundle xctest introuvable.  
Les tests `ConversationEngineTests` / `TranscriptAdapterTests` **ne valident donc rien en CI locale** tant que le codesign n’est pas résolu.

---

## Bugs critiques (reproduits ou prouvés en live)

### C1 — Agent mort non détecté : CODEX-2 n’a plus de process `codex`

**Preuve live :**

```text
%3 CODEX-2  pane_current_command=zsh  descendants = -zsh seulement
%0 CODEX-1  descendants = zsh → codex --no-alt-screen → …
```

Le pane tmux est vivant (`pane_dead=0`), `@agent_provider=openai` reste collé, le GUI propose encore CHAT.

**Effet :**

- `sendLine` colle dans un **zsh vide** ;
- aucun événement dans le JSONL Codex ;
- CHAT reste en `submitting` puis `failed` / `cancelled` après timeout ;
- capture-pane quasi vide → TERM inutilisable aussi.

**Manque :**

- surveillance `pane_current_command` / arbre de process ;
- badge « process exited » ;
- relance (`respawn` / re-`launch_agent`) ou au moins refus de submit avec message clair.

---

### C2 — Course critique : 1ʳᵉ localisation du transcript annule le tour en cours

`TranscriptSession.poll` :

1. résout le fichier session (parfois `nil` au départ) ;
2. au premier hit : `loadExistingHistory` puis **`engine.closeOpenTurnsFromHistory()`** ;
3. `closeOpenTurnsFromHistory` force tout tour non terminal **sans réponse** en `.cancelled`.

**Scénario CODEX-2 (reproduit) :**

```text
transcript: NOT FOUND
[…] submitting: Réponds exactement: CODEX2_OK
[…] cancelled
response: (empty)
exit=2
```

Pourtant le JSONL a bien reçu ensuite :

```text
user_message Réponds exactement: CODEX2_OK
agent_message CODEX2_OK
task_complete
```

**Cause :** le pending `.submitting` est traité comme un « tour d’historique ouvert » et **annulé** quand le fichier apparaît (souvent encore incomplet).

**Fix attendu :** ne pas appeler `closeOpenTurnsFromHistory` sur les tours `isLocal` / `pending` actifs ; ou différer le close tant qu’un `pending` existe.

---

### C3 — Soumission non ack : timeout 12 s sans feedback terminal

Reproduit :

- **CODEX-2** (process mort) → failed empty ;
- **CLAUDE-1** (quota / UI rate-limit) → `submitting` → `failed`, transcript inchangé (pas de user `ping`).

Le commentaire de `sendLine` est honnête : `true` = tmux a accepté les frappes, **pas** que le TUI a pris le prompt. L’engine détecte l’absence d’ack (bien), mais :

- pas de capture du composer pour montrer « prompt encore dans le TUI » ;
- pas de distinction « process mort » / « UI bloquée » / « paste ignoré » ;
- Retry renvoie le même prompt dans le même trou.

---

### C4 — Claude : `stop_reason` autre que `end_turn` ne termine jamais le tour live

Fichier live CLAUDE-1 :

```text
stop_reason distribution: { 'stop_sequence': 1 }
```

`ClaudeAdapter` ne ferme le tour que si `stop_reason == "end_turn"`.  
Les messages de quota / stop_sequence restent donc en `.running` en live (le probe historique a pu les marquer `blocked` via `closeOpenTurnsFromHistory`, pas via le chemin live).

**Effet :** spinner jusqu’au `responseTimeout` (900 s) même si la réponse d’erreur est déjà dans le transcript.

**Fix attendu :** traiter `stop_sequence`, `max_tokens`, et/ou appeler `blockReason` dès `acceptAssistantMessage`.

---

## Bugs élevés

### H1 — Locator Codex : seulement les **40** rollouts les plus récents

```swift
// SessionLocator.locateCodex
for candidate in candidates.sorted(...).prefix(40) {
```

Il y a **83** rollouts sur cette machine. Un session worktree inactive sort du top 40 → `transcript: NOT FOUND` alors que le fichier existe (observé sur CODEX-2 avant réchauffage mtime).

**Fix :** indexer par `cwd` (cache), ou filtrer par chemin worktree, ou scanner plus large / par jour.

---

### H2 — `ConversationEngine` / `TranscriptSession` non thread-safe

`pollTranscript` et `submit` lancent des `Task.detached` qui mutent le même `ConversationEngine` **sans lock**, pendant que le main thread lit `turns` dans `syncChatState`.

Classes marquées `@unchecked Sendable` sans synchronisation réelle → courses possibles (états incohérents, crash rare, tours perdus).

---

### H3 — Provider `local` non supporté par le moteur transcript

```swift
public enum Provider { case anthropic, openai, grok }
// roomValue "local" → nil
// PaneView: provider ?? .anthropic
```

Un slot `LOCAL` est mappé sur **Anthropic** pour le CHAT → mauvais fichiers, faux « no session » / historique fantôme.

---

### H4 — Claude live sous rate-limit : capture vide + pas d’ack

Process `claude` vivant, capture-pane quasi vide, submit `ping` jamais dans le JSONL.  
L’UI native affiche encore un agent « bloqué » d’après l’historique, mais une **nouvelle** soumission échoue silencieusement jusqu’au timeout 12 s sans indiquer « menu rate-limit / process n’accepte pas le paste ».

---

### H5 — `sendLine` : délai fixe 120 ms + `C-c` heuristique

Toujours le même transport fragile :

- `terminalHasDraft` lit le rendu (vide sur panes cassés) ;
- sleep 0,12 s avant Enter ;
- buffer nommé (amélioration) mais pas d’ack bas niveau.

Fiable sur Grok/Codex sains ; fragile dès que le TUI n’est pas dans l’état « composer vide ».

---

## Bugs moyens

### M1 — Suite unit tests Swift inutilisable localement

`swift test` / codesign échouent sur le bundle `PaneShiftCoreTests.xctest`.  
Les scénarios d’acceptance (2 tours d’affilée, timeout submit, quota blocked…) ne tournent pas ici malgré leur présence dans le repo.

### M2 — Grok : fusion `chat_history` + `events.jsonl` non ordonnée dans le temps

En poll, les messages primary sont ingestés **puis** les companion events. Si `turn_ended` arrive dans le même tick avant le dernier `assistant`, le tour peut se fermer trop tôt (réponse tronquée ou tour vide + orphelin).

### M3 — Health « blocked » collée au **dernier** tour seulement

`updateHealth` regarde `turns.last`. Un tour réussi après un quota ne suffit pas si l’ordre d’ingest est bizarre ; un tour local ensuite peut masquer un provider encore en rate-limit UI.

### M4 — Tokens Grok toujours absents de la télémétrie room

`refresh_token_telemetry` ne traite que `anthropic|openai` (inchangé). Room 6 agents = 2 Grok invisibles dans la grille tokens.

### M5 — `paste` (clipboard) utilise encore le buffer tmux **global**

`sendLine` utilise un buffer nommé `paneshift-…` ; `paste` / `paste_into_pane` utilisent le default → courses multi-panes possibles au collage manuel.

### M6 — Probe historique vs JSONL : états divergents possibles

`--transcript-probe` a déjà montré un dernier tour Codex en `[cancelled]` alors que le JSONL contenait `task_complete` + réponse complète (selon le moment du load). Lié à C2 / partial reads.

### M7 — DropHover : cycle sur `panes.count` vs index agent

Le modulo utilise le nombre de panes **listés avec index**, pas `ROOM_AGENT_COUNT`. OK si 6 agents contigus 1…6 ; fragile si un index manque (pane non décoré) → sauts d’index.

### M8 — Sidebar native : pas d’indicateur health par agent

Le header de pane montre `blocked` / `no session yet`, mais la liste sidebar (SYNC/RESET) ne reprend pas `ProviderHealth` ni « process dead ». L’opérateur clique un agent mort comme s’il était prêt.

---

## Bugs bas / dette

| ID | Détail |
|----|--------|
| L1 | `responseTimeout` 900 s trop long pour une UI interactive si stop_reason manquant |
| L2 | `submissionTimeout` 12 s peut être court sur SSH distant lent |
| L3 | Diagnostics JSONL `~/.local/state/paneshift/paneshift.jsonl` — bien, mais non exposé dans l’UI |
| L4 | `interrupt` envoie seulement `Escape` — insuffisant pour certains TUI (besoin Ctrl+C) |
| L5 | `launch_command` injecte `--settings '{"tui":"default"}'` en string shell — fragile si la commande a déjà des quotes |
| L6 | Plusieurs sessions `agents` → `detectAgentSession` prend la première |
| L7 | Working tree sale (exemples conf supprimés, fichiers `??`) — hors bug runtime mais dette release |

---

## Preuves live (extraits)

### Process trees (2026-07-31)

```text
CODEX-1  zsh → codex --no-alt-screen
CLAUDE-1 zsh → claude --settings {"tui":"default"}
GROK-1   zsh → grok --no-alt-screen
CODEX-2  zsh SEUL                    ← mort
CLAUDE-2 zsh → claude …
GROK-2   zsh → grok …
```

### send-probe Grok-1 — succès

```text
[d36794a0] submitting → running → completed
response: AUDIT_PROBE_OK
exit=0
```

### send-probe Codex-1 — succès

```text
[6e1b40aa] submitting → running (terminal busy) → completed
response: CODEX1_WARM
exit=0
```

### send-probe Codex-2 — échec (cold puis process mort)

```text
transcript: NOT FOUND
[…] cancelled / failed
(empty)
# JSONL a quand même reçu CODEX2_OK plus tard (race C2)
```

### send-probe Claude-1 — échec submit

```text
[…] submitting → failed
(empty)   # pas de user "ping" dans le jsonl
```

---

## Priorité de fix recommandée

1. **C1** — détecter process agent mort + UI + option respawn  
2. **C2** — ne jamais `closeOpenTurnsFromHistory` sur un pending local actif  
3. **C4** — Claude : fin de tour sur tous les `stop_reason` pertinents + `blockReason` à l’ingest assistant  
4. **H1** — locator Codex par cwd, pas top-40 mtime  
5. **H2** — sérialiser les mutations engine (actor / queue)  
6. **H3** — provider `local` (ou désactiver CHAT explicitement)  
7. **C3/H5** — diagnostic submit (composer snapshot, reason codes)  
8. **M1** — débloquer `swift test` (xattr/codesign) pour ne pas regresser à l’aveugle  

---

## Périmètre fichiers clés (état actuel)

| Zone | Fichiers |
|------|----------|
| GUI | `Sources/PaneShiftApp/main.swift` (~2006 lignes) |
| CHAT engine | `Sources/PaneShiftCore/{ConversationEngine,Transcript,TranscriptSession,SessionLocator,Diagnostics}.swift` |
| Room | `agent-room.sh`, `agent-memory.sh` |
| Drop | `macos/PaneShiftDropHover.swift` |
| Tests | `tests/PaneShiftCoreTests/*`, `tests/agent_room.test.sh` |

---

## Conclusion

PaneShift n’est plus « un chat qui devine un écran » : le cœur transcript est solide **quand le process CLI est vivant et accepte le paste**. Les pannes restantes sont surtout des **trous d’observabilité et de cycle de vie** (process mort, ack manquant, close d’historique trop agressif, Claude stop_reason, locator Codex).

Corriger C1+C2+C4 débloquerait la majorité des échecs observés ce soir sur la room locale à six agents.
