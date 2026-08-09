#!/usr/bin/env bash
# Notify-based stuck-agent watchdog loop.
# Exits when .cursor/stuck-agent-watch.json has no running agents (IDLE_EXIT).
# Usage: bash .cursor/hooks/run-stuck-agent-watchdog.sh
# Arm via Shell with block_until_ms: 0 and notify_on_output ^AGENT_LOOP_TICK_stuck_agent|^AGENT_LOOP_IDLE_EXIT
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INTERVAL_SEC="${STUCK_AGENT_WATCH_INTERVAL_SEC:-120}"
CHECK="$ROOT/.cursor/hooks/check-stuck-agents.sh"

echo "watchdog: started interval_sec=$INTERVAL_SEC root=$ROOT"

while true; do
  sleep "$INTERVAL_SEC"
  echo "AGENT_LOOP_TICK_stuck_agent $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  out="$(bash "$CHECK" 2>/dev/null || true)"
  printf '%s\n' "$out"
  if printf '%s\n' "$out" | grep -q '^AGENT_LOOP_IDLE_EXIT'; then
    echo "watchdog: stopping (no active agents)"
    break
  fi
done

exit 0
