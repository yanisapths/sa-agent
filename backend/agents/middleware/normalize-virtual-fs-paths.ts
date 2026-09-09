import { createMiddleware } from "langchain";
import { resolveVaultBackendPath } from "../../internal/vault/mount";
import { toVirtualPath } from "../../internal/workspace/paths";
import { currentWorkspaceRoot } from "../../internal/workspace/runtime";

/**
 * Deep Agents filesystem tools require virtual absolute paths (`/src/foo`).
 * Models often reuse relative hits from workspace_grep (`src/foo`), which
 * then fail in permission `validatePath` before the backend runs.
 *
 * Host paths under the attached folder (`/Users/…/admin-service/pvt-prep/foo.sql`)
 * are rewritten onto that mount (`/pvt-prep/foo.sql`) so permission checks and
 * the backend see the virtual tree instead of denying the write.
 *
 * Mentioned vault files also live at `/vault/folder/file`. Rewrite
 * `/voting/schema.sql` and `@voting/schema.sql` onto that mount so write
 * permissions see an allowed path instead of denying the product tree.
 *
 * glob requires `pattern`; models often put the glob in `path` instead.
 * Rewrite those calls before schema validation.
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

/** `*`, `?`, and `[` — the glob metacharacters models put in `path` by mistake. */
const GLOB_META = /[*?\[]/;

/** Map `.` / `src/foo` → `/` / `/src/foo`. Already-absolute paths are kept. */
export function toAbsoluteVirtualPath(raw: string): string {
  let trimmed = raw.trim().replaceAll("\\", "/");
  if (!trimmed || trimmed === ".") return "/";
  while (trimmed.startsWith("./")) trimmed = trimmed.slice(2);
  if (!trimmed || trimmed === ".") return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function workspaceRootOf(runtime?: {
  configurable?: Record<string, unknown>;
}): string | undefined {
  const fromAls = currentWorkspaceRoot();
  if (fromAls) return fromAls;
  const root = runtime?.configurable?.workspaceRoot;
  return typeof root === "string" && root.trim() ? root.trim() : undefined;
}

function normalizeFsPath(raw: string, root?: string): string {
  const vault = resolveVaultBackendPath(raw);
  if (vault) return vault;
  const stripped = raw.trim().replace(/^@/, "");
  if (root) return toVirtualPath(root, stripped);
  return toAbsoluteVirtualPath(stripped);
}

function looksLikeGlob(value: string): boolean {
  return GLOB_META.test(value);
}

/**
 * Split a path that already contains glob metacharacters into a search
 * directory and a glob. Deep Agents glob requires `pattern`; `path` is
 * only the base dir.
 */
export function splitGlobFromPath(
  raw: string,
  root?: string,
): { pattern: string; path: string } {
  const absolute = normalizeFsPath(raw, root);
  const meta = absolute.search(GLOB_META);
  if (meta < 0) {
    return { pattern: absolute.replace(/^\//, "") || "**/*", path: "/" };
  }
  const before = absolute.slice(0, meta);
  const slash = before.lastIndexOf("/");
  return {
    pattern: absolute.slice(slash + 1),
    path: slash <= 0 ? "/" : before.slice(0, slash),
  };
}

function normalizeArgs(
  args: Record<string, unknown>,
  root?: string,
): Record<string, unknown> | null {
  let changed = false;
  const next = { ...args };
  for (const key of PATH_KEYS) {
    const value = next[key];
    if (typeof value !== "string" || value.length === 0) continue;
    const normalized = normalizeFsPath(value, root);
    if (normalized === value) continue;
    next[key] = normalized;
    changed = true;
  }
  return changed ? next : null;
}

/**
 * Recover glob's required `pattern` when the model stuffed the glob into
 * `path` or grep's `glob` field. Then apply the usual path rewrite.
 */
export function rewriteGlobToolArgs(
  args: Record<string, unknown>,
  root?: string,
): Record<string, unknown> | null {
  const next = { ...args };
  let changed = false;
  const existing =
    typeof next.pattern === "string" ? next.pattern.trim() : "";

  if (!existing) {
    const fromGlob =
      typeof next.glob === "string" && next.glob.trim() ? next.glob.trim() : "";
    const fromPath =
      typeof next.path === "string" && looksLikeGlob(next.path)
        ? next.path
        : "";

    if (fromGlob) {
      next.pattern = fromGlob;
      delete next.glob;
      changed = true;
    } else if (fromPath) {
      const split = splitGlobFromPath(fromPath, root);
      next.pattern = split.pattern;
      next.path = split.path;
      changed = true;
    }
  }

  const pathNormalized = normalizeArgs(next, root);
  return pathNormalized ?? (changed ? next : null);
}

export const normalizeVirtualFsPaths = createMiddleware({
  name: "NormalizeVirtualFsPaths",
  wrapToolCall: async (request, handler) => {
    if (!FS_TOOLS.has(request.toolCall.name)) return handler(request);
    const args = request.toolCall.args;
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      return handler(request);
    }
    const record = args as Record<string, unknown>;
    const root = workspaceRootOf(
      request.runtime as { configurable?: Record<string, unknown> } | undefined,
    );
    const normalized =
      request.toolCall.name === "glob"
        ? rewriteGlobToolArgs(record, root)
        : normalizeArgs(record, root);
    if (!normalized) return handler(request);
    return handler({
      ...request,
      toolCall: { ...request.toolCall, args: normalized },
    });
  },
});
