/**
 * Parsing and normalisation of the JSON artifacts the agent returns
 * (`text`, `api_spec`, `sql`, `diagram`).
 */

export function lastAssistantContent(result: unknown): string {
  const messages = (result as { messages?: Array<{ content?: unknown }> })
    ?.messages;
  const content = messages?.[messages.length - 1]?.content;

  if (typeof content === "string") return content;
  if (content == null) return "";

  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block === "string" ? block : (block?.text ?? "")))
      .join("");
  }

  return JSON.stringify(content);
}

/** Reasoning models emit `<think>` blocks that must not reach the client. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export function tryParseJsonObject(
  text: unknown,
): Record<string, unknown> | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const trimmed = text.trim();

  const attempts = [trimmed, trimmed.match(/\{[\s\S]*\}/)?.[0]];
  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

/** Models drift from the prompt contract; fold common variants back in. */
function normalizeApiSpec(raw: any): any {
  const rawResponses =
    raw.responses ??
    raw.response?.status_codes ??
    raw.response?.responses ??
    {};

  const responses = Object.fromEntries(
    Object.entries(rawResponses).map(([code, value]) => {
      const v = value as any;
      return [
        code,
        {
          description: v.description ?? "",
          schema: v.schema ?? {},
          example: v.example ?? v.example_json_response ?? null,
        },
      ];
    }),
  );

  const parameters: unknown[] = Array.isArray(raw.parameters)
    ? [...raw.parameters]
    : [];

  for (const [name, schema] of Object.entries(raw.path_parameters ?? {})) {
    parameters.push({
      name,
      in: "path",
      required: true,
      ...(schema as object),
    });
  }
  for (const [name, schema] of Object.entries(raw.query_parameters ?? {})) {
    parameters.push({
      name,
      in: "query",
      required: false,
      ...(schema as object),
    });
  }
  for (const name of Object.keys(raw.request?.headers ?? {})) {
    if (name.toLowerCase() === "authorization") {
      parameters.push({
        name,
        in: "header",
        required: true,
        schema: { type: "string" },
      });
    }
  }

  // Tolerate "GET /path" leaking into the endpoint field.
  const [firstToken, ...pathParts] = (raw.endpoint ?? "").split(" ");
  const method = (
    raw.method ??
    raw.http_method ??
    (pathParts.length > 0 ? firstToken : undefined) ??
    "GET"
  ).toUpperCase();

  return {
    type: "api_spec",
    method,
    endpoint:
      raw.path ?? (pathParts.length > 0 ? pathParts.join(" ") : firstToken),
    description: raw.description ?? "",
    auth: raw.auth ?? raw.security?.[0]?.name ?? "",
    parameters,
    responses,
    componentSchemas: raw.componentSchemas ?? raw.components?.schemas ?? {},
    notes: Array.isArray(raw.notes) ? raw.notes : [],
  };
}

export function normalizeArtifact(parsed: Record<string, unknown>): any {
  const raw = parsed as any;

  switch (raw.type) {
    case "api_spec":
      return normalizeApiSpec(raw);
    case "code":
      return {
        type: "code",
        language: raw.language ?? "text",
        filename: raw.filename ?? "",
        title: raw.title ?? "",
        description: raw.description ?? "",
        code: raw.code ?? raw.content ?? "",
      };
    case "sql":
      return {
        type: "sql",
        dialect: raw.dialect ?? "postgresql",
        sql: raw.sql ?? raw.query ?? "",
        reasoning: raw.reasoning ?? raw.explanation ?? "",
      };
    case "diagram":
      return {
        type: "diagram",
        diagramType: raw.diagramType ?? raw.diagram_type ?? "sequenceDiagram",
        title: raw.title ?? "",
        content: raw.content ?? raw.diagram ?? "",
      };
    default:
      return raw;
  }
}
