import {
  MultiServerMCPClient,
  type Connection,
} from "@langchain/mcp-adapters";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { fileURLToPath } from "node:url";
import { config } from "../../../config";

function envRecord(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function parseArgs(raw: string, envName: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error(`${envName} must be a JSON array of strings`);
    }
    return parsed as string[];
  }
  return trimmed.split(/\s+/);
}

export function isJiraRemoteMcpConfigured(): boolean {
  const jira = config.jira;
  return Boolean(jira.mcpUrl || jira.mcpCommand);
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
      args: parseArgs(jira.mcpArgs, "JIRA_MCP_ARGS"),
      env: envRecord(),
      restart: { enabled: true, maxAttempts: 3, delayMs: 1000 },
    };
  }

  return undefined;
}

function bearer(raw: string): string {
  return raw.trim().replace(/^Bearer\s+/i, "");
}

function hasConfluenceRestAuth(): boolean {
  const docs = config.confluence;
  return Boolean(
    docs.baseUrl && (docs.personalToken || (docs.username && docs.accessToken)),
  );
}

function confluenceAuthHeaders(): Record<string, string> | undefined {
  const docs = config.confluence;
  if (docs.mcpToken) return { Authorization: `Bearer ${bearer(docs.mcpToken)}` };
  if (docs.personalToken) {
    return { Authorization: `Bearer ${bearer(docs.personalToken)}` };
  }
  if (docs.username && docs.accessToken) {
    const basic = Buffer.from(`${docs.username}:${docs.accessToken}`).toString(
      "base64",
    );
    return { Authorization: `Basic ${basic}` };
  }
  return undefined;
}

function confluenceConnection(): Connection | undefined {
  const docs = config.confluence;

  if (docs.mcpUrl) {
    const headers = confluenceAuthHeaders();
    return {
      transport: docs.mcpTransport,
      url: docs.mcpUrl,
      ...(headers ? { headers } : {}),
    };
  }

  if (docs.mcpCommand) {
    return {
      transport: "stdio",
      command: docs.mcpCommand,
      args: parseArgs(docs.mcpArgs, "CONFLUENCE_MCP_ARGS"),
      env: envRecord(),
      restart: { enabled: true, maxAttempts: 3, delayMs: 1000 },
    };
  }

  if (hasConfluenceRestAuth()) {
    return {
      transport: "stdio",
      command: process.execPath,
      args: [
        fileURLToPath(new URL("../../../mcp/confluence.ts", import.meta.url)),
      ],
      env: envRecord(),
      restart: { enabled: true, maxAttempts: 3, delayMs: 1000 },
    };
  }

  return undefined;
}

let client: MultiServerMCPClient | undefined;
let toolsPromise: Promise<DynamicStructuredTool[]> | undefined;
let confluenceClient: MultiServerMCPClient | undefined;
let confluenceToolsPromise: Promise<DynamicStructuredTool[]> | undefined;
let nextDevToolsClient: MultiServerMCPClient | undefined;

export function isConfluenceMcpConfigured(): boolean {
  return confluenceConnection() !== undefined;
}

export function getConfluenceMcpClient(): MultiServerMCPClient | undefined {
  if (confluenceClient) return confluenceClient;
  const connection = confluenceConnection();
  if (!connection) return undefined;

  confluenceClient = new MultiServerMCPClient({
    throwOnLoadError: false,
    onConnectionError: "ignore",
    mcpServers: {
      confluence: connection,
    },
  });
  return confluenceClient;
}

export async function getConfluenceMcpTools(): Promise<DynamicStructuredTool[]> {
  if (confluenceToolsPromise) return confluenceToolsPromise;
  const mcp = getConfluenceMcpClient();
  if (!mcp) return [];
  confluenceToolsPromise = mcp.getTools().catch((err: unknown) => {
    confluenceToolsPromise = undefined;
    console.error("Confluence MCP failed to load tools:", err);
    return [];
  });
  return confluenceToolsPromise;
}

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

/**
 * Get the next-devtools MCP client. This allows the agent to inspect
 * the running Next.js dev server (when running on localhost:3000).
 */
export function getNextDevToolsMcpClient(): MultiServerMCPClient {
  if (nextDevToolsClient) return nextDevToolsClient;

  nextDevToolsClient = new MultiServerMCPClient({
    throwOnLoadError: false,
    onConnectionError: "ignore",
    mcpServers: {
      "next-devtools": {
        transport: "stdio",
        command: "npx",
        args: ["-y", "next-devtools-mcp@latest"],
        env: envRecord(),
        restart: { enabled: true, maxAttempts: 3, delayMs: 1000 },
      },
    },
  });
  return nextDevToolsClient;
}

export async function getNextDevToolsMcpTools(): Promise<DynamicStructuredTool[]> {
  const mcp = getNextDevToolsMcpClient();
  try {
    return await mcp.getTools();
  } catch (err: unknown) {
    console.debug("next-devtools MCP failed to load tools:", err);
    return [];
  }
}
