# Skills and tools

Shared source files avoid hand-maintained copies while preserving each app’s native discovery paths.

| Content              | Edited source                                 | App-loaded output                                                                                                                 |
| -------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Skills               | `.agents/skills/<name>/`                      | Codex and Cursor use this path; Claude uses generated `.claude/skills/<name>/` copies.                                            |
| Custom agents        | `.agents/roles/<name>.md`                     | Generated `.codex/agents/<name>.toml`, `.cursor/agents/<name>.md`, and `.claude/agents/<name>.md`.                                |
| Project instructions | `AGENTS.md` and scoped directory instructions | Codex/Cursor read AGENTS.md; `CLAUDE.md` imports `@AGENTS.md` for Claude. Existing nested CLAUDE.md imports remain where present. |
| Hooks                | Shared formatter and native entrypoints       | `.codex/hooks.json`, `.cursor/hooks.json`, `.claude/settings.json`.                                                               |

`.agents/roles` is a repository-specific generator schema, not an app standard. Its supported fields are `name`, `description`, and optional `sandbox-mode`. No repository field selects models or reasoning effort; runtime invocation, configured defaults, or parent inheritance decide. This does not promise automatic selection of the best current model.

Read-only roles map to Codex `sandbox_mode`, Cursor `readonly`, and Claude tool restrictions. These controls have different semantics; Claude's Bash availability is not an OS sandbox. Parent assignments still define scope.

After editing sources, run `corepack yarn ai-workflow:sync`, `corepack yarn ai-workflow:check`, and `corepack yarn ai-workflow:test`. Review and commit generated outputs together. Sync does not silently delete obsolete files; remove obsolete task-owned outputs explicitly and let validation detect drift. Skills are portable copies, not symlinks.

Keep descriptions short and discriminating; place conditional procedures in linked references. Preserve domain-specific requirements rather than copying another product’s policy. Avoid compulsory agent chains, full tests for wording edits, unconditional external skill installs, and extra approval gates. Built-in worker/explorer roles handle general implementation; retained custom agents cover concrete independent review or domain tasks.

Official references, checked 2026-09-12: [Codex skills](https://learn.chatgpt.com/docs/build-skills), [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Cursor skills](https://cursor.com/docs/skills), [Cursor subagents](https://cursor.com/docs/subagents), [Cursor rules](https://cursor.com/docs/rules), [Claude skills](https://code.claude.com/docs/en/skills), [Claude subagents](https://code.claude.com/docs/en/sub-agents), and [Claude imports](https://code.claude.com/docs/en/memory). Cursor supports both shared and compatibility skill roots; its documentation does not establish deduplication behavior for identical skills discovered in both. Generator/schema checks are separate from live app discovery and delegation tests.

Maintenance approach: [OpenAI’s guidance on skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra). Keep useful guidance for other contributors and models while reducing redundant workflow instructions.
