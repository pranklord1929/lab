#!/usr/bin/env bash
# PaneShift — une Control Room tmux 2×2, autonome et configurable.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"
CONFIG="${AGENT_ROOM_CONFIG:-$SCRIPT_DIR/agent-room.conf}"
ATTACH=1
SESSION_OVERRIDE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --config) CONFIG="${2:?missing configuration}"; shift 2 ;;
    --session) SESSION_OVERRIDE="${2:?nom de session manquant}"; shift 2 ;;
    --no-attach) ATTACH=0; shift ;;
    *) break ;;
  esac
done

[ -f "$CONFIG" ] || { printf 'Configuration not found: %s\n' "$CONFIG" >&2; exit 1; }
CONFIG="$(cd "$(dirname "$CONFIG")" && pwd)/$(basename "$CONFIG")"
CONFIG_DIR="$(dirname "$CONFIG")"
# shellcheck source=/dev/null
source "$CONFIG"

ROOM_SESSION="${SESSION_OVERRIDE:-${ROOM_SESSION:-agent-room}}"
ROOM_TITLE="${ROOM_TITLE:-AGENT CONTROL ROOM}"
ROOM_ROOT="${ROOM_ROOT:-$CONFIG_DIR}"
ROOM_HANDOFF_DIR="${ROOM_HANDOFF_DIR:-$ROOM_ROOT/.agent-context/handoffs}"
ROOM_THEME="${ROOM_THEME:-light}"
ROOM_SIDEBAR_WIDTH="${ROOM_SIDEBAR_WIDTH:-34}"
ROOM_STATE_DIR="${ROOM_STATE_DIR:-$ROOM_ROOT/.agent-context/runtime}"
ROOM_MEMORY_SCRIPT="${ROOM_MEMORY_SCRIPT:-$SCRIPT_DIR/agent-memory.sh}"
ROOM_AGENT_COUNT="${ROOM_AGENT_COUNT:-4}"
ROOM_MEMORY_HEARTBEAT_SECONDS="${ROOM_MEMORY_HEARTBEAT_SECONDS:-900}"
ROOM_ALLOW_SHARED_WORKSPACES="${ROOM_ALLOW_SHARED_WORKSPACES:-0}"
ROOM_DROP_HOVER="${ROOM_DROP_HOVER:-1}"
ROOM_SUBSCRIPTION_ONLY="${ROOM_SUBSCRIPTION_ONLY:-1}"
OVH_USAGE_REFRESH_SECONDS="${OVH_USAGE_REFRESH_SECONDS:-3600}"
ROOM_BG="${ROOM_BG:-#7A251E}"
ROOM_FG="${ROOM_FG:-#D7C9A7}"
ROOM_BOLD="${ROOM_BOLD:-#DFBD22}"
ROOM_DARK="${ROOM_DARK:-#3D1916}"
ROOM_ACCENT="${ROOM_ACCENT:-#FFFFFF}"

die() {
  printf 'agent-room: %s\n' "$*" >&2
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

provider_names() {
  printf '%s\n' anthropic openai grok local
}

agent_symbol() {
  case "$1" in 1) printf '①' ;; 2) printf '②' ;; 3) printf '③' ;; 4) printf '④' ;; 5) printf '⑤' ;; 6) printf '⑥' ;; *) printf '%s' "$1" ;; esac
}

memory_run() {
  [ -x "$ROOM_MEMORY_SCRIPT" ] || return 0
  "$ROOM_MEMORY_SCRIPT" --config "$CONFIG" --session "$ROOM_SESSION" "$@"
}

memory_bootstrap() {
  local output
  output="$(memory_run bootstrap "$1")" || return 1
  [ -n "$output" ] || return 1
  printf '%s' "$output"
}

memory_snapshot() {
  memory_run snapshot "$1" "${2:-manual}" >/dev/null
}

memory_checkpoint() {
  memory_run checkpoint "$1" "${2:-milestone}" >/dev/null
}

memory_refresh() {
  local reason="${1:-manual}" minimum_age="${2:-0}"
  memory_run snapshot-room "$reason" "$minimum_age" >/dev/null
}

memory_health() {
  memory_run health 2>/dev/null || printf '0|%s|0|0|0|never|0' "$ROOM_AGENT_COUNT"
}

normalise_provider() {
  case "$1" in
    anthropic|claude) printf '%s' 'anthropic' ;;
    openai|codex) printf '%s' 'openai' ;;
    grok|xai) printf '%s' 'grok' ;;
    local) printf '%s' 'local' ;;
    *) return 1 ;;
  esac
}

provider_label() {
  case "$1" in
    anthropic) printf 'ANTHROPIC' ;;
    openai) printf 'OPENAI' ;;
    grok) printf 'GROK' ;;
    local) printf 'LOCAL' ;;
    *) printf '%s' "$1" | tr '[:lower:]' '[:upper:]' ;;
  esac
}

provider_runtime() {
  case "$1" in
    anthropic) printf 'Claude Code' ;;
    openai) printf 'Codex' ;;
    grok) printf 'Grok Build' ;;
    local) printf 'Local CLI' ;;
    *) printf 'Unknown runtime' ;;
  esac
}

provider_command() {
  local index="$1" provider command
  provider="$(normalise_provider "$2")" || die "unknown provider: $2"
  case "$provider" in
    anthropic)
      command="$(agent_value "$index" ANTHROPIC_COMMAND)"
      [ -n "$command" ] || command="$(agent_value "$index" CLAUDE_COMMAND)"
      ;;
    openai)
      command="$(agent_value "$index" OPENAI_COMMAND)"
      [ -n "$command" ] || command="$(agent_value "$index" CODEX_COMMAND)"
      ;;
    grok) command="$(agent_value "$index" GROK_COMMAND)" ;;
    local) command="$(agent_value "$index" LOCAL_COMMAND)" ;;
  esac
  [ -n "$command" ] || die "$(provider_label "$provider") is not configured for $(agent_value "$index" NAME)"
  printf '%s' "$command"
}

launch_command() {
  local index="$1" provider="$2" model="$3" command
  command="$(provider_command "$index" "$provider")"
  # Force Claude to the classic main-screen renderer inside the room so tmux
  # keeps scrollback and the native mirror can show/scroll history. The `--settings`
  # flag outranks user settings, so the user's global `tui` stays untouched.
  if [ "$provider" = anthropic ]; then
    command="$command --settings '{\"tui\":\"default\"}'"
  elif [ "$provider" = openai ]; then
    command="$command --no-alt-screen"
  elif [ "$provider" = grok ]; then
    command="$command --no-alt-screen"
  fi
  if [ "$ROOM_SUBSCRIPTION_ONLY" = 1 ]; then
    command="env -u OPENAI_API_KEY -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u XAI_API_KEY -u GROK_API_KEY -u CLAUDE_CODE_USE_BEDROCK -u CLAUDE_CODE_USE_VERTEX -u CLAUDE_CODE_USE_FOUNDRY $command"
  fi
  if [ "$model" = default ]; then
    printf '%s' "$command"
  else
    model_is_valid "$model" || die 'invalid model name'
    printf '%s --model %q' "$command" "$model"
  fi
}

provider_is_available() {
  local index="$1" provider command
  provider="$(normalise_provider "$2")" || return 1
  case "$provider" in
    anthropic)
      command="$(agent_value "$index" ANTHROPIC_COMMAND)"
      [ -n "$command" ] || command="$(agent_value "$index" CLAUDE_COMMAND)"
      ;;
    openai)
      command="$(agent_value "$index" OPENAI_COMMAND)"
      [ -n "$command" ] || command="$(agent_value "$index" CODEX_COMMAND)"
      ;;
    grok) command="$(agent_value "$index" GROK_COMMAND)" ;;
    local) command="$(agent_value "$index" LOCAL_COMMAND)" ;;
  esac
  [ -n "$command" ]
}

provider_state_file() {
  local room_key
  room_key="$(printf '%s' "$ROOM_SESSION" | tr -cs '[:alnum:]_.-' '_')"
  printf '%s/%s.providers' "$ROOM_STATE_DIR" "$room_key"
}

# A paused role is deliberately stopped — not broken. Keeping that distinct
# matters: `doctor` must not resurrect it, and the UI must not cry "process
# exited" over a decision the operator made on purpose.
paused_state_file() {
  local room_key
  room_key="$(printf '%s' "$ROOM_SESSION" | tr -cs '[:alnum:]_.-' '_')"
  printf '%s/%s.paused' "$ROOM_STATE_DIR" "$room_key"
}

agent_is_paused() {
  local index="$1" file
  file="$(paused_state_file)"
  [ -f "$file" ] || return 1
  grep -qx "$index" "$file" 2>/dev/null
}

set_paused_flag() {
  local index="$1" want="$2" file temp
  file="$(paused_state_file)"
  mkdir -p "$ROOM_STATE_DIR"
  [ -f "$file" ] || : > "$file"
  temp="$(mktemp "$ROOM_STATE_DIR/.paused.XXXXXX")"
  grep -vx "$index" "$file" 2>/dev/null > "$temp" || true
  [ "$want" = 1 ] && printf '%s\n' "$index" >> "$temp"
  chmod 600 "$temp"
  mv "$temp" "$file"
}

pause_agent() {
  local requested="$1" index pane name
  require_session
  index="$(resolve_index "$requested")" || die "unknown agent: $requested"
  name="$(agent_value "$index" NAME)"
  pane="$(pane_for_index "$index")"
  [ -n "$pane" ] || die "pane $index not found"
  memory_checkpoint "$index" 'pause' >/dev/null 2>&1 || true
  set_paused_flag "$index" 1
  tmux set-option -p -t "$pane" @agent_paused 1 2>/dev/null || true
  # Replace the CLI with a plain shell showing why it is idle, so the pane reads
  # as intentional rather than crashed.
  tmux respawn-pane -k -t "$pane" -c "$(agent_value "$index" DIR)" \
    "printf '\\033[2J\\033[H\\n  %s is PAUSED.\\n\\n  Resume it with:\\n    %s --config %s --session %s resume %s\\n\\n' \
     '$name' '$SCRIPT_PATH' '$CONFIG' '$ROOM_SESSION' '$index'; exec \$SHELL -l"
  printf '%s paused.\n' "$name"
}

resume_agent() {
  local requested="$1" index pane name
  require_session
  index="$(resolve_index "$requested")" || die "unknown agent: $requested"
  name="$(agent_value "$index" NAME)"
  pane="$(pane_for_index "$index")"
  [ -n "$pane" ] || die "pane $index not found"
  set_paused_flag "$index" 0
  tmux set-option -p -t "$pane" @agent_paused 0 2>/dev/null || true
  launch_agent "$index" "$pane" "$(selected_provider "$index")"
  printf '%s resumed.\n' "$name"
}

model_state_file() {
  local room_key
  room_key="$(printf '%s' "$ROOM_SESSION" | tr -cs '[:alnum:]_.-' '_')"
  printf '%s/%s.models' "$ROOM_STATE_DIR" "$room_key"
}

configured_model() {
  local index="$1" provider="$2" field model
  provider="$(normalise_provider "$provider")" || return 1
  field="$(printf '%s' "$provider" | tr '[:lower:]' '[:upper:]')_MODEL"
  model="$(agent_value "$index" "$field")"
  printf '%s' "${model:-default}"
}

model_is_valid() {
  [ "$1" = default ] || [[ "$1" =~ ^[A-Za-z0-9._:-]+$ ]]
}

selected_model() {
  local index="$1" provider="$2" file selected fallback
  provider="$(normalise_provider "$provider")" || return 1
  file="$(model_state_file)"
  fallback="$(configured_model "$index" "$provider")"
  selected=''
  [ ! -f "$file" ] || selected="$(awk -F '\t' -v wanted_index="$index" -v wanted_provider="$provider" '$1 == wanted_index && $2 == wanted_provider { print $3; exit }' "$file")"
  if [ -n "$selected" ] && model_is_valid "$selected"; then
    printf '%s' "$selected"
  else
    printf '%s' "$fallback"
  fi
}

remember_model() {
  local index="$1" provider="$2" requested="$3" file temp current current_provider
  provider="$(normalise_provider "$provider")" || die "unknown provider: $2"
  model_is_valid "$requested" || die 'model names may contain only letters, numbers, dots, colons, underscores, and hyphens'
  file="$(model_state_file)"
  mkdir -p "$ROOM_STATE_DIR"
  temp="$(mktemp "$ROOM_STATE_DIR/.model-routing.XXXXXX")"
  for current in $(agent_indices); do
    for current_provider in $(provider_names); do
      if [ "$current" = "$index" ] && [ "$current_provider" = "$provider" ]; then
        printf '%s\t%s\t%s\n' "$current" "$current_provider" "$requested" >> "$temp"
      else
        printf '%s\t%s\t%s\n' "$current" "$current_provider" "$(selected_model "$current" "$current_provider")" >> "$temp"
      fi
    done
  done
  chmod 600 "$temp"
  mv "$temp" "$file"
}

