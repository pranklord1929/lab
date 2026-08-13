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
ROOM_MEMORY_HEARTBEAT_SECONDS="${ROOM_MEMORY_HEARTBEAT_SECONDS:-900}"
ROOM_ALLOW_SHARED_WORKSPACES="${ROOM_ALLOW_SHARED_WORKSPACES:-0}"
ROOM_DROP_HOVER="${ROOM_DROP_HOVER:-1}"
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

memory_run() {
  [ -x "$ROOM_MEMORY_SCRIPT" ] || return 0
  "$ROOM_MEMORY_SCRIPT" --config "$CONFIG" --session "$ROOM_SESSION" "$@"
}

memory_bootstrap() {
  local output
  output="$(memory_run bootstrap "$1" 2>/dev/null || true)"
  printf '%s' "$output"
}

memory_snapshot() {
  memory_run snapshot "$1" "${2:-manual}" >/dev/null 2>&1 || true
}

memory_refresh() {
  local reason="${1:-manual}" minimum_age="${2:-0}"
  memory_run snapshot-room "$reason" "$minimum_age" >/dev/null 2>&1 || true
}

memory_health() {
  memory_run health 2>/dev/null || printf '0|4|0|0|0|never|0'
}

normalise_provider() {
  case "$1" in
    anthropic|claude) printf '%s' 'anthropic' ;;
    openai|codex) printf '%s' 'openai' ;;
    local) printf '%s' 'local' ;;
    *) return 1 ;;
  esac
}

provider_label() {
  case "$1" in
    anthropic) printf 'ANTHROPIC' ;;
    openai) printf 'OPENAI' ;;
    local) printf 'LOCAL' ;;
    *) printf '%s' "$1" | tr '[:lower:]' '[:upper:]' ;;
  esac
}

provider_runtime() {
  case "$1" in
    anthropic) printf 'Claude Code' ;;
    openai) printf 'Codex' ;;
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
    local) command="$(agent_value "$index" LOCAL_COMMAND)" ;;
  esac
  [ -n "$command" ]
}

provider_state_file() {
  local room_key
  room_key="$(printf '%s' "$ROOM_SESSION" | tr -cs '[:alnum:]_.-' '_')"
  printf '%s/%s.providers' "$ROOM_STATE_DIR" "$room_key"
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
  for current in 1 2 3 4; do
    for current_provider in anthropic openai local; do
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
  for current in 1 2 3 4; do
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
  for first in 1 2 3 4; do
    first_dir="$(agent_value "$first" DIR)"
    for second in 1 2 3 4; do
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
  for first in 1 2 3 4; do
    first_dir="$(agent_value "$first" DIR)"
    for second in 1 2 3 4; do
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
  [ -d "$ROOM_ROOT" ] || die "project directory not found: $ROOM_ROOT"
  for index in 1 2 3 4; do
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
  tmux list-panes -t "$ROOM_SESSION:agents" -F '#{@agent_index}|#{pane_id}' 2>/dev/null |
    awk -F '|' -v wanted="$index" '$1 == wanted { print $2; exit }'
}

pane_for_slot() {
  local slot="$1"
  tmux list-panes -t "$ROOM_SESSION:agents" -F '#{@agent_slot}|#{pane_id}' 2>/dev/null |
    awk -F '|' -v wanted="$slot" '$1 == wanted { print $2; exit }'
}

sidebar_pane() {
  tmux list-panes -t "$ROOM_SESSION:agents" -F '#{@agent_sidebar}|#{pane_id}' 2>/dev/null |
    awk -F '|' '$1 == 1 { print $2; exit }'
}

resolve_index() {
  local requested="${1:-}" index slot name
  case "$requested" in 1|2|3|4) printf '%s\n' "$requested"; return ;; esac
  for index in 1 2 3 4; do
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
  local pane="$1"
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
  for index in 1 2 3 4; do
    pane_button="\"#{@agent_room_script}\" --config \"#{@agent_room_config}\" --session \"#{session_name}\" pane-menu \"$index\""
    tmux bind-key -T root "MouseDown1Control$((index - 1))" run-shell "$pane_button" 2>/dev/null || true
  done
  tmux bind-key -T root MouseDown1Control4 run-shell "$providers_click" 2>/dev/null || true
  tmux bind-key -T root MouseDown1Control5 run-shell "$reset_click" 2>/dev/null || true
  tmux unbind-key -T root MouseDown1Control6 2>/dev/null || true
  tmux unbind-key -T root MouseDown1Control7 2>/dev/null || true
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
  case "$index" in 1) symbol='①' ;; 2) symbol='②' ;; 3) symbol='③' ;; 4) symbol='④' ;; esac
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
  for index in 1 2 3 4; do
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
  memory_file="$(memory_bootstrap "$index")"
  [ "$ROOM_THEME" != 'light' ] || printf -v theme_env 'COLORFGBG=%q TERM_PROGRAM_BACKGROUND=%q ' '0;15' 'light'
  printf -v launch 'AGENT_SLOT=%q AGENT_MEMORY_FILE=%q AGENT_ROOM_CONFIG=%q PANESHIFT_HOME=%q ROOM_SESSION=%q %s%s' "$slot" "$memory_file" "$CONFIG" "$SCRIPT_DIR" "$ROOM_SESSION" "$theme_env" "$command"
  tmux send-keys -t "$pane" -l "$launch"
  tmux send-keys -t "$pane" Enter
}

