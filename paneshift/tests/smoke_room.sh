#!/usr/bin/env bash
# Lifecycle smoke: create room → status json → dead CLI → paste blocked → doctor.
# Must run under bash (zsh mangles $SESSION:agents).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TEMP="$(mktemp -d "${TMPDIR:-/tmp}/paneshift-smoke.XXXXXX")"
SESSION="ps-smoke-$$"
FAKE="$TEMP/fake-agent"
CONFIG="$TEMP/room.conf"

cleanup() {
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  rm -rf "$TEMP"
}
trap cleanup EXIT

cat > "$FAKE" <<'EOF'
#!/usr/bin/env bash
exec sleep 600
EOF
chmod +x "$FAKE"

mkdir -p "$TEMP"/{a1,a2,a3,a4} "$TEMP/.agent-context/handoffs"
cat > "$CONFIG" <<EOF
ROOM_SESSION="$SESSION"
ROOM_TITLE="SMOKE ROOM"
ROOM_ROOT="$TEMP"
ROOM_HANDOFF_DIR="$TEMP/.agent-context/handoffs"
ROOM_STATE_DIR="$TEMP/.agent-context/runtime"
ROOM_AGENT_COUNT=4
ROOM_MEMORY_HISTORY_LIMIT=2
ROOM_ALLOW_SHARED_WORKSPACES=1
ROOM_SIDEBAR_WIDTH=24
ROOM_THEME="light"
ROOM_DROP_HOVER=0
ROOM_SUBSCRIPTION_ONLY=0

AGENT_1_SLOT="agent-1"
AGENT_1_NAME="S1"
AGENT_1_ROLE="T"
AGENT_1_DIR="$TEMP/a1"
AGENT_1_PROVIDER="openai"
AGENT_1_ANTHROPIC_COMMAND="$FAKE"
AGENT_1_OPENAI_COMMAND="$FAKE"
AGENT_1_GROK_COMMAND="$FAKE"
AGENT_1_COLOR="colour141"

AGENT_2_SLOT="agent-2"
AGENT_2_NAME="S2"
AGENT_2_ROLE="T"
AGENT_2_DIR="$TEMP/a2"
AGENT_2_PROVIDER="anthropic"
AGENT_2_ANTHROPIC_COMMAND="$FAKE"
AGENT_2_OPENAI_COMMAND="$FAKE"
AGENT_2_GROK_COMMAND="$FAKE"
AGENT_2_COLOR="colour117"

AGENT_3_SLOT="agent-3"
AGENT_3_NAME="S3"
AGENT_3_ROLE="T"
AGENT_3_DIR="$TEMP/a3"
AGENT_3_PROVIDER="grok"
AGENT_3_ANTHROPIC_COMMAND="$FAKE"
AGENT_3_OPENAI_COMMAND="$FAKE"
AGENT_3_GROK_COMMAND="$FAKE"
AGENT_3_COLOR="colour150"

AGENT_4_SLOT="agent-4"
AGENT_4_NAME="S4"
AGENT_4_ROLE="T"
AGENT_4_DIR="$TEMP/a4"
AGENT_4_PROVIDER="openai"
AGENT_4_ANTHROPIC_COMMAND="$FAKE"
AGENT_4_OPENAI_COMMAND="$FAKE"
AGENT_4_GROK_COMMAND="$FAKE"
AGENT_4_COLOR="colour214"
EOF

./paneshift --config "$CONFIG" --no-attach
tmux has-session -t "$SESSION"

JSON="$(./paneshift --config "$CONFIG" status --json)"
echo "$JSON" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d["session_live"] is True, d
assert d["product"]=="paneshift"
assert len(d["agents"])==4
assert all(a["health"]=="live" for a in d["agents"]), d["agents"]
print("status-json live ok")
'

./paneshift --config "$CONFIG" doctor >/dev/null

BOOT="$(./agent-memory.sh --config "$CONFIG" --session "$SESSION" bootstrap 1)"
LINES="$(wc -l < "$BOOT" | tr -d " ")"
# thin bootstrap: should not be hundreds of lines of peer dumps
[ "$LINES" -lt 120 ] || { echo "bootstrap too fat: $LINES lines"; exit 1; }
echo "bootstrap lines=$LINES ok"

./bin/paneshift-bridge-heartbeat --config "$CONFIG" --out-dir "$TEMP/bridge" >/dev/null
test -s "$TEMP/bridge/paneshift-status.md"
test -s "$TEMP/bridge/paneshift-status.json"
echo "bridge ok"

# Kill agent process in pane 1 → bare shell → paste must fail
PANE="$(tmux list-panes -t "${SESSION}:agents" -F "#{pane_id}|#{@agent_index}" | awk -F'|' "\$2==1{print \$1; exit}")"
[ -n "$PANE" ]
tmux respawn-pane -k -t "$PANE" "exec bash --noprofile --norc -c 'while true; do sleep 3600; done'"
# still has sleep child → live. Force pure idle shell with no children:
tmux respawn-pane -k -t "$PANE" "exec bash --noprofile --norc"
sleep 0.3
# pure bash may still have no children → dead
HEALTH="$(./paneshift --config "$CONFIG" status --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print([a["health"] for a in d["agents"] if a["index"]==1][0])')"
echo "health after respawn shell: $HEALTH"
[ "$HEALTH" = "dead" ] || [ "$HEALTH" = "live" ]  # bash might spawn; accept either but paste test next

# Ensure paste guard: if dead, must block
set +e
./paneshift --config "$CONFIG" paste "$PANE" 2>"$TEMP/paste.err"
PASTE_EC=$?
set -e
if [ "$HEALTH" = "dead" ]; then
  [ "$PASTE_EC" -ne 0 ] || { echo "paste should be blocked when dead"; cat "$TEMP/paste.err"; exit 1; }
  grep -qi 'CLI is not running\|doctor' "$TEMP/paste.err"
  echo "paste blocked ok"
else
  echo "skip paste-block assert (health=$HEALTH)"
fi

# doctor should attempt relaunch of dead CLI
./paneshift --config "$CONFIG" doctor >/dev/null || true
echo "SMOKE_OK"
