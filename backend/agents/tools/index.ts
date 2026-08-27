import type { StructuredToolInterface } from "@langchain/core/tools";
import { searchApiSpecs, searchSchemaDocs } from "./knowledge";
import {
  describeTables,
  inspectRelationships,
  listTables,
  runSql,
} from "./postgres";

/**
 * Single source of truth for every tool an agent may be granted.
 * Agents opt in by name via `defineAgent({ tools: [...] })`.
 */
export const TOOL_REGISTRY = {
  list_tables: listTables,
  describe_tables: describeTables,
  inspect_relationships: inspectRelationships,
  run_sql: runSql,
  search_api_specs: searchApiSpecs,
  search_schema_docs: searchSchemaDocs,
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
