# Verification

Choose checks by the changed behavior. Reuse evidence for the same final state; retain explicit CI, release, and user requirements.

| Change                                                           | Relevant checks                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation or instructions                                    | Review changed claims and links; run configured document generators. No application build.                                                                                                                    |
| AI sources, hooks, or workflow scripts                           | `corepack yarn ai-workflow:sync`, `corepack yarn ai-workflow:check`, `corepack yarn ai-workflow:test`; inspect the native configuration and generated diff.                                                   |
| Isolated runtime/helper or test change                           | Run affected Vitest paths, type-check when types/imports change, and check formatting on changed maintained files.                                                                                            |
| Shared runtime, package exports, dependencies, build/integration | Focused tests plus `corepack yarn build`, `corepack yarn type-check`, and `corepack yarn test`.                                                                                                               |
| Dependency manifest                                              | `corepack yarn install` to synchronize the lockfile; choose subsequent checks for the affected dependency/integration. Tooling-only development dependencies need workflow checks, not the application build. |
| Browser-visible behavior                                         | Exercise the affected local flow. Use Chromium for a narrow check; add Firefox/WebKit and mobile viewports for shared CSS/layout, browser-sensitive APIs, responsive changes, or explicit coverage.           |

For agent-run Vitest checks use `corepack yarn exec vitest run --maxWorkers=2 [paths]` from the relevant package. Do not start watch mode. One owner runs heavy checks; serialize builds, full suites, installs, and browsers. Inspect running processes and stop only stale task-owned processes.

Workflow fixtures use disposable directories and fake invocations to verify containment, model inheritance, generated parity, native hook structure, and no unintended lifecycle work. They do not prove that every app loaded the configuration or that model behavior is correct. For a material instruction change, exercise representative task requests where practical and report any untested runtime integration.
