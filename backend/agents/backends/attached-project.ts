import { getConfig } from "@langchain/langgraph";
import {
  FilesystemBackend,
  StateBackend,
  type FileOperationError,
  type WriteResult,
} from "deepagents";
import { config } from "../../config";
import { writeWorkspaceFile } from "../../internal/workspace/fs";
import {
  IGNORE_DIR_NAMES,
  isGitPath,
  resolveInsideRoot,
  toVirtualPath,
  WorkspacePathError,
} from "../../internal/workspace/paths";
import {
  currentVaultMount,
  resolveVaultBackendPath,
  VAULT_MOUNT,
} from "../../internal/vault/mount";
import { currentWorkspaceRoot } from "../../internal/workspace/runtime";

export { toVirtualPath } from "../../internal/workspace/paths";

/**
 * Ephemeral Deep Agent trees that must stay on StateBackend even when a
 * product repo is mounted as the default filesystem.
 */
const STATE_PREFIXES = [
  "/artifacts",
  "/large_tool_results",
  "/conversation_history",
  VAULT_MOUNT,
] as const;

const disks = new Map<string, FilesystemBackend>();

function diskFor(root: string): FilesystemBackend {
  const cached = disks.get(root);
  if (cached) return cached;
  const created = new FilesystemBackend({
    rootDir: root,
    virtualMode: true,
    maxFileSizeMb: Math.max(
      1,
      Math.ceil(config.workspace.maxReadBytes / (1024 * 1024)),
    ),
  });
  disks.set(root, created);
  return created;
}

function attachedRoot(): string | undefined {
  const fromAls = currentWorkspaceRoot();
  if (fromAls) return fromAls;
  try {
    const cfg = getConfig() as {
      configurable?: { workspaceRoot?: unknown };
    };
    const root = cfg.configurable?.workspaceRoot;
    if (typeof root === "string" && root.trim()) return root.trim();
  } catch {
    // Outside a graph run (assembly, tests).
  }
  return undefined;
}

