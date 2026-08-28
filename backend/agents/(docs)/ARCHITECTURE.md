# Architecture: harness and workspace wiring

sa-agent is a **capability provider**, not the product you are analysing. The
LLM runtime either sits in this repo (chat GUI) or in a **product workspace**
(Claude Code). Tools, skills, and memory live here and are mounted or spawned
into that runtime.

The product-repo path is a six-phase loop. Each phase is a contract: it
**receives** declared inputs only (live schema, indexed knowledge, and the
previous artifact — never an unspoken conversation), **produces** one artifact
in the product repo, and **exits** through a gate. Distillation quality at
phase N is what makes phase N+1 possible.

## The loop — how phases interact

```
[assemble] ── grounding ──────────► [discuss] ── spec ──────────────► [plan]
                                    gate: HUMAN                       gate: HUMAN
                                    spec approved                     skippable

[plan] ── architecture ───────────► [execute] ── code ──────────────► [verify]
                                                                      gate: HUMAN
                                                                      tests accepted

[verify] ── coverage ─────────────► [ship] ── commit / PR ──────────► (shipped)
```

Subagents own the middle four phases. **assemble** is mechanical (session +
MCP). **ship** is the human closing the change in git.

| Phase | Owner | Receives | Produces | Gate | Boundary effect |
| --- | --- | --- | --- | --- | --- |
| **assemble** | SessionStart + MCP | user request; optional ticket id | live schema snapshot (`list_tables` / `describe_tables` / `inspect_relationships`), knowledge hits, optional Jira issue | none (mechanical) | memory (`AGENTS.md`) loaded; **sa-knowledge** and **jira** connected; product cwd is the workspace |
| **discuss** | `system-analyst` | assemble output + request | **spec** — scope, entities, field mapping to real columns, ER, verified SQL | HUMAN: approve spec before anyone writes application source | spec files in the product repo; coder is blocked until this gate |
| **plan** | `solution-architect` | approved spec | **architecture** — component boundaries, integration, Mermaid diagrams, decision records | HUMAN; skippable when the change is a single endpoint and the spec already names the contract | architecture notes in the product repo; execute may start |
| **execute** | `coder` + `backend` skill | spec + architecture | **implementation** — application source against product conventions | none (mechanical once inputs are approved) | code in the product repo; must not invent tables, columns, or endpoints |
| **verify** | `test-engineer` | spec + implementation | **coverage** — test plan, fixtures from live columns, tests in the repo’s runner | HUMAN: accept verification | tests and verification notes in the product repo |
| **ship** | human | verification accepted | **commit / PR** in the product repo | HUMAN | change leaves the agent loop |

Gates are session approvals in Claude Code (the analyst and coder prompts
already refuse to implement until the spec is approved). There is no `/start`
or `/approve` command in this repo; the artifact in the product tree **is**
the interface between phases.

The chat GUI does **not** run this loop. It is a single `POST /chat` turn on
the Deep Agent that returns a JSON artifact (`text` / `api_spec` / `sql` /
`diagram` / `code`) and never writes the product repo.

## Two runtimes, one tool core

```
                    ┌─────────────────────────────────────┐
                    │  agents/tools/core                  │
                    │  postgres.ts  knowledge.ts          │
                    │  (read-only SQL, Chroma search)     │
                    └──────────────┬──────────┬───────────┘
                                   │          │
              LangChain wrappers   │          │  MCP stdio
              tools/postgres.ts    │          │  mcp/server.ts
              tools/knowledge.ts   │          │  resources/mcp/mcp-server.ts
              tools/jira.ts        │          │
                                   ▼          ▼
                    ┌──────────────────┐  ┌──────────────────────────┐
                    │ Deep Agent       │  │ Claude Code              │
                    │ defineAgent()    │  │ plugin: agents/claude    │
                    │ POST /chat       │  │ product-repo workspace   │
                    │ frontend GUI     │  │ six-phase loop above     │
                    └──────────────────┘  └──────────────────────────┘
```

`run_sql` is SELECT/WITH only, inside a read-only transaction with a statement
timeout. Unreachable dependencies are returned as tool text so the model can
still answer from whatever is up.

Claude Code never invokes the LangChain graph. MCP calls are wrapped in
[`mcp/trace.ts`](../../mcp/trace.ts) so LangSmith still records them as tool
runs tagged `mcp` and `claude-code`.

## Product workspace vs this checkout

