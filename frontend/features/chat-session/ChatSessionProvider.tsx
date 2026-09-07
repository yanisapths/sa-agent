"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { soundKindForPhase } from "@/features/workflow/columns";
import {
  type ChatSessionSnapshot,
  type LiveTurnPatch,
  type SettleTurnInput,
} from "./types";

interface ChatSessionContextValue {
  session: ChatSessionSnapshot;
  setLive: (patch: LiveTurnPatch) => void;
  settleTurn: (input: SettleTurnInput) => void;
  soundsMuted: boolean;
  setSoundsMuted: (muted: boolean) => void;
}

const INITIAL: ChatSessionSnapshot = {
  threadId: null,
  status: "idle",
  phase: null,
  updatedAt: 0,
  settledAt: 0,
  soundKind: null,
};

const MUTE_KEY = "sa-workflow-sounds-muted";

const muteListeners = new Set<() => void>();
let muteValue = false;
let muteHydrated = false;

function hydrateMute() {
  if (muteHydrated || typeof window === "undefined") return;
  muteHydrated = true;
  muteValue = window.localStorage.getItem(MUTE_KEY) === "true";
}

function subscribeMute(onStoreChange: () => void) {
  hydrateMute();
  muteListeners.add(onStoreChange);
  return () => {
    muteListeners.delete(onStoreChange);
  };
}

function getMuteSnapshot() {
  hydrateMute();
  return muteValue;
}

function getMuteServerSnapshot() {
  return false;
}

function writeMuted(muted: boolean) {
  muteValue = muted;
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? "true" : "false");
  } catch {
    // Private mode can reject localStorage; mute still applies this session.
  }
  muteListeners.forEach((listener) => listener());
}

const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);

export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ChatSessionSnapshot>(INITIAL);
  const soundsMuted = useSyncExternalStore(
    subscribeMute,
    getMuteSnapshot,
    getMuteServerSnapshot,
  );

  const setSoundsMuted = useCallback((muted: boolean) => {
    writeMuted(muted);
  }, []);

  const setLive = useCallback((patch: LiveTurnPatch) => {
    setSession((prev) => ({
      ...prev,
      threadId: patch.threadId !== undefined ? patch.threadId : prev.threadId,
      status: patch.status,
      phase: patch.phase !== undefined ? patch.phase : prev.phase,
      updatedAt: Date.now(),
    }));
  }, []);

  const settleTurn = useCallback((input: SettleTurnInput) => {
    setSession((prev) => {
      const phase = input.phase !== undefined ? input.phase : prev.phase;
      return {
        threadId:
          input.threadId !== undefined ? input.threadId : prev.threadId,
        status: input.ok ? "idle" : "error",
        phase,
        updatedAt: Date.now(),
        settledAt: Date.now(),
        soundKind: input.ok ? soundKindForPhase(phase) : null,
      };
    });
  }, []);

  const value = useMemo(
    () => ({
      session,
      setLive,
      settleTurn,
      soundsMuted,
      setSoundsMuted,
    }),
    [session, setLive, settleTurn, soundsMuted, setSoundsMuted],
  );

  return (
    <ChatSessionContext.Provider value={value}>
      {children}
    </ChatSessionContext.Provider>
  );
}

export function useChatSession(): ChatSessionContextValue {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) {
    throw new Error("useChatSession must be used within ChatSessionProvider");
  }
  return ctx;
}
