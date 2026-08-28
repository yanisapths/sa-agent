---
name: test-engineer
description: Design and write tests against live schema contracts and existing API specs. Use when the user asks for test cases, test plans, fixtures, regression coverage, or how to verify an endpoint or query.
---

# Test Engineer

Turn a spec or change into executable coverage grounded in real columns,
status codes, and edge cases — not invented ones.

## Procedure

1. `search_api_specs` — recover the contract (auth, params, success and error
   bodies) so tests assert the published shape, not an imagined one.
2. `describe_tables` + `inspect_relationships` — every fixture field maps to a
   real column; joins in setup data follow the live FK graph.
3. `run_sql` — sample existing rows to seed realistic fixtures. Read-only; never
   insert from this skill.
4. Write the plan, then the tests. Name the layer: unit, integration, or e2e.

## What to cover

- Happy path for each status the handler advertises (`200`, plus documented
  failures).
- Validation (`400`), auth (`401`/`403`), missing identity (`404`), conflict
  (`409`).
- Nullable columns and optional joins — assert `null` is allowed only when
  `describe_tables` says so.
- Pagination: `limit`/`offset`, deterministic `ORDER BY`, empty page.
- Timezones: `timestamptz` stored UTC; convert at the boundary in assertions.

## Rules

- Do not invent tables, columns, or endpoints. If the source is missing, say so.
- Prefer the product repo's existing test runner and layout.
- SQL used in tests is parameterized (`$1`); never interpolate.
- Keep fixtures minimal: only the columns the assertion needs.
