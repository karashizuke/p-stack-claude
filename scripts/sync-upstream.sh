#!/usr/bin/env bash
# Pull the latest Claude Code tree of pstack from cursor/plugins into the `upstream` branch.
# Run from anywhere inside this repo. It never touches `main`; merge yourself afterwards.
set -euo pipefail

REPO=https://github.com/cursor/plugins.git
TREE=harness/pstack/claude-code

ROOT=$(git rev-parse --show-toplevel)
TMP=$(mktemp -d)
WT="$TMP/upstream"
trap 'git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true; rm -rf "$TMP"' EXIT

git clone -q --depth 1 --filter=blob:none --sparse "$REPO" "$TMP/src"
git -C "$TMP/src" sparse-checkout set "$TREE"
SHA=$(git -C "$TMP/src" rev-parse HEAD)

git -C "$ROOT" worktree add -q "$WT" upstream
# rsync first (drops the old README.upstream.md), then rename, so git sees edits rather than delete+add.
rsync -a --delete --exclude=.git "$TMP/src/$TREE/" "$WT/"
mv "$WT/README.md" "$WT/README.upstream.md"
echo "$SHA" > "$WT/UPSTREAM_COMMIT"

git -C "$WT" add -A
if git -C "$WT" diff --cached --quiet; then
  echo "upstream already at cursor/plugins@${SHA:0:7}; nothing to do."
else
  git -C "$WT" commit -q -m "upstream: cursor/plugins@${SHA:0:7} $TREE"
  echo "upstream updated to cursor/plugins@${SHA:0:7}."
  echo "next: git merge upstream   (on main)"
fi
