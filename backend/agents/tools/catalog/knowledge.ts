import { z } from "zod";
import {
  getDocPage,
  searchDocs,
  searchSchemaDocs,
} from "../core/knowledge";
import { defineTool } from "./types";

const KNOWLEDGE = ["langchain", "mcp-knowledge"] as const;

const searchSchema = z.object({
  query: z.string().describe("What to look for"),
  limit: z.number().int().min(1).max(10).default(5),
});

export const knowledgeTools = [
  defineTool({
    name: "search_docs",
    description:
      "Search Confluence for API contracts, endpoints, auth, and conventions. " +
      "Returns titles, page ids, and short snippets only — never answer from snippets. " +
      "Follow up with get_doc_page on the printed ids or URLs " +
      "(prefer the 1–3 best hits; the tool accepts up to 8). " +
      "If results are ambiguous, search again with a narrower term (budget 4–6 docs calls).",
    schema: searchSchema,
    surfaces: KNOWLEDGE,
    invoke: ({ query, limit }) => searchDocs(query, limit),
  }),
  defineTool({
    name: "get_doc_page",
    description:
      "Read full Confluence pages by the `id` or `url` printed by search_docs. " +
      "Pass the id or URL exactly. Up to 8 per call.",
    schema: z.object({
      paths: z
        .array(z.string())
        .min(1)
        .max(8)
        .describe(
          "Page ids or Confluence URLs from search_docs. Up to 8.",
        ),
    }),
    surfaces: KNOWLEDGE,
    invoke: ({ paths }) => getDocPage(paths),
  }),
  defineTool({
    name: "search_schema_docs",
    description:
      "Search indexed DDL documentation for background on tables and columns. " +
      "This is a documentation snapshot — for authoritative, current structure use describe_tables " +
      "and inspect_relationships instead.",
    schema: searchSchema,
    surfaces: KNOWLEDGE,
    invoke: ({ query, limit }) => searchSchemaDocs(query, limit),
  }),
] as const;
