import { z } from "zod";
import { webSearch } from "../core/web";
import { orToolError } from "../errors";
import { defineTool } from "./types";

export const webTools = [
  defineTool({
    name: "web_search",
    description:
      "Search the public web for current facts or news. " +
      "Do not use for this product's APIs, endpoints, or documentation — use search_docs instead. " +
      "Do not call this for greetings or small talk.",
    schema: z.object({
      query: z.string().describe("Search query"),
      limit: z.number().int().min(1).max(8).default(5),
    }),
    surfaces: ["langchain"],
    invoke: ({ query, limit }) =>
      orToolError("Web search", () => webSearch(query, limit)),
  }),
] as const;
