# OpenClaw ↔ PaneShift bridge

**Status:** read-only bridge available. Write actions later.

## Goal

Telegram (OpenClaw / Napoleon) can **observe** the local coding room without
owning the agents.

```text
Telegram → OpenClaw → paneshift status --json → room state
```

## Status API (B0 — done)

From the PaneShift repo (or any machine with the config):

```bash
./paneshift --config /path/to/agent-room.conf status --json
```

Example fields:

- `session_live` — tmux session up or not  
- `agents[].health` — `live` | `busy` | `dead` | `paused` | `missing`  
- `agents[].task` / `handoff_status`  
- `agents[].provider` / `process`

When the room is down, JSON still returns with `session_live: false` and
`health: missing` per agent.

## OpenClaw bridge (B1 — live)

Napoleon (`personal-ops`) has **exec/read denied** for safety. So the bridge is
a **file mirror**, not a shell tool:

```bash
# one-shot
~/Desktop/02_DEV/PANESHIFT/bin/paneshift-bridge-heartbeat

# every 30s while coding
~/Desktop/02_DEV/PANESHIFT/bin/paneshift-bridge-heartbeat --watch 30
```

Writes (for memory search / Telegram):

- `~/agent-os/personal-ops/memory/paneshift-status.md`
- `~/agent-os/personal-ops/memory/paneshift-status.json`
- `~/agent-os/personal-ops/memory/paneshift-events.md` — transitions only
  (room up/down, live↔dead, live↔busy, …)

`paneshift-local` starts a background `--watch 30` heartbeat by default
(`PANESHIFT_BRIDGE=0` to disable).

`TOOLS.md` / `AGENTS.md` under personal-ops tell Napoleon to **read those files**
when asked about the coding room. No write path to agents yet.

## Later

| Step | Action |
|------|--------|
| B2.1 | optional active Telegram push (not just file) on dead |
| B3 | pause / resume / short send with Telegram confirm + allowlist |
