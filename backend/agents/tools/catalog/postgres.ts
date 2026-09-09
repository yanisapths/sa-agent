import { z } from "zod";
import {
  describeTables,
  inspectRelationships,
  listTables,
  runSql,
} from "../core/postgres";
import { defineTool } from "./types";

const KNOWLEDGE = ["langchain", "mcp-knowledge"] as const;

export const postgresTools = [
  defineTool({
    name: "list_tables",
    description:
      "List every table and view in the live application database with column counts and row estimates. " +
      "Call this first when you do not yet know which tables exist.",
    schema: z.object({}),
    surfaces: KNOWLEDGE,
    invoke: () => listTables(),
  }),
  defineTool({
    name: "describe_tables",
    description:
      "Return the live column definitions (type, nullability, default, primary key, comment) for one or more tables. " +
      "Use this before writing SQL or defining an API response schema.",
    schema: z.object({
      tables: z.array(z.string()).min(1).describe("Exact table names"),
    }),
    surfaces: KNOWLEDGE,
    invoke: ({ tables }) => describeTables(tables),
  }),
  defineTool({
    name: "inspect_relationships",
    description:
      "Return the live foreign key graph — which tables reference which, in both directions. " +
      "Use this to understand how entities join before designing queries, ER diagrams, or API payloads. " +
      "Omit `tables` to get the whole schema graph.",
    schema: z.object({
      tables: z
        .array(z.string())
        .optional()
        .describe("Restrict to relationships touching these tables"),
    }),
    surfaces: KNOWLEDGE,
    invoke: ({ tables }) => inspectRelationships(tables),
  }),
  defineTool({
    name: "run_sql",
    description:
      "Execute a single SQL statement against the live database. " +
      "SELECT/WITH sample or verify data (read-only transaction). " +
      "INSERT/UPDATE/DELETE mutate data (committed after human approval). " +
      "DDL and multi-statement batches are rejected. " +
      "Always describe the tables first so the query references real columns.",
    schema: z.object({
      sql: z
        .string()
        .describe("A single SELECT, WITH, INSERT, UPDATE, or DELETE statement"),
    }),
    surfaces: KNOWLEDGE,
    invoke: ({ sql }) => runSql(sql),
  }),
] as const;
