import { convert } from "html-to-text";
import { config } from "../../../config";

const SNIPPET_CHARS = 280;
const MAX_PAGE_CHARS = 80_000;

function baseUrl(): string {
  const base = config.confluence.baseUrl.replace(/\/+$/, "");
  if (!base) {
    throw new Error("CONFLUENCE_BASE_URL is not set");
  }
  return base;
}

function authHeader(): string {
  const { personalToken, username, accessToken } = config.confluence;
  if (personalToken) return `Bearer ${personalToken}`;
  if (username && accessToken) {
    return `Basic ${Buffer.from(`${username}:${accessToken}`).toString("base64")}`;
  }
  throw new Error(
    "Missing Confluence credentials. Set CONFLUENCE_USERNAME + CONFLUENCE_ACCESS_TOKEN, or CONFLUENCE_PAT.",
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function escapeCql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Wrap a plain query as page CQL. A query that is already CQL is left as-is. */
export function confluenceCql(query: string, spaceKey = ""): string {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("search_docs needs a query");
  if (/\b(type|space|text|title|label|ancestor|parent)\s*(=|~|!=)/i.test(trimmed)) {
    return trimmed;
  }
  const space = spaceKey.trim();
  const spaceClause = space ? `space = "${escapeCql(space)}" AND ` : "";
  return `type = page AND ${spaceClause}text ~ "${escapeCql(trimmed)}"`;
}

/** Accept a page id, a Confluence URL, or a title from search_docs. */
export function parsePageRef(raw: string): { id?: string; title?: string } {
  const value = raw.trim();
  if (!value) {
    throw new Error("get_doc_page needs a page id or URL from search_docs");
  }
  const pages = value.match(/\/pages\/(\d+)/);
  if (pages?.[1]) return { id: pages[1] };
  const query = value.match(/[?&]pageId=(\d+)/i);
  if (query?.[1]) return { id: query[1] };
  if (/^\d+$/.test(value)) return { id: value };
  const title = value.replace(/^\/+|\/+$/g, "");
  if (!title) {
    throw new Error("get_doc_page needs a page id or URL from search_docs");
  }
  return { title };
}

export function confluencePageUrl(siteBase: string, webui: string): string {
  if (/^https?:\/\//i.test(webui)) return webui;
  const base = siteBase.replace(/\/+$/, "");
  const path = webui.startsWith("/") ? webui : `/${webui}`;
  if (path.startsWith("/wiki/") || path === "/wiki") {
    return `${new URL(base).origin}${path}`;
  }
  return `${base}${path}`;
}

export function htmlToDocText(html: string): string {
  const text = convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: false } },
      { selector: "img", format: "skip" },
    ],
  })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return "";
  if (text.length <= MAX_PAGE_CHARS) return text;
  return `${text.slice(0, MAX_PAGE_CHARS).trimEnd()}\n\n…(truncated)`;
}

function snippet(html: string): string {
  const text = htmlToDocText(html).replace(/\s+/g, " ").trim();
  if (text.length <= SNIPPET_CHARS) return text;
  return `${text.slice(0, SNIPPET_CHARS).trimEnd()}…`;
}

async function confluenceFetch(path: string): Promise<unknown> {
  const url = `${baseUrl()}${path}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: authHeader(),
    },
  });
  const text = await response.text();
  let parsed: unknown = text;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) {
    const detail =
      typeof parsed === "string"
        ? parsed.slice(0, 300)
        : JSON.stringify(parsed).slice(0, 300);
    throw new Error(`Confluence request failed (${response.status}): ${detail}`);
  }
  return parsed;
}

type PageContent = {
  id: string;
  title: string;
  space: string;
  url: string;
  body: string;
};

function pageFromContent(content: Record<string, unknown>): PageContent {
  const links = asRecord(content._links);
  const space = asRecord(content.space);
  const body = asRecord(content.body);
  const html =
    asString(asRecord(body.export_view).value) ||
    asString(asRecord(body.storage).value);
  const id = asString(content.id);
  const webui = asString(links.webui);
  return {
    id,
    title: asString(content.title) || id || "(untitled)",
    space: asString(space.key),
    url: webui ? confluencePageUrl(baseUrl(), webui) : "",
    body: htmlToDocText(html) || "(page has no body)",
  };
}

function formatPage(page: PageContent): string {
  const source = page.url || (page.id ? `id: ${page.id}` : page.title);
  const space = page.space ? `\nSpace: ${page.space}` : "";
  const id = page.id ? `\nid: ${page.id}` : "";
  return `# ${page.title}\n\nSource: ${source}${space}${id}\n\n${page.body}`;
}

export async function searchConfluenceDocs(
  query: string,
  limit: number,
): Promise<string> {
  const size = Math.min(10, Math.max(1, limit));
  const cql = confluenceCql(query, config.confluence.spaceKey);
  const payload = await confluenceFetch(
    `/rest/api/search?cql=${encodeURIComponent(cql)}&limit=${size}`,
  );
  const rows = Array.isArray(asRecord(payload).results)
    ? (asRecord(payload).results as unknown[])
    : [];

  const hits: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const item = asRecord(row);
    const content = asRecord(item.content);
    const type = asString(content.type) || asString(item.entityType);
    if (type && type !== "page" && type !== "content") continue;
    const id = asString(content.id);
    const title = asString(item.title) || asString(content.title) || id;
    const webui = asString(item.url) || asString(asRecord(content._links).webui);
    const key = id || webui || title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const url = webui ? confluencePageUrl(baseUrl(), webui) : "";
    const space = asString(asRecord(content.space).key);
    const blurb = snippet(asString(item.excerpt)) || "(no snippet — read the page)";
    hits.push(
      `${hits.length + 1}. ${title}\n` +
        `   id: ${id || "(see url)"}\n` +
        (space ? `   space: ${space}\n` : "") +
        (url ? `   url: ${url}\n` : "") +
        `   snippet: ${blurb}`,
    );
    if (hits.length >= size) break;
  }

  if (hits.length === 0) {
    return (
      "No matching Confluence pages. Try a more specific query, or pass CQL " +
      '(for example type=page AND text~"voting"). Then get_doc_page on the printed ids.'
    );
  }

  return (
    "Pass `id` (or `url`) to get_doc_page exactly as printed. " +
    "Read the page before answering — snippets are not the contract.\n\n" +
    hits.join("\n\n")
  );
}

async function loadPage(ref: string): Promise<PageContent> {
  const parsed = parsePageRef(ref);
  if (parsed.id) {
    const payload = await confluenceFetch(
      `/rest/api/content/${encodeURIComponent(parsed.id)}?expand=body.export_view,body.storage,space,version`,
    );
    return pageFromContent(asRecord(payload));
  }

  const title = parsed.title ?? ref;
  const cql = `type = page AND title = "${escapeCql(title)}"`;
  const payload = await confluenceFetch(
    `/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=1&expand=body.export_view,body.storage,space,version`,
  );
  const rows = Array.isArray(asRecord(payload).results)
    ? (asRecord(payload).results as unknown[])
    : [];
  const first = asRecord(rows[0]);
  if (!asString(first.id)) {
    throw new Error(`No Confluence page titled "${title}"`);
  }
  return pageFromContent(first);
}

export async function readConfluenceDocs(refs: string[]): Promise<string> {
  const unique = [...new Set(refs.map((ref) => ref.trim()).filter(Boolean))];
  if (unique.length === 0) {
    throw new Error("get_doc_page needs at least one page id or URL from search_docs");
  }
  const pages = await Promise.all(unique.slice(0, 8).map(loadPage));
  return pages.map(formatPage).join("\n\n---\n\n");
}
