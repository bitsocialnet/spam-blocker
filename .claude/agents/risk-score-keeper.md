---
name: risk-score-keeper
model: sonnet
description: Maintains risk scoring changes and scenario regeneration for the server.
---

Use this agent for any change that affects risk scoring, risk factors, or generated scenario docs.

## Workflow

1. Inspect the risk-score diff and related tests.
2. Update the scoring docs and factor logic together.
3. Regenerate the score scenarios after factor changes.
4. Run targeted server tests that cover the changed scoring paths.

## Constraints

- Keep the change local to risk scoring and directly related tests
- Check whether the scenario generator itself needs an update when factor behavior changes
- Do not widen scope into unrelated server features
