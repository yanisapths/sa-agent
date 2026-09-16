# Full Deep Agent coding evals (later)

Do not implement this until the local chat + slim coding suite is useful.
This is the production-shaped follow-up: the real router and `task(execute)`.

## Goal

Reuse the same coding fixtures, hidden tests, and YAML tasks (`suite: coding-deep`
or a flag on the existing coding tasks). Grade **outcome**, not the exact `task()`
string.

## How to run a trial

1. Copy `evaluators/fixtures/coding/<task>/workspace` into an isolated temp dir
   (existing `withIsolatedSandbox`).
2. Pre-seed `/artifacts/plan.md` on the Deep Agent state backend **and** a tiny
   `docs/sa/plan.md` in the fixture so the cheap path is execute-only, not
   discuss → plan → execute.
3. Invoke [`agentFor()`](../sa-agent.ts) with a unique `thread_id` and
   `configurable.workspaceRoot` = sandbox root.
4. Drive the graph with the same auto-approve loop as
   [`invokeAgentTurn`](../../internal/chat/execute.ts):
   `resumeCommand(autoApproveDecisions(...))`, hop cap 16.
5. After the graph finishes, run the same hidden tests as slim coding
   (`EVAL_WORKSPACE` + `tests/verify.ts`) and check that `execute.md` exists.
6. Dump the transcript. Expect more tokens and flakiness than slim coding;
   use `EVAL_TRIALS` before trusting scores.

## Fixtures the router still needs

The orchestrator tools include `search_docs`, `list_tables`, and
`describe_tables`. Stub those the same way conversational evals do, or the
router will stall on live Mintlify/Postgres.

Do not require a specific `task(execute)` argument. If the agent implements the
plan and hidden tests pass, it passed.

## Why this waited

Chat evals and the slim coder already give a hill to climb. Full Deep Agent
adds HITL hops, specialist prompts, and index tools. Add it when those scores
stop moving and you need the real harness in the loop.
