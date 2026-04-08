# Bug Investigation

Use this playbook when the user reports a bug or a regression.

## Minimum Sequence

1. Inspect the affected files and surrounding code.
2. Check recent git history for the affected area.
3. Reproduce the bug with a test case first when possible.
4. Make the smallest fix that addresses the observed behavior.
5. Re-run the relevant verification commands.

## Practical Guidance

- Prefer `git log --oneline -5 -- <file>` or `git blame` before editing.
- Keep the investigation scoped to the reported behavior.
- If a schema or DB behavior is implicated, confirm whether the on-disk database needs to be recreated.
- If risk-score logic is involved, update the risk docs and scenarios before finishing.
