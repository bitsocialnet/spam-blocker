#!/bin/bash

set -euo pipefail

input="$(cat)"
file_path="$(printf '%s' "$input" | jq -r '.file_path // empty' 2>/dev/null || true)"

if [ -z "$file_path" ]; then
  file_path="$(printf '%s' "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
fi

case "$file_path" in
  package.json|packages/*/package.json)
    repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
    cd "$repo_root" || exit 0
    echo "package.json changed - running corepack yarn install..."
    corepack yarn install
    ;;
esac

exit 0
