"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import { chatService } from "./service";
import {
  type ChatThread,
  type SessionLoad,
  toUiMessage,
} from "./types";

interface ChatHistoryContextValue {
  threads: ChatThread[];
  nextCursor: string | null;
  status: "loading" | "ready" | "error";
  error: string | null;
  selectedThreadId: string | null;
  sessionLoad: SessionLoad | null;
  loadingMore: boolean;
  startNewChat: () => Promise<void>;
  openThread: (threadId: string) => Promise<void>;
  loadMore: () => Promise<void>;
  remove: (threadId: string) => Promise<void>;
  touchThread: (patch: {
    id: string;
    title?: string;
    updatedAt?: string;
  }) => void;
}

const ChatHistoryContext = createContext<ChatHistoryContextValue | null>(null);

export function ChatHistoryProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [sessionLoad, setSessionLoad] = useState<SessionLoad | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const seqRef = useRef(0);

  const applySession = useCallback(
    (threadId: string | null, messages: SessionLoad["messages"]) => {
      seqRef.current += 1;
      setSelectedThreadId(threadId);
      setSessionLoad({
        seq: seqRef.current,
        threadId,
        messages,
      });
    },
    [],
  );

  const goToChat = useCallback(() => {
    if (pathname !== "/") router.push("/");
  }, [pathname, router]);

  const refresh = useCallback(async () => {
    try {
      const page = await chatService.list();
      setThreads(page.threads);
      setNextCursor(page.nextCursor);
      setStatus("ready");
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load chats");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await chatService.list(nextCursor);
      setThreads((prev) => {
        const seen = new Set(prev.map((thread) => thread.id));
        return [
          ...prev,
          ...page.threads.filter((thread) => !seen.has(thread.id)),
        ];
      });
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load chats");
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor]);

  const startNewChat = useCallback(async () => {
    goToChat();
    try {
      const created = await chatService.create();
      setThreads((prev) => [
        created,
        ...prev.filter((thread) => thread.id !== created.id),
      ]);
      applySession(created.id, []);
      setStatus("ready");
      setError(null);
    } catch (err: unknown) {
      applySession(null, []);
      setError(err instanceof Error ? err.message : "Failed to start chat");
    }
  }, [applySession, goToChat]);

  const openThread = useCallback(
    async (threadId: string) => {
      goToChat();
      try {
        const detail = await chatService.get(threadId);
        applySession(detail.id, detail.messages.map(toUiMessage));
        setThreads((prev) => {
          const rest = prev.filter((thread) => thread.id !== detail.id);
          return [
            {
              id: detail.id,
              title: detail.title,
              createdAt: detail.createdAt,
              updatedAt: detail.updatedAt,
            },
            ...rest,
          ];
        });
        setError(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to open chat");
      }
    },
    [applySession, goToChat],
  );

  const remove = useCallback(
    async (threadId: string) => {
      try {
        await chatService.delete(threadId);
        setThreads((prev) => prev.filter((thread) => thread.id !== threadId));
        if (selectedThreadId === threadId) {
          applySession(null, []);
        }
        setError(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to delete chat");
      }
    },
    [applySession, selectedThreadId],
  );

  const touchThread = useCallback(
    (patch: { id: string; title?: string; updatedAt?: string }) => {
      const now = patch.updatedAt ?? new Date().toISOString();
      setThreads((prev) => {
        const existing = prev.find((thread) => thread.id === patch.id);
        const next: ChatThread = existing
          ? {
              ...existing,
              title: patch.title ?? existing.title,
              updatedAt: now,
            }
          : {
              id: patch.id,
              title: patch.title ?? "New chat",
              createdAt: now,
              updatedAt: now,
            };
        return [next, ...prev.filter((thread) => thread.id !== patch.id)];
      });
      setSelectedThreadId(patch.id);
    },
    [],
  );

  const value = useMemo(
    () => ({
      threads,
      nextCursor,
      status,
      error,
      selectedThreadId,
      sessionLoad,
      loadingMore,
      startNewChat,
      openThread,
      loadMore,
      remove,
      touchThread,
    }),
    [
      threads,
      nextCursor,
      status,
      error,
      selectedThreadId,
      sessionLoad,
      loadingMore,
      startNewChat,
      openThread,
      loadMore,
      remove,
      touchThread,
    ],
  );

  return (
    <ChatHistoryContext.Provider value={value}>
      {children}
    </ChatHistoryContext.Provider>
  );
}

export function useChatHistory(): ChatHistoryContextValue {
  const ctx = useContext(ChatHistoryContext);
  if (!ctx) {
    throw new Error("useChatHistory must be used within ChatHistoryProvider");
  }
  return ctx;
}
