---
name: playwright-cli
description: Automates browser verification for local routes and iframe flows. Use when checking challenge pages, OAuth status views, or other browser-visible server output.
---

# Playwright CLI

Use this skill for read-only browser verification against a running local server.

## Defaults

- Prefer a fresh isolated session
- Do not start or stop the server
- Focus on the route the parent agent asked about

## Good fits for this repo

- `/api/v1/iframe/:sessionId`
- `/api/v1/oauth/status/:sessionId`
- Challenge completion flows
