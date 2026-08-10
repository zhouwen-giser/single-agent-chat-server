#!/usr/bin/env bash
set -euo pipefail
BRANCH="${SACS_V02_BRANCH:-feature/sacs-v0.2-agui-interaction-gateway}"

git fetch --prune origin
git checkout main
git pull --ff-only origin main
BASELINE="$(git rev-parse HEAD)"

pnpm install --frozen-lockfile
pnpm verify

if git show-ref --verify --quiet "refs/heads/$BRANCH" || \
   git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  echo "v0.2 branch already exists; use Goal resume policy, do not recreate or force." >&2
  exit 2
fi

git checkout -b "$BRANCH" "$BASELINE"
git push -u origin "$BRANCH"
echo "SACS_V02_BASELINE_SHA=$BASELINE"
