import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MultiServerMCPClient,
  type Connection,
} from "@langchain/mcp-adapters";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { config } from "../../../config";

const LOCAL_SERVER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "mcp-server.ts",
);

function envRecord(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function parseArgs(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error("JIRA_MCP_ARGS must be a JSON array of strings");
    }
    return parsed as string[];
  }
  return trimmed.split(/\s+/);
}

export function isJiraMcpConfigured(): boolean {
  const jira = config.jira;
  return Boolean(jira.mcpUrl || jira.mcpCommand || jira.url);
}

function jiraConnection(): Connection | undefined {
  const jira = config.jira;

  if (jira.mcpUrl) {
    return {
      transport: jira.mcpTransport,
      url: jira.mcpUrl,
      ...(jira.mcpToken
        ? { headers: { Authorization: `Bearer ${jira.mcpToken}` } }
        : {}),
    };
  }

  if (jira.mcpCommand) {
    return {
      transport: "stdio",
      command: jira.mcpCommand,
      args: parseArgs(jira.mcpArgs),
      env: envRecord(),
      restart: { enabled: true, maxAttempts: 3, delayMs: 1000 },
    };
  }

  if (jira.url) {
    return {
      transport: "stdio",
      command: process.execPath,
      args: [LOCAL_SERVER],
      env: envRecord(),
      stderr: "inherit",
      restart: { enabled: true, maxAttempts: 3, delayMs: 1000 },
    };
  }

  return undefined;
}

let client: MultiServerMCPClient | undefined;
let toolsPromise: Promise<DynamicStructuredTool[]> | undefined;

export function getJiraMcpClient(): MultiServerMCPClient | undefined {
  if (client) return client;
  const connection = jiraConnection();
  if (!connection) return undefined;

  client = new MultiServerMCPClient({
    throwOnLoadError: false,
    onConnectionError: "ignore",
    mcpServers: {
      jira: connection,
    },
  });
  return client;
}

export async function getJiraMcpTools(): Promise<DynamicStructuredTool[]> {
  if (toolsPromise) return toolsPromise;
  const mcp = getJiraMcpClient();
  if (!mcp) return [];
  toolsPromise = mcp.getTools().catch((err: unknown) => {
    toolsPromise = undefined;
    console.error("Jira MCP failed to load tools:", err);
    return [];
  });
  return toolsPromise;
}
