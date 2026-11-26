/** Indexes Confluence API specification pages into the knowledge base. */
import { ConfluencePagesLoader } from "@langchain/community/document_loaders/web/confluence";
import type { Document } from "@langchain/core/documents";
import { assertEmbeddingDimension } from "../../database/chroma";
import type { ResolvedProduct } from "../../internal/product/types";
import { ingestConfluenceSource, ingestProduct, requiredCollection } from "./product";
import {
  isApiSpecTitle,
  parseConfluenceToDocuments,
} from "./parsers/confluence-spec";
import { split, store } from "./store";

/** Confluence Cloud caps this at 200; larger values are silently truncated. */
const PAGE_LIMIT = 200;

function createLoader(product: ResolvedProduct): ConfluencePagesLoader {
  const source = ingestConfluenceSource(product);
  const { baseUrl, spaceKey } = source;

  if (source.username && source.accessToken) {
    return new ConfluencePagesLoader({
      baseUrl,
      spaceKey,
      username: source.username,
      accessToken: source.accessToken,
      limit: PAGE_LIMIT,
    });
  }

  if (source.personalAccessToken) {
    return new ConfluencePagesLoader({
      baseUrl,
      spaceKey,
      personalAccessToken: source.personalAccessToken,
      limit: PAGE_LIMIT,
    });
  }

  if (!product.isDefault) {
    console.log("no token for this product's space — ingesting anonymously");
    return new ConfluencePagesLoader({ baseUrl, spaceKey, limit: PAGE_LIMIT });
  }

  throw new Error(
    "Missing credentials: set CONFLUENCE_USERNAME + CONFLUENCE_ACCESS_TOKEN, or CONFLUENCE_PAT",
  );
}

async function main(): Promise<void> {
  const product = await ingestProduct();
  const apiSpecStore = requiredCollection(product, "apiSpecCollection");
  console.log(`product ${product.slug} → ${apiSpecStore.collectionName}`);
  await assertEmbeddingDimension();

  const pages = await createLoader(product).load();
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
