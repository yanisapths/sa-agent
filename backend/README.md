# sa-agent backend

A Deep Agent harness for system analysis and solution architecture, plus the
vault storage API.

The agent answers questions about APIs, data models, SQL, and architecture. It
grounds every answer in the **live PostgreSQL schema** rather than a stale
documentation snapshot, so relationships and column types are always current.

## Layout

```
agents/
  builder.ts            defineAgent() — assembles a Deep Agent from a resource spec
  harness.ts            phase loop, cheap models, specialist specs
  sa-agent.ts           cheap orchestrator; delegates via task()
  prompt.ts             orchestrator contract (JSON for the GUI)
  index.ts              public exports
  resources/            what the harness mounts read-only at /resources
    AGENTS.md           memory: always loaded into the system prompt
    mcp/                Jira MCP client + stdio server (ticket / user story)
    skills/             progressive-disclosure skills, loaded on demand
      backend/          API and endpoint design
      system-analyst/   requirements, data models, SQL
      solution-architect/ architecture and diagrams
      test-engineer/    test plans and fixtures
      system-model/     the code graph, impact analysis, decision records
      jira/             explicit Jira MCP — tickets and user stories only
    claude/             plugin bundle for Claude Code and Codex (skills, subagents, MCP config)
  model/                the system model — a typed graph of the product repo
    types.ts            node and edge taxonomy; edges point dependent -> dependency
    scan.ts             deterministic repo scan (files, imports, routes, SQL)
    schema.ts           live Postgres tables, columns, and foreign keys
    build.ts            scan + schema + reconcile; also the `model:build` CLI
    store.ts            bun:sqlite storage and the reverse-reachability query
    impact.ts           change simulation and the risk rubric
    decisions.ts        engineering decisions as markdown, indexed into the graph
  tools/
    index.ts            TOOL_REGISTRY, TOOL_DEFINITIONS, resolveTools()
    core/               shared implementations used by LangChain and MCP
    postgres.ts         LangChain wrappers for live schema tools
    knowledge.ts        LangChain wrappers for Chroma retrieval
    system-model.ts     LangChain wrappers for the graph and decision tools
    jira.ts             explicit Jira MCP wrappers (ticket + user story)
  ingest/               one-off pipelines that populate the vector store
    confluence.ts       Confluence API spec pages
    ddl.ts              a .sql DDL dump
    url.ts              an arbitrary page or text document
    parsers/            page and DDL parsers
  templates/            copy-paste starting points for new agents and skills

mcp/
  server.ts             sa-knowledge stdio MCP (Postgres + Chroma)

database/
  postgres.ts           read-only pooled client
  chroma.ts             vector store collections
  supabase.ts           vault storage and metadata

routes/                 chat and vault HTTP handlers
internal/               artifact normalisation, errors, vault service
```

## How the agent is grounded

| Layer       | Source                                                               | Freshness            |
| ----------- | -------------------------------------------------------------------- | -------------------- |
| Live schema | `list_tables`, `describe_tables`, `inspect_relationships`, `run_sql` | Real time            |
| System model | `query_system_model`, `simulate_impact`, `search_decisions`         | Last `build_system_model` |
| Knowledge   | `search_api_specs`, `search_schema_docs`                             | Last ingestion run   |
| Jira MCP    | `get_jira_ticket`, `read_jira_user_story`                            | Only on explicit ask |
| Skills      | `resources/skills/*/SKILL.md`                                        | On demand            |
| Memory      | `resources/AGENTS.md`                                                | Every turn           |
| Session     | Per-`threadId` checkpointer                                          | Lifetime of process  |

All database access runs inside a read-only transaction with a statement
timeout, and `run_sql` rejects anything that is not a `SELECT` or `WITH`.

## System model

The live schema says what exists. The system model says **what connects to
what**, and the decision records say **why it is like that**.

```bash
bun run model:build              # the repo containing cwd
bun run model:build /path/repo   # an explicit product repo
```

It writes `.sa/system-model.db` and reads `.sa/decisions/*.md` in the product
repo. The graph is rebuildable, so `.gitignore` the `.db`; the decisions are
not, so commit them.

The build has three steps:

1. **Scan** — walk the repo for files, imports, route declarations (resolved
   through `app.use` mount prefixes), SQL and ORM table access, tests, and
   docs. Pattern matching, no compiler and no model, so the same repo always
   produces the same graph.
2. **Schema** — read tables, columns, and foreign keys from live Postgres.
3. **Reconcile** — a table named in code but absent from the live schema is
   *reported*, never added. That is how "never invent a table" is enforced
   rather than requested. With no database reachable the build still succeeds
   and marks every table unverified.

