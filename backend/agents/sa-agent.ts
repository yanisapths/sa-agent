import { config } from "../config";
import { defineAgent } from "./builder";
import { ORCHESTRATOR_TOOLS, harnessSubagents } from "./harness";
import { SA_AGENT_PROMPT } from "./prompt";

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
function build(modelId: string | undefined) {
  return defineAgent({
    name: "sa-agent",
    model: modelId ?? config.model.orchestrator,
    systemPrompt: SA_AGENT_PROMPT,
    tools: ORCHESTRATOR_TOOLS,
    /** Every package under `resources/skills/`. Names + descriptions only. */
    skills: ["/skills/"],
    memory: false,
    /** The picked model drives the specialists too, not just the router. */
    subagents: harnessSubagents(modelId),
  });
}

/**
 * Assembling an agent means re-reading the skills mount and rebuilding every
 * subagent, so the graph is cached per model rather than rebuilt per request.
 *
 * Only ids that already passed the gateway catalogue check reach this, so the
 * map is bounded by the number of models the virtual key can see. All entries
 * share one checkpointer (see `builder.ts`), so switching model mid-thread
 * keeps the conversation.
 */
const agents = new Map<string, ReturnType<typeof build>>();

export function agentFor(modelId?: string): ReturnType<typeof build> {
  const key = modelId ?? "";
  const cached = agents.get(key);
  if (cached) return cached;

  const agent = build(modelId);
  agents.set(key, agent);
  return agent;
}

/** The default-model agent, for callers that never override it. */
export const saAgent = agentFor();
