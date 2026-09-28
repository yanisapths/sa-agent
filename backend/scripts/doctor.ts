import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.join(BACKEND_ROOT, "..");

export type CheckStatus = "ok" | "warn" | "fail";

export type Check = {
  section: string;
  status: CheckStatus;
  label: string;
  detail?: string;
};

export type DoctorSnapshot = {
  repoRoot: string;
  saAgentHome?: string;
  recordedHome?: string;
  envFile: boolean;
  backendInstalled: boolean;
  frontendEnvPresent: boolean;
  frontendAgentApi?: string;
  /** Set when the env file still uses the old name the GUI does not read. */
  frontendLegacyApi?: string;
  env: NodeJS.ProcessEnv;
  models: Record<string, string>;
  gatewayProviders: readonly string[];
};

const CHECKOUT = "Checkout";
const MODELS = "Models";
const OPTIONAL = "Optional";

function check(section: string, status: CheckStatus, label: string, detail?: string): Check {
  return { section, status, label, detail };
}

function mask(secret: string): string {
  if (secret.length <= 8) return "*".repeat(secret.length);
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

/** Host and database only. A rejected value is not echoed — it may contain a password. */
export function databaseTarget(value: string | undefined): { ok: true; detail: string } | { ok: false; detail: string } {
  if (!value) return { ok: false, detail: "unset — schema tools need a postgresql:// URI" };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, detail: "must be a connection URI, e.g. postgresql://user:password@host:5432/database" };
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return { ok: false, detail: "must use the postgresql:// scheme" };
  }
  if (!parsed.hostname) {
    return { ok: false, detail: "missing a host" };
  }
  const database = parsed.pathname.replace(/^\//, "") || "(no database name)";
  const port = parsed.port ? `:${parsed.port}` : "";
  return { ok: true, detail: `${parsed.hostname}${port}/${database}` };
}

function bifrostValue(env: NodeJS.ProcessEnv, name: string): string {
  return env[`BIFROST_${name}`] || env[name] || "";
}

