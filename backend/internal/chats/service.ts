import { randomUUID } from "node:crypto";
import { getSupabase } from "../../database/supabase";
import { HttpError, throwIfError } from "../httpError";
import {
  CHAT_LIST_PAGE_SIZE,
  CHAT_TITLE_MAX,
  DEFAULT_CHAT_TITLE,
  type AppendMessageInput,
  type ChatMessageContent,
  type ChatMessageResponse,
  type ChatMessageRow,
  type ChatRole,
  type ChatThreadDetailResponse,
  type ChatThreadListResponse,
  type ChatThreadResponse,
  type ChatThreadRow,
} from "./types";

const THREADS = "chat_threads";
const MESSAGES = "chat_messages";

function throwIfMissingTable(error: unknown): void {
  if (
    typeof error === "object" &&
    error &&
    "code" in error &&
    (error as { code?: string }).code === "PGRST205"
  ) {
    throw new HttpError(
      503,
      "Chat tables are missing. Run backend/sql/chats.sql in the Supabase SQL editor.",
    );
  }
  throwIfError(error);
}

function toThread(row: ChatThreadRow): ChatThreadResponse {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: ChatMessageRow): ChatMessageResponse {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

export function titleFromText(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return DEFAULT_CHAT_TITLE;
  if (trimmed.length <= CHAT_TITLE_MAX) return trimmed;
  return `${trimmed.slice(0, CHAT_TITLE_MAX - 3)}...`;
}

function encodeCursor(updatedAt: string, id: string): string {
  return `${updatedAt}|${id}`;
}

function parseCursor(cursor: string): { updatedAt: string; id: string } {
  const at = cursor.indexOf("|");
  if (at <= 0 || at === cursor.length - 1) {
    throw new HttpError(400, "Invalid chat list cursor.");
  }
  return { updatedAt: cursor.slice(0, at), id: cursor.slice(at + 1) };
}

function quoteFilterValue(value: string): string {
  return `"${value.replaceAll('"', "")}"`;
}

function asContent(raw: unknown): ChatMessageContent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { parts: [{ type: "text", text: "" }] };
  }
  const rec = raw as ChatMessageContent;
  const parts = Array.isArray(rec.parts) ? rec.parts : [];
  return {
    parts,
    ...(rec.usage !== undefined ? { usage: rec.usage } : {}),
    ...(rec.artifacts !== undefined ? { artifacts: rec.artifacts } : {}),
    ...(rec.steps !== undefined ? { steps: rec.steps } : {}),
  };
}

export function createThreadId(): string {
  return randomUUID();
}

export async function createThread(
  userId: string,
  threadId = createThreadId(),
  title = DEFAULT_CHAT_TITLE,
): Promise<ChatThreadResponse> {
  const now = new Date().toISOString();
  const row: ChatThreadRow = {
    id: threadId,
    user_id: userId,
    title,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await getSupabase()
    .from(THREADS)
    .insert(row)
    .select("*")
    .single();

  throwIfMissingTable(error);
  return toThread(data as ChatThreadRow);
}

export async function listThreads(
  userId: string,
  opts: { limit?: number; cursor?: string } = {},
): Promise<ChatThreadListResponse> {
  const limit = Math.min(
    Math.max(opts.limit ?? CHAT_LIST_PAGE_SIZE, 1),
    CHAT_LIST_PAGE_SIZE,
  );

  let query = getSupabase()
    .from(THREADS)
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (opts.cursor) {
    const { updatedAt, id } = parseCursor(opts.cursor);
    const ts = quoteFilterValue(updatedAt);
    const rowId = quoteFilterValue(id);
    query = query.or(
      `updated_at.lt.${ts},and(updated_at.eq.${ts},id.lt.${rowId})`,
    );
  }

  const { data, error } = await query;
  throwIfMissingTable(error);

  const rows = (data ?? []) as ChatThreadRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    data: page.map(toThread),
    nextCursor: hasMore && last ? encodeCursor(last.updated_at, last.id) : null,
  };
}

export async function getThread(
  userId: string,
  threadId: string,
): Promise<ChatThreadResponse> {
  const { data, error } = await getSupabase()
    .from(THREADS)
    .select("*")
    .eq("id", threadId)
    .eq("user_id", userId)
    .maybeSingle();

  throwIfMissingTable(error);
  if (!data) throw new HttpError(404, "Chat not found");
  return toThread(data as ChatThreadRow);
}

export async function listMessages(
  userId: string,
  threadId: string,
): Promise<ChatMessageResponse[]> {
  const { data, error } = await getSupabase()
    .from(MESSAGES)
    .select("*")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  throwIfMissingTable(error);
  return ((data ?? []) as ChatMessageRow[]).map((row) =>
    toMessage({ ...row, content: asContent(row.content) }),
  );
}

export async function getThreadDetail(
  userId: string,
  threadId: string,
): Promise<ChatThreadDetailResponse> {
  const thread = await getThread(userId, threadId);
  const messages = await listMessages(userId, threadId);
  return { ...thread, messages };
}

export async function deleteThread(
  userId: string,
  threadId: string,
): Promise<{ id: string }> {
  const existing = await getThread(userId, threadId);
  const { error } = await getSupabase()
    .from(THREADS)
    .delete()
    .eq("id", existing.id)
    .eq("user_id", userId);

  throwIfMissingTable(error);
  return { id: existing.id };
}

