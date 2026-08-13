#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${AGENT_ROOM_CONFIG:-$SCRIPT_DIR/agent-room.conf}"
SESSION_OVERRIDE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --config) CONFIG="${2:?missing configuration}"; shift 2 ;;
    --session) SESSION_OVERRIDE="${2:?missing session name}"; shift 2 ;;
    *) break ;;
  esac
done

[ -f "$CONFIG" ] || { printf 'agent-memory: configuration not found: %s\n' "$CONFIG" >&2; exit 1; }
CONFIG="$(cd "$(dirname "$CONFIG")" && pwd)/$(basename "$CONFIG")"
CONFIG_DIR="$(dirname "$CONFIG")"
# shellcheck source=/dev/null
source "$CONFIG"

ROOM_SESSION="${SESSION_OVERRIDE:-${ROOM_SESSION:-agent-room}}"
ROOM_ROOT="${ROOM_ROOT:-$CONFIG_DIR}"
ROOM_HANDOFF_DIR="${ROOM_HANDOFF_DIR:-$ROOM_ROOT/.agent-context/handoffs}"
ROOM_STATE_DIR="${ROOM_STATE_DIR:-$ROOM_ROOT/.agent-context/runtime}"
MEMORY_ROOT="${ROOM_MEMORY_DIR:-$ROOM_STATE_DIR/memory}"
ROOM_AGENT_COUNT="${ROOM_AGENT_COUNT:-4}"
# Thin memory: few run files; bootstrap stays short (see ARCHITECTURE.md).
MEMORY_HISTORY_LIMIT="${ROOM_MEMORY_HISTORY_LIMIT:-2}"
MEMORY_HEARTBEAT_SECONDS="${ROOM_MEMORY_HEARTBEAT_SECONDS:-900}"
MEMORY_BOOTSTRAP_PEER_LINES="${ROOM_MEMORY_BOOTSTRAP_PEER_LINES:-1}"
MEMORY_BOOTSTRAP_RUN_HEAD="${ROOM_MEMORY_BOOTSTRAP_RUN_HEAD:-12}"
MEMORY_WORKING_FRESH_SECONDS="${ROOM_MEMORY_WORKING_FRESH_SECONDS:-1800}"
MEMORY_IDLE_FRESH_SECONDS="${ROOM_MEMORY_IDLE_FRESH_SECONDS:-86400}"
MEMORY_CLAIM_LEASE_SECONDS="${ROOM_MEMORY_CLAIM_LEASE_SECONDS:-14400}"
MEMORY_LOCK_TTL_SECONDS="${ROOM_MEMORY_LOCK_TTL_SECONDS:-300}"
MEMORY_CAPTURE_TERMINAL="${ROOM_MEMORY_CAPTURE_TERMINAL:-1}"
MEMORY_SCHEMA_VERSION="2"
CLAIMS_FILE="$MEMORY_ROOT/claims.tsv"
STATE_FILE="$MEMORY_ROOT/room-state.tsv"
EVENTS_FILE="$MEMORY_ROOT/events.tsv"
SCHEMA_FILE="$MEMORY_ROOT/schema-version"
LOCK_DIR="$MEMORY_ROOT/.claims.lock"
ROOM_LOCK_DIR="$MEMORY_ROOT/.snapshot-room.lock"
STATE_LOCK_DIR="$MEMORY_ROOT/.room-state.lock"
ACTIVE_LOCKS=''
TEMP_FILES=''
TEMP_DIRS=''

cleanup_runtime() {
  local item
  for item in $TEMP_FILES; do rm -f "$item" 2>/dev/null || true; done
  for item in $TEMP_DIRS; do rm -rf "$item" 2>/dev/null || true; done
  for item in $ACTIVE_LOCKS; do rm -rf "$item" 2>/dev/null || true; done
}
trap cleanup_runtime EXIT
trap 'exit 130' INT TERM HUP

die() {
  printf 'agent-memory: %s\n' "$*" >&2
  exit 1
}

agent_value() {
  local index="$1" field="$2"
  eval "printf '%s' \"\${AGENT_${index}_${field}:-}\""
}

agent_indices() {
  seq 1 "$ROOM_AGENT_COUNT"
}

valid_agent_index() {
  case "${1:-}" in ''|*[!0-9]*) return 1 ;; esac
  [ "$1" -ge 1 ] && [ "$1" -le "$ROOM_AGENT_COUNT" ]
}

resolve_index() {
  local requested="${1:-}" index
  if valid_agent_index "$requested"; then printf '%s\n' "$requested"; return; fi
  for index in $(agent_indices); do
    if [ "$requested" = "$(agent_value "$index" SLOT)" ] || [ "$requested" = "$(agent_value "$index" NAME)" ]; then
      printf '%s\n' "$index"
      return
    fi
  done
  return 1
}

normalise_provider() {
  case "${1:-}" in
    anthropic|claude) printf 'anthropic' ;;
    openai|codex) printf 'openai' ;;
    grok|xai) printf 'grok' ;;
    local) printf 'local' ;;
    *) printf 'unknown' ;;
  esac
}

pane_for_index() {
  local index="$1"
  tmux list-panes -t "$ROOM_SESSION:agents" -F '#{@agent_index}|#{pane_id}' 2>/dev/null |
    awk -F '|' -v wanted="$index" '$1 == wanted { print $2; exit }'
}