switch_agent() {
  local requested="$1" provider="$2" requested_model="${3:-}" index pane slot directory model command launch memory_file theme_env=''
  require_session
  index="$(resolve_index "$requested")" || die "unknown agent: $requested"
  provider="$(normalise_provider "$provider")" || die 'choose Anthropic, OpenAI, or Local'
  pane="$(pane_for_index "$index")"
  [ -n "$pane" ] || die "pane $index not found"
  if pane_is_busy "$pane"; then
    die "$(agent_value "$index" NAME) is still working; finish the task before starting a new provider session"
  fi
  slot="$(agent_value "$index" SLOT)"
  directory="$(agent_value "$index" DIR)"
  model="${requested_model:-$(selected_model "$index" "$provider")}"
  model_is_valid "$model" || die 'invalid model name'
  command="$(launch_command "$index" "$provider" "$model")"
  memory_snapshot "$index" 'provider-switch'
  memory_file="$(memory_bootstrap "$index")"
  [ "$ROOM_THEME" != 'light' ] || printf -v theme_env 'COLORFGBG=%q TERM_PROGRAM_BACKGROUND=%q ' '0;15' 'light'
  printf -v launch 'AGENT_SLOT=%q AGENT_MEMORY_FILE=%q AGENT_ROOM_CONFIG=%q PANESHIFT_HOME=%q ROOM_SESSION=%q %s%s' "$slot" "$memory_file" "$CONFIG" "$SCRIPT_DIR" "$ROOM_SESSION" "$theme_env" "$command"
  remember_provider "$index" "$provider"
  remember_model "$index" "$provider" "$model"
  tmux respawn-pane -k -t "$pane" -c "$directory" "$launch"
  decorate_pane "$index" "$pane" "$provider"
  printf '%s now uses %s.\n' "$(agent_value "$index" NAME)" "$(provider_label "$provider")"
}

