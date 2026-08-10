#!/usr/bin/env bash
set -euo pipefail
REPO="${1:-.}"
cd "$REPO"

wait_exit() {
  echo "{\"status\":\"WAITING_FOR_SACS_PHASE13_MAIN\",\"reason\":\"$1\"}" >&2
  exit 75
}

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || wait_exit "not_a_git_repository"
[[ -z "$(git status --porcelain)" ]] || wait_exit "worktree_not_clean_preserve_operator_changes"

git fetch --prune origin
MAIN_SHA="$(git rev-parse origin/main)"

# Known v0.1 PR at task-package creation time. If project later replaces it,
# Codex may accept an equivalent merged PR only after explicit P00 source audit.
if command -v gh >/dev/null 2>&1; then
  PR_JSON="$(gh pr view 1 --json state,isDraft,mergedAt,headRefName,headRefOid,baseRefName 2>/dev/null || true)"
  if [[ -n "$PR_JSON" ]]; then
    MERGED="$(node -e 'const x=JSON.parse(process.argv[1]); process.stdout.write(x.mergedAt ? "yes":"no")' "$PR_JSON")"
    [[ "$MERGED" == "yes" ]] || wait_exit "v0.1_pr_1_not_merged"
  fi
fi

STATUS="$(git show origin/main:PROJECT_STATUS.md 2>/dev/null || true)"
[[ -n "$STATUS" ]] || wait_exit "main_missing_project_status"
if grep -Eiq 'Status:[[:space:]]*`?(IN_PROGRESS|BLOCKED|WAITING|PARTIAL)' <<<"$STATUS"; then
  wait_exit "main_project_status_not_terminal"
fi

git cat-file -e "origin/main:reports/goal/13-final-acceptance.md" 2>/dev/null \
  || wait_exit "main_missing_phase13_final_acceptance"

if git show-ref --verify --quiet refs/remotes/origin/feature/single-sdar-chat-entry-v0.1; then
  git merge-base --is-ancestor origin/feature/single-sdar-chat-entry-v0.1 origin/main \
    || wait_exit "v0.1_feature_not_ancestor_of_main"
fi

echo "{\"status\":\"READY_FOR_P00\",\"originMainSha\":\"$MAIN_SHA\"}"
