import { tool } from "@langchain/core/tools";
import { createAgent, fakeModel } from "langchain";
import { z } from "zod";
import { CHAT_JSON_CONTRACT } from "../../contract/chat-response";
import { applyUnitsUpdate } from "./evaluator";
import type { IsolatedSandbox } from "./sandbox";

const searchDocs = tool(
  async ({ query }: { query: string }) =>
    `docs hit for "${query}": billing uses the invoices table.`,
  {
    name: "search_docs",
    description: "Search this product's docs",
    schema: z.object({ query: z.string() }),
  },
);

const runSql = tool(
  async ({ sql }: { sql: string }) => `ran: ${sql}`,
  {
    name: "run_sql",
    description: "Run SQL against the live database",
    schema: z.object({ sql: z.string() }),
  },
);

/** Sample chat-shaped agent for evaluator demos. Not the production graph. */
export function createEvalAgent(model: ReturnType<typeof fakeModel>) {
  return createAgent({
    name: "sa-eval",
    model,
    tools: [searchDocs, runSql],
    systemPrompt: `You are a concise chat assistant. Ground company answers in tools. ${CHAT_JSON_CONTRACT}`,
  });
}

export function createUnitsAgent(
  sandbox: IsolatedSandbox,
  model: ReturnType<typeof fakeModel>,
) {
  const updateUnits = tool(
    async ({ product, units }: { product: string; units: number }) => {
      const csv = await sandbox.readText("sales.csv");
      await sandbox.writeText("sales.csv", applyUnitsUpdate(csv, product, units));
      return `updated ${product} units to ${units}`;
    },
    {
      name: "update_units",
      description: "Set Units Sold for a product and recalculate Revenue",
      schema: z.object({ product: z.string(), units: z.number() }),
    },
  );

  return createAgent({
    name: "sa-eval-units",
    model,
    tools: [updateUnits],
    systemPrompt: `Update sales.csv with the update_units tool, then reply with JSON. ${CHAT_JSON_CONTRACT}`,
  });
}
