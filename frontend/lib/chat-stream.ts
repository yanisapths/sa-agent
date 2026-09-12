import { type ChatUsage } from "@/features/gateway/types";
import { type ChatArtifact } from "@/features/artifacts/types";
import { type ChatArtifact as ChatResponseArtifact } from "@/lib/chat-response";

export type StepStatus =
  | "queued"
  | "running"
  | "waiting"
  | "error"
  | "retried"
  | "completed";

export interface ThoughtStep {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: StepStatus;
  ns: string[];
  evidence?: string;
  permission?: "allow" | "interrupt";
  costHint?: string;
}

export interface ActionRequest {
  name: string;
  args: Record<string, unknown>;
  description?: string;
  allowedDecisions: Array<"approve" | "edit" | "reject">;
  costHint: string;
  permission: "interrupt";
  scope: string;
}

export interface InterruptPayload {
  actionRequests: ActionRequest[];
}

export type HitlDecision =
  | { type: "approve" }
  | { type: "reject"; message?: string }
  | {
      type: "edit";
      editedAction: { name: string; args: Record<string, unknown> };
    };

export type UserScore = 1 | -1;

export type ChatFeedbackUrls = {
  user_score: string;
};

export type ChatFeedback = {
  runId: string;
  urls: ChatFeedbackUrls;
  score?: UserScore;
  comment?: string;
};

export type ChatSseEventName =
  | "thread"
  | "messages"
  | "step"
  | "interrupt"
  | "values"
  | "usage"
  | "feedback"
  | "done"
  | "error";

export interface ValuesPayload {
  type: string;
  data: ChatResponseArtifact;
  artifacts: ChatArtifact[];
}

export type ChatLiveStatus =
  | "idle"
  | "submitted"
  | "streaming"
  | "waiting"
  | "error";

export function isBusyStatus(status: ChatLiveStatus): boolean {
  return (
    status === "submitted" ||
    status === "streaming" ||
    status === "waiting"
  );
}

export async function readSse(
  response: Response,
  onEvent: (event: ChatSseEventName, data: unknown) => void,
): Promise<void> {
  if (!response.body) throw new Error("No response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event: ChatSseEventName = "messages";
  let dataLines: string[] = [];

  const flush = () => {
    if (dataLines.length === 0) return;
    const raw = dataLines.join("\n");
    dataLines = [];
    const name = event;
    event = "messages";
    try {
      onEvent(name, JSON.parse(raw) as unknown);
    } catch {
      onEvent(name, raw);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "") {
        flush();
        continue;
      }
      if (line.startsWith("event:")) {
        event = line.slice(6).trim() as ChatSseEventName;
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
  }
  flush();
}

export function mergeStep(
  steps: ThoughtStep[],
  incoming: ThoughtStep,
): ThoughtStep[] {
  const at = steps.findIndex((step) => step.id === incoming.id);
  if (at === -1) return [...steps, incoming];
  const next = [...steps];
  next[at] = {
    ...next[at],
    ...incoming,
    args:
      Object.keys(incoming.args).length > 0 ? incoming.args : next[at].args,
    evidence: incoming.evidence ?? next[at].evidence,
  };
  return next;
}

export function asUsage(data: unknown): ChatUsage | undefined {
  if (!data || typeof data !== "object") return undefined;
  const row = data as ChatUsage;
  if (typeof row.model !== "string") return undefined;
  return row;
}

export function asFeedbackEvent(
  data: unknown,
): { runId: string; urls: { user_score: string } } | undefined {
  if (!data || typeof data !== "object") return undefined;
  const row = data as { user_score?: unknown; runId?: unknown };
  if (typeof row.user_score !== "string" || !row.user_score) return undefined;
  return {
    runId: typeof row.runId === "string" ? row.runId : "",
    urls: { user_score: row.user_score },
  };
}
