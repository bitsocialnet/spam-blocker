# AGENTS.md

## Purpose

This file defines the always-on rules for AI agents working on Bitsocial Spam Blocker.
Use it as the default policy. Load linked playbooks only when their trigger condition applies.

## Surprise Handling

If you encounter something ambiguous, surprising, or repo-specific that is not covered here, stop and ask the developer before proceeding.
After confirmation, add a concise note to `docs/agent-playbooks/known-surprises.md` if the issue is likely to recur.

## Project Overview

Spam blocker for the Bitsocial protocol. The server handles risk scoring, challenge orchestration, rate limiting, and reputation data for pseudonymous communities.

## Instruction Priority

1. User request
2. MUST rules
3. SHOULD rules
4. Playbooks

## Task Router

| Situation                                  | Action                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| DB schema column added or modified         | Remind the user to delete the existing DB file                                                                           |
| Risk score logic changed                   | Update `packages/server/src/risk-score/RISK_SCORING.md` and run `cd packages/server && corepack yarn generate-scenarios` |
| Risk factor changed                        | Check whether the scenario generator also needs to change                                                                |
| Bug reported                               | Reproduce with a test first, then fix                                                                                    |
| `package.json` changed                     | Run `corepack yarn install` to keep `yarn.lock` in sync                                                                  |
| Code changed                               | Run `corepack yarn build` for all packages                                                                               |
| New feature added                          | Add vitest coverage                                                                                                      |
| Shared schema changed                      | Keep it in `packages/shared`                                                                                             |
| README drifts from implementation          | Update `README.md`                                                                                                       |
| Hidden AI workflow files change            | Keep the repo-managed AI workflow surfaces aligned                                                                       |
| Iframe or OAuth browser behavior changed   | Verify the affected local route with `playwright-cli` against the running server                                         |
| Long-running or multi-session task started | Track state under `docs/agent-runs/<slug>/` using the long-running workflow playbook                                     |
| GitHub operation needed                    | Use `gh` CLI, not GitHub MCP                                                                                             |
| User-facing UI text                        | Use `Bitsocial` instead of `plebbit`, `community` instead of `subplebbit`                                                |

## Stack

- Runtime: Node.js v22+ / TypeScript / ESM
- Server: Fastify / better-sqlite3 / Zod
- Workspace: Yarn 4 workspaces (`server`, `challenge`, `shared`)
- Tooling: vitest / esbuild / Prettier / commitlint / husky

## Project Structure

```text
packages/
├── server/     # HTTP server, risk scoring, indexer, challenges
├── challenge/  # package for community owners
└── shared/     # shared types and Zod schemas
```

## MUST Rules

### Environment & Build

- Node.js v22+ required for all packages.
- Prefer Corepack-managed Yarn for install and verification commands.
- Run `corepack yarn build` after coding and make sure it passes.
- Run `corepack yarn type-check` and `corepack yarn test` after meaningful code changes, unless the task is docs-only.
- Both the challenge package and the HTTP server run in Node.js only, never in the browser.
- Prefer static imports; dynamic imports should not be needed.

### Code Style

- Function parameters should use a single object shape: `{param1, param2}`.
- Everything should be properly typed. If you cannot type something, ask the user for help.
- In user-facing UI text, use `Bitsocial` instead of `plebbit` and `community` instead of `subplebbit`.

### Testing

- Add vitest tests for every new feature.
- Reproduce bugs with a test case first, then fix the code, then verify the test passes.

### Database

- No migration strategy is needed; assume an empty DB.
- Prefer existing JSON columns over adding new tables or columns. If you still think a new table or column is needed, ask the user.
- If you add or modify a column in `packages/server/src/db/schema.ts`, remind the user to delete the existing database file. The schema uses `CREATE TABLE IF NOT EXISTS`, so existing DB files will not gain new columns automatically.

### Dependencies & Types

- Do not duplicate `plebbit-js` schemas or types. Import them from `@plebbit/plebbit-js`.
- `subplebbit.address` can be a domain. Resolve it with `plebbit-js` to get the public key.

### Shared Code

- Schemas shared between the challenge package and the HTTP server/engine belong in `packages/shared`.

### Security & Trust

- Author fields are user-provided and not trusted, except `author.subplebbit`, which is generated by the subplebbit and can be trusted.
- Authors can spam with different signers; the protocol is pseudonymous.

## SHOULD Rules

- Keep `README.md` in sync with implementation changes when committing.
- Update `packages/server/src/risk-score/RISK_SCORING.md` when the risk score calculation changes.
- Regenerate `packages/server/src/risk-score/RISK_SCORE_SCENARIOS.md` when risk factors change.
- Check whether `packages/server/scripts/generate-risk-score-scenarios.ts` itself needs updates whenever risk factors change.

## Playbooks

Consult these only when the task touches their domain:

| Topic                      | Location                                                 |
| -------------------------- | -------------------------------------------------------- |
| Hooks setup                | `docs/agent-playbooks/hooks-setup.md`                    |
| Skills and tools           | `docs/agent-playbooks/skills-and-tools.md`               |
| Bug investigation workflow | `docs/agent-playbooks/bug-investigation.md`              |
| Long-running task handoff  | `docs/agent-playbooks/long-running-agent-workflow.md`    |
| Known surprises log        | `docs/agent-playbooks/known-surprises.md`                |
| Risk scoring details       | `packages/server/src/risk-score/RISK_SCORING.md`         |
| Risk score scenarios       | `packages/server/src/risk-score/RISK_SCORE_SCENARIOS.md` |
| Indexer architecture       | `packages/server/src/indexer/README.md`                  |
| OAuth provider setup       | `packages/server/src/challenge-iframes/README.md`        |
| Full API spec              | `README.md`                                              |
