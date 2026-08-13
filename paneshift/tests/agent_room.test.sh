#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agent-room-test.XXXXXX")"
SESSION="agent-room-test-$$"
SECOND_SESSION="${SESSION}-second"
CONFIG="$TEMP_DIR/agent-room.conf"

cleanup() {
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  tmux kill-session -t "$SECOND_SESSION" 2>/dev/null || true
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT INT TERM

write_config() {
  mkdir -p "$TEMP_DIR/agent-1" "$TEMP_DIR/agent-2" "$TEMP_DIR/agent-3" "$TEMP_DIR/agent-4" "$TEMP_DIR/.agent-context/handoffs"
  cat > "$CONFIG" <<EOF
ROOM_SESSION="$SESSION"
ROOM_TITLE="TEST CONTROL ROOM"
ROOM_ROOT="$TEMP_DIR"
ROOM_HANDOFF_DIR="$TEMP_DIR/.agent-context/handoffs"
ROOM_STATE_DIR="$TEMP_DIR/runtime"
ROOM_MEMORY_HISTORY_LIMIT=4
ROOM_MEMORY_HEARTBEAT_SECONDS=900
ROOM_ALLOW_SHARED_WORKSPACES=0
ROOM_SIDEBAR_WIDTH=24
ROOM_THEME="light"
ROOM_DROP_HOVER=0

AGENT_1_SLOT="agent-1"
AGENT_1_NAME="ROLE-1"
AGENT_1_ROLE="TEST"
AGENT_1_DIR="$TEMP_DIR/agent-1"
AGENT_1_PROVIDER="anthropic"
AGENT_1_ANTHROPIC_COMMAND="sleep 300"
AGENT_1_OPENAI_COMMAND="sleep 300"
AGENT_1_LOCAL_COMMAND=""
AGENT_1_COLOR="colour141"

AGENT_2_SLOT="agent-2"
AGENT_2_NAME="ROLE-2"
AGENT_2_ROLE="TEST"
AGENT_2_DIR="$TEMP_DIR/agent-2"
AGENT_2_PROVIDER="anthropic"
AGENT_2_ANTHROPIC_COMMAND="sleep 300"
AGENT_2_OPENAI_COMMAND="sleep 300"
AGENT_2_LOCAL_COMMAND=""
AGENT_2_COLOR="colour117"

AGENT_3_SLOT="agent-3"
AGENT_3_NAME="ROLE-3"
AGENT_3_ROLE="TEST"
AGENT_3_DIR="$TEMP_DIR/agent-3"
AGENT_3_PROVIDER="openai"
AGENT_3_ANTHROPIC_COMMAND="sleep 300"
AGENT_3_OPENAI_COMMAND="sleep 300"
AGENT_3_LOCAL_COMMAND=""
AGENT_3_COLOR="colour150"

AGENT_4_SLOT="agent-4"
AGENT_4_NAME="ROLE-4"
AGENT_4_ROLE="TEST"
AGENT_4_DIR="$TEMP_DIR/agent-4"
AGENT_4_PROVIDER="openai"
AGENT_4_ANTHROPIC_COMMAND="sleep 300"
AGENT_4_OPENAI_COMMAND="sleep 300"
AGENT_4_LOCAL_COMMAND=""
AGENT_4_COLOR="colour223"
EOF
}

assert_equals() {
  local expected="$1" actual="$2" description="$3"
  if [ "$expected" != "$actual" ]; then
    printf 'FAIL: %s (expected %s, got %s)\n' "$description" "$expected" "$actual" >&2
    exit 1
  fi
}

write_config
"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" --no-attach
tmux list-keys -T copy-mode | rg 'MouseDragEnd1Pane.*copy-pipe-and-cancel' >/dev/null
tmux list-keys -T copy-mode-vi | rg 'MouseDragEnd1Pane.*copy-pipe-and-cancel' >/dev/null
tmux list-keys -T copy-mode | rg 'C-v.*cancel' >/dev/null
tmux list-keys -T root | rg 'M-BSpace.*send-keys C-w' >/dev/null
tmux list-keys -T root | rg 'C-Tab.*next-pane' >/dev/null
tmux list-keys -T root | rg 'C-S-Tab.*previous-pane' >/dev/null
assert_equals 'emacs' "$(tmux show-option -w -p -v -t "$SESSION:agents" mode-keys)" 'copy mode uses familiar editor navigation'
tmux list-keys -T root | rg 'MouseDown1Pane.*select-pane.*mouse_pane.*send-keys -M' >/dev/null
test -x "$PROJECT_DIR/paneshift-hover"
cat > "$TEMP_DIR/.agent-context/handoffs/agent-1.md" <<EOF
# agent-1 handoff

- Status: done
- Task: english handoff status test
EOF
"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" status | rg 'done +english handoff status test' >/dev/null
sidebar_pane="$(tmux list-panes -t "$SESSION:agents" -F '#{pane_id}|#{pane_top}|#{@agent_sidebar}' | awk -F '|' '$3 == 1 { print $1 "|" $2; exit }')"
sidebar_id="${sidebar_pane%%|*}"
sidebar_top="${sidebar_pane#*|}"
"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" sidebar-click "$sidebar_id" "$((sidebar_top + 24))" >/dev/null
"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" sidebar-click "$sidebar_id" "$((sidebar_top + 25))" >/dev/null
"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" sidebar-click "$sidebar_id" "$((sidebar_top + 26))" >/dev/null
"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" sidebar-click "$sidebar_id" "$((sidebar_top + 27))" >/dev/null
"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" sidebar-click "$sidebar_id" "$((sidebar_top + 28))" >/dev/null
test -s "$TEMP_DIR/ARCHITECTURE.md"
test -s "$TEMP_DIR/AGENTS.md"
test -s "$TEMP_DIR/CLAUDE.md"
test -s "$TEMP_DIR/.agent-context/PROJECT_STATE.md"
test -s "$TEMP_DIR/.agent-context/DECISIONS.md"
"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" doctor >/dev/null
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" snapshot-room test
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" doctor >/dev/null

for slot in agent-1 agent-2 agent-3 agent-4; do
  snapshot_count="$(find "$TEMP_DIR/runtime/memory/$slot/runs" -name 'run-*.md' | wc -l | tr -d ' ')"
  [ "$snapshot_count" -ge 1 ] || { printf 'FAIL: first snapshot missing for %s\n' "$slot" >&2; exit 1; }
  test -s "$TEMP_DIR/runtime/memory/$slot/BOOTSTRAP.md"
done

for iteration in 1 2 3 4 5; do
  "$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" snapshot agent-1 "rotation-$iteration"
done
assert_equals '4' "$(find "$TEMP_DIR/runtime/memory/agent-1/runs" -name 'run-*.md' | wc -l | tr -d ' ')" 'run history rotates at four snapshots'

"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" claim agent-1 agent-1 'memory test' >/dev/null
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" claim agent-1 agent-2 'second scope' >/dev/null
assert_equals '2' "$(wc -l < "$TEMP_DIR/runtime/memory/claims.tsv" | tr -d ' ')" 'one role can own multiple precise scopes'
if "$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" claim agent-2 agent-1/subdir 'conflicting test' >/dev/null 2>&1; then
  printf 'FAIL: overlapping memory claims must be rejected\n' >&2
  exit 1
fi
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" release agent-1 agent-2 >/dev/null
assert_equals '1' "$(wc -l < "$TEMP_DIR/runtime/memory/claims.tsv" | tr -d ' ')" 'one precise scope can be released'
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" release agent-1 >/dev/null
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" claim agent-2 agent-1/subdir 'released test' >/dev/null
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" release agent-2 >/dev/null
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" health | rg -q '^4\|4\|4\|0\|0\|'

assert_equals 'anthropic' "$(tmux show-option -p -v -t "$SESSION:agents.0" @agent_provider)" 'configured provider is normalized'
"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" switch 1 openai >/dev/null
assert_equals 'openai' "$(tmux show-option -p -v -t "$SESSION:agents.0" @agent_provider)" 'provider switch updates the pane'
rg -q '^1\topenai$' "$TEMP_DIR/runtime/${SESSION}.providers"
rg -q 'Reason: `provider-switch`' "$TEMP_DIR/runtime/memory/agent-1/runs"/run-*.md
test -s "$(tmux show-option -p -v -t "$SESSION:agents.0" @agent_memory_file)"

tmux respawn-pane -k -t "$SESSION:agents.0" "printf 'Working ('; sleep 300"
if "$PROJECT_DIR/agent-room.sh" --config "$CONFIG" switch 1 anthropic >/dev/null 2>&1; then
  printf 'FAIL: a provider switch must not interrupt a working agent\n' >&2
  exit 1
fi
assert_equals 'openai' "$(tmux show-option -p -v -t "$SESSION:agents.0" @agent_provider)" 'busy agent keeps its current provider'

tmux kill-session -t "$SESSION"
"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" --no-attach
assert_equals 'openai' "$(tmux show-option -p -v -t "$SESSION:agents.0" @agent_provider)" 'provider routing survives a new tmux session'

tmux list-keys -T root | rg 'session_name.*pane-menu' >/dev/null
if "$PROJECT_DIR/agent-room.sh" --config "$CONFIG" model 1 >/dev/null 2>&1; then
  printf 'FAIL: model command must not be part of the public Control Room API\n' >&2
  exit 1
fi

"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" --session "$SECOND_SESSION" --no-attach
"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" --session "$SESSION" focus 1
assert_equals "$SESSION" "$(tmux display-message -p -t "$SESSION:agents" '#{session_name}')" 'first session remains addressable after a second room starts'
assert_equals '1' "$(tmux display-message -p -t "$SESSION:agents" '#{@agent_index}')" 'focus command selects the requested pane'
"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" --session "$SESSION" next-pane
assert_equals '2' "$(tmux display-message -p -t "$SESSION:agents" '#{@agent_index}')" 'next-pane moves one terminal to the right'
"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" --session "$SESSION" previous-pane
assert_equals '1' "$(tmux display-message -p -t "$SESSION:agents" '#{@agent_index}')" 'previous-pane moves one terminal to the left'
swift build --package-path "$PROJECT_DIR" >/dev/null
"$PROJECT_DIR/paneshift-app" --session "$SESSION" --check | rg '1:%.*2:%.*3:%.*4:%' >/dev/null

printf 'agent-room tests: OK\n'
