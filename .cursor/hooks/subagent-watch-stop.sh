#!/usr/bin/env bash
# subagentStop: mark agent complete / remove from watch; optional followup on failure.
# Fail-open.
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WATCH_FILE="$ROOT/.cursor/stuck-agent-watch.json"
mkdir -p "$ROOT/.cursor"

input="$(cat || true)"
export STUCK_WATCH_FILE="$WATCH_FILE"

printf '%s' "$input" | python3 -c '
import json, os, sys
from datetime import datetime, timezone

watch_path = os.environ.get("STUCK_WATCH_FILE", "")
raw = sys.stdin.read()
try:
    data = json.loads(raw) if raw.strip() else {}
except Exception:
    data = {}

def dig(obj, *keys):
    for k in keys:
        if isinstance(obj, dict) and k in obj and obj[k] is not None and obj[k] != "":
            return obj[k]
    return None

agent_id = dig(data, "subagent_id", "agent_id", "id", "task_id", "subagentId")
if not agent_id and isinstance(data.get("subagent"), dict):
    agent_id = dig(data["subagent"], "id", "subagent_id", "agent_id")

status = dig(data, "status", "result", "outcome", "stop_reason", "stopReason")
err = dig(data, "error", "error_message", "message")
summary = dig(data, "summary", "final_summary")

def normalize_agents(loaded):
    agents = {}
    raw_agents = loaded.get("agents") if isinstance(loaded, dict) else None
    if isinstance(raw_agents, dict):
        for k, v in raw_agents.items():
            if isinstance(v, dict):
                aid = str(v.get("id") or k)
                e = dict(v)
                e["id"] = aid
                agents[aid] = e
    elif isinstance(raw_agents, list):
        for v in raw_agents:
            if isinstance(v, dict) and v.get("id"):
                aid = str(v["id"])
                e = dict(v)
                e["id"] = aid
                agents[aid] = e
    return agents

now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
state = {"version": 1, "agents": {}}
if watch_path and os.path.isfile(watch_path):
    try:
        with open(watch_path, "r", encoding="utf-8") as f:
            loaded = json.load(f)
        if isinstance(loaded, dict):
            state = {"version": loaded.get("version", 1), "agents": normalize_agents(loaded)}
            if "stuckAfterSec" in loaded:
                state["stuckAfterSec"] = loaded["stuckAfterSec"]
    except Exception:
        pass

looks_bad = False
status_l = str(status or "").lower()
if status_l in ("error", "failed", "failure", "cancelled", "canceled", "aborted", "timeout", "timed_out"):
    looks_bad = True
if err:
    looks_bad = True
if status_l and status_l not in ("success", "completed", "complete", "ok", "done", "", "unknown") and not summary:
    looks_bad = True

out = {}
if agent_id and watch_path:
    aid = str(agent_id)
    # Remove from active watch
    state["agents"].pop(aid, None)
    state["updatedAt"] = now
    try:
        with open(watch_path, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
            f.write("\n")
    except Exception:
        pass

    if looks_bad:
        st_label = status if status else "unknown"
        msg = f"Background subagent {aid} stopped with status={st_label}"
        if err:
            msg += f" error={err}"
        msg += ". Check .cursor/hooks/check-stuck-agents.sh / resume if work is incomplete."
        out["followup_message"] = msg

print(json.dumps(out))
' 2>/dev/null || echo '{}'

exit 0
