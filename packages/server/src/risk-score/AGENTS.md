# packages/server/src/risk-score/AGENTS.md

These rules apply to `packages/server/src/risk-score/**`. Follow the repo-root `AGENTS.md` first.

- Treat risk-score changes as user-facing behavior changes, even when the code looks internal.
- When a factor, weight, or threshold changes, update `RISK_SCORING.md` and regenerate `RISK_SCORE_SCENARIOS.md`.
- Check whether `packages/server/scripts/generate-risk-score-scenarios.ts` needs to change when the factor model changes.
- Prefer targeted tests around the affected factor or threshold instead of broad rewrites.
- Keep explanations, scenarios, and factor names consistent with the implementation.
- Preserve the current score normalization model unless the user explicitly asks to change it.
