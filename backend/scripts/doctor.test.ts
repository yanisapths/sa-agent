import { describe, expect, test } from "bun:test";
import { COMMANDS, renderHelp } from "./commands";
import { databaseTarget, localChecks, renderChecks, type DoctorSnapshot } from "./doctor";

function snapshot(overrides: Partial<DoctorSnapshot> = {}): DoctorSnapshot {
  return {
    repoRoot: "/work/sa-agent",
    saAgentHome: "/work/sa-agent",
    recordedHome: "/work/sa-agent",
    envFile: true,
    backendInstalled: true,
    frontendEnvPresent: true,
    frontendAgentApi: "http://localhost:5001",
    env: {
      DATABASE_URL: "postgresql://agent:s3cret@db.internal:5432/app",
      BIFROST_BASE_URL: "https://bifrost.example",
      BIFROST_API_KEY: "vk-1234567890",
      BIFROST_USER_AGENT: "sa-agent/0.1",
      CHROMA_API_KEY: "chroma",
      CHROMA_TENANT: "tenant",
      CHROMA_DATABASE: "db",
      CONFLUENCE_BASE_URL: "https://acme.atlassian.net/wiki",
      CONFLUENCE_ACCESS_TOKEN: "token",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      LANGSMITH_API_KEY: "ls",
    },
    models: { orchestrator: "dashscope/qwen3.7-flash" },
    gatewayProviders: ["dashscope", "huawei"],
    ...overrides,
  };
}

describe("help", () => {
  test("lists the setup scripts and the shell CLIs", () => {
    const text = renderHelp();
    expect(text).toContain("bun run doctor");
    expect(text).toContain("bun run help");
    expect(text).toContain("bun run claude");
    expect(text).toContain("claude plugin marketplace add");
    expect(text).toContain("codex plugin marketplace add");
    expect(text).toContain("testcase-extractor.py");
    expect(text).toContain("bun run mcp:confluence");
  });

  test("commands are unique", () => {
    const commands = COMMANDS.map((entry) => entry.command);
    expect(new Set(commands).size).toBe(commands.length);
  });
});

describe("doctor", () => {
  test("accepts a reachable checkout and hides the database password", () => {
    const text = renderChecks(localChecks(snapshot()));
    expect(text).toContain("[  ok  ] DATABASE_URL — db.internal:5432/app");
    expect(text).not.toContain("s3cret");
    expect(text).toContain("[  ok  ] BIFROST_API_KEY — vk-1…7890");
    expect(text).not.toContain("[ fail ]");
  });

  test("fails a missing env file, a bad database URI, and a home path that points elsewhere", () => {
    const checks = localChecks(
      snapshot({
        saAgentHome: "/other/checkout",
        recordedHome: undefined,
        envFile: false,
        backendInstalled: false,
        env: { DATABASE_URL: "db.internal" },
        models: {},
      }),
    );
    const text = renderChecks(checks);
    expect(text).toContain("[ fail ] SA_AGENT_HOME");
    expect(text).toContain("[ warn ] ~/.sa-agent/home");
    expect(text).toContain("[ fail ] backend/.env");
    expect(text).toContain("[ fail ] DATABASE_URL");
    expect(text).not.toContain("db.internal");
    expect(checks.some((item) => item.status === "fail")).toBe(true);
  });

  test("warns when the frontend env still uses the old API variable", () => {
    const text = renderChecks(
      localChecks(
        snapshot({
          frontendAgentApi: undefined,
          frontendLegacyApi: "http://localhost:5001",
        }),
      ),
    );
    expect(text).toContain("sets NEXT_PUBLIC_API, which the GUI does not read");
  });

  test("fails a gateway model whose provider is not routed", () => {
    const text = renderChecks(
      localChecks(snapshot({ models: { plan: "anthropic/claude-sonnet" } })),
    );
    expect(text).toContain('[ fail ] plan — anthropic/claude-sonnet');
  });

  test("requires an Anthropic key for a direct model and rejects an SDK user agent", () => {
    const text = renderChecks(
      localChecks(
        snapshot({
          env: {
            DATABASE_URL: "postgresql://agent:s3cret@db.internal:5432/app",
            BIFROST_USER_AGENT: "node",
          },
          models: { orchestrator: "anthropic:claude-haiku-4-5" },
        }),
      ),
    );
    expect(text).toContain("[ fail ] ANTHROPIC_API_KEY");
    expect(text).toContain("[ fail ] BIFROST_USER_AGENT");
  });

  test("describes a postgres URL without leaking the userinfo", () => {
    expect(databaseTarget("postgresql://agent:s3cret@db.internal:5432/app")).toEqual({
      ok: true,
      detail: "db.internal:5432/app",
    });
    expect(databaseTarget("not a url").ok).toBe(false);
  });
});
