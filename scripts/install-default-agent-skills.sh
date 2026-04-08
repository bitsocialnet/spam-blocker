#!/bin/bash

set -uo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root"

skills=(
  "mcollina/skills@fastify-best-practices"
  "pproenca/dot-skills@zod"
  "pproenca/dot-skills@vitest"
  "getsentry/skills@security-review"
)

failures=()

echo "Installing default external skills for spam-blocker..."
echo "These are user-level installs performed via npx skills add -g -y."
echo ""

for skill in "${skills[@]}"; do
  echo "=== npx -y skills add $skill -g -y ==="
  if ! npx -y skills add "$skill" -g -y; then
    echo "Failed to install $skill"
    failures+=("$skill")
  fi
  echo ""
done

if [ "${#failures[@]}" -gt 0 ]; then
  echo "Default external skill installation completed with failures:"
  printf ' - %s\n' "${failures[@]}"
  exit 1
fi

echo "Default external skill installation complete."
