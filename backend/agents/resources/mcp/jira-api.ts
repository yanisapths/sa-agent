import { config } from "../../../config";
import type { JiraConnection } from "../../../contract/connection";
import { pinOutbound } from "../../../internal/product/connections";
import { requestText } from "../../../internal/product/outbound-http";

export interface JiraUser {
  displayName?: string;
  emailAddress?: string;
}

export interface JiraIssue {
  key: string;
  fields: {
    summary?: string;
    description?: unknown;
    issuetype?: { name?: string };
    status?: { name?: string };
    assignee?: JiraUser | null;
    reporter?: JiraUser | null;
    priority?: { name?: string } | null;
    labels?: string[];
    comment?: {
      comments?: Array<{
        author?: JiraUser;
        body?: unknown;
        created?: string;
      }>;
    };
    subtasks?: Array<{
      key: string;
      fields?: { summary?: string; status?: { name?: string } };
    }>;
    issuelinks?: Array<{
      type?: { inward?: string; outward?: string };
      inwardIssue?: { key: string; fields?: { summary?: string } };
      outwardIssue?: { key: string; fields?: { summary?: string } };
    }>;
    [custom: string]: unknown;
  };
  names?: Record<string, string>;
  renderedFields?: Record<string, unknown>;
}

/**
 * Where a Jira call goes and with which credentials. Built per call from one
 * product's connection; Default builds it from `.env` exactly as before.
 */
export type JiraTarget = {
  baseUrl: string;
  username?: string;
  token: string;
  sslVerify?: boolean;
  /** User-entered host: connect to the address `pinOutbound` checked. */
  pinned?: boolean;
};

export function defaultJiraTarget(): JiraTarget | undefined {
  const jira = config.jira;
  if (!jira.url) return undefined;
  if (jira.personalToken) {
    return { baseUrl: jira.url, token: jira.personalToken, sslVerify: jira.sslVerify };
  }
  if (jira.username && jira.apiToken) {
    return {
      baseUrl: jira.url,
      username: jira.username,
      token: jira.apiToken,
      sslVerify: jira.sslVerify,
    };
  }
  return undefined;
}

export function jiraTarget(conn: JiraConnection, pinned: boolean): JiraTarget {
  return {
    baseUrl: conn.baseUrl,
    ...(conn.username ? { username: conn.username } : {}),
    token: conn.token,
    pinned,
  };
}

function requiredUrl(target: JiraTarget): string {
  const url = target.baseUrl.replace(/\/$/, "");
  if (url) return url;
  throw new Error("JIRA_URL is not set");
}

/** `username + token` is Cloud Basic; a lone token is a Server/DC PAT. */
function authHeader(target: JiraTarget): string {
  if (target.username && target.token) {
    return `Basic ${Buffer.from(`${target.username}:${target.token}`).toString("base64")}`;
  }
  if (target.token) return `Bearer ${target.token}`;
  throw new Error(
    "Missing Jira credentials. Set JIRA_PERSONAL_TOKEN (Server/DC) or JIRA_USERNAME + JIRA_API_TOKEN (Cloud).",
  );
}

async function requestJson(
  target: JiraTarget,
  url: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<unknown> {
  const payload =
    init?.body === undefined ? undefined : JSON.stringify(init.body);
  const headers: Record<string, string> = {
    Authorization: authHeader(target),
    Accept: "application/json",
  };
  if (payload) headers["Content-Type"] = "application/json";

  const pin = target.pinned ? await pinOutbound(url, "jira") : undefined;
  const res = await requestText(url, {
    method: init?.method ?? "GET",
    headers,
    body: payload,
    pin,
    rejectUnauthorized: target.sslVerify ?? true,
  });
  if (!res.status || res.status >= 400) {
    throw new Error(`Jira ${res.status} ${res.statusText}: ${res.body.slice(0, 500)}`);
  }
  try {
    return res.body ? JSON.parse(res.body) : {};
  } catch {
    throw new Error(`Jira returned non-JSON: ${res.body.slice(0, 200)}`);
  }
}

function adfToText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return String(node);

  const value = node as { type?: string; text?: string; content?: unknown[] };
  if (value.type === "text") return value.text ?? "";
  if (value.type === "hardBreak") return "\n";
  if (Array.isArray(value.content)) {
    const inner = value.content.map(adfToText).join("");
    if (
      value.type === "paragraph" ||
      value.type === "heading" ||
      value.type === "listItem"
    ) {
      return `${inner}\n`;
    }
    if (value.type === "bulletList" || value.type === "orderedList") {
      return `${inner}\n`;
    }
    return inner;
  }
  return "";
}