provider_for_index() {
  local index="$1" pane provider state_file
  pane="$(pane_for_index "$index")"
  if [ -n "$pane" ]; then
    provider="$(tmux show-option -p -v -t "$pane" @agent_provider 2>/dev/null || true)"
  fi
  if [ -z "${provider:-}" ]; then
    state_file="$ROOM_STATE_DIR/$(printf '%s' "$ROOM_SESSION" | tr -cs '[:alnum:]_.-' '_').providers"
    [ ! -f "$state_file" ] || provider="$(awk -F '\t' -v wanted="$index" '$1 == wanted { print $2; exit }' "$state_file")"
  fi
  [ -n "${provider:-}" ] || provider="$(agent_value "$index" PROVIDER)"
  normalise_provider "$provider"
}

handoff_file() {
  printf '%s/%s.md' "$ROOM_HANDOFF_DIR" "$(agent_value "$1" SLOT)"
}

handoff_field() {
  local file="$1" field="$2"
  [ -f "$file" ] || return 0
  case "$field" in
    status) sed -nE 's/^- (Statut|Status)[ ]*:[ ]*//p' "$file" | head -1 ;;
    task) sed -nE 's/^- (Tâche|Task)[ ]*:[ ]*//p' "$file" | head -1 ;;
    scope) sed -nE 's/^- (Périmètre réservé|Reserved scope)[ ]*:[ ]*//p' "$file" | head -1 ;;
  esac
}

file_epoch() {
  [ -e "$1" ] || { printf '0'; return; }
  stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1" 2>/dev/null || printf '0'
}

portable_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else die 'sha256sum or shasum is required'; fi
}

new_temp() {
  LAST_TEMP="$(mktemp "$1")"
  TEMP_FILES="$TEMP_FILES $LAST_TEMP"
}

forget_temp() {
  local wanted="$1" item kept=''
  for item in $TEMP_FILES; do [ "$item" = "$wanted" ] || kept="$kept $item"; done
  TEMP_FILES="$kept"
}

atomic_replace() {
  local source="$1" target="$2"
  chmod 600 "$source"
  mv -f "$source" "$target"
  forget_temp "$source"
}

lock_is_stale() {
  local directory="$1" now modified owner
  [ -d "$directory" ] || return 1
  owner="$(sed -n '1p' "$directory/owner" 2>/dev/null || true)"
  case "$owner" in ''|*[!0-9]*) ;; *) kill -0 "$owner" 2>/dev/null && return 1 ;; esac
  now="$(date +%s)"
  modified="$(file_epoch "$directory")"
  [ "$modified" -eq 0 ] || [ $((now - modified)) -ge "$MEMORY_LOCK_TTL_SECONDS" ]
}

acquire_named_lock() {
  local directory="$1" attempts=0 max_attempts="${2:-200}"
  mkdir -p "$MEMORY_ROOT"
  while ! mkdir "$directory" 2>/dev/null; do
    if lock_is_stale "$directory"; then rm -rf "$directory" 2>/dev/null || true; continue; fi
    attempts=$((attempts + 1))
    [ "$attempts" -lt "$max_attempts" ] || die "memory registry is busy: $(basename "$directory")"
    sleep 0.05
  done
  printf '%s\n%s\n' "$$" "$(date +%s)" > "$directory/owner"
  ACTIVE_LOCKS="$ACTIVE_LOCKS $directory"
}

# Best-effort lock for non-critical journals (never block room launch).
try_acquire_named_lock() {
  local directory="$1" attempts=0
  mkdir -p "$MEMORY_ROOT"
  while ! mkdir "$directory" 2>/dev/null; do
    if lock_is_stale "$directory"; then rm -rf "$directory" 2>/dev/null || true; continue; fi
    attempts=$((attempts + 1))
    [ "$attempts" -lt 40 ] || return 1
    sleep 0.05
  done
  printf '%s\n%s\n' "$$" "$(date +%s)" > "$directory/owner"
  ACTIVE_LOCKS="$ACTIVE_LOCKS $directory"
  return 0
}

release_named_lock() {
  local directory="$1" item kept=''
  rm -rf "$directory" 2>/dev/null || true
  for item in $ACTIVE_LOCKS; do [ "$item" = "$directory" ] || kept="$kept $item"; done
  ACTIVE_LOCKS="$kept"
}

age_label() {
  local seconds="${1:-0}"
  if [ "$seconds" -lt 60 ]; then printf '%ss' "$seconds"
  elif [ "$seconds" -lt 3600 ]; then printf '%sm' "$((seconds / 60))"
  elif [ "$seconds" -lt 86400 ]; then printf '%sh' "$((seconds / 3600))"
  else printf '%sd' "$((seconds / 86400))"
  fi
}

freshness_for() {
  local file="$1" status="$2" now modified age limit
  [ -f "$file" ] || { printf 'missing'; return; }
  now="$(date +%s)"
  modified="$(file_epoch "$file")"
  age=$((now - modified))
  case "$status" in
    working) limit="$MEMORY_WORKING_FRESH_SECONDS" ;;
    *) limit="$MEMORY_IDLE_FRESH_SECONDS" ;;
  esac
  [ "$age" -le "$limit" ] && printf 'fresh' || printf 'stale'
}

