import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

/**
 * Claude Code spawns MCP from the product repo, so cwd is not `backend/`.
 * Load this package's `.env` by absolute path and let it win over a sparse
 * inherited environment (otherwise LANGSMITH_* never reach the MCP process).
 */
loadEnv({
  path: fileURLToPath(new URL("./.env", import.meta.url)),
  override: true,
});

function alias(from: string, to: string): void {
  const value = process.env[from];
  if (value && !process.env[to]) process.env[to] = value;
}

alias("LANGSMITH_TRACING", "LANGCHAIN_TRACING_V2");
alias("LANGSMITH_API_KEY", "LANGCHAIN_API_KEY");
alias("LANGSMITH_PROJECT", "LANGCHAIN_PROJECT");
alias("LANGSMITH_ENDPOINT", "LANGCHAIN_ENDPOINT");

export const backendEnvLoaded = true;
