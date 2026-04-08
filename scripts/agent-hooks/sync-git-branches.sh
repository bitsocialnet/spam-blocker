#!/bin/bash

set -euo pipefail

cat > /dev/null

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root" || exit 0

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

default_branch="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
if [ -z "$default_branch" ]; then
  default_branch="master"
fi

current_branch="$(git branch --show-current 2>/dev/null || true)"

branch_looks_temporary() {
  case "$1" in
    pr/*|feature/*|fix/*|docs/*|chore/*|codex/*|codex/pr/*|codex/feature/*|codex/fix/*|codex/docs/*|codex/chore/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

branch_is_integrated() {
  local branch="$1"
  local cherry_output

  cherry_output="$(git cherry "$default_branch" "$branch" 2>/dev/null || true)"
  if printf '%s' "$cherry_output" | grep -q '^+'; then
    return 1
  fi

  return 0
}

echo "Syncing git refs and temporary branches..."
echo ""

echo "=== git config --local fetch.prune true ==="
git config --local fetch.prune true 2>&1 || true
echo ""

echo "=== git config --local remote.origin.prune true ==="
git config --local remote.origin.prune true 2>&1 || true
echo ""

echo "=== git fetch --prune origin ==="
git fetch --prune origin 2>&1 || true
echo ""

while IFS='|' read -r branch upstream; do
  [ -z "$branch" ] && continue
  [ "$branch" = "$current_branch" ] && continue
  [ "$branch" = "$default_branch" ] && continue

  branch_looks_temporary "$branch" || continue

  if [ -n "$upstream" ] && git show-ref --verify --quiet "refs/remotes/$upstream"; then
    continue
  fi

  if ! branch_is_integrated "$branch"; then
    continue
  fi

  echo "=== git branch -d $branch ==="
  git branch -d "$branch" 2>&1 || true
  echo ""
done < <(git for-each-ref --format='%(refname:short)|%(upstream:short)' refs/heads)

echo "Git ref sync complete."
exit 0
