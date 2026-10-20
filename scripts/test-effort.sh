#!/usr/bin/env bash
# Run only the effort mod's tests, on a copy of the plugin without skills/. `claude plugin test .` also picks up upstream's bun tests under skills/, which it cannot load.
# Run from anywhere inside this repo. Exits with the tests' status.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp -R "$ROOT/plugin.json" "$ROOT/hooks" "$ROOT/commands" "$ROOT/tests" "$TMP/"
claude plugin test "$TMP"
