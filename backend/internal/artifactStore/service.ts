import path from "path";
import { z } from "zod";
import { config } from "../../config";
import { getSupabase } from "../../database/supabase";
import { HttpError, throwIfError } from "../httpError";
import {
  artifactObjectKey,
  downloadArtifactObject,
  removeArtifactObjects,
  uploadArtifactObject,
} from "./storage";
import type {
  ArtifactBytes,
  ArtifactContentResponse,
  ArtifactFileDetailResponse,
  ArtifactFileResponse,
  ArtifactFileRow,
  ArtifactMentionResponse,
  ArtifactVersionResponse,
  ArtifactVersionRow,
  MentionResolution,
  SaveArtifactInput,
} from "./types";

const FILES = "artifact_files";
const VERSIONS = "artifact_versions";

export const ARTIFACT_MENTION_FOLDER = "Artifacts";
export const ARTIFACT_MENTION_PREFIX = `@${ARTIFACT_MENTION_FOLDER}`;

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".ts": "text/typescript",
  ".tsx": "text/tsx",
  ".js": "text/javascript",
  ".sql": "application/sql",
  ".yml": "text/yaml",
  ".yaml": "text/yaml",
  ".py": "text/x-python",
  ".go": "text/x-go",
  ".sh": "text/x-shellscript",
  ".html": "text/html",
  ".css": "text/css",
  ".xml": "application/xml",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".csv",
  ".json",
  ".ts",
  ".tsx",
  ".js",
  ".sql",
  ".yml",
  ".yaml",
  ".py",
  ".go",
  ".sh",
  ".html",
  ".css",
  ".xml",
]);

const editSchema = z.object({
  content: z.string(),
});

const copySchema = z.object({
  name: z.string().trim().min(1).max(180).optional(),
});

const MAX_MENTION_FILES = 5;
const MAX_MENTION_FILE_BYTES = 1024 * 1024;
const MAX_MENTION_TOTAL_BYTES = 4 * 1024 * 1024;

function newId(prefix: "art" | "arv"): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function toMentionToken(fileName: string): string {
  return `${ARTIFACT_MENTION_PREFIX}/${fileName}`;
}

export function safeFileName(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || "file";
}

export function mimeTypeOf(name: string, mimeType?: string): string {
  if (mimeType && mimeType !== "application/octet-stream") return mimeType;
  const ext = path.extname(name).toLowerCase();
  return MIME_BY_EXT[ext] ?? mimeType ?? "application/octet-stream";
}

export function isTextArtifact(name: string, mimeType: string): boolean {
  if (mimeType.startsWith("text/")) return true;
  if (
    mimeType === "application/json" ||
    mimeType === "application/sql" ||
    mimeType === "application/xml" ||
    mimeType === "application/yaml"
  ) {
    return true;
  }
  return TEXT_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function throwIfMissingTable(error: unknown): void {
  if (
    typeof error === "object" &&
    error &&
    "code" in error &&
    (error as { code?: string }).code === "PGRST205"
  ) {
    throw new HttpError(
      503,
      "Artifact tables are missing. Run backend/sql/artifacts.sql in the Supabase SQL editor.",
    );
  }
  throwIfError(error);
}

function toVersionResponse(row: ArtifactVersionRow): ArtifactVersionResponse {
  return {
    id: row.id,
    version: row.version,
    size: row.size,
    mimeType: row.mime_type,
    source: row.source,
    createdAt: row.created_at,
  };
}

function toFileResponse(
  file: ArtifactFileRow,
  version: ArtifactVersionRow,
): ArtifactFileResponse {
  return {
    id: file.id,
    threadId: file.thread_id,
    phase: file.phase,
    name: file.name,
    currentVersion: file.current_version,
    size: version.size,
    mimeType: version.mime_type,
    mentionToken: toMentionToken(file.name),
    source: version.source,
    createdAt: file.created_at,
    updatedAt: file.updated_at,
  };
}

async function getFileRow(
  userId: string,
  fileId: string,
): Promise<ArtifactFileRow> {
  const { data, error } = await getSupabase()
    .from(FILES)
    .select("*")
    .eq("id", fileId)
    .eq("user_id", userId)
    .maybeSingle();
  throwIfMissingTable(error);
  if (!data) throw new HttpError(404, "Artifact not found");
  return data as ArtifactFileRow;
}

async function versionsFor(fileId: string): Promise<ArtifactVersionRow[]> {
  const { data, error } = await getSupabase()
    .from(VERSIONS)
    .select("*")
    .eq("file_id", fileId)
    .order("version", { ascending: false });
  throwIfMissingTable(error);
  return (data ?? []) as ArtifactVersionRow[];
}

async function versionRow(
  file: ArtifactFileRow,
  version?: number,
): Promise<ArtifactVersionRow> {
  const target = version ?? file.current_version;
  const { data, error } = await getSupabase()
    .from(VERSIONS)
    .select("*")
    .eq("file_id", file.id)
    .eq("version", target)
    .maybeSingle();
  throwIfMissingTable(error);
  if (!data) throw new HttpError(404, "Artifact version not found");
  return data as ArtifactVersionRow;
}

export function parseEditInput(body: unknown): { content: string } {
  const parsed = editSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, "Invalid edit payload");
  return parsed.data;
}

