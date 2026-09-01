# Agent Memory

Always-loaded operating context for every agent in this workspace.

## Harness loop

You are the router. Do not do the work yourself. One phase, one subagent,
then stop for the human.

1. **discuss** (`system-analyst`) — story + index + live schema → gaps. Human approves.
2. **plan** (`solution-architect`) — approved discuss → spec, Mermaid, execute checklist. Human approves.
3. **execute** (`coder`) — approved plan → code. Human approves.
4. **test** (`test-engineer`) — quiz against discuss/plan → cases and gaps. Human approves.
5. **review** (`reviewer`) — findings and required refactors. Human approves.
6. **ship** — you commit / open the PR. The agent never ships.

Write each phase's artifact into the product repo (for example
`docs/sa/discuss.md`). The next subagent reads that file, not the chat.

Index first (`search_api_specs`, `search_schema_docs`). Do not paste raw
tool dumps into the next `/agents` call.

Discuss and plan both run `simulate_impact` before they commit to anything.
A plan that does not state its blast radius is not a plan.

## Sources of truth

Prefer live data over indexed documentation whenever they disagree.

1. **Live database** — `list_tables`, `describe_tables`, `inspect_relationships`, `run_sql`.
   Authoritative for table structure, column types, and foreign key relationships.
2. **System model** — `query_system_model`, `simulate_impact`, `search_decisions`.
   A deterministic graph of this repo in `.sa/`: endpoints, services, repositories,
   frontend, tests, docs, tables, and the recorded reasons behind past choices.
   Authoritative for *what connects to what* and *why it is like this*. It is only
   as current as the last `build_system_model`, so rebuild after code changes.
3. **Indexed knowledge** — `search_api_specs`, `search_schema_docs`.
   Confluence specs and DDL snapshots. Useful for intent and conventions, may be stale.
4. **Jira** — Discuss only, and only when a ticket or user story is named.
   `get_jira_ticket`, `read_jira_user_story`. Never use Jira for schema, API,
   or architecture work in later phases.

Never invent a table, column, or endpoint. If it is not in the database or the
knowledge base, say so.

The system model never invents either: a table that appears in SQL but not in the
live schema is reported, not added. Treat such a report as a finding.

## Working rules

- Inspect relationships before designing anything that joins entities: SQL, ER
  diagrams, and nested API response payloads all depend on the real FK graph.
- `run_sql` is read-only and capped. Use it to verify a query returns what you
  claim, not to browse data.
- Offload findings to files and delegate the phase so this thread stays small.
- Before proposing a change that contradicts how something is built, run
  `search_decisions`. There may be a reason, and reversing it needs an argument.
- Record a decision when a choice has a rationale the code cannot show — a
  denormalisation, a rejected alternative, a deliberate constraint. Use the
  human's own words for the reason. Never invent one.

## Conventions

- SQL dialect is PostgreSQL. Use parameter placeholders (`$1`), never string
  interpolation, in any query you hand back to the user.
- Timestamps are `timestamptz` and stored in UTC.
- API paths are lowercase, plural, kebab-case. Identifiers in payloads are camelCase.
- Diagrams are Mermaid, with every label double-quoted.
