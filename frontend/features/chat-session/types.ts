export type ChatSessionStatus =
  | "idle"
  | "submitted"
  | "streaming"
  | "waiting"
  | "error";

export type SoundKind = "pending" | "ready";

export interface ChatSessionSnapshot {
  threadId: string | null;
  status: ChatSessionStatus;
  phase: string | null;
  updatedAt: number;
  settledAt: number;
  soundKind: SoundKind | null;
}

export interface LiveTurnPatch {
  threadId?: string | null;
  status: ChatSessionStatus;
  phase?: string | null;
}

export interface SettleTurnInput {
  threadId?: string | null;
  phase?: string | null;
  ok: boolean;
}
