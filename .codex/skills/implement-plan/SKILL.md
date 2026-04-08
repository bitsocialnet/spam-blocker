---
name: implement-plan
description: Orchestrates a multi-task implementation by delegating backend slices to plan-implementer subagents. Use when the user provides a plan and wants it executed in parallel where possible.
---

# Implement Plan

Use this skill when the work has already been broken into concrete tasks and the goal is to execute them with minimal context churn.

## Workflow

1. Read the plan and split tasks by dependency.
2. Group independent backend tasks into parallel batches, keeping file ownership disjoint.
3. Delegate each batch to `plan-implementer` with exact file paths, acceptance criteria, and constraints.
4. Verify the combined result with the repo's Yarn checks.

## Notes

- Keep the main context focused on orchestration.
- Prefer small, reviewable slices.
- For this repo, prioritize server, risk-score, DB, and workflow tasks over UI assumptions.
