import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { agentFor } from "../../agents";
import { listMessages, seedTextFor } from "./service";

function checkpointHasMessages(values: unknown): boolean {
  const messages = (values as { messages?: unknown } | undefined)?.messages;
  return Array.isArray(messages) && messages.length > 0;
}

/**
 * After a process restart MemorySaver is empty. Replay stored turns into the
 * graph so the next `/chat` message continues the conversation.
 */
export async function seedCheckpointIfEmpty(opts: {
  userId: string | undefined;
  threadId: string;
  model?: string;
}): Promise<void> {
  if (!opts.userId) return;
  try {
    const agent = agentFor(opts.model);
    const snapshot = (await agent.getState({
      configurable: { thread_id: opts.threadId },
    })) as { values?: unknown };
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
