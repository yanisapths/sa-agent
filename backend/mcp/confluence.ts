/** Confluence docs MCP. search_docs / get_doc_page call this over stdio. */
import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { backendEnvLoaded } from "../load-env";
import {
  readConfluenceDocs,
  searchConfluenceDocs,
} from "../agents/resources/mcp/confluence-api";

void backendEnvLoaded;

const searchSchema = z.object({
  query: z.string().describe("Plain text or Confluence CQL"),
  limit: z.number().int().min(1).max(10).default(5),
});

const pagesSchema = z.object({
  page_ids: z
    .array(z.string())
    .min(1)
    .max(8)
    .describe("Page ids or Confluence URLs from confluence_search"),
});

function mcpInputSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  const { $schema: _schema, ...rest } = json;
  if (rest.type !== "object") return { type: "object", properties: {} };
  return rest;
}

const tools = [
  {
    name: "confluence_search",
    description:
      "Search Confluence pages for API contracts, endpoints, auth, and conventions. Returns titles, ids, and short snippets.",
    schema: searchSchema,
    invoke: (args: { query: string; limit?: number }) =>
      searchConfluenceDocs(args.query, args.limit ?? 5),
  },
  {
    name: "confluence_get_pages",
    description:
      "Read full Confluence pages by id or URL from confluence_search. Up to 8.",
    schema: pagesSchema,
    invoke: (args: { page_ids: string[] }) => readConfluenceDocs(args.page_ids),
  },
] as const;

const server = new Server(
  { name: "confluence-docs", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((entry) => ({
    name: entry.name,
    description: entry.description,
    inputSchema: mcpInputSchema(entry.schema),
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  const entry = tools.find((tool) => tool.name === request.params.name);
  try {
    if (!entry) throw new Error(`Unknown tool: ${request.params.name}`);
    const parsed = entry.schema.parse(args);
    const text = await entry.invoke(parsed as never);
    return { content: [{ type: "text" as const, text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: `Confluence MCP error: ${message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("confluence-docs MCP server running on stdio");
