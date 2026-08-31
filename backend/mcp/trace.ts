import { backendEnvLoaded } from "../load-env";
import { Client } from "langsmith";
import { traceable } from "langsmith/traceable";

void backendEnvLoaded;

const client = new Client();

function tracingEnabled(): boolean {
  return (
    process.env.LANGSMITH_TRACING === "true" ||
    process.env.LANGCHAIN_TRACING_V2 === "true"
  );
}

export function tracingStatus(): string {
  if (!tracingEnabled()) return "LangSmith tracing off";
  const project =
    process.env.LANGSMITH_PROJECT ||
    process.env.LANGCHAIN_PROJECT ||
    "default";
  return `LangSmith tracing on (project ${project})`;
}

/** Set by the plugin MCP config, since both plugin runtimes share these servers. */
function runtimeTag(): string {
  return process.env.SA_AGENT_RUNTIME?.trim() || "claude-code";
}

/**
 * Record one MCP tool invocation in LangSmith. A plugin runtime never runs the
 * LangChain agent, so without this wrapper those calls are invisible.
 */
export async function tracedMcpTool(
  server: string,
  name: string,
  args: Record<string, unknown>,
  run: () => Promise<string>,
): Promise<string> {
  const runtime = runtimeTag();
  const traced = traceable(
    async (_input: Record<string, unknown>) => run(),
    {
      name,
      run_type: "tool",
      project_name:
        process.env.LANGSMITH_PROJECT || process.env.LANGCHAIN_PROJECT,
      metadata: { mcp_server: server, runtime },
      tags: ["mcp", runtime, server],
      client,
    },
  );

  try {
    return await traced(args);
  } finally {
    if (tracingEnabled()) {
      await client.awaitPendingTraceBatches();
    }
  }
}
