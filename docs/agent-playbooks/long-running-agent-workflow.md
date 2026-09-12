# Long-running work

Use durable state only when a task needs resumption or handoff. Short tasks and ordinary delegation do not require a task board.

Record scope, acceptance criteria, important decisions, file/branch ownership, completed checks, failures, and the next concrete step in `docs/agent-runs/<descriptive-slug>/progress.md` when shared tracked state is useful. Add a feature list only when multiple independent outcomes need tracking; templates live in `templates/`.

On resumption, inspect the current diff and relevant source before acting. Reuse verification for unchanged work and run only affected checks after new edits. Do not start a dev server or install dependencies solely to update the handoff.
