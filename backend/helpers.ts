// ─────────────────────────────────────────────
// Primitive helpers
// ─────────────────────────────────────────────

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

// ─────────────────────────────────────────────
// Extract the last assistant message text
// ─────────────────────────────────────────────

export function lastAssistantContent(result: unknown): string {
  const r = result as { messages?: Array<{ content?: unknown }> } | null;
  const last = r?.messages?.[r.messages.length - 1];
  const c = last?.content;

  if (typeof c === "string") return c;
  if (c == null) return "";

  // Handle content block arrays (multimodal responses)
  if (Array.isArray(c)) {
    return c
      .map((block: any) =>
        typeof block === "string"
          ? block
          : typeof block?.text === "string"
            ? block.text
            : "",
      )
      .join("");
  }

  try {
    return JSON.stringify(c);
  } catch {
    return String(c);
  }
}

// ─────────────────────────────────────────────
// Strip <think>...</think> blocks (reasoning models)
// ─────────────────────────────────────────────

export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

// ─────────────────────────────────────────────
// Detect whether a string looks like a structured artifact response.
// The model should ONLY emit JSON for: code, api_spec, sql, diagram.
// Everything else should be plain prose.
// ─────────────────────────────────────────────

const ARTIFACT_TYPES = new Set(["code", "api_spec", "sql", "diagram"]);

export function looksLikeArtifact(text: string): boolean {
  const trimmed = text.trimStart();

  if (!trimmed.startsWith("{")) return false;

  const head = trimmed.slice(0, 120);

  return (
    head.includes('"type"') &&
    [...ARTIFACT_TYPES].some((t) => head.includes(`"${t}"`))
  );
}

// Try to parse a JSON object — returns null on failure
// ─────────────────────────────────────────────

export function tryParseJsonObject(
  text: unknown,
): Record<string, unknown> | null {
  if (typeof text !== "string") return null;

  const trimmed = text.trim();
  if (!trimmed) return null;

  // Direct parse first
  try {
    const v = JSON.parse(trimmed);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {}

  // Extract the outermost JSON object if model leaked text around it
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const v = JSON.parse(match[0]);
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    } catch {}
  }

  return null;
}

// ─────────────────────────────────────────────
// Clean model output: strip fences, extract JSON if present
// ─────────────────────────────────────────────

export function cleanModelOutput(raw: string): string {
  let s = raw.trim();

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  s = s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return s;
}

// ─────────────────────────────────────────────
// Normalize api_spec — tolerate common model deviations
// ─────────────────────────────────────────────

export function normalizeApiSpec(raw: any): any {
  if (raw.type !== "api_spec") return raw;

  // Responses: handle status_codes nesting
  const rawResponses =
    raw.responses ??
    raw.response?.status_codes ??
    raw.response?.responses ??
    {};

  const responses: Record<string, unknown> = {};
  for (const [code, val] of Object.entries(rawResponses)) {
    const v = val as any;
    responses[code] = {
      description: v.description ?? "",
      schema: v.schema ?? {},
      example: v.example ?? v.example_json_response ?? null,
    };
  }

  // Parameters: flatten all sources into a single array
  const parameters: unknown[] = [];
  if (Array.isArray(raw.parameters)) parameters.push(...raw.parameters);

  for (const [name, s] of Object.entries(raw.path_parameters ?? {})) {
    parameters.push({ name, in: "path", required: true, ...(s as object) });
  }
  for (const [name, s] of Object.entries(raw.query_parameters ?? {})) {
    parameters.push({ name, in: "query", required: false, ...(s as object) });
  }
  for (const [name] of Object.entries(raw.request?.headers ?? {})) {
    if (name.toLowerCase() === "authorization") {
      parameters.push({
        name,
        in: "header",
        required: true,
        schema: { type: "string" },
      });
    }
  }

  // Method + endpoint: handle "GET /path" in endpoint string
  const endpointStr: string = raw.endpoint ?? "";
  const [methodFromEndpoint, ...pathParts] = endpointStr.split(" ");
  const method = (
    raw.method ??
    raw.http_method ??
    (pathParts.length > 0 ? methodFromEndpoint : undefined) ??
    "GET"
  ).toUpperCase();
  const endpoint =
    raw.path ?? (pathParts.length > 0 ? pathParts.join(" ") : endpointStr);

  return {
    type: "api_spec",
    method,
    endpoint,
    description: raw.description ?? "",
    auth: raw.auth ?? raw.security?.[0]?.name ?? "",
    parameters,
    responses,
    componentSchemas: raw.componentSchemas ?? raw.components?.schemas ?? {},
    notes: Array.isArray(raw.notes) ? raw.notes : [],
  };
}

// ─────────────────────────────────────────────
// Normalize code block
// ─────────────────────────────────────────────

export function normalizeCode(raw: any): any {
  return {
    type: "code",
    language: raw.language ?? "text",
    filename: raw.filename ?? "",
    title: raw.title ?? "",
    description: raw.description ?? "",
    code: raw.code ?? raw.content ?? "",
  };
}

// ─────────────────────────────────────────────
// Normalize SQL
// ─────────────────────────────────────────────

export function normalizeSql(raw: any): any {
  return {
    type: "sql",
    dialect: raw.dialect ?? "postgresql",
    sql: raw.sql ?? raw.query ?? "",
    reasoning: raw.reasoning ?? raw.explanation ?? "",
  };
}

// ─────────────────────────────────────────────
// Normalize diagram
// ─────────────────────────────────────────────

export function normalizeDiagram(raw: any): any {
  return {
    type: "diagram",
    diagramType: raw.diagramType ?? raw.diagram_type ?? "sequenceDiagram",
    title: raw.title ?? "",
    content: raw.content ?? raw.diagram ?? "",
  };
}

// ─────────────────────────────────────────────
// Master normalizer — dispatch by type
// ─────────────────────────────────────────────

export function normalizeArtifact(parsed: Record<string, unknown>): any {
  switch (parsed.type) {
    case "api_spec":
      return normalizeApiSpec(parsed);
    case "code":
      return normalizeCode(parsed);
    case "sql":
      return normalizeSql(parsed);
    case "diagram":
      return normalizeDiagram(parsed);
    default:
      return parsed;
  }
}
