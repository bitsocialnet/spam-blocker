# scripts/AGENTS.md

These rules apply to `scripts/**`. Follow the repo-root `AGENTS.md` first, then use this file for automation and workflow helpers.

- Keep scripts non-interactive and idempotent.
- Print the command, URL, branch, or path being acted on so failures are diagnosable.
- Use repo-relative paths and environment variables instead of user-specific absolute paths.
- Keep shell helpers thin. When logic becomes stateful or cross-platform, prefer a Node script.
- Do not add destructive cleanup behavior unless the user explicitly asks for it.
- Prefer helpers that support the repo's Yarn-first workflow and the existing Node-only server/tooling stack.
