#!/usr/bin/env bash
# Prune merged feature branches (local + origin) and ensure delete_branch_on_merge is on.
# Usage: DRY_RUN=1 bash .cursor/scripts/prune-merged-branches.sh   # preview
#        bash .cursor/scripts/prune-merged-branches.sh             # apply
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

DRY_RUN="${DRY_RUN:-0}"
run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

echo "==> Fetch + prune remotes"
run git fetch origin --prune

echo "==> Open PR heads (never delete these remotes)"
OPEN_HEADS="$(gh pr list --state open --json headRefName --jq '.[].headRefName' 2>/dev/null || true)"
printf '%s\n' "$OPEN_HEADS" | sed '/^$/d' | while read -r h; do echo "  keep (open PR): $h"; done

echo "==> Local branches merged into origin/main (except main + open PR locals)"
git checkout main 2>/dev/null || true
run git pull --ff-only origin main || true

while IFS= read -r branch; do
  [[ -z "$branch" || "$branch" == "main" ]] && continue
  if printf '%s\n' "$OPEN_HEADS" | grep -qx "$branch"; then
    echo "  skip local (open PR): $branch"
    continue
  fi
  run git branch -d "$branch"
done < <(git branch --merged origin/main | sed 's/^[* ] //')

echo "==> Remote origin/* with zero commits ahead of origin/main"
while IFS= read -r ref; do
  [[ -z "$ref" ]] && continue
  short="${ref#origin/}"
  [[ "$short" == "HEAD" || "$short" == "main" ]] && continue
  if printf '%s\n' "$OPEN_HEADS" | grep -qx "$short"; then
    echo "  skip remote (open PR): $short"
    continue
  fi
  ahead="$(git rev-list --count origin/main.."$ref" 2>/dev/null || echo 1)"
  if [[ "$ahead" == "0" ]]; then
    run git push origin --delete "$short"
  else
    echo "  skip remote ($ahead ahead): $short"
  fi
done < <(git for-each-ref --format='%(refname:short)' refs/remotes/origin | sed 's|^origin/||' | sort -u | sed 's|^|origin/|')

echo "==> Worktrees (list only — remove manually if merged)"
git worktree list

if command -v gh >/dev/null 2>&1; then
  current="$(gh api repos/domagojpoljancic/PromptAhead --jq .delete_branch_on_merge 2>/dev/null || echo unknown)"
  echo "==> delete_branch_on_merge: $current"
  if [[ "$current" == "false" && "$DRY_RUN" != "1" ]]; then
    echo "==> Enabling delete_branch_on_merge on GitHub"
    gh api -X PATCH repos/domagojpoljancic/PromptAhead -f delete_branch_on_merge=true
  fi
fi

echo "Done."
