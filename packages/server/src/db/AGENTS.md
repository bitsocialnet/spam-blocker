# packages/server/src/db/AGENTS.md

These rules apply to `packages/server/src/db/**`. Follow the repo-root `AGENTS.md` first.

- Prefer existing JSON columns over introducing new tables or columns.
- If a schema column is added or modified, remind the user to delete the existing DB file because `CREATE TABLE IF NOT EXISTS` will not retrofit an existing database.
- Keep schema, insert helpers, and query helpers aligned. If the schema changes, update the nearby TypeScript types and tests together.
- Treat the SQLite schema as the source of truth for stored data. Avoid migrations unless the user explicitly asks for them.
- Keep schema changes minimal and strongly justified.
