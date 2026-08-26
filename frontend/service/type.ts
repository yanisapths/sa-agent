// service/type.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
// ─────────────────────────────────────────────────────────────────────────────
// Chat API Response Contract
// POST /chat → ChatApiResponse
// ─────────────────────────────────────────────────────────────────────────────

export type ChatApiResponse =
  | { ok: false; error: string }
  | { ok: true; type: ChatResponseType; data: ChatResponseData };

export type ChatResponseType = "text" | "code" | "api_spec" | "sql" | "diagram";

export type ChatResponseData =
  | TextData
  | CodeData
  | ApiSpecData
  | SqlData
  | DiagramData;

// ─────────────────────────────────────────────────────────────────────────────
// text  — plain conversational answer, markdown prose
// ─────────────────────────────────────────────────────────────────────────────

export interface TextData {
  type: "text";
  /** Raw model answer — may contain markdown. Render with a markdown renderer. */
  text: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// code  — source code artifact with copy / download affordance
// ─────────────────────────────────────────────────────────────────────────────

export interface CodeData {
  type: "code";
  /** Lowercase language name: "go", "typescript", "sql", "python", "bash", etc. */
  language: string;
  /** Suggested filename, e.g. "achievement_handler.go". Empty string if not applicable. */
  filename: string;
  /** Short human title for the card header, e.g. "Delete Achievement Handler". */
  title: string;
  /** One-line description shown below the title. */
  description: string;
  /** Complete source code. Never truncated. */
  code: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// api_spec — endpoint contract for an API reference card
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiSpecData {
  type: "api_spec";
  /** HTTP method, always uppercase: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" */
  method: string;
  /** Path only, e.g. "/achievement/:activity_id" */
  endpoint: string;
  /** Human-readable description of what this endpoint does. */
  description: string;
  /** Auth scheme label, e.g. "BearerAuth". Empty string if none. */
  auth: string;
  /** Flat array of all parameters: path + query + header combined. */
  parameters: ApiParameter[];
  /** Keyed by HTTP status code string, e.g. "200", "404". */
  responses: Record<string, ApiResponse>;
  /** Shared reusable schemas. Empty object if none. */
  componentSchemas: Record<string, unknown>;
  /** Optional free-text notes: edge cases, constraints, etc. */
  notes?: string[];
}

export interface ApiParameter {
  name: string;
  /** "path" | "query" | "header" | "body" */
  in: string;
  required: boolean;
  description: string;
  schema: {
    type: string;
    [key: string]: unknown;
  };
}

export interface ApiResponse {
  description: string;
  schema: Record<string, unknown>;
  /** Inline example value — render as pretty-printed JSON. Null if none. */
  example: unknown | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// sql  — SQL query with syntax highlighting and copy affordance
// ─────────────────────────────────────────────────────────────────────────────

export interface SqlData {
  type: "sql";
  /** "postgresql" | "mysql" | "sqlite" | "mssql" */
  dialect: string;
  /** The complete SQL query string. */
  sql: string;
  /** Optional explanation of the query approach. Empty string if not provided. */
  reasoning: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// diagram  — Mermaid diagram string for rendering
// ─────────────────────────────────────────────────────────────────────────────

export interface DiagramData {
  type: "diagram";
  /** Mermaid keyword: "sequenceDiagram" | "flowchart" | "erDiagram" | "classDiagram" | "stateDiagram" */
  diagramType: string;
  /** Short title shown above the diagram. */
  title: string;
  /**
   * Complete Mermaid diagram string.
   * Newlines are literal \n characters — pass directly to a Mermaid renderer.
   * Do NOT wrap in code fences before rendering.
   */
  content: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontend switch helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exhaustive type guard — use in your frontend renderer:
 *
 *   const result = await fetchChat(message);
 *   if (!result.ok) { showError(result.error); return; }
 *
 *   switch (result.type) {
 *     case "text":     return <MarkdownBlock data={result.data} />;
 *     case "code":     return <CodeBlock data={result.data} />;
 *     case "api_spec": return <ApiSpecCard data={result.data} />;
 *     case "sql":      return <SqlBlock data={result.data} />;
 *     case "diagram":  return <MermaidDiagram data={result.data} />;
 *   }
 */
export function assertNever(x: never): never {
  throw new Error(`Unhandled response type: ${(x as any)?.type}`);
}