run_count() {
  local slot="$1" directory="$MEMORY_ROOT/$slot/runs"
  [ -d "$directory" ] || { printf '0'; return; }
  find "$directory" -type f -name 'run-*.md' 2>/dev/null | wc -l | tr -d ' '
}

acquire_lock() {
  acquire_named_lock "$LOCK_DIR"
}

release_lock() {
  release_named_lock "$LOCK_DIR"
}

init_memory() {
  local index slot file
  mkdir -p "$ROOM_ROOT/.agent-context" "$ROOM_HANDOFF_DIR" "$MEMORY_ROOT"
  printf '%s\n' "$MEMORY_SCHEMA_VERSION" > "$SCHEMA_FILE"
  chmod 600 "$SCHEMA_FILE"
  [ -f "$EVENTS_FILE" ] || printf 'timestamp\tevent\tslot\tprovider\tsession\tdetail\n' > "$EVENTS_FILE"
  chmod 600 "$EVENTS_FILE"
  find "$MEMORY_ROOT" -maxdepth 1 -type f \( -name '.room-state.*' -o -name '.claims.*' -o -name '.events.*' -o -name '.bootstrap.*' -o -name '.snapshot.*' \) -mtime +1 -delete 2>/dev/null || true
  if [ ! -f "$ROOM_ROOT/.agent-context/PROJECT_STATE.md" ]; then
    cat > "$ROOM_ROOT/.agent-context/PROJECT_STATE.md" <<'EOF'
# Project state

- Updated: not yet
- Owner: project owner
- Objective: describe the current product outcome.

## Current state

- Add only the concise facts every agent needs.
EOF
  fi
  if [ ! -f "$ROOM_ROOT/.agent-context/DECISIONS.md" ]; then
    cat > "$ROOM_ROOT/.agent-context/DECISIONS.md" <<'EOF'
# Durable decisions

Append only decisions that affect more than one role or future sessions.
EOF
  fi
  if [ ! -f "$ROOM_ROOT/ARCHITECTURE.md" ]; then
    cat > "$ROOM_ROOT/ARCHITECTURE.md" <<'EOF'
# Architecture

Document the system boundaries, sources of truth and critical workflows here.
EOF
  fi
  if [ ! -f "$ROOM_ROOT/AGENTS.md" ]; then
    cat > "$ROOM_ROOT/AGENTS.md" <<'EOF'
# PaneShift agent contract

1. Read `$AGENT_MEMORY_FILE` before acting.
2. Verify the memory against Git and the code.
3. Claim a scope before editing: `"$PANESHIFT_HOME/agent-memory.sh" --config "$AGENT_ROOM_CONFIG" claim "$AGENT_SLOT" "<scope>" "<task>"`.
4. Update only `$PANESHIFT_HOME/.agent-context/handoffs/$AGENT_SLOT.md` so all worktrees share one handoff registry.
5. Snapshot and release when done.
EOF
  fi
  if [ ! -f "$ROOM_ROOT/CLAUDE.md" ]; then printf '@AGENTS.md\n' > "$ROOM_ROOT/CLAUDE.md"; fi
  for index in $(agent_indices); do
    slot="$(agent_value "$index" SLOT)"
    file="$ROOM_HANDOFF_DIR/$slot.md"
    if [ ! -f "$file" ]; then
      cat > "$file" <<EOF
# $slot handoff

- Updated: not yet
- Status: idle
- Task: unassigned
- Reserved scope: none

## Completed

## Files and commits

## Verification

## Blockers

## Next step
EOF
    fi
  done
}

event_log() {
  local event="$1" slot="${2:-room}" detail="${3:-}" temp provider='unknown'
  detail="$(printf '%s' "$detail" | tr '\t\r\n' '   ' | cut -c1-500)"
  if resolve_index "$slot" >/dev/null 2>&1; then provider="$(provider_for_index "$(resolve_index "$slot")")"; fi
  # Never fail bootstrap / launch because the event journal is busy.
  try_acquire_named_lock "$MEMORY_ROOT/.events.lock" || return 0
  new_temp "$MEMORY_ROOT/.events.XXXXXX"; temp="$LAST_TEMP"
  [ ! -f "$EVENTS_FILE" ] || cat "$EVENTS_FILE" > "$temp"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$event" "$slot" "$provider" "$ROOM_SESSION" "$detail" >> "$temp"
  atomic_replace "$temp" "$EVENTS_FILE"
  release_named_lock "$MEMORY_ROOT/.events.lock"
}

canonical_scope() {
  local scope="$1" part result='' old_ifs
  scope="${scope#./}"; scope="${scope%/}"
  case "$scope" in /*) scope="${scope#/}" ;; esac
  old_ifs="$IFS"; IFS='/'
  # shellcheck disable=SC2086
  set -- $scope
  IFS="$old_ifs"
  for part in "$@"; do
    case "$part" in ''|.) continue ;; ..) result="${result%/*}" ;; *) result="${result:+$result/}$part" ;; esac
  done
  [ -n "$result" ] || die 'claim scope is required'
  printf '%s\n' "$result"
}

redact_stream() {
  sed -E \
    -e 's/((API|AUTH|ACCESS|SECRET|SERVICE|PRIVATE)[_-]?(KEY|TOKEN|SECRET|PASSWORD)[=:][[:space:]]*)[^[:space:]]+/\1[REDACTED]/Ig' \
    -e 's/(Bearer[[:space:]]+)[A-Za-z0-9._~+\/-]+/\1[REDACTED]/Ig' \
    -e 's/(sk-[A-Za-z0-9_-]{12})[A-Za-z0-9_-]+/\1[REDACTED]/g' \
    -e 's/(-----BEGIN [A-Z ]*PRIVATE KEY-----).*/\1 [REDACTED]/g'
}

