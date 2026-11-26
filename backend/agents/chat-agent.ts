import { defineChatAgent } from "./builder";
import { DEFAULT_HARNESS, modelFor, type HarnessProfile } from "./harness";
import { chatAgentPrompt } from "./prompt";
import { harnessKey } from "./sa-agent";
import { loadSkillBody } from "./skill";
import type { ToolName } from "./tools";
import { grantedTools } from "../internal/product/capabilities";

/** Lookups: product docs, live schema, web, Jira. Execution: sandbox. No filesystem, no specialists. */
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
  "sandbox_exec",
] as const satisfies readonly ToolName[];

function build(modelId: string | undefined, profile: HarnessProfile) {
  return defineChatAgent({
    name: "sa-chat",
    model: modelFor("orchestrator", profile, modelId),
    systemPrompt: `${chatAgentPrompt(profile.caps)}\n\n${loadSkillBody("chat")}`,
    tools: grantedTools(CHAT_TOOLS, profile.caps),
    skills: [],
    memory: false,
  });
}

const agents = new Map<string, ReturnType<typeof build>>();

export function chatAgentFor(
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

export const chatAgent = chatAgentFor();
