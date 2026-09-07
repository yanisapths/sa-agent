import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { config } from "../../config";
import {
  isGitPath,
  isIgnoredDirName,
  resolveInsideRoot,
  toPosixRelative,
  WorkspacePathError,
} from "./paths";

const MIME_BY_EXT: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".ts": "text/typescript",
  ".tsx": "text/tsx",
  ".js": "text/javascript",
  ".jsx": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".sql": "application/sql",
  ".yml": "text/yaml",
  ".yaml": "text/yaml",
  ".py": "text/x-python",
  ".go": "text/x-go",
  ".java": "text/x-java",
  ".kt": "text/x-kotlin",
  ".rb": "text/x-ruby",
  ".php": "text/x-php",
  ".rs": "text/x-rust",
  ".c": "text/x-c",
  ".h": "text/x-c",
  ".cpp": "text/x-c++",
  ".hpp": "text/x-c++",
  ".cs": "text/x-csharp",
  ".sh": "text/x-shellscript",
  ".html": "text/html",
  ".css": "text/css",
  ".xml": "application/xml",
  ".toml": "text/plain",
  ".ini": "text/plain",
  ".graphql": "text/plain",
  ".proto": "text/plain",
  ".vue": "text/plain",
  ".svelte": "text/plain",
};

const TEXT_EXTENSIONS = new Set(Object.keys(MIME_BY_EXT));

export function mimeTypeOf(name: string): string {
  const ext = path.extname(name).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function isTextFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  return ext === "";
}

function looksBinary(buffer: Buffer): boolean {
  const slice = buffer.subarray(0, Math.min(buffer.length, 8192));
  return slice.includes(0);
}

export type ListedEntry = {
  path: string;
  kind: "file" | "dir";
};

function walkDir(
  root: string,
  dir: string,
  depth: number,
  maxDepth: number,
  maxEntries: number,
  out: ListedEntry[],
): void {
  if (out.length >= maxEntries || depth > maxDepth) return;

  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }

  names.sort((a, b) => a.localeCompare(b));
  for (const name of names) {
    if (out.length >= maxEntries) return;
    if (name === "." || name === "..") continue;
    const abs = path.join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (isIgnoredDirName(name)) continue;
      out.push({ path: toPosixRelative(root, abs) || ".", kind: "dir" });
      walkDir(root, abs, depth + 1, maxDepth, maxEntries, out);
      continue;
    }
    if (st.isFile()) {
      out.push({ path: toPosixRelative(root, abs), kind: "file" });
    }
  }
}

export function listWorkspace(
  root: string,
  relative = ".",
  depth = 2,
  maxEntries = config.workspace.maxListEntries,
): ListedEntry[] {
  const dir = resolveInsideRoot(root, relative, true);
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(dir);
  } catch {
    throw new WorkspacePathError("Path does not exist");
  }
  if (!st.isDirectory()) {
    throw new WorkspacePathError("Not a directory");
  }
  const bounded = Math.min(4, Math.max(1, Math.trunc(depth)));
  const cap = Math.min(500, Math.max(1, Math.trunc(maxEntries)));
  const out: ListedEntry[] = [];
  walkDir(root, dir, 1, bounded, cap, out);
  return out;
}

export function formatTree(root: string, relative = ".", depth = 2): string {
  const entries = listWorkspace(root, relative, depth);
  if (entries.length === 0) return "(empty)";
  return entries
    .map((entry) => (entry.kind === "dir" ? `${entry.path}/` : entry.path))
    .join("\n");
}

export function searchWorkspaceFiles(
  root: string,
  query: string,
  limit: number,
): string[] {
  const needle = query.trim().toLowerCase();
  const cap = Math.min(50, Math.max(1, Math.trunc(limit)));
  const matches: string[] = [];
  const stack = [root];

  while (stack.length > 0 && matches.length < cap) {
    const dir = stack.pop() as string;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (matches.length >= cap) break;
      const abs = path.join(dir, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (isIgnoredDirName(name)) continue;
        stack.push(abs);
        continue;
      }
      if (!st.isFile()) continue;
      const rel = toPosixRelative(root, abs);
      if (!needle || rel.toLowerCase().includes(needle) || name.toLowerCase().includes(needle)) {
        matches.push(rel);
      }
    }
  }

  return matches;
}

