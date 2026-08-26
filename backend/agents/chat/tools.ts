import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { vectorStore, ddlStore } from "../../database/chromadb";

const apiRetriever = vectorStore.asRetriever({ k: 5 });
const ddlRetriever = ddlStore.asRetriever({ k: 5 });

export const apiSpecTool = tool(
  async ({ query }) => {
    const docs = await apiRetriever.invoke(query);
    return docs.map((d) => d.pageContent).join("\n\n");
  },
  {
    name: "search_api_specs",
    description: `Use this when the user asks about API endpoints, request/response structure,
    HTTP methods, or how to call a service. Searches the Confluence API specification docs.`,
    schema: z.object({
      query: z.string().describe("The search query to find relevant API specs"),
    }),
  },
);

export const ddlTool = tool(
  async ({ query }) => {
    const docs = await ddlRetriever.invoke(query);
    return docs.map((d) => d.pageContent).join("\n\n");
  },
  {
    name: "search_database_schema",
    description: `Use this when the user asks about database tables, columns, relationships,
    foreign keys, or needs to write a SQL query. Searches the database DDL and schema docs.`,
    schema: z.object({
      query: z
        .string()
        .describe("The search query to find relevant table schemas"),
    }),
  },
);