configured_provider() {
  local index="$1" configured
  configured="$(normalise_provider "$(agent_value "$index" PROVIDER)")" || die "invalid provider for $(agent_value "$index" NAME)"
  printf '%s' "$configured"
}

selected_provider() {
  local index="$1" file selected fallback
  file="$(provider_state_file)"
  fallback="$(configured_provider "$index")"
  [ -f "$file" ] || { printf '%s' "$fallback"; return; }
  selected="$(awk -F '\t' -v wanted="$index" '$1 == wanted { print $2; exit }' "$file")"
  selected="$(normalise_provider "$selected" 2>/dev/null || true)"
  if [ -n "$selected" ] && provider_is_available "$index" "$selected"; then
    printf '%s' "$selected"
  else
    printf '%s' "$fallback"
  fi
}

remember_provider() {
  local index="$1" requested="$2" file temp current
  requested="$(normalise_provider "$requested")" || die "unknown provider: $2"
  provider_is_available "$index" "$requested" || die "$(provider_label "$requested") is not configured for $(agent_value "$index" NAME)"
  file="$(provider_state_file)"
  mkdir -p "$ROOM_STATE_DIR"
  temp="$(mktemp "$ROOM_STATE_DIR/.provider-routing.XXXXXX")"
  for current in $(agent_indices); do
    if [ "$current" = "$index" ]; then
      printf '%s\t%s\n' "$current" "$requested" >> "$temp"
    else
      printf '%s\t%s\n' "$current" "$(selected_provider "$current")" >> "$temp"
    fi
  done
  chmod 600 "$temp"
  mv "$temp" "$file"
}

validate_workspace_isolation() {
  local first second first_dir second_dir shared=0 pairs=''
  for first in $(agent_indices); do
    first_dir="$(agent_value "$first" DIR)"
    for second in $(agent_indices); do
      [ "$second" -gt "$first" ] || continue
      second_dir="$(agent_value "$second" DIR)"
      if [ "$first_dir" = "$second_dir" ]; then
        shared=1
        pairs+="$(agent_value "$first" NAME) and $(agent_value "$second" NAME) → $first_dir; "
      fi
    done
  done
  [ "$shared" -eq 0 ] || [ "$ROOM_ALLOW_SHARED_WORKSPACES" = 1 ] ||
    die "shared workspaces are blocked ($pairs); use separate Git worktrees or explicitly set ROOM_ALLOW_SHARED_WORKSPACES=1"
}

report_shared_workspaces() {
  local first second first_dir second_dir found=0
  for first in $(agent_indices); do
    first_dir="$(agent_value "$first" DIR)"
    for second in $(agent_indices); do
      [ "$second" -gt "$first" ] || continue
      second_dir="$(agent_value "$second" DIR)"
      if [ "$first_dir" = "$second_dir" ]; then
        printf 'WARN shared workspace: %s and %s → %s\n' \
          "$(agent_value "$first" NAME)" "$(agent_value "$second" NAME)" "$first_dir"
        found=1
      fi
    done
  done
  return "$found"
}

validate_config() {
  local index field value
  case "$ROOM_AGENT_COUNT" in ''|*[!0-9]*) die 'ROOM_AGENT_COUNT must be an integer' ;; esac
  [ "$ROOM_AGENT_COUNT" -ge 1 ] && [ "$ROOM_AGENT_COUNT" -le 9 ] || die 'ROOM_AGENT_COUNT must be between 1 and 9'
  [ -d "$ROOM_ROOT" ] || die "project directory not found: $ROOM_ROOT"
  for index in $(agent_indices); do
    for field in SLOT NAME ROLE DIR PROVIDER COLOR; do
      value="$(agent_value "$index" "$field")"
      [ -n "$value" ] || die "AGENT_${index}_${field} manque dans $(basename "$CONFIG")"
    done
    [ -d "$(agent_value "$index" DIR)" ] || die "agent $index directory not found: $(agent_value "$index" DIR)"
    provider_command "$index" "$(configured_provider "$index")" >/dev/null
  done
  validate_workspace_isolation
}

require_tmux() {
  command -v tmux >/dev/null 2>&1 || die "tmux is missing — install it with: brew install tmux"
}

require_session() {
  require_tmux
  tmux has-session -t "$ROOM_SESSION" 2>/dev/null || die "session '$ROOM_SESSION' not found"
}

pane_for_index() {
  local index="$1"
  # Under `set -o pipefail`, a missing tmux session would fail this pipeline and
  # abort the caller (status --json, doctor helpers). Always succeed with empty.
  tmux list-panes -t "$ROOM_SESSION:agents" -F '#{@agent_index}|#{pane_id}' 2>/dev/null |
    awk -F '|' -v wanted="$index" '$1 == wanted { print $2; exit }' || true
}

pane_for_slot() {
  local slot="$1"
  tmux list-panes -t "$ROOM_SESSION:agents" -F '#{@agent_slot}|#{pane_id}' 2>/dev/null |
    awk -F '|' -v wanted="$slot" '$1 == wanted { print $2; exit }' || true
}

sidebar_pane() {
  tmux list-panes -t "$ROOM_SESSION:agents" -F '#{@agent_sidebar}|#{pane_id}' 2>/dev/null |
    awk -F '|' '$1 == 1 { print $2; exit }'
}

resolve_index() {
  local requested="${1:-}" index slot name
  if valid_agent_index "$requested"; then printf '%s\n' "$requested"; return; fi
  for index in $(agent_indices); do
    slot="$(agent_value "$index" SLOT)"
    name="$(agent_value "$index" NAME)"
    if [ "$requested" = "$slot" ] || [ "$requested" = "$name" ]; then
      printf '%s\n' "$index"
      return
    fi
  done
  return 1
}

clipboard_backend() {
  if command -v pbcopy >/dev/null 2>&1 && command -v pbpaste >/dev/null 2>&1; then
    printf '%s' 'macos'
  elif command -v wl-copy >/dev/null 2>&1 && command -v wl-paste >/dev/null 2>&1; then
    printf '%s' 'wayland'
  elif command -v xclip >/dev/null 2>&1; then
    printf '%s' 'x11'
  fi
}

paste_into_pane() {
  local pane="$1" index
  # Never dump clipboard into a bare shell — that is how prompts become shell
  # commands after a CLI exits (see AUDIT-BUGS CODEX-2).
  if ! agent_process_is_live "$pane"; then
    index="$(tmux show-option -p -v -t "$pane" @agent_index 2>/dev/null || true)"
    if [ -n "$index" ] && agent_is_paused "$index"; then
      die "agent $index is paused — resume it before pasting"
    fi
    die "agent CLI is not running in this pane (shell only) — run: paneshift doctor"
  fi
  case "$(clipboard_backend)" in
    macos) pbpaste | tmux load-buffer - ;;
    wayland) wl-paste --no-newline | tmux load-buffer - ;;
    x11) xclip -selection clipboard -o | tmux load-buffer - ;;
    *) die 'no supported clipboard command found' ;;
  esac
  tmux paste-buffer -t "$pane"
}

configure_clipboard() {
  local copy_command='' paste_command=''
  if command -v pbcopy >/dev/null 2>&1 && command -v pbpaste >/dev/null 2>&1; then
    copy_command='pbcopy'
    paste_command='pbpaste'
  elif command -v wl-copy >/dev/null 2>&1 && command -v wl-paste >/dev/null 2>&1; then
    copy_command='wl-copy'
    paste_command='wl-paste --no-newline'
  elif command -v xclip >/dev/null 2>&1; then
    copy_command='xclip -selection clipboard'
    paste_command='xclip -selection clipboard -o'
  fi

  [ -n "$copy_command" ] || return 0
  tmux set-option -s copy-command "$copy_command"
  tmux set-option -s set-clipboard on
  tmux set-option -s escape-time 10
  tmux set-window-option -t "$ROOM_SESSION" mode-keys emacs
  # Copy a mouse selection straight to the native clipboard, then leave tmux
  # copy mode so typing, deleting and pasting immediately return to the chat.
  tmux bind-key -T copy-mode MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel "$copy_command"
  tmux bind-key -T copy-mode-vi MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel "$copy_command"
  tmux bind-key -T copy-mode C-c send-keys -X copy-pipe-and-cancel "$copy_command"
  tmux bind-key -T copy-mode-vi C-c send-keys -X copy-pipe-and-cancel "$copy_command"
  tmux bind-key -T copy-mode Enter send-keys -X copy-pipe-and-cancel "$copy_command"
  tmux bind-key -T copy-mode-vi Enter send-keys -X copy-pipe-and-cancel "$copy_command"
  tmux bind-key -T copy-mode C-g send-keys -X cancel
  tmux bind-key -T copy-mode-vi C-g send-keys -X cancel
  tmux bind-key -T copy-mode C-v send-keys -X cancel
  tmux bind-key -T copy-mode-vi C-v send-keys -X cancel
  tmux bind-key -T copy-mode-vi y send-keys -X copy-pipe-and-cancel "$copy_command"
  tmux bind-key -T prefix v run-shell "$paste_command | tmux load-buffer - && tmux paste-buffer"
  tmux bind-key -n C-v run-shell "$paste_command | tmux load-buffer - && tmux paste-buffer"
  tmux bind-key -n M-BSpace send-keys C-w
  tmux bind-key -n C-BSpace send-keys C-w
  tmux bind-key -n M-DC send-keys M-d
  tmux bind-key -n M-Left send-keys M-b
  tmux bind-key -n M-Right send-keys M-f
}

bind_clickable_controls() {
  local room_click pane_click sidebar_click sidebar_resize sync_drag providers_click reset_click memory_detach next_pane previous_pane index pane_button
  room_click='"#{@agent_room_script}" --config "#{@agent_room_config}" --session "#{session_name}" room-menu'
  pane_click='"#{@agent_room_script}" --config "#{@agent_room_config}" --session "#{session_name}" pane-menu "#{mouse_pane}"'
  sidebar_click='"#{@agent_room_script}" --config "#{@agent_room_config}" --session "#{session_name}" sidebar-click "#{mouse_pane}" "#{mouse_y}"'
  sidebar_resize="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" sidebar-resize"
  sync_drag='"#{@agent_room_script}" --config "#{@agent_room_config}" --session "#{session_name}" sync-grid "#{mouse_y}"'
  providers_click='"#{@agent_room_script}" --config "#{@agent_room_config}" --session "#{session_name}" providers-menu'
  reset_click='"#{@agent_room_script}" --config "#{@agent_room_config}" --session "#{session_name}" reset-layout'
  memory_detach='"#{@agent_room_script}" --config "#{@agent_room_config}" --session "#{session_name}" memory-refresh detach 300'
  next_pane='"#{@agent_room_script}" --config "#{@agent_room_config}" --session "#{session_name}" next-pane'
  previous_pane='"#{@agent_room_script}" --config "#{@agent_room_config}" --session "#{session_name}" previous-pane'
  tmux bind-key -T root MouseDown1StatusLeft if-shell -F '#{@agent_room_script}' "run-shell '$room_click'" ''
  # Most terminals encode Ctrl+/ as Ctrl+_. Keep ordinary / available to each AI CLI.
  tmux bind-key -n C-_ run-shell "$room_click"
  tmux bind-key -n C-Tab run-shell "$next_pane"
  tmux bind-key -n C-S-Tab run-shell "$previous_pane"
  # Mouse forwarding does not focus the clicked pane by itself. Focus first so
  # clicks, Cmd+C and Cmd+V always apply to the terminal under the pointer.
  tmux bind-key -T root MouseDown1Pane if-shell -F '#{==:#{@agent_sidebar},1}' "run-shell '$sidebar_click'" 'select-pane -t "#{mouse_pane}" \; send-keys -M'
  tmux bind-key -T root MouseDown3Pane if-shell -F '#{@agent_room_script}' "run-shell '$pane_click'" 'send-keys -M'
  tmux bind-key -T root MouseDown1Border select-pane -M
  tmux bind-key -T root MouseDrag1Border resize-pane -M
  tmux bind-key -T root MouseDragEnd1Border run-shell "$sync_drag"
  tmux set-hook -t "$ROOM_SESSION" client-resized "run-shell '$sidebar_resize'"
  tmux set-hook -t "$ROOM_SESSION" client-detached "run-shell -b '$memory_detach'"
  # Status-bar cells: one per agent, then the two room-wide buttons. These used
  # to be pinned to Control4/Control5, which collided with agents 5 and 6 as soon
  # as the room grew past four. The buttons now sit after the last agent.
  local count slot
  count=0
  for index in $(agent_indices); do
    pane_button="\"#{@agent_room_script}\" --config \"#{@agent_room_config}\" --session \"#{session_name}\" pane-menu \"$index\""
    tmux bind-key -T root "MouseDown1Control$count" run-shell "$pane_button" 2>/dev/null || true
    count=$((count + 1))
  done
  tmux bind-key -T root "MouseDown1Control$count" run-shell "$providers_click" 2>/dev/null || true
  tmux bind-key -T root "MouseDown1Control$((count + 1))" run-shell "$reset_click" 2>/dev/null || true
  # Clear any stale cell above ours. An arithmetic loop, not `seq`: BSD seq
  # counts *down* when the start exceeds the end, so `seq 8 7` would have
  # unbound the reset button that was just assigned.
  slot=$((count + 2))
  while [ "$slot" -le 9 ]; do
    tmux unbind-key -T root "MouseDown1Control$slot" 2>/dev/null || true
    slot=$((slot + 1))
  done
}

