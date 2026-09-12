import { Command, GraphRecursionError } from "@langchain/langgraph";
import { PHASE, PVT_PHASE } from "../../agents/harness";
import { AGENT_INTERRUPT_ON } from "../../agents/interrupt-on";
import { config } from "../../config";
import type { ChatSseEvent } from "./events";
import { artifactFromState } from "./finalize";

const STREAM_MODES = new Set(["messages", "updates", "values", "custom", "debug", "tools"]);

const INTERRUPT_TOOLS = new Set(Object.keys(AGENT_INTERRUPT_ON));

export interface StreamPart {
  namespace: string[];
  mode: string;
  data: unknown;
}

export function parseStreamChunk(chunk: unknown): StreamPart {
  if (chunk && typeof chunk === "object" && "type" in chunk) {
    const row = chunk as { type: unknown; ns?: unknown; data?: unknown };
    return {
      namespace: asNamespace(row.ns),
      mode: String(row.type ?? "updates"),
      data: row.data,
    };
  }

  if (Array.isArray(chunk)) {
    if (chunk.length >= 3) {
      return {
        namespace: asNamespace(chunk[0]),
        mode: String(chunk[1]),
        data: chunk[2],
      };
    }
    if (chunk.length === 2) {
      const [left, right] = chunk;
      if (typeof left === "string" && STREAM_MODES.has(left)) {
        return { namespace: [], mode: left, data: right };
      }
      return {
        namespace: asNamespace(left),
        mode: "updates",
        data: right,
      };
    }
  }

  return { namespace: [], mode: "updates", data: chunk };
}

function asNamespace(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value) return [value];
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      const rec = asRecord(block);
      if (typeof rec.text === "string") return rec.text;
      return "";
    })
    .join("");
}

function messageType(msg: Record<string, unknown>): string {
  if (typeof msg.type === "string") return msg.type;
  if (typeof msg.role === "string") return msg.role;
  const id = msg.id;
  if (Array.isArray(id) && typeof id[0] === "string") return id[0];
  return "";
}

function isAiMessage(msg: Record<string, unknown>): boolean {
  const type = messageType(msg);
  return type === "ai" || type === "assistant" || type === "AIMessageChunk";
}

function isToolMessage(msg: Record<string, unknown>): boolean {
  const type = messageType(msg);
  return type === "tool" || type === "ToolMessage";
}

function toolCallsOf(msg: Record<string, unknown>): Array<{
  id: string;
  name: string;
  args: Record<string, unknown>;
}> {
  const raw = msg.tool_calls ?? msg.toolCalls;
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    const rec = asRecord(item);
    const argsRaw = rec.args ?? rec.arguments;
    return {
      id: String(rec.id ?? rec.tool_call_id ?? `${rec.name ?? "tool"}:${index}`),
      name: String(rec.name ?? "tool"),
      args: asRecord(argsRaw),
    };
  });
}

function collectMessages(data: unknown, into: Record<string, unknown>[]): void {
  if (!data || typeof data !== "object") return;
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const rec = item as Record<string, unknown>;
        if (
          "content" in rec ||
          "tool_calls" in rec ||
          rec.type === "tool" ||
          rec.type === "ai" ||
          rec.type === "human"
        ) {
          into.push(rec);
          continue;
        }
      }
      collectMessages(item, into);
    }
    return;
  }
  const rec = data as Record<string, unknown>;
  if ("messages" in rec) {
    collectMessages(rec.messages, into);
    return;
  }
  for (const value of Object.values(rec)) collectMessages(value, into);
}

export function costHintFor(
  name: string,
  args: Record<string, unknown>,
  modelOverride?: string,
): string {
  if (name === "task") {
    const owner = String(args.subagent_type ?? "");
    const row = [...Object.values(PHASE), ...Object.values(PVT_PHASE)].find(
      (phase) => phase.owner === owner,
    );
    const model = modelOverride ?? row?.model ?? config.model.orchestrator;
    return `${model} · tokens unknown until run`;
  }
  return `${modelOverride ?? config.model.orchestrator} · tokens unknown until run`;
}

export function scopeOf(name: string, args: Record<string, unknown>): string {
  if (name === "task") return String(args.subagent_type ?? "specialist");
  const path = args.path ?? args.paths ?? args.target ?? args.filename;
  if (typeof path === "string") return path;
  if (Array.isArray(path)) return path.map(String).join(", ");
  if (typeof args.query === "string") return args.query;
  if (typeof args.sql === "string") return args.sql.slice(0, 160);
  if (typeof args.description === "string") return args.description.slice(0, 160);
  return name;
}

export interface HitlDecision {
  type: "approve" | "edit" | "reject";
  message?: string;
  editedAction?: { name: string; args: Record<string, unknown> };
}

export function resumeCommand(decisions: HitlDecision[]): Command {
  return new Command({ resume: { decisions } });
}

