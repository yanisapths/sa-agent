import { randomUUID } from "node:crypto";
import { backendEnvLoaded } from "../../load-env";
import { Client } from "langsmith";
import { HttpError } from "../httpError";

void backendEnvLoaded;

const client = new Client();

export const USER_SCORE_KEY = "user_score";

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

const PENDING_TTL_MS = 30 * 60 * 1000;

type Pending = {
  threadId: string;
  runId: string;
  urls: ChatFeedbackUrls;
  expiresAt: number;
};

const pendingByRun = new Map<string, Pending>();
const pendingByThread = new Map<string, Pending>();

export function tracingEnabled(): boolean {
  const tracing =
    process.env.LANGSMITH_TRACING === "true" ||
    process.env.LANGCHAIN_TRACING_V2 === "true";
  const key =
    process.env.LANGSMITH_API_KEY || process.env.LANGCHAIN_API_KEY;
  return tracing && Boolean(key);
}

export function newChatRunId(): string | undefined {
  if (!tracingEnabled()) return undefined;
  return randomUUID();
}

function sweep(now: number): void {
  for (const [id, row] of pendingByRun) {
    if (row.expiresAt <= now) {
      pendingByRun.delete(id);
      const current = pendingByThread.get(row.threadId);
      if (current?.runId === id) pendingByThread.delete(row.threadId);
    }
  }
}

function rememberPending(row: Pending): void {
  sweep(Date.now());
  pendingByRun.set(row.runId, row);
  pendingByThread.set(row.threadId, row);
}

export function pendingFeedback(
  threadId: string,
  runId?: string,
): Pending | undefined {
  sweep(Date.now());
  if (runId) {
    const byRun = pendingByRun.get(runId);
    if (byRun) return byRun;
  }
  return pendingByThread.get(threadId);
}

export function asUserScore(raw: unknown): UserScore | undefined {
  if (raw === 1 || raw === -1) return raw;
  if (raw === "1") return 1;
  if (raw === "-1") return -1;
  return undefined;
}

export function asFeedback(raw: unknown): ChatFeedback | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const rec = raw as Record<string, unknown>;
  const runId = typeof rec.runId === "string" ? rec.runId : "";
  const urls =
    rec.urls && typeof rec.urls === "object" && !Array.isArray(rec.urls)
      ? (rec.urls as Record<string, unknown>)
      : {};
  const userScore =
    typeof urls.user_score === "string" ? urls.user_score : "";
  if (!runId || !userScore) return undefined;
  const score = asUserScore(rec.score);
  const comment =
    typeof rec.comment === "string" && rec.comment.trim()
      ? rec.comment.trim()
      : undefined;
  return {
    runId,
    urls: { user_score: userScore },
    ...(score !== undefined ? { score } : {}),
    ...(comment ? { comment } : {}),
  };
}

/**
 * Mint a LangSmith presigned URL for `user_score` on this turn's root span.
 * Fail soft: a LangSmith outage must not fail the chat turn.
 */
export async function mintFeedbackUrls(
  runId: string | undefined,
  threadId: string,
): Promise<ChatFeedback | null> {
  if (!tracingEnabled() || !runId) return null;
  try {
    const token = await client.createPresignedFeedbackToken(
      runId,
      USER_SCORE_KEY,
      {
        expiration: { days: 7 },
        feedbackConfig: { type: "continuous", min: -1, max: 1 },
      },
    );
    if (!token.url) return null;
    const feedback: ChatFeedback = {
      runId,
      urls: { user_score: token.url },
    };
    rememberPending({
      threadId,
      runId,
      urls: feedback.urls,
      expiresAt: Date.now() + PENDING_TTL_MS,
    });
    return feedback;
  } catch (err) {
    console.error("Failed to mint LangSmith feedback token:", err);
    return null;
  }
}

export async function postFeedbackToken(
  url: string,
  score: UserScore,
  comment?: string,
): Promise<void> {
  const body: Record<string, unknown> = { score };
  if (comment) body.comment = comment;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new HttpError(
      502,
      `LangSmith rejected feedback (${res.status})${detail ? `: ${detail.slice(0, 200)}` : "."}`,
    );
  }
}
