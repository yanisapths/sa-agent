import type { Document } from "@langchain/core/documents";
import type { Chroma } from "@langchain/community/vectorstores/chroma";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const BATCH_SIZE = 100;

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
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 2000,
    chunkOverlap: 200,
  });
  return splitter.splitDocuments(docs);
}

/** Embeds and upserts documents in batches, reporting progress. */
export async function store(
  collection: Chroma,
  docs: Document[],
): Promise<number> {
  const prepared = docs.map((doc) => ({
    ...doc,
    metadata: sanitize(doc.metadata),
  }));

  for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
    const batch = prepared.slice(i, i + BATCH_SIZE);
    await collection.addDocuments(batch);
    console.log(`stored ${i + batch.length}/${prepared.length}`);
  }

  return prepared.length;
}
