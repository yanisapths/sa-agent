import { Chroma } from "@langchain/community/vectorstores/chroma";
import { OllamaEmbeddings } from "@langchain/ollama";
import { BedrockEmbeddings } from "@langchain/aws";

// export const embeddings = new OllamaEmbeddings({
//   model: process.env.OLLAMA_EMBED_MODEL,
//   baseUrl: process.env.OLLAMA_URL,
// });

const embeddings = new BedrockEmbeddings({
  model: "amazon.titan-embed-text-v1",
  region: process.env.BEDROCK_AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
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