apply_theme() {
  local popup window_id
  require_session
  tmux set-option -t "$ROOM_SESSION" mouse on
  tmux set-option -t "$ROOM_SESSION" status-left-length 34
  tmux set-option -t "$ROOM_SESSION" status-justify centre
  tmux set-option -t "$ROOM_SESSION" status-right-length 110
  tmux set-option -t "$ROOM_SESSION" @agent_room_script "$SCRIPT_PATH"
  tmux set-option -t "$ROOM_SESSION" @agent_room_config "$CONFIG"
  tmux set-option -t "$ROOM_SESSION" status on

  if [ "$ROOM_THEME" = 'red-sands' ]; then
    tmux set-option -t "$ROOM_SESSION" status-style "bg=$ROOM_DARK,fg=$ROOM_FG"
    tmux set-option -t "$ROOM_SESSION" status-left "#[bold,fg=$ROOM_DARK,bg=$ROOM_BOLD]  ◆ $ROOM_TITLE  #[default] "
    tmux set-option -t "$ROOM_SESSION" window-status-format "#[fg=$ROOM_FG]  #I · #W  "
    tmux set-option -t "$ROOM_SESSION" window-status-current-format "#[bold,fg=$ROOM_DARK,bg=$ROOM_BOLD]  #I · #W  #[default]"
    tmux set-option -t "$ROOM_SESSION" status-right "#[fg=$ROOM_FG]Ctrl+Tab next · Ctrl+/ commands · Ctrl+C copy · Ctrl+V paste  #[fg=$ROOM_BOLD,bold]%H:%M "
    tmux set-option -t "$ROOM_SESSION" message-style "bold,fg=$ROOM_DARK,bg=$ROOM_BOLD"
    while IFS= read -r window_id; do
      tmux set-option -w -t "$window_id" window-style "fg=$ROOM_FG,bg=$ROOM_BG"
      tmux set-option -w -t "$window_id" window-active-style "fg=$ROOM_FG,bg=$ROOM_BG"
      tmux set-option -w -t "$window_id" pane-border-style "fg=$ROOM_DARK,bg=$ROOM_BG"
      tmux set-option -w -t "$window_id" pane-active-border-style "bold,fg=$ROOM_ACCENT,bg=$ROOM_BG"
    done < <(tmux list-windows -t "$ROOM_SESSION" -F '#{window_id}')
    popup='"#{@agent_room_script}" --config "#{@agent_room_config}" --session "#{session_name}" menu'
    tmux bind-key -T prefix g display-popup -E -w 92% -h 88% -b rounded -S "fg=$ROOM_FG,bg=$ROOM_BG" "$popup"
  else
    tmux set-option -t "$ROOM_SESSION" status-style 'bg=colour234,fg=colour250'
    tmux set-option -t "$ROOM_SESSION" status-left "#[bold,fg=black,bg=colour45]  ◆ $ROOM_TITLE  #[default] "
    tmux set-option -t "$ROOM_SESSION" window-status-format '#[fg=colour244]  #I · #W  '
    tmux set-option -t "$ROOM_SESSION" window-status-current-format '#[bold,fg=black,bg=colour220]  #I · #W  #[default]'
    tmux set-option -t "$ROOM_SESSION" status-right '#[fg=colour250]Ctrl+Tab next · Ctrl+/ commands · Ctrl+C copy · Ctrl+V paste  #[fg=colour45,bold]%H:%M '
    tmux set-option -t "$ROOM_SESSION" message-style 'bold,fg=black,bg=colour220'
    while IFS= read -r window_id; do
      tmux set-option -w -t "$window_id" window-style default
      tmux set-option -w -t "$window_id" window-active-style default
      tmux set-option -w -t "$window_id" pane-border-style 'fg=colour240'
      tmux set-option -w -t "$window_id" pane-active-border-style 'bold,fg=colour45'
    done < <(tmux list-windows -t "$ROOM_SESSION" -F '#{window_id}')
    popup='"#{@agent_room_script}" --config "#{@agent_room_config}" --session "#{session_name}" menu'
    tmux bind-key -T prefix g display-popup -E -w 92% -h 88% -b rounded -S 'fg=colour250,bg=colour234' "$popup"
  fi

  while IFS= read -r window_id; do
    tmux set-option -w -t "$window_id" pane-border-status top
    tmux set-option -w -t "$window_id" pane-border-lines heavy
  done < <(tmux list-windows -t "$ROOM_SESSION" -F '#{window_id}')
  configure_clipboard
  bind_clickable_controls
}

detect_provider() {
  local index="$1" pane="$2" command current
  command="$(tmux display-message -p -t "$pane" '#{pane_current_command}')"
  current="$(tmux show-option -p -v -t "$pane" @agent_provider 2>/dev/null || true)"
  case "$command" in
    claude*) printf '%s' 'anthropic' ;;
    codex*) printf '%s' 'openai' ;;
    grok*) printf '%s' 'grok' ;;
    *)
      current="$(normalise_provider "$current" 2>/dev/null || true)"
      [ -n "$current" ] && printf '%s' "$current" || selected_provider "$index"
      ;;
  esac
}

decorate_pane() {
  local index="$1" pane="$2" provider="${3:-}" slot name role color symbol provider_name model memory_file
  slot="$(agent_value "$index" SLOT)"
  name="$(agent_value "$index" NAME)"
  role="$(agent_value "$index" ROLE)"
  color="$(agent_value "$index" COLOR)"
  [ -n "$provider" ] || provider="$(detect_provider "$index" "$pane")"
  provider="$(normalise_provider "$provider")" || die "unknown provider: $provider"
  provider_name="$(provider_label "$provider")"
  model="$(selected_model "$index" "$provider")"
  memory_file="$ROOM_STATE_DIR/memory/$slot/BOOTSTRAP.md"
  case "$index" in 1) symbol='①' ;; 2) symbol='②' ;; 3) symbol='③' ;; 4) symbol='④' ;; 5) symbol='⑤' ;; 6) symbol='⑥' ;; *) symbol="$index" ;; esac
  tmux set-option -p -t "$pane" @agent_index "$index"
  tmux set-option -p -t "$pane" @agent_slot "$slot"
  tmux set-option -p -t "$pane" @agent_name "$name"
  tmux set-option -p -t "$pane" @agent_provider "$provider"
  tmux set-option -p -t "$pane" @agent_model "$model"
  tmux set-option -p -t "$pane" @agent_runtime "$(provider_runtime "$provider")"
  tmux set-option -p -t "$pane" @agent_memory_file "$memory_file"
  tmux set-option -p -t "$pane" @agent_role "$role"
  tmux set-option -p -t "$pane" @agent_label "$name  ·  $provider_name / $model  ·  $role"
  tmux set-option -t "$ROOM_SESSION" "@agent_${index}_provider" "$provider_name"
  tmux set-option -t "$ROOM_SESSION" "@agent_${index}_pane" "$pane"
  if [ "$ROOM_THEME" = 'red-sands' ]; then
    tmux set-option -p -t "$pane" pane-border-style "fg=$ROOM_DARK,bg=$ROOM_BG"
    tmux set-option -p -t "$pane" pane-active-border-style "bold,fg=$ROOM_ACCENT,bg=$ROOM_BG"
  else
    tmux set-option -p -t "$pane" pane-border-style 'fg=colour240'
    tmux set-option -p -t "$pane" pane-active-border-style 'bold,fg=colour45'
  fi
  tmux set-option -p -t "$pane" pane-border-format "#[bold,fg=black,bg=$color]  #{?pane_active,●,○} $symbol #{@agent_label}  #[default]"
  tmux select-pane -t "$pane" -T "$name · $provider_name · $role"
}

decorate_existing_session() {
  local index slot pane
  for index in $(agent_indices); do
    slot="$(agent_value "$index" SLOT)"
    pane="$(pane_for_slot "$slot")"
    [ -n "$pane" ] || pane="$(tmux list-panes -t "$ROOM_SESSION:agents" -F '#{pane_id}' | sed -n "${index}p")"
    [ -n "$pane" ] && decorate_pane "$index" "$pane"
  done
}

launch_agent() {
  local index="$1" pane="$2" provider="${3:-}" slot model command launch memory_file theme_env=''
  slot="$(agent_value "$index" SLOT)"
  [ -n "$provider" ] || provider="$(selected_provider "$index")"
  model="$(selected_model "$index" "$provider")"
  command="$(launch_command "$index" "$provider" "$model")"
  memory_file="$(memory_bootstrap "$index")" || die "could not build memory bootstrap for $slot"
  [ "$ROOM_THEME" != 'light' ] || printf -v theme_env 'COLORFGBG=%q TERM_PROGRAM_BACKGROUND=%q ' '0;15' 'light'
  printf -v launch 'PATH=%q:$PATH AGENT_SLOT=%q AGENT_MEMORY_FILE=%q AGENT_ROOM_CONFIG=%q PANESHIFT_HOME=%q ROOM_SESSION=%q %s%s' "$ROOM_ROOT" "$slot" "$memory_file" "$CONFIG" "$SCRIPT_DIR" "$ROOM_SESSION" "$theme_env" "$command"
  tmux send-keys -t "$pane" -l "$launch"
  tmux send-keys -t "$pane" Enter
}

switch_agent() {
  local requested="$1" provider="$2" requested_model="${3:-}" index pane slot directory model command launch memory_file theme_env=''
  require_session
  index="$(resolve_index "$requested")" || die "unknown agent: $requested"
  provider="$(normalise_provider "$provider")" || die 'choose Anthropic, OpenAI, Grok, or Local'
  pane="$(pane_for_index "$index")"
  # A missing pane used to hard-fail; restore it so a previous layout glitch
  # cannot permanently remove a role from the room (audit: agent 4 vanished).
  if [ -z "$pane" ]; then
    pane="$(recreate_missing_agent_pane "$index")" || die "pane $index not found and could not be recreated"
  fi
  if pane_is_busy "$pane"; then
    die "$(agent_value "$index" NAME) is still working; finish the task before starting a new provider session"
  fi
  slot="$(agent_value "$index" SLOT)"
  directory="$(agent_value "$index" DIR)"
  model="${requested_model:-$(selected_model "$index" "$provider")}"
  model_is_valid "$model" || die 'invalid model name'
  command="$(launch_command "$index" "$provider" "$model")"
  memory_checkpoint "$index" 'provider-switch' || die "memory checkpoint failed; update the role handoff before switching provider"
  memory_file="$(memory_bootstrap "$index")" || die "memory bootstrap failed; provider switch cancelled to protect the current context"
  [ "$ROOM_THEME" != 'light' ] || printf -v theme_env 'COLORFGBG=%q TERM_PROGRAM_BACKGROUND=%q ' '0;15' 'light'
  printf -v launch 'PATH=%q:$PATH AGENT_SLOT=%q AGENT_MEMORY_FILE=%q AGENT_ROOM_CONFIG=%q PANESHIFT_HOME=%q ROOM_SESSION=%q %s%s' "$ROOM_ROOT" "$slot" "$memory_file" "$CONFIG" "$SCRIPT_DIR" "$ROOM_SESSION" "$theme_env" "$command"
  remember_provider "$index" "$provider"
  remember_model "$index" "$provider" "$model"
  tmux respawn-pane -k -t "$pane" -c "$directory" "$launch"
  # Confirm the pane still exists after respawn. A corrupted layout once dropped
  # agent 4 entirely during an audit switch; fail loudly instead of silent loss.
  sleep 0.15
  if ! tmux list-panes -t "$ROOM_SESSION:agents" -F '#{pane_id}' 2>/dev/null | grep -qx "$pane"; then
    die "provider switch removed pane $index — room layout is corrupted; recreate the session"
  fi
  decorate_pane "$index" "$pane" "$provider"
  printf '%s now uses %s.\n' "$(agent_value "$index" NAME)" "$(provider_label "$provider")"
}

