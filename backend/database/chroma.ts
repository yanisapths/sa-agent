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

function collection(name: string): Chroma {
  return new Chroma(embeddings, {
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
}

/** Confluence API specifications and internal knowledge. */
export const apiSpecStore = collection(config.chroma.apiSpecCollection);

/** Indexed DDL / schema documentation. */
export const ddlStore = collection(config.chroma.ddlCollection);
