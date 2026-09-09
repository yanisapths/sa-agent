import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { UIMessage, UIPart } from "@/components/chat-message";
import { Attachment } from "@/components/chat-input";
import { useChatSession } from "@/features/chat-session/ChatSessionProvider";
import { useChatHistory } from "@/features/chats/ChatHistoryProvider";
import { titleFromText } from "@/features/chats/types";
import { type ChatUsage } from "@/features/gateway/types";
import { type ChatArtifact as StoredArtifact } from "@/features/artifacts/types";
import { AGENT_API, VAULT_TOKEN } from "@/lib/api";
import { type ChatArtifact } from "@/lib/chat-response";
import {
  asUsage,
  isBusyStatus,
  mergeStep,
  readSse,
  type ChatLiveStatus,
  type HitlDecision,
  type InterruptPayload,
  type ThoughtStep,
  type ValuesPayload,
} from "@/lib/chat-stream";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function parseMarkdownApiSpec(markdown: string): UIPart | null {
  // Must look like an API spec document
  if (!markdown.includes("## Endpoint") && !markdown.includes("## endpoint")) {
    return null;
  }

  const lines = markdown.split("\n");

  let title = "";
  const titleLine = lines.find((l) => l.startsWith("# "));
  if (titleLine) title = titleLine.replace(/^# /, "").trim();

  let method = "GET";
  let endpoint = "";

  const endpointSectionIdx = lines.findIndex((l) =>
    /^## endpoint/i.test(l.trim()),
  );
  if (endpointSectionIdx !== -1) {
    // Look for the code block after the heading
    let inBlock = false;
    for (let i = endpointSectionIdx + 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l.startsWith("```")) {
        if (!inBlock) {
          inBlock = true;
          continue;
        } else break; // closing fence
      }
      if (inBlock && l) {
        // e.g. "GET /some/path" or just "/some/path"
        const parts = l.split(/\s+/);
        const httpMethods = [
          "GET",
          "POST",
          "PUT",
          "PATCH",
          "DELETE",
          "HEAD",
          "OPTIONS",
        ];
        if (httpMethods.includes(parts[0].toUpperCase())) {
          method = parts[0].toUpperCase();
          endpoint = parts.slice(1).join(" ");
        } else {
          endpoint = l;
        }
        break;
      }
      // Also handle inline backtick: `GET /path`
      const inlineMatch = l.match(/`(GET|POST|PUT|PATCH|DELETE)\s+([^`]+)`/i);
      if (inlineMatch) {
        method = inlineMatch[1].toUpperCase();
        endpoint = inlineMatch[2];
        break;
      }
    }
  }

  let description = "";
  const descSectionIdx = lines.findIndex((l) =>
    /^## description/i.test(l.trim()),
  );
  if (descSectionIdx !== -1) {
    const descLines: string[] = [];
    for (let i = descSectionIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) break;
      if (lines[i].trim()) descLines.push(lines[i].trim());
    }
    description = descLines.join(" ");
  }

  let auth = "";
  const authSectionIdx = lines.findIndex((l) =>
    /^## (authentication|auth|authorization)/i.test(l.trim()),
  );
  if (authSectionIdx !== -1) {
    for (let i = authSectionIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) break;
      const l = lines[i].trim();
      if (l) {
        auth = l.replace(/^[-*]\s*/, "");
        break;
      }
    }
  }

  const parameters: Record<string, unknown>[] = [];
  const paramSectionIdx = lines.findIndex((l) =>
    /^## (query parameters|parameters|request parameters)/i.test(l.trim()),
  );
  if (paramSectionIdx !== -1) {
    // Find all pipe-delimited table rows
    let headerCols: string[] = [];
    let passedSeparator = false;
    for (let i = paramSectionIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) break;
      const l = lines[i].trim();
      if (!l.startsWith("|")) continue;

      const cols = l
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);

      // Header row
      if (!headerCols.length) {
        headerCols = cols.map((c) => c.toLowerCase());
        continue;
      }
      // Separator row (----)
      if (!passedSeparator) {
        passedSeparator = true;
        continue;
      }

      // Data row — map by header position
      const get = (key: string) => {
        const idx = headerCols.findIndex((h) => h.includes(key));
        return idx !== -1 ? (cols[idx]?.replace(/`/g, "").trim() ?? "") : "";
      };

      const param: Record<string, unknown> = {
        name:
          get("parameter") ||
          get("param") ||
          get("name") ||
          cols[0]?.replace(/`/g, "") ||
          "",
        type: get("type") || "string",
        in: "query",
        required: /yes|true/i.test(get("required")),
        description: get("description") || "",
      };
      const def = get("default");
      if (def && def !== "-") param.default = def;

      if (param.name) parameters.push(param);
    }
  }

  const responses: Record<string, unknown> = {};

  const responseSectionIdx = lines.findIndex((l) =>
    /^## (response|responses)/i.test(l.trim()),
  );

  if (responseSectionIdx !== -1) {
    let currentCode: string | null = null;
    let currentDesc = "";
    let inCodeBlock = false;
    let codeLines: string[] = [];
    let codeLang = "";

    const flushCode = () => {
      if (currentCode && codeLines.length) {
        const raw = codeLines.join("\n").trim();
        let example: unknown = undefined;
        try {
          example = JSON.parse(raw);
        } catch {
          /* not JSON */
        }

        responses[currentCode] = {
          description: currentDesc,
          ...(example !== undefined
            ? {
                content: {
                  "application/json": {
                    example,
                    schema: inferSchema(example),
                  },
                },
              }
            : { content: { [codeLang || "text"]: { example: raw } } }),
        };
      }
      codeLines = [];
      codeLang = "";
    };

    for (let i = responseSectionIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      const lt = l.trim();

      // New top-level section ends responses
      if (lt.startsWith("## ") && i > responseSectionIdx + 1) break;

      // ### Success Response (200 OK)  or  ### 200  or  #### 200 Bad Request
      const responseHeading = lt.match(/^#{2,4}\s+.*?(\d{3})/);
      if (responseHeading) {
        flushCode();
        currentCode = responseHeading[1];
        currentDesc = lt.replace(/^#{2,4}\s+/, "").trim();
        inCodeBlock = false;
        continue;
      }

      if (!currentCode) continue;

      if (lt.startsWith("```")) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeLang = lt.slice(3).trim();
        } else {
          inCodeBlock = false;
          flushCode();
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(l);
      }
    }
    flushCode();
  }

  const notes: string[] = [];
  const notesSectionIdx = lines.findIndex((l) =>
    /^## (notes|note|important)/i.test(l.trim()),
  );
  if (notesSectionIdx !== -1) {
    for (let i = notesSectionIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) break;
      const l = lines[i].trim();
      if (l && (l.startsWith("-") || l.startsWith("*") || l.startsWith("•"))) {
        notes.push(l.replace(/^[-*•]\s*/, ""));
      } else if (l) {
        notes.push(l);
      }
    }
  }

  if (!endpoint && !method) return null;

  return {
    type: "api_spec",
    text: "",
    title,
    method,
    endpoint,
    description,
    auth,
    parameters,
    responses,
    componentSchemas: {},
    notes,
  } as UIPart;
}

