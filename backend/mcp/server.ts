/**
 * Stdio MCP server for live Postgres schema tools and Chroma retrieval.
 *
 * Spawned by Claude Code via SA_AGENT_HOME, or run directly:
 *   bun run mcp/server.ts
 */
import { backendEnvLoaded } from "../load-env";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  describeTables,
  inspectRelationships,
  listTables,
  runSql,
} from "../agents/tools/core/postgres";
import {
  searchApiSpecs,
  searchSchemaDocs,
} from "../agents/tools/core/knowledge";
import { tracedMcpTool, tracingStatus } from "./trace";

void backendEnvLoaded;

const TABLES_SCHEMA = {
  type: "object",
  properties: {
    tables: {
      type: "array",
      items: { type: "string" },
      description: "Exact table names",
    },
  },
  required: ["tables"],
} as const;

const OPTIONAL_TABLES_SCHEMA = {
  type: "object",
  properties: {
    tables: {
      type: "array",
      items: { type: "string" },
      description: "Restrict to relationships touching these tables",
    },
  },
} as const;

const SEARCH_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", description: "What to look for" },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 10,
      description: "Max documents to return (default 5)",
    },
  },
  required: ["query"],
} as const;

const server = new Server(
  { name: "sa-knowledge", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_tables",
      description:
        "List every table and view in the live application database with column counts and row estimates. " +
        "Call this first when you do not yet know which tables exist.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "describe_tables",
      description:
        "Return the live column definitions (type, nullability, default, primary key, comment) for one or more tables. " +
        "Use this before writing SQL or defining an API response schema.",
      inputSchema: TABLES_SCHEMA,
    },
    {
      name: "inspect_relationships",
      description:
        "Return the live foreign key graph — which tables reference which, in both directions. " +
        "Use this to understand how entities join before designing queries, ER diagrams, or API payloads. " +
        "Omit `tables` to get the whole schema graph.",
      inputSchema: OPTIONAL_TABLES_SCHEMA,
    },
    {
      name: "run_sql",
      description:
        "Execute a read-only SELECT against the live database to verify a query or sample real data. " +
        "Runs in a read-only transaction; INSERT/UPDATE/DELETE/DDL are rejected. " +
        "Always describe the tables first so the query references real columns.",
      inputSchema: {
        type: "object",
        properties: {
          sql: {
            type: "string",
            description: "A single SELECT or WITH statement",
          },
        },
        required: ["sql"],
      },
    },
    {
      name: "search_api_specs",
      description:
        "Search the indexed Confluence API specifications and internal knowledge base. " +
        "Use for existing endpoints, request/response contracts, auth schemes, and team conventions.",
      inputSchema: SEARCH_SCHEMA,
    },
    {
      name: "search_schema_docs",
      description:
        "Search indexed DDL documentation for background on tables and columns. " +
        "This is a documentation snapshot — for authoritative, current structure use describe_tables " +
        "and inspect_relationships instead.",
      inputSchema: SEARCH_SCHEMA,
    },
  ],
}));

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => String(item));
}

function asLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return 5;
  return Math.min(10, Math.max(1, value));
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  const name = request.params.name;

  try {
    const text = await tracedMcpTool("sa-knowledge", name, args, async () => {
      switch (name) {
        case "list_tables":
          return listTables();
        case "describe_tables": {
          const tables = asStringArray(args.tables) ?? [];
          if (tables.length === 0) {
            return "describe_tables requires at least one table name.";
          }
          return describeTables(tables);
        }
        case "inspect_relationships":
          return inspectRelationships(asStringArray(args.tables));
        case "run_sql":
          return runSql(asString(args.sql));
        case "search_api_specs":
          return searchApiSpecs(asString(args.query), asLimit(args.limit));
        case "search_schema_docs":
          return searchSchemaDocs(asString(args.query), asLimit(args.limit));
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });

    return { content: [{ type: "text" as const, text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        { type: "text" as const, text: `sa-knowledge MCP error: ${message}` },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`sa-knowledge MCP server running on stdio (${tracingStatus()})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
