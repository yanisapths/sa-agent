/**
 * Template for a new agent. Copy to `agents/<name>.ts`, edit, and export it
 * from `agents/index.ts`.
 *
 * Every field except `name` and `systemPrompt` is optional — the defaults grant
 * all registered tools, all skills, shared memory, and per-thread session state.
 * Filesystem, planning, and subagent delegation come from the harness itself.
 */
import { defineAgent } from "../builder";

export const exampleAgent = defineAgent({
  name: "example-agent",

  systemPrompt: `You are <role>.

<what this agent is responsible for>

Reply with a single JSON object: { "type": "text", "text": "<answer>" }`,

  // Narrow the tool surface to what this role actually needs.
  tools: ["list_tables", "describe_tables", "inspect_relationships"],

  // Skill directories under `agents/resources/`.
  skills: ["/skills/"],

  // memory: true,  // load resources/AGENTS.md
  // session: true, // per-thread conversation state
  // subagents: [], // specialists via task() — see harness.ts
  // model: "dashscope/qwen3.7-flash", // slash = gateway, colon = direct
});
