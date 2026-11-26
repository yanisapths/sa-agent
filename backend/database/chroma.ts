import { Chroma } from "@langchain/community/vectorstores/chroma";
import { OllamaEmbeddings } from "@langchain/ollama";
import { config } from "../config";

export const embeddings = new OllamaEmbeddings({
  model: config.embeddings.model,
  baseUrl: config.embeddings.baseUrl,
  dimensions: config.embeddings.dimension,
  /** Last resort if a chunk still tokenizes past the model window. */
  truncate: true,
});

let dimensionCheck: Promise<void> | undefined;

/**
 * Chroma upserts fail after ingest if the model width does not match the
 * collection. Probe once so ingest scripts fail before fetching pages.
 */
export async function assertEmbeddingDimension(): Promise<void> {
  dimensionCheck ??= (async () => {
    const expected = config.embeddings.dimension;
    const vector = await embeddings.embedQuery("dimension probe");
    const actual = vector.length;
    console.log(
      `embedding model ${config.embeddings.model} → ${actual}-d` +
        (expected ? ` (expected ${expected})` : ""),
    );
    if (expected != null && actual !== expected) {
      throw new Error(
        `Embedding model "${config.embeddings.model}" produced ${actual}-d vectors, ` +
          `but ${expected} was requested. Dimension cannot be scaled up — ` +
          `use a native ${expected}-d model (e.g. mxbai-embed-large for 1024) ` +
          `via --embedding-model or OLLAMA_EMBED_MODEL.`,
      );
    }
  })();
  return dimensionCheck;
}

/**
 * Memoized by collection name. The Chroma tenant, key and embeddings are
 * shared; only the collection differs per product.
 */
const collections = new Map<string, Chroma>();

export function collection(name: string): Chroma {
  const cached = collections.get(name);
  if (cached) return cached;
  const store = new Chroma(embeddings, {
    collectionName: name,
    chromaCloudAPIKey: config.chroma.apiKey,
    clientParams: {
      host: config.chroma.host,
      port: 8000,
      ssl: true,
      tenant: config.chroma.tenant,
      database: config.chroma.database,
    },
  });
  collections.set(name, store);
  return store;
}

export type ProductStores = {
  /** Confluence API specifications and internal knowledge. */
  apiSpec?: Chroma;
  /** Indexed DDL / schema documentation. */
  ddl?: Chroma;
};

export function storesFor(index: {
  apiSpecCollection?: string;
  ddlCollection?: string;
}): ProductStores {
  return {
    ...(index.apiSpecCollection ? { apiSpec: collection(index.apiSpecCollection) } : {}),
    ...(index.ddlCollection ? { ddl: collection(index.ddlCollection) } : {}),
  };
}

/** Document count per configured collection, for the connection test. */
export async function collectionCounts(index: {
  apiSpecCollection?: string;
  ddlCollection?: string;
}): Promise<{ name: string; count: number | null; error?: string }[]> {
  const names = [index.apiSpecCollection, index.ddlCollection].filter(
    (name): name is string => Boolean(name),
  );
  return Promise.all(
    names.map(async (name) => {
      try {
        const handle = await collection(name).ensureCollection();
        return { name, count: await handle.count() };
      } catch (err) {
        return { name, count: null, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
}
