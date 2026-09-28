export type Command = {
  group: string;
  command: string;
  summary: string;
};

/**
 * Commands worth running from this checkout. `bun run help` prints this list;
 * `doctor` points at it when a check fails and the next step is a command.
 */
export const COMMANDS: Command[] = [
  {
    group: "Setup",
    command: "bun run doctor",
    summary: "Check the checkout, .env, and whether Postgres, the gateway, and Ollama answer.",
  },
  {
    group: "Setup",
    command: "bun run doctor -- --offline",
    summary: "Same checks, without opening a connection.",
  },
  {
    group: "Setup",
    command: "bun run help",
    summary: "Print this list.",
  },
  {
    group: "Run",
    command: "bun run dev",
    summary: "Start the backend (POST /chat, vault, artifacts, project folders).",
  },
  {
    group: "Run",
    command: 'bun run --cwd "$SA_AGENT_HOME/frontend" dev',
    summary: "Start the chat GUI. Set NEXT_PUBLIC_AGENT_API to the backend origin.",
  },
  {
    group: "Run",
    command: "bun run typecheck",
    summary: "Typecheck the backend.",
  },
  {
    group: "Run",
    command: "bun run test",
    summary: "Run the backend tests.",
  },
  {
    group: "Gateway",
    command: "bun run check:bifrost",
    summary: "Prove env, a chat completion, and a tool call through Bifrost.",
  },
  {
    group: "Gateway",
    command: "bun run check:bifrost -- --models",
    summary: "List model ids this virtual key can reach.",
  },
  {
    group: "Gateway",
    command: "bun run check:bifrost -- --claude",
    summary: "Probe the Anthropic Messages path Claude Code uses.",
  },
  {
    group: "Gateway",
    command: "bun run tokens",
    summary: "Estimate tokens for one turn. Nothing is sent.",
  },
  {
    group: "Gateway",
    command: "bun run claude",
    summary: "Launch Claude Code with the Bifrost virtual key from backend/.env.",
  },
  {
    group: "Data",
    command: "bun run model:build",
    summary: "Build .sa/system-model.db for the repo in the current directory.",
  },
  {
    group: "Data",
    command: "bun run model:build /path/to/repo",
    summary: "Build the system model for an explicit product repo.",
  },
  {
    group: "Data",
    command: "bun run ingest:ddl path/to/schema.sql",
    summary: "Index a DDL dump for search_schema_docs.",
  },
  {
    group: "Data",
    command: "bun run ingest:confluence",
    summary: "Index Confluence pages into Chroma. search_docs uses the live API instead.",
  },
  {
    group: "Data",
    command: "bun run ingest:url <url>",
    summary: "Index one page or text document.",
  },
  {
    group: "Data",
    command: "bun run ingest:clear -- ddl",
    summary: "Empty a Chroma collection. api is the default; ddl is the schema dump.",
  },
  {
    group: "MCP",
    command: "bun run mcp:knowledge",
    summary: "stdio server for schema, docs, and the system model.",
  },
  {
    group: "MCP",
    command: "bun run mcp:confluence",
    summary: "stdio server for live Confluence pages.",
  },
  {
    group: "MCP",
    command: "bun run mcp:jira",
    summary: "stdio server for Jira tickets and user stories.",
  },
  {
    group: "Plugin",
    command: 'claude plugin marketplace add "$SA_AGENT_HOME"',
    summary: "Register this checkout as a Claude Code marketplace.",
  },
  {
    group: "Plugin",
    command: 'codex plugin marketplace add "$SA_AGENT_HOME"',
    summary: "Register this checkout as a Codex marketplace.",
  },
  {
    group: "Plugin",
    command: "codex plugin add sa-agent --marketplace sa-agent",
    summary: "Install the plugin in a product repo.",
  },
  {
    group: "Plugin",
    command: 'echo "$SA_AGENT_HOME" > ~/.sa-agent/home',
    summary: "Record the checkout for MCP hosts that do not inherit the variable.",
  },
  {
    group: "Generated",
    command: "bun run surfaces",
    summary: "Regenerate plugin agents, MCP JSON, and the frontend chat contract.",
  },
  {
    group: "Generated",
    command: "bun run check:surfaces",
    summary: "Fail when those generated files are stale.",
  },
  {
    group: "PVT",
    command: 'python3 "$SA_AGENT_HOME/backend/scripts/testcase-extractor.py" <csv> -o docs/sa/pvt-cases.json',
    summary: "Turn a PVT case spreadsheet into the JSON the analyst reads.",
  },
  {
    group: "Eval",
    command: "bun run eval",
    summary: "Run the LangSmith vitest evals.",
  },
  {
    group: "Eval",
    command: "bun run eval:harbor",
    summary: "Run the Harbor job against the evaluator tasks.",
  },
];

export function renderHelp(): string {
  const lines = [
    "sa-agent commands",
    "",
    'Run the bun scripts from backend/, or prefix them with bun run --cwd "$SA_AGENT_HOME/backend".',
    "",
  ];
  let group = "";
  for (const entry of COMMANDS) {
    if (entry.group !== group) {
      if (group) lines.push("");
      group = entry.group;
      lines.push(group);
    }
    lines.push(`  ${entry.command}`);
    lines.push(`      ${entry.summary}`);
  }
  lines.push("");
  return lines.join("\n");
}
