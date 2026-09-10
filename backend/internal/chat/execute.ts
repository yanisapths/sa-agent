import { agentFor } from "../../agents";
import { chatAgentFor } from "../../agents/chat-agent";
import type { AgentKind } from "../../agents/route";
import { config } from "../../config";
import { HttpError } from "../httpError";
import type { UsageCollector } from "../gateway/usage";
import { withVaultMount, type VaultMount } from "../vault/mount";
import { withWorkspaceRoot } from "../workspace/runtime";
import type { ChatSseEvent } from "./events";
import { recordAssistantTurn } from "../chats/service";
import { persistTurnArtifacts, artifactFromState } from "./finalize";
import {
  autoApproveDecisions,
  costHintFor,
  createStreamMapper,
  interruptFromState,
  isAbortError,
  isGraphRecursion,
  parseStreamChunk,
  resumeCommand,
  scopeOf,
  valuesEvent,
  type HitlDecision,
} from "./stream";
import { executionMaxMs, executionTimeoutMs } from "./run-context";
import { invokePlainTurn, streamPlainTurn } from "./plain";
import type { ChatActionRequest } from "./events";

export interface AgentRunConfig {
  threadId: string;
  userId?: string;
  model?: string;
  phase?: string;
  /** `plain` = no tools. `chat` = web/Jira. `deep` = harness. */
  kind?: AgentKind;
  workspaceId?: string;
  workspaceRoot?: string;
  vaultMount?: VaultMount;
  collector: UsageCollector;
  startedAt: number;
}

function agentForRun(run: AgentRunConfig) {
  return run.kind === "chat" ? chatAgentFor(run.model) : agentFor(run.model);
}

type CheckpointGraph = {
  getState: (config: {
    configurable: { thread_id: string };
  }) => Promise<{ values?: unknown; tasks?: unknown }>;
};

function checkpointGraph(agent: ReturnType<typeof agentForRun>): CheckpointGraph {
  const rec = agent as { graph?: CheckpointGraph } & CheckpointGraph;
  return rec.graph ?? rec;
}

function progressCallbacks(onProgress?: () => void) {
  if (!onProgress) return [];
  return [
    {
      handleLLMStart: onProgress,
      handleLLMNewToken: onProgress,
      handleLLMEnd: onProgress,
      handleToolStart: onProgress,
      handleToolEnd: onProgress,
    },
  ];
}

function invokeConfig(
  run: AgentRunConfig,
  signal: AbortSignal,
  onProgress?: () => void,
): Record<string, unknown> {
  return {
    configurable: {
      thread_id: run.threadId,
      userId: run.userId,
      ...(run.workspaceId
        ? { workspaceId: run.workspaceId, workspaceRoot: run.workspaceRoot }
        : {}),
    },
    recursionLimit:
      run.kind === "chat" ? 16 : config.agent.recursionLimit,
    signal,
    callbacks: [run.collector.handler, ...progressCallbacks(onProgress)],
  };
}

function withMounts<T>(
  run: AgentRunConfig,
  fn: () => Promise<T>,
): Promise<T> {
  return withWorkspaceRoot(run.workspaceRoot, () =>
    withVaultMount(run.vaultMount, fn),
  );
}

function toActionRequests(
  interrupt: NonNullable<ReturnType<typeof interruptFromState>>,
  model?: string,
): ChatActionRequest[] {
  return interrupt.actionRequests.map((action) => ({
    name: action.name,
    args: action.args,
    description: action.description,
    allowedDecisions: action.allowedDecisions,
    costHint: costHintFor(action.name, action.args, model),
    permission: "interrupt" as const,
    scope: scopeOf(action.name, action.args),
  }));
}

export async function streamAgentTurn(opts: {
  input: unknown;
  run: AgentRunConfig;
  signal: AbortSignal;
  emit: (event: ChatSseEvent) => void;
  onProgress?: () => void;
}): Promise<{ interrupted: boolean; values: unknown }> {
  if (opts.run.kind === "plain") {
    return streamPlainTurn(opts);
  }
  const agent = agentForRun(opts.run);
  const mapper = createStreamMapper();
  const cfg = invokeConfig(opts.run, opts.signal, opts.onProgress);

  try {
    await withMounts(opts.run, async () => {
      const stream = await agent.stream(opts.input as never, {
        ...cfg,
        streamMode: ["messages", "updates", "values"],
        subgraphs: true,
      });
      for await (const chunk of stream) {
        opts.onProgress?.();
        if (opts.signal.aborted) break;
        mapper.push(parseStreamChunk(chunk), opts.emit, opts.run.model);
      }
    });
  } catch (err) {
    if (opts.signal.aborted || isAbortError(err)) throw err;
    if (isGraphRecursion(err)) {
      throw new HttpError(
        504,
        `Agent stopped after ${config.agent.recursionLimit} steps to prevent a retry loop.`,
      );
    }
    throw err;
  }

  const snapshot = await checkpointGraph(agent).getState({
    configurable: { thread_id: opts.run.threadId },
  });
  const interrupt = interruptFromState(snapshot) ?? interruptFromState(mapper.lastValues);
  if (interrupt) {
    opts.emit({
      event: "interrupt",
      data: { actionRequests: toActionRequests(interrupt, opts.run.model) },
    });
    return { interrupted: true, values: mapper.lastValues ?? snapshot.values };
  }

  const values = mapper.lastValues ?? snapshot.values;
  return { interrupted: false, values };
}

