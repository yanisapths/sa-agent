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

## PVT prep track

A separate loop, for preparing a Production Verification Test. Same rule: one
phase, one subagent, then stop for the human. Do not mix it with the harness
loop above — it has its own artifacts.

1. **pvt-discuss** (`pvt-analyst`) — requirements + the test case list (CSV,
   table, or a named Jira story), grounded on the live schema → case inventory
   and gaps. Human approves.
2. **pvt-plan** (`pvt-planner`) — approved pvt-discuss → scenario groups that
   share one data setup, the numbered script set, and the pre-window /
   in-window split. Human approves.
3. **pvt-execute** (`pvt-scripter`) — approved pvt-plan → the SQL scripts.
   Human approves.

Artifacts are `docs/sa/pvt-discuss.md`, `pvt-plan.md`, `pvt-execute.md`.

The window is the constraint. Nothing gets created inside it that could have
been staged before it, and SRE is contacted as few times as possible — every
script they run is a round trip, and any script they cannot run without asking
you is a defect in the plan.

Scripts are `NN-<action>[-pvt-NN]_<owner>.sql`, owner `devops` or `sre`,
numbers unique and ascending in run order, `_(optional)` for the rollbacks.
Every rollback is written in the same pass as the script it undoes. The
`pvt-prep` skill holds the full convention.

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