function isStatePath(filePath: string): boolean {
  const normalized = filePath.replace(/\/+$/, "") || "/";
  return STATE_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

function ignoredPath(filePath: string): boolean {
  return filePath.split("/").some((part) => IGNORE_DIR_NAMES.has(part));
}

type AnyBackend = StateBackend | FilesystemBackend;

/**
 * Default Deep Agent filesystem: the attached product repo when a folder is
 * on this request, otherwise the per-thread StateBackend. `/artifacts`,
 * tool-result eviction, and conversation history always stay in state so a
 * `write_file /artifacts/review.md` cannot land as a file in the human's repo.
 */
export class AttachedProjectBackend {
  constructor(private readonly state: StateBackend) {}

  private target(filePath: string): {
    backend: AnyBackend;
    path: string;
    root?: string;
  } {
    if (isStatePath(filePath)) {
      return { backend: this.state, path: filePath };
    }
    const vaultPath = resolveVaultBackendPath(filePath);
    if (vaultPath) {
      return { backend: this.state, path: vaultPath };
    }
    const root = attachedRoot();
    if (!root) {
      return { backend: this.state, path: filePath };
    }
    return {
      backend: diskFor(root),
      path: toVirtualPath(root, filePath),
      root,
    };
  }

  async ls(path: string) {
    const target = this.target(path || "/");
    const result = await Promise.resolve(target.backend.ls(target.path));
    if (result.error || !result.files) return result;
    const files = result.files.filter((file) => !ignoredPath(file.path));
    if (path === "/" || path === "") {
      if (target.root && !files.some((file) => file.path === "/artifacts/")) {
        files.unshift({ path: "/artifacts/", is_dir: true });
      }
      if (
        currentVaultMount()?.files.length &&
        !files.some((file) => file.path === `${VAULT_MOUNT}/`)
      ) {
        files.unshift({ path: `${VAULT_MOUNT}/`, is_dir: true });
      }
    }
    return { files };
  }

  async read(filePath: string, offset?: number, limit?: number) {
    const target = this.target(filePath);
    return Promise.resolve(target.backend.read(target.path, offset, limit));
  }

  async readRaw(filePath: string) {
    const target = this.target(filePath);
    return Promise.resolve(target.backend.readRaw(target.path));
  }

  async write(filePath: string, content: string) {
    const target = this.target(filePath);
    const blocked = this.blockDiskWrite(target.root, target.path);
    if (blocked) return { error: blocked };
    if (target.root) {
      try {
        const rel = target.path.replace(/^\/+/, "") || ".";
        writeWorkspaceFile(target.root, rel, content);
        return { path: target.path, filesUpdate: null };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    }
    return this.writeState(target.backend, target.path, content);
  }

  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false,
  ) {
    const target = this.target(filePath);
    const blocked = this.blockDiskWrite(target.root, target.path);
    if (blocked) return { error: blocked };
    return Promise.resolve(
      target.backend.edit(target.path, oldString, newString, replaceAll),
    );
  }

  async grep(pattern: string, path = "/", glob: string | null = null) {
    if (isStatePath(path) || !attachedRoot()) {
      return Promise.resolve(this.state.grep(pattern, path, glob));
    }
    if (path === "/" || path === "") {
      const root = attachedRoot() as string;
      const [stateResult, diskResult] = await Promise.all([
        Promise.resolve(this.state.grep(pattern, "/", glob)),
        diskFor(root).grep(pattern, "/", glob),
      ]);
      if (diskResult.error) return diskResult;
      const matches = [
        ...(stateResult.matches ?? []),
        ...(diskResult.matches ?? []).filter((match) => !ignoredPath(match.path)),
      ];
      return { matches };
    }
    const target = this.target(path);
    const result = await Promise.resolve(
      target.backend.grep(pattern, target.path, glob),
    );
    if (result.error || !result.matches) return result;
    return {
      matches: result.matches.filter((match) => !ignoredPath(match.path)),
    };
  }

  async glob(pattern: string, searchPath = "/") {
    if (isStatePath(searchPath) || !attachedRoot()) {
      return Promise.resolve(this.state.glob(pattern, searchPath));
    }
    if (searchPath === "/" || searchPath === "") {
      const root = attachedRoot() as string;
      const [stateResult, diskResult] = await Promise.all([
        Promise.resolve(this.state.glob(pattern, "/")),
        diskFor(root).glob(pattern, "/"),
      ]);
      if (diskResult.error) return diskResult;
      const files = [
        ...(stateResult.files ?? []),
        ...(diskResult.files ?? []).filter((file) => !ignoredPath(file.path)),
      ];
      return { files };
    }
    const target = this.target(searchPath);
    const result = await Promise.resolve(
      target.backend.glob(pattern, target.path),
    );
    if (result.error || !result.files) return result;
    return { files: result.files.filter((file) => !ignoredPath(file.path)) };
  }

  async uploadFiles(files: Array<[string, Uint8Array]>) {
    const results: Array<{
      path: string;
      error: FileOperationError | null;
    }> = [];
    for (const [filePath, content] of files) {
      const target = this.target(filePath);
      const blocked = this.blockDiskWrite(target.root, target.path);
      if (blocked) {
        results.push({ path: filePath, error: "permission_denied" });
        continue;
      }
      if (!target.backend.uploadFiles) {
        results.push({ path: filePath, error: "invalid_path" });
        continue;
      }
      const batch = await Promise.resolve(
        target.backend.uploadFiles([[target.path, content]]),
      );
      results.push({
        path: filePath,
        error: batch[0]?.error ?? null,
      });
    }
    return results;
  }

  async downloadFiles(paths: string[]) {
    const results: Array<{
      path: string;
      content: Uint8Array | null;
      error: FileOperationError | null;
    }> = [];
    for (const filePath of paths) {
      const target = this.target(filePath);
      if (!target.backend.downloadFiles) {
        results.push({
          path: filePath,
          content: null,
          error: "invalid_path",
        });
        continue;
      }
      const batch = await Promise.resolve(
        target.backend.downloadFiles([target.path]),
      );
      const row = batch[0];
      results.push({
        path: filePath,
        content: row?.content ?? null,
        error: row?.error ?? null,
      });
    }
    return results;
  }

  /**
   * Deep Agents `write` only creates. Re-writing a phase artifact (or any
   * state file) would otherwise fail with "already exists"; upload overwrites.
   */
  private async writeState(
    backend: AnyBackend,
    filePath: string,
    content: string,
  ): Promise<WriteResult> {
    const created = await Promise.resolve(backend.write(filePath, content));
    if (!created.error) return created;
    if (!/already exists/i.test(created.error) || !backend.uploadFiles) {
      return created;
    }
    const batch = await Promise.resolve(
      backend.uploadFiles([[filePath, new TextEncoder().encode(content)]]),
    );
    const uploadError = batch[0]?.error;
    if (uploadError) {
      return { error: `Failed to write to ${filePath}: ${uploadError}` };
    }
    const filesUpdate = (
      batch as { filesUpdate?: WriteResult["filesUpdate"] }
    ).filesUpdate;
    return { path: filePath, filesUpdate: filesUpdate ?? null };
  }

  private blockDiskWrite(root: string | undefined, virtualPath: string) {
    if (!root) return undefined;
    try {
      const rel = virtualPath.replace(/^\/+/, "") || ".";
      const abs = resolveInsideRoot(root, rel);
      if (isGitPath(root, abs)) return "Refusing to write under .git";
    } catch (err) {
      if (err instanceof WorkspacePathError) return err.message;
      throw err;
    }
    return undefined;
  }
}
