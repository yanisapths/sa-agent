import { config } from "../config";
import { defineAgent } from "./builder";
import { ORCHESTRATOR_TOOLS, harnessSubagents } from "./harness";
import { SA_AGENT_PROMPT } from "./prompt";

/**
 * Cheap router. Specialists live in harness.ts and do the phase work.
 *
 * No memory: `resources/AGENTS.md` is 2.3k on every turn, deepagents mounts it
 * on the main agent only — specialists never see it — and everything in it the
 * router needs is already in SA_AGENT_PROMPT. Specialists inherit the same
 * rules through `GROUNDING` in harness.ts.
 */
export const saAgent = defineAgent({
  name: "sa-agent",
  model: config.model.orchestrator,
  systemPrompt: SA_AGENT_PROMPT,
  tools: ORCHESTRATOR_TOOLS,
  skills: [],
  subagents: harnessSubagents(),
});
