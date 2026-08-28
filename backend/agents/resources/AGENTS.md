# Agent Memory

Always-loaded operating context for every agent in this workspace.

## Sources of truth

Prefer live data over indexed documentation whenever they disagree.

1. **Live database** — `list_tables`, `describe_tables`, `inspect_relationships`, `run_sql`.
   Authoritative for table structure, column types, and foreign key relationships.
2. **Indexed knowledge** — `search_api_specs`, `search_schema_docs`.
   Confluence specs and DDL snapshots. Useful for intent and conventions, may be stale.
3. **Jira MCP (explicit only)** — `get_jira_ticket`, `read_jira_user_story`.
   Call these only when the user explicitly asks for a ticket or user story.
   Never use Jira for schema, API, or architecture work.

Never invent a table, column, or endpoint. If it is not in the database or the
knowledge base, say so.

## Working rules

- Inspect relationships before designing anything that joins entities: SQL, ER
  diagrams, and nested API response payloads all depend on the real FK graph.
- `run_sql` is read-only and capped. Use it to verify a query returns what you
  claim, not to browse data.
- Offload large intermediate findings to files and delegate wide research to
  subagents so the main thread stays focused.

## Conventions

- SQL dialect is PostgreSQL. Use parameter placeholders (`$1`), never string
  interpolation, in any query you hand back to the user.
- Timestamps are `timestamptz` and stored in UTC.
- API paths are lowercase, plural, kebab-case. Identifiers in payloads are camelCase.
- Diagrams are Mermaid, with every label double-quoted.
