function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

const POSTGRES_URI_EXAMPLE = "postgresql://user:password@host:5432/database";

/**
 * `pg` silently accepts a bare hostname and resolves it against a dummy base,
 * which surfaces much later as an opaque `getaddrinfo ENOTFOUND`. Reject
 * anything that is not a real connection URI up front.
 */
function postgresUrl(): string {
  const value = required("DATABASE_URL");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `DATABASE_URL must be a connection URI, e.g. ${POSTGRES_URI_EXAMPLE} (got "${value}")`,
    );
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(
      `DATABASE_URL must use the postgresql:// scheme, e.g. ${POSTGRES_URI_EXAMPLE}`,
    );
  }

  if (!parsed.hostname) {
    throw new Error(
      `DATABASE_URL is missing a host, e.g. ${POSTGRES_URI_EXAMPLE}`,
    );
  }

  return value;
}

function confluenceOrigin(): string {
  const raw = process.env.CONFLUENCE_BASE_URL;
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

export const config = {
  port: process.env.PORT ? Number(process.env.PORT) : 3000,
  corsOrigins: (process.env.CORS_ORIGIN || "http://localhost:3000").split(","),

  model: {
    /**
     * Cheap router. It retrieves, delegates, and stops at gates.
     * `AGENT_CHAT_MODEL` is an alias so existing .env files still work.
     */
    orchestrator:
      process.env.AGENT_ORCHESTRATOR_MODEL ||
      process.env.AGENT_CHAT_MODEL ||
      "anthropic:claude-haiku-4-5",
    discuss: process.env.AGENT_DISCUSS_MODEL || "anthropic:claude-haiku-4-5",
    plan: process.env.AGENT_PLAN_MODEL || "anthropic:claude-haiku-4-5",
    /** Local coder. Override if you want to runing coder model locally e.g.ollama:qwen2.5-coder */
    execute: process.env.AGENT_EXECUTE_MODEL || "anthropic:claude-haiku-4-5",
    test: process.env.AGENT_TEST_MODEL || "anthropic:claude-haiku-4-5",
    review: process.env.AGENT_REVIEW_MODEL || "anthropic:claude-haiku-4-5",
  },

  /** Live application database the agent introspects for schema truth. */
  postgres: {
    get url(): string {
      return postgresUrl();
    },
    schema: process.env.DATABASE_SCHEMA || "public",
    /** Read-only guard: aborts runaway agent queries. */
    statementTimeoutMs: 10_000,
    /** A firewalled host drops packets silently; fail instead of hanging. */
    connectionTimeoutMs: 10_000,
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

  /**
   * Jira MCP — Discuss only, when a ticket or user story is named.
   * Remote MCP is opt-in (`JIRA_MCP_URL`). Otherwise the local stdio
   * server talks to Jira REST using `JIRA_URL` + credentials, falling back to
   * the Confluence Cloud site/token when those are already set.
   */
  jira: {
    mcpUrl: process.env.JIRA_MCP_URL || "",
    mcpToken: process.env.JIRA_MCP_TOKEN || "",
    mcpTransport: process.env.JIRA_MCP_TRANSPORT === "sse" ? "sse" : "http",
    mcpCommand: process.env.JIRA_MCP_COMMAND || "",
    mcpArgs: process.env.JIRA_MCP_ARGS || "",
    url: process.env.JIRA_URL || confluenceOrigin(),
    username:
      process.env.JIRA_USERNAME || process.env.CONFLUENCE_USERNAME || "",
    apiToken:
      process.env.JIRA_API_TOKEN || process.env.CONFLUENCE_ACCESS_TOKEN || "",
    personalToken:
      process.env.JIRA_PERSONAL_TOKEN || process.env.JIRA_PAT || "",
    sslVerify: process.env.JIRA_SSL_VERIFY !== "false",
  },
} as const;
