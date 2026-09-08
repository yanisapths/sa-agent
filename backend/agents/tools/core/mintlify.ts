import { config } from "../../../config";

const SNIPPET_CHARS = 280;

export type MintlifySearchHit = {
  path: string;
  title: string;
  snippet: string;
  score?: number;
};

function bearerToken(): string {
  const raw = config.mintlify.auth.trim();
  if (!raw) {
    throw new Error(
      "MINTLIFY_AUTH is not set. Use the deployment assistant API key (mint_dsc_…).",
    );
  }
  return raw.replace(/^Bearer\s+/i, "");
}

function siteOrigin(): string {
  return `https://${config.mintlify.domain}.mintlify.site`;
}

/**
 * Discovery search returns repo-style slugs with no leading slash
 * (`aster-admin/orch-admin-service/voting/overview`). A leading slash, a
 * `.mdx` suffix, or the hosted `mintlify.site` URL all 404 on /v1/page.
 */
export function normalizeDocPath(raw: string): string {
  let value = raw.trim();
  const origin = siteOrigin();
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.origin === origin) value = url.pathname;
    } catch {
      /* keep value */
    }
  }
  return value.replace(/^\/+|\/+$/g, "").replace(/\.(mdx|md)$/i, "");
}

function siteUrl(path: string): string {
  return `${siteOrigin()}/${normalizeDocPath(path)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function metadataTitle(metadata: unknown, path: string): string {
  const meta = asRecord(metadata);
  return (
    asString(meta.title) ||
    asString(meta.heading) ||
    path.replace(/^\/+|\/+$/g, "") ||
    "(untitled)"
  );
}

function snippet(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= SNIPPET_CHARS) return compact;
  return `${compact.slice(0, SNIPPET_CHARS).trimEnd()}…`;
}

function extractPageBody(payload: unknown): string {
  const body = asRecord(payload);
  if (typeof body.content === "string" && body.content) return body.content;
  if (typeof body.markdown === "string" && body.markdown) return body.markdown;
  if (typeof body.text === "string" && body.text) return body.text;
  const nested = asRecord(body.content);
  if (typeof nested.markdown === "string" && nested.markdown) {
    return nested.markdown;
  }
  if (typeof nested.text === "string" && nested.text) return nested.text;
  throw new Error("Mintlify page response had no text content");
}

async function discoveryPost(
  route: "search" | "page",
  body: Record<string, unknown>,
): Promise<unknown> {
  const { domain, discoveryBaseUrl } = config.mintlify;
  const response = await fetch(
    `${discoveryBaseUrl}/v1/${route}/${encodeURIComponent(domain)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

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
        ? parsed.slice(0, 400)
        : JSON.stringify(parsed).slice(0, 400);
    throw new Error(`Mintlify ${route} failed (${response.status}): ${detail}`);
  }

  return parsed;
}

export async function mintlifySearch(
  query: string,
  pageSize: number,
): Promise<MintlifySearchHit[]> {
  const groups = config.mintlify.groups;
  const payload = await discoveryPost("search", {
    query,
    pageSize,
    ...(groups.length > 0 ? { filter: { groups } } : {}),
  });

  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(asRecord(payload).results)
      ? (asRecord(payload).results as unknown[])
      : [];

  const seen = new Set<string>();
  const hits: MintlifySearchHit[] = [];
  for (const row of rows) {
    const item = asRecord(row);
    const path = asString(item.path) || asString(item.page);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    hits.push({
      path,
      title: metadataTitle(item.metadata, path),
      snippet: snippet(asString(item.content) || asString(item.text)),
      score: asNumber(item.score) ?? asNumber(asRecord(item.metadata).score),
    });
  }
  return hits;
}

export async function mintlifyPage(path: string): Promise<{
  path: string;
  url: string;
  content: string;
}> {
  const groups = config.mintlify.groups;
  const slug = normalizeDocPath(path);
  if (!slug) {
    throw new Error(
      "get_doc_page needs a path from search_docs (no leading slash)",
    );
  }
  const payload = await discoveryPost("page", {
    path: slug,
    ...(groups.length > 0 ? { groups } : {}),
  });
  const body = asRecord(payload);
  const resolved = asString(body.path) || slug;
  return {
    path: resolved,
    url: siteUrl(resolved),
    content: extractPageBody(payload),
  };
}

export function formatSearchHits(hits: MintlifySearchHit[]): string {
  if (hits.length === 0) {
    return (
      "No matching documentation pages. If this site is group-gated, set " +
      "MINTLIFY_GROUPS. Otherwise try a more specific query, then get_doc_page " +
      "on the paths that look right."
    );
  }

  const header =
    "Pass `path` to get_doc_page exactly as printed (no leading slash). " +
    "Do not fetch mintlify.site URLs — they often 404; use get_doc_page instead.\n\n";

  return (
    header +
    hits
      .map((hit, i) => {
        const score =
          hit.score === undefined ? "" : `  score: ${hit.score.toFixed(3)}`;
        const blurb = hit.snippet || "(no snippet — read the page)";
        return (
          `${i + 1}. ${hit.title}\n` +
          `   path: ${hit.path}\n` +
          `   url: ${siteUrl(hit.path)}${score}\n` +
          `   snippet: ${blurb}`
        );
      })
      .join("\n\n")
  );
}

export function formatPage(page: {
  path: string;
  url: string;
  content: string;
}): string {
  return `# ${page.path}\n\nSource: ${page.url}\n\n${page.content}`;
}
