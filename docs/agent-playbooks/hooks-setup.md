# Agent Hooks Setup

Use this playbook when configuring lifecycle hooks for the repo-managed AI workflow.

## Recommended Hooks

| Hook            | Command                                    | Purpose                                              |
| --------------- | ------------------------------------------ | ---------------------------------------------------- |
| `afterFileEdit` | `scripts/agent-hooks/format.sh`            | Format changed source files after AI edits           |
| `afterFileEdit` | `scripts/agent-hooks/yarn-install.sh`      | Refresh the lockfile when a `package.json` changes   |
| `stop`          | `scripts/agent-hooks/sync-git-branches.sh` | Prune stale refs and conservative temporary branches |
| `stop`          | `scripts/agent-hooks/verify.sh`            | Run build, type-check, tests, and formatting checks  |

## Why

- Keeps generated edits formatted without manual cleanup
- Keeps the Yarn lockfile in sync with workspace manifests
- Catches breakage before the agent session ends
- Keeps branch hygiene predictable for Codex, Cursor, and Claude

## Guidance

- Keep the toolchain-local hook files as thin wrappers only.
- Put shared behavior in `scripts/agent-hooks/`.
- Keep hooks non-interactive and safe to rerun.
- Use `AGENT_VERIFY_MODE=advisory` only when you intentionally need signal from a broken tree.
