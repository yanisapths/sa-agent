import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  getDocPage as getDocPageCore,
  searchDocs as searchDocsCore,
  searchSchemaDocs as searchSchemaDocsCore,
} from "./core/knowledge";

export const searchDocs = tool(
  async ({ query, limit }) => searchDocsCore(query, limit),
  {
    name: "search_docs",
    description:
      "Scan Aster documentation (Mintlify) for API contracts, endpoints, auth, " +
      "and conventions. Returns titles, paths, and short snippets only — never answer " +
      "from snippets. Follow up with get_doc_page on the 1–3 paths that match. " +
      "If results are ambiguous, search again with a narrower term (budget 4–6 docs calls).",
    schema: z.object({
      query: z.string().describe("What to look for"),
      limit: z.number().int().min(1).max(10).default(5),
    }),
  },
);

export const getDocPage = tool(
  async ({ paths }) => getDocPageCore(paths),
  {
    name: "get_doc_page",
    description:
      "Read full Mintlify documentation pages by the `path` field from search_docs. " +
      "Pass the slug exactly (e.g. aster-admin/orch-admin-service/voting/overview) — " +
      "no leading slash. Do not request mintlify.site URLs. Max 3 paths per call.",
    schema: z.object({
      paths: z
        .array(z.string())
        .min(1)
        .max(3)
        .describe(
          "Exact search_docs path slugs, e.g. aster-admin/orch-admin-service/voting/overview",
        ),
    }),
  },
);

export const searchSchemaDocs = tool(
  async ({ query, limit }) => searchSchemaDocsCore(query, limit),
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
