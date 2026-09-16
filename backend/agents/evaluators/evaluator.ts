/**
 * Evaluators for this agent. Score trajectories, the JSON chat contract,
 * and isolated workspace state.
 *
 * bun test agents/evaluators/evaluator.test.ts
 * bun test agents/evaluators/eval-local.test.ts
 * bun run eval:local                   Isolated local suite (chat + slim coding)
 * bun run eval                         Vitest + LangSmith
 */
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { chatArtifactSchema } from "../../contract/chat-response";
import { formatTree, isTextFile } from "../../internal/workspace/fs";
import {
  isIgnoredDirName,
  resolveInsideRoot,
  WorkspacePathError,
} from "../../internal/workspace/paths";

export interface EvaluationResult {
  key: string;
  score: number | boolean;
  comment?: string;
}

export interface AgentEvalToolCall {
  name?: string;
  args?: unknown;
  arguments?: unknown;
}

export interface AgentEvalOutputs {
  messages?: Array<{
    content?: unknown;
    type?: string;
    name?: string;
    _getType?: () => string;
    tool_calls?: AgentEvalToolCall[];
    usage_metadata?: {
      total_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
  }>;
  text?: string;
  workspace?: string;
  fixtureDir?: string;
}

export interface AgentEvalParams {
  outputs: AgentEvalOutputs;
  referenceOutputs?: Record<string, unknown>;
}

export type Evaluator = (
  params: AgentEvalParams,
) => EvaluationResult | Promise<EvaluationResult>;

export const JUDGE_SECTION_LIMIT = 20_000;

export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block === "object" && "text" in block) {
        const text = (block as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("");
}

export function lastAiText(messages: AgentEvalOutputs["messages"] = []): string {
  const last = messages.at(-1);
  return messageText(last?.content);
}

export function messageRole(message: {
  type?: string;
  _getType?: () => string;
}): string {
  if (typeof message._getType === "function") return message._getType();
  return message.type ?? "";
}

function clip(text: string, max = JUDGE_SECTION_LIMIT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated]`;
}

function toolCallDump(call: AgentEvalToolCall): string {
  const args = call.args ?? call.arguments ?? {};
  let dumped: string;
  try {
    dumped = JSON.stringify(args);
  } catch {
    dumped = String(args);
  }
  return `${call.name ?? "tool"}(${clip(dumped, 4000)})`;
}

export function transcriptFromMessages(
  messages: AgentEvalOutputs["messages"] = [],
): string {
  return messages
    .map((message) => {
      const role = messageRole(message);
      const calls = message.tool_calls ?? [];
      const tools = calls.map(toolCallDump).join("; ");
      const body = messageText(message.content);
      const name =
        "name" in message && typeof message.name === "string"
          ? `:${message.name}`
          : "";
      const toolBit = tools ? ` tools=${tools}` : "";
      return `${role}${name}${toolBit}: ${body}`.trim();
    })
    .join("\n\n");
}

export function countHumanTurns(
  messages: AgentEvalOutputs["messages"] = [],
): number {
  return messages.filter((message) => messageRole(message) === "human").length;
}

export function totalTokensFromMessages(
  messages: AgentEvalOutputs["messages"] = [],
): number {
  return messages.reduce((sum, message) => {
    const usage =
      "usage_metadata" in message
        ? (message.usage_metadata as
            | {
                total_tokens?: number;
                input_tokens?: number;
                output_tokens?: number;
              }
            | undefined)
        : undefined;
    if (!usage) return sum;
    if (typeof usage.total_tokens === "number") return sum + usage.total_tokens;
    return sum + (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
  }, 0);
}

export function toolNamesFromMessages(
  messages: AgentEvalOutputs["messages"] = [],
): string[] {
  return messages.flatMap((message) =>
    (message.tool_calls ?? []).flatMap((call) => (call.name ? [call.name] : [])),
  );
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  return JSON.parse(candidate);
}

/**
 * Code evaluator — sa-agent / chat-agent must emit one chat-contract JSON object.
 */
export function jsonContractEvaluator(params: AgentEvalParams): EvaluationResult {
  const text = params.outputs.text ?? lastAiText(params.outputs.messages);
  try {
    const parsed = chatArtifactSchema.safeParse(extractJsonObject(text));
    return {
      key: "json_contract",
      score: parsed.success,
      comment: parsed.success ? undefined : parsed.error.message,
    };
  } catch (error) {
    return {
      key: "json_contract",
      score: false,
      comment: error instanceof Error ? error.message : "invalid json",
    };
  }
}

/**
 * Code evaluator — the trajectory must include every required tool.
 */
export function requiredToolsEvaluator(required: readonly string[]): Evaluator {
  return (params) => {
    const called = new Set(toolNamesFromMessages(params.outputs.messages));
    const missing = required.filter((name) => !called.has(name));
    return {
      key: "required_tools",
      score: missing.length === 0,
      comment: missing.length ? `missing: ${missing.join(", ")}` : undefined,
    };
  };
}

/**
 * Code evaluator — the trajectory must not call forbidden tools.
 */
export function forbiddenToolsEvaluator(forbidden: readonly string[]): Evaluator {
  return (params) => {
    const called = toolNamesFromMessages(params.outputs.messages);
    const hits = called.filter((name) => forbidden.includes(name));
    return {
      key: "forbidden_tools",
      score: hits.length === 0,
      comment: hits.length ? `called: ${[...new Set(hits)].join(", ")}` : undefined,
    };
  };
}

export interface SalesRow {
  product: string;
  units: number;
  unitPrice: number;
  revenue: number;
}

export function parseSalesCsv(text: string): SalesRow[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  if (!header) return [];
  const cols = header.split(",").map((col) => col.trim());
  const index = {
    product: cols.findIndex((col) => /product/i.test(col)),
    units: cols.findIndex((col) => /units/i.test(col)),
    unitPrice: cols.findIndex((col) => /price/i.test(col)),
    revenue: cols.findIndex((col) => /revenue/i.test(col)),
  };

  return lines.filter(Boolean).map((line) => {
    const cells = line.split(",").map((cell) => cell.trim());
    return {
      product: cells[index.product] ?? "",
      units: Number(cells[index.units]),
      unitPrice: Number(cells[index.unitPrice]),
      revenue: Number(cells[index.revenue]),
    };
  });
}

export function formatSalesCsv(rows: SalesRow[]): string {
  const lines = [
    "Product,Units Sold,Unit Price,Revenue",
    ...rows.map(
      (row) =>
        `${row.product},${row.units},${row.unitPrice},${row.revenue}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}

