---
name: risk-score-maintenance
description: Maintains the risk scoring system when factors, weights, or scoring behavior change. Use when working under packages/server/src/risk-score.
---

# Risk Score Maintenance

Use this skill for any change that affects risk scoring, risk factors, or generated scenario docs.

## Workflow

1. Inspect the risk-score diff and related tests.
2. Update scoring docs and factor logic together.
3. Regenerate the score scenarios after factor changes.
4. Run targeted server tests that cover the changed scoring paths.

## Notes

- Check whether the scenario generator itself needs an update when factor behavior changes.
- Keep changes deterministic and explain any score shifts clearly.