export function localChecks(snapshot: DoctorSnapshot): Check[] {
  const checks: Check[] = [];
  const { env } = snapshot;

  if (!snapshot.saAgentHome) {
    checks.push(
      check(
        CHECKOUT,
        "warn",
        "SA_AGENT_HOME",
        `unset — export SA_AGENT_HOME="${snapshot.repoRoot}"`,
      ),
    );
  } else if (!samePath(snapshot.saAgentHome, snapshot.repoRoot)) {
    checks.push(
      check(
        CHECKOUT,
        "fail",
        "SA_AGENT_HOME",
        `points at ${snapshot.saAgentHome}; this checkout is ${snapshot.repoRoot}`,
      ),
    );
  } else {
    checks.push(check(CHECKOUT, "ok", "SA_AGENT_HOME", snapshot.repoRoot));
  }

  if (!snapshot.recordedHome) {
    checks.push(
      check(
        CHECKOUT,
        "warn",
        "~/.sa-agent/home",
        "missing — Codex MCP reads this when the variable is not in its environment",
      ),
    );
  } else if (!samePath(snapshot.recordedHome, snapshot.repoRoot)) {
    checks.push(
      check(CHECKOUT, "fail", "~/.sa-agent/home", `points at ${snapshot.recordedHome}`),
    );
  } else {
    checks.push(check(CHECKOUT, "ok", "~/.sa-agent/home", snapshot.repoRoot));
  }

  checks.push(
    snapshot.envFile
      ? check(CHECKOUT, "ok", "backend/.env", "present")
      : check(CHECKOUT, "fail", "backend/.env", "missing — cp .env.example .env"),
  );
  checks.push(
    snapshot.backendInstalled
      ? check(CHECKOUT, "ok", "backend/node_modules", "present")
      : check(CHECKOUT, "fail", "backend/node_modules", "missing — bun install"),
  );

  const database = databaseTarget(env.DATABASE_URL);
  checks.push(
    check(CHECKOUT, database.ok ? "ok" : "fail", "DATABASE_URL", database.detail),
  );
  checks.push(
    check(CHECKOUT, "ok", "DATABASE_SCHEMA", env.DATABASE_SCHEMA || "public (default)"),
  );

  if (!snapshot.frontendEnvPresent) {
    checks.push(
      check(
        CHECKOUT,
        "warn",
        "frontend env",
        "no frontend/.env.local or frontend/.env — the GUI defaults to http://localhost:5001",
      ),
    );
  } else if (snapshot.frontendAgentApi) {
    checks.push(check(CHECKOUT, "ok", "NEXT_PUBLIC_AGENT_API", snapshot.frontendAgentApi));
  } else if (snapshot.frontendLegacyApi) {
    checks.push(
      check(
        CHECKOUT,
        "warn",
        "NEXT_PUBLIC_AGENT_API",
        "unset — frontend env sets NEXT_PUBLIC_API, which the GUI does not read",
      ),
    );
  } else {
    checks.push(
      check(CHECKOUT, "ok", "NEXT_PUBLIC_AGENT_API", "default http://localhost:5001"),
    );
  }

  const baseUrl = bifrostValue(env, "BASE_URL").replace(/\/+$/, "");
  const apiKey = bifrostValue(env, "API_KEY");
  const userAgent = bifrostValue(env, "USER_AGENT") || "sa-agent/0.1";

  if (!baseUrl) {
    checks.push(
      check(MODELS, "warn", "BIFROST_BASE_URL", "unset — phases use direct provider models"),
    );
  } else if (!apiKey) {
    checks.push(check(MODELS, "ok", "BIFROST_BASE_URL", baseUrl));
    checks.push(check(MODELS, "fail", "BIFROST_API_KEY", "unset"));
  } else {
    checks.push(check(MODELS, "ok", "BIFROST_BASE_URL", baseUrl));
    checks.push(check(MODELS, "ok", "BIFROST_API_KEY", mask(apiKey)));
  }

  if (/^(node|undici|python-urllib)/i.test(userAgent)) {
    checks.push(
      check(
        MODELS,
        "fail",
        "BIFROST_USER_AGENT",
        `${userAgent} — Cloudflare blocks this SDK agent with 403 error 1010`,
      ),
    );
  } else if (baseUrl) {
    checks.push(check(MODELS, "ok", "BIFROST_USER_AGENT", userAgent));
  }

  let needsAnthropic = false;
  for (const [phase, id] of Object.entries(snapshot.models)) {
    if (id.includes("/")) {
      const prefix = id.split("/")[0] ?? "";
      if (snapshot.gatewayProviders.includes(prefix)) {
        checks.push(check(MODELS, "ok", phase, `${id} (gateway)`));
      } else {
        checks.push(
          check(
            MODELS,
            "fail",
            phase,
            `${id} — "${prefix}" is not routed here: ${snapshot.gatewayProviders.join(", ")}`,
          ),
        );
      }
    } else {
      if (id.startsWith("anthropic:")) needsAnthropic = true;
      checks.push(check(MODELS, "ok", phase, `${id} (direct)`));
    }
  }

  if (needsAnthropic && !env.ANTHROPIC_API_KEY) {
    checks.push(
      check(MODELS, "fail", "ANTHROPIC_API_KEY", "required when a phase model is anthropic:…"),
    );
  }

  const chromaKeys = ["CHROMA_API_KEY", "CHROMA_TENANT", "CHROMA_DATABASE"] as const;
  const chromaSet = chromaKeys.filter((name) => env[name]);
  if (chromaSet.length === chromaKeys.length) {
    checks.push(check(OPTIONAL, "ok", "Chroma", "credentials set for search_schema_docs"));
  } else if (chromaSet.length === 0) {
    checks.push(
      check(OPTIONAL, "warn", "Chroma", "unset — search_schema_docs stays empty until a DDL ingest"),
    );
  } else {
    const missing = chromaKeys.filter((name) => !env[name]);
    checks.push(check(OPTIONAL, "warn", "Chroma", `incomplete — missing ${missing.join(", ")}`));
  }

  const confluenceMcp = env.CONFLUENCE_MCP_URL || "";
  const confluenceBase = env.CONFLUENCE_BASE_URL || "";
  const confluenceToken = env.CONFLUENCE_ACCESS_TOKEN || env.CONFLUENCE_PAT || "";
  const confluenceReady = Boolean(confluenceMcp || (confluenceBase && confluenceToken));
  if (confluenceReady) {
    checks.push(
      check(
        OPTIONAL,
        "ok",
        "Confluence",
        confluenceMcp ? "remote MCP" : confluenceBase,
      ),
    );
  } else if (confluenceBase || confluenceToken || env.CONFLUENCE_USERNAME) {
    checks.push(
      check(
        OPTIONAL,
        "warn",
        "Confluence",
        "incomplete — set CONFLUENCE_BASE_URL plus a token, or CONFLUENCE_MCP_URL",
      ),
    );
  } else {
    checks.push(
      check(OPTIONAL, "warn", "Confluence", "unset — search_docs and get_doc_page have nothing to read"),
    );
  }

  const jiraMcp = env.JIRA_MCP_URL || "";
  const jiraToken = env.JIRA_MCP_TOKEN || "";
  const jiraUrl = env.JIRA_URL || "";
  const jiraPat = env.JIRA_PERSONAL_TOKEN || env.JIRA_PAT || "";
  const jiraUser = env.JIRA_USERNAME || "";
  const jiraApi = env.JIRA_API_TOKEN || "";
  const jiraRest = Boolean(jiraUrl && (jiraPat || (jiraUser && jiraApi)));
  if (jiraMcp && !jiraToken) {
    checks.push(
      check(OPTIONAL, "warn", "Jira", "JIRA_MCP_URL is set without JIRA_MCP_TOKEN"),
    );
  } else if (jiraMcp) {
    checks.push(check(OPTIONAL, "ok", "Jira", "remote MCP"));
  } else if (jiraRest) {
    checks.push(check(OPTIONAL, "ok", "Jira", "REST credentials"));
  } else if (jiraUrl || jiraPat || jiraUser || jiraApi) {
    checks.push(
      check(OPTIONAL, "warn", "Jira", "incomplete — needs a URL plus a personal token or user and API token"),
    );
  } else if (confluenceReady && !confluenceMcp) {
    checks.push(check(OPTIONAL, "ok", "Jira", "unset — ticket tools can reuse the Confluence site credentials"));
  } else {
    checks.push(check(OPTIONAL, "warn", "Jira", "unset — ticket and user-story tools will not load"));
  }

  const supabaseUrl = env.SUPABASE_URL || "";
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (supabaseUrl && supabaseKey) {
    checks.push(check(OPTIONAL, "ok", "Supabase", "vault and artifacts"));
  } else if (supabaseUrl || supabaseKey) {
    checks.push(
      check(OPTIONAL, "warn", "Supabase", "incomplete — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"),
    );
  } else {
    checks.push(
      check(OPTIONAL, "warn", "Supabase", "unset — vault, artifacts, and saved chats stay off"),
    );
  }

  checks.push(
    check(OPTIONAL, "ok", "OLLAMA_URL", env.OLLAMA_URL || "http://localhost:11434 (default)"),
  );
  checks.push(
    check(
      OPTIONAL,
      "ok",
      "OLLAMA_EMBED_MODEL",
      env.OLLAMA_EMBED_MODEL || "mxbai-embed-large (default)",
    ),
  );

  checks.push(
    env.LANGSMITH_API_KEY
      ? check(OPTIONAL, "ok", "LangSmith", "tracing on")
      : check(OPTIONAL, "warn", "LangSmith", "unset — traces and the cloud sandbox stay off"),
  );

  return checks;
}