export function applyUnitsUpdate(
  csv: string,
  product: string,
  units: number,
): string {
  const rows = parseSalesCsv(csv).map((row) => {
    if (row.product !== product) return row;
    return { ...row, units, revenue: units * row.unitPrice };
  });
  return formatSalesCsv(rows);
}

/**
 * Code evaluator — isolated workspace CSV matches the expected product units.
 */
export function unitsUpdatedEvaluator(params: {
  csv: string;
  product: string;
  units: number;
}): EvaluationResult {
  const row = parseSalesCsv(params.csv).find(
    (candidate) => candidate.product === params.product,
  );
  if (!row) {
    return {
      key: "units_updated",
      score: false,
      comment: `missing product ${params.product}`,
    };
  }

  const expectedRevenue = params.units * row.unitPrice;
  const ok =
    row.units === params.units &&
    Math.abs(row.revenue - expectedRevenue) < 1e-6;

  return {
    key: "units_updated",
    score: ok,
    comment: ok
      ? undefined
      : `${params.product} units=${row.units} revenue=${row.revenue}, expected units=${params.units} revenue=${expectedRevenue}`,
  };
}

function canonicalRoot(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    return path.resolve(root);
  }
}

export function unitsUpdatedWorkspaceEvaluator(options: {
  product: string;
  units: number;
  file?: string;
}): Evaluator {
  return async (params) => {
    const root = params.outputs.workspace
      ? canonicalRoot(params.outputs.workspace)
      : undefined;
    const rel = options.file ?? "sales.csv";
    if (!root) {
      return {
        key: "units_updated",
        score: false,
        comment: "missing workspace",
      };
    }
    try {
      const abs = resolveInsideRoot(root, rel, true);
      const csv = await readFile(abs, "utf8");
      return unitsUpdatedEvaluator({
        csv,
        product: options.product,
        units: options.units,
      });
    } catch (error) {
      const comment =
        error instanceof WorkspacePathError
          ? error.message
          : `missing file ${rel}`;
      return { key: "units_updated", score: false, comment };
    }
  };
}

