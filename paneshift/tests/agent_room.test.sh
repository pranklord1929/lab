#!/usr/bin/env bash

set -euo pipefail

# The test exercises bindings, not the host clipboard. Headless Linux runners
# do not ship a clipboard command, so provide inert Bash functions there.
if ! command -v pbcopy >/dev/null 2>&1 || ! command -v pbpaste >/dev/null 2>&1; then
  pbcopy() { :; }
  pbpaste() { :; }
  export -f pbcopy pbpaste
fi

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
  mkdir -p "$TEMP_DIR/agent-1" "$TEMP_DIR/agent-2" "$TEMP_DIR/agent-3" "$TEMP_DIR/agent-4" "$TEMP_DIR/agent-5" "$TEMP_DIR/agent-6" "$TEMP_DIR/.agent-context/handoffs"
  cat > "$TEMP_DIR/fake-agent" <<'FAKE_AGENT'
#!/usr/bin/env bash
sleep 300
FAKE_AGENT
  chmod +x "$TEMP_DIR/fake-agent"
  cat > "$CONFIG" <<EOF
ROOM_SESSION="$SESSION"
ROOM_TITLE="TEST CONTROL ROOM"
ROOM_ROOT="$TEMP_DIR"
ROOM_HANDOFF_DIR="$TEMP_DIR/.agent-context/handoffs"
ROOM_STATE_DIR="$TEMP_DIR/.agent-context/runtime"
ROOM_AGENT_COUNT=6
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
AGENT_1_ANTHROPIC_COMMAND="$TEMP_DIR/fake-agent"
AGENT_1_OPENAI_COMMAND="$TEMP_DIR/fake-agent"
AGENT_1_GROK_COMMAND="$TEMP_DIR/fake-agent"
AGENT_1_LOCAL_COMMAND=""
AGENT_1_COLOR="colour141"

AGENT_2_SLOT="agent-2"
AGENT_2_NAME="ROLE-2"
AGENT_2_ROLE="TEST"
AGENT_2_DIR="$TEMP_DIR/agent-2"
AGENT_2_PROVIDER="openai"
AGENT_2_ANTHROPIC_COMMAND="$TEMP_DIR/fake-agent"
AGENT_2_OPENAI_COMMAND="$TEMP_DIR/fake-agent"
AGENT_2_GROK_COMMAND="$TEMP_DIR/fake-agent"
AGENT_2_LOCAL_COMMAND=""
AGENT_2_COLOR="colour117"

AGENT_3_SLOT="agent-3"
AGENT_3_NAME="ROLE-3"
AGENT_3_ROLE="TEST"
AGENT_3_DIR="$TEMP_DIR/agent-3"
AGENT_3_PROVIDER="grok"
AGENT_3_ANTHROPIC_COMMAND="$TEMP_DIR/fake-agent"
AGENT_3_OPENAI_COMMAND="$TEMP_DIR/fake-agent"
AGENT_3_GROK_COMMAND="$TEMP_DIR/fake-agent"
AGENT_3_LOCAL_COMMAND=""
AGENT_3_COLOR="colour150"

AGENT_4_SLOT="agent-4"
AGENT_4_NAME="ROLE-4"
AGENT_4_ROLE="TEST"
AGENT_4_DIR="$TEMP_DIR/agent-4"
AGENT_4_PROVIDER="anthropic"
AGENT_4_ANTHROPIC_COMMAND="$TEMP_DIR/fake-agent"
AGENT_4_OPENAI_COMMAND="$TEMP_DIR/fake-agent"
AGENT_4_GROK_COMMAND="$TEMP_DIR/fake-agent"
AGENT_4_LOCAL_COMMAND=""
AGENT_4_COLOR="colour223"

AGENT_5_SLOT="agent-5"
AGENT_5_NAME="ROLE-5"
AGENT_5_ROLE="TEST"
AGENT_5_DIR="$TEMP_DIR/agent-5"
AGENT_5_PROVIDER="openai"
AGENT_5_ANTHROPIC_COMMAND="$TEMP_DIR/fake-agent"
AGENT_5_OPENAI_COMMAND="$TEMP_DIR/fake-agent"
AGENT_5_GROK_COMMAND="$TEMP_DIR/fake-agent"
AGENT_5_LOCAL_COMMAND=""
AGENT_5_COLOR="colour186"

