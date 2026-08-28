/**
 * Stdio MCP server for Jira. Exposes only the two tools the agent is allowed
 * to use, and only when the user explicitly asks for a ticket or user story.
 *
 * Spawned by mcp-client.ts, or run directly:
 *   bun run agents/resources/mcp/mcp-server.ts
 */
import { backendEnvLoaded } from "../../../load-env";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { fetchIssue, formatTicket, formatUserStory } from "./jira-api";
import { tracedMcpTool, tracingStatus } from "../../../mcp/trace";

void backendEnvLoaded;

const ISSUE_KEY_SCHEMA = {
  type: "object",
  properties: {
    issue_key: {
      type: "string",
      description: "Jira issue key, e.g. PROJ-123",
    },
  },
  required: ["issue_key"],
} as const;

const server = new Server(
  {
    name: "jira-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_ticket",
        description:
          "Get Jira ticket details by issue key (summary, status, assignee, description). " +
          "Use only when the user explicitly asks for a ticket or issue.",
        inputSchema: ISSUE_KEY_SCHEMA,
      },
      {
        name: "read_user_story",
        description:
          "Read a Jira user story: narrative, acceptance criteria, sub-tasks, and links. " +
          "Use only when the user explicitly asks to read a user story.",
        inputSchema: ISSUE_KEY_SCHEMA,
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  const issueKey = String(args.issue_key ?? "");
  const name = request.params.name;

  try {
    const text = await tracedMcpTool("jira", name, args, async () => {
      switch (name) {
        case "get_ticket":
          return formatTicket(await fetchIssue(issueKey));
        case "read_user_story":
          return formatUserStory(await fetchIssue(issueKey));
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });

    return { content: [{ type: "text" as const, text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: `Jira MCP error: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Jira MCP server running on stdio (${tracingStatus()})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
