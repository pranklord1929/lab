#!/bin/zsh

ROOT="/Users/thediningdispatch/Desktop/004_DEV/CDMX_RESTAURANTS"
LOGS="$ROOT/data/local_db/logs"
mkdir -p "$LOGS"

cleanup() {
  [ -n "${WEB_PID:-}" ] && kill "$WEB_PID" 2>/dev/null
  [ -n "${BOT_PID:-}" ] && kill "$BOT_PID" 2>/dev/null
  [ -n "${TAIL_PID:-}" ] && kill "$TAIL_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

cd "$ROOT/web" || exit 1
./node_modules/.bin/next dev --webpack >> "$LOGS/web.log" 2>&1 &
WEB_PID=$!

cd "$ROOT" || exit 1
node scripts/telegram_bot.js >> "$LOGS/telegram.log" 2>&1 &
BOT_PID=$!

echo "The Dining Dispatch Telegram est actif."
echo "Fermer cette fenêtre arrête le bot. Logs: $LOGS"
tail -n 20 -f "$LOGS/web.log" "$LOGS/telegram.log" &
TAIL_PID=$!

wait "$WEB_PID" "$BOT_PID"
