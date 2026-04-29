export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export function isApiSpecRequest(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("api spec") ||
    m.includes("api specification") ||
    m.includes("openapi") ||
    m.includes("swagger")
  );
}

export function lastAssistantContent(result: unknown): string {
  const r = result as { messages?: Array<{ content?: unknown }> } | null;
  const last = r?.messages?.[r.messages.length - 1];
  const c = last?.content;
  if (typeof c === "string") return c;
  try {
    return JSON.stringify(c);
  } catch {
    return String(c);
  }
}

export function cleanQuery(obj: unknown): unknown {
  if (typeof obj === "string")
    return obj.replace(/\\n/g, " ").replace(/\n/g, " ");
  if (Array.isArray(obj)) return obj.map(cleanQuery);
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, cleanQuery(v)]),
    );
  }
  return obj;
}

export function tryParseJsonObject(
  text: string,
): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
