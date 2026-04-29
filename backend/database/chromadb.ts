import { Chroma } from "@langchain/community/vectorstores/chroma";
import { MistralAIEmbeddings } from "@langchain/mistralai";
// import { OllamaEmbeddings } from "@langchain/ollama";

// for local
// export const embeddings = new OllamaEmbeddings({
//   model: process.env.OLLAMA_EMBED_MODEL,
//   baseUrl: process.env.OLLAMA_URL,
// });

const embeddings = new MistralAIEmbeddings({
  model: "mistral-embed",
  apiKey: process.env.MISTRAL_API_KEY,
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

export const ddlStore = new Chroma(embeddings, {
  collectionName: "aster-database_ddl",
  chromaCloudAPIKey: process.env.CHROMA_API_KEY,
  clientParams: {
    host: "api.trychroma.com",
    port: 8000,
    ssl: true,
    tenant: process.env.CHROMA_TENANT,
    database: process.env.CHROMA_DATABASE,
  },
});
