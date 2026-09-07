import { createMiddleware } from "langchain";

/**
 * Deep Agents filesystem tools require virtual absolute paths (`/src/foo`).
 * Models often reuse relative hits from workspace_grep (`src/foo`), which
 * then fail in permission `validatePath` before the backend runs.
 */
const FS_TOOLS = new Set([
  "ls",
  "read_file",
  "write_file",
  "edit_file",
  "glob",
  "grep",
]);

const PATH_KEYS = ["file_path", "path"] as const;

/** Map `.` / `src/foo` → `/` / `/src/foo`. Already-absolute paths are kept. */
export function toAbsoluteVirtualPath(raw: string): string {
  let trimmed = raw.trim().replaceAll("\\", "/");
  if (!trimmed || trimmed === ".") return "/";
  while (trimmed.startsWith("./")) trimmed = trimmed.slice(2);
  if (!trimmed || trimmed === ".") return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizeArgs(
  args: Record<string, unknown>,
): Record<string, unknown> | null {
  let changed = false;
  const next = { ...args };
  for (const key of PATH_KEYS) {
    const value = next[key];
    if (typeof value !== "string" || value.length === 0) continue;
    const normalized = toAbsoluteVirtualPath(value);
    if (normalized === value) continue;
    next[key] = normalized;
    changed = true;
  }
  return changed ? next : null;
}

export const normalizeVirtualFsPaths = createMiddleware({
  name: "NormalizeVirtualFsPaths",
  wrapToolCall: async (request, handler) => {
    if (!FS_TOOLS.has(request.toolCall.name)) return handler(request);
    const args = request.toolCall.args;
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      return handler(request);
    }
    const normalized = normalizeArgs(args as Record<string, unknown>);
    if (!normalized) return handler(request);
    return handler({
      ...request,
      toolCall: { ...request.toolCall, args: normalized },
    });
  },
});
