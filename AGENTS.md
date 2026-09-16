# AGENTS.md

## Purpose

This file defines the always-on rules for AI agents working on Bitsocial Spam Blocker.
Use it as the default policy. Load linked playbooks only when their trigger condition applies.

## Surprise Handling

Report unexpected repository-specific behavior and continue independent work. Ask only when missing information prevents a correct decision.
After confirmation, add a concise note to `docs/agent-playbooks/known-surprises.md` if the issue is likely to recur.

## Project Overview

Public integration surface for the Bitsocial spam blocker. This repo contains the challenge package and shared schemas used by communities and by the hosted server implementation.

## Instruction Priority

1. User request
2. MUST rules
3. SHOULD rules
4. Playbooks

## Agent Operating Principles

- Before editing, state important assumptions when the task is ambiguous. Ask instead of silently choosing between materially different interpretations.
- Prefer the smallest implementation that solves the requested problem. Do not add speculative abstractions, configurability, or features.
- Keep diffs surgical. Do not refactor, reformat, rename, or "improve" adjacent code unless it is necessary for the task.
- Clean up only artifacts created by the current change, such as newly unused imports or dead helper code.
- For non-trivial work, define success criteria and verify them with the narrowest reliable checks before marking the task complete.

## LLM Knowledge Base Policy

Use compiled context for orientation, not as source of truth.

Source of truth:

- Code, tests, package manifests, docs, and runtime/live evidence when relevant.

Compiled context:

- `AGENTS.md`, directory-specific `AGENTS.md` files, `CLAUDE.md`, and repo-managed `.codex/`, `.cursor/`, and `.claude/` workflow files.
- `docs/agent-playbooks/**`, `docs/agent-runs/**`, `docs/agent-playbooks/known-surprises.md`, and tracked `llms.txt` / `llms-full.txt` files when present.

Agents may use compiled context to navigate quickly, but must verify against source files before making behavioral claims or edits. External code graph, RAG, MCP, or wiki tools are optional local accelerators unless the developer explicitly asks to make one part of the committed workflow.

## Task Router

| Situation                            | Action                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Bug reported                         | Apply the Testing rules below before editing                                                                           |
| `package.json` changed               | Run `corepack yarn install` to keep `yarn.lock` in sync                                                                |
| Code or automation changed           | Select affected checks using `docs/agent-playbooks/verification.md`                                                    |
| New testable behavior added          | Add focused Vitest coverage                                                                                            |
| Shared schema changed                | Keep it in `packages/shared`                                                                                           |
| README drifts from implementation    | Update `README.md`                                                                                                     |
| Public docs or AI context changed    | Run `corepack yarn llms:generate`; inspect and commit any resulting changes to `llms*.txt` so LLM indexes stay current |
| AI workflow files changed            | Edit shared sources; run `ai-workflow:sync`, `ai-workflow:check`, and `ai-workflow:test`                               |
| Bug fix or substantive review correction exposes a preventable mistake | Use [retro](.agents/skills/retro/SKILL.md) before finishing; preserve review-only scope. |
| Durable resumption or handoff needed | Use `docs/agent-playbooks/long-running-agent-workflow.md`                                                              |
| GitHub operation needed              | Use `gh` CLI, not GitHub MCP                                                                                           |
| User-facing UI text                  | Use `Bitsocial` for product/network text and `PKC` / `pkc-js` for protocol-core names                                  |

## Stack

- Runtime: Node.js v22+ / TypeScript / ESM
- Workspace: Yarn 4 workspaces (`challenge`, `shared`)
- Public packages: challenge integration / shared Zod schemas
- Tooling: vitest / esbuild / Prettier / commitlint / husky

## Project Structure

```text
packages/
├── challenge/  # package for community owners
└── shared/     # shared types and Zod schemas
```

## MUST Rules

### Environment & Build

- Node.js v22+ required for all packages.
- Prefer Corepack-managed Yarn for install and verification commands.
- Select affected verification using `docs/agent-playbooks/verification.md`; run full build/type-check/tests for runtime integration changes and releases.
- The challenge package runs in Node.js only, never in the browser.
- Prefer static imports; dynamic imports should not be needed.

### Code Style

- Function parameters should use a single object shape: `{param1, param2}`.
- Keep types precise; use `unknown` and narrow guards at external boundaries. Ask only when the underlying contract cannot be established.
- In user-facing UI text, use `Bitsocial` for product/network text and `PKC` / `pkc-js` for protocol-core names.

### Testing

