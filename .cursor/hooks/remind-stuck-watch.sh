#!/usr/bin/env bash
# postToolUse (Task): remind parent to arm stuck-agent watchdog for background launches.
# Fail-open: never block the tool.
set -u

input="$(cat || true)"

additional_context='After any background Task (run_in_background: true), BEFORE ending the turn arm the stuck-agent watchdog loop (see .cursor/rules/stuck-agent-watchdog.mdc): Shell block_until_ms 0 + notify_on_output pattern ^AGENT_LOOP_TICK_stuck_agent. Record agent id(s) in .cursor/stuck-agent-watch.json. On each tick run .cursor/hooks/check-stuck-agents.sh. Manual fallback: /loop 3m run stuck-agent watchdog check.'

is_bg=0
if printf '%s' "$input" | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    data = json.loads(raw) if raw.strip() else {}
except Exception:
    sys.exit(2)
blob = json.dumps(data).lower()
if "run_in_background" in blob and "true" in blob:
    sys.exit(0)
tool_input = data.get("tool_input") or data.get("input") or data.get("arguments") or {}
if isinstance(tool_input, dict) and tool_input.get("run_in_background") is True:
    sys.exit(0)
sys.exit(1)
' 2>/dev/null; then
  is_bg=1
fi

python3 -c '
import json, sys
ctx = sys.argv[1]
bg = sys.argv[2] == "1"
if bg:
    msg = "BACKGROUND Task detected. " + ctx
else:
    msg = "Task tool used (arm watchdog if this was a background launch). " + ctx
print(json.dumps({"additional_context": msg}))
' "$additional_context" "$is_bg" 2>/dev/null \
  || echo '{"additional_context":"Arm stuck-agent watchdog after background Task launches (.cursor/rules/stuck-agent-watchdog.mdc)."}'

exit 0
