# Agent hooks

The only automatic action is formatting successfully edited JavaScript/TypeScript files with the installed Prettier binary. No dependency installation, full verification, branch cleanup, network operations, or review loop runs when a task stops.

- Codex: `.codex/hooks.json`, `PostToolUse` matching `apply_patch`.
- Cursor: `.cursor/hooks.json`, `afterFileEdit`.
- Claude Code: `.claude/settings.json`, `PostToolUse` matching `Edit|Write|MultiEdit`.

Each native hook calls its thin `hooks/format.sh` wrapper, which locates the repository and invokes `scripts/agent-hooks/format.mjs`. The formatter handles native edit payloads, skips failed/read-only/unknown calls, resolves real paths to contain writes within the checkout, and invokes installed Prettier without a shell or package-manager bootstrap. Missing dependencies cause a no-op; formatter errors are advisory. Repository Prettier ignores still apply.

Run the workflow checks after changing a hook. Disposable fixtures exercise path traversal, symlinks, shell metacharacters, malformed payloads, multiple patch files, dependency absence, and failure reporting. These tests validate local behavior rather than proving live activation in every app; restart/reload the app when its configuration loading requires it.

Installs and verification are explicit task work selected using [verification.md](verification.md). Git cleanup happens only under the user’s authorization and after confirming branch/worktree ownership.