- A bug fix requires either a reproduction of the reported behavior or conclusive source/runtime evidence that identifies both the defect and the correct fix with equivalent certainty.
- If the bug cannot be reproduced and the evidence is not conclusive, do not guess or make speculative changes. Report what was checked, say that the bug was not reproduced, and ask for the missing reproduction details when useful.
- When proceeding from conclusive evidence without a reproduction, explain why the evidence is sufficient and add a targeted regression test when practical.
- Add Vitest coverage for non-trivial, testable behavior changes; keep fixtures focused.
- When a bug is reproduced in a test, confirm the test fails before the fix and passes afterward.

### Dependencies & Types

- Do not duplicate `pkc-js` schemas or types. Import them from `@pkcprotocol/pkc-js`.
- `community.address` can be a domain. Resolve it with `pkc-js` to get the public key.

### Shared Code

- Schemas shared between the challenge package and the private hosted server belong in `packages/shared`.

### Security & Trust

- Author fields are user-provided and not trusted, except `author.community`, which is generated by the community and can be trusted.
- Authors can spam with different signers; the protocol is pseudonymous.

### Git Worktrees

- Always give a new worktree a descriptive name that reflects the task (e.g. `fix-challenge-timeout`, not `wt1`, `tmp`, `feature`, or a numbered slug), so it can be identified at a glance in a long list of worktrees.

## SHOULD Rules

- Keep `README.md` in sync with implementation changes when committing.

## Playbooks

Consult these only when the task touches their domain:

| Topic                      | Location                                              |
| -------------------------- | ----------------------------------------------------- |
| Hooks setup                | `docs/agent-playbooks/hooks-setup.md`                 |
| Skills and tools           | `docs/agent-playbooks/skills-and-tools.md`            |
| Bug investigation workflow | `docs/agent-playbooks/bug-investigation.md`           |
| Long-running task handoff  | `docs/agent-playbooks/long-running-agent-workflow.md` |
| Known surprises log        | `docs/agent-playbooks/known-surprises.md`             |
| Full API spec              | `README.md`                                           |

## Workflow and ownership

- Continue authorized work through implementation, affected checks, and fixes. Ask only when missing information changes the result or an action lacks authorization; do not add approval gates from suggested skill procedures.
- Verify technical claims against source, tests, manifests, and runtime evidence. Agent instructions and generated context orient the task; they do not establish behavior.
- Keep changes scoped, preserve unrelated edits and preexisting artifacts, and stage only task-owned changes. Commit, push, publish, or merge only within the user’s authorization; existing authorization persists.
- Keep `master` releasable. Use a short-lived descriptive `codex/` branch for new work unless the user requests another branch or direct work on `master`. Use separate worktrees for unrelated concurrent tasks; never switch branches underneath another agent.
- Delegate substantial independent slices when useful, with explicit scope, file ownership, acceptance criteria, and evidence to return. Small or coupled work can stay local. Use built-in worker/explorer roles where available; custom roles cover project-specific review or verification.
- One owner runs installs, full suites, builds, and browsers. Parallelize independent reads and non-overlapping edits; use at most four workers by default. Do not run Git cleanup, installs, full verification, or review loops from lifecycle hooks.
- Review the final diff and use the narrowest reliable checks in [verification.md](docs/agent-playbooks/verification.md). Repeat checks only after relevant changes, failures, or new uncertainty. Preserve explicit CI/release requirements.

## Shared AI tooling

- Edit `.agents/skills/` and `.agents/roles/`, then run `corepack yarn ai-workflow:sync`, `corepack yarn ai-workflow:check`, and `corepack yarn ai-workflow:test`.
- `.agents/roles/` is this repository’s generator input, not a native app discovery path. Commit the generated `.codex/agents/*.toml`, `.cursor/agents/*.md`, `.claude/agents/*.md`, and `.claude/skills/` outputs. Codex and Cursor read `.agents/skills/`; Claude uses the generated copies and `CLAUDE.md` importing `AGENTS.md`.
- Leave model and reasoning fields unset in skills and roles. Runtime invocation, app/user defaults, and parent inheritance select them. Do not pin a generation or model family in repository prompts.
- Keep hook schemas and permissions native to each harness; similar file contents do not imply identical runtime behavior. See [skills-and-tools.md](docs/agent-playbooks/skills-and-tools.md).
- Keep skill descriptions precise and roots short. Load references when relevant; preserve domain constraints and supported manual-invocation metadata. Prefer installed tools and current official documentation when versions matter; search for or install additional skills only when requested.
