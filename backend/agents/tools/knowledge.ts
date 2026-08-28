import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { apiSpecStore, ddlStore } from "../../database/chroma";
import { orToolError } from "./errors";

const KNOWLEDGE_BASE = "The indexed knowledge base";

function join(docs: { pageContent: string }[]): string {
  if (docs.length === 0) return "No matching documents.";
  return docs.map((d) => d.pageContent).join("\n\n---\n\n");
}

export const searchApiSpecs = tool(
  async ({ query, limit }) =>
    orToolError(KNOWLEDGE_BASE, async () =>
      join(await apiSpecStore.similaritySearch(query, limit)),
    ),
  {
    name: "search_api_specs",
    description:
      "Search the indexed Confluence API specifications and internal knowledge base. " +
      "Use for existing endpoints, request/response contracts, auth schemes, and team conventions.",
    schema: z.object({
      query: z.string().describe("What to look for"),
      limit: z.number().int().min(1).max(10).default(5),
    }),
  },
);

export const searchSchemaDocs = tool(
  async ({ query, limit }) =>
    orToolError(KNOWLEDGE_BASE, async () =>
      join(await ddlStore.similaritySearch(query, limit)),
    ),
  {
    name: "search_schema_docs",
    description:
      "Search indexed DDL documentation for background on tables and columns. " +
      "This is a documentation snapshot — for authoritative, current structure use describe_tables " +
      "and inspect_relationships instead.",
    schema: z.object({
      query: z.string().describe("What to look for"),
      limit: z.number().int().min(1).max(10).default(5),
    }),
  },
);
