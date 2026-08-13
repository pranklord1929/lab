# PaneShift — source of truth

One page. If something conflicts with this file, this file wins until updated.

## Product

Local **control room** for multi-agent coding. Roles in a grid; providers are
routed CLIs you already auth (Claude Code, Codex, Grok). Git + the repo are the
source of truth for code — not chat history and not memory MD.

## Runtime flow

```text
agent-room.conf
      │
      ▼
paneshift / agent-room.sh
      │  creates/joins tmux session :agents
      │  one pane per role (AGENT_N_*)
      ▼
provider CLI in pane  ──transcript JSONL──►  PaneShiftCore (CHAT)
      │                                           │
      │                                           ▼
      │                                    PaneShiftApp (Swift UI)
      │
      └── agent-memory.sh (optional context)
              handoffs/ + latest.md + claims
              BOOTSTRAP.md → $AGENT_MEMORY_FILE at launch
```

## Sources of truth (priority)

| Concern | Authority |
|---------|-----------|
| Code, commits, branches | **Git / worktree** |
| What the agent said / is doing in chat | **Provider transcript** (not tmux screen scrape) |
| Current task / status per role | **`.agent-context/handoffs/<slot>.md`** |
| File/dir exclusivity | **claims.tsv** via `agent-memory.sh claim` |
| Who runs which CLI | **tmux pane state** + provider routing file |

## Memory MD (intentionally thin)

**Keep**

- one handoff file per slot
- `latest.md` (last snapshot) + few run files
- claims
- short `BOOTSTRAP.md` rebuilt at launch (team table + own handoff + last context)

**Do not**

- re-inject empty PROJECT_STATE / DECISIONS into every bootstrap
- dump every peer handoff in full into every agent
- grow a second “brain” (event bus / vector vault) until the room is reliable

`PROJECT_STATE.md` / `DECISIONS.md` stay optional human notes — only included in
bootstrap if they contain real content beyond the template.

## OpenClaw / Telegram (planned bridge)

```text
Telegram → OpenClaw (Napoleon) → paneshift status --json (read-only first)
```

OpenClaw observes the room; it does not replace tmux or own the agents.
Write actions (pause / send) are later, allowlisted, confirmed.

## Verify

```bash
# full suite (bash required)
npm run verify
# or
bash scripts/verify.sh
```

Uses `/tmp` for Swift tests (Desktop xattr breaks codesign).

## Non-goals (now)

- Cloud multiplayer / Slack-first harness (see YC QM for that shape elsewhere)
- Semantic retrieval daemon
- Merging OpenClaw into agent-room.sh
