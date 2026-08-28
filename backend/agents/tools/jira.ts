import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { normalizeIssueKey } from "../resources/mcp/jira-api";
import {
  getJiraMcpTools,
  isJiraMcpConfigured,
} from "../resources/mcp/mcp-client";
import { orToolError } from "./errors";

const TICKET_TOOL_NAMES = [
  "get_ticket",
  "jira_get_issue",
  "get_issue",
  "getJiraIssue",
  "jira_get_ticket",
];

const STORY_TOOL_NAMES = [
  "read_user_story",
  "jira_get_issue",
  "get_issue",
  "getJiraIssue",
  "get_ticket",
];

function asText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result == null) return "";
  return JSON.stringify(result, null, 2);
}

function callJiraMcp(
  preferredNames: readonly string[],
  issueKey: string,
): Promise<string> {
  return orToolError("Jira MCP", () => invokeJiraMcp(preferredNames, issueKey));
}

async function invokeJiraMcp(
  preferredNames: readonly string[],
  issueKey: string,
): Promise<string> {
  if (!isJiraMcpConfigured()) {
    return (
      "Jira MCP is not configured. Set JIRA_URL with JIRA_PERSONAL_TOKEN / " +
        "JIRA_USERNAME+JIRA_API_TOKEN, or Confluence Cloud credentials " +
        "(CONFLUENCE_BASE_URL + CONFLUENCE_USERNAME/CONFLUENCE_ACCESS_TOKEN). " +
        "Set JIRA_MCP_URL only when you have a remote MCP token."
    );
  }

  const tools = await getJiraMcpTools();
  if (tools.length === 0) {
    return "Jira MCP is configured but no tools could be loaded. Check the MCP connection and credentials.";
  }

  const mcpTool = preferredNames
    .map((name) => tools.find((candidate) => candidate.name === name))
    .find((candidate) => candidate !== undefined);

  if (!mcpTool) {
    return (
      `Jira MCP connected but none of [${preferredNames.join(", ")}] are available. ` +
      `Got: ${tools.map((t) => t.name).join(", ")}`
    );
  }

  const result = await mcpTool.invoke({
    issue_key: normalizeIssueKey(issueKey),
  });
  return asText(result);
}

export const getJiraTicket = tool(
  async ({ issue_key }) => callJiraMcp(TICKET_TOOL_NAMES, issue_key),
  {
    name: "get_jira_ticket",
    description:
      "Fetch a Jira ticket via MCP (summary, status, assignee, description). " +
      "ONLY call this when the user explicitly asks to get, look up, or fetch a Jira ticket or issue " +
      "(e.g. 'get ticket PROJ-123', 'show me this Jira issue'). " +
      "Do not use for schema, API design, SQL, or architecture work.",
    schema: z.object({
      issue_key: z
        .string()
        .describe("Jira issue key, e.g. PROJ-123"),
    }),
  },
);

export const readJiraUserStory = tool(
  async ({ issue_key }) => callJiraMcp(STORY_TOOL_NAMES, issue_key),
  {
    name: "read_jira_user_story",
    description:
      "Read a Jira user story via MCP (narrative, acceptance criteria, sub-tasks, links). " +
      "ONLY call this when the user explicitly asks to read a user story " +
      "(e.g. 'read user story PROJ-456', 'what does this story say'). " +
      "Do not use for schema, API design, SQL, or architecture work.",
    schema: z.object({
      issue_key: z
        .string()
        .describe("Jira issue key for the user story, e.g. PROJ-456"),
    }),
  },
);
