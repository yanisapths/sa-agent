import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { agentFor } from "../../agents";
import { chatAgentFor } from "../../agents/chat-agent";
import type { AgentKind } from "../../agents/route";
import { listMessages, seedTextFor } from "./service";

function checkpointHasMessages(values: unknown): boolean {
  const messages = (values as { messages?: unknown } | undefined)?.messages;
  return Array.isArray(messages) && messages.length > 0;
}

function checkpointApi(kind: AgentKind | undefined, model?: string) {
  const agent = kind === "chat" ? chatAgentFor(model) : agentFor(model);
  const graph = "graph" in agent && agent.graph ? agent.graph : agent;
  return graph as {
    getState: (config: { configurable: { thread_id: string } }) => Promise<{ values?: unknown }>;
    updateState: (
      config: { configurable: { thread_id: string } },
      values: { messages: unknown },
    ) => Promise<unknown>;
  };
}

/**
 * After a process restart MemorySaver is empty. Replay stored turns into the
 * graph so the next `/chat` message continues the conversation.
 */
export async function seedCheckpointIfEmpty(opts: {
  userId: string | undefined;
  threadId: string;
  model?: string;
  kind?: AgentKind;
}): Promise<void> {
  if (opts.kind === "plain") return;
  if (!opts.userId) return;
  try {
    const agent = checkpointApi(opts.kind, opts.model);
    const snapshot = await agent.getState({
      configurable: { thread_id: opts.threadId },
    });
    if (checkpointHasMessages(snapshot.values)) return;

    const stored = await listMessages(opts.userId, opts.threadId);
    if (stored.length === 0) return;

    const messages = stored.map((row) => {
      const text = seedTextFor(row.role, row.content);
      return row.role === "user"
        ? new HumanMessage({ content: text })
        : new AIMessage({ content: text });
    });

    await agent.updateState(
      { configurable: { thread_id: opts.threadId } },
      { messages },
    );
  } catch (err) {
    console.error("Failed to seed chat checkpoint:", err);
  }
}
