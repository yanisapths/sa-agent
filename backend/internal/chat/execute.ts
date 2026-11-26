import { SystemMessage } from "@langchain/core/messages";
import { agentFor } from "../../agents";
import { chatAgentFor } from "../../agents/chat-agent";
import type { AgentKind } from "../../agents/route";
import { loadSkillBody, type ChatStyle } from "../../agents/skill";
import { config } from "../../config";
import { HttpError } from "../httpError";
import type { UsageCollector } from "../gateway/usage";
import { withLlmSession } from "../gateway/session";
import { withVaultMount, type VaultMount } from "../vault/mount";
import { withWorkspaceRoot } from "../workspace/runtime";
import type { ChatSseEvent } from "./events";
import { recordAssistantTurn } from "../chats/service";
import { persistTurnArtifacts, artifactFromState } from "./finalize";
import { mintFeedbackUrls, type ChatFeedback } from "./feedback";
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
import { withToolEventEmitter, type ToolEventEmitter } from "./tool-context";
import type { Connection } from "../../contract/connection";
import type { HarnessProfile } from "../../agents/harness";
import { capabilitiesOf } from "../product/capabilities";
import { withConnections } from "../product/connections";
import { withProduct } from "../product/runtime";
import type { ResolvedProduct } from "../product/types";

export interface AgentRunConfig {
  threadId: string;
  userId?: string;
  model?: string;
  phase?: string;
  /** Reply style. Injected on chat/plain turns only — never on harness. */
  style?: ChatStyle;
  /** `plain` = no tools. `chat` = web/Jira. `deep` = harness. */
  kind?: AgentKind;
  workspaceId?: string;
  workspaceRoot?: string;
  vaultMount?: VaultMount;
  /** The active product. Public metadata and env-var names only. */
  product: ResolvedProduct;
  collector: UsageCollector;
  startedAt: number;
  /** LangSmith root span for this user-visible turn. */
  runId?: string;
  claimRoot?: boolean;
}

/**
 * Connections are passed per segment, never stored on the run: a paused HITL
 * run is held for 30 minutes and must not hold the user's credentials.
 */
export function harnessProfileFor(
  run: Pick<AgentRunConfig, "product" | "workspaceRoot">,
  connections: readonly Connection[],
): HarnessProfile {
  return {
    caps: capabilitiesOf(run.product, { attachedRoot: run.workspaceRoot, connections }),
    models: run.product.models,
  };
}

function agentForRun(run: AgentRunConfig, connections: readonly Connection[]) {
  const profile = harnessProfileFor(run, connections);
  return run.kind === "chat"
    ? chatAgentFor(run.model, profile)
    : agentFor(run.model, profile);
}

/**
 * Caveman is a conversational voice. Prepend it on chat turns so the JSON
 * envelope still holds; harness specialists never see it.
 */
function inputWithStyle(input: unknown, run: AgentRunConfig): unknown {
  if (run.style !== "caveman" || run.kind !== "chat") return input;
  if (!input || typeof input !== "object") return input;
  const rec = input as { messages?: unknown[] };
  if (!Array.isArray(rec.messages)) return input;
  return {
    ...rec,
    messages: [new SystemMessage(loadSkillBody("caveman")), ...rec.messages],
  };
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

function tracingFields(run: AgentRunConfig): Record<string, unknown> {
  if (!run.runId || run.claimRoot === false) return {};
  return {
    runId: run.runId,
    runName: "chat-turn",
    tags: ["gui", run.kind ?? "deep"],
    metadata: {
      thread_id: run.threadId,
      agent_kind: run.kind ?? "deep",
      product: run.product.slug,
    },
  };
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
      productId: run.product.id,
      ...(run.workspaceId
        ? { workspaceId: run.workspaceId, workspaceRoot: run.workspaceRoot }
        : {}),
    },
    recursionLimit: recursionLimitFor(run.kind),
    signal,
    callbacks: [run.collector.handler, ...progressCallbacks(onProgress)],
    promptCacheKey: run.threadId,
    ...tracingFields(run),
  };
}

