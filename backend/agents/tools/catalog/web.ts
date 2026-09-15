import { z } from "zod";
import { presentDatetime } from "../core/datetime";
import { webSearch } from "../core/web";
import { orToolError } from "../errors";
import { defineTool } from "./types";

export const webTools = [
  defineTool({
    name: "get_present_datetime",
    description:
      "Return the actual present date, time, timezone, and calendar year. " +
      "Call this before web_search for latest/current facts so the query uses this year, " +
      "not a year from training data. Do not guess the current year.",
    schema: z.object({}),
    surfaces: ["langchain"],
    invoke: () => Promise.resolve(presentDatetime()),
  }),
  defineTool({
    name: "web_search",
    description:
      "Search the public web for current facts or news. " +
      "Call get_present_datetime first and put that year in the query — never a year from training data. " +
      "Do not use for this product's APIs, endpoints, or documentation — use search_docs instead. " +
      "Do not call this for greetings or small talk.",
    schema: z.object({
      query: z.string().describe("Search query including the current year from get_present_datetime"),
      limit: z.number().int().min(1).max(8).default(5),
    }),
    surfaces: ["langchain"],
    invoke: ({ query, limit }) =>
      orToolError("Web search", () => webSearch(query, limit)),
  }),
] as const;
