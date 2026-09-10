import type { FilesystemPermission, SubAgent } from "deepagents";
import { config } from "../config";
import { AGENT_INTERRUPT_ON } from "./interrupt-on";
import { normalizeVirtualFsPaths } from "./middleware/normalize-virtual-fs-paths";
import { resolveModel } from "./model";
import { ARTIFACT } from "./paths";
import { SPECIALISTS } from "./specialists";
import { resolveTools, type ToolName } from "./tools";

export { ARTIFACT } from "./paths";

/**
 * SA harness — a loop, not one smart model.
 *
 * The orchestrator never does the work. It indexes, hands a specialist the
 * previous artifact, and stops when the phase is a human gate.
 *
 * Read this file first. Then read `prompt.ts` (what the router says) and
 * `resources/AGENTS.md` (grounding rules every specialist inherits).
 */

export const PHASES = [
  "discuss",
  "plan",
  "execute",
  "test",
  "review",
  "ship",
] as const;

export type Phase = (typeof PHASES)[number];

/**
 * PVT prep is a second track, not more phases on the first one. It ends in
 * SQL scripts another team runs against production, so it never reaches
 * execute-the-code or review-the-diff. Same discipline: one phase, one human
 * gate, one artifact.
 */
export const PVT_PHASES = ["pvt-discuss", "pvt-plan", "pvt-execute"] as const;

export type PvtPhase = (typeof PVT_PHASES)[number];

const SCHEMA = [
  "list_tables",
  "describe_tables",
  "inspect_relationships",
  "run_sql",
] as const satisfies readonly ToolName[];

const INDEX = [
  "search_docs",
  "get_doc_page",
  "search_schema_docs",
] as const satisfies readonly ToolName[];

const JIRA = [
  "get_jira_ticket",
  "read_jira_user_story",
  "search_jira",
] as const satisfies readonly ToolName[];

/**
 * The system model. Read-only for most phases; only discuss rebuilds it and
 * only execute records a decision, so a specialist cannot rewrite the graph
 * out from under the phase after it.
 */
const MODEL_READ = [
  "query_system_model",
  "simulate_impact",
  "search_decisions",
] as const satisfies readonly ToolName[];

const WRITE = ["write_files"] as const satisfies readonly ToolName[];

const WORKSPACE_READ = [
  "workspace_ls",
  "workspace_read",
  "workspace_grep",
] as const satisfies readonly ToolName[];

const WORKSPACE_WRITE = ["workspace_write"] as const satisfies readonly ToolName[];

export interface PhaseContract {
  /** `task` tool name. `ship` has no specialist — a human closes git. */
  owner: string | null;
  model: string | null;
  /** Human must approve before the next `task` call. */
  gate: "human";
  receives: string;
  produces: string;
  tools: readonly ToolName[];
  skills: readonly string[];
}

/**
 * One row = one turn of the loop. Cheap model first. Tools are the minimum
 * that phase needs so specialists do not inherit the whole registry.
 */
