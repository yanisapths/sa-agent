import path from "path";
import { z } from "zod";
import { config } from "../../config";
import { getSupabase } from "../../database/supabase";
import { HttpError, throwIfError } from "../httpError";
import {
  downloadVaultObject,
  removeVaultObjects,
  uploadVaultObject,
  vaultObjectKey,
  vaultStoragePath,
} from "./storage";
import type {
  CreateFolderInput,
  MentionResolution,
  ResolvedMention,
  UnresolvedMention,
  UploadFileInput,
  VaultFileResponse,
  VaultFileRow,
  VaultFolderResponse,
  VaultFolderRow,
  VaultMentionResponse,
  VaultUploadResponse,
} from "./types";

const FOLDERS = "vault_folders";
const FILES = "vault_files";

const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).optional().default(""),
});

const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".md",
  ".txt",
  ".csv",
  ".json",
  ".ts",
  ".tsx",
  ".sql",
  ".docx",
  ".xlsx",
]);

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".ts": "text/typescript",
  ".tsx": "text/tsx",
  ".sql": "application/sql",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function newId(prefix: "fld" | "fil"): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function toMentionToken(folderName: string, fileName?: string): string {
  const folder = folderName.trim().replace(/\s+/g, "-");
  return fileName ? `@${folder}/${fileName}` : `@${folder}`;
}

function safeFileName(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || "file";
}

function isAcceptedFile(file: UploadFileInput["file"]): boolean {
  if (file.mimetype.startsWith("image/")) return true;
  return ALLOWED_EXTENSIONS.has(path.extname(file.originalname).toLowerCase());
}

function mimeTypeOf(file: UploadFileInput["file"]): string {
  if (file.mimetype.startsWith("image/")) return file.mimetype;
  const ext = path.extname(file.originalname).toLowerCase();
  if (file.mimetype && file.mimetype !== "application/octet-stream") {
    return file.mimetype;
  }
  return MIME_BY_EXT[ext] ?? file.mimetype ?? "application/octet-stream";
}

function toFileResponse(row: VaultFileRow): VaultFileResponse {
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    mimeType: row.mime_type,
    storagePath: vaultStoragePath(row.storage_path),
    createdAt: row.created_at,
  };
}

function toFolderResponse(
  folder: VaultFolderRow,
  files: VaultFileRow[],
): VaultFolderResponse {
  return {
    id: folder.id,
    name: folder.name,
    description: folder.description,
    files: files.map(toFileResponse),
  };
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

export function parseCreateFolderInput(body: unknown): CreateFolderInput {
  const parsed = createFolderSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new HttpError(400, "Invalid folder payload");
  }
  return parsed.data;
}

export async function listFolders(
  userId: string,
  q = "",
): Promise<VaultFolderResponse[]> {
  const supabase = getSupabase();
  let query = supabase
    .from(FOLDERS)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  const needle = q.trim();
  if (needle) {
    query = query.ilike(
      "name",
      `%${needle.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`,
    );
  }

  const { data: folders, error } = await query;
  throwIfError(error);

  const folderRows = (folders ?? []) as VaultFolderRow[];
  if (folderRows.length === 0) return [];

  const { data: files, error: filesError } = await supabase
    .from(FILES)
    .select("*")
    .eq("user_id", userId)
    .in(
      "folder_id",
      folderRows.map((folder) => folder.id),
    )
    .order("created_at", { ascending: true });

  throwIfError(filesError);

  const filesByFolder = new Map<string, VaultFileRow[]>();
  for (const file of (files ?? []) as VaultFileRow[]) {
    const list = filesByFolder.get(file.folder_id) ?? [];
    list.push(file);
    filesByFolder.set(file.folder_id, list);
  }

  return folderRows.map((folder) =>
    toFolderResponse(folder, filesByFolder.get(folder.id) ?? []),
  );
}

