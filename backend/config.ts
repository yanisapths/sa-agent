function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

export const config = {
  port: process.env.PORT ? Number(process.env.PORT) : 3000,
  corsOrigins: (process.env.CORS_ORIGIN || "http://localhost:3000").split(","),

  model: {
    /** Passed straight to LangChain's `initChatModel` (`provider:model`). */
    chat: process.env.AGENT_CHAT_MODEL || "anthropic:claude-sonnet-4-5",
  },

  /** Live application database the agent introspects for schema truth. */
  postgres: {
    get url(): string {
      return required("DATABASE_URL");
    },
    schema: process.env.DATABASE_SCHEMA || "public",
    /** Read-only guard: aborts runaway agent queries. */
    statementTimeoutMs: 10_000,
    maxRows: 200,
  },

  chroma: {
    apiKey: process.env.CHROMA_API_KEY,
    host: process.env.CHROMA_HOST || "api.trychroma.com",
    tenant: process.env.CHROMA_TENANT,
    database: process.env.CHROMA_DATABASE,
    apiSpecCollection: process.env.CHROMA_API_COLLECTION || "aster-system",
    ddlCollection: process.env.CHROMA_DDL_COLLECTION || "aster-database_ddl",
  },

  embeddings: {
    model: process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text",
    baseUrl: process.env.OLLAMA_URL || "http://localhost:11434",
  },

  supabase: {
    vaultBucket: process.env.SUPABASE_VAULT_BUCKET || "vault",
    /** Optional object-key prefix inside the bucket, e.g. `vault`. */
    vaultFolder: process.env.VAULT_STORAGE_FOLDER || "",
  },

  vault: {
    defaultUserId: process.env.VAULT_DEFAULT_USER_ID || "user_1",
    devToken: process.env.VAULT_DEV_TOKEN || "",
    maxFileBytes: 20 * 1024 * 1024,
  },
} as const;
