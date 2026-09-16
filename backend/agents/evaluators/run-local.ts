import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../../config";
import { asChatModel } from "../model";
import { runEvalTask, writeEvalResult, type EvalTaskResult } from "./eval-harness";
import { loadEvalTasks, RESULTS_ROOT, type EvalSuite } from "./task";

function argValue(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(flag);
  if (index >= 0) return argv[index + 1];
  const prefixed = argv.find((item) => item.startsWith(`${flag}=`));
  return prefixed?.slice(flag.length + 1);
}

function asSuite(value: string | undefined): EvalSuite | undefined {
  if (!value) return undefined;
  if (value === "conversational" || value === "coding") return value;
  throw new Error(`Unknown --suite ${value} (conversational|coding)`);
}

function lineFor(result: EvalTaskResult): string {
  const failed = result.scores
    .filter((score) => score.score !== true && score.score !== 1)
    .map((score) => score.key)
    .join(",");
  const mark = result.passed ? "PASS" : "FAIL";
  const detail = result.passed ? "" : `  ${failed}`;
  return `${mark.padEnd(4)}  ${result.id.padEnd(32)}${detail}`;
}

async function main() {
  const suite = asSuite(argValue("--suite"));
  const taskId = argValue("--task");
  const tasks = await loadEvalTasks({ suite, taskId });
  if (tasks.length === 0) {
    throw new Error("No eval tasks matched.");
  }

  const modelId = process.env.EVAL_MODEL || config.model.orchestrator;
  const judgeId = process.env.EVAL_JUDGE_MODEL || modelId;
  const codingId =
    process.env.EVAL_CODING_MODEL ||
    process.env.EVAL_MODEL ||
    config.model.execute;
  const model = await asChatModel(modelId);
  const judge = await asChatModel(judgeId);
  const codingModel =
    codingId === modelId ? model : await asChatModel(codingId);
  const runId =
    argValue("--run-id") ||
    new Date().toISOString().replace(/[:.]/g, "-");

  const results: EvalTaskResult[] = [];
  for (const task of tasks) {
    let result: EvalTaskResult;
    try {
      result = await runEvalTask(task, {
        model: task.suite === "coding" ? codingModel : model,
        judge,
        runId,
      });
    } catch (error) {
      result = {
        id: task.id,
        suite: task.suite,
        passed: false,
        scores: [
          {
            key: "error",
            score: false,
            comment: error instanceof Error ? error.message : String(error),
          },
        ],
        metrics: {},
        text: "",
        tools: [],
        transcript: "",
      };
    }
    await writeEvalResult(runId, result);
    results.push(result);
    console.log(lineFor(result));
  }

  const passed = results.filter((result) => result.passed).length;
  const summary = {
    runId,
    passed,
    total: results.length,
    tasks: results.map((result) => ({
      id: result.id,
      suite: result.suite,
      passed: result.passed,
      metrics: result.metrics,
    })),
  };
  await mkdir(path.join(RESULTS_ROOT, runId), { recursive: true });
  await writeFile(
    path.join(RESULTS_ROOT, runId, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(`${passed}/${results.length} passed  results/${runId}/`);
  if (passed < results.length) process.exitCode = 1;
}

await main();