export const PHASE: Record<Phase, PhaseContract> = {
  discuss: {
    owner: "discuss",
    model: config.model.discuss,
    gate: "human",
    receives:
      "user request, optional ticket key, index hits, live schema orientation",
    produces: `${ARTIFACT.discuss} — scope, gaps, field map, questions for the human`,
    tools: [...SCHEMA, ...INDEX, ...JIRA, ...MODEL_READ, "build_system_model", ...WRITE, ...WORKSPACE_READ],
    skills: [
      "/resources/skills/system-analyst/",
      "/resources/skills/system-model/",
      "/resources/skills/jira/",
    ],
  },
  plan: {
    owner: "plan",
    model: config.model.plan,
    gate: "human",
    receives: `${ARTIFACT.discuss} (approved) + index conventions`,
    produces: `${ARTIFACT.plan} — spec, Mermaid flow, step list for execute`,
    tools: [...SCHEMA, ...INDEX, ...MODEL_READ, ...WRITE, ...WORKSPACE_READ],
    skills: [
      "/resources/skills/solution-architect/",
      "/resources/skills/system-model/",
    ],
  },
  execute: {
    owner: "execute",
    model: config.model.execute,
    gate: "human",
    receives: `${ARTIFACT.plan} (approved)`,
    produces: `${ARTIFACT.execute} — what changed, files, residual risks`,
    tools: [
      ...SCHEMA,
      ...INDEX,
      ...MODEL_READ,
      "build_system_model",
      "record_decision",
      ...WRITE,
      ...WORKSPACE_READ,
      ...WORKSPACE_WRITE,
    ],
    skills: [
      "/resources/skills/backend/",
      "/resources/skills/system-model/",
    ],
  },
  test: {
    owner: "test",
    model: config.model.test,
    gate: "human",
    receives: `${ARTIFACT.discuss} + ${ARTIFACT.plan} + ${ARTIFACT.execute}`,
    produces: `${ARTIFACT.test} — cases, fixtures, quiz of the spec, gaps`,
    tools: [...SCHEMA, ...INDEX, ...MODEL_READ, ...WRITE, ...WORKSPACE_READ],
    skills: [
      "/resources/skills/test-engineer/",
      "/resources/skills/system-model/",
    ],
  },
  review: {
    owner: "review",
    model: config.model.review,
    gate: "human",
    receives: `${ARTIFACT.plan} + ${ARTIFACT.execute} + ${ARTIFACT.test}`,
    produces: `${ARTIFACT.review} — findings, required refactors, ship-ready or not`,
    tools: [...SCHEMA, ...INDEX, ...MODEL_READ, ...WRITE, ...WORKSPACE_READ, ...WORKSPACE_WRITE],
    skills: [
      "/resources/skills/backend/",
      "/resources/skills/system-model/",
    ],
  },
  ship: {
    owner: null,
    model: null,
    gate: "human",
    receives: `${ARTIFACT.review} accepted`,
    produces: "commit / PR — the agent does not ship",
    tools: [],
    skills: [],
  },
};

/**
 * PVT prep. The scarce resource is the test window and the SRE's attention,
 * so planning groups cases into shared setups and execute only emits scripts —
 * Prefer read-only `run_sql` here; DML is human-gated and PVT still emits
 * scripts for SRE rather than mutating through the agent.
 */
export const PVT_PHASE: Record<PvtPhase, PhaseContract> = {
  "pvt-discuss": {
    owner: "pvt-discuss",
    model: config.model.pvtDiscuss,
    gate: "human",
    receives: `PVT requirements, the case list at ${ARTIFACT.pvtCasesJson} (from the CSV at ${ARTIFACT.pvtCases}, or a named story), live schema`,
    produces: `${ARTIFACT.pvtDiscuss} — case inventory, tables touched, unrunnable cases, questions`,
    tools: [...SCHEMA, ...INDEX, ...JIRA, ...MODEL_READ, ...WRITE, ...WORKSPACE_READ],
    skills: [
      "/resources/skills/pvt-prep/",
      "/resources/skills/system-analyst/",
      "/resources/skills/jira/",
    ],
  },
  "pvt-plan": {
    owner: "pvt-plan",
    model: config.model.pvtPlan,
    gate: "human",
    receives: `${ARTIFACT.pvtDiscuss} (approved)`,
    produces: `${ARTIFACT.pvtPlan} — scenario groups, script set, pre-window vs in-window split, impact`,
    tools: [...SCHEMA, ...INDEX, ...MODEL_READ, ...WRITE, ...WORKSPACE_READ],
    skills: [
      "/resources/skills/pvt-prep/",
      "/resources/skills/test-engineer/",
      "/resources/skills/backend/",
    ],
  },
  "pvt-execute": {
    owner: "pvt-execute",
    model: config.model.pvtExecute,
    gate: "human",
    receives: `${ARTIFACT.pvtPlan} (approved)`,
    produces: `${ARTIFACT.pvtExecute} — the numbered script set, run order, owners`,
    tools: [
      ...SCHEMA,
      ...INDEX,
      ...MODEL_READ,
      ...WRITE,
      ...WORKSPACE_READ,
      ...WORKSPACE_WRITE,
    ],
    skills: [
      "/resources/skills/pvt-prep/",
      "/resources/skills/backend/",
    ],
  },
};

