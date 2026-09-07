import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../../config";

export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

const BLOCKED_ROOTS = new Set([
  "/",
  "/etc",
  "/sys",
  "/dev",
  "/proc",
  "/bin",
  "/sbin",
  "/usr",
  "/private",
  "/private/etc",
  "/System",
  "/Library",
  "/Applications",
]);

export const IGNORE_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "__pycache__",
  ".turbo",
  ".cache",
  "out",
  "vendor",
  ".venv",
  "venv",
  "target",
  ".idea",
]);

export function isIgnoredDirName(name: string): boolean {
  return IGNORE_DIR_NAMES.has(name);
}

export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function blockedRoot(normalized: string): boolean {
  if (BLOCKED_ROOTS.has(normalized)) return true;
  const home = os.homedir();
  if (home && path.resolve(home) === normalized) return true;
  return false;
}

function allowedRoots(): string[] {
  return config.workspace.allowedRoots.map((root) => path.resolve(root));
}

/**
 * Canonicalise a user-supplied folder path for registration. Must exist, be a
 * directory, survive realpath, and sit inside WORKSPACE_ALLOWED_ROOTS when set.
 */
export function assertWorkspaceRoot(absPath: string): string {
  const trimmed = absPath.trim();
  if (!trimmed) throw new WorkspacePathError("Path is required");
  if (!path.isAbsolute(trimmed)) {
    throw new WorkspacePathError("Path must be absolute, e.g. /Users/you/src/admin-service");
  }
  if (!existsSync(trimmed)) {
    throw new WorkspacePathError("Path does not exist");
  }

  let real: string;
  try {
    real = realpathSync(trimmed);
  } catch {
    throw new WorkspacePathError("Path could not be resolved");
  }

  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(real);
  } catch {
    throw new WorkspacePathError("Path does not exist");
  }
  if (!st.isDirectory()) {
    throw new WorkspacePathError("Path must be a directory");
  }

  const normalized = path.resolve(real);
  if (blockedRoot(normalized)) {
    throw new WorkspacePathError("That path is not allowed as a project folder");
  }

  const roots = allowedRoots();
  if (roots.length > 0) {
    const ok = roots.some((root) => isInside(root, normalized));
    if (!ok) {
      throw new WorkspacePathError("Path is outside WORKSPACE_ALLOWED_ROOTS");
    }
  }

  return normalized;
}

function existingAncestor(absPath: string): string {
  let current = absPath;
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  try {
    return realpathSync(current);
  } catch {
    return current;
  }
}

/**
 * Turn a model-supplied path into a relative path inside `root`.
 * Absolute paths that sit in the folder are accepted; anything outside is rejected.
 */
export function toWorkspaceRelative(root: string, input: string): string {
  const trimmed = input.trim().replaceAll("\\", "/");
  if (!trimmed || trimmed === ".") return ".";

  if (path.isAbsolute(trimmed)) {
    const abs = path.resolve(trimmed);
    if (!isInside(root, abs)) {
      throw new WorkspacePathError(
        `That path is outside this project. Use a relative path from ${root}, e.g. internal/handler/voting`,
      );
    }
    return toPosixRelative(root, abs) || ".";
  }

  return trimmed.replace(/^\/+/, "") || ".";
}

/**
 * Resolve `relative` against a registered root and prove the result stays
 * inside it, including through symlinks. `mustExist` is for reads.
 */
export function resolveInsideRoot(
  root: string,
  relative: string,
  mustExist = false,
): string {
  const rel = toWorkspaceRelative(root, relative);
  const target = rel === "." ? root : path.resolve(root, rel);

  if (!isInside(root, target)) {
    throw new WorkspacePathError("Path escapes the project folder");
  }

  const ancestor = existingAncestor(target);
  if (!isInside(root, ancestor)) {
    throw new WorkspacePathError("Path escapes the project folder");
  }

  if (existsSync(target)) {
    try {
      if (lstatSync(target).isSymbolicLink()) {
        const real = realpathSync(target);
        if (!isInside(root, real)) {
          throw new WorkspacePathError("Path escapes the project folder");
        }
        if (mustExist) return real;
      }
    } catch (err) {
      if (err instanceof WorkspacePathError) throw err;
    }
  } else if (mustExist) {
    throw new WorkspacePathError("File not found");
  }

  return target;
}

export function isGitPath(root: string, absPath: string): boolean {
  const rel = path.relative(root, absPath);
  if (!rel || rel.startsWith("..")) return false;
  const first = rel.split(path.sep)[0];
  return first === ".git";
}

export function toPosixRelative(root: string, absPath: string): string {
  const rel = path.relative(root, absPath);
  return rel.split(path.sep).join("/");
}
