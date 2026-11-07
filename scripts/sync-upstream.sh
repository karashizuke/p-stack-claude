#!/usr/bin/env bash
# Pull the latest Claude Code tree of pstack from cursor/plugins into the `upstream` branch.
# Run from anywhere inside this repo. It never touches `main`; merge yourself afterwards.
set -euo pipefail

REPO=https://github.com/cursor/plugins.git
TREE=harness/pstack/claude-code

cd "$(git rev-parse --show-toplevel)"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

git fetch -q origin upstream
if ! git rev-parse -q --verify refs/heads/upstream >/dev/null ||
   git merge-base --is-ancestor upstream origin/upstream; then
  git update-ref refs/heads/upstream origin/upstream
elif ! git merge-base --is-ancestor origin/upstream upstream; then
  echo "local upstream has diverged from origin/upstream; reconcile it first." >&2
  exit 1
fi
BASE=$(git rev-parse upstream)
OLD=$(git cat-file -p upstream:UPSTREAM_COMMIT)

# No --depth: the report walks OLD..SHA. The sparse checkout is what fetches the tree's blobs.
git clone -q --filter=blob:none --sparse "$REPO" "$TMP/src"
git -C "$TMP/src" sparse-checkout set "$TREE"
SHA=$(git -C "$TMP/src" rev-parse HEAD)
SRC=$(git -C "$TMP/src" rev-parse "HEAD:$TREE")

if [ "$(git -C "$TMP/src" rev-parse "$OLD:$TREE")" = "$SRC" ]; then
  echo "$TREE unchanged since cursor/plugins@${OLD:0:7} (head is ${SHA:0:7}); nothing to do."
  exit 0
fi

# Copy objects, not files: with core.filemode=false, git add gives every new file mode 100644 and drops its exec bit.
git -C "$TMP/src" rev-list --objects "$SRC" | cut -d' ' -f1 |
  git -C "$TMP/src" pack-objects -q --stdout | git unpack-objects -q
STAMP=$(printf '%s\n' "$SHA" | git hash-object -w --stdin)

export GIT_INDEX_FILE="$TMP/index"
git read-tree "$SRC"
git update-index --force-remove README.md
git update-index --add --cacheinfo "100644,$(git rev-parse "$SRC:README.md"),README.upstream.md"
git update-index --add --cacheinfo "100644,$STAMP,UPSTREAM_COMMIT"
NEW=$(git commit-tree "$(git write-tree)" -p "$BASE" -m "upstream: cursor/plugins@${SHA:0:7} $TREE")
unset GIT_INDEX_FILE

# Computed before the ref moves: the diff can hit the network, and a rerun would print nothing.
LOG=$(git -C "$TMP/src" log --format='- %h %ad %s' --date=short "$OLD..$SHA" -- "$TREE")
STAT=$(git -C "$TMP/src" diff --shortstat "$OLD" "$SHA" -- "$TREE")
git update-ref refs/heads/upstream "$NEW" "$BASE"

echo "upstream updated to cursor/plugins@${SHA:0:7} (was ${OLD:0:7})."
echo "https://github.com/cursor/plugins/compare/$OLD...$SHA"
echo "$LOG"
echo "$STAT"
echo "next: merge upstream into main, add an entry to UPSTREAM_LOG.md, then git push origin main upstream"
