import type { StructuredToolInterface } from "@langchain/core/tools";
import { getJiraTicket, readJiraUserStory } from "./jira";
import { searchApiSpecs, searchSchemaDocs } from "./knowledge";
import {
  describeTables,
  inspectRelationships,
  listTables,
  runSql,
} from "./postgres";
import {
  buildSystemModel,
  querySystemModel,
  recordDecision,
  searchDecisions,
  simulateImpact,
} from "./system-model";

/**
 * Single source of truth for every tool an agent may be granted.
 * Agents opt in by name via `defineAgent({ tools: [...] })`.
 *
 * Jira MCP tools are registered for the discuss specialist. Call them only
 * when a ticket or user story is named.
 *
 * System-model tools read the graph in the product repo's `.sa/`. They are the
 * "what is connected to what" and "why is it like this" layer, on top of the
 * live schema's "what exists".
 */
export const TOOL_REGISTRY = {
  list_tables: listTables,
  describe_tables: describeTables,
  inspect_relationships: inspectRelationships,
  run_sql: runSql,
  search_api_specs: searchApiSpecs,
  search_schema_docs: searchSchemaDocs,
  build_system_model: buildSystemModel,
  query_system_model: querySystemModel,
  simulate_impact: simulateImpact,
  record_decision: recordDecision,
  search_decisions: searchDecisions,
  get_jira_ticket: getJiraTicket,
  read_jira_user_story: readJiraUserStory,
} satisfies Record<string, StructuredToolInterface>;

export type ToolName = keyof typeof TOOL_REGISTRY;

export const TOOL_NAMES = Object.keys(TOOL_REGISTRY) as ToolName[];

/** Name + description pairs, useful for docs and prompt surfaces. */
export const TOOL_DEFINITIONS = TOOL_NAMES.map((name) => ({
  name,
  description: TOOL_REGISTRY[name].description,
}));

export function resolveTools(
  names: readonly ToolName[] = TOOL_NAMES,
): StructuredToolInterface[] {
  return names.map((name) => TOOL_REGISTRY[name]);
}
