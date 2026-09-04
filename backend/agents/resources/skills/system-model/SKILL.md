---
name: system-model
description: Understand how this codebase actually hangs together, and why. Use when the task needs the components behind a feature, the blast radius of a change, a risk assessment before planning, or the reason an existing implementation is the way it is.
---

# System Model

A deterministic graph of this repository in `.sa/system-model.db`, plus the
engineering decisions behind it in `.sa/decisions/`.

The live database tells you **what exists**. The index tells you **what was
written down**. This tells you **what connects to what**, and **why**.

## Build it first

`build_system_model` scans the repo and reads the live schema. It is
deterministic and costs nothing, so run it whenever the code may have moved:

```
build_system_model
```

Read the report. Two lines matter:

- *Live schema: not reachable* — table nodes came from SQL in the code and are
  unverified. Say so in your artifact rather than presenting them as fact.
- *Referenced in code but absent from the live schema* — each one is a real
  finding: a stale query, a view in another schema, or a typo.

## What is in the graph

| Node | Comes from |
| --- | --- |
| `endpoint` | route declarations, resolved through `app.use` mount prefixes |
| `service`, `repository`, `module` | backend files, named after their principal class |
| `component` | frontend files |
| `test`, `doc` | test files, markdown |
| `table`, `column` | the live PostgreSQL schema |
| `decision` | `.sa/decisions/*.md` |

Every edge points **from the dependent to the dependency**, so "what breaks if
I change X" is a walk backwards from X. That is what `simulate_impact` does.

## Procedure

1. **Find the real components.** `query_system_model "<name>"` for a class,
   file, `table.column`, or `GET /path`. `*` gives an overview and the
   most-depended-on nodes. This replaces guessing at file names.
2. **Check for a reason.** `search_decisions "<topic>"` before proposing
   anything that changes existing behaviour. If a decision covers it, either
   respect it or argue against it explicitly — do not silently reverse it.
3. **Simulate the change.** `simulate_impact "<target>"` for every element you
   intend to touch. Put the affected layers and the risk line in your artifact.
4. **Record what the code cannot show.** After a decision is made, and only
   with the human's own reasoning, `record_decision`.

## Reading an impact report

The report groups the blast radius by layer — API, Backend, Database,
Frontend, Tests, Documentation — and prints a risk level with the arithmetic
behind it. Use the parts, not just the label:

- **API rows** are an external contract. Callers you do not control break.
- **"No test points at these affected files"** is your test plan for the change.
- **Decisions that constrain this area** must be read before you plan.
- **"Nothing depends on this node"** means either genuinely safe, or the
  dependency is dynamic and the scan cannot see it. Say which you believe.

Depth defaults to 4 hops. Lower it when a hub node floods the report; raise it
when you need the far edge of a rename.

## Limits, state them when they matter

Pattern matching, not a compiler. It does not see routes registered through a
factory, table names assembled at runtime, dependency injection by string
token, or calls made across a message queue. A quiet impact report on a
dynamic codebase is weak evidence, not proof. Confirm structure against the
live schema before you rely on it.

## Recording a decision

Capture the reasoning, not the diff — git already has the diff.

```
record_decision
  title: "Store trait results instead of recomputing them"
  context: "Scores are derived from questions that get reworded between releases."
  decision: "Persist the computed result in trait_user_result at submit time."
  reason: "A user's past result must stay reproducible after the questions change."
  alternatives: "Recompute on read — rejected, historical results would drift."
  consequences: "A scoring bug needs a backfill; the table grows with submissions."
  related: ["trait_user_result", "TraitResultService", "POST /trait/results"]
```

Each `related` entry is resolved against the graph, so the decision surfaces in
the impact report for those nodes later. An entry that resolves to nothing is
reported back — fix it rather than leaving a dead link.
