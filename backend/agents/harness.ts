import type { SubAgent } from "deepagents";
import { config } from "../config";
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

/** Virtual-FS paths. Next phase reads the file, not the chat history. */
export const ARTIFACT = {
  context: "/artifacts/context.md",
  discuss: "/artifacts/discuss.md",
  plan: "/artifacts/plan.md",
  execute: "/artifacts/execute.md",
  test: "/artifacts/test.md",
  review: "/artifacts/review.md",
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
    tools: [...SCHEMA, ...INDEX, ...JIRA],
    skills: [
      "/resources/skills/system-analyst/",
      "/resources/skills/jira/",
    ],
  },
  plan: {
    owner: "plan",
    model: config.model.plan,
    gate: "human",
    receives: `${ARTIFACT.discuss} (approved) + index conventions`,
    produces: `${ARTIFACT.plan} — spec, Mermaid flow, step list for execute`,
    tools: [...SCHEMA, ...INDEX],
    skills: ["/resources/skills/solution-architect/"],
  },
  execute: {
    owner: "execute",
    model: config.model.execute,
    gate: "human",
    receives: `${ARTIFACT.plan} (approved)`,
    produces: `${ARTIFACT.execute} — what changed, files, residual risks`,
    tools: [...SCHEMA, ...INDEX],
    skills: ["/resources/skills/backend/"],
  },
  test: {
    owner: "test",
    model: config.model.test,
    gate: "human",
    receives: `${ARTIFACT.discuss} + ${ARTIFACT.plan} + ${ARTIFACT.execute}`,
    produces: `${ARTIFACT.test} — cases, fixtures, quiz of the spec, gaps`,
    tools: [...SCHEMA, ...INDEX],
    skills: ["/resources/skills/test-engineer/"],
  },
  review: {
    owner: "review",
    model: config.model.review,
    gate: "human",
    receives: `${ARTIFACT.plan} + ${ARTIFACT.execute} + ${ARTIFACT.test}`,
    produces: `${ARTIFACT.review} — findings, required refactors, ship-ready or not`,
    tools: [...SCHEMA, ...INDEX],
    skills: ["/resources/skills/backend/"],
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

/** Orchestrator: index only. Specialists own schema, SQL, and Jira. */
export const ORCHESTRATOR_TOOLS = [
  "search_api_specs",
  "search_schema_docs",
  "list_tables",
] as const satisfies readonly ToolName[];

function specialist(
  phase: Exclude<Phase, "ship">,
  description: string,
  systemPrompt: string,
): SubAgent {
  const row = PHASE[phase];
  return {
    name: row.owner as string,
    description,
    systemPrompt,
    model: row.model as string,
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
      "discuss",
      "Align on a request: read the story, ground it, list gaps. Use when the user brings a ticket, story, or unclear ask. Do not plan or code.",
      `You are the Discuss specialist. Load system-analyst and, if a ticket
or story is named, jira.

1. If an issue key is present, get_jira_ticket or read_jira_user_story.
2. Index existing contracts (search_api_specs, search_schema_docs).
3. Confirm tables and FKs on the live schema.
4. Write ${ARTIFACT.discuss}: in/out scope, entities, field map, gaps,
   questions the human must answer.

Do not write a build plan or application source. ${GROUNDING}`,
    ),
    specialist(
      "plan",
      "Turn an approved discuss artifact into a spec, diagram, and execute plan. Use after discuss is approved. Do not code.",
      `You are the Plan specialist. Load solution-architect.

Read ${ARTIFACT.discuss}. Follow existing conventions from the index.
Write ${ARTIFACT.plan}: implementable spec, at least one Mermaid diagram
(every label double-quoted), and a numbered execute checklist.

Do not implement application source. ${GROUNDING}`,
    ),
    specialist(
      "execute",
      "Implement the approved plan in the product repo. Use only after plan is approved.",
      `You are the Execute specialist. Load backend.

Read ${ARTIFACT.plan}. Follow that checklist and product conventions.
Parameterize SQL with $1. Map snake_case columns to camelCase at the
boundary. Verify backing queries with run_sql.

Write ${ARTIFACT.execute}: files touched, what was implemented, what
was not. ${GROUNDING}`,
    ),
    specialist(
      "test",
      "Check the change against the discuss/plan artifacts: cases, fixtures, unit tests, quiz. Use after execute.",
      `You are the Test specialist. Load test-engineer.

Read ${ARTIFACT.discuss}, ${ARTIFACT.plan}, and ${ARTIFACT.execute}.
Quiz the implementation against the spec. Cover advertised status
codes, nullability, and pagination from the live schema.

Write ${ARTIFACT.test}: plan, cases, fixture notes, pass/fail, spec
gaps. Do not insert or update data. ${GROUNDING}`,
    ),
    specialist(
      "review",
      "Review and list required refactors before ship. Use after test is accepted. Do not ship.",
      `You are the Review specialist. Load backend.

Read ${ARTIFACT.plan}, ${ARTIFACT.execute}, and ${ARTIFACT.test}.
Check conventions, invented schema, missing tests, and unsafe SQL.

Write ${ARTIFACT.review}: critical / suggestion / ship-ready.
You may name refactors; do not commit or open a PR. ${GROUNDING}`,
    ),
  ];
}
