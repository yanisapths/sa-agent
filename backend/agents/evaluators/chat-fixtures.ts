import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { CHAT_TOOLS } from "../chat-agent";

const BILLING_PATH = "billing/overview";
const BILLING_PAGE = `Billing records live in the invoices table (id, customer_id, amount, status).
Known product APIs:
- GET /invoices — list invoices
- GET /invoices/{id} — invoice detail
There is no POST /orders/v2/export endpoint in this product.
Do not invent paths.`;

const TICKET = `PROJ-123
Summary: Billing export for finance
Status: In Progress
Assignee: Ada Lovelace
Description: Export invoices for the finance close. Billing data lives in the invoices table.`;

function hitsFor(query: string): string {
  const q = query.toLowerCase();
  if (/billing|invoice/.test(q)) {
    return JSON.stringify(
      [
        {
          title: "Billing overview",
          path: BILLING_PATH,
          snippet: "Billing records are stored in the invoices table.",
        },
      ],
      null,
      2,
    );
  }
  if (/export|orders\/v2/.test(q)) {
    return JSON.stringify(
      [
        {
          title: "Billing overview",
          path: BILLING_PATH,
          snippet: "Known APIs: GET /invoices. No POST /orders/v2/export.",
        },
      ],
      null,
      2,
    );
  }
  return JSON.stringify(
    [{ title: "No strong hit", path: "index", snippet: `No page matched "${query}".` }],
    null,
    2,
  );
}

const searchDocs = tool(
  async ({ query }: { query: string }) => hitsFor(query),
  {
    name: "search_docs",
    description:
      "Scan product documentation for API contracts, endpoints, auth, and conventions. Returns titles, paths, and short snippets only — never answer from snippets. Follow up with get_doc_page on the matching paths.",
    schema: z.object({
      query: z.string(),
      limit: z.number().int().min(1).max(10).default(5),
    }),
  },
);

const getDocPage = tool(
  async ({ paths }: { paths: string[] }) => {
    return paths
      .map((slug) => {
        const path = slug.replace(/^\//, "");
        if (path === BILLING_PATH || /billing|invoice/.test(path)) {
          return `# ${BILLING_PATH}\n\n${BILLING_PAGE}`;
        }
        return `# ${path}\n\nNo page at this slug.`;
      })
      .join("\n\n");
  },
  {
    name: "get_doc_page",
    description:
      "Read full documentation pages by the path field from search_docs. Pass the slug exactly, no leading slash.",
    schema: z.object({
      paths: z.array(z.string()).min(1).max(8),
    }),
  },
);

const searchSchemaDocs = tool(
  async ({ query }: { query: string }) =>
    /invoice|billing|customer/.test(query.toLowerCase())
      ? "DDL snapshot: invoices(id, customer_id, amount, status); customers(id, name)."
      : `No DDL snapshot for "${query}".`,
  {
    name: "search_schema_docs",
    description: "Search indexed DDL documentation for tables and columns.",
    schema: z.object({
      query: z.string(),
      limit: z.number().int().min(1).max(10).default(5),
    }),
  },
);

const listTables = tool(async () => "tables: customers, invoices", {
  name: "list_tables",
  description: "List every table and view in the live application database.",
  schema: z.object({}),
});

const describeTables = tool(
  async ({ tables }: { tables: string[] }) =>
    tables
      .map((table) => {
        if (table === "invoices") {
          return "invoices: id uuid pk, customer_id uuid not null, amount numeric, status text";
        }
        if (table === "customers") {
          return "customers: id uuid pk, name text";
        }
        return `${table}: table does not exist`;
      })
      .join("\n"),
  {
    name: "describe_tables",
    description: "Return live column definitions for one or more tables.",
    schema: z.object({ tables: z.array(z.string()).min(1) }),
  },
);

const inspectRelationships = tool(
  async () => "invoices.customer_id -> customers.id",
  {
    name: "inspect_relationships",
    description: "Return the live foreign key graph.",
    schema: z.object({ tables: z.array(z.string()).optional() }),
  },
);

const runSql = tool(
  async ({ sql }: { sql: string }) => {
    if (/invoices/i.test(sql) && /select/i.test(sql)) {
      return JSON.stringify([
        { id: "inv_1", customer_id: "cus_1", amount: 40, status: "open" },
        { id: "inv_2", customer_id: "cus_2", amount: 15, status: "paid" },
      ]);
    }
    return "ERROR: relation does not exist";
  },
  {
    name: "run_sql",
    description: "Execute a single SQL statement against the live database.",
    schema: z.object({ sql: z.string() }),
  },
);

const getPresentDatetime = tool(
  async () => "2026-09-17T03:36:00+07:00 (year 2026)",
  {
    name: "get_present_datetime",
    description: "Return the actual present date, time, timezone, and calendar year.",
    schema: z.object({}),
  },
);

const webSearch = tool(
  async ({ query }: { query: string }) =>
    `Public web results for "${query}". This is not product documentation. Do not use these hits for this product's APIs.`,
  {
    name: "web_search",
    description:
      "Search the public web for current facts or news. Do not use for this product's APIs, endpoints, or documentation — use search_docs instead.",
    schema: z.object({
      query: z.string(),
      limit: z.number().int().min(1).max(8).default(5),
    }),
  },
);

const getJiraTicket = tool(
  async ({ issue_key }: { issue_key: string }) =>
    issue_key.toUpperCase() === "PROJ-123"
      ? TICKET
      : `No ticket ${issue_key} in the eval fixture.`,
  {
    name: "get_jira_ticket",
    description:
      "Fetch a Jira ticket (summary, status, assignee, description). ONLY when the user names a ticket.",
    schema: z.object({ issue_key: z.string() }),
  },
);

const readJiraUserStory = tool(
  async ({ issue_key }: { issue_key: string }) =>
    issue_key.toUpperCase() === "PROJ-123"
      ? `${TICKET}\nAcceptance: finance can export invoices.`
      : `No user story ${issue_key} in the eval fixture.`,
  {
    name: "read_jira_user_story",
    description: "Read a Jira user story. ONLY when the user asks to read a user story.",
    schema: z.object({ issue_key: z.string() }),
  },
);

const searchJira = tool(
  async ({ query }: { query: string }) =>
    /PROJ-123|billing|invoice/i.test(query)
      ? "PROJ-123 | Story | In Progress | Billing export for finance"
      : `No Jira hits for "${query}".`,
  {
    name: "search_jira",
    description: "Search Jira by text, JQL, or an issue key.",
    schema: z.object({
      query: z.string(),
      limit: z.number().int().min(1).max(20).default(8),
    }),
  },
);

const FIXTURES: Record<string, StructuredToolInterface> = {
  search_docs: searchDocs,
  get_doc_page: getDocPage,
  search_schema_docs: searchSchemaDocs,
  list_tables: listTables,
  describe_tables: describeTables,
  inspect_relationships: inspectRelationships,
  run_sql: runSql,
  get_present_datetime: getPresentDatetime,
  web_search: webSearch,
  search_jira: searchJira,
  get_jira_ticket: getJiraTicket,
  read_jira_user_story: readJiraUserStory,
};

/** Same names as production CHAT_TOOLS; canned data, no Mintlify/Postgres/Jira. */
export function chatFixtureTools(): StructuredToolInterface[] {
  return CHAT_TOOLS.map((name) => {
    const toolImpl = FIXTURES[name];
    if (!toolImpl) throw new Error(`Missing chat fixture for ${name}`);
    return toolImpl;
  });
}