export function parseCopyInput(body: unknown): { name?: string } {
  const parsed = copySchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, "Invalid copy payload");
  return parsed.data;
}

export async function saveArtifact(
  userId: string,
  input: SaveArtifactInput,
): Promise<ArtifactFileResponse> {
  if (input.buffer.length > config.artifacts.maxFileBytes) {
    throw new HttpError(413, "File exceeds 20MB limit");
  }

  const name = safeFileName(input.name);
  const mimeType = mimeTypeOf(name, input.mimeType);
  const threadId = input.threadId.trim();
  if (!threadId) throw new HttpError(400, "threadId is required");

  const supabase = getSupabase();
  const { data: existing, error: existingError } = await supabase
    .from(FILES)
    .select("*")
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .eq("name", name)
    .maybeSingle();
  throwIfMissingTable(existingError);

  const now = new Date().toISOString();

  if (!existing) {
    const fileId = newId("art");
    const version = 1;
    const objectKey = artifactObjectKey(userId, fileId, version, name);
    await uploadArtifactObject(objectKey, input.buffer, mimeType);

    const fileRow: ArtifactFileRow = {
      id: fileId,
      user_id: userId,
      thread_id: threadId,
      phase: input.phase ?? null,
      name,
      current_version: version,
      created_at: now,
      updated_at: now,
    };
    const versionRowData: ArtifactVersionRow = {
      id: newId("arv"),
      file_id: fileId,
      version,
      size: input.buffer.length,
      mime_type: mimeType,
      storage_path: objectKey,
      source: input.source,
      created_at: now,
    };

    const { data: savedFile, error: fileError } = await supabase
      .from(FILES)
      .insert(fileRow)
      .select("*")
      .single();
    if (fileError) {
      await removeArtifactObjects([objectKey]).catch(() => undefined);
      throwIfMissingTable(fileError);
    }

    const { error: versionError } = await supabase
      .from(VERSIONS)
      .insert(versionRowData);
    if (versionError) {
      await removeArtifactObjects([objectKey]).catch(() => undefined);
      await supabase.from(FILES).delete().eq("id", fileId);
      throwIfMissingTable(versionError);
    }

    return toFileResponse(savedFile as ArtifactFileRow, versionRowData);
  }

  const file = existing as ArtifactFileRow;
  const nextVersion = file.current_version + 1;
  const objectKey = artifactObjectKey(userId, file.id, nextVersion, name);
  await uploadArtifactObject(objectKey, input.buffer, mimeType);

  const versionRowData: ArtifactVersionRow = {
    id: newId("arv"),
    file_id: file.id,
    version: nextVersion,
    size: input.buffer.length,
    mime_type: mimeType,
    storage_path: objectKey,
    source: input.source,
    created_at: now,
  };

  const { error: versionError } = await supabase
    .from(VERSIONS)
    .insert(versionRowData);
  if (versionError) {
    await removeArtifactObjects([objectKey]).catch(() => undefined);
    throwIfMissingTable(versionError);
  }

  const patch: Partial<ArtifactFileRow> = {
    current_version: nextVersion,
    updated_at: now,
  };
  if (input.phase) patch.phase = input.phase;

  const { data: updated, error: updateError } = await supabase
    .from(FILES)
    .update(patch)
    .eq("id", file.id)
    .eq("user_id", userId)
    .select("*")
    .single();
  throwIfMissingTable(updateError);

  return toFileResponse(updated as ArtifactFileRow, versionRowData);
}

