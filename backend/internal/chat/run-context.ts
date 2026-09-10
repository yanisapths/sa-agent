import { config } from "../../config";
import type { VaultMount } from "../vault/mount";
import type { UsageCollector } from "../gateway/usage";
import type { AgentKind } from "../../agents/route";

/** How long a paused HITL turn keeps its vault/workspace mounts. */
const CONTEXT_TTL_MS = 30 * 60 * 1000;

export interface ChatRunContext {
  threadId: string;
  userId: string | undefined;
  model: string | undefined;
  phase: string | undefined;
  kind: AgentKind | undefined;
  workspaceRoot: string | undefined;
  workspaceId: string | undefined;
  vaultMount: VaultMount | undefined;
  /** Wall clock when the human first sent the message — artifact persist cutoff. */
  startedAt: number;
  /** Time spent actually running the graph, excluding HITL wait. */
  executionMs: number;
  collector: UsageCollector;
  expiresAt: number;
}

const runs = new Map<string, ChatRunContext>();

function sweep(now: number): void {
  for (const [id, run] of runs) {
    if (run.expiresAt <= now) runs.delete(id);
  }
}

export function putChatRun(run: ChatRunContext): void {
  sweep(Date.now());
  runs.set(run.threadId, run);
}

export function getChatRun(threadId: string): ChatRunContext | undefined {
  sweep(Date.now());
  const run = runs.get(threadId);
  if (!run) return undefined;
  run.expiresAt = Date.now() + CONTEXT_TTL_MS;
  return run;
}

export function dropChatRun(threadId: string): void {
  runs.delete(threadId);
}

export function touchChatRun(threadId: string): void {
  const run = runs.get(threadId);
  if (run) run.expiresAt = Date.now() + CONTEXT_TTL_MS;
}

export function executionTimeoutMs(): number {
  return config.agent.invokeTimeoutMs;
}

export function executionMaxMs(): number {
  return Math.max(config.agent.invokeMaxMs, config.agent.invokeTimeoutMs);
}