validate_handoff_file() {
  local file="$1" errors=0 field
  [ -s "$file" ] || { printf 'ERR  missing handoff %s\n' "$file" >&2; return 1; }
  for field in status task scope; do
    [ -n "$(handoff_field "$file" "$field")" ] || { printf 'ERR  handoff missing %s: %s\n' "$field" "$file" >&2; errors=$((errors + 1)); }
  done
  [ "$errors" -eq 0 ]
}

refresh_state() {
  local temp index slot name provider file status freshness modified age task runs now
  mkdir -p "$MEMORY_ROOT"
  acquire_named_lock "$STATE_LOCK_DIR"
  new_temp "$MEMORY_ROOT/.room-state.XXXXXX"; temp="$LAST_TEMP"
  now="$(date +%s)"
  printf 'index\tslot\tname\tprovider\tstatus\tfreshness\tage_seconds\truns\ttask\n' > "$temp"
  for index in $(agent_indices); do
    slot="$(agent_value "$index" SLOT)"
    name="$(agent_value "$index" NAME)"
    provider="$(provider_for_index "$index")"
    file="$(handoff_file "$index")"
    status="$(handoff_field "$file" status)"
    [ -n "$status" ] || status='unknown'
    freshness="$(freshness_for "$file" "$status")"
    modified="$(file_epoch "$file")"
    age=$((now - modified))
    [ "$modified" -gt 0 ] || age=0
    task="$(handoff_field "$file" task | tr '\t\n' '  ' | cut -c1-90)"
    runs="$(run_count "$slot")"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$index" "$slot" "$name" "$provider" "$status" "$freshness" "$age" "$runs" "$task" >> "$temp"
  done
  atomic_replace "$temp" "$STATE_FILE"
  release_named_lock "$STATE_LOCK_DIR"
}

snapshot_one() {
  local requested="$1" reason="${2:-manual}" index slot name role pane provider directory snapshot_lock timestamp stamp file temp latest_temp handoff stale_files
  index="$(resolve_index "$requested")" || die "unknown agent: $requested"
  slot="$(agent_value "$index" SLOT)"
  name="$(agent_value "$index" NAME)"
  role="$(agent_value "$index" ROLE)"
  pane="$(pane_for_index "$index")"
  provider="$(provider_for_index "$index")"
  directory="$MEMORY_ROOT/$slot/runs"
  snapshot_lock="$MEMORY_ROOT/$slot/.snapshot.lock"
  mkdir -p "$directory" "$MEMORY_ROOT/$slot"
  acquire_named_lock "$snapshot_lock"
  timestamp="$(date '+%Y-%m-%d %H:%M:%S %Z')"
  stamp="$(date '+%Y%m%d-%H%M%S')"
  file="$directory/run-$stamp-$$-$RANDOM.md"
  new_temp "$directory/.snapshot.XXXXXX"; temp="$LAST_TEMP"
  handoff="$(handoff_file "$index")"
  {
    printf '# Run snapshot — %s\n\n' "$name"
    printf -- '- Captured: %s\n' "$timestamp"
    printf -- '- Slot: `%s`\n' "$slot"
    printf -- '- Role: `%s`\n' "$role"
    printf -- '- Provider: `%s`\n' "$provider"
    printf -- '- Reason: `%s`\n' "$reason"
    printf -- '- Commit: `%s`\n\n' "$(git -C "$ROOM_ROOT" rev-parse --short HEAD 2>/dev/null || printf unknown)"
    printf '## Current handoff\n\n'
    if [ -f "$handoff" ]; then sed -n '1,180p' "$handoff"; else printf '_No handoff found._\n'; fi
    printf '\n## Git context\n\n```text\n'
    git -C "$ROOM_ROOT" status --short 2>/dev/null | sed -n '1,120p' || true
    printf '\n'
    git -C "$ROOM_ROOT" log -8 --oneline 2>/dev/null || true
    printf '```\n'
    if [ -n "$pane" ]; then
      printf '\n## Recent terminal context\n\n```text\n'
      if [ "$MEMORY_CAPTURE_TERMINAL" = 1 ]; then
        tmux capture-pane -p -t "$pane" -S -100 2>/dev/null |
          perl -pe 's/\e\[[0-9;?]*[ -\/]*[@-~]//g' | tail -100 | redact_stream || true
      else
        printf '[Terminal capture disabled by ROOM_MEMORY_CAPTURE_TERMINAL]\n'
      fi
      printf '```\n'
    fi
  } > "$temp"
  atomic_replace "$temp" "$file"
  new_temp "$MEMORY_ROOT/$slot/.latest.XXXXXX"; latest_temp="$LAST_TEMP"
  cp "$file" "$latest_temp"
  atomic_replace "$latest_temp" "$MEMORY_ROOT/$slot/latest.md"
  stale_files="$(ls -1t "$directory"/run-*.md 2>/dev/null | sed -n "$((MEMORY_HISTORY_LIMIT + 1)),\$p" || true)"
  if [ -n "$stale_files" ]; then
    printf '%s\n' "$stale_files" | while IFS= read -r old; do rm -f "$old"; done
  fi
  event_log snapshot "$slot" "reason=$reason file=$(basename "$file") commit=$(git -C "$ROOM_ROOT" rev-parse --short HEAD 2>/dev/null || printf unknown)"
  release_named_lock "$snapshot_lock"
}

