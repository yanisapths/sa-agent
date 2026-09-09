import { type UIMessage, type UIPart } from "@/components/chat-message";
import { type ChatArtifact } from "@/features/artifacts/types";
import { type ChatUsage } from "@/features/gateway/types";
import { type ThoughtStep } from "@/lib/chat-stream";

export const DEFAULT_CHAT_TITLE = "New chat";
export const CHAT_LIST_PAGE_SIZE = 20;
export const CHAT_TITLE_MAX = 80;

export type ChatRole = "user" | "assistant";

export interface ChatMessagePart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface ChatMessageContent {
  parts: ChatMessagePart[];
  usage?: ChatUsage;
  artifacts?: ChatArtifact[];
  steps?: ThoughtStep[];
}

export interface ChatThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: ChatMessageContent;
  createdAt: string;
}

export interface ChatThreadDetail extends ChatThread {
  messages: ChatMessage[];
}

export interface ChatThreadList {
  threads: ChatThread[];
  nextCursor: string | null;
}

export interface SessionLoad {
  seq: number;
  threadId: string | null;
  messages: UIMessage[];
}

type ChatOk<T> = { ok: true; data: T; nextCursor?: string | null };
type ChatErr = { ok: false; error: string };
export type ChatApiResponse<T> = ChatOk<T> | ChatErr;

export function titleFromText(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return DEFAULT_CHAT_TITLE;
  if (trimmed.length <= CHAT_TITLE_MAX) return trimmed;
  return `${trimmed.slice(0, CHAT_TITLE_MAX - 3)}...`;
}

export function titleFromMessages(messages: UIMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  const text =
    first?.parts.find((part) => part.type === "text" && part.text)?.text ?? "";
  return titleFromText(text);
}

export function toUiMessage(row: ChatMessage): UIMessage {
  return {
    id: row.id,
    role: row.role,
    parts: (row.content.parts ?? []) as UIPart[],
    usage: row.content.usage,
    artifacts: row.content.artifacts,
    steps: row.content.steps,
  };
}
