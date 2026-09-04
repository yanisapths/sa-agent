import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  buildModel,
  queryModel,
  recordDecision as recordDecisionCore,
  searchDecisions as searchDecisionsCore,
  simulate,
} from "./core/system-model";

export const buildSystemModel = tool(async () => buildModel(), {
  name: "build_system_model",
  description:
    "Scan this repository and rebuild the system model: files, imports, HTTP endpoints, " +
    "table access, tests, docs, and the live database schema, as a typed graph in .sa/system-model.db. " +
    "Run it once before the other system-model tools, and again after code changes. " +
    "Deterministic and free — it calls no model.",
  schema: z.object({}),
});

export const querySystemModel = tool(
  async ({ query, kind, limit }) => queryModel(query, kind, limit),
  {
    name: "query_system_model",
    description:
      "Look up a component in the system model and get what it depends on, what depends on it, " +
      "and any recorded decision about it. Accepts a class name, file path, table, `table.column`, " +
      "or `GET /path`. Pass `*` for an overview of the whole model. " +
      "Use this before designing a change, to find the real components involved.",
    schema: z.object({
      query: z
        .string()
        .describe("Component to look up, or `*` for an overview of the model"),
      kind: z
        .enum([
          "endpoint",
          "service",
          "repository",
          "component",
          "module",
          "test",
          "doc",
          "table",
          "column",
          "decision",
          "feature",
        ])
        .optional()
        .describe("Restrict matches to one node kind"),
      limit: z.number().int().min(1).max(15).default(5),
    }),
  },
);

export const simulateImpact = tool(
  async ({ target, depth }) => simulate(target, depth),
  {
    name: "simulate_impact",
    description:
      "Answer 'what breaks if I change this?'. Walks the dependency graph backwards from a table, " +
      "column, endpoint, service, or file and returns the affected APIs, services, frontend, tests, " +
      "and docs grouped by layer, plus a risk level with the reasons behind it and any decision " +
      "records that constrain the area. Use this before planning, and put the result in the plan.",
    schema: z.object({
      target: z
        .string()
        .describe("What is changing: `orders.user_id`, `OrderService`, `GET /orders`, or a file path"),
      depth: z
        .number()
        .int()
        .min(1)
        .max(8)
        .default(4)
        .describe("How many dependency hops to follow"),
    }),
  },
);

export const recordDecision = tool(
  async (input) => recordDecisionCore(input),
  {
    name: "record_decision",
    description:
      "Write down why an engineering choice was made, as a reviewable markdown record in " +
      ".sa/decisions/ that is linked into the system model. Use it when a choice has a rationale " +
      "the code cannot show — a denormalisation, a rejected alternative, a deliberate constraint. " +
      "Ask the human to confirm the reason; do not invent one.",
    schema: z.object({
      title: z.string().describe("One line, in the imperative: what was decided"),
      context: z.string().describe("The situation that forced a choice"),
      decision: z.string().describe("What was chosen"),
      reason: z.string().describe("Why this option, in the team's own words"),
      alternatives: z
        .string()
        .default("")
        .describe("What else was considered and why it lost"),
      consequences: z
        .string()
        .default("")
        .describe("What this commits the team to, including the downsides"),
      related: z
        .array(z.string())
        .default([])
        .describe("Nodes this constrains: table names, `table.column`, class names, `GET /path`"),
    }),
  },
);

export const searchDecisions = tool(
  async ({ query, limit }) => searchDecisionsCore(query, limit),
  {
    name: "search_decisions",
    description:
      "Search recorded engineering decisions for the reasoning behind an existing implementation. " +
      "Answers 'why is this like this?' where the graph and the schema only answer 'what' and 'where'. " +
      "Check this before proposing a change that contradicts a past choice.",
    schema: z.object({
      query: z.string().describe("Topic, table, component, or the question being asked"),
      limit: z.number().int().min(1).max(10).default(5),
    }),
  },
);
