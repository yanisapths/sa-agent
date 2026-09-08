import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { updateFile } from "./service";
import type { ResolvedMention, VaultFileResponse } from "./types";

/** Virtual-FS prefix for vault files mentioned in this chat turn. */
export const VAULT_MOUNT = "/vault";

export type VaultMountFile = {
  fileId: string;
  token: string;
  name: string;
  mimeType: string;
  virtualPath: string;
  aliasPath: string;
  original: string;
};

export type VaultMount = {
  userId: string;
  files: VaultMountFile[];
};

const store = new AsyncLocalStorage<VaultMount>();

export function currentVaultMount(): VaultMount | undefined {
  return store.getStore();
}

export function withVaultMount<T>(
  mount: VaultMount | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!mount || mount.files.length === 0) return fn();
  return store.run(mount, fn);
}

type FileData = {
  content: string[];
  created_at: string;
  modified_at: string;
};

function toFileData(text: string): FileData {
  const now = new Date().toISOString();
  return {
    content: text.split("\n"),
    created_at: now,
    modified_at: now,
  };
}

/** `@voting/schema.sql` → `/vault/voting/schema.sql` and alias `/voting/schema.sql`. */
export function vaultPathsForToken(token: string): {
  virtualPath: string;
  aliasPath: string;
} {
  const rest = token.replace(/^@/, "").replaceAll("\\", "/").replace(/^\/+/, "");
  return {
    virtualPath: `${VAULT_MOUNT}/${rest}`,
    aliasPath: `/${rest}`,
  };
}

function toAbsolutePath(raw: string): string {
  let trimmed = raw.trim().replaceAll("\\", "/");
  if (!trimmed || trimmed === ".") return "/";
  while (trimmed.startsWith("./")) trimmed = trimmed.slice(2);
  if (!trimmed || trimmed === ".") return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function contentOf(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object" || !("content" in data)) return null;
  const raw = (data as { content: unknown }).content;
  if (Array.isArray(raw)) return raw.join("\n");
  if (typeof raw === "string") return raw;
  return null;
}

/**
 * Map a model-supplied path onto the vault state tree when this turn mounted
 * that file. `/voting/schema.sql` and `@voting/schema.sql` become
 * `/vault/voting/schema.sql` so writes stay off the product repo.
 */
export function resolveVaultBackendPath(filePath: string): string | undefined {
  const mount = currentVaultMount();
  if (!mount || mount.files.length === 0) return undefined;

  const stripped = filePath.trim().replace(/^@/, "");
  const normalized = toAbsolutePath(stripped);
  if (normalized === VAULT_MOUNT || normalized.startsWith(`${VAULT_MOUNT}/`)) {
    return normalized;
  }

  for (const file of mount.files) {
    if (normalized === file.virtualPath || normalized === file.aliasPath) {
      return file.virtualPath;
    }
    const aliasDir = path.posix.dirname(file.aliasPath);
    if (aliasDir !== "/" && (normalized === aliasDir || normalized.startsWith(`${aliasDir}/`))) {
      return `${VAULT_MOUNT}${normalized}`;
    }
  }
  return undefined;
}

/**
 * Extensions we can round-trip through StateBackend as UTF-8. Same set the
 * chat route will inline; binaries stay named-and-skipped.
 */
const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".csv",
  ".json",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".sql",
  ".yaml",
  ".yml",
  ".py",
  ".go",
  ".java",
  ".kt",
  ".rb",
  ".php",
  ".rs",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cs",
  ".sh",
  ".html",
  ".css",
  ".xml",
  ".toml",
  ".ini",
  ".graphql",
  ".proto",
  ".vue",
  ".svelte",
]);

export function isVaultTextMention(file: {
  name: string;
  mimeType: string;
}): boolean {
  if (file.mimeType.startsWith("image/")) return false;
  const ext = path.extname(file.name).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

export interface ParkedVaultMentions {
  files: Record<string, FileData>;
  mount: VaultMount;
  notes: string[];
  fileIds: Set<string>;
}

/** Put mentioned vault text files on the agent's virtual FS for this turn. */
export function parkVaultMentions(
  userId: string,
  mentions: readonly ResolvedMention[],
): ParkedVaultMentions {
  const files: Record<string, FileData> = {};
  const mounted: VaultMountFile[] = [];
  const notes: string[] = [];
  const fileIds = new Set<string>();

  for (const mention of mentions) {
    if (!isVaultTextMention(mention)) continue;
    const { virtualPath, aliasPath } = vaultPathsForToken(mention.token);
    const original = mention.buffer.toString("utf-8");
    files[virtualPath] = toFileData(original);
    fileIds.add(mention.id);
    mounted.push({
      fileId: mention.id,
      token: mention.token,
      name: mention.name,
      mimeType: mention.mimeType,
      virtualPath,
      aliasPath,
      original,
    });
  }

  if (mounted.length > 0) {
    const listing = mounted
      .map(
        (file) =>
          `${file.token} → ${file.virtualPath} (also ${file.aliasPath})`,
      )
      .join("; ");
    notes.push(
      `[Vault files are mounted for edit: ${listing}. Use read_file / edit_file / write_file on those paths. Changes are saved back to the vault.]`,
    );
  }

  return {
    files,
    mount: { userId, files: mounted },
    notes,
    fileIds,
  };
}

/**
 * Write `/vault/**` files that changed this turn back to storage.
 */
export async function persistVaultEdits(
  mount: VaultMount | undefined,
  result: unknown,
): Promise<VaultFileResponse[]> {
  if (!mount || mount.files.length === 0) return [];
  const stateFiles = (result as { files?: Record<string, unknown> })?.files;
  if (!stateFiles || typeof stateFiles !== "object") return [];

  const saved: VaultFileResponse[] = [];
  for (const file of mount.files) {
    const next = contentOf(stateFiles[file.virtualPath]);
    if (next == null || next === file.original) continue;
    saved.push(
      await updateFile(mount.userId, file.fileId, Buffer.from(next, "utf-8")),
    );
  }
  return saved;
}