function fieldText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  return adfToText(value).trim();
}

function person(user: JiraUser | null | undefined): string {
  if (!user) return "(unassigned)";
  return user.displayName || user.emailAddress || "(unknown)";
}

export function normalizeIssueKey(issueKey: string): string {
  const trimmed = issueKey.trim();
  if (!trimmed) return "";

  const fromBrowse = trimmed.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/i);
  if (fromBrowse) return fromBrowse[1].toUpperCase();

  const fromKey = trimmed.match(/\b([A-Z][A-Z0-9]+-\d+)\b/i);
  if (fromKey) return fromKey[1].toUpperCase();

  return trimmed;
}

export async function fetchIssue(target: JiraTarget, issueKey: string): Promise<JiraIssue> {
  const key = normalizeIssueKey(issueKey);
  if (!key) throw new Error("issue_key is required");

  const url =
    `${requiredUrl(target)}/rest/api/2/issue/${encodeURIComponent(key)}` +
    `?expand=names,renderedFields`;
  return (await requestJson(target, url)) as JiraIssue;
}

function escapeJqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function looksLikeJql(query: string): boolean {
  return /\b(AND|OR|ORDER BY|project\s*=|status\s*=|assignee\s*=|issuetype\s*=|text\s*~|summary\s*~)\b/i.test(
    query,
  );
}

/** A paste that is just a key or a browse URL, not a search phrase. */
export function isBareIssueKey(query: string): boolean {
  const key = normalizeIssueKey(query);
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) return false;
  const trimmed = query.trim();
  return (
    trimmed.toUpperCase() === key ||
    /\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(trimmed)
  );
}

function jqlFor(query: string): string {
  const trimmed = query.trim();
  if (looksLikeJql(trimmed)) return trimmed;
  const escaped = escapeJqlString(trimmed);
  return `text ~ "${escaped}" OR summary ~ "${escaped}" ORDER BY updated DESC`;
}

/**
 * Search Jira and return a compact hit list. A bare issue key fetches that
 * ticket instead of running JQL.
 */
export async function searchIssues(
  target: JiraTarget,
  query: string,
  limit = 8,
): Promise<string> {
  const trimmed = query.trim();
  if (!trimmed) return "search_jira needs a query, JQL, or issue key.";

  if (isBareIssueKey(trimmed)) {
    return formatTicket(await fetchIssue(target, trimmed));
  }

  const maxResults = Math.min(Math.max(limit, 1), 20);
  const jql = jqlFor(trimmed);
  const fields = "summary,status,issuetype,assignee,priority,updated";

  let payload: { issues?: JiraIssue[]; total?: number };
  try {
    const url =
      `${requiredUrl(target)}/rest/api/2/search` +
      `?jql=${encodeURIComponent(jql)}` +
      `&maxResults=${maxResults}` +
      `&fields=${encodeURIComponent(fields)}`;
    payload = (await requestJson(target, url)) as { issues?: JiraIssue[]; total?: number };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/\b410\b|\b404\b/.test(message)) throw err;
    payload = (await requestJson(target, `${requiredUrl(target)}/rest/api/3/search/jql`, {
      method: "POST",
      body: { jql, maxResults, fields: fields.split(",") },
    })) as { issues?: JiraIssue[]; total?: number };
  }

  const issues = payload.issues ?? [];
  if (issues.length === 0) {
    return `No Jira issues matched ${JSON.stringify(trimmed)}.`;
  }

  const lines = issues.map((issue) => {
    const f = issue.fields;
    return (
      `- ${issue.key} [${f.issuetype?.name ?? "?"}/${f.status?.name ?? "?"}] ` +
      `${f.summary ?? "(no summary)"} — ${person(f.assignee)}`
    );
  });
  const total = payload.total ?? issues.length;
  return [
    `Jira search (${issues.length} of ${total}):`,
    ...lines,
  ].join("\n");
}