function inferSchema(value: unknown): Record<string, unknown> {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    return {
      type: "array",
      items: value.length ? inferSchema(value[0]) : {},
    };
  }
  if (typeof value === "object") {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      props[k] = inferSchema(v);
    }
    return { type: "object", properties: props };
  }
  return { type: typeof value };
}


function phaseFromTurn(
  usage: ChatUsage | undefined,
  artifacts: { phase?: string | null }[],
  requested?: string,
): string | null {
  if (usage?.phase) return usage.phase;
  if (requested) return requested;
  const fromFile = artifacts.find((file) => file.phase)?.phase;
  return fromFile ?? null;
}

function artifactToPart(
  type: string,
  payload: ChatArtifact & Record<string, string | undefined>,
): UIPart {
  if (type === "sql") {
    return {
      type: "sql",
      text: payload.sql ?? "",
      query: payload.sql ?? "",
      reasoning: payload.reasoning ?? "",
    } as UIPart;
  }
  if (type === "code") {
    return {
      type: "code",
      text: payload.code ?? "",
      language: payload.language ?? "text",
      filename: payload.filename ?? "",
      title: payload.title ?? "",
      description: payload.description ?? "",
      code: payload.code ?? payload.content ?? "",
    } as UIPart;
  }
  if (type === "api_spec") {
    return {
      type: "api_spec",
      text: "",
      title: payload.title ?? "",
      version: payload.version ?? "",
      method: (payload.method ?? "GET").toUpperCase(),
      endpoint: payload.endpoint ?? "",
      description: payload.description ?? "",
      auth: payload.auth ?? "",
      parameters: payload.parameters ?? [],
      responses: payload.responses ?? {},
      componentSchemas: payload.componentSchemas ?? {},
      notes: payload.notes ?? [],
    } as UIPart;
  }
  if (type === "diagram") {
    return {
      type: "diagram",
      text: "",
      diagramType: payload.diagramType ?? "sequenceDiagram",
      title: payload.title ?? "",
      content: payload.content ?? "",
    } as UIPart;
  }

  let rawText: string =
    typeof payload.text === "string"
      ? payload.text
      : typeof payload.outputs_preview === "string"
        ? payload.outputs_preview.replace(/^ai:\s*/i, "")
        : JSON.stringify(payload, null, 2);
  rawText = rawText.replace(/^ai:\s*/i, "").trim();
  return parseMarkdownApiSpec(rawText) ?? ({ type: "text", text: rawText } as UIPart);
}