AGENT_6_SLOT="agent-6"
AGENT_6_NAME="ROLE-6"
AGENT_6_ROLE="TEST"
AGENT_6_DIR="$TEMP_DIR/agent-6"
AGENT_6_PROVIDER="grok"
AGENT_6_ANTHROPIC_COMMAND="$TEMP_DIR/fake-agent"
AGENT_6_OPENAI_COMMAND="$TEMP_DIR/fake-agent"
AGENT_6_GROK_COMMAND="$TEMP_DIR/fake-agent"
AGENT_6_LOCAL_COMMAND=""
AGENT_6_COLOR="colour214"
EOF
}

assert_equals() {
  local expected="$1" actual="$2" description="$3"
  if [ "$expected" != "$actual" ]; then
    printf 'FAIL: %s (expected %s, got %s)\n' "$description" "$expected" "$actual" >&2
    exit 1
  fi
}

assert_no_memory_temps() {
  local leftovers attempt=0
  while [ "$attempt" -lt 20 ]; do
    leftovers="$(find "$TEMP_DIR/.agent-context/runtime/memory" -maxdepth 2 -type f \
      \( -name '.room-state.*' -o -name '.bootstrap.*' -o -name '.snapshot.*' -o -name '.claims.*' \) \
      -print 2>/dev/null)"
    [ -n "$leftovers" ] || return 0
    attempt=$((attempt + 1))
    sleep 0.05
  done
  if [ -n "$leftovers" ]; then
    printf 'FAIL: memory commands left temporary files behind:\n%s\n' "$leftovers" >&2
    exit 1
  fi
}

write_config
"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" --no-attach
tmux list-keys -T copy-mode | grep -E 'MouseDragEnd1Pane.*copy-pipe-and-cancel' >/dev/null
tmux list-keys -T copy-mode-vi | grep -E 'MouseDragEnd1Pane.*copy-pipe-and-cancel' >/dev/null
tmux list-keys -T copy-mode | grep -E 'C-v.*cancel' >/dev/null
tmux list-keys -T root | grep -E 'M-BSpace.*send-keys C-w' >/dev/null
tmux list-keys -T root | grep -E 'C-Tab.*next-pane' >/dev/null
tmux list-keys -T root | grep -E 'C-S-Tab.*previous-pane' >/dev/null
assert_equals 'emacs' "$(tmux show-option -w -p -v -t "$SESSION:agents" mode-keys)" 'copy mode uses familiar editor navigation'
tmux list-keys -T root | grep -E 'MouseDown1Pane.*select-pane.*mouse_pane.*send-keys -M' >/dev/null
test -x "$PROJECT_DIR/paneshift-hover"
cat > "$TEMP_DIR/.agent-context/handoffs/agent-1.md" <<EOF
# agent-1 handoff

- Status: done
- Task: english handoff status test
- Reserved scope: none
EOF
"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" status | grep -E 'done +english handoff status test' >/dev/null
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
assert_no_memory_temps

# `file_epoch` must work with both GNU stat (`-c`) and BSD/macOS stat (`-f`).
# Exercise each branch through the public health command so an invalid or
# multi-line epoch also fails the arithmetic that consumes it.
REAL_STAT="$(command -v stat)"
for stat_style in gnu bsd; do
  stat_bin="$TEMP_DIR/stat-$stat_style"
  mkdir -p "$stat_bin"
  cat > "$stat_bin/stat" <<EOF
#!/usr/bin/env bash
case "$stat_style:\${1:-}" in
  gnu:-c) exec "$REAL_STAT" "\$@" ;;
  gnu:-f) exit 1 ;;
  bsd:-c) exit 1 ;;
  bsd:-f) printf '%s\n' "\$(date +%s)" ;;
  *) exec "$REAL_STAT" "\$@" ;;
esac
EOF
  chmod +x "$stat_bin/stat"
  PATH="$stat_bin:$PATH" "$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" health |
    grep -Eq '^[0-9]+\|6\|[0-9]+\|[0-9]+\|[0-9]+\|[^|]+\|[0-9]+$'
done

# Snapshot writers may overlap (heartbeat, detach and manual sync). Their
# published files must remain complete and their atomic temp files cleaned.
snapshot_pids=''
for iteration in 1 2 3 4 5 6 7 8; do
  "$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" snapshot agent-1 "concurrent-$iteration" &
  snapshot_pids="$snapshot_pids $!"
done
for snapshot_pid in $snapshot_pids; do wait "$snapshot_pid"; done
assert_equals '4' "$(find "$TEMP_DIR/.agent-context/runtime/memory/agent-1/runs" -name 'run-*.md' | wc -l | tr -d ' ')" 'concurrent run history rotates at four snapshots'
for snapshot_file in "$TEMP_DIR/.agent-context/runtime/memory/agent-1/runs"/run-*.md; do
  grep -Eq '^# Run snapshot' "$snapshot_file"
  grep -Eq '^## Git context' "$snapshot_file"
