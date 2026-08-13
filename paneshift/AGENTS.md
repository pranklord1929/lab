# PaneShift agent contract

1. Read `$AGENT_MEMORY_FILE` (thin bootstrap) before acting.
2. Verify against **Git and the code** — memory can be stale.
3. Claim a scope before editing:
   `"$PANESHIFT_HOME/agent-memory.sh" --config "$AGENT_ROOM_CONFIG" claim "$AGENT_SLOT" "<scope>" "<task>"`
4. Update only your handoff:
   `$PANESHIFT_HOME/.agent-context/handoffs/$AGENT_SLOT.md`
5. Snapshot and release when done.
6. Do not invent shared PROJECT_STATE / DECISIONS noise; append there only for
   durable multi-role decisions a human would keep.