claims_conflicts() {
  [ -s "$CLAIMS_FILE" ] || { printf '0'; return; }
  awk -F '\t' -v now="$(date +%s)" '
    NF && ($5 == "" || $5 > now) { n++; slot[n]=$1; scope[n]=$2 }
    END {
      conflicts=0
      for (i=1; i<=n; i++) for (j=i+1; j<=n; j++) {
        if (slot[i] != slot[j] && (scope[i] == scope[j] || index(scope[i], scope[j] "/") == 1 || index(scope[j], scope[i] "/") == 1)) conflicts++
      }
      print conflicts
    }
  ' "$CLAIMS_FILE"
}

prune_expired_claims_locked() {
  local temp now
  now="$(date +%s)"
  new_temp "$MEMORY_ROOT/.claims.XXXXXX"; temp="$LAST_TEMP"
  [ ! -f "$CLAIMS_FILE" ] || awk -F '\t' -v now="$now" 'NF && ($5 == "" || $5 > now)' "$CLAIMS_FILE" > "$temp"
  atomic_replace "$temp" "$CLAIMS_FILE"
}

claim_scope() {
  local requested="$1" scope="$2" task="${3:-unspecified}" index slot temp conflict now lease
  index="$(resolve_index "$requested")" || die "unknown agent: $requested"
  slot="$(agent_value "$index" SLOT)"
  scope="$(canonical_scope "$scope")"
  [ -n "$scope" ] && [ "$scope" != 'none' ] || die 'claim scope is required'
  case "$scope$task" in
    *$'\t'*|*$'\r'*|*$'\n'*) die 'claims cannot contain tabs or newlines' ;;
  esac
  acquire_lock
  prune_expired_claims_locked
  conflict=''
  if [ -s "$CLAIMS_FILE" ]; then
    conflict="$(awk -F '\t' -v mine="$slot" -v wanted="$scope" '
      $1 != mine && ($2 == wanted || index($2, wanted "/") == 1 || index(wanted, $2 "/") == 1) { print $1 " owns " $2; exit }
    ' "$CLAIMS_FILE")"
  fi
  if [ -n "$conflict" ]; then
    release_lock
    die "scope conflict: $conflict"
  fi
  new_temp "$MEMORY_ROOT/.claims.XXXXXX"; temp="$LAST_TEMP"
  [ ! -f "$CLAIMS_FILE" ] || awk -F '\t' -v mine="$slot" -v wanted="$scope" '!($1 == mine && $2 == wanted)' "$CLAIMS_FILE" > "$temp"
  now="$(date +%s)"; lease=$((now + MEMORY_CLAIM_LEASE_SECONDS))
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$slot" "$scope" "$task" "$now" "$lease" "$ROOM_SESSION" >> "$temp"
  atomic_replace "$temp" "$CLAIMS_FILE"
  release_lock
  event_log claim "$slot" "scope=$scope lease_until=$lease task=$task"
  printf '%s claimed %s\n' "$slot" "$scope"
}

release_claim() {
  local requested="$1" scope="${2:-}" index slot temp
  index="$(resolve_index "$requested")" || die "unknown agent: $requested"
  slot="$(agent_value "$index" SLOT)"
  [ -z "$scope" ] || scope="$(canonical_scope "$scope")"
  acquire_lock
  prune_expired_claims_locked
  new_temp "$MEMORY_ROOT/.claims.XXXXXX"; temp="$LAST_TEMP"
  if [ ! -f "$CLAIMS_FILE" ]; then
    : > "$temp"
  elif [ -n "$scope" ]; then
    awk -F '\t' -v mine="$slot" -v wanted="$scope" '!($1 == mine && $2 == wanted)' "$CLAIMS_FILE" > "$temp"
  else
    awk -F '\t' -v mine="$slot" '$1 != mine' "$CLAIMS_FILE" > "$temp"
  fi
  atomic_replace "$temp" "$CLAIMS_FILE"
  release_lock
  event_log release "$slot" "scope=${scope:-all}"
  printf '%s released%s\n' "$slot" "$([ -n "$scope" ] && printf ' %s' "$scope")"
}