| Path | Role |
| --- | --- |
| `SA_AGENT_HOME` (this repo) | Env, MCP servers, plugin source, ingestion, optional GUI |
| Product repo (cwd of Claude Code) | Spec, architecture, code, tests the loop writes |
| `backend/.env` | Loaded by MCP via absolute path ([`load-env.ts`](../../load-env.ts)), not via the product repo cwd |

Claude Code must be launched with `SA_AGENT_HOME` set. The plugin’s
[`.mcp.json`](../claude/.mcp.json) starts:

- `bun $SA_AGENT_HOME/backend/mcp/server.ts` → **sa-knowledge**
- `bun $SA_AGENT_HOME/backend/agents/resources/mcp/mcp-server.ts` → **jira**

Marketplace entry: [`.claude-plugin/marketplace.json`](../../../.claude-plugin/marketplace.json)
→ plugin root `backend/agents/claude`.

## Deep Agent harness (GUI / `/chat`)

[`builder.ts`](../builder.ts) `defineAgent()` is the single assembly point:

1. **Model** — `AGENT_CHAT_MODEL` (default `anthropic:claude-sonnet-4-5`).
2. **Tools** — names from [`tools/index.ts`](../tools/index.ts) `TOOL_REGISTRY`.
   Default: all of them.
3. **Backend** — `CompositeBackend`:
   - `/resources/` → read-only `FilesystemBackend` of `agents/resources`
     (skills + `AGENTS.md`). Writes under `/resources/**` are denied.
   - Everything else → per-thread `StateBackend` scratch files.
4. **Skills** — progressive disclosure from `/resources/skills/` (frontmatter
   always, body when the description matches).
5. **Memory** — `/resources/AGENTS.md` injected every turn.
6. **Session** — LangGraph `MemorySaver` keyed by `thread_id` (the `threadId`
   from `POST /chat`).
7. **Harness tools** (from `deepagents`, not our registry) — filesystem,
   `write_todos`, `task` (subagents).

[`sa-agent.ts`](../sa-agent.ts) is the default spec: name `sa-agent`, prompt
from [`prompt.ts`](../prompt.ts) (JSON artifact contract for the GUI).
[`routes/chat.ts`](../../routes/chat.ts) invokes it and normalises
`text` / `api_spec` / `sql` / `diagram` / `code`.

```
Browser  →  frontend (Next)  →  POST /chat
                                    │
                                    ▼
                              saAgent.invoke({ thread_id })
                                    │
                    ┌───────────────┼────────────────┐
                    ▼               ▼                ▼
              TOOL_REGISTRY   /resources skills   checkpointer
              Postgres/Chroma AGENTS.md           threadId
              Jira MCP
```

## Claude Code plugin (product repo)

Plugin layout under [`claude/`](../claude/):

| Piece | What it does |
| --- | --- |
| `.mcp.json` | Spawns sa-knowledge + jira from `$SA_AGENT_HOME` (**assemble**) |
| `skills/*/SKILL.md` | Procedures for discuss / plan / execute / verify |
| `agents/*.md` | Subagents: system-analyst, solution-architect, coder, test-engineer |
| `memory/AGENTS.md` | Grounding rules loaded at SessionStart |
| `hooks/hooks.json` | `SessionStart` prints memory into the session |

```
You, in product-repo
        │
        ▼
Claude Code + plugin sa-agent@sa-agent
        │
        ├── assemble: SessionStart memory + MCP
        ├── discuss / plan / execute / verify: subagents + skills
        └── ship: you commit
```

The **coder** subagent implements against that repo’s conventions (`CLAUDE.md`,
layout, tests). Schema still comes from MCP.

## Grounding order

Shared in [`resources/AGENTS.md`](../resources/AGENTS.md) and plugin memory.
Every phase after assemble is only allowed to use these sources:

1. Live database (authoritative structure).
2. Indexed knowledge (intent and conventions; may be stale).
3. Jira only when the user names a ticket or user story.

Never invent a table, column, or endpoint.

## Adding capabilities

Keep both surfaces in sync when you change behaviour:

| Change | LangChain path | Claude Code path |
| --- | --- | --- |
| New schema/knowledge tool | `tools/core` + wrappers + `TOOL_REGISTRY` | `mcp/server.ts` |
| New Jira tool | `tools/jira.ts` + registry | `resources/mcp/mcp-server.ts` |
| New skill | `resources/skills/<name>/SKILL.md` | `claude/skills/<name>/SKILL.md` |
| Memory / conventions | `resources/AGENTS.md` | `claude/memory/AGENTS.md` |
| New subagent | `defineAgent({ subagents })` | `claude/agents/<name>.md` |

Copy-paste starters: [`templates/`](../templates/).
