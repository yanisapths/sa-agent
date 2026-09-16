import * as ls from "langsmith/vitest";
import { expect } from "vitest";
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
  unitsUpdatedEvaluator,
} from "./evaluator";
import { withIsolatedSandbox } from "./sandbox";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

ls.describe("sa-agent evaluators", () => {
  ls.test(
    "grounded chat reply uses search_docs and the JSON contract",
    {
      inputs: { query: "Which table stores billing?" },
      referenceOutputs: { table: "invoices" },
    },
    async ({ inputs, referenceOutputs }) => {
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
        messages: [{ role: "user", content: inputs.query }],
      });
      const outputs = {
        messages: result.messages,
        text: lastAiText(result.messages),
      };

      ls.logOutputs({ text: outputs.text });

      const contract = ls.wrapEvaluator(jsonContractEvaluator);
      const tools = ls.wrapEvaluator(requiredToolsEvaluator(["search_docs"]));
      const forbidden = ls.wrapEvaluator(forbiddenToolsEvaluator(["run_sql"]));
      const judge = ls.wrapEvaluator(
        llmJudgeEvaluator(fakeModel().respond(new AIMessage("1")), {
          key: "grounded",
        }),
      );

      const scores = await Promise.all([
        contract({ outputs, referenceOutputs }),
        tools({ outputs, referenceOutputs }),
        forbidden({ outputs, referenceOutputs }),
        judge({ outputs, referenceOutputs }),
      ]);

      expect(harborReward(scores)).toBe(1);
      expect(outputs.text).toContain("invoices");
    },
  );

  ls.test.concurrent.each([
    { inputs: { name: "A", product: "Widget A", units: 50 } },
    { inputs: { name: "B", product: "Widget B", units: 7 } },
  ])(
    "isolated sandbox updates units without cross-contamination",
    async ({ inputs }) => {
      const reward = await withIsolatedSandbox(
        { name: inputs.name, fixtureDir: FIXTURES },
        async (sandbox) => {
          const model = fakeModel()
            .respondWithTools([
              {
                name: "update_units",
                args: { product: inputs.product, units: inputs.units },
                id: `call_${inputs.name}`,
              },
            ])
            .respond(
              new AIMessage(
                `{"type":"text","text":"Updated ${inputs.product} to ${inputs.units} units."}`,
              ),
            );
          const agent = createUnitsAgent(sandbox, model);
          const result = await agent.invoke({
            messages: [
              {
                role: "user",
                content: `Set ${inputs.product} Units Sold to ${inputs.units} and recalculate Revenue.`,
              },
            ],
          });
          const csv = await sandbox.readText("sales.csv");
          const file = unitsUpdatedEvaluator({
            csv,
            product: inputs.product,
            units: inputs.units,
          });
          ls.logFeedback(file);
          ls.logOutputs({ csv, text: lastAiText(result.messages) });
          expect(file.score).toBe(true);
          return file;
        },
      );

      expect(reward.score).toBe(true);
    },
  );
});
