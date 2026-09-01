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
import {
  buildModel,
  queryModel,
  recordDecision,
  searchDecisions,
  simulate,
} from "../agents/tools/core/system-model";
import { NODE_KINDS } from "../agents/model/types";
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

const QUERY_MODEL_SCHEMA = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Component to look up, or `*` for an overview of the model",
    },
    kind: {
      type: "string",
      enum: [...NODE_KINDS],
      description: "Restrict matches to one node kind",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 15,
      description: "Max nodes to expand (default 5)",
    },
  },
  required: ["query"],
} as const;

const IMPACT_SCHEMA = {
  type: "object",
  properties: {
    target: {
      type: "string",
      description:
        "What is changing: `orders.user_id`, `OrderService`, `GET /orders`, or a file path",
    },
    depth: {
      type: "integer",
      minimum: 1,
      maximum: 8,
      description: "How many dependency hops to follow (default 4)",
    },
  },
  required: ["target"],
} as const;

const DECISION_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "One line, imperative: what was decided" },
    context: { type: "string", description: "The situation that forced a choice" },
    decision: { type: "string", description: "What was chosen" },
    reason: { type: "string", description: "Why this option, in the team's own words" },
    alternatives: {
      type: "string",
      description: "What else was considered and why it lost",
    },
    consequences: {
      type: "string",
      description: "What this commits the team to, including the downsides",
    },
    related: {
      type: "array",
      items: { type: "string" },
      description:
        "Nodes this constrains: table names, `table.column`, class names, `GET /path`",
    },
  },
  required: ["title", "context", "decision", "reason"],
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
    {
      name: "build_system_model",
      description:
        "Scan this repository and rebuild the system model: files, imports, HTTP endpoints, " +
        "table access, tests, docs, and the live database schema, as a typed graph in .sa/system-model.db. " +
        "Run it once before the other system-model tools, and again after code changes. " +
        "Deterministic and free — it calls no model.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "query_system_model",
      description:
        "Look up a component in the system model and get what it depends on, what depends on it, " +
        "and any recorded decision about it. Accepts a class name, file path, table, `table.column`, " +
        "or `GET /path`. Pass `*` for an overview of the whole model. " +
        "Use this before designing a change, to find the real components involved.",
      inputSchema: QUERY_MODEL_SCHEMA,
    },
    {
      name: "simulate_impact",
      description:
        "Answer 'what breaks if I change this?'. Walks the dependency graph backwards from a table, " +
        "column, endpoint, service, or file and returns the affected APIs, services, frontend, tests, " +
        "and docs grouped by layer, plus a risk level with the reasons behind it and any decision " +
        "records that constrain the area. Use this before planning, and put the result in the plan.",
      inputSchema: IMPACT_SCHEMA,
    },
    {
      name: "record_decision",
      description:
        "Write down why an engineering choice was made, as a reviewable markdown record in " +
        ".sa/decisions/ that is linked into the system model. Use it when a choice has a rationale " +
        "the code cannot show — a denormalisation, a rejected alternative, a deliberate constraint. " +
        "Ask the human to confirm the reason; do not invent one.",
      inputSchema: DECISION_SCHEMA,
    },
    {
      name: "search_decisions",
      description:
        "Search recorded engineering decisions for the reasoning behind an existing implementation. " +
        "Answers 'why is this like this?' where the graph and the schema only answer 'what' and 'where'. " +
        "Check this before proposing a change that contradicts a past choice.",
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

function asLimit(value: unknown, max = 10): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return 5;
  return Math.min(max, Math.max(1, value));
}

function asDepth(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return 4;
  return Math.min(8, Math.max(1, value));
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
        case "build_system_model":
          return buildModel();
        case "query_system_model":
          return queryModel(
            asString(args.query),
            args.kind === undefined ? undefined : asString(args.kind),
            asLimit(args.limit, 15),
          );
        case "simulate_impact":
          return simulate(asString(args.target), asDepth(args.depth));
        case "record_decision":
          return recordDecision({
            title: asString(args.title),
            context: asString(args.context),
            decision: asString(args.decision),
            reason: asString(args.reason),
            alternatives: asString(args.alternatives),
            consequences: asString(args.consequences),
            related: asStringArray(args.related) ?? [],
          });
        case "search_decisions":
          return searchDecisions(asString(args.query), asLimit(args.limit));
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
