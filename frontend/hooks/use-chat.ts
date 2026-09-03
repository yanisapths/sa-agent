/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { UIMessage, UIPart } from "@/components/chat-message";
import { Attachment } from "@/components/chat-input";
import { AGENT_API, VAULT_TOKEN } from "@/lib/api";

type Status = "idle" | "submitted" | "streaming" | "error";
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// ─── Markdown API Spec Parser ─────────────────────────────────────────────────
//
// Converts markdown like:
//   # API Specification: GET Achievement List
//   ## Endpoint
//   ```
//   GET /some/path
//   ```
//   ## Description
//   Some text.
//   ## Query Parameters
//   | Parameter | Type | ... |
//   ## Response
//   ### Success Response (200 OK)
//   ```json
//   { ... }
//   ```
//
// into a structured ApiSpecPart object.

function parseMarkdownApiSpec(markdown: string): UIPart | null {
  // Must look like an API spec document
  if (!markdown.includes("## Endpoint") && !markdown.includes("## endpoint")) {
    return null;
  }

  const lines = markdown.split("\n");

  // ── Title ──────────────────────────────────────────────────────────────────
  let title = "";
  const titleLine = lines.find((l) => l.startsWith("# "));
  if (titleLine) title = titleLine.replace(/^# /, "").trim();

  // ── Endpoint (method + path) ───────────────────────────────────────────────
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

  // ── Description ───────────────────────────────────────────────────────────
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

  // ── Auth ───────────────────────────────────────────────────────────────────
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

  // ── Parameters (markdown table) ───────────────────────────────────────────
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

  // ── Responses (### headings + code blocks) ────────────────────────────────
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

  // ── Notes ─────────────────────────────────────────────────────────────────
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

// ── Schema inference from a JSON example ──────────────────────────────────────
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

// ─── useChat ──────────────────────────────────────────────────────────────────

export const useChat = () => {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<Status>("idle");

  const sendMessage = async ({
    text,
    attachments = [],
  }: {
    text: string;
    attachments?: Attachment[];
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

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setStatus("submitted");

    try {
      const formData = new FormData();
      formData.append("message", text);
      attachments.forEach((att) => formData.append("files", att.file));

      // Same bearer the vault uses. Chat itself does not require auth; this is
      // what lets the backend resolve `@folder/file` mentions to real bytes.
      const headers = new Headers();
      if (VAULT_TOKEN) headers.set("Authorization", `Bearer ${VAULT_TOKEN}`);

      const res = await fetch(`${AGENT_API}/chat`, {
        method: "POST",
        headers,
        body: formData,
      });

      const json = await res.json();
      const assistantId = crypto.randomUUID();

      const payload = json.data ?? json;
      const type: string = json.type ?? payload.type ?? "text";

      let part: UIPart;

      if (type === "sql") {
        part = {
          type: "sql",
          text: payload.sql ?? "",
          query: payload.sql ?? "",
          reasoning: payload.reasoning ?? "",
        } as UIPart;
      } else if (type === "api_spec") {
        part = {
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
      } else if (type === "diagram") {
        part = {
          type: "diagram",
          text: "",
          diagramType: payload.diagramType ?? "sequenceDiagram",
          title: payload.title ?? "",
          content: payload.content ?? "",
        } as UIPart;
      } else {
        // ── Text / markdown fallback ──────────────────────────────────────────
        // First, extract the raw text from the response.
        // Handle `outputs_preview` shape: "ai: # API Specification:..."
        let rawText: string =
          typeof payload.text === "string"
            ? payload.text
            : typeof payload.outputs_preview === "string"
              ? payload.outputs_preview.replace(/^ai:\s*/i, "")
              : JSON.stringify(payload, null, 2);

        // Strip a leading "ai: " prefix that some backends include
        rawText = rawText.replace(/^ai:\s*/i, "").trim();

        // Try to parse as an API spec markdown document first
        const specPart = parseMarkdownApiSpec(rawText);
        if (specPart) {
          part = specPart;
        } else {
          part = { type: "text", text: rawText } as UIPart;
        }
      }

      setStatus("streaming");

      if (part.type === "text" && part.text) {
        const words = part.text.split(" ");
        for (let i = 0; i < words.length; i++) {
          setMessages([
            ...nextMessages,
            {
              id: assistantId,
              role: "assistant",
              parts: [{ ...part, text: words.slice(0, i + 1).join(" ") }],
            },
          ]);
          await sleep(20);
        }
      } else {
        setMessages([
          ...nextMessages,
          { id: assistantId, role: "assistant", parts: [part] },
        ]);
      }

      setStatus("idle");
    } catch (err) {
      console.error(err);
      setStatus("error");
    }
  };

  return { messages, sendMessage, status };
};