export function interruptFromState(state: unknown): {
  actionRequests: Array<{
    name: string;
    args: Record<string, unknown>;
    description?: string;
    allowedDecisions: Array<"approve" | "edit" | "reject">;
  }>;
} | null {
  const interrupts = collectInterrupts(state);
  for (const value of interrupts) {
    const rec = asRecord(value);
    const inner = "__interrupt__" in rec ? rec.__interrupt__ : value;
    const payload = Array.isArray(inner) ? asRecord(inner[0]) : asRecord(inner);
    const nested = "value" in payload ? asRecord(payload.value) : payload;
    const requests = nested.actionRequests;
    if (!Array.isArray(requests) || requests.length === 0) continue;
    const reviews = Array.isArray(nested.reviewConfigs)
      ? nested.reviewConfigs
      : [];
    const byName = new Map<string, Array<"approve" | "edit" | "reject">>();
    for (const review of reviews) {
      const row = asRecord(review);
      const name = String(row.actionName ?? "");
      const allowed = Array.isArray(row.allowedDecisions)
        ? row.allowedDecisions.filter(
            (item): item is "approve" | "edit" | "reject" =>
              item === "approve" || item === "edit" || item === "reject",
          )
        : [];
      if (name) byName.set(name, allowed);
    }
    return {
      actionRequests: requests.map((item) => {
        const action = asRecord(item);
        const name = String(action.name ?? "tool");
        return {
          name,
          args: asRecord(action.args),
          description:
            typeof action.description === "string"
              ? action.description
              : undefined,
          allowedDecisions: byName.get(name) ?? ["approve", "edit", "reject"],
        };
      }),
    };
  }
  return null;
}

function collectInterrupts(state: unknown): unknown[] {
  const out: unknown[] = [];
  if (!state || typeof state !== "object") return out;
  const rec = state as Record<string, unknown>;
  if (rec.__interrupt__) out.push(rec.__interrupt__);
  if (Array.isArray(rec.tasks)) {
    for (const task of rec.tasks) {
      const row = asRecord(task);
      if (Array.isArray(row.interrupts)) {
        for (const item of row.interrupts) {
          const interrupt = asRecord(item);
          out.push(interrupt.value ?? item);
        }
      }
    }
  }
  if (rec.values) out.push(...collectInterrupts(rec.values));
  return out;
}

export function autoApproveDecisions(count: number): HitlDecision[] {
  return Array.from({ length: count }, () => ({ type: "approve" as const }));
}

export interface StreamMapper {
  push(part: StreamPart, emit: (event: ChatSseEvent) => void, model?: string): void;
  lastValues: unknown;
  assistantText: string;
}

export function createStreamMapper(): StreamMapper {
  let assistantText = "";
  let lastValues: unknown;
  const steps = new Map<string, string>();

  return {
    get lastValues() {
      return lastValues;
    },
    get assistantText() {
      return assistantText;
    },
    push(part, emit, model) {
      if (part.mode === "values") {
        lastValues = part.data;
        return;
      }

      if (part.mode === "messages") {
        const [message] = Array.isArray(part.data) ? part.data : [part.data];
        const rec = asRecord(message);
        if (!isAiMessage(rec)) return;
        const delta = contentText(rec.content);
        if (!delta) {
          for (const call of toolCallsOf(rec)) {
            emitStep(call, part.namespace, "running", emit, model);
          }
          return;
        }
        assistantText += delta;
        emit({
          event: "messages",
          data: { text: assistantText, ns: part.namespace },
        });
        return;
      }

      if (part.mode !== "updates") return;

      const messages: Record<string, unknown>[] = [];
      collectMessages(part.data, messages);
      for (const msg of messages) {
        if (isAiMessage(msg)) {
          const full = contentText(msg.content);
          if (full && full.length >= assistantText.length) {
            assistantText = full;
            emit({
              event: "messages",
              data: { text: assistantText, ns: part.namespace },
            });
          }
          for (const call of toolCallsOf(msg)) {
            const status = INTERRUPT_TOOLS.has(call.name)
              ? "waiting"
              : "running";
            emitStep(call, part.namespace, status, emit, model);
            steps.set(call.id, call.name);
          }
        }
        if (isToolMessage(msg)) {
          const id = String(msg.tool_call_id ?? msg.tool_callId ?? "");
          const name = String(msg.name ?? steps.get(id) ?? "tool");
          const evidence = contentText(msg.content).slice(0, 4000);
          emit({
            event: "step",
            data: {
              id: id || `${name}:${steps.size}`,
              name,
              args: {},
              status: "completed",
              ns: part.namespace,
              evidence,
              permission: INTERRUPT_TOOLS.has(name) ? "interrupt" : "allow",
            },
          });
        }
      }
    },
  };

  function emitStep(
    call: { id: string; name: string; args: Record<string, unknown> },
    ns: string[],
    status: "running" | "waiting",
    emit: (event: ChatSseEvent) => void,
    model?: string,
  ): void {
    emit({
      event: "step",
      data: {
        id: call.id,
        name: call.name,
        args: call.args,
        status,
        ns,
        permission: INTERRUPT_TOOLS.has(call.name) ? "interrupt" : "allow",
        costHint: costHintFor(call.name, call.args, model),
      },
    });
  }
}

export function valuesEvent(
  result: unknown,
  artifacts: unknown[],
): Extract<ChatSseEvent, { event: "values" }> {
  const { type, data } = artifactFromState(result);
  return { event: "values", data: { type, data, artifacts } };
}

export function isGraphRecursion(err: unknown): boolean {
  return (
    err instanceof GraphRecursionError ||
    (err instanceof Error && /recursion limit/i.test(err.message))
  );
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String(err.name) : "";
  if (name === "AbortError" || name === "TimeoutError") return true;
  /**
   * LangGraph rejects with `new Error("Abort")` when the invoke signal
   * fires. That is not a DOMException and its `name` is still `"Error"`.
   */
  const message = "message" in err ? String(err.message) : "";
  return message === "Abort";
}