# Split a new pane for a role that disappeared from the agents window. Layout
# will not be the original 3×2 until the next reset-layout / recreate, but the
# role becomes usable again instead of staying permanently missing.
recreate_missing_agent_pane() {
  local index="$1" anchor pane directory
  require_session
  directory="$(agent_value "$index" DIR)"
  [ -d "$directory" ] || return 1
  anchor="$(pane_for_index 1)"
  [ -n "$anchor" ] || anchor="$(tmux list-panes -t "$ROOM_SESSION:agents" -F '#{pane_id}' | head -1)"
  [ -n "$anchor" ] || return 1
  pane="$(tmux split-window -v -P -F '#{pane_id}' -t "$anchor" -c "$directory")"
  [ -n "$pane" ] || return 1
  decorate_pane "$index" "$pane" "$(selected_provider "$index")"
  # A bare split leaves the room as an orphan slice hanging off agent 1 instead
  # of the configured mosaic. Restore the saved layout so a repaired role looks
  # and behaves like the others.
  reset_layout >/dev/null 2>&1 || true
  printf '%s' "$pane"
}

confirm_switch() {
  local requested="$1" provider="$2" index pane name command
  require_session
  index="$(resolve_index "$requested")" || die "unknown agent: $requested"
  provider="$(normalise_provider "$provider")" || die 'choose Anthropic, OpenAI, Grok, or Local'
  pane="$(pane_for_index "$index")"
  [ -n "$pane" ] || die "pane $index not found"
  name="$(agent_value "$index" NAME)"
  if pane_is_busy "$pane"; then
    tmux display-message "$name is working · provider change cancelled to protect the active task"
    return
  fi
  command="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" switch \"$index\" \"$provider\""
  tmux display-menu -T " CONFIRM · $name " -t "$pane" -x C -y C \
    'Cancel' q '' \
    '' \
    "Start a fresh $(provider_label "$provider") session · closes this chat" o "run-shell '$command'"
}

provider_picker() {
  local requested="$1" index pane name provider model anthropic_command openai_command grok_command local_command model_command anthropic_mark openai_mark grok_mark local_mark
  local -a menu_items
  require_session
  index="$(resolve_index "$requested")" || die "unknown agent: $requested"
  pane="$(pane_for_index "$index")"
  [ -n "$pane" ] || die "pane $index not found"
  name="$(agent_value "$index" NAME)"
  provider="$(detect_provider "$index" "$pane")"
  model="$(selected_model "$index" "$provider")"
  anthropic_command="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" switch-confirm \"$index\" anthropic"
  openai_command="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" switch-confirm \"$index\" openai"
  grok_command="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" switch-confirm \"$index\" grok"
  [ "$provider" = anthropic ] && anthropic_mark='●' || anthropic_mark='○'
  [ "$provider" = openai ] && openai_mark='●' || openai_mark='○'
  [ "$provider" = grok ] && grok_mark='●' || grok_mark='○'
  menu_items=()
  if provider_is_available "$index" anthropic; then
    menu_items+=( "$anthropic_mark ANTHROPIC · Claude Code" a "run-shell '$anthropic_command'" )
  fi
  if provider_is_available "$index" openai; then
    menu_items+=( "$openai_mark OPENAI · Codex" o "run-shell '$openai_command'" )
  fi
  if provider_is_available "$index" grok; then
    menu_items+=( "$grok_mark GROK · Grok Build" g "run-shell '$grok_command'" )
  fi
  if provider_is_available "$index" local; then
    local_command="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" switch-confirm \"$index\" local"
    [ "$provider" = local ] && local_mark='●' || local_mark='○'
    menu_items+=( "$local_mark LOCAL · configured CLI" l "run-shell '$local_command'" )
  fi
  model_command="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" model-picker \"$index\""
  menu_items+=( '' "Model · $model" m "run-shell '$model_command'" '' 'Cancel' q '' )
  tmux display-menu -T " $name · ROUTE & MODEL " -t "$pane" -x C -y C "${menu_items[@]}"
}

confirm_model_switch() {
  local requested="$1" model="$2" index pane name provider command
  require_session
  index="$(resolve_index "$requested")" || die "unknown agent: $requested"
  model_is_valid "$model" || die 'invalid model name'
  pane="$(pane_for_index "$index")"
  [ -n "$pane" ] || die "pane $index not found"
  name="$(agent_value "$index" NAME)"
  provider="$(detect_provider "$index" "$pane")"
  if pane_is_busy "$pane"; then
    tmux display-message "$name is working · model change cancelled to protect the active task"
    return
  fi
  command="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" switch \"$index\" \"$provider\" \"$model\""
  tmux display-menu -T " CONFIRM · $name " -t "$pane" -x C -y C \
    'Cancel' q '' \
    '' \
    "Start a fresh $model session · closes this chat" o "run-shell '$command'"
}

model_picker() {
  local requested="$1" index pane name provider current field configured raw model command mark
  local -a menu_items models configured_models
  require_session
  index="$(resolve_index "$requested")" || die "unknown agent: $requested"
  pane="$(pane_for_index "$index")"
  [ -n "$pane" ] || die "pane $index not found"
  name="$(agent_value "$index" NAME)"
  provider="$(detect_provider "$index" "$pane")"
  current="$(selected_model "$index" "$provider")"
  configured="$(configured_model "$index" "$provider")"
  field="$(printf '%s' "$provider" | tr '[:lower:]' '[:upper:]')_MODELS"
  raw="$(agent_value "$index" "$field")"
  models=(default)
  if [ -n "$raw" ]; then
    IFS=',' read -r -a configured_models <<< "$raw"
    for model in "${configured_models[@]}"; do
      model="${model//[[:space:]]/}"
      model_is_valid "$model" && models+=("$model")
    done
  fi
  menu_items=()
  for model in "${models[@]}"; do
    [ "$model" = default ] && model="$configured"
    model_is_valid "$model" || continue
    [ "$model" = "$current" ] && mark='●' || mark='○'
    command="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" model-confirm \"$index\" \"$model\""
    menu_items+=("$mark $model" '' "run-shell '$command'")
  done
  menu_items+=( '' 'Cancel' q '' )
  tmux display-menu -T " $name · $provider · MODEL " -t "$pane" -x C -y C "${menu_items[@]}"
}

pane_menu() {
  local requested="$1" index pane name provider anthropic_command openai_command grok_command local_command local_switch reset_command paste_command
  local -a menu_items
  require_session
  if [ "${requested#%}" != "$requested" ]; then
    pane="$requested"
    index="$(tmux show-option -p -v -t "$pane" @agent_index 2>/dev/null || true)"
  else
    index="$(resolve_index "$requested")" || die "unknown agent: $requested"
    pane="$(pane_for_index "$index")"
  fi
  [ -n "$index" ] && [ -n "$pane" ] || die "pane not found"
  name="$(agent_value "$index" NAME)"
  provider="$(detect_provider "$index" "$pane")"
  anthropic_command="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" switch-confirm \"$index\" anthropic"
  openai_command="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" switch-confirm \"$index\" openai"
  grok_command="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" switch-confirm \"$index\" grok"
  reset_command="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" reset-layout"
  paste_command="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" paste \"$pane\""
  local_command="$(agent_value "$index" LOCAL_COMMAND)"
  menu_items=()
  if provider_is_available "$index" anthropic; then menu_items+=( 'Use Anthropic · Claude Code…' c "run-shell '$anthropic_command'" ); fi
  if provider_is_available "$index" openai; then menu_items+=( 'Use OpenAI · Codex…' x "run-shell '$openai_command'" ); fi
  if provider_is_available "$index" grok; then menu_items+=( 'Use Grok · Grok Build…' g "run-shell '$grok_command'" ); fi
  if [ -n "$local_command" ]; then
    local_switch="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" switch-confirm \"$index\" local"
    menu_items+=( 'Use a local provider…' l "run-shell '$local_switch'" )
  fi
  menu_items+=(
    ''
    '#{?window_zoomed_flag,Unzoom,Zoom}' z 'resize-pane -Z'
    'Reset layout' r "run-shell '$reset_command'"
    'Copy text' y 'copy-mode'
    'Paste' v "run-shell '$paste_command'"
    ''
    'Close menu' q ''
  )
  tmux display-menu -T " $name · $(provider_label "$provider") " -t "$pane" -x M -y M "${menu_items[@]}"
}

room_menu() {
  local index command providers memory reset
  local -a menu_items
  require_session
  providers="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" providers-menu"
  memory="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" memory-refresh manual 0"
  reset="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" reset-layout"
  menu_items=()
  for index in $(agent_indices); do
    command="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" focus \"$index\""
    menu_items+=("$(agent_symbol "$index") $(agent_value "$index" NAME) · $(provider_label "$(detect_provider "$index" "$(pane_for_index "$index")")")" "$index" "run-shell '$command'")
  done
  menu_items+=( '' 'Choose provider' p "run-shell '$providers'" 'Sync project memory' m "run-shell '$memory'" 'Reset layout' r "run-shell '$reset'" '' 'Tip: right-click an agent' '' '' 'Close menu' q '' )
  tmux display-menu -T " $ROOM_TITLE " -x 0 -y S "${menu_items[@]}"
}

session_elapsed() {
  local created now elapsed hours minutes
  created="$(tmux display-message -p -t "$ROOM_SESSION" '#{session_created}')"
  now="$(date +%s)"
  elapsed=$((now - created))
  hours=$((elapsed / 3600))
  minutes=$(((elapsed % 3600) / 60))
  printf '%dh %02dm' "$hours" "$minutes"
}

session_history_file() {
  local room_key
  room_key="$(printf '%s' "$ROOM_SESSION" | tr -cs '[:alnum:]_.-' '_')"
  printf '%s/%s.sessions.tsv' "$ROOM_STATE_DIR" "$room_key"
}

session_activity_file() {
  local room_key
  room_key="$(printf '%s' "$ROOM_SESSION" | tr -cs '[:alnum:]_.-' '_')"
  printf '%s/%s.activity.tsv' "$ROOM_STATE_DIR" "$room_key"
}

touch_session_history() {
  local file activity temp created now today
  created="$(tmux display-message -p -t "$ROOM_SESSION" '#{session_created}')"
  now="$(date +%s)"
  today="$(date +%F)"
  file="$(session_history_file)"
  activity="$(session_activity_file)"
  mkdir -p "$ROOM_STATE_DIR"
  [ -f "$file" ] || printf 'session\tstarted\tlast_seen\n' > "$file"
  temp="$(mktemp "$ROOM_STATE_DIR/.session-history.XXXXXX")"
  awk -F '\t' -v name="$ROOM_SESSION" -v started="$created" -v now="$now" '
    BEGIN { found=0 }
    NR == 1 { print; next }
    $1 == name && $2 == started { print $1 "\t" $2 "\t" now; found=1; next }
    { print }
    END { if (!found) print name "\t" started "\t" now }
  ' "$file" > "$temp"
  chmod 600 "$temp"
  mv "$temp" "$file"
  if ! awk -F '\t' -v day="$today" '$1 == day { found=1 } END { exit !found }' "$activity" 2>/dev/null; then
    printf '%s\t1\n' "$today" >> "$activity"
    chmod 600 "$activity"
  fi
}

session_metrics() {
  local file now longest count streak today epoch day
  file="$(session_history_file)"
  now="$(date +%s)"
  # Four fields always: the sidebar splits on '|' and a short record left the
  # streak empty, rendering as "0 sessions · d streak".
  [ -f "$file" ] || { printf '%s|%s|%s|%s' "$(session_elapsed)" '—' '0' '0'; return; }
  IFS='|' read -r longest count <<EOF
$(awk -F '\t' -v now="$now" 'NR > 1 { duration = $3 - $2; if (duration > max) max = duration; count++ } END { print max+0 "|" count+0 }' "$file")
EOF
  streak=0
  for ((epoch=now; ; epoch-=86400)); do
    day="$(epoch_to_day "$epoch")"
    [ -n "$day" ] || break
    if awk -F '\t' -v wanted="$day" '$1 == wanted { found=1 } END { exit !found }' "$(session_activity_file)" 2>/dev/null; then
      streak=$((streak + 1))
    else
      break
    fi
  done
  printf '%s|%s|%s|%s' "$(session_elapsed)" "$(duration_label "$longest")" "$count" "$streak"
}