done
cmp -s "$TEMP_DIR/.agent-context/runtime/memory/agent-1/latest.md" "$TEMP_DIR/.agent-context/runtime/memory/agent-1/runs/$(basename "$(ls -1t "$TEMP_DIR/.agent-context/runtime/memory/agent-1/runs"/run-*.md | head -1)")"
assert_no_memory_temps

for slot in agent-1 agent-2 agent-3 agent-4 agent-5 agent-6; do
  snapshot_count="$(find "$TEMP_DIR/.agent-context/runtime/memory/$slot/runs" -name 'run-*.md' | wc -l | tr -d ' ')"
  [ "$snapshot_count" -ge 1 ] || { printf 'FAIL: first snapshot missing for %s\n' "$slot" >&2; exit 1; }
  test -s "$TEMP_DIR/.agent-context/runtime/memory/$slot/BOOTSTRAP.md"
done

# A checkpoint is the semantic handoff boundary: reject malformed handoffs,
# then atomically snapshot, rebuild the bootstrap and journal the milestone.
cp "$TEMP_DIR/.agent-context/handoffs/agent-2.md" "$TEMP_DIR/agent-2.handoff.backup"
printf '# invalid handoff\n\n- Status: working\n' > "$TEMP_DIR/.agent-context/handoffs/agent-2.md"
if "$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" validate agent-2 >/dev/null 2>&1; then
  printf 'FAIL: handoff validation accepted missing task and scope\n' >&2
  exit 1
fi
mv "$TEMP_DIR/agent-2.handoff.backup" "$TEMP_DIR/.agent-context/handoffs/agent-2.md"
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" validate agent-2
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" checkpoint agent-2 test-milestone
grep -Eq 'Reason: `test-milestone`' "$TEMP_DIR/.agent-context/runtime/memory/agent-2/latest.md"
test -s "$TEMP_DIR/.agent-context/runtime/memory/agent-2/BOOTSTRAP.md"
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" events 20 | grep -Fq $'checkpoint\tagent-2\t'
assert_equals '2' "$("$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" events 2 | wc -l | tr -d ' ')" 'event journal honors requested limit'

# Portable exports include durable and live memory, carry a checksum, and can
# restore a later local mutation. A bad checksum must fail before extraction.
memory_archive="$TEMP_DIR/portable-memory.tar.gz"
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" export "$memory_archive" >/dev/null
test -s "$memory_archive"
test -s "$memory_archive.sha256"
cp "$TEMP_DIR/.agent-context/handoffs/agent-3.md" "$TEMP_DIR/agent-3.exported-handoff"
printf '\nLOCAL MUTATION AFTER EXPORT\n' >> "$TEMP_DIR/.agent-context/handoffs/agent-3.md"
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" import "$memory_archive"
cmp -s "$TEMP_DIR/agent-3.exported-handoff" "$TEMP_DIR/.agent-context/handoffs/agent-3.md"
cp "$memory_archive.sha256" "$TEMP_DIR/portable-memory.good.sha256"
printf '0000  %s\n' "$(basename "$memory_archive")" > "$memory_archive.sha256"
if "$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" import "$memory_archive" >/dev/null 2>&1; then
  printf 'FAIL: memory import accepted a checksum mismatch\n' >&2
  exit 1
fi
mv "$TEMP_DIR/portable-memory.good.sha256" "$memory_archive.sha256"
assert_no_memory_temps

for iteration in 1 2 3 4 5; do
  "$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" snapshot agent-1 "rotation-$iteration"
done
assert_equals '4' "$(find "$TEMP_DIR/.agent-context/runtime/memory/agent-1/runs" -name 'run-*.md' | wc -l | tr -d ' ')" 'run history rotates at four snapshots'

"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" claim agent-1 agent-1 'memory test' >/dev/null
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" claim agent-1 agent-2 'second scope' >/dev/null
assert_equals '2' "$(wc -l < "$TEMP_DIR/.agent-context/runtime/memory/claims.tsv" | tr -d ' ')" 'one role can own multiple precise scopes'
if "$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" claim agent-2 agent-1/subdir 'conflicting test' >/dev/null 2>&1; then
  printf 'FAIL: overlapping memory claims must be rejected\n' >&2
  exit 1
fi
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" release agent-1 agent-2 >/dev/null
assert_equals '1' "$(wc -l < "$TEMP_DIR/.agent-context/runtime/memory/claims.tsv" | tr -d ' ')" 'one precise scope can be released'
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" release agent-1 >/dev/null
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" claim agent-2 agent-1/subdir 'released test' >/dev/null
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" release agent-2 >/dev/null
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" health | grep -Eq '^6\|6\|6\|0\|0\|'