/**
 * Every phase a caller may ask for by name, from the tables above rather than a
 * second hardcoded list that could drift from them. `ship` is absent by
 * construction: its `owner` is null because a human closes git, so there is no
 * specialist to force.
 */
export const PHASE_OWNERS: ReadonlySet<string> = new Set(
  [...Object.values(PHASE), ...Object.values(PVT_PHASE)]
    .map((row) => row.owner)
    .filter((owner): owner is string => owner !== null),
);

/**
 * Orchestrator: index + live schema orientation. Specialists own `run_sql`,
 * Jira, and phase writes. Without `describe_tables` / `inspect_relationships`
 * here, the router can list tables then get stuck asking the human for columns.
 */
export const ORCHESTRATOR_TOOLS = [
  "search_docs",
  "get_doc_page",
  "search_schema_docs",
  "list_tables",
  "describe_tables",
  "inspect_relationships",
  "write_files",
  "workspace_ls",
  "workspace_read",
  "workspace_grep",
] as const satisfies readonly ToolName[];

/**
 * `modelOverride` is the model the human picked in the GUI for this request. It
 * wins over the phase's env-configured default, because the router only
 * delegates — if the override stopped at the orchestrator the picker would not
 * change which model does any of the actual work.
 *
 * deepagents lists *children* of each skills source as packages. PHASE.skills
 * names the package (`/resources/skills/backend/`); the source is its parent.
 */
function skillSources(paths: readonly string[]): string[] {
  const sources = new Set<string>();
  for (const raw of paths) {
    const trimmed = raw.replace(/\/+$/, "");
    const slash = trimmed.lastIndexOf("/");
    sources.add(slash <= 0 ? `${trimmed}/` : `${trimmed.slice(0, slash)}/`);
  }
  return [...sources];
}

/** Phase artifacts and mentioned vault files — discuss/plan/test must not write the product repo. */
const ARTIFACT_WRITES: FilesystemPermission[] = [
  { operations: ["write"], paths: ["/artifacts/**"], mode: "allow" },
  { operations: ["write"], paths: ["/large_tool_results/**"], mode: "allow" },
  { operations: ["write"], paths: ["/conversation_history/**"], mode: "allow" },
  { operations: ["write"], paths: ["/vault/**"], mode: "allow" },
  { operations: ["write"], paths: ["/**"], mode: "deny" },
];

/** Execute/review may write the attached repo and vault mounts; never skills/memory. */
const PRODUCT_WRITES: FilesystemPermission[] = [
  { operations: ["write"], paths: ["/resources/**"], mode: "deny" },
];

function specialist(
  row: PhaseContract,
  description: string,
  systemPrompt: string,
  modelOverride?: string,
): SubAgent {
  const canWriteProduct = row.tools.includes("workspace_write");
  return {
    name: row.owner as string,
    description,
    systemPrompt,
    model: resolveModel(modelOverride ?? (row.model as string)),
    tools: resolveTools(row.tools) as NonNullable<SubAgent["tools"]>,
    skills: skillSources(row.skills),
    permissions: canWriteProduct ? PRODUCT_WRITES : ARTIFACT_WRITES,
    interruptOn: AGENT_INTERRUPT_ON,
    middleware: [normalizeVirtualFsPaths],
  };
}

function contractForOwner(owner: string): PhaseContract {
  const row = [...Object.values(PHASE), ...Object.values(PVT_PHASE)].find(
    (phase) => phase.owner === owner,
  );
  if (!row) throw new Error(`No phase contract for specialist ${owner}`);
  return row;
}

export function harnessSubagents(modelOverride?: string): SubAgent[] {
  return Object.values(SPECIALISTS).map((spec) =>
    specialist(contractForOwner(spec.owner), spec.description, spec.systemPrompt, modelOverride),
  );
}
