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

/** `bun run ingest:… -- --embedding-model mxbai-embed-large` */
function argvFlag(name: string): string | undefined {
  const flag = `--${name}`;
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === flag) return argv[i + 1];
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

function embeddingDimension(): number | undefined {
  const raw =
    argvFlag("embedding-model-dimension") || process.env.OLLAMA_EMBED_DIMENSION;
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid embedding dimension: ${raw}`);
  }
  return value;
}

/** `BIFROST_MODEL` etc., falling back to the gateway handout's bare names. */
function bifrostEnv(name: string): string | undefined {
  return process.env[`BIFROST_${name}`] || process.env[name];
}

function positiveInt(name: string, fallback: number): number {
  const raw = bifrostEnv(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `BIFROST_${name} must be a positive integer (got "${raw}")`,
    );
  }
  return value;
}

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (got "${raw}")`);
  }
  return value;
}

/**
 * The Bifrost gateway is on when a base URL is present. Everything downstream
 * keys off this, including which model ids the phase defaults use.
 */
const bifrostBaseUrl = (process.env.BIFROST_BASE_URL || "").replace(/\/+$/, "");

/** `provider/model` through the gateway, or haiku direct when it is off. */
const defaultModel = bifrostBaseUrl
  ? bifrostEnv("MODEL") || "dashscope/qwen3.7-flash"
  : "anthropic:claude-haiku-4-5";

export const config = {
  port: process.env.PORT ? Number(process.env.PORT) : 3000,
  corsOrigins: (process.env.CORS_ORIGIN || "http://localhost:3000").split(","),

  /**
   * A model id routes itself: `provider/model` goes through Bifrost,
   * `provider:model` goes straight to that provider. See `agents/model.ts`.
   */
  model: {
    /**
     * Cheap router. It retrieves, delegates, and stops at gates.
     * `AGENT_CHAT_MODEL` is an alias so existing .env files still work.
     */
    orchestrator:
      process.env.AGENT_ORCHESTRATOR_MODEL ||
      process.env.AGENT_CHAT_MODEL ||
      defaultModel,
    discuss: process.env.AGENT_DISCUSS_MODEL || defaultModel,
    plan: process.env.AGENT_PLAN_MODEL || defaultModel,
    /** Local coder. Override if you want to runing coder model locally e.g.ollama:qwen2.5-coder */
    execute: process.env.AGENT_EXECUTE_MODEL || defaultModel,
    test: process.env.AGENT_TEST_MODEL || defaultModel,
    review: process.env.AGENT_REVIEW_MODEL || defaultModel,
    /**
     * PVT prep track. Separate overrides because its execute phase emits
     * production SQL for someone else to run, which is worth a stronger
     * model than the rest of the loop.
     */
    pvtDiscuss: process.env.AGENT_PVT_DISCUSS_MODEL || defaultModel,
    pvtPlan: process.env.AGENT_PVT_PLAN_MODEL || defaultModel,
    pvtExecute: process.env.AGENT_PVT_EXECUTE_MODEL || defaultModel,
  },

  /**
   * Company LLM gateway. We speak its OpenAI-compatible surface
   * (`/v1/chat/completions`), so tool calling is native `tool_calls` rather
   * than JSON scraped out of prose.
   */
  bifrost: {
    enabled: Boolean(bifrostBaseUrl),
    baseUrl: bifrostBaseUrl,
    apiKey: bifrostEnv("API_KEY") || "",
    /** Where the virtual key goes. The gateway does not read `Authorization`. */
    authHeader: bifrostEnv("AUTH_HEADER") || "x-bf-vk",
    /**
     * Cloudflare fronts the gateway and blocks known SDK agents with
     * `403 error code 1010`, which reads like an outage but is one header.
     */
    userAgent: bifrostEnv("USER_AGENT") || "sa-agent/0.1",
    /**
     * Reasoning models spend this budget thinking before they answer. Too low
     * and a turn burns the whole allowance and returns empty content with
     * `finish_reason: "length"` — an agent loop that silently does nothing.
     */
    maxTokens: positiveInt("MAX_TOKENS", 4096),
    /** Per-completion HTTP timeout. A hung gateway call otherwise sits for minutes. */
    requestTimeoutMs: positiveInt("REQUEST_TIMEOUT_MS", 90_000),
    /**
     * LangChain retries a failed completion, each attempt billed. Cloudflare
     * challenges already retry in `gatewayFetch`; keep this at 1.
     */
    llmRetries: positiveInt("LLM_RETRIES", 1),
    /** Retries for the Cloudflare bot challenge, on top of the SDK's own. */
    challengeRetries: positiveInt("CHALLENGE_RETRIES", 2),
    /**
     * The GUI re-reads the budget after every turn, so the quota response is
     * cached briefly. Short enough that a meter still tracks your own spend.
     */
    quotaCacheMs: positiveInt("QUOTA_CACHE_MS", 30_000),
    /** The model catalogue and its price list change on the order of weeks. */
    modelsCacheMs: positiveInt("MODELS_CACHE_MS", 600_000),
    /** Providers this gateway can route to. `anthropic` and `openai` are not. */
    providers: [
      "dashscope",
      "huawei_claude",
      "dashscope_claude",
      "huawei",
      "vertex",
    ] as readonly string[],
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

  /**
   * Hard caps on the Deep Agent loop. `createDeepAgent` binds
   * `recursionLimit: 10000`, which is an unbounded tool/model retry in
   * practice: a truncated or looping specialist re-sends the growing
   * context until the bill is millions of tokens.
   */
  agent: {
    /** Graph supersteps for the orchestrator and every `task()` specialist. */
    recursionLimit: envPositiveInt("AGENT_RECURSION_LIMIT", 24),
    /** Wall clock for one `/chat` invoke, including nested specialists. */
    invokeTimeoutMs: envPositiveInt("AGENT_INVOKE_TIMEOUT_MS", 180_000),
  },

  embeddings: {
    /**
     * Must match the Chroma collection dimension.
     * `mxbai-embed-large` is 1024-d. Dimension cannot be scaled up.
     */
    model:
      argvFlag("embedding-model") ||
      process.env.OLLAMA_EMBED_MODEL ||
      "mxbai-embed-large",
    dimension: embeddingDimension(),
    baseUrl: process.env.OLLAMA_URL || "http://localhost:11434",
  },

  supabase: {
    vaultBucket: process.env.SUPABASE_VAULT_BUCKET || "vault",
    vaultFolder: process.env.VAULT_STORAGE_FOLDER || "",
    artifactsBucket: process.env.SUPABASE_ARTIFACTS_BUCKET || "artifacts",
    artifactsFolder: process.env.ARTIFACTS_STORAGE_FOLDER || "",
  },

  vault: {
    defaultUserId: process.env.VAULT_DEFAULT_USER_ID || "user_1",
    devToken: process.env.VAULT_DEV_TOKEN || "",
    maxFileBytes: 20 * 1024 * 1024,
  },

  artifacts: {
    maxFileBytes: 20 * 1024 * 1024,
  },

  /**
   * Local project folders the chat agent can read and write. Paths are on the
   * machine running this process — the GUI and backend must share a disk.
   */
  workspace: {
    maxReadBytes: 1024 * 1024,
    maxWriteBytes: 1024 * 1024,
    maxListEntries: 200,
    maxGrepHits: 50,
    allowedRoots: (process.env.WORKSPACE_ALLOWED_ROOTS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
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