export async function listFiles(
  userId: string,
  threadId = "",
): Promise<ArtifactFileResponse[]> {
  const supabase = getSupabase();
  let query = supabase
    .from(FILES)
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  const needle = threadId.trim();
  if (needle) query = query.eq("thread_id", needle);

  const { data: files, error } = await query;
  throwIfMissingTable(error);

  const fileRows = (files ?? []) as ArtifactFileRow[];
  if (fileRows.length === 0) return [];

  const { data: versions, error: versionsError } = await supabase
    .from(VERSIONS)
    .select("*")
    .in(
      "file_id",
      fileRows.map((file) => file.id),
    );
  throwIfMissingTable(versionsError);

  const currentByFile = new Map<string, ArtifactVersionRow>();
  for (const row of (versions ?? []) as ArtifactVersionRow[]) {
    const file = fileRows.find((item) => item.id === row.file_id);
    if (!file || row.version !== file.current_version) continue;
    currentByFile.set(file.id, row);
  }

  return fileRows.flatMap((file) => {
    const version = currentByFile.get(file.id);
    return version ? [toFileResponse(file, version)] : [];
  });
}

export async function getFile(
  userId: string,
  fileId: string,
): Promise<ArtifactFileDetailResponse> {
  const file = await getFileRow(userId, fileId);
  const versions = await versionsFor(file.id);
  const current = versions.find((row) => row.version === file.current_version);
  if (!current) throw new HttpError(404, "Artifact version not found");
  return {
    ...toFileResponse(file, current),
    versions: versions.map(toVersionResponse),
  };
}

export async function getArtifactBytes(
  userId: string,
  fileId: string,
  version?: number,
): Promise<ArtifactBytes> {
  const file = await getFileRow(userId, fileId);
  const row = await versionRow(file, version);
  return {
    name: file.name,
    mimeType: row.mime_type,
    buffer: await downloadArtifactObject(row.storage_path),
    version: row.version,
  };
}

export async function getContent(
  userId: string,
  fileId: string,
  version?: number,
): Promise<ArtifactContentResponse> {
  const file = await getFileRow(userId, fileId);
  const row = await versionRow(file, version);
  const isText = isTextArtifact(file.name, row.mime_type);
  const buffer = await downloadArtifactObject(row.storage_path);
  return {
    id: file.id,
    name: file.name,
    version: row.version,
    mimeType: row.mime_type,
    isText,
    text: isText ? buffer.toString("utf-8") : null,
  };
}

export async function editFile(
  userId: string,
  fileId: string,
  content: string,
): Promise<ArtifactFileResponse> {
  const file = await getFileRow(userId, fileId);
  const current = await versionRow(file);
  if (!isTextArtifact(file.name, current.mime_type)) {
    throw new HttpError(400, "Only text artifacts can be edited");
  }
  return saveArtifact(userId, {
    threadId: file.thread_id,
    phase: file.phase,
    name: file.name,
    mimeType: current.mime_type,
    buffer: Buffer.from(content, "utf-8"),
    source: "edit",
  });
}

