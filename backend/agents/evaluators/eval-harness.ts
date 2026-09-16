import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { buildChatAgent } from "../chat-agent";
import type { AgentModel } from "../builder";
import { chatFixtureTools } from "./chat-fixtures";
import { createCodingEvalAgent } from "./coding-agent";
import {
  countHumanTurns,
  deterministicTestsEvaluator,
  forbiddenToolsEvaluator,
  harborReward,
  jsonContractEvaluator,
  lastAiText,
  llmAssertionEvaluator,
  maxTurnsEvaluator,
  requiredToolsEvaluator,
  runEvaluators,
  totalTokensFromMessages,
  toolNamesFromMessages,
  transcriptFromMessages,
  unitsUpdatedWorkspaceEvaluator,
  type AgentEvalOutputs,
  type EvaluationResult,
  type Evaluator,
} from "./evaluator";
import { withIsolatedSandbox } from "./sandbox";
import {
  FIXTURES_ROOT,
  RUBRICS_ROOT,
  RESULTS_ROOT,
  taskMessages,
  type EvalTask,
  type GraderSpec,
} from "./task";

export interface EvalRunOptions {
  model: AgentModel;
  judge?: BaseChatModel;
  runId?: string;
}

export interface EvalTaskResult {
  id: string;
  suite: EvalTask["suite"];
  passed: boolean;
  scores: EvaluationResult[];
  metrics: Record<string, number>;
  text: string;
  tools: string[];
  transcript: string;
}

async function invokeTurns(agent: unknown, turns: string[]) {
  const invoke = (
    agent as {
      invoke: (input: unknown) => Promise<{
        messages?: AgentEvalOutputs["messages"];
      }>;
    }
  ).invoke.bind(agent);
  let messages: unknown[] = [{ role: "user", content: turns[0] }];
  let result: { messages?: AgentEvalOutputs["messages"] } | undefined;
  for (let i = 0; i < turns.length; i++) {
    if (i > 0) {
      messages = [
        ...(result?.messages ?? []),
        { role: "user", content: turns[i] },
      ];
    }
    result = await invoke({ messages });
  }
  if (!result) throw new Error("eval invoke produced no result");
  return result;
}

function outputsOf(
  messages: AgentEvalOutputs["messages"],
  workspace?: string,
  fixtureDir?: string,
): AgentEvalOutputs {
  return {
    messages,
    text: lastAiText(messages),
    workspace,
    fixtureDir,
  };
}

async function gradersFor(
  task: EvalTask,
  options: EvalRunOptions,
  sandboxRoot?: string,
): Promise<Evaluator[]> {
  const rubricPreamble = await readFile(
    path.join(RUBRICS_ROOT, task.suite === "coding" ? "code-quality.md" : "chat.md"),
    "utf8",
  ).catch(() => undefined);

  const built: Evaluator[] = [];
  for (const grader of task.graders) {
    built.push(...(await expandGrader(grader, task, options, sandboxRoot, rubricPreamble)));
  }
  if (task.max_turns !== undefined) {
    built.push(maxTurnsEvaluator(task.max_turns));
  }
  return built;
}

async function expandGrader(
  grader: GraderSpec,
  task: EvalTask,
  options: EvalRunOptions,
  sandboxRoot: string | undefined,
  preamble: string | undefined,
): Promise<Evaluator[]> {
  switch (grader.type) {
    case "json_contract":
      return [jsonContractEvaluator];
    case "required_tools":
      return [requiredToolsEvaluator(grader.names)];
    case "forbidden_tools":
      return [forbiddenToolsEvaluator(grader.names)];
    case "max_turns":
      return [maxTurnsEvaluator(grader.max)];
    case "llm_rubric": {
      if (!options.judge) {
        throw new Error(`Task ${task.id} needs a judge model for llm_rubric`);
      }
      return grader.assertions.map((assertion) =>
        llmAssertionEvaluator(options.judge!, assertion, {
          preamble: grader.preamble ?? preamble,
        }),
      );
    }
    case "deterministic_tests": {
      if (!sandboxRoot) {
        throw new Error(`Task ${task.id} deterministic_tests needs a coding fixture`);
      }
      const fixtureRoot = task.fixture
        ? path.dirname(path.join(FIXTURES_ROOT, task.fixture))
        : FIXTURES_ROOT;
      return [
        deterministicTestsEvaluator({
          command: grader.command,
          cwd: fixtureRoot,
          env: { EVAL_WORKSPACE: sandboxRoot },
        }),
      ];
    }
    case "units_updated": {
      if (!sandboxRoot) {
        throw new Error(`Task ${task.id} units_updated needs a coding fixture`);
      }
      return [
        unitsUpdatedWorkspaceEvaluator({
          product: grader.product,
          units: grader.units,
          file: grader.file,
        }),
      ];
    }
  }
}

function metricsOf(
  task: EvalTask,
  messages: AgentEvalOutputs["messages"],
): Record<string, number> {
  const wanted = new Set(
    task.tracked_metrics ?? ["n_turns", "n_toolcalls", "n_total_tokens"],
  );
  const all = {
    n_turns: countHumanTurns(messages),
    n_toolcalls: toolNamesFromMessages(messages).length,
    n_total_tokens: totalTokensFromMessages(messages),
  };
  return Object.fromEntries(
    Object.entries(all).filter(([key]) => wanted.has(key)),
  );
}

async function runConversational(
  task: EvalTask,
  options: EvalRunOptions,
): Promise<EvalTaskResult> {
  const agent = buildChatAgent({
    model: options.model,
    tools: chatFixtureTools(),
    session: false,
  });
  const result = await invokeTurns(agent, taskMessages(task));
  const outputs = outputsOf(result.messages);
  const scores = await runEvaluators(
    await gradersFor(task, options),
    { outputs, referenceOutputs: task.reference },
  );
  return pack(task, outputs, scores);
}

async function runCoding(
  task: EvalTask,
  options: EvalRunOptions,
): Promise<EvalTaskResult> {
  if (!task.fixture) {
    throw new Error(`Coding task ${task.id} needs fixture`);
  }
  const fixtureDir = path.join(FIXTURES_ROOT, task.fixture);
  return withIsolatedSandbox(
    { name: task.id, fixtureDir },
    async (sandbox) => {
      const agent = createCodingEvalAgent(options.model, sandbox);
      const result = await invokeTurns(agent, taskMessages(task));
      const outputs = outputsOf(result.messages, sandbox.root, fixtureDir);
      const scores = await runEvaluators(
        await gradersFor(task, options, sandbox.root),
        { outputs, referenceOutputs: task.reference },
      );
      return pack(task, outputs, scores);
    },
  );
}

function pack(
  task: EvalTask,
  outputs: AgentEvalOutputs,
  scores: EvaluationResult[],
): EvalTaskResult {
  return {
    id: task.id,
    suite: task.suite,
    passed: harborReward(scores) === 1,
    scores,
    metrics: metricsOf(task, outputs.messages),
    text: outputs.text ?? "",
    tools: toolNamesFromMessages(outputs.messages),
    transcript: transcriptFromMessages(outputs.messages),
  };
}

export async function runEvalTask(
  task: EvalTask,
  options: EvalRunOptions,
): Promise<EvalTaskResult> {
  return task.suite === "coding"
    ? runCoding(task, options)
    : runConversational(task, options);
}

export async function writeEvalResult(
  runId: string,
  result: EvalTaskResult,
): Promise<string> {
  const dir = path.join(RESULTS_ROOT, runId);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${result.id}.json`);
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`);
  return file;
}