duration_label() {
  local seconds="$1" hours minutes
  hours=$((seconds / 3600))
  minutes=$(((seconds % 3600) / 60))
  printf '%dh %02dm' "$hours" "$minutes"
}

epoch_to_day() {
  local epoch="$1"
  date -r "$epoch" +%F 2>/dev/null || date -d "@$epoch" +%F 2>/dev/null || printf ''
}

# Resolve the 7×12 activity calendar in a SINGLE awk pass over the activity and
# token files, instead of 2×84 per-cell awk scans on every 5s sidebar frame.
# Emits 7 lines of 12 level codes: ' ' future, '.' idle, 0 session/no-tokens,
# 1..4 token tiers. Shared by both the ANSI grid and the native renderer.
_grid_levels() {
  local now weekday row column days_ago epoch
  now="$(date +%s)"
  weekday="$(date +%u)"
  {
    for row in 1 2 3 4 5 6 7; do
      for column in {11..0}; do
        days_ago=$((column * 7 + weekday - row))
        if [ "$days_ago" -lt 0 ]; then
          printf '%s\t \n' "$row"
        else
          epoch=$((now - days_ago * 86400))
          printf '%s\t%s\n' "$row" "$(epoch_to_day "$epoch")"
        fi
      done
    done
  } | awk -F '\t' -v activity="$(session_activity_file)" -v daily="$(telemetry_daily_file)" '
    BEGIN {
      while ((getline line < activity) > 0) { split(line, a, "\t"); if (a[1] != "") active[a[1]] = 1 }
      while ((getline line < daily) > 0)    { split(line, d, "\t"); if (d[1] != "") tok[d[1]] = d[2] + 0 }
    }
    {
      row = $1; day = $2; lvl = "."
      if (day == " ") lvl = " "
      else if (day in active) {
        t = (day in tok) ? tok[day] : 0
        if      (t >= 1000000) lvl = "4"
        else if (t >= 250000)  lvl = "3"
        else if (t >= 50000)   lvl = "2"
        else if (t > 0)        lvl = "1"
        else                   lvl = "0"
      }
      grid[row] = grid[row] lvl
    }
    END { for (r = 1; r <= 7; r++) print grid[r] }
  '
}

activity_grid() {
  local line out i c
  while IFS= read -r line; do
    out=''
    for (( i = 0; i < ${#line}; i++ )); do
      c="${line:i:1}"
      case "$c" in
        4) out+="\033[38;5;34m█\033[0m" ;;
        3) out+="\033[38;5;35m▓\033[0m" ;;
        2) out+="\033[38;5;36m▒\033[0m" ;;
        1) out+="\033[38;5;37m░\033[0m" ;;
        0) out+="\033[38;5;151m░\033[0m" ;;
        .) out+="\033[38;5;245m·\033[0m" ;;
        *) out+=' ' ;;
      esac
    done
    printf '%s\n' "$out"
  done < <(_grid_levels)
}

cpu_usage() {
  local line idle used
  line="$(top -l 1 -n 0 2>/dev/null | awk '/CPU usage:/ { print; exit }')"
  idle="$(printf '%s' "$line" | sed -nE 's/.* ([0-9.]+)% idle.*/\1/p')"
  if [ -z "$idle" ]; then
    idle="$(top -bn1 2>/dev/null | awk -F'[, ]+' '/Cpu\(s\)/ { for (i=1; i<=NF; i++) if ($i ~ /^id/) { print $(i-1); exit } }')"
  fi
  [ -n "$idle" ] || { printf '%s' '—'; return; }
  used="$(awk -v idle="$idle" 'BEGIN { printf "%.0f", 100 - idle }')"
  printf '%s%%' "$used"
}

gpu_usage() {
  if command -v nvidia-smi >/dev/null 2>&1; then
    nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -1 | sed 's/$/%/'
  else
    printf '%s' '—'
  fi
}

ram_usage() {
  local total available
  # macOS has no `free`; the room's primary target is a Mac, so read the same
  # numbers from vm_stat/sysctl there and keep the Linux path for the OVH host.
  if [ "$(uname)" = Darwin ]; then
    total="$(sysctl -n hw.memsize 2>/dev/null || printf '')"
    available="$(vm_stat 2>/dev/null | awk '
      /page size of/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+$/) size = $i }
      /^Pages free:/ { gsub(/\./, "", $3); free = $3 }
      /^Pages inactive:/ { gsub(/\./, "", $3); inactive = $3 }
      /^Pages speculative:/ { gsub(/\./, "", $3); speculative = $3 }
      END { if (size > 0) printf "%.0f", (free + inactive + speculative) * size }')"
  else
    read -r total available <<EOF
$(free -b 2>/dev/null | awk '/^Mem:/ { print $2, $7; exit }')
EOF
  fi
  if [[ "${total:-}" =~ ^[0-9]+$ ]] && [[ "${available:-}" =~ ^[0-9]+$ ]] && [ "$total" -gt 0 ]; then
    awk -v total="$total" -v available="$available" 'BEGIN { printf "%.0f%%", 100 * (total - available) / total }'
  else
    printf '%s' '—'
  fi
}

ovh_usage_file() {
  printf '%s/ovh-usage.tsv' "$(telemetry_root)"
}

refresh_ovh_usage() {
  local output temp
  mkdir -p "$(telemetry_root)"
  output="$("$SCRIPT_DIR/ovh-usage.py" 2>/dev/null || printf unavailable)"
  temp="$(mktemp "$(telemetry_root)/.ovh-usage.XXXXXX")"
  printf '%s\t%s\n' "$(date +%s)" "$output" > "$temp"
  chmod 600 "$temp"
  mv "$temp" "$(ovh_usage_file)"
}

ovh_usage_summary() {
  local file timestamp status current forecast currency now
  file="$(ovh_usage_file)"
  now="$(date +%s)"
  timestamp="$(awk -F '\t' 'NR == 1 { print $1 }' "$file" 2>/dev/null || printf 0)"
  [[ "$timestamp" =~ ^[0-9]+$ ]] || timestamp=0
  if [ $((now - timestamp)) -ge "$OVH_USAGE_REFRESH_SECONDS" ]; then
    refresh_ovh_usage
  fi
  IFS=$'\t' read -r timestamp status current forecast currency < "$file" 2>/dev/null || true
  case "$status" in
    ok) printf '%s %s · forecast %s' "$current" "$currency" "$forecast" ;;
    unconfigured) printf '%s' 'à configurer' ;;
    *) printf '%s' 'indisponible' ;;
  esac
}

telemetry_root() {
  printf '%s/telemetry' "$ROOM_STATE_DIR"
}

telemetry_state_file() {
  printf '%s/%s.tokens.tsv' "$(telemetry_root)" "$(printf '%s' "$ROOM_SESSION" | tr -cs '[:alnum:]_.-' '_')"
}

telemetry_daily_file() {
  printf '%s/%s.tokens-by-day.tsv' "$(telemetry_root)" "$(printf '%s' "$ROOM_SESSION" | tr -cs '[:alnum:]_.-' '_')"
}

pane_descendants() {
  local pane="$1" root pending pid child
  root="$(tmux display-message -p -t "$pane" '#{pane_pid}' 2>/dev/null || true)"
  [ -n "$root" ] || return 0
  pending="$root"
  while [ -n "$pending" ]; do
    pid="${pending%% *}"
    pending="${pending#* }"
    [ "$pending" = "$pid" ] && pending=''
    printf '%s\n' "$pid"
    while IFS= read -r child; do
      [ -n "$child" ] && pending="$pending $child"
    done < <(pgrep -P "$pid" 2>/dev/null || true)
  done
}

# Percent-encodes a path the way the Grok CLI names its session directories.
percent_encode_path() {
  LC_ALL=C awk -v value="$1" 'BEGIN {
    for (i = 0; i < 256; i++) code[sprintf("%c", i)] = i
    n = length(value)
    for (i = 1; i <= n; i++) {
      c = substr(value, i, 1)
      if (c ~ /[A-Za-z0-9._~-]/) printf "%s", c
      else printf "%%%02X", code[c]
    }
  }'
}

# Every CLI keys its session storage on the agent's working directory, which is
# unique per worktree. Resolving by directory removes the previous dependency on
# `lsof` and `rg` being installed, which failed silently and reported 0 tokens.
open_token_log() {
  local pane="$1" provider="$2" index project_dir root session
  index="$(tmux show-option -p -v -t "$pane" @agent_index 2>/dev/null || true)"
  project_dir="$(agent_value "$index" DIR)"
  [ -n "$project_dir" ] || return 0

  case "$provider" in
    anthropic)
      root="$HOME/.claude/projects/$(printf '%s' "$project_dir" | LC_ALL=C tr -c 'A-Za-z0-9-' '-')"
      ;;
    openai)
      # Codex files sessions by date, not by directory; match on the `cwd`
      # recorded in each rollout's session_meta header.
      find "$HOME/.codex/sessions" -type f -name '*.jsonl' -print0 2>/dev/null |
        xargs -0 ls -t 2>/dev/null | head -40 |
        while IFS= read -r log; do
          [ "$(head -1 "$log" 2>/dev/null | jq -r '.payload.cwd // empty' 2>/dev/null)" = "$project_dir" ] || continue
          printf '%s\n' "$log"
          break
        done
      return
      ;;
    grok)
      root="$HOME/.grok/sessions/$(percent_encode_path "$project_dir")"
      session="$(find "$root" -mindepth 2 -maxdepth 2 -name 'updates.jsonl' -print0 2>/dev/null |
        xargs -0 ls -t 2>/dev/null | head -1)"
      [ -n "$session" ] && printf '%s' "$session"
      return
      ;;
    *) return 0 ;;
  esac

  [ -d "$root" ] || return 0
  find "$root" -type f -name '*.jsonl' -print0 2>/dev/null |
    xargs -0 ls -t 2>/dev/null | head -1
}

token_total_for_log() {
  local provider="$1" log="$2"
  [ -r "$log" ] || return 0
  case "$provider" in
    openai)
      jq -r 'select(.type == "event_msg" and .payload.type == "token_count") | .payload.info.total_token_usage.total_tokens // empty' "$log" 2>/dev/null | tail -1
      ;;
    anthropic)
      jq -sr '[.[] | select(.type == "assistant" and .message.usage and .uuid) | {id: .uuid, usage: .message.usage}] | unique_by(.id) | map((.usage.input_tokens // 0) + (.usage.cache_creation_input_tokens // 0) + (.usage.cache_read_input_tokens // 0) + (.usage.output_tokens // 0)) | add // 0' "$log" 2>/dev/null
      ;;
    grok)
      # Grok reports per-turn usage; the running session total is their sum.
      jq -sr '[.[] | .params.update.usage.totalTokens // empty] | add // 0' "$log" 2>/dev/null
      ;;
  esac
}

format_tokens() {
  local tokens="${1:-0}"
  awk -v value="$tokens" 'BEGIN {
    if (value >= 1000000) printf "%.1fM", value / 1000000
    else if (value >= 1000) printf "%.0fk", value / 1000
    else printf "%.0f", value
  }'
}

record_token_delta() {
  local index="$1" provider="$2" pane log total state daily previous delta today temp
  pane="$(pane_for_index "$index")"
  [ -n "$pane" ] || return 0
  log="$(open_token_log "$pane" "$provider")"
  [ -n "$log" ] || return 0
  total="$(token_total_for_log "$provider" "$log")"
  [[ "$total" =~ ^[0-9]+$ ]] || return 0
  mkdir -p "$(telemetry_root)"
  state="$(telemetry_state_file)"
  daily="$(telemetry_daily_file)"
  [ -f "$state" ] || : > "$state"
  [ -f "$daily" ] || : > "$daily"
  previous="$(awk -F '\t' -v wanted_index="$index" -v wanted_log="$log" '$1 == wanted_index && $2 == wanted_log { print $3; exit }' "$state" 2>/dev/null || true)"
  if [[ "$previous" =~ ^[0-9]+$ ]] && [ "$total" -ge "$previous" ]; then
    delta=$((total - previous))
  else
    # First observation captures the already completed work of this live code
    # session, then subsequent refreshes only add its true delta.
    delta="$total"
  fi
  today="$(date +%F)"
  temp="$(mktemp "$(telemetry_root)/.token-state.XXXXXX")"
  awk -F '\t' -v wanted_index="$index" -v wanted_log="$log" -v total="$total" '
    $1 == wanted_index && $2 == wanted_log { print wanted_index "\t" wanted_log "\t" total; found=1; next }
    { print }
    END { if (!found) print wanted_index "\t" wanted_log "\t" total }
  ' "$state" 2>/dev/null > "$temp"
  chmod 600 "$temp"
  mv "$temp" "$state"
  [ "$delta" -gt 0 ] || return 0
  temp="$(mktemp "$(telemetry_root)/.token-daily.XXXXXX")"
  awk -F '\t' -v day="$today" -v delta="$delta" '
    $1 == day { print day "\t" ($2 + delta); found=1; next }
    { print }
    END { if (!found) print day "\t" delta }
  ' "$daily" 2>/dev/null > "$temp"
  chmod 600 "$temp"
  mv "$temp" "$daily"
}