export async function finishTurn(opts: {
  run: AgentRunConfig;
  values: unknown;
  emit?: (event: ChatSseEvent) => void;
}): Promise<{ type: string; data: unknown; artifacts: unknown[] }> {
  const artifacts = await persistTurnArtifacts({
    userId: opts.run.userId,
    threadId: opts.run.threadId,
    phase: opts.run.phase,
    result: opts.values,
    startedAt: opts.run.startedAt,
    vaultMount: opts.run.vaultMount,
  });
  if (opts.emit) opts.emit(valuesEvent(opts.values, artifacts));
  const { type, data } = artifactFromState(opts.values);
  await recordAssistantTurn({
    userId: opts.run.userId,
    threadId: opts.run.threadId,
    type,
    data,
    artifacts,
  });
  return { type, data, artifacts };
}

export async function invokeAgentTurn(opts: {
  input: unknown;
  run: AgentRunConfig;
  signal: AbortSignal;
  onProgress?: () => void;
}): Promise<{ type: string; data: unknown; artifacts: unknown[]; values: unknown }> {
  if (opts.run.kind === "plain") {
    const result = await invokePlainTurn(opts);
    const finished = await finishTurn({ run: opts.run, values: result.values });
    return { ...finished, values: result.values };
  }
  const agent = agentForRun(opts.run);
  const cfg = invokeConfig(opts.run, opts.signal, opts.onProgress);
  let next: unknown = opts.input;
  let result: unknown;

  try {
    for (let hop = 0; hop < 16; hop++) {
      opts.onProgress?.();
      result = await withMounts(opts.run, () =>
        agent.invoke(next as never, cfg),
      );
      const interrupt =
        interruptFromState(result) ??
        interruptFromState(
          await checkpointGraph(agent).getState({
            configurable: { thread_id: opts.run.threadId },
          }),
        );
      if (!interrupt) break;
      next = resumeCommand(
        autoApproveDecisions(interrupt.actionRequests.length),
      );
    }
  } catch (err) {
    if (opts.signal.aborted || isAbortError(err)) throw err;
    if (isGraphRecursion(err)) {
      throw new HttpError(
        504,
        `Agent stopped after ${config.agent.recursionLimit} steps to prevent a retry loop.`,
      );
    }
    throw err;
  }

  const finished = await finishTurn({ run: opts.run, values: result });
  return { ...finished, values: result };
}

export function parseDecisions(raw: unknown): HitlDecision[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpError(400, "decisions[] is required.");
  }
  return raw.map((item) => {
    const rec =
      item && typeof item === "object"
        ? (item as Record<string, unknown>)
        : {};
    const type = rec.type;
    if (type === "approve") return { type: "approve" };
    if (type === "reject") {
      return {
        type: "reject",
        message:
          typeof rec.message === "string"
            ? rec.message
            : "User rejected this action. Do not retry the same tool call.",
      };
    }
    if (type === "edit") {
      const edited = rec.editedAction;
      const action =
        edited && typeof edited === "object"
          ? (edited as Record<string, unknown>)
          : rec;
      const name = String(action.name ?? "");
      const args =
        action.args && typeof action.args === "object"
          ? (action.args as Record<string, unknown>)
          : {};
      if (!name) throw new HttpError(400, "edit decisions need editedAction.name.");
      return { type: "edit", editedAction: { name, args } };
    }
    throw new HttpError(400, `Unknown decision type "${String(type)}".`);
  });
}

export interface ExecutionWatchdog {
  bump: () => void;
  stop: () => void;
}

/**
 * Two clocks: an idle timer that resets whenever the graph emits, and a hard
 * wall clock that does not. A pvt-plan that is still calling tools must not
 * die at three minutes; a specialist that has gone silent still must.
 */
export function startExecutionTimer(abort: AbortController): ExecutionWatchdog {
  const idleMs = executionTimeoutMs();
  const maxMs = executionMaxMs();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const fire = (reason: "timeout-idle" | "timeout-max") => {
    if (!abort.signal.aborted) abort.abort(reason);
  };

  const armIdle = () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => fire("timeout-idle"), idleMs);
  };

  const maxTimer = setTimeout(() => fire("timeout-max"), maxMs);
  armIdle();

  return {
    bump() {
      if (!abort.signal.aborted) armIdle();
    },
    stop() {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      clearTimeout(maxTimer);
    },
  };
}

export { resumeCommand };
