import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EVALUATORS_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const SUITES_ROOT = path.join(EVALUATORS_ROOT, "suites");
export const FIXTURES_ROOT = path.join(EVALUATORS_ROOT, "fixtures");
export const RUBRICS_ROOT = path.join(EVALUATORS_ROOT, "rubrics");
export const RESULTS_ROOT = path.join(EVALUATORS_ROOT, "results");

export type EvalSuite = "conversational" | "coding";

export type GraderSpec =
  | { type: "json_contract" }
  | { type: "llm_rubric"; assertions: string[]; preamble?: string }
  | { type: "required_tools"; names: string[] }
  | { type: "forbidden_tools"; names: string[] }
  | { type: "deterministic_tests"; command: string }
  | { type: "units_updated"; product: string; units: number; file?: string }
  | { type: "max_turns"; max: number };

export interface EvalTask {
  id: string;
  suite: EvalSuite;
  prompt?: string;
  messages?: string[];
  graders: GraderSpec[];
  tracked_metrics?: string[];
  fixture?: string;
  max_turns?: number;
  reference?: Record<string, unknown>;
  source: string;
}

export function taskMessages(task: EvalTask): string[] {
  if (task.messages?.length) return task.messages;
  if (task.prompt?.trim()) return [task.prompt];
  throw new Error(`Task ${task.id} has no prompt or messages`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be a string array`);
  }
  return value;
}

function parseGrader(raw: unknown, taskId: string): GraderSpec {
  if (!isRecord(raw) || typeof raw.type !== "string") {
    throw new Error(`Task ${taskId} has an invalid grader`);
  }
  switch (raw.type) {
    case "json_contract":
      return { type: "json_contract" };
    case "llm_rubric":
      return {
        type: "llm_rubric",
        assertions: asStringArray(raw.assertions, `${taskId} llm_rubric.assertions`),
        preamble: typeof raw.preamble === "string" ? raw.preamble : undefined,
      };
    case "required_tools":
      return {
        type: "required_tools",
        names: asStringArray(raw.names, `${taskId} required_tools.names`),
      };
    case "forbidden_tools":
      return {
        type: "forbidden_tools",
        names: asStringArray(raw.names, `${taskId} forbidden_tools.names`),
      };
    case "deterministic_tests":
      if (typeof raw.command !== "string" || !raw.command.trim()) {
        throw new Error(`Task ${taskId} deterministic_tests needs command`);
      }
      return { type: "deterministic_tests", command: raw.command };
    case "units_updated":
      if (typeof raw.product !== "string" || typeof raw.units !== "number") {
        throw new Error(`Task ${taskId} units_updated needs product and units`);
      }
      return {
        type: "units_updated",
        product: raw.product,
        units: raw.units,
        file: typeof raw.file === "string" ? raw.file : undefined,
      };
    case "max_turns":
      if (typeof raw.max !== "number") {
        throw new Error(`Task ${taskId} max_turns needs max`);
      }
      return { type: "max_turns", max: raw.max };
    default:
      throw new Error(`Task ${taskId} unknown grader type ${raw.type}`);
  }
}

function parseTask(raw: unknown, source: string): EvalTask {
  if (!isRecord(raw)) throw new Error(`Invalid task file ${source}`);
  if (typeof raw.id !== "string" || !raw.id.trim()) {
    throw new Error(`${source} is missing id`);
  }
  const id = raw.id;
  if (raw.suite !== "conversational" && raw.suite !== "coding") {
    throw new Error(`${source} suite must be conversational or coding`);
  }
  if (!Array.isArray(raw.graders) || raw.graders.length === 0) {
    throw new Error(`${source} needs at least one grader`);
  }
  const messages = Array.isArray(raw.messages)
    ? asStringArray(raw.messages, `${id} messages`)
    : undefined;
  const prompt = typeof raw.prompt === "string" ? raw.prompt : undefined;
  if (!prompt && !messages?.length) {
    throw new Error(`${source} needs prompt or messages`);
  }
  return {
    id,
    suite: raw.suite,
    prompt,
    messages,
    graders: raw.graders.map((grader) => parseGrader(grader, id)),
    tracked_metrics: Array.isArray(raw.tracked_metrics)
      ? asStringArray(raw.tracked_metrics, `${id} tracked_metrics`)
      : undefined,
    fixture: typeof raw.fixture === "string" ? raw.fixture : undefined,
    max_turns: typeof raw.max_turns === "number" ? raw.max_turns : undefined,
    reference: isRecord(raw.reference) ? raw.reference : undefined,
    source,
  };
}

function parseDocument(text: string, file: string): unknown {
  if (file.endsWith(".json")) return JSON.parse(text);
  const yaml = (Bun as { YAML?: { parse: (value: string) => unknown } }).YAML;
  if (!yaml) {
    throw new Error(`Bun.YAML is unavailable; convert ${file} to JSON`);
  }
  return yaml.parse(text);
}

async function filesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesIn(full)));
      continue;
    }
    if (/\.(ya?ml|json)$/.test(entry.name) && !entry.name.startsWith(".")) {
      files.push(full);
    }
  }
  return files;
}

export async function loadEvalTasks(options?: {
  suite?: EvalSuite;
  taskId?: string;
}): Promise<EvalTask[]> {
  const files = await filesIn(SUITES_ROOT);
  const tasks = await Promise.all(
    files.map(async (file) =>
      parseTask(parseDocument(await readFile(file, "utf8"), file), file),
    ),
  );
  return tasks.filter((task) => {
    if (options?.suite && task.suite !== options.suite) return false;
    if (options?.taskId && task.id !== options.taskId) return false;
    return true;
  });
}
