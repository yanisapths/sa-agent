import type { z } from "zod";

export type ToolSurface = "langchain" | "mcp-knowledge" | "mcp-jira";

export type ToolContext = {
  workspaceRoot?: string;
  userId?: string;
  threadId?: string;
};

export type AnyCatalogTool = {
  name: string;
  mcpName: string;
  description: string;
  schema: z.ZodType;
  surfaces: readonly ToolSurface[];
  invoke: (args: unknown, ctx: ToolContext) => Promise<string>;
};

export function defineTool<const N extends string, S extends z.ZodType>(def: {
  name: N;
  mcpName?: string;
  description: string;
  schema: S;
  surfaces: readonly ToolSurface[];
  invoke: (args: z.infer<S>, ctx: ToolContext) => Promise<string>;
}): AnyCatalogTool & { name: N } {
  return {
    name: def.name,
    mcpName: def.mcpName ?? def.name,
    description: def.description,
    schema: def.schema,
    surfaces: def.surfaces,
    invoke: async (args, ctx) => def.invoke(def.schema.parse(args), ctx),
  };
}
