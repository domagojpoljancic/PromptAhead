#!/usr/bin/env bash
# Check watched / recent subagents for stuck or completed state.
# Prints machine-readable lines: STUCK|OK|DONE id=... age_sec=...
# Always exits 0 (fail-open).
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WATCH_FILE="${STUCK_AGENT_WATCH_FILE:-$ROOT/.cursor/stuck-agent-watch.json}"
STUCK_SEC="${STUCK_AGENT_THRESHOLD_SEC:-300}"
PROJECT_SLUG="${CURSOR_PROJECT_SLUG:-Users-domagoj-Documents-Cursor-Projects-PromptAhead}"
TRANSCRIPTS_ROOT="${CURSOR_TRANSCRIPTS_ROOT:-$HOME/.cursor/projects/$PROJECT_SLUG/agent-transcripts}"

python3 - "$WATCH_FILE" "$STUCK_SEC" "$TRANSCRIPTS_ROOT" "$ROOT" <<'PY' || true
import json, os, sys, time
from datetime import datetime, timezone

watch_path, stuck_sec_s, transcripts_root, repo_root = sys.argv[1:5]
stuck_sec = int(stuck_sec_s)
now = time.time()

def load_watch():
    """Normalize agents to a dict keyed by id. Accepts map or array schemas."""
    empty = {"version": 1, "agents": {}}
    if not os.path.isfile(watch_path):
        return empty
    try:
        with open(watch_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return empty
        agents = data.get("agents")
        normalized = {}
        if isinstance(agents, dict):
            for k, v in agents.items():
                if not isinstance(v, dict):
                    continue
                entry = dict(v)
                aid = str(entry.get("id") or k)
                entry["id"] = aid
                if not entry.get("transcriptPath") and entry.get("transcript"):
                    entry["transcriptPath"] = entry["transcript"]
                normalized[aid] = entry
        elif isinstance(agents, list):
            for v in agents:
                if not isinstance(v, dict):
                    continue
                aid = str(v.get("id") or "")
                if not aid:
                    continue
                entry = dict(v)
                entry["id"] = aid
                entry.setdefault("status", "running")
                if not entry.get("transcriptPath") and entry.get("transcript"):
                    entry["transcriptPath"] = entry["transcript"]
                normalized[aid] = entry
        out = dict(data)
        out["agents"] = normalized
        out.setdefault("version", 1)
        return out
    except Exception:
        return empty

def last_jsonl_event(path):
    """Return (mtime, last_obj_or_None)."""
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return None, None
    last = None
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    last = json.loads(line)
                except Exception:
                    continue
    except OSError:
        return mtime, None
    return mtime, last

def is_turn_ended_complete(obj):
    if not isinstance(obj, dict):
        return False
    if obj.get("type") == "turn_ended":
        st = str(obj.get("status") or "").lower()
        return st in ("success", "error", "failed", "failure", "cancelled", "canceled", "aborted") or st != ""
    # Some transcripts nest type
    if obj.get("event") == "turn_ended":
        return True
    return False

def discover_transcript(agent_id):
    if not os.path.isdir(transcripts_root):
        return None
    target = f"{agent_id}.jsonl"
    newest = None
    newest_mtime = -1.0
    for root, _dirs, files in os.walk(transcripts_root):
        if not root.endswith("subagents"):
            continue
        if target in files:
            p = os.path.join(root, target)
            try:
                mt = os.path.getmtime(p)
            except OSError:
                continue
            if mt > newest_mtime:
                newest_mtime = mt
                newest = p
    return newest

def edited_paths_silent(entry, age_sec):
    """True if listed edited paths all mtime-silent for age_sec (or unknown)."""
    paths = entry.get("editedPaths") or entry.get("edited_paths") or []
    if not paths:
        return None  # unknown
    all_silent = True
    any_exist = False
    for p in paths:
        if not isinstance(p, str):
            continue
        abs_p = p if os.path.isabs(p) else os.path.join(repo_root, p)
        if not os.path.exists(abs_p):
            continue
        any_exist = True
        try:
            mt = os.path.getmtime(abs_p)
        except OSError:
            continue
        if (now - mt) < age_sec:
            all_silent = False
            break
    if not any_exist:
        return None
    return all_silent

state = load_watch()
agents = state.get("agents") or {}
seen = set()

if not agents:
    print("watchdog: no active watches")
else:
    for aid, entry in list(agents.items()):
        if not isinstance(entry, dict):
            entry = {"id": str(aid)}
        aid = str(entry.get("id") or aid)
        seen.add(aid)
        status = str(entry.get("status") or "running").lower()
        tpath = entry.get("transcriptPath") or entry.get("transcript_path")
        if not tpath or not os.path.isfile(tpath):
            tpath = discover_transcript(aid)

        if status in ("completed", "done", "success"):
            print(f"DONE id={aid} age_sec=0 note=watch_status")
            continue
        if status in ("failed", "error", "failure"):
            print(f"DONE id={aid} age_sec=0 note=watch_failed")
            continue

        if not tpath:
            # No transcript yet — use startedAt if present
            started = entry.get("startedAt")
            age = stuck_sec + 1
            if started:
                try:
                    # support Z
                    ts = started.replace("Z", "+00:00")
                    age = int(now - datetime.fromisoformat(ts).timestamp())
                except Exception:
                    age = 0
            if age >= stuck_sec:
                print(f"STUCK id={aid} age_sec={age} note=no_transcript")
            else:
                print(f"OK id={aid} age_sec={age} note=no_transcript_yet")
            continue

        mtime, last = last_jsonl_event(tpath)
        age = int(now - mtime) if mtime is not None else stuck_sec + 1

        if is_turn_ended_complete(last):
            st = (last or {}).get("status") or "ended"
            print(f"DONE id={aid} age_sec={age} status={st} transcript={tpath}")
            continue

        files_silent = edited_paths_silent(entry, stuck_sec)
        if age >= stuck_sec:
            if files_silent is True or files_silent is None:
                extra = " files_silent=1" if files_silent is True else ""
                print(f"STUCK id={aid} age_sec={age}{extra} transcript={tpath}")
            else:
                # transcript stale but files still changing — treat as OK (working)
                print(f"OK id={aid} age_sec={age} note=files_active transcript={tpath}")
        else:
            print(f"OK id={aid} age_sec={age} transcript={tpath}")

# Also scan recent subagent transcripts not in watch (last 2h, still open)
scan_recent = os.environ.get("STUCK_AGENT_SCAN_RECENT", "1") == "1"
if scan_recent and os.path.isdir(transcripts_root):
    cutoff = now - 2 * 3600
    for root, _dirs, files in os.walk(transcripts_root):
        if not root.endswith("subagents"):
            continue
        for fn in files:
            if not fn.endswith(".jsonl"):
                continue
            aid = fn[:-6]
            if aid in seen:
                continue
            p = os.path.join(root, fn)
            try:
                mtime = os.path.getmtime(p)
            except OSError:
                continue
            if mtime < cutoff:
                continue
            _mt, last = last_jsonl_event(p)
            age = int(now - mtime)
            if is_turn_ended_complete(last):
                continue  # completed, not watched — skip noise
            if age >= stuck_sec:
                print(f"STUCK id={aid} age_sec={age} note=unwatched transcript={p}")
            # else: recent active unwatched — omit to reduce noise

print(f"watchdog: check_complete ts={datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}")
PY

exit 0