Edges always point **from the dependent to the dependency**, which makes
"what breaks if I change this" a single recursive query walking them backwards.

| Tool | Use |
| --- | --- |
| `build_system_model` | rebuild the graph; free and deterministic |
| `query_system_model` | a component's dependencies, dependents, and decisions; `*` for an overview |
| `simulate_impact` | blast radius by layer, plus a risk level with its arithmetic |
| `record_decision` | write the reasoning a diff cannot carry |
| `search_decisions` | why is this built this way |

### What it does not see

Routes registered through a factory, table names assembled at runtime,
dependency injection by string token, and anything crossing a message queue.
A quiet impact report is weak evidence, not proof.

## Setup

```bash
bun install
cp .env.example .env
```

Required to run the agent: a model provider (below), `DATABASE_URL`, and the
`CHROMA_*` values. `DATABASE_URL` must be a full connection URI
(`postgresql://user:password@host:5432/database`) and should point at a role
with read access only — a bare hostname is rejected at startup of the first
query rather than failing later as a DNS error.

A dependency the agent cannot reach is reported back to the model as tool
output instead of failing the request, so `/chat` still answers from whatever
sources are available.

## Models

A model id says how to reach it. A **slash** is a Bifrost id and goes through
the company gateway; a **colon** goes straight to that provider. So one phase
can stay on a local coder while the rest go through Bifrost:

```
AGENT_EXECUTE_MODEL=ollama:qwen2.5-coder   # local, never touches the gateway
AGENT_PLAN_MODEL=dashscope/qwen3.7-max     # gateway
```

Set `BIFROST_BASE_URL` and `BIFROST_API_KEY` and every phase that has no
explicit override moves to `BIFROST_MODEL`. Leave them unset and the defaults
stay on `anthropic:claude-haiku-4-5`, which needs `ANTHROPIC_API_KEY`.

| Key                   | What                                                           |
| --------------------- | -------------------------------------------------------------- |
| `BIFROST_BASE_URL`    | gateway origin; the agent POSTs to `$BASE/v1/chat/completions` |
| `BIFROST_API_KEY`     | your virtual key                                               |
| `BIFROST_AUTH_HEADER` | header the key travels in — `x-bf-vk`                          |
| `BIFROST_MODEL`       | default `provider/model` for every phase                       |
| `BIFROST_USER_AGENT`  | anything that is not a stock SDK agent                         |
| `BIFROST_MAX_TOKENS`  | `4096` — reasoning models need the headroom                    |

The bare names from the gateway handout (`AUTH_HEADER`, `MODEL`, `MAX_TOKENS`,
`USER_AGENT`) are accepted as fallbacks.

Verify the whole path — headers, model id, and native tool calling — before
trusting the agent with it:

```bash
bun run check:bifrost              # env, then a real chat and a real tool call
bun run check:bifrost -- --models  # model ids this key can actually reach
```

### What bites, all handled in `agents/model.ts`

- **Model needs a provider prefix.** Bare `qwen3.7-flash` fails with _"could
  not auto resolve a provider"_. This gateway routes `dashscope`,
  `huawei_claude`, `dashscope_claude`, `huawei`, `vertex` — not `anthropic` or
  `openai`.
- **User-Agent.** Cloudflare fronts the gateway and blocks stock SDK agents
  with `403 error code 1010`. It reads like a network outage and is one header.
  It has to be set on the outgoing request: LangChain overwrites the client's
  `defaultHeaders` User-Agent with its own.
- `max_tokens` **and reasoning models.** Reasoning tokens come out of the same
  budget, so a small limit can be spent entirely on thinking and return empty
  content with `finish_reason: "length"` — a turn that silently does nothing.
  A truncated reply warns on stderr.
- **Cloudflare bot challenge.** A burst of requests gets a `403 "Just a moment..."` HTML page instead of the API; it is retried with backoff.

Embeddings do **not** go through the gateway. They stay on local Ollama because
the width has to match the existing Chroma collections; switching would mean
re-ingesting.

Jira MCP is optional. The agent calls it **only** when the user explicitly asks
for a ticket or user story (`get ticket PROJ-123`, `read user story PROJ-456`).
Configure one of:

- Remote MCP: set `JIRA_MCP_URL` only when you have a token (`JIRA_MCP_TOKEN`).
  Do not leave this pointed at `https://mcp.atlassian.com/...` without OAuth —
  that looks “configured” and then fails to load tools.
