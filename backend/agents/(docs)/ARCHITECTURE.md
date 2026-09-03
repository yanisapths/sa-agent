# Architecture: harness loop

sa-agent is a **capability provider**, not the product you are analysing. The
LLM runtime either sits in this repo (chat GUI) or in a **product workspace**
(Claude Code or Codex, via the plugin). Tools, skills, and memory live here.

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

The PVT prep track below has its own three: `AGENT_PVT_DISCUSS_MODEL`,
`AGENT_PVT_PLAN_MODEL`, `AGENT_PVT_EXECUTE_MODEL`.

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

## The PVT prep track

Preparing a Production Verification Test is a **second track**, not more phases
on the first. It ends in SQL scripts another team runs against production, so
it never reaches execute-the-code or review-the-diff. `PVT_PHASES` /
`PVT_PHASE` in [`harness.ts`](../harness.ts).

```
[pvt-discuss] ── pvt-discuss.md ──► [pvt-plan] ── pvt-plan.md ──► [pvt-execute]
     HITL                              HITL                            HITL
```

| Phase | Specialist (LangChain / Claude Code) | Receives | Produces |
| --- | --- | --- | --- |
| **pvt-discuss** | `pvt-discuss` / `pvt-analyst` | requirements + a case list (CSV, table, or a named story) + live schema | case inventory, tables touched, unrunnable cases, questions |
| **pvt-plan** | `pvt-plan` / `pvt-planner` | approved pvt-discuss | scenario groups, script set, pre-window vs in-window split, impact |
| **pvt-execute** | `pvt-execute` / `pvt-scripter` | approved pvt-plan | the numbered SQL scripts, run order, owners |

Two constraints shape the whole track:

1. **The window is the scarce resource.** Data that could have been staged
   before it must not be created inside it — that is what pvt-plan's
   pre-window / in-window split is for.
2. **Every SRE round trip costs the window.** Grouping cases into the fewest
   shared setups is the point of the planning phase, not a nicety.

Scripts are `NN-<action>[-pvt-NN]_<owner>.sql`, owner `devops` or `sre`,
numbers unique and ascending in run order, `_(optional)` on the rollbacks:

```
01-setup-db_devops.sql   02-seed-db_sre.sql        03-patch-data_sre.sql
04-patch-data-pvt-01_sre.sql   05-patch-data-pvt-02_sre.sql
06-clear-data-pvt_sre.sql
08-rollback_devops_(optional).sql   09-rollback_sre_(optional).sql
```

No phase in this track writes to a database. `run_sql` stays read-only and
proves the verification queries; the scripts are artifacts, and a human runs
them. The convention lives in `skills/pvt-prep/SKILL.md`.

The chat GUI is still `POST /chat`. The orchestrator returns JSON
(`text` / `api_spec` / `sql` / `diagram` / `code`) and waits. It does not
write the product repo. Claude Code writes `docs/sa/<phase>.md` in the
product repo.

## The system model

A third grounding source, next to the live schema and the index. The schema
knows what exists; the index knows what someone wrote down; the system model
knows **what connects to what**, and the decision records know **why**.

```
Endpoint ──handled_by──► Service ──imports──► Repository ──queries──► Table ──has_column──► Column
   ▲                                                                    ▲
   └──calls── Component (frontend)                    Decision ──decides──┘
```

Every edge points **dependent → dependency**. Impact analysis is therefore one
reverse-reachability query, with no per-edge special cases:

```
simulate_impact("orders.user_id")
  → column ← table ← repository ← service ← endpoint ← frontend component
                                        ↑
                                     tests, docs, decisions
```

It lives in [`model/`](../model) and stores to `.sa/system-model.db` in the
**product** repo, next to `.sa/decisions/*.md`. The graph is derived, so it is
gitignored; the decisions are not, so they are committed and reviewed.

The scan is pattern matching, not a compiler — deterministic, free, polyglot,
and re-runnable on every commit. The trade is recall: a route registered
through a factory is invisible. Two rules keep it honest:

1. A table found in SQL but absent from the live schema is **reported**, never
   added as a node. "Never invent a table" becomes an invariant of the build.
