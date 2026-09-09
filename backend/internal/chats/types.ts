export const DEFAULT_CHAT_TITLE = "New chat";
export const CHAT_LIST_PAGE_SIZE = 20;
export const CHAT_TITLE_MAX = 80;

export type ChatRole = "user" | "assistant";

export type ChatMessagePart = {
  type: string;
  text?: string;
  [key: string]: unknown;
};

export type ChatMessageContent = {
  parts: ChatMessagePart[];
  usage?: unknown;
  artifacts?: unknown;
  steps?: unknown;
};

export type ChatThreadRow = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type ChatMessageRow = {
  id: string;
  thread_id: string;
  user_id: string;
  role: ChatRole;
  content: ChatMessageContent;
  created_at: string;
};

export type ChatThreadResponse = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessageResponse = {
  id: string;
  role: ChatRole;
  content: ChatMessageContent;
  createdAt: string;
};

export type ChatThreadDetailResponse = ChatThreadResponse & {
  messages: ChatMessageResponse[];
};

export type ChatThreadListResponse = {
  data: ChatThreadResponse[];
  nextCursor: string | null;
};

export type AppendMessageInput = {
  role: ChatRole;
  content: ChatMessageContent;
};