health() {
  local live handoffs total claims conflicts last_epoch age runs index slot latest latest_epoch now
  refresh_state
  handoffs="$(awk -F '\t' 'NR > 1 && $6 == "fresh" { count++ } END { print count+0 }' "$STATE_FILE")"
  total="$(awk 'END { print NR-1 }' "$STATE_FILE")"
  live=0
  now="$(date +%s)"
  for index in $(agent_indices); do
    slot="$(agent_value "$index" SLOT)"
    latest="$MEMORY_ROOT/$slot/latest.md"
    latest_epoch="$(file_epoch "$latest")"
    if [ "$latest_epoch" -gt 0 ] && [ $((now - latest_epoch)) -le $((MEMORY_HEARTBEAT_SECONDS * 2)) ]; then
      live=$((live + 1))
    fi
  done
  claims="$(awk -F '\t' -v now="$(date +%s)" 'NF && ($5 == "" || $5 > now) { count++ } END { print count+0 }' "$CLAIMS_FILE" 2>/dev/null || printf '0')"
  conflicts="$(claims_conflicts)"
  last_epoch="$(file_epoch "$MEMORY_ROOT/room.last-snapshot")"
  if [ "$last_epoch" -eq 0 ]; then age='never'; else age="$(age_label "$(($(date +%s) - last_epoch))")"; fi
  runs="$(awk -F '\t' 'NR > 1 { total += $8 } END { print total+0 }' "$STATE_FILE")"
  printf '%s|%s|%s|%s|%s|%s|%s\n' "$live" "$total" "$handoffs" "$claims" "$conflicts" "$age" "$runs"
}

# True when a project note has real content (not just the empty template).
memory_note_is_substantive() {
  local file="$1" lines
  [ -s "$file" ] || return 1
  # PROJECT_STATE empty template
  if grep -qE 'Updated: not yet|Add only the concise facts every agent needs' "$file" 2>/dev/null; then
    return 1
  fi
  # DECISIONS empty template (title + single instruction line)
  if grep -q 'Append only decisions that affect more than one role' "$file" 2>/dev/null; then
    lines="$(grep -cve '^\s*$' -e '^#' "$file" 2>/dev/null | head -1)"
    lines="${lines:-0}"
    [ "$lines" -gt 1 ] || return 1
  fi
  return 0
}

bootstrap_one() {
  local requested="$1" index slot name output temp run peer peer_file latest peer_status peer_task
  init_memory
  index="$(resolve_index "$requested")" || die "unknown agent: $requested"
  slot="$(agent_value "$index" SLOT)"
  name="$(agent_value "$index" NAME)"
  refresh_state
  mkdir -p "$MEMORY_ROOT/$slot"
  output="$MEMORY_ROOT/$slot/BOOTSTRAP.md"
  new_temp "$MEMORY_ROOT/$slot/.bootstrap.XXXXXX"; temp="$LAST_TEMP"
  {
    printf '# Live project memory — %s\n\n' "$name"
    printf 'Generated: %s\n\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')"
    printf '> Thin context. Verify against Git and the code. Handoff + claims are authoritative for task/scope.\n\n'
    printf '## Team now\n\n'
    printf '| Slot | Role | Provider | Status | Task |\n'
    printf '|---|---|---|---|---|\n'
    awk -F '\t' 'NR > 1 { printf "| `%s` | %s | %s | %s | %s |\n", $2, $3, $4, $5, $9 }' "$STATE_FILE"
    if memory_note_is_substantive "$ROOM_ROOT/.agent-context/PROJECT_STATE.md"; then
      printf '\n## Project state\n\n'
      sed -n '1,80p' "$ROOM_ROOT/.agent-context/PROJECT_STATE.md"
    fi
    if memory_note_is_substantive "$ROOM_ROOT/.agent-context/DECISIONS.md"; then
      printf '\n## Durable decisions\n\n'
      sed -n '1,80p' "$ROOM_ROOT/.agent-context/DECISIONS.md"
    fi
    printf '\n## Your current handoff\n\n'
    [ ! -f "$(handoff_file "$index")" ] || sed -n '1,120p' "$(handoff_file "$index")"
    printf '\n## Other roles (one line each)\n\n'
    for peer in $(agent_indices); do
      [ "$peer" = "$index" ] && continue
      peer_file="$(handoff_file "$peer")"
      peer_status="$(handoff_field "$peer_file" status)"
      peer_task="$(handoff_field "$peer_file" task)"
      [ -n "$peer_status" ] || peer_status='?'
      [ -n "$peer_task" ] || peer_task='—'
      printf -- '- **%s** · %s · %s\n' "$(agent_value "$peer" NAME)" "$peer_status" "$peer_task"
    done
    latest="$MEMORY_ROOT/$slot/latest.md"
    if [ -s "$latest" ]; then
      printf '\n## Most recent live context\n\n'
      awk '/^## Recent terminal context/{found=1; next} found{print}' "$latest" | tail -40
      printf '\n'
    fi
    printf '\n## Recent runs (last %s)\n\n' "$MEMORY_HISTORY_LIMIT"
    for run in $(ls -1t "$MEMORY_ROOT/$slot/runs"/run-*.md 2>/dev/null | head -"$MEMORY_HISTORY_LIMIT" || true); do
      printf '### %s\n\n' "$(basename "$run")"
      sed -n "1,${MEMORY_BOOTSTRAP_RUN_HEAD}p" "$run"
      printf '\n'
    done
  } > "$temp"
  atomic_replace "$temp" "$output"
  event_log bootstrap "$slot" "file=$output thin=1"
  printf '%s\n' "$output"
}

