---
name: deslop
description: Removes overengineered or noisy AI-generated code from recent backend changes. Use when a diff reads as too defensive or too abstract.
---

# Deslop

Scan recent edits for unnecessary abstractions, redundant guards, and comments that only restate the code.

## Watch for

- Defensive checks on trusted paths
- Wrapper functions that hide simple logic
- Casts that bypass type issues instead of solving them
- Comments that do not explain why the code exists
