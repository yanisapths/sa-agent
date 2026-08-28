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
  sa-agent.ts           the system analyst / solution architect agent
  prompt.ts             role and output contract
  index.ts              public exports
  resources/            what the harness mounts read-only at /resources
    AGENTS.md           memory: always loaded into the system prompt
    mcp/                Jira MCP client + stdio server (ticket / user story)
    skills/             progressive-disclosure skills, loaded on demand
      backend/          API and endpoint design
      system-analyst/   requirements, data models, SQL
      solution-architect/ architecture and diagrams
      jira/             explicit Jira MCP — tickets and user stories only
  tools/
    index.ts            TOOL_REGISTRY, TOOL_DEFINITIONS, resolveTools()
    postgres.ts         live schema introspection + read-only SQL
    knowledge.ts        Chroma retrieval over Confluence and DDL docs
    jira.ts             explicit Jira MCP wrappers (ticket + user story)
  ingest/               one-off pipelines that populate the vector store
    confluence.ts       Confluence API spec pages
    ddl.ts              a .sql DDL dump
    url.ts              an arbitrary page or text document
    parsers/            page and DDL parsers
  templates/            copy-paste starting points for new agents and skills

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
`CHROMA_*` values. `DATABASE_URL` should point at a role with read access only.

Jira MCP is optional. The agent calls it **only** when the user explicitly asks
for a ticket or user story (`get ticket PROJ-123`, `read user story PROJ-456`).
Configure one of:

- Remote MCP: `JIRA_MCP_URL`, optional `JIRA_MCP_TOKEN`, optional
  `JIRA_MCP_TRANSPORT=sse`.
- External stdio server: `JIRA_MCP_COMMAND` and optional `JIRA_MCP_ARGS`.
- Local stdio server (this repo): `JIRA_URL` plus either
  `JIRA_PERSONAL_TOKEN` (Server/DC) or `JIRA_USERNAME` + `JIRA_API_TOKEN`
  (Cloud). Set `JIRA_SSL_VERIFY=false` for a self-signed cert.

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

Defaults grant every registered tool, every skill, shared memory, and per-thread
session state. The filesystem, planning (`write_todos`), and subagent delegation
(`task`) come from the harness itself.

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
```

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
