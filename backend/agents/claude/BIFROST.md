# Claude Code via Bifrost

sa-agent is a **plugin**. Claude Code runs in the **product repo** (for example
`admin-service`). This checkout only supplies tools, skills, and gateway
config.

Do **not** put `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_BASE_URL` in `~/.zshrc`.
Those override Bifrost. Launch with `scripts/claude` every session.

## 0. What you need

- [Bun](https://bun.sh)
- A Bifrost virtual key and the gateway origin
- A product repo to work in
- Optional: `DATABASE_URL` (read-only Postgres) so schema tools work

## 1. Clone sa-agent (once)

```bash
git clone <sa-agent-url> ~/agents/sa-agent
cd ~/agents/sa-agent/backend
bun install
cp .env.example .env
```

Edit `backend/.env`:

```bash
BIFROST_BASE_URL=https://inf-bifrost.sandbox.vayu-krungthai.com
BIFROST_API_KEY=<your-virtual-key>
BIFROST_AUTH_HEADER=x-bf-vk
```

Leave `ANTHROPIC_API_KEY` empty. The launcher copies the Bifrost key.

Add to `~/.zshrc`:

```bash
export SA_AGENT_HOME="$HOME/agents/sa-agent"
```

Then `source ~/.zshrc`.

## 2. Install Claude Code (once)

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude --version
```

## 3. Prove the gateway

```bash
cd "$SA_AGENT_HOME/backend"
bun run check:bifrost -- --claude
```

Expect `anthropic surface` and `tool use` to pass. If this fails, stop — the
CLI will fail the same way.

List model ids this key can reach:

```bash
bun run check:bifrost -- --models
```

## 4. Every session: open the product repo through the launcher

```bash
cd /path/to/product-repo          # e.g. ~/aster-repo/admin-service
"$SA_AGENT_HOME/backend/scripts/claude"
```

The script should print:

```
Claude Code → https://…/anthropic
  model       dashscope/qwen3.8-max
  small/fast  huawei/glm-5.2
  key header  x-bf-vk
```

In the session, run `/status`. The API base URL must end with `/anthropic`,
not `api.anthropic.com`. Env is read at startup — a session already talking to
Anthropic will keep doing so until you quit and relaunch.

Defaults: `dashscope/qwen3.8-max` (main) and `huawei/glm-5.2` (background /
plugin subagents that declare `model: haiku`). Override with
`CLAUDE_BIFROST_MODEL` / `CLAUDE_BIFROST_SMALL_MODEL` in `backend/.env`.

## 5. First time in that product repo: install the plugin

Still in that Claude session (cwd = product repo):

```
/plugin marketplace add ~/agents/sa-agent
/plugin install sa-agent@sa-agent
```

Or from the shell, before launching:

```bash
cd /path/to/product-repo
claude plugin marketplace add "$SA_AGENT_HOME"
```

then `/plugin install sa-agent@sa-agent` inside Claude.

Check `/mcp`. You want **sa-knowledge** (and **jira** if configured). If they
fail, `SA_AGENT_HOME` was not set in the shell that started Claude.

Optional, once per product repo:

```bash
cd /path/to/product-repo
bun run --cwd "$SA_AGENT_HOME/backend" model:build "$PWD"
```

Add to that repo's `.gitignore`:

```gitignore
.sa/*.db
.sa/*.db-shm
.sa/*.db-wal
```

## 6. How to work

One phase at a time. `/agents`, then:

| Goal | Agent | Writes |
| --- | --- | --- |
| Feature | system-analyst → solution-architect → coder → test-engineer → reviewer | `docs/sa/<phase>.md` |
| PVT | pvt-analyst → pvt-planner → pvt-scripter | `docs/sa/pvt-*.md` |

Approve the artifact before the next agent. You commit and open the PR.

Switch model by typing the id. The `/model` picker only lists Claude names:

```
/model dashscope/qwen3.8-max
/model huawei/glm-5.2
```

## If it breaks

| Symptom | Fix |
| --- | --- |
| `401 virtual key is required` | You launched plain `claude`. Quit. Use `"$SA_AGENT_HOME/backend/scripts/claude"`. `/logout` if a Claude login is stuck. |
| 404 | Base URL missing `/anthropic`. |
| Still on `api.anthropic.com` | Env is read at startup. New terminal + the launcher. Unset `ANTHROPIC_AUTH_TOKEN`. |
| MCP dead | `echo $SA_AGENT_HOME` in that shell. Fill in `backend/.env`. |
| `/model` has no Qwen | Type `dashscope/qwen3.8-max` by hand. |

The gateway authenticates on `x-bf-vk`, not Anthropic's `x-api-key`. A Claude
subscription login sends an OAuth bearer and ignores `ANTHROPIC_API_KEY`. The
launcher sets `ANTHROPIC_CUSTOM_HEADERS` so the virtual key still arrives.