refresh_token_telemetry() {
  local index pane provider
  for index in $(agent_indices); do
    pane="$(pane_for_index "$index")"
    [ -n "$pane" ] || continue
    provider="$(detect_provider "$index" "$pane")"
    case "$provider" in anthropic|openai|grok) record_token_delta "$index" "$provider" ;; esac
  done
}

daily_tokens() {
  local day="$1"
  awk -F '\t' -v wanted="$day" '$1 == wanted { print ($2+0); found=1; exit } END { if (!found) print 0 }' "$(telemetry_daily_file)" 2>/dev/null || printf '0'
}

token_summary() {
  local total
  total="$(awk -F '\t' '{ sum += $2 } END { print sum+0 }' "$(telemetry_daily_file)" 2>/dev/null || printf 0)"
  printf '%s' "$(format_tokens "$total")"
}

session_momentum() {
  local created now elapsed_minutes
  created="$(tmux display-message -p -t "$ROOM_SESSION" '#{session_created}')"
  now="$(date +%s)"
  elapsed_minutes=$(((now - created) / 60))
  if [ "$elapsed_minutes" -ge 240 ]; then
    printf '%s' 'COMPOUNDING CONTEXT'
  elif [ "$elapsed_minutes" -ge 90 ]; then
    printf '%s' 'DEEP WORK IN FLOW'
  elif [ "$elapsed_minutes" -ge 15 ]; then
    printf '%s' 'MOMENTUM BUILDING'
  else
    printf '%s' 'MOMENTUM STARTING'
  fi
}

# Busy means "the agent is generating", not "the screen changed". Comparing two
# captures 300 ms apart used to call every idle TUI busy — a blinking cursor, a
# clock or a token counter was enough — which silently refused legitimate
# provider switches, model changes and shelve requests. Only the explicit
# interrupt affordances that all three CLIs print while working are trusted.
pane_is_busy() {
  local pane="$1"
  tmux capture-pane -p -t "$pane" 2>/dev/null |
    grep -Eqi 'esc to interrupt|ctrl\+c to stop|esc to cancel|working[[:space:].(]|cogitat|crunch|thinking|generating|compacting|running (tool|command)'
}

prepare_shelve() {
  local index pane busy=''
  require_session
  for index in $(agent_indices); do
    pane="$(pane_for_index "$index")"
    [ -n "$pane" ] || continue
    if pane_is_busy "$pane"; then
      busy="$busy ${index}:$(agent_value "$index" NAME)"
    fi
  done
  [ -z "$busy" ] || die "server remains online: active agent(s):${busy}"
  memory_run snapshot-room pre-shelve >/dev/null
  sync
  printf 'ready\n'
}

# Machine-readable version of the calendar for the native renderer: one line per
# weekday row of level codes. Delegates to the shared single-pass resolver so the
# tmux sidebar and the native app can never drift apart.
activity_grid_levels() {
  _grid_levels
}

# Read-only data feed for external renderers (e.g. the native macOS app). Emits
# the exact same values the tmux sidebar shows, from the same source functions.
sidebar_data() {
  require_session
  local index pane provider model color line elapsed longest count streak
  for index in $(agent_indices); do
    pane="$(pane_for_index "$index")"
    provider="$(detect_provider "$index" "$pane")"
    model="$(selected_model "$index" "$provider")"
    color="$(agent_value "$index" COLOR | sed 's/colour//')"
    printf 'AGENT\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$index" "$(agent_value "$index" NAME)" "$provider" "$model" "$color" \
      "$(agent_value "$index" ANTHROPIC_MODELS)" "$(agent_value "$index" OPENAI_MODELS)" \
      "$(agent_value "$index" GROK_MODELS)" \
      "$(provider_is_available "$index" anthropic && printf 1 || printf 0)" \
      "$(provider_is_available "$index" openai && printf 1 || printf 0)" \
      "$(provider_is_available "$index" grok && printf 1 || printf 0)" \
      "$(provider_is_available "$index" local && printf 1 || printf 0)"
  done
  IFS='|' read -r elapsed longest count streak <<EOF
$(session_metrics)
EOF
  printf 'SESSION\t%s\t%s\t%s\t%s\t%s\n' "$(session_momentum)" "$elapsed" "$longest" "$count" "$streak"
  printf 'SYSTEM\t%s\t%s\t%s\t%s\n' "$(cpu_usage)" "$(gpu_usage)" "$(token_summary)" "$(ram_usage)"
  printf 'OVH\t%s\n' "$(ovh_usage_summary)"
  printf 'MEMORY\t%s\n' "$(memory_health)"
  while IFS= read -r line; do printf 'GRID\t%s\n' "$line"; done < <(activity_grid_levels)
}

# True when the pane still runs an agent rather than an abandoned shell.
#
# `pane_current_command` alone is not enough: a provider can legitimately be
# launched through a shell wrapper, which reports as `bash`. So a shell in the
# foreground only counts as dead when it has no child process at all — which is
# exactly what a pane looks like after its CLI exits (observed on CODEX-2 when
# Codex quit on a usage limit).
agent_process_is_live() {
  local pane="$1" command pid
  command="$(tmux display-message -p -t "$pane" '#{pane_current_command}' 2>/dev/null || true)"
  case "$command" in
    ''|zsh|-zsh|bash|-bash|sh|-sh|fish|-fish|login) ;;
    *) return 0 ;;
  esac
  pid="$(tmux display-message -p -t "$pane" '#{pane_pid}' 2>/dev/null || true)"
  [ -n "$pid" ] || return 0
  [ -n "$(pgrep -P "$pid" 2>/dev/null || true)" ]
}

# Modification time in epoch seconds, GNU stat then BSD/macOS stat.
script_mtime() {
  stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1" 2>/dev/null || printf '0'
}

sidebar_view() {
  local index pane provider model live total handoffs claims conflicts sync_age runs now last_heartbeat=0 last_session_update=0 last_token_refresh=0 health elapsed longest session_count streak cpu gpu ram tokens ovh grid_line calendar_row day_label
  # This loop is long-lived: it keeps running the copy of the script that was on
  # disk when the room was created. Every later fix to the telemetry, the grid or
  # the health line stayed invisible until someone reinstalled the sidebar by
  # hand — Grok token accounting looked broken for a whole session for exactly
  # this reason. Re-exec when the script changes so a fix takes effect.
  local script_stamp
  script_stamp="$(script_mtime "$SCRIPT_PATH")"
  trap 'printf "\033[?25h"' EXIT INT TERM
  printf '\033[?25l'
  # Clear only once. Subsequent frames overwrite in place, avoiding the visual
  # flash of a terminal "hot reload" while keeping live metrics useful.
  printf '\033[2J\033[H'
  while tmux has-session -t "$ROOM_SESSION" 2>/dev/null; do
    now="$(date +%s)"
    if [ $((now - last_heartbeat)) -ge 60 ]; then
      memory_refresh heartbeat "$ROOM_MEMORY_HEARTBEAT_SECONDS" &
      last_heartbeat="$now"
    fi
    if [ $((now - last_session_update)) -ge 60 ]; then
      touch_session_history
      last_session_update="$now"
    fi
    if [ $((now - last_token_refresh)) -ge 30 ]; then
      refresh_token_telemetry
      last_token_refresh="$now"
      if [ "$(script_mtime "$SCRIPT_PATH")" != "$script_stamp" ]; then
        printf '\033[?25h\033[2J\033[H'
        exec "$SCRIPT_PATH" --config "$CONFIG" --session "$ROOM_SESSION" sidebar
      fi
    fi
    printf '\033[H'
    printf '\033[1;30;48;5;223m  PANESHIFT · CONTROL ROOM     \033[0m\033[K\n'
    printf '\033[K\n'
    printf '\033[1m  ROUTING · click to change\033[0m\033[K\n'
    for index in $(agent_indices); do
      pane="$(pane_for_index "$index")"
      provider="$(provider_label "$(detect_provider "$index" "$pane")")"
      model="$(selected_model "$index" "$(detect_provider "$index" "$pane")")"
      printf '\033[1;30;48;5;%sm  %s %-12s %-11.11s\033[0m\033[K\n' "$(agent_value "$index" COLOR | sed 's/colour//')" "$index" "$(agent_value "$index" NAME)" "$provider"
      printf '    %-28.28s▾\033[K\n' "$model"
    done
    health="$(memory_health)"
    IFS='|' read -r live total handoffs claims conflicts sync_age runs <<EOF
$health
EOF
    IFS='|' read -r elapsed longest session_count streak <<EOF
$(session_metrics)
EOF
    cpu="$(cpu_usage)"
    gpu="$(gpu_usage)"
    ram="$(ram_usage)"
    printf '\033[K\n'
    printf '\033[1m  SESSION\033[0m\033[K\n'
    printf '\033[1;37;48;5;31m  %-28s\033[0m\033[K\n' "$(session_momentum)"
    printf '  Now %s · longest %s\033[K\n' "$elapsed" "$longest"
    printf '  %s sessions · %s-day streak\033[K\n' "$session_count" "$streak"
    printf '\033[K\n'
    printf '\033[1m  SYSTEM\033[0m\033[K\n'
    printf '  CPU %s · RAM %s · GPU %s\033[K\n' "$cpu" "$ram" "$gpu"
    tokens="$(token_summary)"
    printf '  TOKENS %s · local logs\033[K\n' "$tokens"
    ovh="$(ovh_usage_summary)"
    printf '  OVH %s · ce mois\033[K\n' "$ovh"
    printf '\033[K\n'
    printf '\033[1m  MEMORY\033[0m\033[K\n'
    printf '  %s/%s live · %s/%s handoffs\033[K\n' "$live" "$total" "$handoffs" "$total"
    printf '  %s runs · %s claims · %s conflicts\033[K\n' "$runs" "$claims" "$conflicts"
    printf '  last sync %s\033[K\n' "$sync_age"
    printf '\033[1;30;48;5;117m  SYNC MEMORY                  \033[0m\033[K\n'
    printf '\033[K\n'
    printf '\033[1;30;48;5;250m  RESET LAYOUT                 \033[0m\033[K\n'
    printf '\033[K\n'
    printf '\033[1m  CODE SESSIONS · 12 WEEKS\033[0m\033[K\n'
    calendar_row=0
    while IFS= read -r grid_line; do
      case "$calendar_row" in 0) day_label=M ;; 1) day_label=T ;; 2) day_label=W ;; 3) day_label=T ;; 4) day_label=F ;; 5) day_label=S ;; *) day_label=S ;; esac
      printf '  %s %b\033[K\n' "$day_label" "$grid_line"
      calendar_row=$((calendar_row + 1))
    done < <(activity_grid)
    printf '  ░ session · ▒▓█ token volume\033[K\n'
    printf '\033[K\n'
    printf '  Ctrl+/ · room actions\033[K\n'
    # The frame is intentionally shorter than a tmux pane. Clear only its old
    # tail so a previous, taller frame cannot remain visibly duplicated below.
    printf '\033[J'
    sleep 5
  done
}

