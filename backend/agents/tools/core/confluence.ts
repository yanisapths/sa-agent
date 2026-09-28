import type { DynamicStructuredTool } from "@langchain/core/tools";
import { config } from "../../../config";
import { confluenceCql } from "../../resources/mcp/confluence-api";
import {
  getConfluenceMcpTools,
  isConfluenceMcpConfigured,
} from "../../resources/mcp/mcp-client";

const NOT_CONFIGURED =
  "Confluence docs are not configured. Set CONFLUENCE_BASE_URL with " +
  "CONFLUENCE_USERNAME + CONFLUENCE_ACCESS_TOKEN or CONFLUENCE_PAT, " +
  "or set CONFLUENCE_MCP_URL to a Confluence MCP server.";

function findTool(
  tools: DynamicStructuredTool[],
  names: readonly string[],
): DynamicStructuredTool | undefined {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return tools.find((tool) => {
    const name = tool.name.toLowerCase();
    const leaf = name.split("__").pop() ?? name;
    return wanted.has(name) || wanted.has(leaf);
  });
}

function asText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content: unknown }).content;
    if (typeof content === "string") return content;
  }
  return JSON.stringify(result, null, 2);
}

function cloudIdField(): { cloudId: string } | Record<string, never> {
  const cloudId = config.confluence.cloudId;
  return cloudId ? { cloudId } : {};
}

function searchArgs(
  toolName: string,
  query: string,
  limit: number,
): Record<string, unknown> {
  const name = toolName.toLowerCase();
  const leaf = name.split("__").pop() ?? name;
  if (leaf.includes("cql")) {
    return {
      cql: confluenceCql(query, config.confluence.spaceKey),
      limit,
      ...cloudIdField(),
    };
  }
  if (leaf === "search") return { query, ...cloudIdField() };
  return { query, limit };
}

function pageArgs(toolName: string, ref: string): Record<string, unknown> {
  const name = toolName.toLowerCase();
  if (name === "fetch" || name.endsWith("__fetch")) return { id: ref };
  if (name.includes("getconfluencepage")) {
    return { pageId: ref, contentFormat: "markdown", ...cloudIdField() };
  }
  return { page_id: ref };
}

async function toolsOrThrow(): Promise<DynamicStructuredTool[]> {
  if (!isConfluenceMcpConfigured()) {
    throw new Error(NOT_CONFIGURED);
  }
  const tools = await getConfluenceMcpTools();
  if (tools.length === 0) {
    throw new Error(
      "Confluence MCP is configured but no tools could be loaded. Check the MCP URL, command, and credentials.",
    );
  }
  return tools;
}

export async function searchConfluenceMcp(
  query: string,
  limit: number,
): Promise<string> {
  const tools = await toolsOrThrow();
  const tool = findTool(tools, [
    "confluence_search",
    "searchConfluenceUsingCql",
    "searchConfluence",
    "search",
  ]);
  if (!tool) {
    throw new Error(
      `Confluence MCP has no search tool. Available: ${tools.map((item) => item.name).join(", ")}`,
    );
  }
  return asText(await tool.invoke(searchArgs(tool.name, query, limit)));
}

export async function readConfluenceMcp(refs: string[]): Promise<string> {
  const tools = await toolsOrThrow();
  const batch = findTool(tools, ["confluence_get_pages"]);
  if (batch) {
    return asText(await batch.invoke({ page_ids: refs }));
  }

  const single = findTool(tools, [
    "confluence_get_page",
    "getConfluencePage",
    "fetch",
  ]);
  if (!single) {
    throw new Error(
      `Confluence MCP has no page tool. Available: ${tools.map((item) => item.name).join(", ")}`,
    );
  }
  const pages = await Promise.all(
    refs.map((ref) => single.invoke(pageArgs(single.name, ref)).then(asText)),
  );
  return pages.join("\n\n---\n\n");
}
