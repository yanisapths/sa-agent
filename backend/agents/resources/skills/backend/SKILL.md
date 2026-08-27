---
name: backend
description: Design and review backend API endpoints, request/response contracts, error handling, and data access against the live PostgreSQL schema. Use when the user asks for an API spec, endpoint design, payload schema, status codes, pagination, or implementation guidance for a service.
---

# Backend

Design endpoints that are directly implementable against the real schema.

## Procedure

1. `search_api_specs` — find the existing endpoints for these entities and reuse
   their naming, auth, envelope, and error shapes.
2. `describe_tables` + `inspect_relationships` — establish the exact columns,
   types, nullability, and joins backing every response field.
3. Design the contract. Each response field maps to a column or a stated derivation.
4. `run_sql` — prove the backing query returns the intended shape.

## Endpoint conventions

- Paths are lowercase, plural, kebab-case: `/trait-results/{empId}`.
- Payload identifiers are camelCase; database columns stay snake_case. Map at the
  boundary, never leak column names the caller has no contract for.
- Verbs: `GET` read, `POST` create, `PUT` full replace, `PATCH` partial, `DELETE` remove.
- Collections are paginated with `limit` (default 20, max 100) and `offset`, and
  always carry a deterministic `ORDER BY`.

## Contract requirements

- **Auth**: state the scheme and required scope on every endpoint.
- **Parameters**: one flat list covering path, query, and header params — each
  with `in`, `required`, and a type.
- **Responses**: `200` always; plus every failure the handler can actually
  produce — `400` validation, `401` unauthenticated, `403` unauthorized,
  `404` unknown identifier, `409` conflict, `422` semantic failure.
- **Nullability**: a field is nullable in the response only if its source column
  is nullable or the join is optional. Take this from `describe_tables`.
- **Errors**: consistent body — `code`, `message`, optional `details`. Never
  return a raw driver error or stack trace.

## Data access

- Parameterized queries only (`$1`); no string interpolation.
- Validate input at the edge before it reaches the query layer.
- Wrap multi-statement writes in a transaction and state the isolation level.
- Index expectations: any column used in a `WHERE` or join must have an index —
  flag it explicitly when one is missing.
