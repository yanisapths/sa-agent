/** Indexes Confluence API specification pages into the knowledge base. */
import { ConfluencePagesLoader } from "@langchain/community/document_loaders/web/confluence";
import type { Document } from "@langchain/core/documents";
import { apiSpecStore } from "../../database/chroma";
import { parseConfluenceToDocuments } from "./parsers/confluence-spec";
import { split, store } from "./store";

const API_PAGE_TITLE = /^\[(GET|POST|PUT|DELETE|PATCH)\]/i;

function createLoader(): ConfluencePagesLoader {
  const baseUrl = process.env.CONFLUENCE_BASE_URL;
  const spaceKey = process.env.CONFLUENCE_SPACE_KEY;
  if (!baseUrl || !spaceKey) {
    throw new Error("Missing CONFLUENCE_BASE_URL or CONFLUENCE_SPACE_KEY");
  }

  const username = process.env.CONFLUENCE_USERNAME;
  const accessToken = process.env.CONFLUENCE_ACCESS_TOKEN;
  if (username && accessToken) {
    return new ConfluencePagesLoader({
      baseUrl,
      spaceKey,
      username,
      accessToken,
    });
  }

  const personalAccessToken = process.env.CONFLUENCE_PAT;
  if (personalAccessToken) {
    return new ConfluencePagesLoader({
      baseUrl,
      spaceKey,
      personalAccessToken,
    });
  }

  throw new Error(
    "Missing credentials: set CONFLUENCE_USERNAME + CONFLUENCE_ACCESS_TOKEN, or CONFLUENCE_PAT",
  );
}

async function main(): Promise<void> {
  const pages = await createLoader().load();
  console.log(`loaded ${pages.length} pages`);

  const parsed: Document[] = pages
    .filter((page) => API_PAGE_TITLE.test(page.metadata.title ?? ""))
    .flatMap(parseConfluenceToDocuments);

  if (parsed.length === 0) {
    console.warn("no API spec pages found — nothing to index");
    return;
  }
  console.log(`parsed ${parsed.length} documents`);

  const chunks = await split(parsed);
  const stored = await store(apiSpecStore, chunks);
  console.log(`indexed ${stored} chunks`);
}

await main();