export async function createFolder(
  userId: string,
  input: CreateFolderInput,
): Promise<VaultFolderResponse> {
  const row: VaultFolderRow = {
    id: newId("fld"),
    user_id: userId,
    name: input.name,
    description: input.description,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await getSupabase()
    .from(FOLDERS)
    .insert(row)
    .select("*")
    .single();

  if (isUniqueViolation(error)) {
    throw new HttpError(409, "Folder name already exists");
  }
  throwIfError(error);

  return toFolderResponse(data as VaultFolderRow, []);
}

export async function deleteFolder(
  userId: string,
  folderId: string,
): Promise<{ id: string }> {
  const supabase = getSupabase();
  const { data: folder, error: folderError } = await supabase
    .from(FOLDERS)
    .select("id")
    .eq("id", folderId)
    .eq("user_id", userId)
    .maybeSingle();

  throwIfError(folderError);
  if (!folder) throw new HttpError(404, "Folder not found");

  const { data: files, error: filesError } = await supabase
    .from(FILES)
    .select("storage_path")
    .eq("folder_id", folderId)
    .eq("user_id", userId);

  throwIfError(filesError);

  await removeVaultObjects(
    ((files ?? []) as Pick<VaultFileRow, "storage_path">[]).map(
      (file) => file.storage_path,
    ),
  );

  const { error: deleteError } = await supabase
    .from(FOLDERS)
    .delete()
    .eq("id", folderId)
    .eq("user_id", userId);

  throwIfError(deleteError);
  return { id: folderId };
}

export async function uploadFile(
  userId: string,
  input: UploadFileInput,
): Promise<VaultUploadResponse> {
  if (!input.folderId) {
    throw new HttpError(400, "folderId is required");
  }
  if (!input.file) {
    throw new HttpError(400, "file is required");
  }
  if (input.file.size > config.vault.maxFileBytes) {
    throw new HttpError(413, "File exceeds 20MB limit");
  }
  if (!isAcceptedFile(input.file)) {
    throw new HttpError(400, "Unsupported file type");
  }

  const supabase = getSupabase();
  const { data: folder, error: folderError } = await supabase
    .from(FOLDERS)
    .select("*")
    .eq("id", input.folderId)
    .eq("user_id", userId)
    .maybeSingle();

  throwIfError(folderError);
  if (!folder) throw new HttpError(404, "Folder not found");

  const fileId = newId("fil");
  const filename = safeFileName(input.file.originalname);
  const objectKey = vaultObjectKey(userId, input.folderId, fileId, filename);
  const mimeType = mimeTypeOf(input.file);
  const createdAt = new Date().toISOString();

  await uploadVaultObject(objectKey, input.file.buffer, mimeType);

  const row: VaultFileRow = {
    id: fileId,
    folder_id: input.folderId,
    user_id: userId,
    name: input.file.originalname,
    size: input.file.size,
    mime_type: mimeType,
    storage_path: objectKey,
    description: input.description,
    created_at: createdAt,
  };

  const { data, error } = await supabase
    .from(FILES)
    .insert(row)
    .select("*")
    .single();
  if (error) {
    await removeVaultObjects([objectKey]).catch(() => undefined);
    throwIfError(error);
  }

  const saved = data as VaultFileRow;
  const folderName = (folder as VaultFolderRow).name;

  return {
    id: saved.id,
    folderId: saved.folder_id,
    name: saved.name,
    size: saved.size,
    mimeType: saved.mime_type,
    storagePath: vaultStoragePath(saved.storage_path),
    mentionToken: toMentionToken(folderName, saved.name),
    createdAt: saved.created_at,
  };
}

export async function deleteFile(
  userId: string,
  fileId: string,
): Promise<{ id: string }> {
  const supabase = getSupabase();
  const { data: file, error } = await supabase
    .from(FILES)
    .select("*")
    .eq("id", fileId)
    .eq("user_id", userId)
    .maybeSingle();

  throwIfError(error);
  if (!file) throw new HttpError(404, "File not found");

  const row = file as VaultFileRow;
  await removeVaultObjects([row.storage_path]);

  const { error: deleteError } = await supabase
    .from(FILES)
    .delete()
    .eq("id", fileId)
    .eq("user_id", userId);

  throwIfError(deleteError);
  return { id: fileId };
}

/**
 * Mention resolution for the chat route.
 *
 * `@folder/file.ext` in a chat message is only text until someone fetches the
 * bytes. These are the caps on doing that: a mention is one click, so a folder
 * mention can name far more content than belongs in one prompt, and inlining a
 * truncated case list would be worse than refusing it.
 */
const MAX_MENTION_FILES = 5;
const MAX_MENTION_FILE_BYTES = 1024 * 1024;
const MAX_MENTION_TOTAL_BYTES = 4 * 1024 * 1024;

/**
 * Tokens are `@folder/file.ext`. Folder names have their whitespace collapsed
 * to dashes by `toMentionToken`, and `safeFileName` limits filenames to
 * alphanumerics, dot, underscore, and dash — so the token charset is closed.
 *
 * The leading boundary matters: without it `yanisa@example.com` reads as a
 * mention of `@example.com`.
 */
const MENTION_PATTERN = /(?<=^|[\s([{"'])@[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?/g;

/** A token at the end of a sentence keeps the sentence's punctuation. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

export function extractMentionTokens(message: string): string[] {
  const found = (message.match(MENTION_PATTERN) ?? [])
    .map((token) => token.replace(TRAILING_PUNCTUATION, ""))
    .filter((token) => token.length > 1);
  return [...new Set(found)];
}

/**
 * Resolve mention tokens to file bytes from this user's vault only. A token
 * naming a folder resolves to the files in it. Anything unresolved comes back
 * with a reason instead of being dropped — a silently missing case list is how
 * a specialist ends up inventing cases.
 */
export async function resolveMentions(
  userId: string,
  tokens: readonly string[],
): Promise<MentionResolution> {
  const files: ResolvedMention[] = [];
  const unresolved: UnresolvedMention[] = [];
  if (tokens.length === 0) return { files, unresolved };

  const folders = await listFoldersWithRows(userId);
  const byFile = new Map<string, { folder: string; row: VaultFileRow }>();
  const byFolder = new Map<string, VaultFileRow[]>();

  for (const { folder, rows } of folders) {
    byFolder.set(toMentionToken(folder.name).toLowerCase(), rows);
    for (const row of rows) {
      byFile.set(toMentionToken(folder.name, row.name).toLowerCase(), {
        folder: folder.name,
        row,
      });
    }
  }

  /** Carries the token the human typed, so a refusal names what they wrote. */
  const queued: { token: string; row: VaultFileRow }[] = [];
  const seen = new Set<string>();

  const enqueue = (token: string, row: VaultFileRow) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    queued.push({ token, row });
  };

  for (const token of tokens) {
    const key = token.toLowerCase();
    const file = byFile.get(key);
    if (file) {
      enqueue(token, file.row);
      continue;
    }

    const folderFiles = byFolder.get(key);
    if (!folderFiles) {
      unresolved.push({ token, reason: "no such file or folder in the vault" });
      continue;
    }
    if (folderFiles.length === 0) {
      unresolved.push({ token, reason: "folder is empty" });
      continue;
    }
    for (const row of folderFiles) {
      enqueue(`${token}/${row.name}`, row);
    }
  }

  let total = 0;
  for (const { token, row } of queued) {
    if (files.length >= MAX_MENTION_FILES) {
      unresolved.push({
        token,
        reason: `more than ${MAX_MENTION_FILES} files mentioned — name the files you need`,
      });
      continue;
    }
    if (row.size > MAX_MENTION_FILE_BYTES) {
      unresolved.push({
        token,
        reason: `${Math.round(row.size / 1024)} KB exceeds the ${MAX_MENTION_FILE_BYTES / 1024} KB per-file limit for chat — attach a smaller extract`,
      });
      continue;
    }
    if (total + row.size > MAX_MENTION_TOTAL_BYTES) {
      unresolved.push({ token, reason: "total mentioned size limit reached" });
      continue;
    }

    files.push({
      token,
      name: row.name,
      mimeType: row.mime_type,
      buffer: await downloadVaultObject(row.storage_path),
    });
    total += row.size;
  }

  return { files, unresolved };
}

/** Folder rows with their file rows, keeping `storage_path` for download. */
async function listFoldersWithRows(
  userId: string,
): Promise<{ folder: VaultFolderRow; rows: VaultFileRow[] }[]> {
  const supabase = getSupabase();
  const { data: folders, error } = await supabase
    .from(FOLDERS)
    .select("*")
    .eq("user_id", userId);
  throwIfError(error);

  const folderRows = (folders ?? []) as VaultFolderRow[];
  if (folderRows.length === 0) return [];

  const { data: files, error: filesError } = await supabase
    .from(FILES)
    .select("*")
    .eq("user_id", userId)
    .in(
      "folder_id",
      folderRows.map((folder) => folder.id),
    );
  throwIfError(filesError);

  const byFolder = new Map<string, VaultFileRow[]>();
  for (const file of (files ?? []) as VaultFileRow[]) {
    const list = byFolder.get(file.folder_id) ?? [];
    list.push(file);
    byFolder.set(file.folder_id, list);
  }

  return folderRows.map((folder) => ({
    folder,
    rows: byFolder.get(folder.id) ?? [],
  }));
}

export async function listMentions(
  userId: string,
  q = "",
  limit = 8,
): Promise<VaultMentionResponse[]> {
  const capped = Math.min(20, Math.max(1, Math.floor(limit)));
  const folders = await listFolders(userId);
  const needle = q.trim().replace(/^@/, "").toLowerCase();

  const mentions: VaultMentionResponse[] = folders.flatMap((folder) => [
    {
      token: toMentionToken(folder.name),
      label: folder.name,
      kind: "folder" as const,
      folderId: folder.id,
      fileId: null,
    },
    ...folder.files.map((file) => ({
      token: toMentionToken(folder.name, file.name),
      label: `${folder.name} / ${file.name}`,
      kind: "file" as const,
      folderId: folder.id,
      fileId: file.id,
    })),
  ]);

  const filtered = needle
    ? mentions.filter(
        (item) =>
          item.token.toLowerCase().includes(needle) ||
          item.label.toLowerCase().includes(needle),
      )
    : mentions;

  return filtered.slice(0, capped);
}