function collectFiles(root: string): string[] {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name === "." || name === "..") continue;
      const abs = path.join(dir, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (isIgnoredDirName(name)) continue;
        stack.push(abs);
        continue;
      }
      if (st.isFile() && isTextFile(name)) {
        files.push(path.relative(root, abs).split(path.sep).join("/"));
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function readTextFile(root: string, rel: string): string | undefined {
  try {
    return readFileSync(path.join(root, rel), "utf8");
  } catch {
    return undefined;
  }
}

function fileHunk(rel: string, before: string | undefined, after: string | undefined): string {
  if (before === after) return "";
  const oldBody = before ?? "";
  const newBody = after ?? "";
  const oldLines = oldBody.split("\n");
  const newLines = newBody.split("\n");
  const header = `--- a/${rel}\n+++ b/${rel}`;
  const removed = oldLines.map((line) => `-${line}`).join("\n");
  const added = newLines.map((line) => `+${line}`).join("\n");
  return `${header}\n${removed}\n${added}`;
}

export function workspaceDiff(fixtureDir: string, workspace: string): string {
  const beforeFiles = new Set(collectFiles(fixtureDir));
  const afterFiles = new Set(collectFiles(workspace));
  const rels = [...new Set([...beforeFiles, ...afterFiles])].sort((a, b) =>
    a.localeCompare(b),
  );
  const hunks: string[] = [];
  for (const rel of rels) {
    const hunk = fileHunk(
      rel,
      beforeFiles.has(rel) ? readTextFile(fixtureDir, rel) : undefined,
      afterFiles.has(rel) ? readTextFile(workspace, rel) : undefined,
    );
    if (hunk) hunks.push(hunk);
  }
  return hunks.join("\n\n");
}

export function judgeActual(outputs: AgentEvalOutputs): string {
  const sections = [
    "TRANSCRIPT:",
    clip(transcriptFromMessages(outputs.messages)),
  ];
  if (outputs.workspace) {
    const workspace = canonicalRoot(outputs.workspace);
    try {
      sections.push("FILES:", clip(formatTree(workspace, ".", 4), 4000));
    } catch (error) {
      sections.push(
        "FILES:",
        error instanceof Error ? error.message : "could not list workspace",
      );
    }
    if (outputs.fixtureDir) {
      sections.push(
        "WORKSPACE DIFF:",
        clip(
          workspaceDiff(canonicalRoot(outputs.fixtureDir), workspace) ||
            "(no changes)",
        ),
      );
    }
  }
  return sections.join("\n\n");
}

/** First whitespace token must be 1/PASS (true) or anything else (false). */
export function scoreJudgeVerdict(content: unknown): boolean {
  const first = messageText(content).trim().split(/\s+/)[0] ?? "";
  const token = first.replace(/[:.,;]+$/g, "").toUpperCase();
  return token === "1" || token === "PASS";
}

/**
 * Model-based evaluator — judge returns 1/PASS or 0/FAIL (same pattern as the
 * after-agent safety guardrail).
 */
export function llmJudgeEvaluator(
  judge: BaseChatModel,
  options?: { key?: string; rubric?: string },
): Evaluator {
  const key = options?.key ?? "judge";
  const rubric =
    options?.rubric ??
    "Score whether the ACTUAL answer satisfies the EXPECTED outcome. Respond with only 1 or 0.";

  return async (params) => {
    const actual = judgeActual(params.outputs);
    const expected = JSON.stringify(params.referenceOutputs ?? {});
    const verdict = await judge.invoke([
      {
        role: "user",
        content: `${rubric}

EXPECTED: ${expected}
ACTUAL: ${actual}`,
      },
    ]);

    return {
      key,
      score: scoreJudgeVerdict(verdict.content),
      comment: messageText(verdict.content).trim(),
    };
  };
}

/** One LLM-as-judge call per assertion, so rubrics stay calibratable. */
export function llmAssertionEvaluator(
  judge: BaseChatModel,
  assertion: string,
  options?: { key?: string; preamble?: string },
): Evaluator {
  const preamble =
    options?.preamble ??
    "Score whether the ACTUAL transcript satisfies the assertion. Respond with only 1 or 0, then a one-line comment.";
  return llmJudgeEvaluator(judge, {
    key: options?.key ?? slugKey(assertion),
    rubric: `${preamble}

Assertion: ${assertion}`,
  });
}

export function maxTurnsEvaluator(max: number): Evaluator {
  return (params) => {
    const turns = countHumanTurns(params.outputs.messages);
    return {
      key: "max_turns",
      score: turns <= max,
      comment: turns <= max ? undefined : `turns=${turns} max=${max}`,
    };
  };
}

export function deterministicTestsEvaluator(options: {
  command: string;
  cwd: string;
  env?: Record<string, string>;
}): Evaluator {
  return async () => {
    const args = options.command.trim().split(/\s+/);
    const proc = Bun.spawn(args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const exit = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const log = `${stdout}${stderr}`.trim();
    return {
      key: "deterministic_tests",
      score: exit === 0,
      comment: exit === 0 ? undefined : log.slice(0, 2000),
    };
  };
}

function slugKey(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return slug ? `rubric_${slug}` : "rubric";
}

export async function runEvaluators(
  evaluators: readonly Evaluator[],
  params: AgentEvalParams,
): Promise<EvaluationResult[]> {
  const results: EvaluationResult[] = [];
  for (const evaluator of evaluators) {
    results.push(await evaluator(params));
  }
  return results;
}

/** All-pass reward: 1 only when every evaluator passed. */
export function harborReward(results: readonly EvaluationResult[]): number {
  return results.every((result) => result.score === true || result.score === 1)
    ? 1
    : 0;
}

export function writeHarborRewardTxt(score: number): string {
  return `${score}\n`;
}
