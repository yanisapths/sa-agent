import { defineAgent } from "./builder";
import { SA_AGENT_PROMPT } from "./prompt";

export const saAgent = defineAgent({
  name: "sa-agent",
  systemPrompt: SA_AGENT_PROMPT,
});
