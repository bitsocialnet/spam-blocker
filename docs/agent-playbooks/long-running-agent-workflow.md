# Long-Running Agent Workflow

Use this playbook when a task spans multiple sessions, handoffs, or spawned agents.

## Recommended State

Keep task state in a tracked location such as `docs/agent-runs/<slug>/`.

Suggested files:

- `feature-list.json`
- `progress.md`

## Workflow

1. Break the work into a stable feature list.
2. Record the current status before handing off.
3. Keep each agent slice narrow and independently verifiable.
4. Update progress after each meaningful milestone.
5. Preserve any assumptions that future agents need to know.

## Template Use

- Use `docs/agent-playbooks/templates/feature-list.template.json` for the task list shape.
- Use `docs/agent-playbooks/templates/progress.template.md` for the progress log.