ensure_drop_hover() {
  local pid_file pid log_file
  [ "$ROOM_DROP_HOVER" = 1 ] || return 0
  [ "$(uname)" = Darwin ] || return 0
  [ -x "$SCRIPT_DIR/paneshift-hover" ] || return 0
  mkdir -p "$ROOM_STATE_DIR"
  pid_file="$ROOM_STATE_DIR/$(printf '%s' "$ROOM_SESSION" | tr -cs '[:alnum:]_.-' '_').drop-hover.pid"
  if [ -f "$pid_file" ]; then
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && return 0
  fi
  log_file="$ROOM_STATE_DIR/paneshift-drop-hover.log"
  # Ce helper ne tourne que sur macOS, donc uniquement pour une room dont tmux est
  # local : sans --remote explicite, une image déposée reste sur cette machine et
  # seul son chemin local est inséré. Renseigner ROOM_DROP_HOVER_REMOTE (et
  # éventuellement ROOM_DROP_HOVER_REMOTE_DIR) pour piloter une room distante.
  local -a hover_args
  hover_args=(--session "$ROOM_SESSION")
  if [ -n "${ROOM_DROP_HOVER_REMOTE:-}" ]; then
    hover_args+=(--remote "$ROOM_DROP_HOVER_REMOTE")
    [ -z "${ROOM_DROP_HOVER_REMOTE_DIR:-}" ] ||
      hover_args+=(--remote-dir "$ROOM_DROP_HOVER_REMOTE_DIR")
  fi
  nohup "$SCRIPT_DIR/paneshift-hover" "${hover_args[@]}" >>"$log_file" 2>&1 &
  printf '%s\n' "$!" > "$pid_file"
}

ensure_sidebar() {
  local pane active command
  require_session
  pane="$(sidebar_pane)"
  [ -z "$pane" ] || return 0
  active="$(tmux display-message -p -t "$ROOM_SESSION:agents" '#{pane_id}')"
  command="exec \"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" sidebar"
  pane="$(tmux split-window -h -f -l "$ROOM_SIDEBAR_WIDTH" -P -F '#{pane_id}' -t "$ROOM_SESSION:agents" -c "$ROOM_ROOT" "$command")"
  tmux set-option -p -t "$pane" @agent_sidebar 1
  tmux set-option -p -t "$pane" pane-border-format '#[bold,fg=black,bg=colour223]  ◈ PROVIDER ROUTING  #[default]'
  tmux select-pane -t "$pane" -T 'PROVIDER ROUTING'
  tmux select-pane -t "$active"
  balance_sidebar_grid
}

restart_sidebar() {
  local pane command
  require_session
  pane="$(sidebar_pane)"
  if [ -z "$pane" ]; then
    ensure_sidebar
    return
  fi
  command="exec \"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" sidebar"
  tmux respawn-pane -k -t "$pane" -c "$ROOM_ROOT" "$command"
}

resize_sidebar() {
  local pane
  require_session
  pane="$(sidebar_pane)"
  [ -z "$pane" ] || tmux resize-pane -t "$pane" -x "$ROOM_SIDEBAR_WIDTH"
}

balance_sidebar_grid() {
  local sidebar p1 p2 p3 grid_width grid_height left_width column_width top_height layout
  require_session
  sidebar="$(sidebar_pane)"
  if [ "$ROOM_AGENT_COUNT" -eq 6 ]; then
    p1="$(pane_for_index 1)"
    p2="$(pane_for_index 2)"
    p3="$(pane_for_index 3)"
    [ -n "$sidebar" ] && [ -n "$p1" ] && [ -n "$p2" ] && [ -n "$p3" ] || return 0
    grid_width="$(tmux display-message -p -t "$sidebar" '#{pane_left}')"
    column_width=$(((grid_width - 2) / 3))
    tmux resize-pane -t "$p1" -x "$column_width"
    tmux resize-pane -t "$p2" -x "$column_width"
    layout="$(tmux display-message -p -t "$ROOM_SESSION:agents" '#{window_layout}')"
    tmux set-option -t "$ROOM_SESSION" @agent_default_layout "$layout"
    return 0
  fi
  if [ "$ROOM_AGENT_COUNT" -ne 4 ]; then
    [ -z "$sidebar" ] || tmux set-option -t "$ROOM_SESSION" @agent_default_layout "$(tmux display-message -p -t "$ROOM_SESSION:agents" '#{window_layout}')"
    return 0
  fi
  p1="$(pane_for_index 1)"
  p2="$(pane_for_index 2)"
  p3="$(pane_for_index 3)"
  [ -n "$sidebar" ] && [ -n "$p1" ] && [ -n "$p2" ] && [ -n "$p3" ] || return 0
  grid_width="$(tmux display-message -p -t "$sidebar" '#{pane_left}')"
  grid_height="$(tmux display-message -p -t "$sidebar" '#{pane_height}')"
  left_width=$(((grid_width - 1) / 2))
  top_height=$(((grid_height - 1) / 2))
  tmux resize-pane -t "$p1" -x "$left_width"
  tmux resize-pane -t "$p2" -x "$left_width"
  tmux resize-pane -t "$p1" -y "$top_height"
  tmux resize-pane -t "$p3" -y "$top_height"
  layout="$(tmux display-message -p -t "$ROOM_SESSION:agents" '#{window_layout}')"
  tmux set-option -t "$ROOM_SESSION" @agent_default_layout "$layout"
}

sidebar_click() {
  local pane="$1" mouse_y="$2" pane_top local_y index sync_y reset_y
  require_session
  [ "$(tmux show-option -p -v -t "$pane" @agent_sidebar 2>/dev/null || true)" = 1 ] || return 0
  pane_top="$(tmux display-message -p -t "$pane" '#{pane_top}')"
  local_y=$((mouse_y - pane_top))
  if [ "$local_y" -ge 3 ] && [ "$local_y" -lt $((3 + ROOM_AGENT_COUNT * 2)) ]; then
    index=$(((local_y - 3) / 2 + 1))
    provider_picker "$index"
    return
  fi
  sync_y=$((18 + ROOM_AGENT_COUNT * 2))
  reset_y=$((20 + ROOM_AGENT_COUNT * 2))
  if [ "$local_y" -eq "$sync_y" ]; then memory_refresh manual 0; tmux display-message 'Project memory synced'
  elif [ "$local_y" -eq "$reset_y" ]; then reset_layout
  fi
}

providers_menu() {
  local index command
  local -a menu_items
  require_session
  menu_items=()
  for index in $(agent_indices); do
    command="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" provider-picker \"$index\""
    menu_items+=("$(agent_symbol "$index") $(agent_value "$index" NAME) · #{@agent_${index}_provider}" "$index" "run-shell '$command'")
  done
  menu_items+=( '' 'Cancel' q '' )
  tmux display-menu -T ' CHOOSE ROLE TO ROUTE ' -x C -y C "${menu_items[@]}"
}

reset_layout() {
  local layout
  require_session
  layout="$(tmux show-option -t "$ROOM_SESSION" -v @agent_default_layout 2>/dev/null || true)"
  if [ -n "$layout" ]; then
    tmux select-layout -t "$ROOM_SESSION:agents" "$layout" >/dev/null
  else
    tmux select-layout -t "$ROOM_SESSION:agents" tiled >/dev/null
  fi
}

sync_grid() {
  local mouse_y="${1:-0}" pane x y width height top_left='' bottom_left='' top_y=99999 bottom_y=-1 source target target_width
  require_session
  while IFS='|' read -r pane x y width height; do
    [ "$x" -eq 0 ] || continue
    if [ "$y" -lt "$top_y" ]; then
      top_y="$y"
      top_left="$pane"
    fi
    if [ "$y" -gt "$bottom_y" ]; then
      bottom_y="$y"
      bottom_left="$pane"
    fi
  done < <(tmux list-panes -t "$ROOM_SESSION:agents" -F '#{pane_id}|#{pane_left}|#{pane_top}|#{pane_width}|#{pane_height}')
  [ -n "$top_left" ] && [ -n "$bottom_left" ] || return 0
  if [ "$mouse_y" -lt "$bottom_y" ]; then
    source="$top_left"
    target="$bottom_left"
  else
    source="$bottom_left"
    target="$top_left"
  fi
  target_width="$(tmux display-message -p -t "$source" '#{pane_width}')"
  tmux resize-pane -t "$target" -x "$target_width"
}

create_session() {
  local first_pane pane index p1 p2 p3 p4 p5 p6
  validate_config
  require_tmux

  p1="$(tmux new-session -d -P -F '#{pane_id}' -s "$ROOM_SESSION" -n agents -c "$(agent_value 1 DIR)")"
  first_pane="$p1"
  if [ "$ROOM_AGENT_COUNT" -eq 6 ]; then
    p2="$(tmux split-window -h -P -F '#{pane_id}' -t "$p1" -c "$(agent_value 2 DIR)")"
    p3="$(tmux split-window -h -P -F '#{pane_id}' -t "$p2" -c "$(agent_value 3 DIR)")"
    tmux select-layout -t "$ROOM_SESSION:agents" even-horizontal >/dev/null
    p4="$(tmux split-window -v -P -F '#{pane_id}' -t "$p1" -c "$(agent_value 4 DIR)")"
    p5="$(tmux split-window -v -P -F '#{pane_id}' -t "$p2" -c "$(agent_value 5 DIR)")"
    p6="$(tmux split-window -v -P -F '#{pane_id}' -t "$p3" -c "$(agent_value 6 DIR)")"
  else
    index=2
    while [ "$index" -le "$ROOM_AGENT_COUNT" ]; do
      tmux split-window -P -F '#{pane_id}' -t "$ROOM_SESSION:agents" -c "$(agent_value "$index" DIR)" >/dev/null
      tmux select-layout -t "$ROOM_SESSION:agents" tiled >/dev/null
      index=$((index + 1))
    done
  fi
  tmux set-option -t "$ROOM_SESSION" @agent_count "$ROOM_AGENT_COUNT"
  for index in $(agent_indices); do
    if [ "$ROOM_AGENT_COUNT" -eq 6 ]; then eval "pane=\$p$index"
    else pane="$(tmux list-panes -t "$ROOM_SESSION:agents" -F '#{pane_id}' | sed -n "${index}p")"; fi
    decorate_pane "$index" "$pane" "$(selected_provider "$index")"
  done
  ensure_sidebar
  apply_theme
  ensure_drop_hover

  for index in $(agent_indices); do
    pane="$(pane_for_index "$index")"
    launch_agent "$index" "$pane" "$(selected_provider "$index")"
  done

  tmux select-window -t "$ROOM_SESSION:agents"
  tmux select-pane -t "$first_pane"
}

start_room() {
  memory_run init >/dev/null
  validate_config
  require_tmux
  if tmux has-session -t "$ROOM_SESSION" 2>/dev/null; then
    tmux set-option -t "$ROOM_SESSION" @agent_count "$ROOM_AGENT_COUNT"
    decorate_existing_session
    ensure_sidebar
    apply_theme
    ensure_drop_hover
    printf 'Session "%s" found — reconnecting.\n' "$ROOM_SESSION"
  else
    create_session
  fi
  if [ "$ATTACH" -eq 1 ]; then
    exec tmux attach -t "$ROOM_SESSION"
  fi
}

handoff_field() {
  local slot="$1" label="$2" file="$ROOM_HANDOFF_DIR/$slot.md" primary secondary
  [ -f "$file" ] || return 0
  case "$label" in
    Statut|Status) primary='Statut'; secondary='Status' ;;
    Tâche|Task) primary='Tâche'; secondary='Task' ;;
    *) primary="$label"; secondary="$label" ;;
  esac
  awk -v primary="$primary" -v secondary="$secondary" '
    $0 ~ "^- " primary " ?: " { sub("^- " primary " ?: ", ""); print; exit }
    $0 ~ "^- " secondary " ?: " { sub("^- " secondary " ?: ", ""); print; exit }
  ' "$file"
}

# Human health label for a pane: live | busy | dead | paused | missing
agent_health_label() {
  local index="$1" pane="$2"
  [ -n "$pane" ] || { printf 'missing'; return; }
  if agent_is_paused "$index"; then printf 'paused'; return; fi
  if pane_is_busy "$pane"; then printf 'busy'; return; fi
  if agent_process_is_live "$pane"; then printf 'live'; return; fi
  printf 'dead'
}

status_room() {
  local index pane command active dead slot name role provider state task marker health
  require_session
  printf '\n  %s\n' "$ROOM_TITLE"
  printf '  %-28s %-10s %-8s %-12s %s\n' 'TERMINAL' 'PROCESS' 'HEALTH' 'STATE' 'TASK'
  printf '  %s\n' '────────────────────────────────────────────────────────────────────────────────────────'
  for index in $(agent_indices); do
    pane="$(pane_for_index "$index")"
    slot="$(agent_value "$index" SLOT)"
    name="$(agent_value "$index" NAME)"
    role="$(agent_value "$index" ROLE)"
    if [ -n "$pane" ]; then
      provider="$(detect_provider "$index" "$pane")"
      IFS='|' read -r command active dead <<EOF
$(tmux display-message -p -t "$pane" '#{pane_current_command}|#{pane_active}|#{pane_dead}')
EOF
      health="$(agent_health_label "$index" "$pane")"
      state="$(handoff_field "$slot" 'Statut')"
      task="$(handoff_field "$slot" 'Tâche')"
      [ -n "$state" ] || state="$([ "$dead" = 1 ] && printf 'stopped' || printf 'active')"
      [ -n "$task" ] || task='—'
      [ "$active" = 1 ] && marker='●' || marker='○'
      printf '  %s %-26s %-10s %-8s %-12s %.48s\n' "$marker" "$name · $(provider_label "$provider")" "$command" "$health" "$state" "$task"
    else
      printf '  ! %-26s %-10s %-8s %-12s %s\n' "$name · $role" '—' 'missing' '—' 'pane not found'
    fi
  done
  printf '\n  Theme: %s · menu: Ctrl+/ · paste: Ctrl+V · doctor if HEALTH=dead\n\n' "$ROOM_THEME"
}

