import { describe, expect, test } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "langchain";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEvalAgent, createUnitsAgent } from "./eval-agent";
import {
  forbiddenToolsEvaluator,
  harborReward,
  jsonContractEvaluator,
  lastAiText,
  llmJudgeEvaluator,
  requiredToolsEvaluator,
  runEvaluators,
  unitsUpdatedEvaluator,
} from "./evaluator";
import { withIsolatedSandbox } from "./sandbox";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

describe("evaluators", () => {
  test("json contract: accepts a chat-artifact reply", () => {
    const result = jsonContractEvaluator({
      outputs: {
        text: '{"type":"text","text":"The invoices table holds billing."}',
      },
    });
    expect(result.score).toBe(true);
  });

  test("json contract: rejects a bare string", () => {
    const result = jsonContractEvaluator({
      outputs: { text: "The invoices table holds billing." },
    });
    expect(result.score).toBe(false);
  });

  test("required tools: fails when the agent skips search_docs", () => {
    const result = requiredToolsEvaluator(["search_docs"])({
      outputs: { messages: [new AIMessage("skipping tools")] },
    });
    expect(result.score).toBe(false);
  });

  test("agent: grounded JSON reply uses search_docs and never run_sql", async () => {
    const model = fakeModel()
      .respondWithTools([
        { name: "search_docs", args: { query: "billing" }, id: "call_1" },
      ])
      .respond(
        new AIMessage(
          '{"type":"text","text":"Billing uses the invoices table."}',
        ),
      );
    const agent = createEvalAgent(model);

    const result = await agent.invoke({
      messages: [{ role: "user", content: "Which table stores billing?" }],
    });

    const scores = await runEvaluators(
      [
        jsonContractEvaluator,
        requiredToolsEvaluator(["search_docs"]),
        forbiddenToolsEvaluator(["run_sql"]),
        llmJudgeEvaluator(fakeModel().respond(new AIMessage("1"))),
      ],
      {
        outputs: {
          messages: result.messages,
          text: lastAiText(result.messages),
        },
        referenceOutputs: { table: "invoices" },
      },
    );

    expect(lastAiText(result.messages)).toContain("invoices");
    expect(harborReward(scores)).toBe(1);
    expect(model.callCount).toBe(2);
  });

  test("sandboxes A and B update units in isolation", async () => {
    const trials = [
      { name: "A", product: "Widget A", units: 50 },
      { name: "B", product: "Widget B", units: 7 },
    ];

    const rewards = await Promise.all(
      trials.map((trial) =>
        withIsolatedSandbox(
          { name: trial.name, fixtureDir: FIXTURES },
          async (sandbox) => {
            const model = fakeModel()
              .respondWithTools([
                {
                  name: "update_units",
                  args: { product: trial.product, units: trial.units },
                  id: `call_${trial.name}`,
                },
              ])
              .respond(
                new AIMessage(
                  `{"type":"text","text":"Updated ${trial.product} to ${trial.units} units."}`,
                ),
              );
            const agent = createUnitsAgent(sandbox, model);
            const result = await agent.invoke({
              messages: [
                {
                  role: "user",
                  content: `Set ${trial.product} Units Sold to ${trial.units} and recalculate Revenue.`,
                },
              ],
            });

            const csv = await sandbox.readText("sales.csv");
            const scores = await runEvaluators(
              [
                jsonContractEvaluator,
                requiredToolsEvaluator(["update_units"]),
              ],
              { outputs: { messages: result.messages } },
            );
            const file = unitsUpdatedEvaluator({
              csv,
              product: trial.product,
              units: trial.units,
            });
            const other =
              trial.product === "Widget A"
                ? unitsUpdatedEvaluator({ csv, product: "Widget B", units: 4 })
                : unitsUpdatedEvaluator({ csv, product: "Widget A", units: 10 });

            return harborReward([...scores, file, other]);
          },
        ),
      ),
    );

    expect(rewards).toEqual([1, 1]);
  });
});
