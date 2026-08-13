#!/usr/bin/env bash
# PaneShift verification suite — run with bash (not zsh).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
FAIL=0

say() { printf '\n== %s ==\n' "$*"; }
ok() { printf 'OK  %s\n' "$*"; }
bad() { printf 'FAIL %s\n' "$*"; FAIL=$((FAIL + 1)); }

say "syntax"
bash -n agent-room.sh && bash -n agent-memory.sh && bash -n paneshift && bash -n paneshift-local
bash -n bin/paneshift-bridge-heartbeat
ok "shell syntax"

say "swift build"
if swift build --build-path /tmp/paneshift-verify-build >/tmp/ps-build.log 2>&1; then
  ok "swift build"
else
  bad "swift build"; tail -20 /tmp/ps-build.log
fi

say "swift test (build path outside Desktop — avoids codesign xattr)"
if swift test --build-path /tmp/paneshift-verify-build >/tmp/ps-test.log 2>&1; then
  ok "swift test ($(grep -c 'Test Case.*passed' /tmp/ps-test.log || true) cases logged)"
else
  bad "swift test"; tail -30 /tmp/ps-test.log
fi

say "agent-room shell suite"
if bash tests/agent_room.test.sh >/tmp/ps-shell.log 2>&1; then
  ok "agent-room tests"
else
  bad "agent-room tests"; tail -30 /tmp/ps-shell.log
fi

say "room lifecycle smoke (fake agents)"
if bash tests/smoke_room.sh >/tmp/ps-smoke.log 2>&1; then
  ok "smoke room"
else
  bad "smoke room"; tail -40 /tmp/ps-smoke.log
fi

say "bridge"
if ./bin/paneshift-bridge-heartbeat --config ./agent-room.local.conf >/tmp/ps-bridge.log 2>&1 \
  && test -s "$HOME/agent-os/personal-ops/memory/paneshift-status.json"; then
  ok "openclaw bridge heartbeat"
else
  bad "bridge"; cat /tmp/ps-bridge.log
fi

say "summary"
if [ "$FAIL" -eq 0 ]; then
  printf 'ALL CHECKS PASSED\n'
  exit 0
fi
printf '%s CHECK(S) FAILED\n' "$FAIL"
exit 1
