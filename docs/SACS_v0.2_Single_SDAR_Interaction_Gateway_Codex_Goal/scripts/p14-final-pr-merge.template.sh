#!/usr/bin/env bash
set -euo pipefail
BRANCH="${SACS_V02_BRANCH:-feature/sacs-v0.2-agui-interaction-gateway}"

git fetch --prune origin
git checkout "$BRANCH"
git merge --no-ff origin/main

# Repository-owned v0.2 full verifier must include all required real gates.
pnpm verify

git push origin "$BRANCH"

command -v gh >/dev/null 2>&1 || {
  echo "gh unavailable; use authorized GitHub tooling to create PR." >&2
  exit 3
}

PR="$(gh pr list --head "$BRANCH" --base main --json number --jq '.[0].number // empty')"
if [[ -z "$PR" ]]; then
  gh pr create --base main --head "$BRANCH" \
    --title "feat(v0.2): add OpenAI and AG-UI single-SDAR interaction gateway" \
    --body-file reports/v0.2/final/pr-body.md
  PR="$(gh pr list --head "$BRANCH" --base main --json number --jq '.[0].number')"
fi

gh pr checks "$PR" || exit 4
# Never use --admin. Protection/review rules remain authoritative.
gh pr merge "$PR" --merge

git fetch origin main
CANDIDATE="$(git rev-parse "$BRANCH")"
git merge-base --is-ancestor "$CANDIDATE" origin/main
echo "POST_MERGE_ANCESTOR_OK candidate=$CANDIDATE main=$(git rev-parse origin/main)"
