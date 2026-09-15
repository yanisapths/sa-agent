/**
 * Evaluators for this agent. Score trajectories, the JSON chat contract,
 * and isolated workspace state.
 *
 * bun test agents/evaluators/evaluator.test.ts
 * bun run eval                         Vitest + LangSmith
 * bun run eval:harbor                  Harbor, Docker, oracle (verifier check)
 * bun run eval:harbor:langsmith        Harbor on LangSmith Cloud MicroVMs
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { chatArtifactSchema } from "../../contract/chat-response";

export interface EvaluationResult {
  key: string;
  score: number | boolean;
  comment?: string;
}

export interface AgentEvalOutputs {
  messages?: Array<{
    content?: unknown;
    tool_calls?: Array<{ name?: string }>;
  }>;
  text?: string;
  workspace?: string;
}

export interface AgentEvalParams {
  outputs: AgentEvalOutputs;
  referenceOutputs?: Record<string, unknown>;
}

export type Evaluator = (
  params: AgentEvalParams,
) => EvaluationResult | Promise<EvaluationResult>;

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
    const actual = params.outputs.text ?? lastAiText(params.outputs.messages);
    const expected = JSON.stringify(params.referenceOutputs ?? {});
    const verdict = await judge.invoke([
      {
        role: "user",
        content: `${rubric}

EXPECTED: ${expected}
ACTUAL: ${actual}`,
      },
    ]);

    const text = messageText(verdict.content).trim().toUpperCase();
    const score = text.includes("1") || text.includes("PASS");
    return { key, score, comment: messageText(verdict.content).trim() };
  };
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

/** Harbor reward: 1 only when every evaluator passed. */
export function harborReward(results: readonly EvaluationResult[]): number {
  return results.every((result) => result.score === true || result.score === 1)
    ? 1
    : 0;
}

export function writeHarborRewardTxt(score: number): string {
  return `${score}\n`;
}
