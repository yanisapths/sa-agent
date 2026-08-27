import { Chroma } from "@langchain/community/vectorstores/chroma";
import { OllamaEmbeddings } from "@langchain/ollama";
import { config } from "../config";

export const embeddings = new OllamaEmbeddings({
  model: config.embeddings.model,
  baseUrl: config.embeddings.baseUrl,
});

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
