#!/usr/bin/env python3
"""Convert paneshift status --json to Markdown, and optionally emit transition events."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def load_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def agent_key(agent: dict[str, Any]) -> str:
    return str(agent.get("slot") or agent.get("index") or agent.get("name") or "?")


def health_map(data: dict[str, Any] | None) -> dict[str, str]:
    if not data:
        return {}
    out: dict[str, str] = {}
    for agent in data.get("agents") or []:
        out[agent_key(agent)] = str(agent.get("health") or "?")
    out["__session_live__"] = "1" if data.get("session_live") else "0"
    return out


def interesting_transition(old: str | None, new: str) -> bool:
    """Only surface transitions Jules would care about on Telegram."""
    if old is None:
        return new in ("dead", "busy", "missing") and new != "missing"
    if old == new:
        return False
    # noise: missing <-> dead when room toggles is still useful as room down
    notable = {
        ("live", "dead"),
        ("busy", "dead"),
        ("live", "busy"),
        ("busy", "live"),
        ("dead", "live"),
        ("paused", "live"),
        ("live", "paused"),
        ("dead", "paused"),
        ("missing", "live"),
        ("live", "missing"),
        ("0", "1"),  # session
        ("1", "0"),
    }
    return (old, new) in notable


def render_md(data: dict[str, Any]) -> str:
    agents = data.get("agents") or []
    live = bool(data.get("session_live"))
    lines = [
        "# PaneShift status",
        "",
        f"- Updated: {data.get('generated_at', '?')} UTC",
        f"- Session: `{data.get('session', '?')}`",
        f"- Room live: **{'yes' if live else 'no'}**",
        f"- Config: `{data.get('config', '?')}`",
        "",
        "## Agents",
        "",
        "| # | Name | Provider | Health | Task |",
        "|---|------|----------|--------|------|",
    ]
    for agent in agents:
        task = (agent.get("task") or "—").replace("|", "/")
        lines.append(
            "| {index} | {name} | {provider} | **{health}** | {task} |".format(
                index=agent.get("index"),
                name=agent.get("name"),
                provider=agent.get("provider") or "—",
                health=agent.get("health"),
                task=task,
            )
        )

    dead = [a for a in agents if a.get("health") in ("dead", "missing")]
    busy = [a for a in agents if a.get("health") == "busy"]
    lines += ["", "## Summary", ""]
    if not agents:
        lines.append("- No agent rows (room down or empty config).")
    else:
        lines.append(f"- {len(agents)} agents configured.")
        if busy:
            lines.append("- Busy: " + ", ".join(a.get("name", "?") for a in busy))
        if dead:
            lines.append(
                "- Need attention: "
                + ", ".join(f"{a.get('name')} ({a.get('health')})" for a in dead)
            )
        if not busy and not dead and live:
            lines.append("- All configured panes look idle/live.")
    lines += [
        "",
        "_Source: `paneshift status --json` via paneshift-bridge-heartbeat (read-only)._",
        "_Events: see `paneshift-events.md` for recent health transitions._",
    ]
    return "\n".join(lines)


def append_events(
    prev: dict[str, Any] | None,
    cur: dict[str, Any],
    events_path: Path,
    keep: int = 40,
) -> list[str]:
    old = health_map(prev)
    new = health_map(cur)
    stamp = cur.get("generated_at") or "?"
    emitted: list[str] = []

    # session transition
    o_sess, n_sess = old.get("__session_live__"), new.get("__session_live__")
    if interesting_transition(o_sess, n_sess or "0"):
        if n_sess == "1":
            emitted.append(f"- {stamp} · **room up** (`{cur.get('session')}`)")
        else:
            emitted.append(f"- {stamp} · **room down** (`{cur.get('session')}`)")

    names = {
        agent_key(a): str(a.get("name") or agent_key(a)) for a in (cur.get("agents") or [])
    }
    for key, nh in new.items():
        if key == "__session_live__":
            continue
        oh = old.get(key)
        if interesting_transition(oh, nh):
            label = names.get(key, key)
            emitted.append(f"- {stamp} · **{label}**: `{oh or '—'} → {nh}`")

    if not emitted:
        return []

    existing: list[str] = []
    if events_path.is_file():
        existing = [
            ln
            for ln in events_path.read_text(encoding="utf-8").splitlines()
            if ln.startswith("- ")
        ]
    merged = (emitted + existing)[:keep]
    body = [
        "# PaneShift events",
        "",
        "Recent health transitions (newest first). Read-only bridge for OpenClaw.",
        "",
        *merged,
        "",
    ]
    events_path.write_text("\n".join(body), encoding="utf-8")
    return emitted


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: paneshift-status-to-md.py <status.json> [out.md] [prev.json] [events.md]", file=sys.stderr)
        return 2

    status_path = Path(sys.argv[1])
    out_md = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    prev_path = Path(sys.argv[3]) if len(sys.argv) > 3 else None
    events_path = Path(sys.argv[4]) if len(sys.argv) > 4 else None

    data = load_json(status_path)
    if not data:
        text = "# PaneShift status\n\n_unavailable: invalid json_\n"
        if out_md:
            out_md.write_text(text, encoding="utf-8")
        else:
            print(text, end="")
        return 0

    prev = load_json(prev_path) if prev_path else None
    if events_path is not None:
        append_events(prev, data, events_path)

    text = render_md(data)
    if out_md:
        out_md.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
