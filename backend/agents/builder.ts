import path from "node:path";
import { fileURLToPath } from "node:url";
import { MemorySaver } from "@langchain/langgraph";
import {
  CompositeBackend,
  createDeepAgent,
  FilesystemBackend,
  StateBackend,
  type SubAgent,
} from "deepagents";
import { config } from "../config";
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
 * Read-only mount of `agents/resources` for skills and memory; everything else
 * is ephemeral per-thread state the agent can use as scratch space for context
 * offloading.
 *
 * The route key needs the trailing slash — CompositeBackend strips it when
 * delegating to the mounted backend.
 */
function createBackend(): CompositeBackend {
  return new CompositeBackend(new StateBackend(), {
    [`${RESOURCE_MOUNT}/`]: new FilesystemBackend({
      rootDir: RESOURCE_ROOT,
      virtualMode: true,
    }),
  });
}

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
    checkpointer: spec.session === false ? undefined : new MemorySaver(),
    permissions: [
      { operations: ["write"], paths: [`${RESOURCE_MOUNT}/**`], mode: "deny" },
    ],
  });
}
