import { agentFor } from "../../agents";
import { config } from "../../config";
import { HttpError } from "../httpError";
import type { UsageCollector } from "../gateway/usage";
import { withVaultMount, type VaultMount } from "../vault/mount";
import { withWorkspaceRoot } from "../workspace/runtime";
import type { ChatSseEvent } from "./events";
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
import { executionTimeoutMs } from "./run-context";
import type { ChatActionRequest } from "./events";

export interface AgentRunConfig {
  threadId: string;
  userId?: string;
  model?: string;
  phase?: string;
  workspaceId?: string;
  workspaceRoot?: string;
  vaultMount?: VaultMount;
  collector: UsageCollector;
  startedAt: number;
}

function invokeConfig(
  run: AgentRunConfig,
  signal: AbortSignal,
): Record<string, unknown> {
  return {
    configurable: {
      thread_id: run.threadId,
      userId: run.userId,
      ...(run.workspaceId
        ? { workspaceId: run.workspaceId, workspaceRoot: run.workspaceRoot }
        : {}),
    },
    recursionLimit: config.agent.recursionLimit,
    signal,
    callbacks: [run.collector.handler],
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
}): Promise<{ interrupted: boolean; values: unknown }> {
  const agent = agentFor(opts.run.model);
  const mapper = createStreamMapper();
  const cfg = invokeConfig(opts.run, opts.signal);

  try {
    await withMounts(opts.run, async () => {
      const stream = await agent.stream(opts.input as never, {
        ...cfg,
        streamMode: ["messages", "updates", "values"],
        subgraphs: true,
      });
      for await (const chunk of stream) {
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

  const snapshot = (await agent.getState({
    configurable: { thread_id: opts.run.threadId },
  })) as { values?: unknown; tasks?: unknown };
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
  return { type, data, artifacts };
}

export async function invokeAgentTurn(opts: {
  input: unknown;
  run: AgentRunConfig;
  signal: AbortSignal;
}): Promise<{ type: string; data: unknown; artifacts: unknown[]; values: unknown }> {
  const agent = agentFor(opts.run.model);
  const cfg = invokeConfig(opts.run, opts.signal);
  let next: unknown = opts.input;
  let result: unknown;

  try {
    for (let hop = 0; hop < 16; hop++) {
      result = await withMounts(opts.run, () =>
        agent.invoke(next as never, cfg),
      );
      const interrupt =
        interruptFromState(result) ??
        interruptFromState(
          await agent.getState({
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

export function startExecutionTimer(abort: AbortController): ReturnType<typeof setTimeout> {
  return setTimeout(() => abort.abort(), executionTimeoutMs());
}

export { resumeCommand };