- External stdio server: `JIRA_MCP_COMMAND` and optional `JIRA_MCP_ARGS`.
- Local stdio server (this repo): `JIRA_URL` plus either
  `JIRA_PERSONAL_TOKEN` (Server/DC) or `JIRA_USERNAME` + `JIRA_API_TOKEN`
  (Cloud). If those are unset, Cloud Jira reuses `CONFLUENCE_BASE_URL` +
  `CONFLUENCE_USERNAME` / `CONFLUENCE_ACCESS_TOKEN`. Set
  `JIRA_SSL_VERIFY=false` for a self-signed cert.

```bash
bun run dev
```

## Adding an agent

Copy `agents/templates/agent.template.ts`, declare the resources it needs, and
export it from `agents/index.ts`:

```ts
export const reviewAgent = defineAgent({
  name: "review-agent",
  systemPrompt: "...",
  tools: ["describe_tables", "inspect_relationships"],
});
```

Phase specialists belong in `harness.ts`, not a second top-level agent.
Defaults grant every registered tool, every skill, shared memory, and per-thread
session state. The filesystem, planning (`write_todos`), and subagent delegation
(`task`) come from Deep Agents.

## Adding a tool

Define the implementation in `agents/tools/core/`, wrap it for LangChain in
`agents/tools/`, register it in `TOOL_REGISTRY`, and add it to `mcp/server.ts`
so both runtimes get it. The name is then type-checked in every `defineAgent`
spec and in `harness.ts`.

## Adding a skill

Copy `agents/templates/SKILL.template.md` to
`agents/resources/skills/<name>/SKILL.md`. The agent reads only the frontmatter
at startup and loads the body when a task matches the description, so write the
description as a trigger.

## Jira MCP

`get_jira_ticket` and `read_jira_user_story` talk to Jira through MCP. They are
registered on the agent but must only be called when the user explicitly asks
for a ticket or user story. The `jira` skill is the trigger for that path.

The local stdio server lives at `agents/resources/mcp/mcp-server.ts`:

```bash
bun run mcp:jira
bun run mcp:knowledge
```

## Plugin runtimes (Claude Code, Codex)

The same tools, skills, and memory are packaged as a plugin so a separate
product repo can use Claude Code or Codex as the agent runtime. sa-agent stays
the knowledge and tool provider.

```bash
export SA_AGENT_HOME=/path/to/sa-agent   # add to ~/.zshrc
cd /path/to/product-repo

claude plugin marketplace add "$SA_AGENT_HOME"   # then /plugin install sa-agent@sa-agent

codex plugin marketplace add "$SA_AGENT_HOME"    # then:
codex plugin add sa-agent --marketplace sa-agent
```

MCP servers are spawned from `$SA_AGENT_HOME` and load `backend/.env` by
absolute path. Codex strips the environment of spawned servers and does not
expand `${SA_AGENT_HOME}` in their arguments, so it goes through
`mcp/sa-mcp`, which falls back to `~/.sa-agent/home`. Confirm with `/mcp`.
Details: `agents/claude/README.md`.

Neither runtime invokes the LangChain agent, so those sessions are not `/chat`
traces. Each MCP tool call is still recorded in LangSmith as a tool run (tags
`mcp` plus `claude-code` or `codex`) when `LANGSMITH_TRACING=true`.

## Ingestion

```bash
bun run ingest:confluence           # index Confluence API spec pages
bun run ingest:ddl path/schema.sql  # index a DDL dump
bun run ingest:url https://...      # index a page or text document
```

## System model build

```bash
bun run model:build                 # graph the repo containing cwd
```

## Endpoints

### Health

- `GET /health`

### Chat

- `POST /chat` — multipart or JSON: `message`, optional `files[]`, optional
  `threadId`.

Pass the `threadId` returned by the previous response to continue a session.
Responses are `{ ok, threadId, type, data }` where `type` is one of `text`,
`api_spec`, `sql`, `diagram`, or `code`.

### Vault (`Authorization: Bearer <token>`)

- `GET /v1/vault/folders?q=`
- `POST /v1/vault/folders` — `{ "name": "Requirements", "description": "" }`
- `DELETE /v1/vault/folders/:folderId`
- `POST /v1/vault/files` — multipart: `folderId`, `file`, optional `description`
- `DELETE /v1/vault/files/:fileId`
- `GET /v1/vault/mentions?q=&limit=8`

Local auth uses `VAULT_DEV_TOKEN`; production uses a Supabase access token.
Create the `vault` bucket, then run `sql/vault.sql` in the Supabase SQL editor.
