#!/usr/bin/env bash
# subagentStart: record agent in .cursor/stuck-agent-watch.json
# Fail-open: always allow; never block subagents.
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
        if isinstance(obj, dict) and k in obj and obj[k]:
            return obj[k]
    return None

agent_id = dig(data, "subagent_id", "agent_id", "id", "task_id", "subagentId")
if not agent_id and isinstance(data.get("subagent"), dict):
    agent_id = dig(data["subagent"], "id", "subagent_id", "agent_id")

transcript = dig(data, "transcript_path", "transcriptPath", "subagent_transcript_path")
if not transcript and agent_id:
    home = os.path.expanduser("~")
    slug = "Users-domagoj-Documents-Cursor-Projects-PromptAhead"
    base = os.path.join(home, ".cursor", "projects", slug, "agent-transcripts")
    if os.path.isdir(base):
        for root, _dirs, files in os.walk(base):
            if root.endswith("subagents") and f"{agent_id}.jsonl" in files:
                transcript = os.path.join(root, f"{agent_id}.jsonl")
                break

def normalize_agents(loaded):
    agents = {}
    raw_agents = loaded.get("agents") if isinstance(loaded, dict) else None
    if isinstance(raw_agents, dict):
        for k, v in raw_agents.items():
            if isinstance(v, dict):
                aid = str(v.get("id") or k)
                e = dict(v)
                e["id"] = aid
                if not e.get("transcriptPath") and e.get("transcript"):
                    e["transcriptPath"] = e["transcript"]
                agents[aid] = e
    elif isinstance(raw_agents, list):
        for v in raw_agents:
            if isinstance(v, dict) and v.get("id"):
                aid = str(v["id"])
                e = dict(v)
                e["id"] = aid
                e.setdefault("status", "running")
                if not e.get("transcriptPath") and e.get("transcript"):
                    e["transcriptPath"] = e["transcript"]
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

if agent_id and watch_path:
    entry = state["agents"].get(str(agent_id), {})
    entry.update({
        "id": str(agent_id),
        "startedAt": entry.get("startedAt") or now,
        "status": "running",
        "transcriptPath": transcript or entry.get("transcriptPath") or entry.get("transcript"),
        "subagentType": dig(data, "subagent_type", "subagentType", "type") or entry.get("subagentType"),
        "updatedAt": now,
    })
    if entry.get("transcriptPath"):
        entry["transcript"] = entry["transcriptPath"]
    entry.pop("completedAt", None)
    entry.pop("stopReason", None)
    state["agents"][str(agent_id)] = entry
    state["updatedAt"] = now
    try:
        with open(watch_path, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
            f.write("\n")
    except Exception:
        pass

print(json.dumps({}))
' 2>/dev/null || echo '{}'

exit 0