confirm_switch() {
  local requested="$1" provider="$2" index pane name command
  require_session
  index="$(resolve_index "$requested")" || die "unknown agent: $requested"
  provider="$(normalise_provider "$provider")" || die 'choose Anthropic, OpenAI, or Local'
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
  local requested="$1" index pane name provider model anthropic_command openai_command local_command model_command anthropic_mark openai_mark local_mark
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
  [ "$provider" = anthropic ] && anthropic_mark='●' || anthropic_mark='○'
  [ "$provider" = openai ] && openai_mark='●' || openai_mark='○'
  menu_items=()
  if provider_is_available "$index" anthropic; then
    menu_items+=( "$anthropic_mark ANTHROPIC · Claude Code" a "run-shell '$anthropic_command'" )
  fi
  if provider_is_available "$index" openai; then
    menu_items+=( "$openai_mark OPENAI · Codex" o "run-shell '$openai_command'" )
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
  local requested="$1" index pane name provider anthropic_command openai_command local_command local_switch reset_command paste_command
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
  reset_command="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" reset-layout"
  paste_command="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" paste \"$pane\""
  local_command="$(agent_value "$index" LOCAL_COMMAND)"
  menu_items=()
  if provider_is_available "$index" anthropic; then menu_items+=( 'Use Anthropic · Claude Code…' c "run-shell '$anthropic_command'" ); fi
  if provider_is_available "$index" openai; then menu_items+=( 'Use OpenAI · Codex…' x "run-shell '$openai_command'" ); fi
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
  local c1 c2 c3 c4 providers memory reset
  require_session
  c1="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" focus 1"
  c2="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" focus 2"
  c3="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" focus 3"
  c4="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" focus 4"
  providers="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" providers-menu"
  memory="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" memory-refresh manual 0"
  reset="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" reset-layout"
  tmux display-menu -T " $ROOM_TITLE " -x 0 -y S \
    "① $(agent_value 1 NAME) · $(provider_label "$(detect_provider 1 "$(pane_for_index 1)")")" 1 "run-shell '$c1'" \
    "② $(agent_value 2 NAME) · $(provider_label "$(detect_provider 2 "$(pane_for_index 2)")")" 2 "run-shell '$c2'" \
    "③ $(agent_value 3 NAME) · $(provider_label "$(detect_provider 3 "$(pane_for_index 3)")")" 3 "run-shell '$c3'" \
    "④ $(agent_value 4 NAME) · $(provider_label "$(detect_provider 4 "$(pane_for_index 4)")")" 4 "run-shell '$c4'" \
    '' \
    'Choose provider' p "run-shell '$providers'" \
    'Sync project memory' m "run-shell '$memory'" \
    'Reset layout' r "run-shell '$reset'" \
    '' \
    'Tip: right-click an agent' '' '' \
    'Close menu' q ''
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
  [ -f "$file" ] || { printf '%s|%s|%s' "$(session_elapsed)" '—' '0'; return; }
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
  read -r total available <<EOF
$(free -b 2>/dev/null | awk '/^Mem:/ { print $2, $7; exit }')
EOF
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

open_token_log() {
  local pane="$1" provider="$2" pid log index slot project_dir mangled root
  command -v lsof >/dev/null 2>&1 || return 0
  for pid in $(pane_descendants "$pane"); do
    log="$(lsof -p "$pid" -Fn 2>/dev/null | sed -n 's/^n//p' | grep -E '/\.codex/sessions/.+\.jsonl$' | head -1 || true)"
    [ -n "$log" ] && { printf '%s' "$log"; return; }
  done
  [ "$provider" = anthropic ] || return 0
  index="$(tmux show-option -p -v -t "$pane" @agent_index 2>/dev/null || true)"
  slot="$(agent_value "$index" SLOT)"
  project_dir="$(agent_value "$index" DIR)"
  [ -n "$slot" ] && [ -n "$project_dir" ] || return 0
  mangled="$(printf '%s' "$project_dir" | sed 's#/#-#g')"
  root="$HOME/.claude/projects/$mangled"
  [ -d "$root" ] || return 0
  # Claude closes its JSONL between turns. Its own command output records the
  # stable slot, which lets us recover the current role without reading chat text.
  find "$root" -type f -name '*.jsonl' -print0 2>/dev/null |
    while IFS= read -r -d '' log; do
      rg -Fq "AGENT_SLOT=$slot" "$log" 2>/dev/null || continue
      printf '%s\t%s\n' "$(stat -f '%m' "$log" 2>/dev/null || stat -c '%Y' "$log" 2>/dev/null || printf 0)" "$log"
    done | sort -rn | head -1 | cut -f2-
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
  for index in 1 2 3 4; do
    pane="$(pane_for_index "$index")"
    [ -n "$pane" ] || continue
    provider="$(detect_provider "$index" "$pane")"
    case "$provider" in anthropic|openai) record_token_delta "$index" "$provider" ;; esac
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

pane_is_busy() {
  local pane="$1" command before after
  if tmux capture-pane -p -t "$pane" 2>/dev/null |
    grep -Eqi 'esc to interrupt|working[[:space:].(]|cogitat|crunch|thinking|generating|compacting|running (tool|command)'; then
    return 0
  fi
  command="$(tmux display-message -p -t "$pane" '#{pane_current_command}' 2>/dev/null || true)"
  case "$command" in
    ''|bash|zsh|sh|fish|tmux) return 1 ;;
  esac
  before="$(tmux capture-pane -p -t "$pane" 2>/dev/null || true)"
  sleep 0.3
  after="$(tmux capture-pane -p -t "$pane" 2>/dev/null || true)"
  [ "$before" != "$after" ]
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
  for index in 1 2 3 4; do
    pane="$(pane_for_index "$index")"
    provider="$(detect_provider "$index" "$pane")"
    model="$(selected_model "$index" "$provider")"
    color="$(agent_value "$index" COLOR | sed 's/colour//')"
    printf 'AGENT\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$index" "$(agent_value "$index" NAME)" "$provider" "$model" "$color" \
      "$(agent_value "$index" ANTHROPIC_MODELS)" "$(agent_value "$index" OPENAI_MODELS)"
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

sidebar_view() {
  local index pane provider model live total handoffs claims conflicts sync_age runs now last_heartbeat=0 last_session_update=0 last_token_refresh=0 health elapsed longest session_count streak cpu gpu ram tokens ovh grid_line calendar_row day_label
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
    fi
    printf '\033[H'
    printf '\033[1;30;48;5;223m  PANESHIFT · CONTROL ROOM     \033[0m\033[K\n'
    printf '\033[K\n'
    printf '\033[1m  ROUTING · click to change\033[0m\033[K\n'
    for index in 1 2 3 4; do
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
  nohup "$SCRIPT_DIR/paneshift-hover" --session "$ROOM_SESSION" >>"$log_file" 2>&1 &
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
  local sidebar p1 p2 p3 grid_width grid_height left_width top_height layout
  require_session
  sidebar="$(sidebar_pane)"
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
  local pane="$1" mouse_y="$2" pane_top local_y
  require_session
  [ "$(tmux show-option -p -v -t "$pane" @agent_sidebar 2>/dev/null || true)" = 1 ] || return 0
  pane_top="$(tmux display-message -p -t "$pane" '#{pane_top}')"
  local_y=$((mouse_y - pane_top))
  case "$local_y" in
    3|4) provider_picker 1 ;;
    5|6) provider_picker 2 ;;
    7|8) provider_picker 3 ;;
    9|10) provider_picker 4 ;;
    26) memory_refresh manual 0; tmux display-message 'Project memory synced' ;;
    28) reset_layout ;;
    *) return 0 ;;
  esac
}

