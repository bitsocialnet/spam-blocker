#!/bin/bash

set -u

mode="${AGENT_VERIFY_MODE:-strict}"

if [ "${1:-}" = "--advisory" ]; then
  mode="advisory"
  shift
fi

cat > /dev/null

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root" || exit 0

cleanup_generated_dir() {
  local path="$1"

  if git ls-files --error-unmatch "$path" >/dev/null 2>&1; then
    if git diff --quiet -- "$path"; then
      return
    fi

    echo "=== git restore --worktree $path ==="
    git restore --worktree -- "$path" 2>/dev/null || true
    echo ""
    return
  fi

  if [ -e "$path" ]; then
    echo "=== rm -rf $path ==="
    rm -rf "$path" 2>/dev/null || true
    echo ""
  fi
}

run_required_check() {
  local label="$1"
  shift

  echo "=== $label ==="
  if "$@" 2>&1; then
    echo ""
    return 0
  fi

  echo ""
  return 1
}

echo "Running build, type-check, test, and formatting checks..."
echo ""

failures=0

run_required_check "corepack yarn build" corepack yarn build || failures=1
run_required_check "corepack yarn type-check" corepack yarn type-check || failures=1
run_required_check "corepack yarn test" corepack yarn test || failures=1
run_required_check "corepack yarn format:check" corepack yarn format:check || failures=1

echo "=== corepack yarn npm audit ==="
corepack yarn npm audit 2>&1 || true
echo ""

cleanup_generated_dir build
cleanup_generated_dir dist

if [ "$failures" -ne 0 ]; then
  if [ "$mode" = "advisory" ]; then
    echo "Verification failed, but AGENT_VERIFY_MODE=advisory so the hook is exiting 0."
    exit 0
  fi

  echo "Verification failed."
  exit 1
fi

echo "Verification complete."
exit 0