export function readWorkspaceFile(root: string, relative: string): Buffer {
  let abs: string;
  try {
    abs = resolveInsideRoot(root, relative, true);
  } catch (err) {
    if (err instanceof WorkspacePathError && err.message === "File not found") {
      throw new WorkspacePathError(missingFileHint(root, relative));
    }
    throw err;
  }
  const st = statSync(abs);
  if (!st.isFile()) throw new WorkspacePathError("Not a file");
  if (st.size > config.workspace.maxReadBytes) {
    throw new WorkspacePathError(
      `File exceeds the ${Math.round(config.workspace.maxReadBytes / 1024)} KB read limit`,
    );
  }
  return readFileSync(abs);
}

function missingFileHint(root: string, relative: string): string {
  const posix = relative.replaceAll("\\", "/").replace(/\/+$/, "");
  const parent = posix.includes("/") ? posix.slice(0, posix.lastIndexOf("/")) : ".";
  const want = posix.slice(posix.lastIndexOf("/") + 1).toLowerCase();
  let listing = "";
  try {
    const entries = listWorkspace(root, parent, 1);
    const names = entries.map((entry) =>
      entry.kind === "dir" ? `${entry.path}/` : entry.path,
    );
    listing = names.length > 0 ? names.join("\n") : "(empty)";
    const hit = entries.find(
      (entry) =>
        entry.kind === "file" &&
        path.posix.basename(entry.path).toLowerCase() === want,
    );
    if (hit) {
      return `File not found at ${relative}. Same name, different case: ${hit.path}. Use workspace_read with that path.`;
    }
  } catch {
    listing = "(could not list the directory)";
  }
  return (
    `File not found: ${relative}\n` +
    `Contents of ${parent}:\n${listing}\n` +
    `Use ls /internal/… or workspace_ls with a relative path from the project root.`
  );
}

export function writeWorkspaceFile(
  root: string,
  relative: string,
  content: string,
): { path: string; bytes: number } {
  if (Buffer.byteLength(content, "utf-8") > config.workspace.maxWriteBytes) {
    throw new WorkspacePathError(
      `Content exceeds the ${Math.round(config.workspace.maxWriteBytes / 1024)} KB write limit`,
    );
  }
  const abs = resolveInsideRoot(root, relative, false);
  if (isGitPath(root, abs)) {
    throw new WorkspacePathError("Writes under .git are not allowed");
  }
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf-8");
  return { path: toPosixRelative(root, abs), bytes: Buffer.byteLength(content, "utf-8") };
}

export type GrepHit = {
  path: string;
  line: number;
  text: string;
};

export function grepWorkspace(
  root: string,
  pattern: string,
  relative = ".",
): GrepHit[] {
  const needle = pattern.trim();
  if (!needle) throw new WorkspacePathError("Search pattern is required");
  const start = resolveInsideRoot(root, relative, true);
  const hits: GrepHit[] = [];
  const cap = config.workspace.maxGrepHits;
  const lower = needle.toLowerCase();
  const stack = [start];
  const maxFile = Math.min(config.workspace.maxReadBytes, 512 * 1024);

  while (stack.length > 0 && hits.length < cap) {
    const current = stack.pop() as string;
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(current);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      const name = path.basename(current);
      if (current !== start && isIgnoredDirName(name)) continue;
      let names: string[];
      try {
        names = readdirSync(current);
      } catch {
        continue;
      }
      for (const child of names) stack.push(path.join(current, child));
      continue;
    }
    if (!st.isFile() || st.size > maxFile) continue;
    const rel = toPosixRelative(root, current);
    if (rel.toLowerCase().includes(lower)) {
      hits.push({ path: rel, line: 0, text: "(path match)" });
      if (hits.length >= cap) break;
    }
    if (!isTextFile(current)) continue;
    let buf: Buffer;
    try {
      buf = readFileSync(current);
    } catch {
      continue;
    }
    if (looksBinary(buf)) continue;
    const lines = buf.toString("utf-8").split(/\r?\n/);
    for (let i = 0; i < lines.length && hits.length < cap; i++) {
      if (lines[i].toLowerCase().includes(lower)) {
        hits.push({
          path: rel,
          line: i + 1,
          text: lines[i].slice(0, 240),
        });
      }
    }
  }

  return hits;
}