providers_menu() {
  local p1 p2 p3 p4
  require_session
  p1="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" provider-picker 1"
  p2="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" provider-picker 2"
  p3="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" provider-picker 3"
  p4="\"$SCRIPT_PATH\" --config \"$CONFIG\" --session \"$ROOM_SESSION\" provider-picker 4"
  tmux display-menu -T ' CHOOSE ROLE TO ROUTE ' -x C -y C \
    "① $(agent_value 1 NAME) · #{@agent_1_provider}" 1 "run-shell '$p1'" \
    "② $(agent_value 2 NAME) · #{@agent_2_provider}" 2 "run-shell '$p2'" \
    "③ $(agent_value 3 NAME) · #{@agent_3_provider}" 3 "run-shell '$p3'" \
    "④ $(agent_value 4 NAME) · #{@agent_4_provider}" 4 "run-shell '$p4'" \
    '' \
    'Cancel' q ''
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
  local p1 p2 p3 p4
  validate_config
  require_tmux

  p1="$(tmux new-session -d -P -F '#{pane_id}' -s "$ROOM_SESSION" -n agents -c "$(agent_value 1 DIR)")"
  p2="$(tmux split-window -h -P -F '#{pane_id}' -t "$p1" -c "$(agent_value 2 DIR)")"
  p3="$(tmux split-window -v -P -F '#{pane_id}' -t "$p1" -c "$(agent_value 3 DIR)")"
  p4="$(tmux split-window -v -P -F '#{pane_id}' -t "$p2" -c "$(agent_value 4 DIR)")"
  tmux select-layout -t "$ROOM_SESSION:agents" tiled

  decorate_pane 1 "$p1" "$(selected_provider 1)"
  decorate_pane 2 "$p2" "$(selected_provider 2)"
  decorate_pane 3 "$p3" "$(selected_provider 3)"
  decorate_pane 4 "$p4" "$(selected_provider 4)"
  ensure_sidebar
  apply_theme
  ensure_drop_hover

  launch_agent 1 "$p1" "$(selected_provider 1)"
  launch_agent 2 "$p2" "$(selected_provider 2)"
  launch_agent 3 "$p3" "$(selected_provider 3)"
  launch_agent 4 "$p4" "$(selected_provider 4)"

  tmux select-window -t "$ROOM_SESSION:agents"
  tmux select-pane -t "$p1"
}

