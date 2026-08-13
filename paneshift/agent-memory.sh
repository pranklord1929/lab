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
MEMORY_HISTORY_LIMIT="${ROOM_MEMORY_HISTORY_LIMIT:-4}"
MEMORY_HEARTBEAT_SECONDS="${ROOM_MEMORY_HEARTBEAT_SECONDS:-900}"
MEMORY_WORKING_FRESH_SECONDS="${ROOM_MEMORY_WORKING_FRESH_SECONDS:-1800}"
MEMORY_IDLE_FRESH_SECONDS="${ROOM_MEMORY_IDLE_FRESH_SECONDS:-86400}"
CLAIMS_FILE="$MEMORY_ROOT/claims.tsv"
STATE_FILE="$MEMORY_ROOT/room-state.tsv"
LOCK_DIR="$MEMORY_ROOT/.lock"

die() {
  printf 'agent-memory: %s\n' "$*" >&2
  exit 1
}

agent_value() {
  local index="$1" field="$2"
  eval "printf '%s' \"\${AGENT_${index}_${field}:-}\""
}

resolve_index() {
  local requested="${1:-}" index
  case "$requested" in 1|2|3|4) printf '%s\n' "$requested"; return ;; esac
  for index in 1 2 3 4; do
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
  stat -f '%m' "$1" 2>/dev/null || stat -c '%Y' "$1" 2>/dev/null || printf '0'
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
  local attempts=0
  mkdir -p "$MEMORY_ROOT"
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    attempts=$((attempts + 1))
    [ "$attempts" -lt 80 ] || die 'memory registry is busy'
    sleep 0.05
  done
}

release_lock() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

init_memory() {
  local index slot file
  mkdir -p "$ROOM_ROOT/.agent-context" "$ROOM_HANDOFF_DIR" "$MEMORY_ROOT"
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
4. Update only `.agent-context/handoffs/$AGENT_SLOT.md`.
5. Snapshot and release when done.
EOF
  fi
  if [ ! -f "$ROOM_ROOT/CLAUDE.md" ]; then printf '@AGENTS.md\n' > "$ROOM_ROOT/CLAUDE.md"; fi
  for index in 1 2 3 4; do
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

refresh_state() {
  local temp index slot name provider file status freshness modified age task runs now
  mkdir -p "$MEMORY_ROOT"
  temp="$(mktemp "$MEMORY_ROOT/.room-state.XXXXXX")"
  now="$(date +%s)"
  printf 'index\tslot\tname\tprovider\tstatus\tfreshness\tage_seconds\truns\ttask\n' > "$temp"
  for index in 1 2 3 4; do
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
  chmod 600 "$temp"
  mv "$temp" "$STATE_FILE"
}

snapshot_one() {
  local requested="$1" reason="${2:-manual}" index slot name role pane provider directory timestamp stamp file handoff stale_files
  index="$(resolve_index "$requested")" || die "unknown agent: $requested"
  slot="$(agent_value "$index" SLOT)"
  name="$(agent_value "$index" NAME)"
  role="$(agent_value "$index" ROLE)"
  pane="$(pane_for_index "$index")"
  provider="$(provider_for_index "$index")"
  directory="$MEMORY_ROOT/$slot/runs"
  timestamp="$(date '+%Y-%m-%d %H:%M:%S %Z')"
  stamp="$(date '+%Y%m%d-%H%M%S')"
  file="$directory/run-$stamp-$$-$RANDOM.md"
  handoff="$(handoff_file "$index")"
  mkdir -p "$directory"
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
      tmux capture-pane -p -t "$pane" -S -100 2>/dev/null |
        perl -pe 's/\e\[[0-9;?]*[ -\/]*[@-~]//g' | tail -100 || true
      printf '```\n'
    fi
  } > "$file"
  chmod 600 "$file"
  cp "$file" "$MEMORY_ROOT/$slot/latest.md"
  stale_files="$(ls -1t "$directory"/run-*.md 2>/dev/null | sed -n "$((MEMORY_HISTORY_LIMIT + 1)),\$p" || true)"
  if [ -n "$stale_files" ]; then
    printf '%s\n' "$stale_files" | while IFS= read -r old; do rm -f "$old"; done
  fi
}

claims_conflicts() {
  [ -s "$CLAIMS_FILE" ] || { printf '0'; return; }
  awk -F '\t' '
    { slot[NR]=$1; scope[NR]=$2 }
    END {
      conflicts=0
      for (i=1; i<=NR; i++) for (j=i+1; j<=NR; j++) {
        if (slot[i] != slot[j] && (scope[i] == scope[j] || index(scope[i], scope[j] "/") == 1 || index(scope[j], scope[i] "/") == 1)) conflicts++
      }
      print conflicts
    }
  ' "$CLAIMS_FILE"
}

