import { Chroma } from "@langchain/community/vectorstores/chroma";
import { OllamaEmbeddings } from "@langchain/ollama";

export const embeddings = new OllamaEmbeddings({
  model: process.env.OLLAMA_EMBED_MODEL,
  baseUrl: process.env.OLLAMA_URL,
});

export const vectorStore = new Chroma(embeddings, {
  collectionName: process.env.CHROMA_COLLECTION,
  chromaCloudAPIKey: process.env.CHROMA_API_KEY,
  clientParams: {
    host: "api.trychroma.com",
    port: 8000,
    ssl: true,
    tenant: process.env.CHROMA_TENANT,
    database: process.env.CHROMA_DATABASE,
  },
});
