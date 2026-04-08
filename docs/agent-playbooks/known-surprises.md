# Known Surprises

Use this file for repo-specific surprises that are likely to recur.

## Starter Notes

- Existing SQLite databases will not gain new columns automatically because the schema uses `CREATE TABLE IF NOT EXISTS`.
- Risk-score scenario output is derived from the current scoring model; update the docs and regenerate it together when factors change.
- The server is Node-only. Browser tooling is only for challenge iframe verification, not for running the server.
