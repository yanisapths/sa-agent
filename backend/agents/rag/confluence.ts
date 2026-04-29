import { Document } from "@langchain/core/documents";
import { ConfluencePagesLoader } from "@langchain/community/document_loaders/web/confluence";
import { parseConfluenceToDocuments } from "../parser/api-spec-parser/confluence-parser";
import { vectorStore } from "../../database/chromadb";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const username = process.env.CONFLUENCE_USERNAME;
const accessToken = process.env.CONFLUENCE_ACCESS_TOKEN;
const personalAccessToken = process.env.CONFLUENCE_PAT;

function createLoader(): ConfluencePagesLoader | null {
  if (username && accessToken) {
    return new ConfluencePagesLoader({
      baseUrl: process.env.CONFLUENCE_BASE_URL!,
      spaceKey: process.env.CONFLUENCE_SPACE_KEY!,
      username,
      accessToken,
    });
  }
  if (personalAccessToken) {
    return new ConfluencePagesLoader({
      baseUrl: process.env.CONFLUENCE_BASE_URL!,
      spaceKey: process.env.CONFLUENCE_SPACE_KEY!,
      personalAccessToken,
    });
  }
  console.error("You need either (username + accessToken) or CONFLUENCE_PAT");
  return null;
}

async function loadAndParse(): Promise<Document[]> {
  const loader = createLoader();
  if (!loader) throw new Error("Could not create Confluence loader");

  console.log("Loading Confluence pages...");
  const rawDocs = await loader.load();
  console.log(`Loaded ${rawDocs.length} raw pages\n`);

  const parsedDocs: Document[] = [];

  for (const [index, doc] of rawDocs.entries()) {
    const title = doc.metadata.title ?? "untitled";

    if (!title.match(/^\[(GET|POST|PUT|DELETE|PATCH)\]/i)) {
      continue;
    }

    const parsed = parseConfluenceToDocuments(doc);
    parsedDocs.push(...parsed);

    console.log(
      `[${index + 1}/${rawDocs.length}] ${title} → ${parsed.length} docs`,
    );
    parsed.forEach((p, i) => {
      console.log(`     [${i + 1}] type=${p.metadata.type}`);
    });
  }

  console.log(
    `\nParsed ${parsedDocs.length} documents from ${rawDocs.length} pages\n`,
  );
  return parsedDocs;
}

// ─── Step 2: Split ────────────────────────────────────────────────────────────

async function splitDocs(docs: Document[]): Promise<Document[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 2000,
    chunkOverlap: 200,
  });

  const splits = await splitter.splitDocuments(docs);

  const totalChars = splits.reduce((sum, d) => sum + d.pageContent.length, 0);
  const estimatedTokens = Math.round(totalChars / 4);
  const estimatedCostUSD = ((estimatedTokens / 1_000_000) * 0.1).toFixed(6); // text-embedding-3-small

  console.log("📊 Split summary:");
  console.log(`   chunks       : ${splits.length}`);
  console.log(`   est. tokens  : ${estimatedTokens.toLocaleString()}`);
  console.log(`   est. cost    : $${estimatedCostUSD} USD\n`);

  return splits;
}

// ─── Step 3: Embed + Store ────────────────────────────────────────────────────
async function embedAndStore(splits: Document[]): Promise<void> {
  const BATCH_SIZE = 100;
  let stored = 0;

  const sanitizedDocs = splits.map((doc) => ({
    ...doc,
    metadata: sanitizeMetadata(doc.metadata),
  }));

  for (let i = 0; i < sanitizedDocs.length; i += BATCH_SIZE) {
    const batch = sanitizedDocs.slice(i, i + BATCH_SIZE);
    try {
      await vectorStore.addDocuments(batch);
      stored += batch.length;
      console.log(
        `   ✅ Stored batch ${Math.ceil((i + 1) / BATCH_SIZE)} — ${stored}/${sanitizedDocs.length} chunks`,
      );
    } catch (err) {
      console.error(
        `   ❌ Batch ${Math.ceil((i + 1) / BATCH_SIZE)} failed:`,
        err,
      );
      throw err;
    }
  }

  console.log(`\n✅ All ${stored} chunks stored in vector store\n`);
}
// ─── Pipeline ─────────────────────────────────────────────────────────────────

async function indexConfluence(): Promise<void> {
  console.log("🚀 Starting Confluence indexing pipeline\n");

  // 1. Load raw pages → parse into structured documents
  const parsedDocs = await loadAndParse();
  if (parsedDocs.length === 0) {
    console.warn("⚠️  No API spec pages found — nothing to index");
    return;
  }

  // 2. Split into chunks
  const splits = await splitDocs(parsedDocs);

  // 3. Embed and store
  await embedAndStore(splits);

  console.log("🎉 Indexing complete");
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

indexConfluence().catch((err) => {
  console.error("❌ Pipeline failed:", err);
  process.exit(1);
});

function sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (Array.isArray(value)) {
      cleaned[key] = value.length > 0 ? value.join(",") : "none";
    } else if (value === "" || value === null || value === undefined) {
      cleaned[key] = "none";
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}
