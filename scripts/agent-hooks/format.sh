#!/bin/bash

set -euo pipefail

input="$(cat)"
file_path="$(printf '%s' "$input" | jq -r '.file_path // empty' 2>/dev/null || true)"

if [ -z "$file_path" ]; then
  file_path="$(printf '%s' "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
fi

if [ -z "$file_path" ]; then
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
case "$file_path" in
  /*) resolved_path="$file_path" ;;
  *) resolved_path="$repo_root/$file_path" ;;
esac

case "$resolved_path" in
  "$repo_root"/*)
    ;;
  *)
    exit 0
    ;;
esac

case "$resolved_path" in
  *.js|*.cjs|*.mjs|*.ts|*.tsx|*.json|*.md|*.yml|*.yaml|*.toml|*.sh)
    corepack yarn exec prettier --write "$resolved_path" >/dev/null 2>&1 || true
    ;;
esac

exit 0
