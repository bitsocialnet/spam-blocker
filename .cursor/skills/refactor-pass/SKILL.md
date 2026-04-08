---
name: refactor-pass
description: Performs a cleanup pass on recent changes to simplify backend code without changing behavior. Use when the user asks for a refactor or cleanup.
---

# Refactor Pass

Look for duplicated logic, over-abstraction, and noisy defensive code.

## Priorities

- Simplify route handlers and server utilities
- Keep schemas and types explicit
- Prefer targeted helper extraction over large rewrites
