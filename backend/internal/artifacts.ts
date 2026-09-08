import {
  chatArtifactSchema,
  type ChatArtifact,
} from "../contract/chat-response";

export function lastAssistantContent(result: unknown): string {
  const messages = (result as { messages?: Array<{ content?: unknown }> })
    ?.messages;
  const content = messages?.[messages.length - 1]?.content;

  if (typeof content === "string") return content;
  if (content == null) return "";

  if (Array.isArray(content)) {
    return content
      .map((block) =>
        typeof block === "string" ? block : String((block as { text?: unknown })?.text ?? ""),
      )
      .join("");
  }

  return JSON.stringify(content);
}

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
      continue;
    }
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function foldParameters(raw: Record<string, unknown>): unknown[] {
  const parameters: unknown[] = Array.isArray(raw.parameters)
    ? [...raw.parameters]
    : [];

  for (const [name, schema] of Object.entries(asRecord(raw.path_parameters))) {
    parameters.push({
      name,
      in: "path",
      required: true,
      ...(schema as object),
    });
  }
  for (const [name, schema] of Object.entries(asRecord(raw.query_parameters))) {
    parameters.push({
      name,
      in: "query",
      required: false,
      ...(schema as object),
    });
  }
  for (const name of Object.keys(asRecord(asRecord(raw.request).headers))) {
    if (name.toLowerCase() === "authorization") {
      parameters.push({
        name,
        in: "header",
        required: true,
        schema: { type: "string" },
      });
    }
  }

  return parameters.map((item) => {
    const p = asRecord(item);
    const schema = asRecord(p.schema);
    return {
      name: String(p.name ?? ""),
      in: String(p.in ?? "query"),
      required: Boolean(p.required),
      description: String(p.description ?? ""),
      schema: { type: String(schema.type ?? "string"), ...schema },
    };
  });
}

function foldResponses(raw: Record<string, unknown>): Record<string, unknown> {
  const nested = asRecord(raw.response);
  const rawResponses = raw.responses ?? nested.status_codes ?? nested.responses ?? {};
  return Object.fromEntries(
    Object.entries(asRecord(rawResponses)).map(([code, value]) => {
      const v = asRecord(value);
      return [
        code,
        {
          description: String(v.description ?? ""),
          schema: asRecord(v.schema),
          example: v.example ?? v.example_json_response ?? null,
        },
      ];
    }),
  );
}

function foldApiSpec(raw: Record<string, unknown>): Record<string, unknown> {
  const [firstToken, ...pathParts] = String(raw.endpoint ?? "").split(" ");
  const method = String(
    raw.method ??
      raw.http_method ??
      (pathParts.length > 0 ? firstToken : undefined) ??
      "GET",
  ).toUpperCase();

  return {
    type: "api_spec",
    method,
    endpoint:
      raw.path ?? (pathParts.length > 0 ? pathParts.join(" ") : firstToken),
    description: String(raw.description ?? ""),
    auth: String(raw.auth ?? asRecord(Array.isArray(raw.security) ? raw.security[0] : raw.security).name ?? ""),
    parameters: foldParameters(raw),
    responses: foldResponses(raw),
    componentSchemas:
      raw.componentSchemas ?? asRecord(raw.components).schemas ?? {},
    notes: Array.isArray(raw.notes) ? raw.notes : [],
  };
}

function foldArtifact(parsed: Record<string, unknown>): Record<string, unknown> {
  switch (parsed.type) {
    case "api_spec":
      return foldApiSpec(parsed);
    case "code":
      return {
        type: "code",
        language: parsed.language ?? "text",
        filename: parsed.filename ?? "",
        title: parsed.title ?? "",
        description: parsed.description ?? "",
        code: parsed.code ?? parsed.content ?? "",
      };
    case "sql":
      return {
        type: "sql",
        dialect: parsed.dialect ?? "postgresql",
        sql: parsed.sql ?? parsed.query ?? "",
        reasoning: parsed.reasoning ?? parsed.explanation ?? "",
      };
    case "diagram":
      return {
        type: "diagram",
        diagramType: parsed.diagramType ?? parsed.diagram_type ?? "sequenceDiagram",
        title: parsed.title ?? "",
        content: parsed.content ?? parsed.diagram ?? "",
      };
    case "text":
      return {
        type: "text",
        text: typeof parsed.text === "string" ? parsed.text : JSON.stringify(parsed),
      };
    default:
      return parsed;
  }
}

export function normalizeArtifact(
  parsed: Record<string, unknown>,
): ChatArtifact {
  const folded = foldArtifact(parsed);
  const result = chatArtifactSchema.safeParse(folded);
  if (result.success) return result.data;
  const text =
    typeof parsed.text === "string" ? parsed.text : JSON.stringify(parsed);
  return { type: "text", text };
}
