import path from "node:path";
import { fileURLToPath } from "node:url";
import { MemorySaver } from "@langchain/langgraph";
import {
  CompositeBackend,
  createDeepAgent,
  FilesystemBackend,
  StateBackend,
  type FilesystemPermission,
  type SubAgent,
} from "deepagents";
import { config } from "../config";
import { AttachedProjectBackend } from "./backends/attached-project";
import { normalizeVirtualFsPaths } from "./middleware/normalize-virtual-fs-paths";
import { resolveModel } from "./model";
import { registerGatewayHarness } from "./profile";
import { resolveTools, type ToolName } from "./tools";

const RESOURCE_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "resources",
);

/** Mount point for skills and memory inside the agent's virtual filesystem. */
const RESOURCE_MOUNT = "/resources";

/**
 * One checkpointer for every agent this module builds, not one per agent.
 *
 * `/chat` asks for an agent per model id so the human can switch models, and a
 * per-agent checkpointer would give each of those its own store: the same
 * `threadId` would silently start a fresh conversation the moment you changed
 * model. Sharing it keeps a thread's history attached to the thread.
 */
const SESSION = new MemorySaver();

/**
 * Read-only mount of `agents/resources` for skills and memory.
 *
 * The default backend is the attached product repo when `/chat` sets
 * `workspaceRoot`, otherwise per-thread StateBackend. `/artifacts` and other
 * harness scratch paths stay in state (see AttachedProjectBackend).
 *
 * The route key needs the trailing slash — CompositeBackend strips it when
 * delegating to the mounted backend.
 */
function createBackend(): CompositeBackend {
  const state = new StateBackend();
  return new CompositeBackend(new AttachedProjectBackend(state), {
    [`${RESOURCE_MOUNT}/`]: new FilesystemBackend({
      rootDir: RESOURCE_ROOT,
      virtualMode: true,
    }),
  });
}

/** Orchestrator may write phase artifacts only — never the product repo. */
const ORCHESTRATOR_FS_PERMISSIONS: FilesystemPermission[] = [
  { operations: ["write"], paths: ["/artifacts/**"], mode: "allow" },
  { operations: ["write"], paths: ["/large_tool_results/**"], mode: "allow" },
  { operations: ["write"], paths: ["/conversation_history/**"], mode: "allow" },
  { operations: ["write"], paths: ["/**"], mode: "deny" },
];

export interface AgentSpec {
  /** Identifies the agent in traces and streams. */
  name: string;
  /** Role and output contract. Combined with the harness base prompt. */
  systemPrompt: string;
  /** Tool names from the registry. Omit to grant all of them. */
  tools?: readonly ToolName[];
  /** Skill directories under `resources/`. Defaults to every skill. */
  skills?: readonly string[];
  /** Load `resources/AGENTS.md` into the system prompt. Default true. */
  memory?: boolean;
  /** Keep per-thread conversation state in memory. Default true. */
  session?: boolean;
  /** Specialised child agents reachable through the `task` tool. */
  subagents?: SubAgent[];
  /** Model override, as `provider/model` (gateway) or `provider:model`. */
  model?: string;
}

/**
 * Assembles a Deep Agent from a declarative resource spec — tools, skills,
 * memory, and subagents. Use this for every agent so they all share the same
 * harness wiring. Filesystem, planning, and delegation tools come from the
 * harness itself.
 */
export function defineAgent(spec: AgentSpec) {
  /**
   * Before the first `createDeepAgent`, which reads the profile at assembly
   * time. Here rather than at module scope so it cannot depend on import order.
   */
  registerGatewayHarness();

  const skills = (spec.skills ?? ["/skills/"]).map(
    (source) => `${RESOURCE_MOUNT}${source}`,
  );

  return createDeepAgent({
    name: spec.name,
    model: resolveModel(spec.model ?? config.model.orchestrator),
    systemPrompt: spec.systemPrompt,
    tools: resolveTools(spec.tools),
    backend: createBackend(),
    skills,
    memory: spec.memory === false ? undefined : [`${RESOURCE_MOUNT}/AGENTS.md`],
    subagents: spec.subagents ?? [],
    checkpointer: spec.session === false ? undefined : SESSION,
    permissions: ORCHESTRATOR_FS_PERMISSIONS,
    // After filesystem middleware so relative read_file paths are fixed before
    // deepagents permission validatePath runs.
    middleware: [normalizeVirtualFsPaths],
  }).withConfig({
    /**
     * deepagents binds 10000. A later withConfig wins, and `/chat` passes the
     * same cap so nested `task()` specialists inherit it.
     */
    recursionLimit: config.agent.recursionLimit,
  });
}
