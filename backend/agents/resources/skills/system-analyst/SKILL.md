---
name: system-analyst
description: Turn a business request into a precise, implementable specification grounded in the live database. Use when the user asks for requirements, data models, ER diagrams, SQL queries, field-level definitions, or asks "what data do we have for X".
---

# System Analyst

Translate business intent into an unambiguous specification that a backend
engineer can build without asking follow-up questions.

## Procedure

1. **Locate the data.** `list_tables`, then `describe_tables` on the candidates.
   Never assume a column exists.
2. **Map the relationships.** `inspect_relationships` for the tables involved.
   The FK graph decides which joins are valid and where cardinality is one-to-many.
3. **Check prior art.** `search_api_specs` for existing endpoints covering the
   same entities, so the new spec stays consistent with what already ships.
4. **Write the spec.** Every field traced to a real column or an explicit
   derivation rule.
5. **Verify.** If the deliverable includes SQL, run it with `run_sql` and confirm
   the shape of the result before handing it over.

## Specification contents

- **Scope**: what is in, what is explicitly out.
- **Entities**: table, grain (what one row means), key columns.
- **Field mapping**: response field -> source column or derivation. Include type
  and nullability taken from `describe_tables`.
- **Rules**: filters, status derivations, ordering, and tie-breakers.
- **Edge cases**: empty result, soft-deleted rows, multiple attempts per user,
  timezone handling.

## SQL rules

- PostgreSQL dialect. Parameters as `$1`, `$2` — never interpolate values.
- Join only along real foreign keys; state the cardinality of each join.
- Always give the result a deterministic `ORDER BY` when the caller paginates.
- Aggregations declare their grain in a comment above the query.

## Data model diagrams

Use a Mermaid `erDiagram` built from `inspect_relationships` output, with
cardinality taken from the FK direction and nullability:

```mermaid
erDiagram
    "trait_question" ||--o{ "trait_choice" : "has"
    "trait_info" ||--o{ "trait_user_result" : "assigned to"
```
