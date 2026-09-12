import { postgresTools } from "./postgres";
import { knowledgeTools } from "./knowledge";
import { systemModelTools } from "./system-model";
import { jiraTools } from "./jira";
import { webTools } from "./web";
import { writeFilesTools } from "./write-files";
import { workspaceTools } from "./workspace";
import type { AnyCatalogTool, ToolSurface } from "./types";

export type { AnyCatalogTool, ToolContext, ToolSurface } from "./types";
export { defineTool } from "./types";

export const TOOL_CATALOG = [
  ...postgresTools,
  ...knowledgeTools,
  ...systemModelTools,
  ...jiraTools,
  ...webTools,
  ...writeFilesTools,
  ...workspaceTools,
] as const;

export type CatalogToolName = (typeof TOOL_CATALOG)[number]["name"];

export function catalogFor(surface: ToolSurface): AnyCatalogTool[] {
  return TOOL_CATALOG.filter((tool) =>
    (tool.surfaces as readonly ToolSurface[]).includes(surface),
  );
}

export function catalogByName(name: string): AnyCatalogTool | undefined {
  return TOOL_CATALOG.find((tool) => tool.name === name);
}
