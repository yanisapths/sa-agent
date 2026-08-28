---
name: jira
description: Fetch Jira tickets and user stories through MCP. Use ONLY when the user explicitly asks to get a ticket, look up a Jira issue, or read a user story. Never load this skill for schema, API, SQL, or architecture work.
---

# Jira (explicit MCP)

Jira is not a default source of truth. Call it only when the user names a
ticket or story, or clearly asks to fetch one.

## When to use

- "Get ticket PROJ-123" / "look up this Jira issue" → `get_jira_ticket`
- "Read user story PROJ-456" / "what does this story say" → `read_jira_user_story`

If the user did not ask for Jira, do not call these tools.

## Procedure

1. Take the issue key from the request (`PROJ-123`). Ask for it if missing.
2. Call the matching tool. Do not invent ticket fields.
3. Quote what Jira returned. If MCP is unconfigured or the key is unknown, say so.

## Rules

- Never use Jira to guess database tables, API paths, or architecture.
- Never search or browse Jira unprompted.
- One issue key per call. Do not fan out across the board.
