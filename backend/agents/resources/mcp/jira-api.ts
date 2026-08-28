import http from "node:http";
import https from "node:https";

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

function requiredUrl(): string {
  const url = process.env.JIRA_URL?.replace(/\/$/, "");
  if (!url) {
    throw new Error("JIRA_URL is not set");
  }
  return url;
}

function authHeader(): string {
  const pat = process.env.JIRA_PERSONAL_TOKEN || process.env.JIRA_PAT;
  if (pat) return `Bearer ${pat}`;

  const username = process.env.JIRA_USERNAME;
  const token = process.env.JIRA_API_TOKEN;
  if (username && token) {
    return `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`;
  }

  throw new Error(
    "Missing Jira credentials. Set JIRA_PERSONAL_TOKEN (Server/DC) or JIRA_USERNAME + JIRA_API_TOKEN (Cloud).",
  );
}

function sslVerify(): boolean {
  return process.env.JIRA_SSL_VERIFY !== "false";
}

function requestJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const pathWithQuery = `${parsed.pathname}${parsed.search}`;
    const onResponse = (res: http.IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (!res.statusCode || res.statusCode >= 400) {
          reject(
            new Error(
              `Jira ${res.statusCode} ${res.statusMessage ?? ""}: ${body.slice(0, 500)}`,
            ),
          );
          return;
        }
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(new Error(`Jira returned non-JSON: ${body.slice(0, 200)}`));
        }
      });
    };

    const req =
      parsed.protocol === "https:"
        ? https.request(
            {
              hostname: parsed.hostname,
              port: parsed.port || undefined,
              path: pathWithQuery,
              method: "GET",
              headers: {
                Authorization: authHeader(),
                Accept: "application/json",
              },
              rejectUnauthorized: sslVerify(),
            },
            onResponse,
          )
        : http.request(
            {
              hostname: parsed.hostname,
              port: parsed.port || undefined,
              path: pathWithQuery,
              method: "GET",
              headers: {
                Authorization: authHeader(),
                Accept: "application/json",
              },
            },
            onResponse,
          );
    req.on("error", reject);
    req.end();
  });
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

export async function fetchIssue(issueKey: string): Promise<JiraIssue> {
  const key = issueKey.trim();
  if (!key) throw new Error("issue_key is required");

  const url =
    `${requiredUrl()}/rest/api/2/issue/${encodeURIComponent(key)}` +
    `?expand=names,renderedFields`;
  return (await requestJson(url)) as JiraIssue;
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

function acceptanceCriteria(issue: JiraIssue): string | undefined {
  const names = issue.names ?? {};
  for (const [id, name] of Object.entries(names)) {
    if (!/acceptance/i.test(name)) continue;
    const text = fieldText(issue.fields[id] ?? issue.renderedFields?.[id]);
    if (text) return text;
  }

  const description = fieldText(issue.fields.description);
  const match = description.split(/\r?\n/).reduce<{
    collecting: boolean;
    lines: string[];
  }>(
    (acc, line) => {
      if (/acceptance\s*criteria/i.test(line)) {
        acc.collecting = true;
        return acc;
      }
      if (acc.collecting && /^#{1,3}\s+\S/.test(line)) {
        acc.collecting = false;
        return acc;
      }
      if (acc.collecting) acc.lines.push(line);
      return acc;
    },
    { collecting: false, lines: [] },
  );
  const extracted = match.lines.join("\n").trim();
  return extracted || undefined;
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
