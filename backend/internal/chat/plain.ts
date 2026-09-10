import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { config } from "../../config";
import { asChatModel } from "../../agents/model";
import { PLAIN_PROMPT } from "../../agents/prompt";
import { isCasualMessage } from "../../agents/route";
import { listMessages, seedTextFor } from "../chats/service";
import type { UsageCollector } from "../gateway/usage";
import type { ChatSseEvent } from "./events";

type PlainRun = {
  threadId: string;
  userId?: string;
  model?: string;
  collector: UsageCollector;
};

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block === "object" && "text" in block) {
        const text = (block as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("");
}

export function userTextFromInput(input: unknown): string {
  const messages = (input as { messages?: Array<{ content?: unknown }> })
    ?.messages;
  const last = messages?.[messages.length - 1];
  return contentText(last?.content).trim();
}

async function plainMessages(
  run: PlainRun,
  userText: string,
): Promise<Array<SystemMessage | HumanMessage | AIMessage>> {
  const messages: Array<SystemMessage | HumanMessage | AIMessage> = [
    new SystemMessage(PLAIN_PROMPT),
  ];

  /**
   * Greetings stay playground-cheap: system + "hi". Follow-up questions can
   * reuse stored turns, but never the LangGraph checkpoint (tool dumps).
   */
  if (run.userId && !isCasualMessage(userText)) {
    const stored = await listMessages(run.userId, run.threadId);
    const prior = stored.slice(0, -1).slice(-8);
    for (const row of prior) {
      const text = seedTextFor(row.role, row.content).slice(0, 500);
      if (!text) continue;
      messages.push(
        row.role === "user"
          ? new HumanMessage(text)
          : new AIMessage(text),
      );
    }
  }

  messages.push(new HumanMessage(userText || "hello"));
  return messages;
}

function llmConfig(
  run: PlainRun,
  signal: AbortSignal,
  onProgress?: () => void,
) {
  return {
    signal,
    callbacks: [
      run.collector.handler,
      ...(onProgress
        ? [
            {
              handleLLMStart: onProgress,
              handleLLMNewToken: onProgress,
              handleLLMEnd: onProgress,
            },
          ]
        : []),
    ],
  };
}

function valuesOf(text: string) {
  return { messages: [new AIMessage({ content: text })] };
}

export async function streamPlainTurn(opts: {
  input: unknown;
  run: PlainRun;
  signal: AbortSignal;
  emit: (event: ChatSseEvent) => void;
  onProgress?: () => void;
}): Promise<{ interrupted: false; values: unknown }> {
  const model = await asChatModel(opts.run.model ?? config.model.orchestrator);
  const userText = userTextFromInput(opts.input);
  const messages = await plainMessages(opts.run, userText);
  let assistant = "";

  const stream = await model.stream(messages, llmConfig(opts.run, opts.signal, opts.onProgress));
  for await (const chunk of stream) {
    opts.onProgress?.();
    if (opts.signal.aborted) break;
    const delta = contentText(chunk.content);
    if (!delta) continue;
    assistant += delta;
    opts.emit({ event: "messages", data: { text: assistant, ns: [] } });
  }

  return { interrupted: false, values: valuesOf(assistant) };
}

export async function invokePlainTurn(opts: {
  input: unknown;
  run: PlainRun;
  signal: AbortSignal;
  onProgress?: () => void;
}): Promise<{ interrupted: false; values: unknown }> {
  const model = await asChatModel(opts.run.model ?? config.model.orchestrator);
  const userText = userTextFromInput(opts.input);
  const messages = await plainMessages(opts.run, userText);
  opts.onProgress?.();
  const reply = await model.invoke(messages, llmConfig(opts.run, opts.signal, opts.onProgress));
  return { interrupted: false, values: valuesOf(contentText(reply.content)) };
}