snapshot_room() {
  local reason="${1:-manual}" minimum_age="${2:-0}" marker="$MEMORY_ROOT/room.last-snapshot" now last index
  mkdir -p "$MEMORY_ROOT"
  acquire_named_lock "$ROOM_LOCK_DIR"
  now="$(date +%s)"
  last="$(file_epoch "$marker")"
  if [ "$minimum_age" -gt 0 ] && [ "$last" -gt 0 ] && [ $((now - last)) -lt "$minimum_age" ]; then release_named_lock "$ROOM_LOCK_DIR"; return 0; fi
  # Reserve the interval before doing slow tmux captures so concurrent heartbeats stop here.
  : > "$marker"
  for index in $(agent_indices); do snapshot_one "$index" "$reason"; done
  for index in $(agent_indices); do bootstrap_one "$index" >/dev/null; done
  event_log snapshot-room room "reason=$reason"
  release_named_lock "$ROOM_LOCK_DIR"
}

doctor_memory() {
  local errors=0 index file status
  # Required for the thin memory contract.
  for required in "$ROOM_ROOT/ARCHITECTURE.md" "$ROOM_ROOT/AGENTS.md"; do
    if [ -f "$required" ]; then printf 'OK   %s\n' "${required#$ROOM_ROOT/}"; else printf 'ERR  missing %s\n' "${required#$ROOM_ROOT/}"; errors=$((errors + 1)); fi
  done
  # Optional human notes — never fail the room if empty templates.
  for optional in "$ROOM_ROOT/.agent-context/PROJECT_STATE.md" "$ROOM_ROOT/.agent-context/DECISIONS.md"; do
    if [ ! -f "$optional" ]; then
      printf 'INFO missing optional %s\n' "${optional#$ROOM_ROOT/}"
    elif memory_note_is_substantive "$optional"; then
      printf 'OK   %s (substantive)\n' "${optional#$ROOM_ROOT/}"
    else
      printf 'INFO %s (template — skipped in bootstrap)\n' "${optional#$ROOM_ROOT/}"
    fi
  done
  for index in $(agent_indices); do
    file="$(handoff_file "$index")"
    status="$(handoff_field "$file" status)"
    if [ -n "$status" ]; then printf 'OK   %s · %s\n' "${file#$ROOM_ROOT/}" "$status"; else printf 'ERR  invalid handoff %s\n' "${file#$ROOM_ROOT/}"; errors=$((errors + 1)); fi
  done
  printf 'INFO schema %s\n' "$(sed -n '1p' "$SCHEMA_FILE" 2>/dev/null || printf missing)"
  printf 'INFO health %s\n' "$(health)"
  printf 'INFO history_limit %s\n' "$MEMORY_HISTORY_LIMIT"
  [ "$errors" -eq 0 ] || exit 1
}

validate_memory() {
  local requested="${1:-}" index file errors=0
  if [ -n "$requested" ]; then
    index="$(resolve_index "$requested")" || die "unknown agent: $requested"
    validate_handoff_file "$(handoff_file "$index")" || errors=$((errors + 1))
  else
    for index in $(agent_indices); do validate_handoff_file "$(handoff_file "$index")" || errors=$((errors + 1)); done
  fi
  [ "$errors" -eq 0 ] || exit 1
}

checkpoint_one() {
  local requested="$1" reason="${2:-checkpoint}" index slot
  index="$(resolve_index "$requested")" || die "unknown agent: $requested"
  slot="$(agent_value "$index" SLOT)"
  validate_handoff_file "$(handoff_file "$index")" || die "handoff validation failed for $slot"
  snapshot_one "$index" "$reason"
  bootstrap_one "$index" >/dev/null
  event_log checkpoint "$slot" "reason=$reason"
}

show_events() {
  local limit="${1:-50}"
  case "$limit" in ''|*[!0-9]*) die 'events limit must be an integer' ;; esac
  tail -n "$limit" "$EVENTS_FILE" 2>/dev/null || true
}

