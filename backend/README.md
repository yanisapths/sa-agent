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
      jira/             explicit Jira MCP — tickets and user stories only
    claude/             Claude Code plugin (skills, subagents, MCP config)
  tools/
    index.ts            TOOL_REGISTRY, TOOL_DEFINITIONS, resolveTools()
    core/               shared implementations used by LangChain and MCP
    postgres.ts         LangChain wrappers for live schema tools
    knowledge.ts        LangChain wrappers for Chroma retrieval
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

| Layer         | Source                                    | Freshness            |
| ------------- | ----------------------------------------- | -------------------- |
| Live schema   | `list_tables`, `describe_tables`, `inspect_relationships`, `run_sql` | Real time |
| Knowledge     | `search_api_specs`, `search_schema_docs`  | Last ingestion run   |
| Jira MCP      | `get_jira_ticket`, `read_jira_user_story` | Only on explicit ask |
| Skills        | `resources/skills/*/SKILL.md`             | On demand            |
| Memory        | `resources/AGENTS.md`                     | Every turn           |
| Session       | Per-`threadId` checkpointer               | Lifetime of process  |

All database access runs inside a read-only transaction with a statement
timeout, and `run_sql` rejects anything that is not a `SELECT` or `WITH`.

## Setup

```bash
bun install
cp .env.example .env
```

Required to run the agent: `ANTHROPIC_API_KEY`, `DATABASE_URL`, and the
`CHROMA_*` values. Execute defaults to `ollama:qwen2.5-coder` — pull that
model or set `AGENT_EXECUTE_MODEL`. The router and other phases default
to haiku (`AGENT_ORCHESTRATOR_MODEL`, `AGENT_DISCUSS_MODEL`, …). `DATABASE_URL` must be a full connection URI
(`postgresql://user:password@host:5432/database`) and should point at a role
with read access only — a bare hostname is rejected at startup of the first
query rather than failing later as a DNS error.

A dependency the agent cannot reach is reported back to the model as tool
output instead of failing the request, so `/chat` still answers from whatever
sources are available.

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

Define it in `agents/tools/`, then register it in `TOOL_REGISTRY`. The name
becomes available to every `defineAgent` spec and is type-checked.

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

## Claude Code plugin

The same tools, skills, and memory are packaged as a Claude Code plugin so a
separate product repo can use Claude Code as the agent runtime. sa-agent stays
the knowledge and tool provider.

```bash
export SA_AGENT_HOME=/path/to/sa-agent   # add to ~/.zshrc
cd /path/to/product-repo
claude plugin marketplace add /path/to/sa-agent
```

Then in a Claude Code session: `/plugin install sa-agent@sa-agent`.

MCP servers are spawned from `$SA_AGENT_HOME` and load `backend/.env` by
absolute path. Confirm they loaded with `/mcp`. Details:
`agents/claude/README.md`.

Claude Code does not invoke the LangChain agent, so those sessions are not
`/chat` traces. Each MCP tool call is still recorded in LangSmith as a tool
run (tags `mcp`, `claude-code`) when `LANGSMITH_TRACING=true`.

## Ingestion

```bash
bun run ingest:confluence           # index Confluence API spec pages
bun run ingest:ddl path/schema.sql  # index a DDL dump
bun run ingest:url https://...      # index a page or text document
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