export function renderChecks(checks: Check[]): string {
  const lines: string[] = [];
  let section = "";
  for (const item of checks) {
    if (item.section !== section) {
      if (lines.length > 0) lines.push("");
      section = item.section;
      lines.push(section);
      lines.push("");
    }
    const tag = item.status === "ok" ? "  ok  " : item.status === "warn" ? " warn " : " fail ";
    lines.push(`[${tag}] ${item.label}${item.detail ? ` — ${item.detail}` : ""}`);
  }
  return lines.join("\n");
}

export function summarize(checks: Check[]): string {
  const failed = checks.filter((item) => item.status === "fail").length;
  const warned = checks.filter((item) => item.status === "warn").length;
  if (failed === 0 && warned === 0) return "Ready.";
  const parts = [];
  if (failed > 0) parts.push(`${failed} failed`);
  if (warned > 0) parts.push(`${warned} warning${warned === 1 ? "" : "s"}`);
  return parts.join(", ") + ".";
}

const REACHABILITY = "Reachability";

function clip(error: unknown, secret?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = secret ? message.split(secret).join("(redacted)") : message;
  return redacted.replace(/\s+/g, " ").slice(0, 180);
}

export async function probePostgres(url: string): Promise<Check> {
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
  });
  try {
    await client.connect();
    const result = await client.query<{ schema: string }>("select current_schema() as schema");
    const schema = result.rows[0]?.schema || "(none)";
    return check(REACHABILITY, "ok", "postgres", `connected, schema ${schema}`);
  } catch (error) {
    return check(REACHABILITY, "fail", "postgres", clip(error, url));
  } finally {
    await client.end().catch(() => {});
  }
}