# Equivalent paths must map to one canonical claim. A second role cannot evade
# an existing reservation with duplicate separators, `.` or `..` components.
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" claim agent-1 'web/src/lib' 'canonical claim' >/dev/null
for equivalent_scope in './web/src/lib/' 'web//src/lib' 'web/src/./lib' 'web/src/components/../lib'; do
  if "$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" claim agent-2 "$equivalent_scope" 'canonical collision' >/dev/null 2>&1; then
    printf 'FAIL: equivalent claim path bypassed collision detection: %s\n' "$equivalent_scope" >&2
    exit 1
  fi
done
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" release agent-1 >/dev/null

# Claims are leases, not permanent locks. The registry records an expiry and
# session owner, and an expired reservation is pruned before the next claim.
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" claim agent-1 'scripts/leased' 'lease test' >/dev/null
claim_now="$(date +%s)"
awk -F '\t' -v now="$claim_now" '
  BEGIN { OFS="\t" }
  $2 == "scripts/leased" { $5=now-1 }
  { print }
' "$TEMP_DIR/.agent-context/runtime/memory/claims.tsv" > "$TEMP_DIR/.agent-context/runtime/memory/claims.expired"
mv "$TEMP_DIR/.agent-context/runtime/memory/claims.expired" "$TEMP_DIR/.agent-context/runtime/memory/claims.tsv"
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" claim agent-2 'scripts/leased/child' 'expired lease takeover' >/dev/null
assert_equals 'agent-2' "$(awk -F '\t' '$2 == "scripts/leased/child" { print $1 }' "$TEMP_DIR/.agent-context/runtime/memory/claims.tsv")" 'expired claim no longer blocks another role'
awk -F '\t' '$2 == "scripts/leased/child" && $5 > $4 && $6 != "" { found=1 } END { exit !found }' "$TEMP_DIR/.agent-context/runtime/memory/claims.tsv"
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" release agent-2 >/dev/null

assert_equals 'anthropic' "$(tmux show-option -p -v -t "$SESSION:agents.0" @agent_provider)" 'configured provider is normalized'

# Terminal context is useful but untrusted: common credentials are redacted,
# and projects can disable terminal capture entirely.
tmux respawn-pane -k -t "$SESSION:agents.0" "printf 'API_KEY=super-secret-value\\nAuthorization: Bearer bearer-secret-value\\n'; sleep 300"
sleep 0.1
"$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" snapshot agent-1 redaction-test
redacted_snapshot="$(ls -1t "$TEMP_DIR/.agent-context/runtime/memory/agent-1/runs"/run-*.md | head -1)"
grep -Eq '\[REDACTED\]' "$redacted_snapshot"
if grep -Eq 'super-secret-value|bearer-secret-value' "$redacted_snapshot"; then
  printf 'FAIL: terminal snapshot persisted an unredacted credential\n' >&2
  exit 1
fi
ROOM_MEMORY_CAPTURE_TERMINAL=0 "$PROJECT_DIR/agent-memory.sh" --config "$CONFIG" snapshot agent-1 capture-opt-out
opt_out_snapshot="$(ls -1t "$TEMP_DIR/.agent-context/runtime/memory/agent-1/runs"/run-*.md | head -1)"
grep -Eq 'Terminal capture disabled by ROOM_MEMORY_CAPTURE_TERMINAL' "$opt_out_snapshot"
if grep -Eq 'super-secret-value|bearer-secret-value' "$opt_out_snapshot"; then
  printf 'FAIL: terminal opt-out still captured pane contents\n' >&2
  exit 1
fi

"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" switch 1 openai >/dev/null
assert_equals 'openai' "$(tmux show-option -p -v -t "$SESSION:agents.0" @agent_provider)" 'provider switch updates the pane'
grep -Eq $'^1\topenai$' "$TEMP_DIR/.agent-context/runtime/${SESSION}.providers"
grep -Eq 'Reason: `provider-switch`' "$TEMP_DIR/.agent-context/runtime/memory/agent-1/runs"/run-*.md
test -s "$(tmux show-option -p -v -t "$SESSION:agents.0" @agent_memory_file)"