2. Nothing in the graph is inferred by a model, so two builds of the same
   commit are byte-identical.

| Phase | Uses it for |
| --- | --- |
| discuss | `build_system_model`, then find the real components and any decision that constrains them |
| plan | `simulate_impact` on everything the change touches; the plan carries an **Impact and risk** section |
| execute | stay inside the declared blast radius; rebuild after; `record_decision` when the human gives a reason |
| test | affected files with no test are the coverage gap list |
| review | a change that reverses a recorded decision without arguing against it is critical |

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
                    ┌──────────────────────────────────────────┐
                    │  agents/tools/core                       │
                    │  postgres.ts knowledge.ts system-model.ts│
                    └──────────────┬──────────┬────────────────┘
                                   │          │
              LangChain wrappers   │          │  MCP stdio
                                   ▼          ▼
                    ┌──────────────────┐  ┌──────────────────────────┐
                    │ Deep Agent       │  │ Claude Code / Codex      │
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

## Plugin runtimes (product repo)

Plugin under [`claude/`](../claude/), installed from a marketplace manifest at
the repo root: `.claude-plugin/marketplace.json` for Claude Code,
`.agents/plugins/marketplace.json` for Codex.

| Piece | Role | Runtime |
| --- | --- | --- |
| `.claude-plugin/plugin.json` | plugin identity | Claude Code |
| `.codex-plugin/plugin.json` | plugin identity + install metadata | Codex |
| `.mcp.json` | sa-knowledge + jira, spawned at `${SA_AGENT_HOME}` | Claude Code |
| `.mcp.codex.json` | same servers via [`mcp/sa-mcp`](../../mcp/sa-mcp) | Codex |
| `agents/*.md` | discuss / plan / execute / test / review, plus the three `pvt-*` | Claude Code |
| `memory/AGENTS.md` | loop + grounding at SessionStart | both |
| `skills/*/SKILL.md` | how each specialist works | both |

In Claude Code you pick `/agents` for the phase. In Codex there are no plugin
subagents, so you invoke the skill (`$system-analyst`) and drive execute and
review yourself. Either way: write `docs/sa/<phase>.md`, approve, then the next
specialist.

Codex passes plugin MCP arguments verbatim and gives those servers a core
environment only, which is why it cannot use `${SA_AGENT_HOME}` in `.mcp.json`.
`mcp/sa-mcp` resolves the checkout (`$SA_AGENT_HOME`, then
`~/.sa-agent/home`, then its own location) and locates `bun`.

## Grounding order (every specialist)

1. Live database.
2. System model (as current as the last `build_system_model`).
3. Indexed knowledge (may be stale).
4. Jira only in discuss, only when named.

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

### M7 — System model in the loop

`bun run model:build` in a product repo. Confirm the endpoint paths match the
routes you actually serve, and that the "referenced in code but absent from the
live schema" list is empty or explainable. Then require every `plan.md` to
carry an **Impact and risk** section produced by `simulate_impact`, and record
the first decision the next time someone asks "why is it like this".

### M8 — Hard HITL (optional)

Wire Deep Agents `interruptOn` on `task` and an Approve button on
`POST /chat`. Until then, the prompt gate (stop and wait) is the core.

## Adding capabilities

Keep both surfaces in sync:

| Change | LangChain path | Plugin path |
| --- | --- | --- |
| New schema/knowledge/model tool | `tools/core` + wrappers + `TOOL_REGISTRY` + `harness.ts` | `mcp/server.ts` |
| New node or edge kind | `model/types.ts` + the pass in `model/scan.ts` or `model/schema.ts` | same, shared core |
| New Jira tool | `tools/jira.ts` + registry | `resources/mcp/mcp-server.ts` |
| New skill | `resources/skills/<name>/SKILL.md` | `claude/skills/<name>/SKILL.md` |
| Memory / loop | `resources/AGENTS.md` | `claude/memory/AGENTS.md` |
| Phase / model | `harness.ts` + `config.ts` | `claude/agents/<name>.md` (Claude Code) |
| New MCP server | `resources/mcp/mcp-client.ts` | `claude/.mcp.json` **and** `claude/.mcp.codex.json` |

Copy-paste starters: [`templates/`](../templates/).
