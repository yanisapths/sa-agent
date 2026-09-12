const USER_AGENT = "sa-agent/0.1 (+https://github.com/sa-agent)";
const MAX_QUERY = 200;
const MAX_HITS = 8;

export type WebHit = {
  title: string;
  url: string;
  snippet: string;
};

function decodeDdgHref(href: string): string {
  try {
    const parsed = new URL(href, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return uddg;
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    /* keep href */
  }
  return href;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHtmlHits(html: string, limit: number): WebHit[] {
  const hits: WebHit[] = [];
  const block =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|span)>|)/gi;
  for (const match of html.matchAll(block)) {
    const url = decodeDdgHref(decodeHtml(match[1] ?? ""));
    const title = decodeHtml(match[2] ?? "");
    const snippet = decodeHtml(match[3] ?? "");
    if (!url || !title || url.includes("duckduckgo.com")) continue;
    hits.push({ title, url, snippet });
    if (hits.length >= limit) break;
  }
  return hits;
}

async function searchHtml(query: string, limit: number): Promise<WebHit[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!response.ok) {
    throw new Error(`DuckDuckGo HTML ${response.status}`);
  }
  return parseHtmlHits(await response.text(), limit);
}

type InstantTopic = {
  Text?: string;
  FirstURL?: string;
  Topics?: InstantTopic[];
};

function flattenTopics(topics: InstantTopic[] | undefined, into: WebHit[]): void {
  if (!topics) return;
  for (const topic of topics) {
    if (topic.FirstURL && topic.Text) {
      into.push({
        title: topic.Text.split(" - ")[0] ?? topic.Text,
        url: topic.FirstURL,
        snippet: topic.Text,
      });
    }
    flattenTopics(topic.Topics, into);
  }
}

async function searchInstant(query: string, limit: number): Promise<WebHit[]> {
  const url =
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}` +
    `&format=json&no_html=1&skip_disambig=1`;
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`DuckDuckGo instant ${response.status}`);
  }
  const data = (await response.json()) as {
    Heading?: string;
    AbstractText?: string;
    AbstractURL?: string;
    Answer?: string;
    Results?: InstantTopic[];
    RelatedTopics?: InstantTopic[];
  };
  const hits: WebHit[] = [];
  if (data.AbstractText && data.AbstractURL) {
    hits.push({
      title: data.Heading || query,
      url: data.AbstractURL,
      snippet: data.AbstractText,
    });
  } else if (data.Answer) {
    hits.push({ title: data.Heading || query, url: "", snippet: data.Answer });
  }
  flattenTopics(data.Results, hits);
  flattenTopics(data.RelatedTopics, hits);
  return hits.slice(0, limit);
}

function formatHits(query: string, hits: WebHit[]): string {
  if (hits.length === 0) {
    return `No web results for ${JSON.stringify(query)}.`;
  }
  return [
    `Web search for ${JSON.stringify(query)}:`,
    ...hits.map((hit, index) => {
      const link = hit.url ? `\n  ${hit.url}` : "";
      const snippet = hit.snippet ? `\n  ${hit.snippet}` : "";
      return `${index + 1}. ${hit.title}${link}${snippet}`;
    }),
  ].join("\n");
}

/** Public web search. No API key — DuckDuckGo HTML, then the instant-answer API. */
export async function webSearch(query: string, limit = 5): Promise<string> {
  const trimmed = query.trim().slice(0, MAX_QUERY);
  if (!trimmed) return "web_search needs a query.";

  const cap = Math.min(Math.max(limit, 1), MAX_HITS);
  const errors: string[] = [];

  try {
    const htmlHits = await searchHtml(trimmed, cap);
    if (htmlHits.length > 0) return formatHits(trimmed, htmlHits);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  try {
    const instantHits = await searchInstant(trimmed, cap);
    if (instantHits.length > 0) return formatHits(trimmed, instantHits);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  if (errors.length > 0) {
    return `Web search is unavailable: ${errors.join("; ")}`;
  }
  return formatHits(trimmed, []);
}
