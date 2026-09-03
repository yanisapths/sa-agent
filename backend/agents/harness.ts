import type { SubAgent } from "deepagents";
import { config } from "../config";
import { resolveModel } from "./model";
import { resolveTools, type ToolName } from "./tools";

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
  "search_api_specs",
  "search_schema_docs",
] as const satisfies readonly ToolName[];

const JIRA = [
  "get_jira_ticket",
  "read_jira_user_story",
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

/** Virtual-FS paths. Next phase reads the file, not the chat history. */
export const ARTIFACT = {
  context: "/artifacts/context.md",
  discuss: "/artifacts/discuss.md",
  plan: "/artifacts/plan.md",
  execute: "/artifacts/execute.md",
  test: "/artifacts/test.md",
  review: "/artifacts/review.md",
  /**
   * The case list as the human supplied it. A chat attachment only reaches the
   * router's own message, so the router parks it here verbatim — otherwise the
   * pvt-discuss specialist never sees the cases it is supposed to inventory.
   */
  pvtCases: "/artifacts/pvt-cases.csv",
  pvtDiscuss: "/artifacts/pvt-discuss.md",
  pvtPlan: "/artifacts/pvt-plan.md",
  pvtExecute: "/artifacts/pvt-execute.md",
} as const;

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
    tools: [...SCHEMA, ...INDEX, ...JIRA, ...MODEL_READ, "build_system_model"],
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
    tools: [...SCHEMA, ...INDEX, ...MODEL_READ],
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
    tools: [...SCHEMA, ...INDEX, ...MODEL_READ, "build_system_model", "record_decision"],
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
    tools: [...SCHEMA, ...INDEX, ...MODEL_READ],
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
    tools: [...SCHEMA, ...INDEX, ...MODEL_READ],
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
 * `run_sql` stays read-only and no phase here writes to a database.
 */
export const PVT_PHASE: Record<PvtPhase, PhaseContract> = {
  "pvt-discuss": {
    owner: "pvt-discuss",
    model: config.model.pvtDiscuss,
    gate: "human",
    receives: `PVT requirements, the case list at ${ARTIFACT.pvtCases} (or a named story), live schema`,
    produces: `${ARTIFACT.pvtDiscuss} — case inventory, tables touched, unrunnable cases, questions`,
    tools: [...SCHEMA, ...INDEX, ...JIRA, ...MODEL_READ],
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
    tools: [...SCHEMA, ...INDEX, ...MODEL_READ],
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
    tools: [...SCHEMA, ...INDEX, ...MODEL_READ],
    skills: [
      "/resources/skills/pvt-prep/",
      "/resources/skills/backend/",
    ],
  },
};

/** Orchestrator: index only. Specialists own schema, SQL, and Jira. */
export const ORCHESTRATOR_TOOLS = [
  "search_api_specs",
  "search_schema_docs",
  "list_tables",
] as const satisfies readonly ToolName[];

function specialist(
  row: PhaseContract,
  description: string,
  systemPrompt: string,
): SubAgent {
  return {
    name: row.owner as string,
    description,
    systemPrompt,
    model: resolveModel(row.model as string),
    tools: resolveTools(row.tools) as NonNullable<SubAgent["tools"]>,
    skills: [...row.skills],
  };
}

const GROUNDING = `Ground every claim in list_tables / describe_tables /
inspect_relationships, or in search_api_specs / search_schema_docs.
Never invent a table, column, or endpoint. Write your artifact to the
path named in the task. Return a short report, not raw tool dumps.`;

export function harnessSubagents(): SubAgent[] {
  return [
    specialist(
      PHASE.discuss,
      "Align on a request: read the story, ground it, list gaps. Use when the user brings a ticket, story, or unclear ask. Do not plan or code.",
      `You are the Discuss specialist. Load system-analyst and, if a ticket
or story is named, jira.

1. If an issue key is present, get_jira_ticket or read_jira_user_story.
2. build_system_model, then query_system_model to find the components the
   request touches, and search_decisions for why they are built that way.
3. Index existing contracts (search_api_specs, search_schema_docs).
4. Confirm tables and FKs on the live schema.
5. Write ${ARTIFACT.discuss}: in/out scope, entities, field map, existing
   components, constraining decisions, gaps, questions for the human.

Do not write a build plan or application source. ${GROUNDING}`,
    ),
    specialist(
      PHASE.plan,
      "Turn an approved discuss artifact into a spec, diagram, and execute plan. Use after discuss is approved. Do not code.",
      `You are the Plan specialist. Load solution-architect.

Read ${ARTIFACT.discuss}. Follow existing conventions from the index.
Run simulate_impact on every element the change touches.
Write ${ARTIFACT.plan}: implementable spec, at least one Mermaid diagram
(every label double-quoted), a numbered execute checklist, and an
"Impact and risk" section — affected APIs, database, services, frontend,
tests, docs, the risk level with its reasons, and any decision it works
against. Affected files with no test become checklist items.

Do not implement application source. ${GROUNDING}`,
    ),
    specialist(
      PHASE.execute,
      "Implement the approved plan in the product repo. Use only after plan is approved.",
      `You are the Execute specialist. Load backend.

Read ${ARTIFACT.plan}. Follow that checklist and product conventions.
Parameterize SQL with $1. Map snake_case columns to camelCase at the
boundary. Verify backing queries with run_sql.

Stay inside the blast radius the plan declared. When done, run
build_system_model so the graph matches the code. If the change embodies
a rationale the code cannot show, ask the human for it and
record_decision — never invent the reason.

Write ${ARTIFACT.execute}: files touched, what was implemented, what
was not. ${GROUNDING}`,
    ),
    specialist(
      PHASE.test,
      "Check the change against the discuss/plan artifacts: cases, fixtures, unit tests, quiz. Use after execute.",
      `You are the Test specialist. Load test-engineer.

Read ${ARTIFACT.discuss}, ${ARTIFACT.plan}, and ${ARTIFACT.execute}.
Quiz the implementation against the spec. Cover advertised status
codes, nullability, and pagination from the live schema. Run
simulate_impact on what changed: everything it lists as having no test
is a coverage gap to cover or record.

Write ${ARTIFACT.test}: plan, cases, fixture notes, pass/fail, spec
gaps. Do not insert or update data. ${GROUNDING}`,
    ),
    specialist(
      PHASE.review,
      "Review and list required refactors before ship. Use after test is accepted. Do not ship.",
      `You are the Review specialist. Load backend.

Read ${ARTIFACT.plan}, ${ARTIFACT.execute}, and ${ARTIFACT.test}.
Check conventions, invented schema, missing tests, and unsafe SQL.
search_decisions on the area touched: reversing a recorded decision
without arguing against it is a critical finding. Use simulate_impact to
confirm the change did not reach further than the plan said.

Write ${ARTIFACT.review}: critical / suggestion / ship-ready.
You may name refactors; do not commit or open a PR. ${GROUNDING}`,
    ),
    specialist(
      PVT_PHASE["pvt-discuss"],
      "Align on a PVT: read the requirements and the test case list, ground every case on the live schema, list the ones that cannot run. Use first for production verification work. Do not plan or write SQL.",
      `You are the PVT Discuss specialist. Load pvt-prep and system-analyst,
plus jira if a ticket or story is named.

1. Read the case source: ${ARTIFACT.pvtCases} if the router parked one there,
   otherwise the story or the table in the task. Normalise every case to case
   id, scenario, precondition data, steps, expected result. Keep the source
   ids. If neither exists, say so and stop — do not invent cases.
2. Ground each case with describe_tables and inspect_relationships, and find
   the components behind it with query_system_model.
3. Write ${ARTIFACT.pvtDiscuss}: the window and its goal, the case inventory,
   tables and columns each case touches, cases that cannot run as written,
   and questions for the human.

A case naming a table or column that does not exist is a gap, not a case.
Do not group scenarios or write scripts. ${GROUNDING}`,
    ),
    specialist(
      PVT_PHASE["pvt-plan"],
      "Group approved PVT cases into scenarios that share one data setup and lay out the numbered script set. Use after pvt-discuss is approved. Do not write the scripts.",
      `You are the PVT Plan specialist. Load pvt-prep, test-engineer, and backend.

Read ${ARTIFACT.pvtDiscuss}. Group the cases into the smallest set of
scenarios that can share one data setup: same fixture, and no case mutating
what another asserts. Cases writing the same row go in different groups or
get their own -pvt-NN patch.

Two goals decide the layout, in this order: nothing is created inside the PVT
window that could have been staged before it, and SRE is contacted as few
times as possible. Run simulate_impact on every table and column the scripts
will write, and search_decisions on that area.

Write ${ARTIFACT.pvtPlan}: scenario groups with the cases each covers, run
order, the script set as a table (filename, owner, purpose, cases served,
matching rollback), the pre-window / in-window split, an "Impact and risk"
section, one Mermaid diagram of the run order with every label double-quoted,
and a numbered checklist for execute.

Do not write SQL files. ${GROUNDING}`,
    ),
    specialist(
      PVT_PHASE["pvt-execute"],
      "Generate the numbered, owner-tagged PVT SQL script set from an approved PVT plan. Use only after pvt-plan is approved.",
      `You are the PVT Execute specialist. Load pvt-prep and backend.

Read ${ARTIFACT.pvtPlan} and follow its script table exactly. Name files
NN-<action>[-pvt-NN]_<owner>.sql, owner devops or sre.

Every script carries a header comment naming its owner, when to run it, the
cases it serves and its rollback counterpart; idempotent guards; BEGIN/COMMIT
around data changes; a key-scoped WHERE on every UPDATE and DELETE; and a
closing verification SELECT printing affected row counts. These run in psql,
so use literals collected at the top of the file, not $1.

Confirm every column with describe_tables and prove each verification query
with run_sql. run_sql is read-only — never attempt a write. Write each
rollback in the same pass as the script it undoes.

Write ${ARTIFACT.pvtExecute}: the scripts produced, run order with owners,
what each assumes about prior state, and anything the plan asked for that you
did not produce. ${GROUNDING}`,
    ),
  ];
}