function copyFileName(name: string, taken: Set<string>): string {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let candidate = `${stem} copy${ext}`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${stem} copy ${n}${ext}`;
    n += 1;
  }
  return candidate;
}

export async function copyFile(
  userId: string,
  fileId: string,
  requestedName?: string,
): Promise<ArtifactFileResponse> {
  const file = await getFileRow(userId, fileId);
  const current = await versionRow(file);
  const siblings = await listFiles(userId, file.thread_id);
  const taken = new Set(siblings.map((item) => item.name));
  const name = safeFileName(
    requestedName?.trim() ? requestedName : copyFileName(file.name, taken),
  );
  if (taken.has(name)) {
    throw new HttpError(409, "An artifact with that name already exists");
  }
  const buffer = await downloadArtifactObject(current.storage_path);
  return saveArtifact(userId, {
    threadId: file.thread_id,
    phase: file.phase,
    name,
    mimeType: current.mime_type,
    buffer,
    source: "edit",
  });
}

export async function deleteFile(
  userId: string,
  fileId: string,
): Promise<{ id: string }> {
  const file = await getFileRow(userId, fileId);
  const versions = await versionsFor(file.id);
  await removeArtifactObjects(versions.map((row) => row.storage_path));
  const { error } = await getSupabase()
    .from(FILES)
    .delete()
    .eq("id", fileId)
    .eq("user_id", userId);
  throwIfMissingTable(error);
  return { id: fileId };
}

export async function deleteVersion(
  userId: string,
  fileId: string,
  version: number,
): Promise<{ id: string; currentVersion: number | null }> {
  const file = await getFileRow(userId, fileId);
  const versions = await versionsFor(file.id);
  const target = versions.find((row) => row.version === version);
  if (!target) throw new HttpError(404, "Artifact version not found");

  await removeArtifactObjects([target.storage_path]);
  const { error } = await getSupabase()
    .from(VERSIONS)
    .delete()
    .eq("id", target.id);
  throwIfMissingTable(error);

  const remaining = versions.filter((row) => row.version !== version);
  if (remaining.length === 0) {
    const { error: deleteError } = await getSupabase()
      .from(FILES)
      .delete()
      .eq("id", fileId)
      .eq("user_id", userId);
    throwIfMissingTable(deleteError);
    return { id: fileId, currentVersion: null };
  }

  const nextCurrent =
    file.current_version === version
      ? Math.max(...remaining.map((row) => row.version))
      : file.current_version;

  const { error: updateError } = await getSupabase()
    .from(FILES)
    .update({
      current_version: nextCurrent,
      updated_at: new Date().toISOString(),
    })
    .eq("id", fileId)
    .eq("user_id", userId);
  throwIfMissingTable(updateError);

  return { id: fileId, currentVersion: nextCurrent };
}

export async function listMentions(
  userId: string,
  q = "",
  limit = 8,
): Promise<ArtifactMentionResponse[]> {
  const capped = Math.min(20, Math.max(1, Math.floor(limit)));
  const files = await listFiles(userId);
  const needle = q.trim().replace(/^@/, "").toLowerCase();

  const mentions: ArtifactMentionResponse[] = [
    {
      token: ARTIFACT_MENTION_PREFIX,
      label: ARTIFACT_MENTION_FOLDER,
      kind: "folder",
      fileId: null,
      threadId: null,
    },
    ...files.map((file) => ({
      token: file.mentionToken,
      label: file.phase
        ? `${ARTIFACT_MENTION_FOLDER} / ${file.name} (${file.phase})`
        : `${ARTIFACT_MENTION_FOLDER} / ${file.name}`,
      kind: "file" as const,
      fileId: file.id,
      threadId: file.threadId,
    })),
  ];

  const filtered = needle
    ? mentions.filter(
        (item) =>
          item.token.toLowerCase().includes(needle) ||
          item.label.toLowerCase().includes(needle),
      )
    : mentions;

  const seen = new Set<string>();
  const unique: ArtifactMentionResponse[] = [];
  for (const item of filtered) {
    if (seen.has(item.token)) continue;
    seen.add(item.token);
    unique.push(item);
  }

  return unique.slice(0, capped);
}

function isArtifactToken(token: string): boolean {
  const lower = token.toLowerCase();
  return (
    lower === ARTIFACT_MENTION_PREFIX.toLowerCase() ||
    lower.startsWith(`${ARTIFACT_MENTION_PREFIX.toLowerCase()}/`)
  );
}

export function artifactMentionTokens(
  tokens: readonly string[],
): { artifact: string[]; other: string[] } {
  const artifact: string[] = [];
  const other: string[] = [];
  for (const token of tokens) {
    if (isArtifactToken(token)) artifact.push(token);
    else other.push(token);
  }
  return { artifact, other };
}

/**
 * Resolve `@Artifacts/name` to the latest version. Prefers the current chat
 * thread when several files share a name.
 */
export async function resolveMentions(
  userId: string,
  tokens: readonly string[],
  threadId?: string,
): Promise<MentionResolution> {
  const files: MentionResolution["files"] = [];
  const unresolved: MentionResolution["unresolved"] = [];
  if (tokens.length === 0) return { files, unresolved };

  const listed = await listFiles(userId);
  const byToken = new Map<string, ArtifactFileResponse[]>();
  for (const file of listed) {
    const key = file.mentionToken.toLowerCase();
    const group = byToken.get(key) ?? [];
    group.push(file);
    byToken.set(key, group);
  }

  const queued: { token: string; file: ArtifactFileResponse }[] = [];
  const seen = new Set<string>();

  const enqueue = (token: string, file: ArtifactFileResponse) => {
    if (seen.has(file.id)) return;
    seen.add(file.id);
    queued.push({ token, file });
  };

  const pick = (matches: ArtifactFileResponse[]): ArtifactFileResponse => {
    if (threadId) {
      const inThread = matches.find((item) => item.threadId === threadId);
      if (inThread) return inThread;
    }
    return matches[0];
  };

  for (const token of tokens) {
    const key = token.toLowerCase();
    if (key === ARTIFACT_MENTION_PREFIX.toLowerCase()) {
      const pool = threadId
        ? listed.filter((item) => item.threadId === threadId)
        : listed;
      if (pool.length === 0) {
        unresolved.push({ token, reason: "no artifacts in this thread" });
        continue;
      }
      for (const file of pool) enqueue(`${token}/${file.name}`, file);
      continue;
    }

    const matches = byToken.get(key);
    if (!matches || matches.length === 0) {
      unresolved.push({
        token,
        reason: "no such file in Artifacts",
      });
      continue;
    }
    enqueue(token, pick(matches));
  }

  let total = 0;
  for (const { token, file } of queued) {
    if (files.length >= MAX_MENTION_FILES) {
      unresolved.push({
        token,
        reason: `more than ${MAX_MENTION_FILES} files mentioned — name the files you need`,
      });
      continue;
    }
    if (file.size > MAX_MENTION_FILE_BYTES) {
      unresolved.push({
        token,
        reason: `${Math.round(file.size / 1024)} KB exceeds the ${MAX_MENTION_FILE_BYTES / 1024} KB per-file limit for chat — attach a smaller extract`,
      });
      continue;
    }
    if (total + file.size > MAX_MENTION_TOTAL_BYTES) {
      unresolved.push({ token, reason: "total mentioned size limit reached" });
      continue;
    }

    const bytes = await getArtifactBytes(userId, file.id);
    files.push({
      token,
      name: file.name,
      mimeType: file.mimeType,
      buffer: bytes.buffer,
    });
    total += file.size;
  }

  return { files, unresolved };
}
