export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export function lastAssistantContent(result: unknown): string {
  const r = result as { messages?: Array<{ content?: unknown }> } | null;

  const last = r?.messages?.[r.messages.length - 1];
  const c = last?.content;

  if (typeof c === "string") return c;

  if (c == null) return "";

  try {
    return JSON.stringify(c);
  } catch {
    return String(c);
  }
}

export function tryParseJsonObject(
  text: unknown,
): Record<string, unknown> | null {
  if (typeof text !== "string") return null;

  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {}

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }

  return null;
}

export function normalizeApiSpec(raw: any): any {
  if (raw.type !== "api_spec") return raw;

  // Normalize responses: handle status_codes nesting
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
      example: v.example ?? null,
    };
  }

  // Normalize parameters: merge all param sources into flat array
  const parameters: unknown[] = [];
  if (Array.isArray(raw.parameters)) parameters.push(...raw.parameters);

  // path_parameters object → array
  for (const [name, s] of Object.entries(raw.path_parameters ?? {})) {
    parameters.push({ name, in: "path", required: true, ...(s as object) });
  }
  // query_parameters object → array
  for (const [name, s] of Object.entries(raw.query_parameters ?? {})) {
    parameters.push({ name, in: "query", required: false, ...(s as object) });
  }
  // request.headers object → array
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

  // Parse method from "GET /path" endpoint string if http_method missing
  const endpointStr: string = raw.endpoint ?? "";
  const [methodFromEndpoint, ...pathParts] = endpointStr.split(" ");
  const method = (
    raw.method ??
    raw.http_method ??
    methodFromEndpoint ??
    "GET"
  ).toUpperCase();
  const endpoint = raw.path ?? pathParts.join(" ") ?? endpointStr;

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
