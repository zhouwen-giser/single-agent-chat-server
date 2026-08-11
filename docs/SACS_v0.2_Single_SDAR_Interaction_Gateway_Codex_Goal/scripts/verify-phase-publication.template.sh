#!/usr/bin/env bash
set -euo pipefail
BRANCH="${1:?usage: verify-phase-publication.template.sh <branch>}"
git fetch origin "$BRANCH"
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"
[[ "$LOCAL" == "$REMOTE" ]] || {
  echo "ERROR local=$LOCAL remote=$REMOTE" >&2
  exit 1
}
git diff --check
echo "PHASE_PUBLICATION_OK $LOCAL"
