# Architecture: harness loop

sa-agent is a **capability provider**, not the product you are analysing. The
LLM runtime either sits in this repo (chat GUI) or in a **product workspace**
(Claude Code). Tools, skills, and memory live here.

The core is a six-phase loop. Each phase receives declared inputs only
(index hits, live schema, previous artifact), produces one file, and stops
at a human gate. Distillation at phase N is what makes phase N+1 cheap.

Read [`harness.ts`](../harness.ts) first. That file is the contract.

## Why a harness (not one model)

A single Sonnet that discusses, plans, codes, and reviews burns context and
money. The orchestrator is a cheap router. Each phase is a specialist on a
small, fast model. Tools stay narrow so the specialist cannot wander.

| Phase | Specialist | Default model (LangChain) | Claude Code | Gate |
| --- | --- | --- | --- | --- |
| **discuss** | `discuss` / `system-analyst` | haiku | haiku | human |
| **plan** | `plan` / `solution-architect` | haiku | haiku | human |
| **execute** | `execute` / `coder` | `ollama:qwen2.5-coder` | haiku (swap to qwen) | human |
| **test** | `test` / `test-engineer` | haiku | haiku | human |
| **review** | `review` / `reviewer` | haiku | haiku | human |
| **ship** | human | — | — | human |

Override with `AGENT_ORCHESTRATOR_MODEL`, `AGENT_DISCUSS_MODEL`,
`AGENT_PLAN_MODEL`, `AGENT_EXECUTE_MODEL`, `AGENT_TEST_MODEL`,
`AGENT_REVIEW_MODEL` (`provider:model`).

## The loop

```
[discuss] ── discuss.md ──► [plan] ── plan.md ──► [execute] ── execute.md ──► [test]
   HITL                       HITL                    HITL                      HITL
                                                                                 │
[ship] ◄── you commit ── [review] ◄── review.md ────────────────────────────────┘
  human                     HITL
```

| Phase | Receives | Produces | You do |
| --- | --- | --- | --- |
| **discuss** | request, optional ticket, index, live schema | gaps, field map, questions | approve or answer gaps |
| **plan** | approved discuss | spec, Mermaid, execute checklist | approve the plan |
| **execute** | approved plan | code + execute notes | accept the change |
| **test** | discuss + plan + execute | cases, quiz, gaps | accept coverage |
| **review** | plan + execute + test | findings, ship-ready? | accept or send back |
| **ship** | accepted review | commit / PR | you ship |

There is no `/start` command. The artifact file **is** the interface.

The chat GUI is still `POST /chat`. The orchestrator returns JSON
(`text` / `api_spec` / `sql` / `diagram` / `code`) and waits. It does not
write the product repo. Claude Code writes `docs/sa/<phase>.md` in the
product repo.

## Context management

The index is the existing RAG (`search_api_specs`, `search_schema_docs` →
Chroma). Do not add another store.

1. Orchestrator retrieves a short brief → `/artifacts/context.md`
   (Claude Code: a few lines in the task, or `docs/sa/context.md`).
2. Specialist reads that brief plus the previous phase file.
3. Specialist writes its artifact. Raw tool dumps stay in that thread and
   die with it.
4. Next phase reads the file, not the conversation.

Live schema (`describe_tables`, `inspect_relationships`, `run_sql`) stays
inside the specialist. The router may only `list_tables` and search.

Jira is Discuss only, and only when a ticket or story is named.

## Two runtimes, one tool core

```
                    ┌─────────────────────────────────────┐
                    │  agents/tools/core                  │
                    │  postgres.ts  knowledge.ts          │
                    └──────────────┬──────────┬───────────┘
                                   │          │
              LangChain wrappers   │          │  MCP stdio
                                   ▼          ▼
                    ┌──────────────────┐  ┌──────────────────────────┐
                    │ Deep Agent       │  │ Claude Code              │
                    │ sa-agent.ts      │  │ plugin: agents/claude    │
                    │ harness.ts       │  │ same six phases          │
                    │ POST /chat       │  │ product-repo artifacts   │
                    └──────────────────┘  └──────────────────────────┘
```

## Deep Agent (GUI / `/chat`)

[`harness.ts`](../harness.ts) + [`sa-agent.ts`](../sa-agent.ts):

1. **Orchestrator model** — haiku. Tools: index + `list_tables` only.
2. **Skills** — none on the router. Each specialist loads its own.
3. **`task`** — Deep Agents delegation. One specialist per gate.
4. **Scratch files** — `/artifacts/*.md` on the per-thread StateBackend.
5. **Memory** — `/resources/AGENTS.md` every turn.
6. **JSON contract** — [`prompt.ts`](../prompt.ts) so the GUI still parses.

## Claude Code (product repo)

Plugin under [`claude/`](../claude/):

| Piece | Role |
| --- | --- |
| `.mcp.json` | sa-knowledge + jira |
| `agents/*.md` | discuss / plan / execute / test / review |
| `memory/AGENTS.md` | loop + grounding at SessionStart |
| `skills/*/SKILL.md` | how each specialist works |

You pick `/agents` for the phase. Write `docs/sa/<phase>.md`. Approve.
Then the next specialist.

## Grounding order (every specialist)

1. Live database.
2. Indexed knowledge (may be stale).
3. Jira only in discuss, only when named.

Never invent a table, column, or endpoint.

## Milestones (you implement)

The core above is **M0**. Do these in order. Each one is a small, testable
change. Do not skip ahead to ship automation.

### M1 — Discuss + Align

In a product repo: name a ticket, run `system-analyst`, get
`docs/sa/discuss.md` with real columns and a gap list. Approve or answer.
Confirm Jira is not called from plan/execute.

### M2 — Plan

From the approved discuss file, run `solution-architect`. Require a
Mermaid flow and a numbered execute checklist in `docs/sa/plan.md`.
Reject plans that invent endpoints.

### M3 — Execute on a cheap coder

Set `AGENT_EXECUTE_MODEL=ollama:qwen2.5-coder` (or qwen3) after `ollama pull`.
In Claude Code, point the coder agent at that model if you have it
configured. Coder may only implement the checklist. If a step is missing,
it stops.

### M4 — Test / Validate

`test-engineer` reads discuss + plan + execute, writes `docs/sa/test.md`,
and adds tests in the product runner. Include a short quiz: each spec
rule either has a test or is listed as a gap.

### M5 — Review

`reviewer` writes `docs/sa/review.md`. You decide ship-ready. Send back to
execute or test; do not let review commit.

### M6 — Ship (human)

You commit and open the PR. Do not add an agent for this.

### M7 — Hard HITL (optional)

Wire Deep Agents `interruptOn` on `task` and an Approve button on
`POST /chat`. Until then, the prompt gate (stop and wait) is the core.

## Adding capabilities

Keep both surfaces in sync:

| Change | LangChain path | Claude Code path |
| --- | --- | --- |
| New schema/knowledge tool | `tools/core` + wrappers + `TOOL_REGISTRY` | `mcp/server.ts` |
| New Jira tool | `tools/jira.ts` + registry | `resources/mcp/mcp-server.ts` |
| New skill | `resources/skills/<name>/SKILL.md` | `claude/skills/<name>/SKILL.md` |
| Memory / loop | `resources/AGENTS.md` | `claude/memory/AGENTS.md` |
| Phase / model | `harness.ts` + `config.ts` | `claude/agents/<name>.md` |

Copy-paste starters: [`templates/`](../templates/).
