# sa-agent

Capability provider for system analysis and solution architecture. It grounds
answers in the **live PostgreSQL schema**, a **system model** of the repo it is
working in, indexed Confluence/DDL knowledge, and (when you ask) Jira tickets.

You can run it in three ways:

| Runtime | What drives the LLM | What you get |
| --- | --- | --- |
| **Claude Code** (CLI or GUI) | Claude Code in your **product repo** | Skills, subagents, and MCP tools; writes files in that workspace |
| **Codex** (CLI or ChatGPT desktop) | Codex in your **product repo** | Skills and MCP tools; writes files in that workspace |
| **Chat GUI** | LangChain Deep Agent behind `POST /chat` | Browser chat + vault; JSON artifacts, no product-repo edits |

Same tools and memory. Different runtimes. See
[`backend/agents/(docs)/ARCHITECTURE.md`](backend/agents/(docs)/ARCHITECTURE.md)
for how they are wired.

## Prerequisites

- [Bun](https://bun.sh) (backend, MCP servers, ingestion)
- Node.js 20+ (frontend GUI)
- [Claude Code](https://code.claude.com/docs/en/quickstart) or
  [Codex](https://developers.openai.com/codex) (plugin path — either is enough)
- A read-only PostgreSQL URI for the application database
- Anthropic API key (chat GUI / LangChain path)
- Optional: Chroma Cloud, Ollama embeddings, Jira, Confluence, LangSmith

## 1. Clone and environment

sa-agent is a **provider checkout**. Keep it somewhere stable; product repos
point at it.

```bash
git clone <this-repo> ~/agents/sa-agent
cd ~/agents/sa-agent/backend
bun install
cp .env.example .env
```

Edit `backend/.env`. Required for schema tools and the chat agent:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Full URI, e.g. `postgresql://user:password@host:5432/database`. Must be a URI, not a hostname. Prefer a read-only role. |
| `DATABASE_SCHEMA` | Schema to introspect (default `public`) |
| `BIFROST_BASE_URL`, `BIFROST_API_KEY` | Company LLM gateway. Routes every phase through it; see `backend/README.md` |
| `ANTHROPIC_API_KEY` | Only when a model id is `anthropic:…` — unused with the gateway |
| `CHROMA_HOST`, `CHROMA_API_KEY`, `CHROMA_TENANT`, `CHROMA_DATABASE` | Indexed specs and DDL |
| `CHROMA_API_COLLECTION`, `CHROMA_DDL_COLLECTION` | Collection names |

Also set if you use those features:

| Variable | Purpose |
| --- | --- |
| `OLLAMA_URL`, `OLLAMA_EMBED_MODEL` | Embeddings for ingestion |
| `CONFLUENCE_*` | Ingest API spec pages |
| `JIRA_*` | Ticket / user-story MCP (optional; see backend README) |
| `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT` | Traces |
| `SUPABASE_*`, `VAULT_DEV_TOKEN` | Vault in the GUI |
| `PORT` | Backend listen port (default `3000`) |
| `CORS_ORIGIN` | Frontend origin(s), comma-separated |

MCP processes spawned by Claude Code always load **this** `backend/.env` by
absolute path, even when cwd is a product repo.

Point your shell at the checkout (required for both plugin runtimes):

```bash
export SA_AGENT_HOME="$HOME/agents/sa-agent"   # add to ~/.zshrc
```

Index knowledge before `search_api_specs` / `search_schema_docs` are useful:

```bash
cd "$SA_AGENT_HOME/backend"
bun run ingest:confluence
bun run ingest:ddl path/to/schema.sql
```

Build the system model for each product repo you work in. It is deterministic
and free, so re-run it whenever the code moves — the agents also call
`build_system_model` themselves:

```bash
cd /path/to/product-repo
bun run --cwd "$SA_AGENT_HOME/backend" model:build "$PWD"
```

Add this to that repo's `.gitignore` — the graph is rebuildable, the decision
records are not:

```gitignore
.sa/*.db
.sa/*.db-shm
.sa/*.db-wal
```

## 2. Product workspace (Claude Code or Codex)

Use this when you want the analyst/architect to work **in the repo you are
building**: inspect live schema, write specs and SQL into that tree, then
implement.

This checkout is a **plugin marketplace** for both runtimes. They read
different manifests and load the same skills, MCP servers, and memory:

| Runtime | Marketplace manifest | Plugin manifest |
| --- | --- | --- |
| Claude Code | `.claude-plugin/marketplace.json` | `backend/agents/claude/.claude-plugin/plugin.json` |
| Codex | `.agents/plugins/marketplace.json` | `backend/agents/claude/.codex-plugin/plugin.json` |

Both marketplaces are named `sa-agent` and expose one plugin, also `sa-agent`.

### 2a. Claude Code

1. Export `SA_AGENT_HOME` in the same environment that launches Claude Code.
2. From the **product** repo:

   ```bash
   cd /path/to/product-repo
   claude plugin marketplace add "$SA_AGENT_HOME"
   ```

3. Install the plugin:

   - **CLI session:** `/plugin install sa-agent@sa-agent`
   - **Claude Code GUI:** Settings → Plugins → marketplace `sa-agent` → install
     **sa-agent**.

4. Confirm MCP: `/mcp` (or the MCP panel). You should see **sa-knowledge**
   (Postgres + Chroma) and **jira**. If they fail to start, `SA_AGENT_HOME` is
   unset or `backend/.env` is incomplete.

5. Run one phase at a time. `/agents` picks **system-analyst** (discuss),
   **solution-architect** (plan), **coder** (execute), **test-engineer**,
   or **reviewer**. Approve the artifact before the next phase.

   For a Production Verification Test, use the PVT track instead:
   **pvt-analyst** (pvt-discuss), **pvt-planner** (test planning), then
   **pvt-scripter** (the SQL script set). Same gates, its own artifacts.

Details: [`backend/agents/claude/README.md`](backend/agents/claude/README.md).

### 2b. Codex

Codex spawns plugin MCP servers with a stripped environment and passes their
arguments verbatim, so `SA_AGENT_HOME` alone cannot locate the checkout. Record
the path once — the launcher reads this file when the variable is missing:

```bash
mkdir -p ~/.sa-agent
echo "$SA_AGENT_HOME" > ~/.sa-agent/home
```

1. Add the marketplace and install the plugin from the **product** repo:

   ```bash
   cd /path/to/product-repo
   codex plugin marketplace add "$SA_AGENT_HOME"
   codex plugin add sa-agent --marketplace sa-agent
   ```

   The ChatGPT desktop app reads the same configured marketplace: restart it,
   then Plugins Directory → source **sa-agent** → install **sa-agent**.

2. Confirm the install: `codex plugin list --marketplace sa-agent`, and `/mcp`
   in a session for **sa-knowledge** and **jira**. If a server exits asking you
   to set `SA_AGENT_HOME`, neither the variable nor `~/.sa-agent/home` resolved;
   any other failure means `backend/.env` is incomplete.

3. Trust the hooks. Plugin-bundled hooks are untrusted until you review them,
   so `memory/AGENTS.md` (the loop and grounding rules) is not injected at
   session start until you approve the hook.

4. Run one phase at a time by invoking the skill: `$system-analyst` (discuss),
   `$solution-architect` (plan), `$test-engineer` (test), plus `$backend` and
   `$jira`. Approve the artifact before the next phase. `$pvt-prep` drives the
   PVT track.

Codex has no plugin equivalent of Claude Code subagents, so `agents/*.md` is
not loaded there. Execute and review are driven by you against the approved
plan; the phase discipline comes from the skills and `memory/AGENTS.md`.

### Both runtimes

Figma MCP is not bundled. Add a `figma` server in the product repo’s
`.mcp.json` if you need it.

Neither runtime calls the LangChain `/chat` agent. Tool calls still appear in
LangSmith as MCP runs, tagged `mcp` plus `claude-code` or `codex`, when tracing
is on.

## 3. Chat GUI (this repo)

Use this for a browser chat that talks to the Deep Agent over HTTP. It does not
edit a product workspace.

Align ports so Next and Express do not collide. Example:

```bash
# backend/.env
PORT=5001
CORS_ORIGIN=http://localhost:3000
```

```bash
# frontend/.env.local (create)
NEXT_PUBLIC_AGENT_API=http://localhost:5001
NEXT_PUBLIC_VAULT_TOKEN=<same as VAULT_DEV_TOKEN>
```

```bash
cd "$SA_AGENT_HOME/backend" && bun install && bun run dev
cd "$SA_AGENT_HOME/frontend" && bun install && bun run dev
```

Open [http://localhost:3000](http://localhost:3000). Chat hits `POST /chat`.
Pass the returned `threadId` on later turns (the GUI does this). Vault needs
Supabase + `sql/vault.sql` as described in
[`backend/README.md`](backend/README.md).

You can also call the agent without the UI:

```bash
curl -s http://localhost:5001/health
curl -s -X POST http://localhost:5001/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"List the tables that look related to orders."}'
```

## Layout

```
sa-agent/
  .claude-plugin/marketplace.json   Claude Code marketplace (points at the plugin)
  .agents/plugins/marketplace.json  Codex marketplace (points at the same plugin)
  backend/                          Deep Agent, MCP servers, vault API
    agents/                         harness, tools, skills, plugin
      model/                        system model: scan, graph, impact, decisions
      claude/                       plugin bundle: both manifests, skills, hooks
    mcp/                            sa-knowledge stdio MCP + `sa-mcp` launcher
  frontend/                         Next.js chat + vault GUI
```

In each **product** repo the agent also maintains:

```
.sa/
  system-model.db                   the graph (derived — gitignored)
  decisions/0001-*.md               why the code is the way it is (committed)
docs/sa/<phase>.md                  the phase artifacts
docs/sa/pvt-<phase>.md              the PVT prep artifacts
```

Backend layout, tools, ingestion, and HTTP API:
[`backend/README.md`](backend/README.md).

## Grounding (both runtimes)

1. Live DB — `list_tables`, `describe_tables`, `inspect_relationships`, `run_sql`
2. System model — `query_system_model`, `simulate_impact`, `search_decisions`
3. Indexed knowledge — `search_api_specs`, `search_schema_docs`
4. Jira — only if you explicitly ask for a ticket or user story

The system model is a deterministic graph of the product repo: endpoints,
services, repositories, frontend, tests, docs, and live tables, plus the
recorded reasoning behind past choices. It answers *what connects to what* and
*why is this like this*, which the schema and the index cannot. It never
invents: a table found in code but not in the live schema is reported, not
added. See
[`backend/agents/(docs)/ARCHITECTURE.md`](backend/agents/(docs)/ARCHITECTURE.md#the-system-model).

Ask it directly in either runtime:

```
What breaks if I rename orders.user_id?
Why do we store the result instead of recomputing it?
```