claim_scope() {
  local requested="$1" scope="$2" task="${3:-unspecified}" index slot temp conflict
  index="$(resolve_index "$requested")" || die "unknown agent: $requested"
  slot="$(agent_value "$index" SLOT)"
  scope="${scope#./}"
  scope="${scope%/}"
  [ -n "$scope" ] && [ "$scope" != 'none' ] || die 'claim scope is required'
  case "$scope$task" in
    *$'\t'*|*$'\r'*|*$'\n'*) die 'claims cannot contain tabs or newlines' ;;
  esac
  acquire_lock
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
  temp="$(mktemp "$MEMORY_ROOT/.claims.XXXXXX")"
  [ ! -f "$CLAIMS_FILE" ] || awk -F '\t' -v mine="$slot" -v wanted="$scope" '!($1 == mine && $2 == wanted)' "$CLAIMS_FILE" > "$temp"
  printf '%s\t%s\t%s\t%s\n' "$slot" "$scope" "$task" "$(date +%s)" >> "$temp"
  chmod 600 "$temp"
  mv "$temp" "$CLAIMS_FILE"
  release_lock
  printf '%s claimed %s\n' "$slot" "$scope"
}

release_claim() {
  local requested="$1" scope="${2:-}" index slot temp
  index="$(resolve_index "$requested")" || die "unknown agent: $requested"
  slot="$(agent_value "$index" SLOT)"
  acquire_lock
  temp="$(mktemp "$MEMORY_ROOT/.claims.XXXXXX")"
  if [ ! -f "$CLAIMS_FILE" ]; then
    : > "$temp"
  elif [ -n "$scope" ]; then
    awk -F '\t' -v mine="$slot" -v wanted="$scope" '!($1 == mine && $2 == wanted)' "$CLAIMS_FILE" > "$temp"
  else
    awk -F '\t' -v mine="$slot" '$1 != mine' "$CLAIMS_FILE" > "$temp"
  fi
  chmod 600 "$temp"
  mv "$temp" "$CLAIMS_FILE"
  release_lock
  printf '%s released%s\n' "$slot" "$([ -n "$scope" ] && printf ' %s' "$scope")"
}

health() {
  local live handoffs total claims conflicts last_epoch age runs index slot latest latest_epoch now
  refresh_state
  handoffs="$(awk -F '\t' 'NR > 1 && $6 == "fresh" { count++ } END { print count+0 }' "$STATE_FILE")"
  total="$(awk 'END { print NR-1 }' "$STATE_FILE")"
  live=0
  now="$(date +%s)"
  for index in 1 2 3 4; do
    slot="$(agent_value "$index" SLOT)"
    latest="$MEMORY_ROOT/$slot/latest.md"
    latest_epoch="$(file_epoch "$latest")"
    if [ "$latest_epoch" -gt 0 ] && [ $((now - latest_epoch)) -le $((MEMORY_HEARTBEAT_SECONDS * 2)) ]; then
      live=$((live + 1))
    fi
  done
  claims="$(awk 'NF { count++ } END { print count+0 }' "$CLAIMS_FILE" 2>/dev/null || printf '0')"
  conflicts="$(claims_conflicts)"
  last_epoch="$(file_epoch "$MEMORY_ROOT/room.last-snapshot")"
  if [ "$last_epoch" -eq 0 ]; then age='never'; else age="$(age_label "$(($(date +%s) - last_epoch))")"; fi
  runs="$(awk -F '\t' 'NR > 1 { total += $8 } END { print total+0 }' "$STATE_FILE")"
  printf '%s|%s|%s|%s|%s|%s|%s\n' "$live" "$total" "$handoffs" "$claims" "$conflicts" "$age" "$runs"
}