export async function upsertThread(
  userId: string,
  threadId: string,
  title?: string,
): Promise<ChatThreadResponse> {
  const existing = await getSupabase()
    .from(THREADS)
    .select("*")
    .eq("id", threadId)
    .eq("user_id", userId)
    .maybeSingle();

  if (
    existing.error &&
    typeof existing.error === "object" &&
    "code" in existing.error &&
    (existing.error as { code?: string }).code === "PGRST205"
  ) {
    throwIfMissingTable(existing.error);
  }
  throwIfMissingTable(existing.error);

  const now = new Date().toISOString();
  if (existing.data) {
    const row = existing.data as ChatThreadRow;
    const nextTitle =
      title && row.title === DEFAULT_CHAT_TITLE ? title : row.title;
    const { data, error } = await getSupabase()
      .from(THREADS)
      .update({ title: nextTitle, updated_at: now })
      .eq("id", threadId)
      .eq("user_id", userId)
      .select("*")
      .single();
    throwIfMissingTable(error);
    return toThread(data as ChatThreadRow);
  }

  return createThread(userId, threadId, title ?? DEFAULT_CHAT_TITLE);
}

export async function appendMessage(
  userId: string,
  threadId: string,
  input: AppendMessageInput,
): Promise<ChatMessageResponse> {
  const row: ChatMessageRow = {
    id: randomUUID(),
    thread_id: threadId,
    user_id: userId,
    role: input.role,
    content: input.content,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await getSupabase()
    .from(MESSAGES)
    .insert(row)
    .select("*")
    .single();

  throwIfMissingTable(error);
  return toMessage({
    ...(data as ChatMessageRow),
    content: asContent((data as ChatMessageRow).content),
  });
}

function textFromParts(parts: ChatMessageContent["parts"]): string {
  return parts
    .map((part) => {
      if (typeof part.text === "string" && part.text.trim()) return part.text;
      if (typeof part.query === "string" && part.query.trim()) return part.query;
      if (typeof part.code === "string" && part.code.trim()) return part.code;
      if (typeof part.content === "string" && part.content.trim()) {
        return part.content;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function seedTextFor(
  role: ChatRole,
  content: ChatMessageContent,
): string {
  const text = textFromParts(content.parts ?? []);
  if (text.trim()) return text;
  return role === "user" ? "[message]" : "[assistant reply]";
}

/**
 * Persist a user turn without failing chat if the tables are missing.
 */
export async function recordUserTurn(opts: {
  userId: string | undefined;
  threadId: string;
  text: string;
  fileNames?: string[];
}): Promise<ChatThreadResponse | null> {
  if (!opts.userId) return null;
  try {
    const parts: ChatMessageContent["parts"] = [];
    if (opts.text.trim()) {
      parts.push({ type: "text", text: opts.text });
    }
    for (const name of opts.fileNames ?? []) {
      parts.push({ type: "file", name, text: "" });
    }
    if (parts.length === 0) {
      parts.push({ type: "text", text: "" });
    }
    const thread = await upsertThread(
      opts.userId,
      opts.threadId,
      titleFromText(opts.text),
    );
    await appendMessage(opts.userId, opts.threadId, {
      role: "user",
      content: { parts },
    });
    return thread;
  } catch (err) {
    console.error("Failed to persist chat user turn:", err);
    return null;
  }
}

/**
 * Persist the assistant reply after a finished turn.
 */
export async function recordAssistantTurn(opts: {
  userId: string | undefined;
  threadId: string;
  type: string;
  data: unknown;
  artifacts?: unknown;
}): Promise<void> {
  if (!opts.userId) return;
  try {
    await upsertThread(opts.userId, opts.threadId);
    await appendMessage(opts.userId, opts.threadId, {
      role: "assistant",
      content: {
        parts: assistantParts(opts.type, opts.data),
        ...(opts.artifacts !== undefined ? { artifacts: opts.artifacts } : {}),
      },
    });
  } catch (err) {
    console.error("Failed to persist chat assistant turn:", err);
  }
}

function assistantParts(type: string, data: unknown): ChatMessageContent["parts"] {
  const rec =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  if (type === "sql") {
    const sql = typeof rec.sql === "string" ? rec.sql : "";
    return [
      {
        type: "sql",
        text: sql,
        query: sql,
        reasoning: typeof rec.reasoning === "string" ? rec.reasoning : "",
      },
    ];
  }
  if (type === "code") {
    const code = typeof rec.code === "string" ? rec.code : "";
    return [
      {
        type: "code",
        text: code,
        language: typeof rec.language === "string" ? rec.language : "text",
        filename: typeof rec.filename === "string" ? rec.filename : "",
        title: typeof rec.title === "string" ? rec.title : "",
        description: typeof rec.description === "string" ? rec.description : "",
        code,
      },
    ];
  }
  if (type === "api_spec") {
    return [
      {
        type: "api_spec",
        text: "",
        title: typeof rec.title === "string" ? rec.title : "",
        method:
          typeof rec.method === "string" ? rec.method.toUpperCase() : "GET",
        endpoint: typeof rec.endpoint === "string" ? rec.endpoint : "",
        description:
          typeof rec.description === "string" ? rec.description : "",
        auth: typeof rec.auth === "string" ? rec.auth : "",
        parameters: Array.isArray(rec.parameters) ? rec.parameters : [],
        responses:
          rec.responses && typeof rec.responses === "object"
            ? rec.responses
            : {},
        componentSchemas:
          rec.componentSchemas && typeof rec.componentSchemas === "object"
            ? rec.componentSchemas
            : {},
        notes: Array.isArray(rec.notes) ? rec.notes : [],
      },
    ];
  }
  if (type === "diagram") {
    return [
      {
        type: "diagram",
        text: "",
        diagramType:
          typeof rec.diagramType === "string"
            ? rec.diagramType
            : "sequenceDiagram",
        title: typeof rec.title === "string" ? rec.title : "",
        content: typeof rec.content === "string" ? rec.content : "",
      },
    ];
  }
  const text = typeof rec.text === "string" ? rec.text : "";
  return [{ type: "text", text }];
}
