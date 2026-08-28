import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  describeTables as describeTablesCore,
  inspectRelationships as inspectRelationshipsCore,
  listTables as listTablesCore,
  runSql as runSqlCore,
} from "./core/postgres";

export const listTables = tool(async () => listTablesCore(), {
  name: "list_tables",
  description:
    "List every table and view in the live application database with column counts and row estimates. " +
    "Call this first when you do not yet know which tables exist.",
  schema: z.object({}),
});

export const describeTables = tool(
  async ({ tables }) => describeTablesCore(tables),
  {
    name: "describe_tables",
    description:
      "Return the live column definitions (type, nullability, default, primary key, comment) for one or more tables. " +
      "Use this before writing SQL or defining an API response schema.",
    schema: z.object({
      tables: z.array(z.string()).min(1).describe("Exact table names"),
    }),
  },
);

export const inspectRelationships = tool(
  async ({ tables }) => inspectRelationshipsCore(tables),
  {
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
  },
);

export const runSql = tool(async ({ sql }) => runSqlCore(sql), {
  name: "run_sql",
  description:
    "Execute a read-only SELECT against the live database to verify a query or sample real data. " +
    "Runs in a read-only transaction; INSERT/UPDATE/DELETE/DDL are rejected. " +
    "Always describe the tables first so the query references real columns.",
  schema: z.object({
    sql: z.string().describe("A single SELECT or WITH statement"),
  }),
});