# Machine-readable room status for OpenClaw / Telegram / external tools.
# Usage: paneshift status --json   (or  paneshift status-json)
status_json() {
  local index pane command slot name role provider state task health model
  local session_ok=0 tmp
  if tmux has-session -t "$ROOM_SESSION" 2>/dev/null; then session_ok=1; fi
  tmp="$(mktemp "${TMPDIR:-/tmp}/paneshift-status.XXXXXX")"
  {
    printf '%s\t%s\n' session "$ROOM_SESSION"
    printf '%s\t%s\n' title "$ROOM_TITLE"
    printf '%s\t%s\n' config "$CONFIG"
    printf '%s\t%s\n' session_live "$session_ok"
    printf '%s\t%s\n' generated_at "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    for index in $(agent_indices); do
      pane="$(pane_for_index "$index")"
      slot="$(agent_value "$index" SLOT)"
      name="$(agent_value "$index" NAME)"      role="$(agent_value "$index" ROLE)"
      if [ -n "$pane" ]; then
        provider="$(detect_provider "$index" "$pane")"
        command="$(tmux display-message -p -t "$pane" '#{pane_current_command}' 2>/dev/null || true)"
        health="$(agent_health_label "$index" "$pane")"
        model="$(selected_model "$index" "$provider" 2>/dev/null || true)"
      else
        provider="$(agent_value "$index" PROVIDER)"
        command=''
        health='missing'
        model=''
        pane=''
      fi
      state="$(handoff_field "$slot" 'Statut')"
      task="$(handoff_field "$slot" 'Tâche')"
      # agent fields: index slot name role provider model process health handoff task pane
      printf 'agent\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$index" "$slot" "$name" "$role" "$provider" "${model:-}" "${command:-}" \
        "$health" "${state:-}" "${task:-}" "${pane:-}"
    done
  } > "$tmp"
  python3 - "$tmp" <<'PY'
import json, sys
path = sys.argv[1]
meta = {}
agents = []
with open(path, encoding="utf-8") as f:
    for line in f:
        line = line.rstrip("\n")
        if not line:
            continue
        parts = line.split("\t")
        key = parts[0]
        if key == "agent":
            # index slot name role provider model process health handoff task pane
            _, index, slot, name, role, provider, model, process, health, handoff, task, pane = (parts + [""] * 12)[:12]
            agents.append({
                "index": int(index),
                "slot": slot,
                "name": name,
                "role": role,
                "provider": provider or None,
                "model": model or None,
                "process": process or None,
                "health": health,
                "handoff_status": handoff or None,
                "task": task or None,
                "pane": pane or None,
            })
        else:
            meta[key] = parts[1] if len(parts) > 1 else ""
meta["schema"] = 1
meta["product"] = "paneshift"
meta["session_live"] = meta.get("session_live") == "1"
meta["agents"] = agents
print(json.dumps(meta, ensure_ascii=False, separators=(",", ":")))
PY
  rm -f "$tmp"
}

switch_menu() {
  local index provider_key provider confirm
  clear
  status_room
  printf '  Terminal to switch [1-%s]: ' "$ROOM_AGENT_COUNT"
  IFS= read -r -n 1 index
  printf '\n  Provider [c] Anthropic · [x] OpenAI · [g] Grok: '
  IFS= read -r -n 1 provider_key
  printf '\n'
  case "$provider_key" in c|C) provider='anthropic' ;; x|X) provider='openai' ;; g|G) provider='grok' ;; *) return ;; esac
  printf '  Start a fresh %s session for %s? This closes the current chat. [y/N] ' "$(provider_label "$provider")" "$(agent_value "$index" NAME)"
  IFS= read -r -n 1 confirm
  printf '\n'
  case "$confirm" in o|O|y|Y) switch_agent "$index" "$provider" ;; esac
}

paste_room() {
  local pane="${1:-}"
  require_session
  [ -n "$pane" ] || pane="$(tmux display-message -p -t "$ROOM_SESSION:agents" '#{pane_id}')"
  paste_into_pane "$pane"
}

focus_room() {
  local index pane
  require_session
  index="$(resolve_index "${1:-}")" || die "unknown agent: ${1:-}"
  pane="$(pane_for_index "$index")"
  [ -n "$pane" ] || die "pane $index not found"
  tmux select-window -t "$ROOM_SESSION:agents"
  tmux select-pane -t "$pane"
}

focus_adjacent_room() {
  local direction="${1:-next}" current_index target_index pane
  require_session
  current_index="$(tmux display-message -p -t "$ROOM_SESSION:agents" '#{@agent_index}')"
  valid_agent_index "$current_index" || current_index=1
  case "$direction" in
    next|right) target_index=$((current_index % ROOM_AGENT_COUNT + 1)) ;;
    previous|prev|left) target_index=$(((current_index + ROOM_AGENT_COUNT - 2) % ROOM_AGENT_COUNT + 1)) ;;
    *) die "unknown pane direction: $direction" ;;
  esac
  pane="$(pane_for_index "$target_index")"
  [ -n "$pane" ] || die "pane $target_index not found"
  tmux select-window -t "$ROOM_SESSION:agents"
  tmux select-pane -t "$pane"
}

zoom_room() {
  local index pane
  index="$(resolve_index "${1:-}")" || die "unknown agent: ${1:-}"
  focus_room "$index"
  pane="$(pane_for_index "$index")"
  tmux resize-pane -Z -t "$pane"
}

menu_room() {
  local key index
  while :; do
    clear
    status_room
    for index in $(agent_indices); do
      printf '  [%s] %-18s' "$index" "$(agent_value "$index" NAME)"
      [ $((index % 2)) -eq 0 ] && printf '\n'
    done
    [ $((ROOM_AGENT_COUNT % 2)) -eq 0 ] || printf '\n'
    printf '  [s] Change provider  [q] Close\n\n  Choice: '
    IFS= read -r -n 1 key
    printf '\n'
    case "$key" in
      [1-9]) if valid_agent_index "$key"; then focus_room "$key"; return; fi ;;
      s|S) switch_menu; return ;;
      q|Q) return ;;
    esac
  done
}

doctor_room() {
  local index pane errors=0 repaired=0
  validate_config
  require_session
  local command
  for index in $(agent_indices); do
    pane="$(pane_for_index "$index")"
    if [ -z "$pane" ]; then
      printf 'ERR agent %s → pane missing — attempting repair\n' "$index"
      if pane="$(recreate_missing_agent_pane "$index")" && [ -n "$pane" ]; then
        launch_agent "$index" "$pane" "$(selected_provider "$index")"
        printf 'FIX agent %s → recreated as %s and relaunched\n' "$index" "$pane"
        repaired=$((repaired + 1))
      else
        errors=$((errors + 1))
      fi
      continue
    fi
    if agent_is_paused "$index"; then
      printf 'OK  agent %s → pane %s (paused on purpose)\n' "$index" "$pane"
      continue
    fi
    # A live pane is not a live agent. A CLI that exits leaves the pane on a
    # bare shell, where every prompt is executed as a shell command instead of
    # reaching an agent.
    command="$(tmux display-message -p -t "$pane" '#{pane_current_command}' 2>/dev/null || true)"
    if agent_process_is_live "$pane"; then
      printf 'OK  agent %s → pane %s (%s)\n' "$index" "$pane" "${command:-unknown}"
      continue
    fi
    printf 'ERR agent %s → pane %s alive but CLI exited (now %s) — relaunching\n' \
      "$index" "$pane" "${command:-unknown}"
    launch_agent "$index" "$pane" "$(selected_provider "$index")"
    sleep 0.6
    if agent_process_is_live "$pane"; then
      printf 'FIX agent %s → %s restarted (%s)\n' "$index" "$pane" \
        "$(tmux display-message -p -t "$pane" '#{pane_current_command}' 2>/dev/null || true)"
      repaired=$((repaired + 1))
    else
      printf 'ERR agent %s → relaunch did not stick; check the provider quota or its login state\n' "$index"
      errors=$((errors + 1))
    fi
  done
  report_shared_workspaces || true
  if [ -x "$ROOM_MEMORY_SCRIPT" ]; then
    "$ROOM_MEMORY_SCRIPT" --config "$CONFIG" --session "$ROOM_SESSION" doctor || errors=$((errors + 1))
  else
    printf 'ERR memory engine missing: %s\n' "$ROOM_MEMORY_SCRIPT"
    errors=$((errors + 1))
  fi
  [ "$repaired" -eq 0 ] || printf 'INFO repaired %s missing pane(s)\n' "$repaired"
  [ "$errors" -eq 0 ] || die "$errors problem(s) found"
}

show_help() {
  cat <<EOF
PaneShift — tmux agent grid with a control sidebar

  $(basename "$0")                         create or join the Control Room
  $(basename "$0") --config FILE          use another team configuration
  $(basename "$0") status                 show all configured agents
  $(basename "$0") status --json          machine-readable status (OpenClaw / Telegram)
  $(basename "$0") menu                   open the interactive menu
  $(basename "$0") focus <index|slot>     focus an agent
  $(basename "$0") next-pane              focus the next terminal
  $(basename "$0") previous-pane          focus the previous terminal
  $(basename "$0") zoom <index|slot>      focus and zoom an agent
  $(basename "$0") switch <slot> <provider> start a fresh Anthropic, OpenAI, Grok, or Local session
  $(basename "$0") model-picker <slot>       choose a configured model for one provider
  $(basename "$0") reset-layout           restore the equal tiled grid
  $(basename "$0") paste [pane]           paste using the system clipboard
  $(basename "$0") memory-refresh         snapshot and rebuild all live memory
  $(basename "$0") prepare-shelve         refuse busy agents, snapshot all roles, sync disk
  $(basename "$0") sidebar-install        add the sidebar to an existing session
  $(basename "$0") theme                  reapply the configured live theme
  $(basename "$0") doctor                 verify all configured panes

Active configuration: $CONFIG
EOF
}

ACTION="${1:-start}"
case "$ACTION" in
  start|attach) start_room ;;
  status)
    if [ "${2:-}" = '--json' ] || [ "${2:-}" = '-j' ] || [ "${2:-}" = 'json' ]; then
      status_json
    else
      status_room
    fi
    ;;
  status-json) status_json ;;
  menu) menu_room ;;
  focus) focus_room "${2:-}" ;;
  next-pane) focus_adjacent_room next ;;
  previous-pane) focus_adjacent_room previous ;;
  zoom) zoom_room "${2:-}" ;;
  switch) switch_agent "${2:-}" "${3:-}" "${4:-}" ;;
  switch-confirm) confirm_switch "${2:-}" "${3:-}" ;;
  provider-picker) provider_picker "${2:-}" ;;
  model-picker) model_picker "${2:-}" ;;
  model-confirm) confirm_model_switch "${2:-}" "${3:-}" ;;
  pane-menu) pane_menu "${2:-}" ;;
  room-menu) room_menu ;;
  providers-menu) providers_menu ;;
  sidebar) sidebar_view ;;
  sidebar-data) sidebar_data ;;
  sidebar-click) sidebar_click "${2:-}" "${3:-0}" ;;
  sidebar-install) restart_sidebar; decorate_existing_session; apply_theme ;;
  hover-install) ensure_drop_hover ;;
  sidebar-balance) balance_sidebar_grid ;;
  sidebar-resize) resize_sidebar ;;
  paste) paste_room "${2:-}" ;;
  memory-refresh) memory_refresh "${2:-manual}" "${3:-0}" ;;
  prepare-shelve) prepare_shelve ;;
  reset-layout) reset_layout ;;
  sync-grid) sync_grid "${2:-0}" ;;
  theme) decorate_existing_session; apply_theme ;;
  doctor) doctor_room ;;
  pause) pause_agent "${2:-}" ;;
  resume) resume_agent "${2:-}" ;;
  help|-h|--help) show_help ;;
  *) die "unknown command: $ACTION" ;;
esac