export async function probeGateway(
  baseUrl: string,
  apiKey: string,
  authHeader: string,
  userAgent: string,
): Promise<Check> {
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/models`;
  try {
    const response = await fetch(url, {
      headers: { [authHeader]: apiKey, "User-Agent": userAgent },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      const body = (await response.text()).replace(/\s+/g, " ").slice(0, 160);
      return check(REACHABILITY, "fail", "bifrost", `${response.status} ${body}`);
    }
    const body = (await response.json()) as { data?: unknown[] };
    const count = body.data?.length ?? 0;
    return check(REACHABILITY, "ok", "bifrost", `${count} models at ${url}`);
  } catch (error) {
    return check(REACHABILITY, "fail", "bifrost", clip(error, apiKey));
  }
}

export async function probeOllama(baseUrl: string): Promise<Check> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/tags`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) {
      return check(REACHABILITY, "warn", "ollama", `${response.status} from ${url}`);
    }
    const body = (await response.json()) as { models?: unknown[] };
    const count = body.models?.length ?? 0;
    return check(REACHABILITY, "ok", "ollama", `${count} models`);
  } catch (error) {
    return check(
      REACHABILITY,
      "warn",
      "ollama",
      `${clip(error)} — DDL ingest needs a local embedding model`,
    );
  }
}

function envValue(text: string, name: string): string | undefined {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== name) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value || undefined;
  }
  return undefined;
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function frontendEnv(): { present: boolean; agentApi?: string; legacyApi?: string } {
  const root = path.join(REPO_ROOT, "frontend");
  for (const name of [".env.local", ".env"]) {
    const text = readText(path.join(root, name));
    if (text === undefined) continue;
    return {
      present: true,
      agentApi: envValue(text, "NEXT_PUBLIC_AGENT_API"),
      legacyApi: envValue(text, "NEXT_PUBLIC_API"),
    };
  }
  return { present: false };
}

async function main(): Promise<void> {
  await import("../load-env");
  const { config } = await import("../config");

  const offline = process.argv.includes("--offline");
  const recorded = readText(path.join(os.homedir(), ".sa-agent", "home"))?.trim();
  const frontend = frontendEnv();
  const snapshot: DoctorSnapshot = {
    repoRoot: REPO_ROOT,
    saAgentHome: process.env.SA_AGENT_HOME,
    recordedHome: recorded || undefined,
    envFile: existsSync(path.join(BACKEND_ROOT, ".env")),
    backendInstalled: existsSync(path.join(BACKEND_ROOT, "node_modules")),
    frontendEnvPresent: frontend.present,
    frontendAgentApi: frontend.agentApi,
    frontendLegacyApi: frontend.legacyApi,
    env: process.env,
    models: { ...config.model },
    gatewayProviders: config.bifrost.providers,
  };

  const checks = localChecks(snapshot);
  const database = databaseTarget(process.env.DATABASE_URL);
  const baseUrl = bifrostValue(process.env, "BASE_URL").replace(/\/+$/, "");
  const apiKey = bifrostValue(process.env, "API_KEY");

  if (offline) {
    checks.push(check(REACHABILITY, "ok", "probes", "skipped (--offline)"));
  } else {
    if (database.ok && process.env.DATABASE_URL) {
      checks.push(await probePostgres(process.env.DATABASE_URL));
    }
    if (baseUrl && apiKey) {
      checks.push(
        await probeGateway(
          baseUrl,
          apiKey,
          bifrostValue(process.env, "AUTH_HEADER") || "x-bf-vk",
          bifrostValue(process.env, "USER_AGENT") || "sa-agent/0.1",
        ),
      );
    }
    checks.push(await probeOllama(process.env.OLLAMA_URL || "http://localhost:11434"));
  }

  const failed = checks.some((item) => item.status === "fail");
  console.log(renderChecks(checks));
  console.log("");
  console.log(summarize(checks));
  if (failed) console.log("Fix the failures, then run `bun run help` for the other commands.");
  process.exitCode = failed ? 1 : 0;
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
