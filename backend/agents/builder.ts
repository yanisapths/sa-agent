import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";
import { createAgent } from "langchain";
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
import { guardrailsForModel } from "./guardrail/guardrail";
import { AGENT_INTERRUPT_ON } from "./interrupt-on";
import { normalizeVirtualFsPaths } from "./middleware/normalize-virtual-fs-paths";
import { resolveModel } from "./model";
import { registerGatewayHarness } from "./profile";
import { resolveTools, type ToolName } from "./tools";

export type AgentModel = string | BaseChatModel;
export type AgentTools = readonly ToolName[] | StructuredToolInterface[];

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
 * Chat agent checkpoints stay off the Deep Agent store. The graphs do not
 * share a state schema (no filesystem, no `task`), so a shared thread_id
 * would clobber whichever ran last.
 */
const CHAT_SESSION = new MemorySaver();

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

/**
 * Skills/memory stay unwritable. Product-repo writes go through HITL on
 * write_file / edit_file. A blanket `/**` deny rejected approved writes when
 * the model passed a host path under the attached folder (mounted at `/`).
 */
const ORCHESTRATOR_FS_PERMISSIONS: FilesystemPermission[] = [
  { operations: ["write"], paths: ["/resources/**"], mode: "deny" },
];

export interface AgentSpec {
  /** Identifies the agent in traces and streams. */
  name: string;
  /** Role and output contract. Combined with the harness base prompt. */
  systemPrompt: string;
  /** Tool names from the registry, or already-built tools (eval fixtures). Omit to grant all of them. */
  tools?: AgentTools;
  /** Skill directories under `resources/`. Defaults to every skill. */
  skills?: readonly string[];
  /** Load `resources/AGENTS.md` into the system prompt. Default true. */
  memory?: boolean;
  /** Keep per-thread conversation state in memory. Default true. */
  session?: boolean;
  /** Specialised child agents reachable through the `task` tool. */
  subagents?: SubAgent[];
  /** Model override, as `provider/model` (gateway), `provider:model`, or a chat-model instance. */
  model?: AgentModel;
}

function resolveSpecModel(model?: AgentModel): string | BaseChatModel {
  if (model && typeof model !== "string") return model;
  return resolveModel(model ?? config.model.orchestrator);
}

function resolveSpecTools(
  tools: AgentTools | undefined,
  allIfOmitted: boolean,
): StructuredToolInterface[] {
  if (tools === undefined) {
    return allIfOmitted ? resolveTools() : [];
  }
  if (tools.length === 0) return [];
  if (typeof tools[0] === "string") {
    return resolveTools(tools as readonly ToolName[]);
  }
  return [...(tools as StructuredToolInterface[])];
}

/**
 * Assembles a Deep Agent from a declarative resource spec — tools, skills,
 * memory, and subagents. Use this for harness work (workflow, coding, PVT).
 * Casual chat goes through `defineChatAgent` so it does not pay for this
 * scaffolding on every greeting.
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
  const model = resolveSpecModel(spec.model);

  return createDeepAgent({
    name: spec.name,
    model,
    systemPrompt: spec.systemPrompt,
    tools: resolveSpecTools(spec.tools, true),
    backend: createBackend(),
    skills,
    memory: spec.memory === false ? undefined : [`${RESOURCE_MOUNT}/AGENTS.md`],
    subagents: spec.subagents ?? [],
    checkpointer: spec.session === false ? undefined : SESSION,
    permissions: ORCHESTRATOR_FS_PERMISSIONS,
    interruptOn: AGENT_INTERRUPT_ON,
    // After filesystem middleware so relative read_file paths and glob
    // pattern/path mixups are fixed before schema and validatePath run.
    middleware: [normalizeVirtualFsPaths, ...guardrailsForModel(model)],
  }).withConfig({
    /**
     * deepagents binds 10000. A later withConfig wins, and `/chat` passes the
     * same cap so nested `task()` specialists inherit it.
     */
    recursionLimit: config.agent.recursionLimit,
  });
}

/**
 * A ReAct agent with no Deep Agent harness. No filesystem, no `task()`, no
 * skills middleware, no AGENTS.md. Greetings stay a few hundred tokens
 * instead of several thousand of scaffolding.
 */
export function defineChatAgent(spec: AgentSpec) {
  const model = resolveSpecModel(spec.model);
  return createAgent({
    name: spec.name,
    model,
    systemPrompt: spec.systemPrompt,
    tools: resolveSpecTools(spec.tools, false),
    checkpointer: spec.session === false ? undefined : CHAT_SESSION,
    middleware: guardrailsForModel(model),
  }).withConfig({
    recursionLimit: 16,
  });
}
