import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frontendChatResponseModule } from "../contract/frontend-module";
import { SPECIALISTS, type SpecialistSpec } from "../agents/specialists";

const BACKEND_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.join(BACKEND_ROOT, "..");
const CLAUDE_AGENTS = path.join(BACKEND_ROOT, "agents/claude/agents");
const CLAUDE_PLUGIN = path.join(BACKEND_ROOT, "agents/claude");
const FRONTEND_CONTRACT = path.join(REPO_ROOT, "frontend/lib/chat-response.ts");

const MCP_LAUNCH =
  'h="${SA_AGENT_HOME:-}"; [ -n "$h" ] || h=$(sed -n 1p "$HOME/.sa-agent/home" 2>/dev/null); [ -n "$h" ] || { echo \'sa-agent: set SA_AGENT_HOME, or write the checkout path to ~/.sa-agent/home\' >&2; exit 78; }; exec "$h/backend/mcp/sa-mcp"';

function mcpConfig(runtime: "claude-code" | "codex") {
  return {
    mcpServers: {
      "sa-knowledge": {
        command: "sh",
        args: ["-c", `${MCP_LAUNCH} knowledge ${runtime}`],
      },
      jira: {
        command: "sh",
        args: ["-c", `${MCP_LAUNCH} jira ${runtime}`],
      },
    },
  };
}

function claudeAgentMarkdown(spec: SpecialistSpec): string {
  const extra = spec.disallowedTools?.length
    ? `disallowedTools: ${spec.disallowedTools.join(", ")}\n`
    : "";
  return `---
name: ${spec.claudeName}
description: ${spec.description}
model: haiku
${extra}---

${spec.pluginBody.trim()}
`;
}

export type SurfaceFile = { path: string; contents: string };

export function surfaceFiles(): SurfaceFile[] {
  const agents = Object.values(SPECIALISTS).map((spec) => ({
    path: path.join(CLAUDE_AGENTS, spec.claudeFile),
    contents: claudeAgentMarkdown(spec),
  }));

  return [
    ...agents,
    {
      path: path.join(CLAUDE_PLUGIN, ".mcp.json"),
      contents: `${JSON.stringify(mcpConfig("claude-code"), null, 2)}\n`,
    },
    {
      path: path.join(CLAUDE_PLUGIN, ".mcp.codex.json"),
      contents: `${JSON.stringify(mcpConfig("codex"), null, 2)}\n`,
    },
    {
      path: FRONTEND_CONTRACT,
      contents: frontendChatResponseModule(),
    },
  ];
}

export function writeSurfaces(): SurfaceFile[] {
  const files = surfaceFiles();
  for (const file of files) {
    mkdirSync(path.dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.contents);
  }
  return files;
}

export function checkSurfaces(): string[] {
  const dirty: string[] = [];
  for (const file of surfaceFiles()) {
    let existing = "";
    try {
      existing = readFileSync(file.path, "utf8");
    } catch {
      dirty.push(file.path);
      continue;
    }
    if (existing !== file.contents) dirty.push(file.path);
  }
  return dirty;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const mode = process.argv[2] ?? "write";
  if (mode === "check") {
    const dirty = checkSurfaces();
    if (dirty.length > 0) {
      console.error("Generated surfaces are stale. Run `bun run surfaces`:\n");
      for (const file of dirty) console.error(`  ${path.relative(REPO_ROOT, file)}`);
      process.exit(1);
    }
    console.log("Generated surfaces are up to date.");
  } else {
    const files = writeSurfaces();
    console.log(`Wrote ${files.length} generated surface files.`);
  }
}