# Both the native GUI and the tmux model menu call `switch <index> <provider>
# <model>`. The dispatcher used to drop the fourth argument, so picking a model
# silently relaunched the previous one while the confirmation claimed otherwise.
"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" switch 1 openai gpt-5-codex >/dev/null
assert_equals 'gpt-5-codex' "$(tmux show-option -p -v -t "$SESSION:agents.0" @agent_model)" 'switch honours the requested model'
grep -Eq $'^1\topenai\tgpt-5-codex$' "$TEMP_DIR/.agent-context/runtime/${SESSION}.models"

# Status-bar cells: six agents occupy Control0..Control5, so the two room-wide
# buttons must sit after them. They used to be pinned to Control4/Control5 and
# overwrote the cells of agents 5 and 6.
tmux list-keys -T root | grep -Eq 'MouseDown1Control5 .*pane-menu'
tmux list-keys -T root | grep -Eq 'MouseDown1Control6 .*providers-menu'
tmux list-keys -T root | grep -Eq 'MouseDown1Control7 .*reset-layout'

# An idle CLI that merely redraws — a live token counter, a clock, a blinking
# cursor — must not read as busy. Comparing two captures 300 ms apart used to
# call this "working" and refuse legitimate provider and model changes.
cat > "$TEMP_DIR/redrawing-agent" <<'REDRAW'
#!/usr/bin/env bash
count=0
while :; do
  count=$((count + 1))
  printf '\r%s tokens left' "$count"
  sleep 0.1
done
REDRAW
chmod +x "$TEMP_DIR/redrawing-agent"
# Resolve agent 2's pane by its recorded index: tmux pane order is not the agent
# order once the sidebar is installed.
redraw_pane="$(tmux list-panes -t "$SESSION:agents" -F '#{@agent_index}|#{pane_id}' | awk -F '|' '$1 == 2 { print $2; exit }')"
test -n "$redraw_pane"
tmux respawn-pane -k -t "$redraw_pane" "$TEMP_DIR/redrawing-agent"
sleep 0.5
"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" switch 2 grok >/dev/null
assert_equals 'grok' "$(tmux show-option -p -v -t "$redraw_pane" @agent_provider)" 'an idle but redrawing terminal does not block a switch'

# A provider switch is destructive, so it must be fail-closed: if the memory
# engine cannot checkpoint the current run, keep both the pane and provider.
cat > "$TEMP_DIR/failing-memory" <<'EOF'
#!/usr/bin/env bash
printf 'injected memory failure\n' >&2
exit 73
EOF
chmod +x "$TEMP_DIR/failing-memory"
provider_before_failure="$(tmux show-option -p -v -t "$SESSION:agents.0" @agent_provider)"
pane_pid_before_failure="$(tmux display-message -p -t "$SESSION:agents.0" '#{pane_pid}')"
if ROOM_MEMORY_SCRIPT="$TEMP_DIR/failing-memory" "$PROJECT_DIR/agent-room.sh" --config "$CONFIG" switch 1 anthropic >/dev/null 2>&1; then
  printf 'FAIL: provider switch succeeded without a durable memory checkpoint\n' >&2
  exit 1
fi
assert_equals "$provider_before_failure" "$(tmux show-option -p -v -t "$SESSION:agents.0" @agent_provider)" 'failed checkpoint keeps provider routing'
assert_equals "$pane_pid_before_failure" "$(tmux display-message -p -t "$SESSION:agents.0" '#{pane_pid}')" 'failed checkpoint keeps current pane alive'

tmux respawn-pane -k -t "$SESSION:agents.0" "printf 'Working ('; sleep 300"
if "$PROJECT_DIR/agent-room.sh" --config "$CONFIG" switch 1 anthropic >/dev/null 2>&1; then
  printf 'FAIL: a provider switch must not interrupt a working agent\n' >&2
  exit 1
fi
assert_equals 'openai' "$(tmux show-option -p -v -t "$SESSION:agents.0" @agent_provider)" 'busy agent keeps its current provider'

tmux kill-session -t "$SESSION"
"$PROJECT_DIR/agent-room.sh" --config "$CONFIG" --no-attach
assert_equals 'openai' "$(tmux show-option -p -v -t "$SESSION:agents.0" @agent_provider)" 'provider routing survives a new tmux session'

tmux list-keys -T root | grep -E 'session_name.*pane-menu' >/dev/null
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
if command -v swift >/dev/null 2>&1; then
  swift build --package-path "$PROJECT_DIR" >/dev/null
  "$PROJECT_DIR/paneshift-app" --session "$SESSION" --check --no-update | grep -E '1:%.*2:%.*3:%.*4:%.*5:%.*6:%' >/dev/null
else
  printf 'SKIP: Swift toolchain unavailable; native app build runs on macOS\n'
fi

printf 'agent-room tests: OK\n'
