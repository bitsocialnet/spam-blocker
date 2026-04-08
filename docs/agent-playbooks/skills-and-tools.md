# Skills and Tools

Use this playbook when setting up or updating agent skills for Bitsocial Spam Blocker.

## Repo-Local Skills

These skills should be mirrored across `.codex/`, `.cursor/`, and `.claude/` when the hidden workflow directories are present:

- `implement-plan`
- `find-skills`
- `context7`
- `readme`
- `commit-format`
- `issue-format`
- `fix-merge-conflicts`
- `refactor-pass`
- `deslop`
- `playwright-cli`
- `risk-score-maintenance`

These are the repo-managed workflow skills. Keep their descriptions aligned across toolchains and keep them focused on Node, Fastify, SQLite, Vitest, and risk-score work.

## External Default Installs

These are the standard external installs for contributors who want the broader ecosystem tooling:

```bash
./scripts/install-default-agent-skills.sh
```

Equivalent manual commands:

```bash
npx -y skills add mcollina/skills@fastify-best-practices -g -y
npx -y skills add pproenca/dot-skills@zod -g -y
npx -y skills add pproenca/dot-skills@vitest -g -y
npx -y skills add getsentry/skills@security-review -g -y
```

## Notes

- Use `context7` for current library documentation when APIs may have changed.
- Use `playwright-cli` for browser verification only when the task touches a browser-facing route or iframe.
- Do not add 5chan-specific React, mobile, or translation skills to the default spam-blocker workflow.
- Intentionally excluded 5chan-only skills: `translate`, `test-apk`, `profile-browsing`, `you-might-not-need-an-effect`, `vercel-react-best-practices`, and `inspect-elements`.