function recursionLimitFor(kind: AgentKind | undefined): number {
  return kind === "chat"
    ? config.agent.chatRecursionLimit
    : config.agent.recursionLimit;
}

function withMounts<T>(
  run: AgentRunConfig,
  connections: readonly Connection[],
  fn: () => Promise<T>,
): Promise<T> {
  return withLlmSession(run.threadId, () =>
    withProduct(run.product, () =>
      withConnections(connections, () =>
        withWorkspaceRoot(run.workspaceRoot, () =>
          withVaultMount(run.vaultMount, fn),
        ),
      ),
    ),
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
  connections?: readonly Connection[];
  signal: AbortSignal;
  emit: (event: ChatSseEvent) => void;
  onProgress?: () => void;
}): Promise<{ interrupted: boolean; values: unknown }> {
  if (opts.run.kind === "plain") {
    return streamPlainTurn(opts);
  }
  const connections = opts.connections ?? [];
  const agent = agentForRun(opts.run, connections);
  const mapper = createStreamMapper();
  const cfg = invokeConfig(opts.run, opts.signal, opts.onProgress);
  opts.run.claimRoot = false;

  // Create tool event emitter to capture sandbox-run events
  const toolEmitter: ToolEventEmitter = {
    sandboxRun: (event) => {
      opts.emit({
        event: "sandbox-run",
        data: event,
      });
    },
  };

  try {
    await withMounts(opts.run, connections, async () => {
      await withToolEventEmitter(toolEmitter, async () => {
        const stream = await agent.stream(inputWithStyle(opts.input, opts.run) as never, {
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
    });
  } catch (err) {
    if (opts.signal.aborted || isAbortError(err)) throw err;
    if (isGraphRecursion(err)) {
      throw new HttpError(
        504,
        `Agent stopped after ${recursionLimitFor(opts.run.kind)} steps to prevent a retry loop.`,
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
}): Promise<{
  type: string;
  data: unknown;
  artifacts: unknown[];
  feedback: ChatFeedback | null;
}> {
  const artifacts = await withProduct(opts.run.product, () =>
    persistTurnArtifacts({
      userId: opts.run.userId,
      threadId: opts.run.threadId,
      phase: opts.run.phase,
      result: opts.values,
      startedAt: opts.run.startedAt,
      vaultMount: opts.run.vaultMount,
    }),
  );
  if (opts.emit) opts.emit(valuesEvent(opts.values, artifacts));
  const { type, data } = artifactFromState(opts.values);
  const feedback = await mintFeedbackUrls(opts.run.runId, opts.run.threadId);
  await recordAssistantTurn({
    userId: opts.run.userId,
    threadId: opts.run.threadId,
    type,
    data,
    artifacts,
    feedback: feedback ?? undefined,
  });
  if (opts.emit && feedback) {
    opts.emit({
      event: "feedback",
      data: { user_score: feedback.urls.user_score, runId: feedback.runId },
    });
  }
  return { type, data, artifacts, feedback };
}

export async function invokeAgentTurn(opts: {
  input: unknown;
  run: AgentRunConfig;
  connections?: readonly Connection[];
  signal: AbortSignal;
  onProgress?: () => void;
}): Promise<{
  type: string;
  data: unknown;
  artifacts: unknown[];
  values: unknown;
  feedback: ChatFeedback | null;
}> {
  if (opts.run.kind === "plain") {
    const result = await invokePlainTurn(opts);
    const finished = await finishTurn({ run: opts.run, values: result.values });
    return { ...finished, values: result.values };
  }
  const connections = opts.connections ?? [];
  const agent = agentForRun(opts.run, connections);
  const cfg = invokeConfig(opts.run, opts.signal, opts.onProgress);
  opts.run.claimRoot = false;
  let next: unknown = inputWithStyle(opts.input, opts.run);
  let result: unknown;

  try {
    for (let hop = 0; hop < 16; hop++) {
      opts.onProgress?.();
      result = await withMounts(opts.run, connections, () =>
        agent.invoke(next as never, cfg),
      );
      delete cfg.runId;
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
        `Agent stopped after ${recursionLimitFor(opts.run.kind)} steps to prevent a retry loop.`,
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
