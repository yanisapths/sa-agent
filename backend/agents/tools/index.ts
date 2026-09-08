import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  catalogFor,
  type AnyCatalogTool,
  type CatalogToolName,
  type ToolContext,
} from "./catalog";

function ctxOf(config: RunnableConfig): ToolContext {
  const cfg = config.configurable ?? {};
  return {
    workspaceRoot:
      typeof cfg.workspaceRoot === "string" ? cfg.workspaceRoot : undefined,
    userId: typeof cfg.userId === "string" ? cfg.userId : undefined,
    threadId: typeof cfg.thread_id === "string" ? cfg.thread_id : undefined,
  };
}

function toLangChain(entry: AnyCatalogTool): StructuredToolInterface {
  return tool(
    async (args, config: RunnableConfig) => entry.invoke(args, ctxOf(config)),
    {
      name: entry.name,
      description: entry.description,
      schema: entry.schema,
    },
  );
}

export type ToolName = CatalogToolName;

const langchainTools = catalogFor("langchain");

export const TOOL_REGISTRY = Object.fromEntries(
  langchainTools.map((entry) => [entry.name, toLangChain(entry)]),
) as Record<ToolName, StructuredToolInterface>;

export const TOOL_NAMES = langchainTools.map((entry) => entry.name) as ToolName[];

export const TOOL_DEFINITIONS = TOOL_NAMES.map((name) => ({
  name,
  description: TOOL_REGISTRY[name].description,
}));

export function resolveTools(
  names: readonly ToolName[] = TOOL_NAMES,
): StructuredToolInterface[] {
  return names.map((name) => TOOL_REGISTRY[name]);
}
