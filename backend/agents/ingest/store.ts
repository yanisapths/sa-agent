import type { Document } from "@langchain/core/documents";
import type { Chroma } from "@langchain/community/vectorstores/chroma";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { config } from "../../config";
import { assertEmbeddingDimension } from "../../database/chroma";

const BATCH_SIZE = 100;

/**
 * `mxbai-embed-large` is 512 tokens. Dense JSON/spec text is ~2 chars/token,
 * so 2000-char chunks overflow. nomic-embed-text is 8192 tokens.
 */
function chunkLimits(model: string): { chunkSize: number; chunkOverlap: number } {
  if (/nomic-embed-text/i.test(model)) {
    return { chunkSize: 2000, chunkOverlap: 200 };
  }
  return { chunkSize: 800, chunkOverlap: 80 };
}

/** Chroma rejects arrays, nulls, and empty strings in metadata. */
function sanitize(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => {
      if (Array.isArray(value)) return [key, value.join(",") || "none"];
      if (value === "" || value == null) return [key, "none"];
      return [key, value];
    }),
  );
}

export async function split(docs: Document[]): Promise<Document[]> {
  const splitter = new RecursiveCharacterTextSplitter(
    chunkLimits(config.embeddings.model),
  );
  return splitter.splitDocuments(docs);
}

/** Embeds and upserts documents in batches, reporting progress. */
export async function store(
  collection: Chroma,
  docs: Document[],
): Promise<number> {
  await assertEmbeddingDimension();

  const prepared = docs.map((doc) => ({
    ...doc,
    metadata: sanitize(doc.metadata),
  }));

  for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
    const batch = prepared.slice(i, i + BATCH_SIZE);
    await addBatch(collection, batch);
    console.log(`stored ${i + batch.length}/${prepared.length}`);
  }

  return prepared.length;
}

function isContextLengthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /exceeds the context length/i.test(message);
}

/** Split an oversized batch (or document) instead of aborting the whole run. */
async function addBatch(
  collection: Chroma,
  batch: Document[],
): Promise<void> {
  try {
    await collection.addDocuments(batch);
  } catch (error) {
    if (!isContextLengthError(error)) throw error;

    if (batch.length > 1) {
      const mid = Math.ceil(batch.length / 2);
      await addBatch(collection, batch.slice(0, mid));
      await addBatch(collection, batch.slice(mid));
      return;
    }

    const [doc] = batch;
    if (doc.pageContent.length <= 200) throw error;

    const halves = await new RecursiveCharacterTextSplitter({
      chunkSize: Math.max(200, Math.floor(doc.pageContent.length / 2)),
      chunkOverlap: 40,
    }).splitDocuments([doc]);
    console.warn(
      `split oversized chunk (${doc.pageContent.length} chars) into ${halves.length}`,
    );
    for (const part of halves) {
      await addBatch(collection, [{ ...part, metadata: sanitize(part.metadata) }]);
    }
  }
}
