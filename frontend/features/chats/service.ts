import { AGENT_API, VAULT_TOKEN } from "@/lib/api";
import {
  type ChatApiResponse,
  type ChatThread,
  type ChatThreadDetail,
  type ChatThreadList,
} from "./types";

async function chatRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<ChatApiResponse<T> & { ok: true }> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (VAULT_TOKEN) {
    headers.set("Authorization", `Bearer ${VAULT_TOKEN}`);
  }

  const res = await fetch(`${AGENT_API}/v1/chats${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  let json: ChatApiResponse<T>;
  try {
    json = (await res.json()) as ChatApiResponse<T>;
  } catch {
    throw new Error(`Chat request failed (${res.status})`);
  }
  if (!json.ok) {
    throw new Error(json.error || `Chat request failed (${res.status})`);
  }
  return json;
}

export const chatService = {
  list: async (cursor?: string): Promise<ChatThreadList> => {
    const params = new URLSearchParams({ limit: "20" });
    if (cursor) params.set("cursor", cursor);
    const json = await chatRequest<ChatThread[]>(`/?${params.toString()}`);
    return { threads: json.data, nextCursor: json.nextCursor ?? null };
  },

  create: async (): Promise<ChatThread> => {
    const json = await chatRequest<ChatThread>("/", { method: "POST" });
    return json.data;
  },

  get: async (threadId: string): Promise<ChatThreadDetail> => {
    const json = await chatRequest<ChatThreadDetail>(
      `/${encodeURIComponent(threadId)}`,
    );
    return json.data;
  },

  delete: async (threadId: string): Promise<{ id: string }> => {
    const json = await chatRequest<{ id: string }>(
      `/${encodeURIComponent(threadId)}`,
      { method: "DELETE" },
    );
    return json.data;
  },
};