function authHeaders(): Headers {
  const headers = new Headers();
  if (VAULT_TOKEN) headers.set("Authorization", `Bearer ${VAULT_TOKEN}`);
  headers.set("Accept", "text/event-stream");
  return headers;
}

function patchAssistant(
  setMessages: Dispatch<SetStateAction<UIMessage[]>>,
  assistantId: string,
  patch: Partial<UIMessage> | ((current: UIMessage) => UIMessage),
): void {
  setMessages((prev) => {
    const next = [...prev];
    const at = next.findIndex((item) => item.id === assistantId);
    if (at === -1) return prev;
    const current = next[at];
    next[at] =
      typeof patch === "function"
        ? patch(current)
        : { ...current, ...patch };
    return next;
  });
}

export const useChat = () => {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<ChatLiveStatus>("idle");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [pinnedPhase, setPinnedPhase] = useState<string | undefined>();
  const { setLive, settleTurn } = useChatSession();
  const { sessionLoad, touchThread } = useChatHistory();

  const abortRef = useRef<AbortController | null>(null);
  const turnRef = useRef(0);
  const assistantIdRef = useRef<string | null>(null);
  const threadRef = useRef<string | null>(null);
  const phaseRef = useRef<string | undefined>(undefined);
  const onSettledRef = useRef<(() => void) | undefined>(undefined);
  const titleRef = useRef<string | undefined>(undefined);

  const reset = useCallback(
    (nextThreadId: string | null, nextMessages: UIMessage[] = []) => {
      turnRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      assistantIdRef.current = null;
      threadRef.current = nextThreadId;
      phaseRef.current = undefined;
      onSettledRef.current = undefined;
      titleRef.current = undefined;
      setMessages(nextMessages);
      setThreadId(nextThreadId);
      setPinnedPhase(undefined);
      setStatus("idle");
      setLive({ status: "idle", threadId: nextThreadId, phase: null });
    },
    [setLive],
  );

  useEffect(() => {
    if (!sessionLoad) return;
    reset(sessionLoad.threadId, sessionLoad.messages);
  }, [reset, sessionLoad]);

  const rememberThread = useCallback(
    (id: string) => {
      touchThread({
        id,
        ...(titleRef.current ? { title: titleRef.current } : {}),
      });
    },
    [touchThread],
  );

  const stop = useCallback(() => {
    turnRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
    setLive({ status: "idle" });
  }, [setLive]);

  const consumeStream = useCallback(
      async (
      res: Response,
      assistantId: string,
      turn: number,
      requestedPhase?: string,
    ): Promise<"waiting" | "done" | "error"> => {
      if (turn !== turnRef.current) return "done";
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("text/event-stream")) {
        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          threadId?: string;
          type?: string;
          data?: ChatArtifact;
          artifacts?: StoredArtifact[];
          usage?: ChatUsage;
        };
        if (!res.ok || json?.ok === false) {
          const detail =
            typeof json?.error === "string" && json.error
              ? json.error
              : `Request failed (${res.status})`;
          patchAssistant(setMessages, assistantId, {
            parts: [{ type: "text", text: detail }],
            usage: json.usage,
          });
          setStatus("error");
          setLive({
            status: "error",
            phase: json.usage?.phase ?? requestedPhase ?? null,
          });
          return "error";
        }
        if (typeof json.threadId === "string" && json.threadId) {
          setThreadId(json.threadId);
          threadRef.current = json.threadId;
          rememberThread(json.threadId);
        }
        const payload = (json.data ?? {}) as ChatArtifact &
          Record<string, string | undefined>;
        const part = artifactToPart(json.type ?? payload.type ?? "text", payload);
        patchAssistant(setMessages, assistantId, {
          parts: [part],
          usage: json.usage,
          artifacts: json.artifacts,
        });
        const nextPhase = phaseFromTurn(
          json.usage,
          (json.artifacts ?? []) as { phase?: string | null }[],
          requestedPhase,
        );
        setStatus("idle");
        settleTurn({
          ok: true,
          threadId: threadRef.current,
          phase: nextPhase,
        });
        if (threadRef.current) rememberThread(threadRef.current);
        return "done";
      }

      let outcome: "waiting" | "done" | "error" = "done";
      await readSse(res, (event, data) => {
        if (turn !== turnRef.current) return;
        if (event === "thread") {
          const id = (data as { threadId?: string }).threadId;
          if (id) {
            setThreadId(id);
            threadRef.current = id;
            rememberThread(id);
            setLive({
              status: "streaming",
              threadId: id,
              phase: requestedPhase ?? null,
            });
          }
          return;
        }
        if (event === "messages") {
          const text = (data as { text?: string }).text ?? "";
          setStatus("streaming");
          patchAssistant(setMessages, assistantId, (current) => ({
            ...current,
            parts: [{ type: "text", text }],
          }));
          return;
        }
        if (event === "step") {
          const step = data as ThoughtStep;
          setStatus((prev) => (prev === "waiting" ? prev : "streaming"));
          patchAssistant(setMessages, assistantId, (current) => ({
            ...current,
            steps: mergeStep(current.steps ?? [], step),
          }));
          return;
        }
        if (event === "interrupt") {
          const interrupt = data as InterruptPayload;
          setStatus("waiting");
          setLive({
            status: "waiting",
            threadId: threadRef.current,
            phase: requestedPhase ?? null,
          });
          patchAssistant(setMessages, assistantId, (current) => ({
            ...current,
            interrupt,
            steps: (interrupt.actionRequests ?? []).reduce(
              (steps, action, index) =>
                mergeStep(steps, {
                  id: `plan:${index}:${action.name}`,
                  name: action.name,
                  args: action.args,
                  status: "waiting",
                  ns: [],
                  permission: "interrupt",
                  costHint: action.costHint,
                }),
              current.steps ?? [],
            ),
          }));
          return;
        }
        if (event === "values") {
          const payload = data as ValuesPayload;
          const part = artifactToPart(
            payload.type,
            payload.data as ChatArtifact & Record<string, string | undefined>,
          );
          patchAssistant(setMessages, assistantId, {
            parts: [part],
            artifacts: payload.artifacts,
            interrupt: undefined,
          });
          return;
        }
        if (event === "usage") {
          const usage = asUsage(data);
          if (usage) {
            patchAssistant(setMessages, assistantId, { usage });
          }
          return;
        }
        if (event === "error") {
          const message =
            typeof (data as { error?: string }).error === "string"
              ? (data as { error: string }).error
              : "Agent failed.";
          patchAssistant(setMessages, assistantId, {
            parts: [{ type: "text", text: message }],
          });
          setStatus("error");
          setLive({ status: "error", phase: requestedPhase ?? null });
          outcome = "error";
          return;
        }
        if (event === "done") {
          const done = data as { status?: string };
          if (done.status === "waiting") {
            setStatus("waiting");
            setLive({
              status: "waiting",
              threadId: threadRef.current,
              phase: requestedPhase ?? null,
            });
            outcome = "waiting";
            return;
          }
          setStatus("idle");
          settleTurn({
            ok: true,
            threadId: threadRef.current,
            phase: phaseFromTurn(undefined, [], requestedPhase),
          });
          if (threadRef.current) rememberThread(threadRef.current);
          outcome = "done";
        }
      });
      return outcome;
    },
    [rememberThread, setLive, settleTurn],
  );

  const sendMessage = async ({
    text,
    attachments = [],
    mentions = [],
    model,
    phase,
    workspaceId,
    onSettled,
  }: {
    text: string;
    attachments?: Attachment[];
    mentions?: string[];
    model?: string | null;
    phase?: string;
    workspaceId?: string;
    onSettled?: () => void;
  }) => {
    const parts: UIPart[] = [];
    if (text) parts.push({ type: "text", text });
    attachments.forEach((att) => {
      if (att.isImage && att.preview) {
        parts.push({
          type: "image",
          src: att.preview,
          name: att.file.name,
          text: "",
        } as UIPart);
      } else {
        parts.push({ type: "file", name: att.file.name, text: "" } as UIPart);
      }
    });

    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts,
    };
    const assistantId = crypto.randomUUID();
    assistantIdRef.current = assistantId;
    onSettledRef.current = onSettled;
    phaseRef.current = phase;
    setPinnedPhase(phase);
    titleRef.current = titleFromText(text);

    turnRef.current += 1;
    const turn = turnRef.current;

    setMessages((prev) => [
      ...prev,
      userMessage,
      {
        id: assistantId,
        role: "assistant",
        parts: [],
        steps: [],
      },
    ]);
    setStatus("submitted");
    setLive({ status: "submitted", phase: phase ?? null, threadId });

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const formData = new FormData();
      formData.append("message", text);
      attachments.forEach((att) => formData.append("files", att.file));
      mentions.forEach((token) => formData.append("mentions", token));
      if (threadId) formData.append("threadId", threadId);
      if (model) formData.append("model", model);
      if (phase) formData.append("phase", phase);
      if (workspaceId) formData.append("workspaceId", workspaceId);

      const res = await fetch(`${AGENT_API}/chat`, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
        signal: abort.signal,
      });

      const outcome = await consumeStream(res, assistantId, turn, phase);
      if (outcome !== "waiting") onSettled?.();
    } catch (err) {
      if (isAbortError(err)) return;
      console.error(err);
      if (turn === turnRef.current) {
        patchAssistant(setMessages, assistantId, {
          parts: [
            {
              type: "text",
              text:
                err instanceof Error
                  ? `Could not reach the agent: ${err.message}`
                  : "Could not reach the agent.",
            },
          ],
        });
        setStatus("error");
        setLive({ status: "error", phase: phase ?? null });
      }
      onSettled?.();
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
    }
  };

  const approvePlan = async (decisions: HitlDecision[]) => {
    const assistantId = assistantIdRef.current;
    const currentThread = threadRef.current ?? threadId;
    if (!assistantId || !currentThread) return;

    turnRef.current += 1;
    const turn = turnRef.current;
    setStatus("streaming");
    setLive({
      status: "streaming",
      threadId: currentThread,
      phase: phaseRef.current ?? null,
    });
    patchAssistant(setMessages, assistantId, { interrupt: undefined });

    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const headers = authHeaders();
      headers.set("Content-Type", "application/json");
      const res = await fetch(`${AGENT_API}/chat/resume`, {
        method: "POST",
        headers,
        body: JSON.stringify({ threadId: currentThread, decisions }),
        signal: abort.signal,
      });
      const outcome = await consumeStream(res, assistantId, turn, phaseRef.current);
      if (outcome !== "waiting") onSettledRef.current?.();
    } catch (err) {
      if (isAbortError(err)) return;
      console.error(err);
      patchAssistant(setMessages, assistantId, {
        parts: [
          {
            type: "text",
            text:
              err instanceof Error
                ? `Could not resume: ${err.message}`
                : "Could not resume.",
          },
        ],
      });
      setStatus("error");
      setLive({ status: "error", phase: phaseRef.current ?? null });
      onSettledRef.current?.();
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
    }
  };

  return {
    messages,
    sendMessage,
    status,
    stop,
    approvePlan,
    pinnedPhase,
    busy: isBusyStatus(status),
    threadId,
    reset,
  };
};

