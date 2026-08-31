# sa-agent plugin (Claude Code + Codex)

One bundle, two plugin runtimes. Install the marketplace from the sa-agent
checkout, then enable the plugin in any product repo. That runtime becomes the
LLM; this plugin supplies live schema tools, indexed knowledge, Jira MCP,
skills, and (Claude Code only) subagents.

| File                           | Read by                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| `.claude-plugin/plugin.json`   | Claude Code                                                   |
| `.codex-plugin/plugin.json`    | Codex                                                         |
| `.mcp.json`                    | Claude Code — spawns `bun` at `${SA_AGENT_HOME}`              |
| `.mcp.codex.json`              | Codex — resolves the checkout, then runs `backend/mcp/sa-mcp` |
| `skills/`, `hooks/`, `memory/` | both (symlinks into `../resources`)                           |
| `agents/`                      | Claude Code only                                              |

Figma MCP is not bundled. Add a `figma` server to the product repo's `.mcp.json`
when you have a Figma MCP endpoint.

## Claude Code

```bash
export SA_AGENT_HOME=/path/to/sa-agent   # add to ~/.zshrc
cd /path/to/product-repo
claude plugin marketplace add "$SA_AGENT_HOME"
```

Then in a Claude Code session:

```
/plugin install sa-agent@sa-agent
```

`SA_AGENT_HOME` must be set in the shell that launches Claude Code, or the MCP
servers will fail to start. Confirm with `/mcp` and `claude --debug`.

## Codex

Codex passes plugin MCP arguments verbatim (no `${VAR}` expansion) and spawns
those servers with a core environment only, so `SA_AGENT_HOME` may not reach
them. Record the checkout path once:

```bash
mkdir -p ~/.sa-agent
echo "$SA_AGENT_HOME" > ~/.sa-agent/home
```

```bash
cd /path/to/product-repo
codex plugin marketplace add "$SA_AGENT_HOME"
codex plugin add sa-agent --marketplace sa-agent
```

`.mcp.codex.json` resolves `$SA_AGENT_HOME`, then `~/.sa-agent/home`, and hands
the result to [`backend/mcp/sa-mcp`](../../mcp/sa-mcp), which locates `bun` and
execs the requested server. Run it by hand to debug:

```bash
"$SA_AGENT_HOME/backend/mcp/sa-mcp" knowledge   # expects a stdio banner
```

Codex has no plugin equivalent of Claude Code subagents, so `agents/*.md` is
ignored. Drive the phases with the skills (`$system-analyst`,
`$solution-architect`, `$test-engineer`). Codex also treats plugin hooks as
untrusted until you review them, so `memory/AGENTS.md` is not injected at
session start until the hook is approved.

## LangSmith

The plugin runtime is the LLM here, not the LangChain `/chat` agent. MCP tool
calls still show up in LangSmith (project `LANGSMITH_PROJECT`) as standalone
tool runs tagged `mcp` and the runtime — `claude-code` or `codex`, from
`SA_AGENT_RUNTIME` in the MCP config.

That requires `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY` in
`backend/.env`. After changing env or this plugin, reconnect with `/mcp`.
Debug logs on stderr include `LangSmith tracing on (project …)`.
