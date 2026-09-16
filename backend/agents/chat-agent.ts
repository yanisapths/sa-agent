import { config } from "../config";
import { defineChatAgent } from "./builder";
import { CHAT_AGENT_PROMPT } from "./prompt";
import { loadSkillBody } from "./skill";
import type { ToolName } from "./tools";

/** Lookups: product docs, live schema, web, Jira. No filesystem, no specialists. */
export const CHAT_TOOLS = [
  "search_docs",
  "get_doc_page",
  "search_schema_docs",
  "list_tables",
  "describe_tables",
  "inspect_relationships",
  "run_sql",
  "get_present_datetime",
  "web_search",
  "search_jira",
  "get_jira_ticket",
  "read_jira_user_story",
] as const satisfies readonly ToolName[];

function build(modelId: string | undefined) {
  return defineChatAgent({
    name: "sa-chat",
    model: modelId ?? config.model.orchestrator,
    systemPrompt: `${CHAT_AGENT_PROMPT}\n\n${loadSkillBody("chat")}`,
    tools: CHAT_TOOLS,
    skills: [],
    memory: false,
  });
}

const agents = new Map<string, ReturnType<typeof build>>();

export function chatAgentFor(modelId?: string): ReturnType<typeof build> {
  const key = modelId ?? "";
  const cached = agents.get(key);
  if (cached) return cached;

  const agent = build(modelId);
  agents.set(key, agent);
  return agent;
}

export const chatAgent = chatAgentFor();
