# sa-agent Claude Code plugin

Install this marketplace from the sa-agent checkout, then enable the plugin in
any product repo. Claude Code becomes the runtime; this plugin supplies live
schema tools, indexed knowledge, Jira MCP, skills, and subagents.

Figma MCP is not bundled. Add a `figma` server to the product repo's `.mcp.json`
when you have a Figma MCP endpoint.

## Setup

```bash
export SA_AGENT_HOME=/path/to/sa-agent   # add to ~/.zshrc
cd /path/to/product-repo
claude plugin marketplace add /path/to/sa-agent
```

Then in a Claude Code session:

```
/plugin install sa-agent@sa-agent
```

`SA_AGENT_HOME` must be set in the shell that launches Claude Code, or the MCP
servers will fail to start. Confirm with `/mcp` and `claude --debug`.

## LangSmith

Claude Code is the LLM runtime here, not the LangChain `/chat` agent. MCP tool
calls still show up in LangSmith (project `LANGSMITH_PROJECT`) as standalone
tool runs tagged `mcp` and `claude-code`.

That requires `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY` in
`backend/.env`. After changing env or this plugin, reconnect with `/mcp`.
Debug logs on stderr include `LangSmith tracing on (project …)`.
