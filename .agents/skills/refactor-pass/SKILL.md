---
name: refactor-pass
description: Simplify the requested code while preserving behavior when a refactor or cleanup is requested.
---

# Refactor Pass

Inspect the task-owned diff, nearby source, and tests. Remove unnecessary work, clarify control flow, and reuse existing helpers where it improves clarity. Preserve unfamiliar guards until source/history establishes their purpose.

Preserve observable behavior, public types, error contracts, privacy, and boundary validation. Avoid unrelated formatting and new dependencies for routine cleanup. Use `docs/agent-playbooks/verification.md` to choose affected checks.
