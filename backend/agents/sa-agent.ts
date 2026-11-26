import { createHash } from "node:crypto";
import { defineAgent } from "./builder";
import {
  DEFAULT_HARNESS,
  harnessSubagents,
  modelFor,
  orchestratorTools,
  type HarnessProfile,
} from "./harness";
import { saAgentPrompt } from "./prompt";
import { capabilitySignature } from "../internal/product/capabilities";

/**
 * Cheap router. Specialists live in harness.ts and do the phase work.
 *
 * Casual chat ("hi") is a bare LLM call. Questions that need docs, schema,
 * web, or Jira use `chat-agent.ts`. Workflow, coding, and PVT reach this graph.
 *
 * No memory: `resources/AGENTS.md` is 2.3k on every turn, deepagents mounts it
 * on the main agent only — specialists never see it — and everything in it the
 * router needs is already in SA_AGENT_PROMPT. Specialists inherit the same
 * rules through `GROUNDING` in harness.ts.
 *
 * Skills are mounted, unlike memory. Only the name and description of each are
 * in the prompt; the body is read on demand. The router needs them to answer
 * "which skill covers this" and to name the right one in the task it hands a
 * specialist — a phase that loads `backend-code-review` when the work is a
 * frontend diff wastes the turn. It still never does the work itself.
 */
function build(modelId: string | undefined, profile: HarnessProfile) {
  return defineAgent({
    name: "sa-agent",
    model: modelFor("orchestrator", profile, modelId),
    systemPrompt: saAgentPrompt(profile.caps),
    tools: orchestratorTools(profile.caps),
    /** Every package under `resources/skills/`. Names + descriptions only. */
    skills: ["/skills/"],
    memory: false,
    /** The picked model drives the specialists too, not just the router. */
    subagents: harnessSubagents(modelId, profile),
  });
}

/** Model defaults change which models the specialists run, so they are part of the key. */
export function modelDefaultsHash(models: HarnessProfile["models"]): string {
  const entries = Object.entries(models).filter(([, value]) => Boolean(value)).sort();
  if (entries.length === 0) return "";
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex").slice(0, 12);
}

export function harnessKey(modelId: string | undefined, profile: HarnessProfile): string {
  return `${modelId ?? ""}|${capabilitySignature(profile.caps)}|${modelDefaultsHash(profile.models)}`;
}

/**
 * Assembling an agent means re-reading the skills mount and rebuilding every
 * subagent, so the graph is cached per model rather than rebuilt per request.
 *
 * Only ids that already passed the gateway catalogue check reach this, so the
 * map is bounded by the number of models the virtual key can see, times at
 * most 16 capability combinations. Credentials are never part of the key:
 * tools read them from AsyncLocalStorage per call. All entries share one
 * checkpointer (see `builder.ts`), so switching model mid-thread keeps the
 * conversation.
 */
const agents = new Map<string, ReturnType<typeof build>>();

export function agentFor(
  modelId?: string,
  profile: HarnessProfile = DEFAULT_HARNESS,
): ReturnType<typeof build> {
  const key = harnessKey(modelId, profile);
  const cached = agents.get(key);
  if (cached) return cached;

  const agent = build(modelId, profile);
  agents.set(key, agent);
  return agent;
}

export function agentCacheSize(): number {
  return agents.size;
}

/** The default-model agent, for callers that never override it. */
export const saAgent = agentFor();