function header(issue: JiraIssue): string[] {
  const f = issue.fields;
  return [
    `${issue.key} — ${f.summary ?? "(no summary)"}`,
    `Type: ${f.issuetype?.name ?? "unknown"}`,
    `Status: ${f.status?.name ?? "unknown"}`,
    `Priority: ${f.priority?.name ?? "none"}`,
    `Assignee: ${person(f.assignee)}`,
    `Reporter: ${person(f.reporter)}`,
    `Labels: ${(f.labels ?? []).join(", ") || "(none)"}`,
  ];
}

function descriptionOf(issue: JiraIssue): string {
  const rendered = issue.renderedFields?.description;
  if (typeof rendered === "string" && rendered.trim()) {
    return rendered.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return fieldText(issue.fields.description) || "(no description)";
}

function extractAcFromDescription(description: string): string | undefined {
  const match = description.match(
    /(?:acceptance\s*criteria|\*{0,2}\bac\b\*{0,2})\s*:?\s*([\s\S]*?)(?=\*{0,2}definition of readiness\*{0,2}|\n----|$)/i,
  );
  if (!match?.[1]) return undefined;

  const text = match[1]
    .split(/\r?\n/)
    .map((line) => {
      const item = line.replace(/^\s*[#*\-]+\s*/, "").trim();
      return item ? `- ${item}` : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  return text || undefined;
}

function acceptanceCriteria(issue: JiraIssue): string | undefined {
  const names = issue.names ?? {};
  for (const [id, name] of Object.entries(names)) {
    if (!/acceptance/i.test(name)) continue;
    const text = fieldText(issue.fields[id] ?? issue.renderedFields?.[id]);
    if (text) return text;
  }

  return extractAcFromDescription(fieldText(issue.fields.description));
}

export function formatTicket(issue: JiraIssue): string {
  return [
    ...header(issue),
    "",
    "Description:",
    descriptionOf(issue),
  ].join("\n");
}

export function formatUserStory(issue: JiraIssue): string {
  const f = issue.fields;
  const type = f.issuetype?.name ?? "unknown";
  const ac = acceptanceCriteria(issue);

  const links = (f.issuelinks ?? [])
    .map((link) => {
      if (link.outwardIssue) {
        return `- ${link.type?.outward ?? "relates to"} ${link.outwardIssue.key}: ${link.outwardIssue.fields?.summary ?? ""}`;
      }
      if (link.inwardIssue) {
        return `- ${link.type?.inward ?? "relates to"} ${link.inwardIssue.key}: ${link.inwardIssue.fields?.summary ?? ""}`;
      }
      return null;
    })
    .filter((line): line is string => Boolean(line));

  const subtasks = (f.subtasks ?? []).map(
    (task) =>
      `- ${task.key} [${task.fields?.status?.name ?? "?"}] ${task.fields?.summary ?? ""}`,
  );

  const comments = (f.comment?.comments ?? []).slice(-5).map((comment) => {
    const when = comment.created ? ` (${comment.created})` : "";
    return `- ${person(comment.author)}${when}: ${fieldText(comment.body).slice(0, 400)}`;
  });

  return [
    `User story ${issue.key} (${type})`,
    ...header(issue).slice(1),
    "",
    "Story:",
    descriptionOf(issue),
    "",
    "Acceptance criteria:",
    ac ?? "(none found — check the description above)",
    "",
    "Sub-tasks:",
    subtasks.length > 0 ? subtasks.join("\n") : "(none)",
    "",
    "Links:",
    links.length > 0 ? links.join("\n") : "(none)",
    "",
    "Recent comments:",
    comments.length > 0 ? comments.join("\n") : "(none)",
  ].join("\n");
}

/** Connection test: who the token authenticates as. */
export async function testJira(target: JiraTarget): Promise<string> {
  const me = (await requestJson(target, `${requiredUrl(target)}/rest/api/2/myself`)) as JiraUser;
  return `authenticated as ${me.displayName || me.emailAddress || "a Jira user"}`;
}
