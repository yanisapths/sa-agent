import { z } from "zod";
import { config } from "../../../config";
import {
  fetchIssue,
  formatTicket,
  formatUserStory,
  normalizeIssueKey,
  searchIssues,
} from "../../resources/mcp/jira-api";
import { orToolError } from "../errors";
import {
  getJiraMcpTools,
  isJiraRemoteMcpConfigured,
} from "../../resources/mcp/mcp-client";
import { defineTool } from "./types";

const JIRA = ["langchain", "mcp-jira"] as const;

const issueKeySchema = z.object({
  issue_key: z.string().describe("Jira issue key, e.g. PROJ-123"),
});

function hasJiraRestAuth(): boolean {
  const jira = config.jira;
  return Boolean(
    jira.url && (jira.personalToken || (jira.username && jira.apiToken)),
  );
}

function notConfigured(): string {
  return (
    "Jira is not configured. Set JIRA_URL with JIRA_PERSONAL_TOKEN / " +
    "JIRA_USERNAME+JIRA_API_TOKEN, or Confluence Cloud credentials " +
    "(CONFLUENCE_BASE_URL + CONFLUENCE_USERNAME/CONFLUENCE_ACCESS_TOKEN). " +
    "Set JIRA_MCP_URL only when you have a remote MCP token."
  );
}

async function viaRemoteMcp(
  preferredNames: readonly string[],
  args: Record<string, unknown>,
): Promise<string> {
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
  const result = await mcpTool.invoke(args);
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}

async function loadIssue(
  issueKey: string,
  format: (issue: Awaited<ReturnType<typeof fetchIssue>>) => string,
  remoteNames: readonly string[],
): Promise<string> {
  if (hasJiraRestAuth()) {
    return orToolError("Jira", async () =>
      format(await fetchIssue(issueKey)),
    );
  }
  if (isJiraRemoteMcpConfigured()) {
    return orToolError("Jira MCP", () =>
      viaRemoteMcp(remoteNames, { issue_key: normalizeIssueKey(issueKey) }),
    );
  }
  return notConfigured();
}

async function loadSearch(query: string, limit: number): Promise<string> {
  if (hasJiraRestAuth()) {
    return orToolError("Jira", () => searchIssues(query, limit));
  }
  if (isJiraRemoteMcpConfigured()) {
    return orToolError("Jira MCP", () =>
      viaRemoteMcp(
        [
          "search_jira",
          "jira_search",
          "searchJiraIssuesUsingJql",
          "search_issues",
        ],
        { query, jql: query, limit, maxResults: limit },
      ),
    );
  }
  return notConfigured();
}

export const jiraTools = [
  defineTool({
    name: "get_jira_ticket",
    mcpName: "get_ticket",
    description:
      "Fetch a Jira ticket via MCP (summary, status, assignee, description). " +
      "ONLY call this when the user explicitly asks to get, look up, or fetch a Jira ticket or issue " +
      "(e.g. 'get ticket PROJ-123', 'show me this Jira issue'). " +
      "Do not use for schema, API design, SQL, or architecture work.",
    schema: issueKeySchema,
    surfaces: JIRA,
    invoke: ({ issue_key }) =>
      loadIssue(issue_key, formatTicket, [
        "get_ticket",
        "jira_get_issue",
        "get_issue",
        "getJiraIssue",
        "jira_get_ticket",
      ]),
  }),
  defineTool({
    name: "read_jira_user_story",
    mcpName: "read_user_story",
    description:
      "Read a Jira user story via MCP (narrative, acceptance criteria, sub-tasks, links). " +
      "ONLY call this when the user explicitly asks to read a user story " +
      "(e.g. 'read user story PROJ-456', 'what does this story say'). " +
      "Do not use for schema, API design, SQL, or architecture work.",
    schema: issueKeySchema,
    surfaces: JIRA,
    invoke: ({ issue_key }) =>
      loadIssue(issue_key, formatUserStory, [
        "read_user_story",
        "jira_get_issue",
        "get_issue",
        "getJiraIssue",
        "get_ticket",
      ]),
  }),
  defineTool({
    name: "search_jira",
    mcpName: "search_jira",
    description:
      "Search Jira by text, JQL, or an issue key. Returns a short hit list " +
      "(key, type, status, summary). Use when the user wants to find tickets " +
      "and did not give a single key. Do not use for schema, API, or SQL work.",
    schema: z.object({
      query: z
        .string()
        .describe("Search text, JQL, or an issue key such as PROJ-123"),
      limit: z.number().int().min(1).max(20).default(8),
    }),
    surfaces: JIRA,
    invoke: ({ query, limit }) => loadSearch(query, limit),
  }),
] as const;
