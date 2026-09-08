/** Indexes Confluence API specification pages into the knowledge base. */
import { ConfluencePagesLoader } from "@langchain/community/document_loaders/web/confluence";
import type { Document } from "@langchain/core/documents";
import {
  apiSpecStore,
  assertEmbeddingDimension,
} from "../../database/chroma";
import {
  isApiSpecTitle,
  parseConfluenceToDocuments,
} from "./parsers/confluence-spec";
import { split, store } from "./store";

/** Confluence Cloud caps this at 200; larger values are silently truncated. */
const PAGE_LIMIT = 200;

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
      limit: PAGE_LIMIT,
    });
  }

  const personalAccessToken = process.env.CONFLUENCE_PAT;
  if (personalAccessToken) {
    return new ConfluencePagesLoader({
      baseUrl,
      spaceKey,
      personalAccessToken,
      limit: PAGE_LIMIT,
    });
  }

  throw new Error(
    "Missing credentials: set CONFLUENCE_USERNAME + CONFLUENCE_ACCESS_TOKEN, or CONFLUENCE_PAT",
  );
}

async function main(): Promise<void> {
  await assertEmbeddingDimension();

  const pages = await createLoader().load();
  console.log(`loaded ${pages.length} pages`);

  const specPages = pages.filter((page) =>
    isApiSpecTitle(page.metadata.title),
  );
  console.log(
    `API spec pages: ${specPages.length} (skipped ${pages.length - specPages.length} non-spec)`,
  );

  const parsed: Document[] = specPages.flatMap(parseConfluenceToDocuments);

  if (parsed.length === 0) {
    console.warn("no API spec pages found — nothing to index");
    return;
  }

  const endpoints = [
    ...new Set(
      parsed
        .map((doc) => `${doc.metadata.method ?? ""} ${doc.metadata.endpoint ?? ""}`.trim())
        .filter(Boolean),
    ),
  ].sort();
  const services = [
    ...new Set(
      parsed
        .map((doc) => String(doc.metadata.service ?? ""))
        .filter((service) => service && service !== "unknown"),
    ),
  ].sort();
  console.log(`parsed ${parsed.length} documents from ${endpoints.length} endpoints`);
  console.log(`services: ${services.join(", ") || "(none)"}`);
  const newlyNamed = endpoints.filter((endpoint) =>
    /\/orch-admin-service\/.*\/(achievement|voting)/i.test(endpoint),
  );
  console.log(
    `orch-admin achievement/voting endpoints: ${newlyNamed.length}`,
  );
  for (const endpoint of newlyNamed) console.log(`  ${endpoint}`);

  const chunks = await split(parsed);
  console.log(`split into ${chunks.length} chunks`);
  const stored = await store(apiSpecStore, chunks);
  console.log(`indexed ${stored} chunks`);
}

await main();
