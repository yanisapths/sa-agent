import type { Response } from "express";
import type { ChatArtifact } from "../../contract/chat-response";

export type StepStatus =
  | "queued"
  | "running"
  | "waiting"
  | "error"
  | "retried"
  | "completed";

export interface ChatStepEvent {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: StepStatus;
  ns: string[];
  evidence?: string;
  permission?: "allow" | "interrupt";
  costHint?: string;
}

export interface ChatActionRequest {
  name: string;
  args: Record<string, unknown>;
  description?: string;
  allowedDecisions: Array<"approve" | "edit" | "reject">;
  costHint: string;
  permission: "interrupt";
  scope: string;
}

export interface ChatInterruptEvent {
  actionRequests: ChatActionRequest[];
}

export type ChatSseEvent =
  | { event: "thread"; data: { threadId: string } }
  | { event: "messages"; data: { text: string; ns: string[] } }
  | { event: "step"; data: ChatStepEvent }
  | { event: "interrupt"; data: ChatInterruptEvent }
  | {
      event: "values";
      data: {
        type: string;
        data: ChatArtifact;
        artifacts: unknown[];
      };
    }
  | { event: "usage"; data: Record<string, unknown> }
  | { event: "done"; data: { status: "complete" | "waiting" } }
  | { event: "error"; data: { error: string } };

export function wantsEventStream(accept: string | undefined): boolean {
  const header = accept ?? "";
  if (header.includes("text/event-stream")) return true;
  return false;
}

export function openSse(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

export function writeSse(res: Response, event: ChatSseEvent): void {
  if (res.writableEnded) return;
  res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
}