export_memory() {
  local archive="$1" checksum temp staging
  [ -n "$archive" ] || die 'export archive path is required'
  case "$archive" in /*) ;; *) archive="$PWD/$archive" ;; esac
  mkdir -p "$(dirname "$archive")"
  new_temp "$(dirname "$archive")/.memory-export.XXXXXX"; temp="$LAST_TEMP"
  staging="$(mktemp -d "${TMPDIR:-/tmp}/paneshift-memory-export.XXXXXX")"; TEMP_DIRS="$TEMP_DIRS $staging"
  mkdir -p "$staging/project/.agent-context" "$staging/runtime-memory"
  for item in ARCHITECTURE.md AGENTS.md; do [ ! -f "$ROOM_ROOT/$item" ] || cp "$ROOM_ROOT/$item" "$staging/project/$item"; done
  for item in PROJECT_STATE.md DECISIONS.md; do [ ! -f "$ROOM_ROOT/.agent-context/$item" ] || cp "$ROOM_ROOT/.agent-context/$item" "$staging/project/.agent-context/$item"; done
  [ ! -d "$ROOM_HANDOFF_DIR" ] || cp -R "$ROOM_HANDOFF_DIR" "$staging/project/.agent-context/handoffs"
  [ ! -d "$MEMORY_ROOT" ] || cp -R "$MEMORY_ROOT/." "$staging/runtime-memory/"
  rm -rf "$staging/runtime-memory/.claims.lock" "$staging/runtime-memory/.events.lock" "$staging/runtime-memory/.snapshot-room.lock"
  find "$staging/runtime-memory" -type f \( -name '.room-state.*' -o -name '.claims.*' -o -name '.events.*' -o -name '.bootstrap.*' -o -name '.snapshot.*' \) -delete 2>/dev/null || true
  printf '%s\n' "$MEMORY_SCHEMA_VERSION" > "$staging/ARCHIVE_SCHEMA"
  tar -czf "$temp" -C "$staging" ARCHIVE_SCHEMA project runtime-memory
  chmod 600 "$temp"; mv -f "$temp" "$archive"; forget_temp "$temp"
  checksum="$(portable_sha256 "$archive")"
  printf '%s  %s\n' "$checksum" "$(basename "$archive")" > "$archive.sha256"
  chmod 600 "$archive.sha256"
  event_log export room "archive=$archive checksum=$checksum"
  printf '%s\n' "$archive"
}

import_memory() {
  local archive="$1" expected actual entry staging imported_schema item
  [ -f "$archive" ] || die "archive not found: $archive"
  if [ -f "$archive.sha256" ]; then
    expected="$(awk 'NR == 1 {print $1}' "$archive.sha256")"; actual="$(portable_sha256 "$archive")"
    [ "$expected" = "$actual" ] || die 'archive checksum mismatch'
  fi
  while IFS= read -r entry; do
    case "$entry" in /*|../*|*/../*|*/..) die "unsafe archive entry: $entry" ;; esac
  done < <(tar -tzf "$archive")
  staging="$(mktemp -d "${TMPDIR:-/tmp}/paneshift-memory-import.XXXXXX")"; TEMP_DIRS="$TEMP_DIRS $staging"
  tar -xzf "$archive" -C "$staging" --no-same-owner --no-same-permissions
  imported_schema="$(sed -n '1p' "$staging/ARCHIVE_SCHEMA" 2>/dev/null || true)"
  [ "$imported_schema" = "$MEMORY_SCHEMA_VERSION" ] || die "unsupported archive schema: ${imported_schema:-missing}"
  acquire_named_lock "$ROOM_LOCK_DIR"
  for item in ARCHITECTURE.md AGENTS.md; do [ ! -f "$staging/project/$item" ] || cp "$staging/project/$item" "$ROOM_ROOT/$item"; done
  mkdir -p "$ROOM_ROOT/.agent-context" "$ROOM_HANDOFF_DIR" "$MEMORY_ROOT"
  for item in PROJECT_STATE.md DECISIONS.md; do [ ! -f "$staging/project/.agent-context/$item" ] || cp "$staging/project/.agent-context/$item" "$ROOM_ROOT/.agent-context/$item"; done
  [ ! -d "$staging/project/.agent-context/handoffs" ] || cp -R "$staging/project/.agent-context/handoffs/." "$ROOM_HANDOFF_DIR/"
  [ ! -d "$staging/runtime-memory" ] || cp -R "$staging/runtime-memory/." "$MEMORY_ROOT/"
  init_memory
  event_log import room "archive=$archive checksum=$(portable_sha256 "$archive")"
  release_named_lock "$ROOM_LOCK_DIR"
}

show_help() {
  cat <<EOF
PaneShift Memory — provider-neutral live context

  $(basename "$0") init                            create missing memory contract files
  $(basename "$0") snapshot <slot> [reason]       save one run, keep the latest few
  $(basename "$0") snapshot-room [reason] [secs] save all agents, optionally only when due
  $(basename "$0") bootstrap <slot>               rebuild thin provider-neutral startup brief
  $(basename "$0") health                          fresh/total/claims/conflicts/age/runs
  $(basename "$0") claim <slot> <scope> <task>    reserve a file or directory atomically
  $(basename "$0") release <slot> [scope]         release one or all slot reservations
  $(basename "$0") checkpoint <slot> [reason]    validate, snapshot and rebuild one role
  $(basename "$0") validate [slot]               validate structured handoff fields
  $(basename "$0") events [limit]                show the append-only event journal
  $(basename "$0") export <archive.tar.gz>       export portable memory with checksum
  $(basename "$0") import <archive.tar.gz>       verify and import a portable archive
  $(basename "$0") doctor                          validate the memory contract
EOF
}

ACTION="${1:-help}"
case "$ACTION" in
  init) init_memory ;;
  snapshot) snapshot_one "${2:-${AGENT_SLOT:-}}" "${3:-manual}" ;;
  snapshot-room) snapshot_room "${2:-manual}" "${3:-0}" ;;
  bootstrap) bootstrap_one "${2:-${AGENT_SLOT:-}}" ;;
  health) health ;;
  claim) claim_scope "${2:-${AGENT_SLOT:-}}" "${3:-}" "${4:-unspecified}" ;;
  release) release_claim "${2:-${AGENT_SLOT:-}}" "${3:-}" ;;
  checkpoint) checkpoint_one "${2:-${AGENT_SLOT:-}}" "${3:-checkpoint}" ;;
  validate) validate_memory "${2:-}" ;;
  events) show_events "${2:-50}" ;;
  export) export_memory "${2:-}" ;;
  import) import_memory "${2:-}" ;;
  doctor) doctor_memory ;;
  help|-h|--help) show_help ;;
  *) die "unknown command: $ACTION" ;;
esac