start_room() {
  memory_run init >/dev/null
  validate_config
  require_tmux
  if tmux has-session -t "$ROOM_SESSION" 2>/dev/null; then
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

status_room() {
  local index pane command active dead slot name role provider state task marker
  require_session
  printf '\n  %s\n' "$ROOM_TITLE"
  printf '  %-28s %-10s %-12s %s\n' 'TERMINAL' 'PROCESS' 'STATE' 'TASK'
  printf '  %s\n' '────────────────────────────────────────────────────────────────────────────────'
  for index in 1 2 3 4; do
    pane="$(pane_for_index "$index")"
    slot="$(agent_value "$index" SLOT)"
    name="$(agent_value "$index" NAME)"
    role="$(agent_value "$index" ROLE)"
    if [ -n "$pane" ]; then
      provider="$(detect_provider "$index" "$pane")"
      IFS='|' read -r command active dead <<EOF
$(tmux display-message -p -t "$pane" '#{pane_current_command}|#{pane_active}|#{pane_dead}')
EOF
      state="$(handoff_field "$slot" 'Statut')"
      task="$(handoff_field "$slot" 'Tâche')"
      [ -n "$state" ] || state="$([ "$dead" = 1 ] && printf 'stopped' || printf 'active')"
      [ -n "$task" ] || task='—'
      [ "$active" = 1 ] && marker='●' || marker='○'
      printf '  %s %-26s %-10s %-12s %.52s\n' "$marker" "$name · $(provider_label "$provider")" "$command" "$state" "$task"
    else
      printf '  ! %-26s %-10s %-12s %s\n' "$name · $role" '—' 'missing' 'pane not found'
    fi
  done
  printf '\n  Theme: %s · menu: Ctrl+/ · paste: Ctrl+V\n\n' "$ROOM_THEME"
}

switch_menu() {
  local index provider_key provider confirm
  clear
  status_room
  printf '  Terminal to switch [1-4]: '
  IFS= read -r -n 1 index
  printf '\n  Provider [c] Anthropic · [x] OpenAI: '
  IFS= read -r -n 1 provider_key
  printf '\n'
  case "$provider_key" in c|C) provider='anthropic' ;; x|X) provider='openai' ;; *) return ;; esac
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
  case "$current_index" in 1|2|3|4) ;; *) current_index=1 ;; esac
  case "$direction" in
    next|right) target_index=$((current_index % 4 + 1)) ;;
    previous|prev|left) target_index=$(((current_index + 2) % 4 + 1)) ;;
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
  local key
  while :; do
    clear
    status_room
    printf '  [1] %s  [2] %s\n' "$(agent_value 1 NAME)" "$(agent_value 2 NAME)"
    printf '  [3] %s  [4] %s\n' "$(agent_value 3 NAME)" "$(agent_value 4 NAME)"
    printf '  [s] Change provider  [q] Close\n\n  Choice: '
    IFS= read -r -n 1 key
    printf '\n'
    case "$key" in
      1|2|3|4) focus_room "$key"; return ;;
      s|S) switch_menu; return ;;
      q|Q) return ;;
    esac
  done
}

doctor_room() {
  local index pane errors=0
  validate_config
  require_session
  for index in 1 2 3 4; do
    pane="$(pane_for_index "$index")"
    if [ -n "$pane" ]; then
      printf 'OK  agent %s → pane %s\n' "$index" "$pane"
    else
      printf 'ERR agent %s → pane missing\n' "$index"
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
  [ "$errors" -eq 0 ] || die "$errors problem(s) found"
}

show_help() {
  cat <<EOF
PaneShift — tmux 2x2 grid with a control sidebar

  $(basename "$0")                         create or join the Control Room
  $(basename "$0") --config FILE          use another team configuration
  $(basename "$0") status                 show all four agents
  $(basename "$0") menu                   open the interactive menu
  $(basename "$0") focus <1..4|slot>      focus an agent
  $(basename "$0") next-pane              focus the next terminal
  $(basename "$0") previous-pane          focus the previous terminal
  $(basename "$0") zoom <1..4|slot>       focus and zoom an agent
  $(basename "$0") switch <slot> <provider> start a fresh Anthropic, OpenAI, or Local session
  $(basename "$0") model-picker <slot>       choose a configured model for one provider
  $(basename "$0") reset-layout           restore the equal 2x2 grid
  $(basename "$0") paste [pane]           paste using the system clipboard
  $(basename "$0") memory-refresh         snapshot and rebuild all live memory
  $(basename "$0") sidebar-install        add the sidebar to an existing session
  $(basename "$0") theme                  reapply the configured live theme
  $(basename "$0") doctor                 verify all four panes

Active configuration: $CONFIG
EOF
}

ACTION="${1:-start}"
case "$ACTION" in
  start|attach) start_room ;;
  status) status_room ;;
  menu) menu_room ;;
  focus) focus_room "${2:-}" ;;
  next-pane) focus_adjacent_room next ;;
  previous-pane) focus_adjacent_room previous ;;
  zoom) zoom_room "${2:-}" ;;
  switch) switch_agent "${2:-}" "${3:-}" ;;
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
  reset-layout) reset_layout ;;
  sync-grid) sync_grid "${2:-0}" ;;
  theme) decorate_existing_session; apply_theme ;;
  doctor) doctor_room ;;
  help|-h|--help) show_help ;;
  *) die "unknown command: $ACTION" ;;
esac
