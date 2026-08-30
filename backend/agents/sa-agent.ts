import { config } from "../config";
import { defineAgent } from "./builder";
import { ORCHESTRATOR_TOOLS, harnessSubagents } from "./harness";
import { SA_AGENT_PROMPT } from "./prompt";

/** Cheap router. Specialists live in harness.ts and do the phase work. */
export const saAgent = defineAgent({
  name: "sa-agent",
  model: config.model.orchestrator,
  systemPrompt: SA_AGENT_PROMPT,
  tools: ORCHESTRATOR_TOOLS,
  skills: [],
  subagents: harnessSubagents(),
});