bootstrap_one() {
  local requested="$1" index slot name output run peer peer_file latest
  init_memory
  index="$(resolve_index "$requested")" || die "unknown agent: $requested"
  slot="$(agent_value "$index" SLOT)"
  name="$(agent_value "$index" NAME)"
  refresh_state
  mkdir -p "$MEMORY_ROOT/$slot"
  output="$MEMORY_ROOT/$slot/BOOTSTRAP.md"
  {
    printf '# Live project memory — %s\n\n' "$name"
    printf 'Generated: %s\n\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')"
    printf '> Provider-neutral context. Read this before acting, then verify against Git and the code.\n\n'
    printf '## Team now\n\n'
    printf '| Slot | Role | Provider | Status | Memory | Age | Runs | Task |\n'
    printf '|---|---|---|---|---|---:|---:|---|\n'
    awk -F '\t' 'NR > 1 { printf "| `%s` | %s | %s | %s | %s | %s | %s | %s |\n", $2, $3, $4, $5, $6, $7 "s", $8, $9 }' "$STATE_FILE"
    printf '\n## Project state\n\n'
    [ ! -f "$ROOM_ROOT/.agent-context/PROJECT_STATE.md" ] || sed -n '1,180p' "$ROOM_ROOT/.agent-context/PROJECT_STATE.md"
    printf '\n## Durable decisions\n\n'
    [ ! -f "$ROOM_ROOT/.agent-context/DECISIONS.md" ] || sed -n '1,180p' "$ROOM_ROOT/.agent-context/DECISIONS.md"
    printf '\n## Your current handoff\n\n'
    [ ! -f "$(handoff_file "$index")" ] || sed -n '1,180p' "$(handoff_file "$index")"
    printf '\n## Other roles now\n\n'
    for peer in 1 2 3 4; do
      [ "$peer" = "$index" ] && continue
      peer_file="$(handoff_file "$peer")"
      printf '### %s\n\n' "$(agent_value "$peer" NAME)"
      if [ -f "$peer_file" ]; then sed -n '1,38p' "$peer_file"; else printf '_No handoff found._\n'; fi
      printf '\n'
    done
    latest="$MEMORY_ROOT/$slot/latest.md"
    if [ -s "$latest" ]; then
      printf '\n## Most recent live context\n\n'
      awk '/^## Recent terminal context/{found=1; next} found{print}' "$latest" | tail -60
      printf '\n'
    fi
    printf '\n## Last four runs\n\n'
    for run in $(ls -1t "$MEMORY_ROOT/$slot/runs"/run-*.md 2>/dev/null | head -"$MEMORY_HISTORY_LIMIT" || true); do
      printf '### %s\n\n' "$(basename "$run")"
      sed -n '1,22p' "$run"
      printf '\nFull snapshot: `%s`\n\n' "$run"
    done
  } > "$output"
  chmod 600 "$output"
  printf '%s\n' "$output"
}

snapshot_room() {
  local reason="${1:-manual}" minimum_age="${2:-0}" marker="$MEMORY_ROOT/room.last-snapshot" now last index
  mkdir -p "$MEMORY_ROOT"
  now="$(date +%s)"
  last="$(file_epoch "$marker")"
  if [ "$minimum_age" -gt 0 ] && [ "$last" -gt 0 ] && [ $((now - last)) -lt "$minimum_age" ]; then return 0; fi
  for index in 1 2 3 4; do snapshot_one "$index" "$reason"; done
  : > "$marker"
  for index in 1 2 3 4; do bootstrap_one "$index" >/dev/null; done
}

doctor_memory() {
  local errors=0 index file status
  for required in "$ROOM_ROOT/ARCHITECTURE.md" "$ROOM_ROOT/AGENTS.md" "$ROOM_ROOT/.agent-context/PROJECT_STATE.md" "$ROOM_ROOT/.agent-context/DECISIONS.md"; do
    if [ -f "$required" ]; then printf 'OK   %s\n' "${required#$ROOM_ROOT/}"; else printf 'ERR  missing %s\n' "${required#$ROOM_ROOT/}"; errors=$((errors + 1)); fi
  done
  for index in 1 2 3 4; do
    file="$(handoff_file "$index")"
    status="$(handoff_field "$file" status)"
    if [ -n "$status" ]; then printf 'OK   %s · %s\n' "${file#$ROOM_ROOT/}" "$status"; else printf 'ERR  invalid handoff %s\n' "${file#$ROOM_ROOT/}"; errors=$((errors + 1)); fi
  done
  printf 'INFO health %s\n' "$(health)"
  [ "$errors" -eq 0 ] || exit 1
}

show_help() {
  cat <<EOF
PaneShift Memory — provider-neutral live context

  $(basename "$0") init                            create missing memory contract files
  $(basename "$0") snapshot <slot> [reason]       save one run, keep the latest four
  $(basename "$0") snapshot-room [reason] [secs] save all agents, optionally only when due
  $(basename "$0") bootstrap <slot>               rebuild a provider-neutral startup brief
  $(basename "$0") health                          fresh/total/claims/conflicts/age/runs
  $(basename "$0") claim <slot> <scope> <task>    reserve a file or directory atomically
  $(basename "$0") release <slot> [scope]         release one or all slot reservations
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
  doctor) doctor_memory ;;
  help|-h|--help) show_help ;;
  *) die "unknown command: $ACTION" ;;
esac
