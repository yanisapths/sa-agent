/** Indexes an arbitrary web page or text document into the knowledge base. */
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { Document } from "@langchain/core/documents";
import { apiSpecStore } from "../../database/chroma";
import { split, store } from "./store";

const TEXT_TYPES = /^text\/|application\/(json|xml|x-sql)/;
const TEXT_EXTENSIONS = /\.(txt|md|csv|json|xml|sql)$/i;

async function load(url: string): Promise<Document[]> {
  const head = await fetch(url, { method: "HEAD" }).catch(() => null);
  const contentType = head?.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("text/html") || /\.html?$/i.test(url)) {
    return new CheerioWebBaseLoader(url).load();
  }

  if (TEXT_TYPES.test(contentType) || TEXT_EXTENSIONS.test(url)) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url} (status ${response.status})`);
    }
    return [
      new Document({
        pageContent: await response.text(),
        metadata: { source: url },
      }),
    ];
  }

  throw new Error(`Unsupported content-type for indexing: ${contentType}`);
}

const url = process.argv[2];
if (!url) {
  throw new Error("Usage: bun run agents/ingest/url.ts <url>");
}

const chunks = await split(await load(url));
const stored = await store(apiSpecStore, chunks);
console.log(`indexed ${stored} chunks from ${url}`);
