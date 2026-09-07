import path from "node:path";
import { z } from "zod";
import { getSupabase } from "../../database/supabase";
import { HttpError, throwIfError } from "../httpError";
import {
  formatTree,
  mimeTypeOf,
  readWorkspaceFile,
  searchWorkspaceFiles,
} from "./fs";
import { assertWorkspaceRoot, WorkspacePathError } from "./paths";
import type {
  CreateWorkspaceInput,
  MentionResolution,
  ResolvedMention,
  UnresolvedMention,
  WorkspaceMentionResponse,
  WorkspaceResponse,
  WorkspaceRow,
} from "./types";

const TABLE = "workspaces";

export const WORKSPACE_MENTION_FOLDER = "Projects";
export const WORKSPACE_MENTION_PREFIX = `@${WORKSPACE_MENTION_FOLDER}`;

const MAX_MENTION_FILES = 5;
const MAX_MENTION_FILE_BYTES = 1024 * 1024;
const MAX_MENTION_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_TREE_CHARS = 8 * 1024;

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  path: z.string().trim().min(1).max(1024),
});

function newId(): string {
  return `wks_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function toMentionToken(workspaceName: string, relativePath?: string): string {
  const name = workspaceName.trim().replace(/\s+/g, "-");
  if (!relativePath) return `${WORKSPACE_MENTION_PREFIX}/${name}`;
  const rel = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  return `${WORKSPACE_MENTION_PREFIX}/${name}/${rel}`;
}

export function isWorkspaceToken(token: string): boolean {
  const lower = token.toLowerCase();
  return (
    lower === WORKSPACE_MENTION_PREFIX.toLowerCase() ||
    lower.startsWith(`${WORKSPACE_MENTION_PREFIX.toLowerCase()}/`)
  );
}

export function workspaceMentionTokens(
  tokens: readonly string[],
): { workspace: string[]; other: string[] } {
  const workspace: string[] = [];
  const other: string[] = [];
  for (const token of tokens) {
    if (isWorkspaceToken(token)) workspace.push(token);
    else other.push(token);
  }
  return { workspace, other };
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
      "Workspace tables are missing. Run backend/sql/workspaces.sql in the Supabase SQL editor.",
    );
  }
  throwIfError(error);
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

function toResponse(row: WorkspaceRow): WorkspaceResponse {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    mentionToken: toMentionToken(row.name),
    createdAt: row.created_at,
  };
}

function wrapPathError(err: unknown): never {
  if (err instanceof WorkspacePathError) {
    throw new HttpError(400, err.message);
  }
  throw err;
}

export function parseCreateWorkspaceInput(body: unknown): CreateWorkspaceInput {
  const parsed = createSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new HttpError(400, "Invalid project payload. Provide a name and an absolute path.");
  }
  return parsed.data;
}

export async function listWorkspaces(userId: string): Promise<WorkspaceResponse[]> {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  throwIfMissingTable(error);
  return ((data ?? []) as WorkspaceRow[]).map(toResponse);
}

export async function getWorkspace(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceResponse> {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select("*")
    .eq("id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  throwIfMissingTable(error);
  if (!data) throw new HttpError(404, "Project folder not found");
  return toResponse(data as WorkspaceRow);
}

/**
 * Re-check the stored path still exists and is allowed on this machine.
 * Chat uses this so a stale row cannot point the agent at a missing folder.
 */
export function liveWorkspaceRoot(storedPath: string): string {
  try {
    return assertWorkspaceRoot(storedPath);
  } catch (err) {
    wrapPathError(err);
  }
}

export async function createWorkspace(
  userId: string,
  input: CreateWorkspaceInput,
): Promise<WorkspaceResponse> {
  let resolved: string;
  try {
    resolved = assertWorkspaceRoot(input.path);
  } catch (err) {
    wrapPathError(err);
  }

  const row: WorkspaceRow = {
    id: newId(),
    user_id: userId,
    name: input.name,
    path: resolved,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await getSupabase()
    .from(TABLE)
    .insert(row)
    .select("*")
    .single();

  if (isUniqueViolation(error)) {
    throw new HttpError(409, "A project with that name already exists");
  }
  throwIfMissingTable(error);
  return toResponse(data as WorkspaceRow);
}

export async function deleteWorkspace(
  userId: string,
  workspaceId: string,
): Promise<{ id: string }> {
  const existing = await getWorkspace(userId, workspaceId);
  const { error } = await getSupabase()
    .from(TABLE)
    .delete()
    .eq("id", existing.id)
    .eq("user_id", userId);

  throwIfMissingTable(error);
  return { id: existing.id };
}

function parseWorkspaceToken(token: string): {
  name: string | null;
  relativePath: string | null;
} {
  const prefix = `${WORKSPACE_MENTION_PREFIX}/`;
  if (token.toLowerCase() === WORKSPACE_MENTION_PREFIX.toLowerCase()) {
    return { name: null, relativePath: null };
  }
  if (!token.toLowerCase().startsWith(prefix.toLowerCase())) {
    return { name: null, relativePath: null };
  }
  const rest = token.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash === -1) return { name: rest, relativePath: null };
  return { name: rest.slice(0, slash), relativePath: rest.slice(slash + 1) };
}

export async function resolveMentions(
  userId: string,
  tokens: readonly string[],
): Promise<MentionResolution> {
  const files: ResolvedMention[] = [];
  const unresolved: UnresolvedMention[] = [];
  if (tokens.length === 0) return { files, unresolved };

  const workspaces = await listWorkspaces(userId);
  const byName = new Map(workspaces.map((ws) => [ws.name.toLowerCase(), ws]));

  let total = 0;
  const seen = new Set<string>();

  const pushFile = (
    token: string,
    name: string,
    mimeType: string,
    buffer: Buffer,
  ) => {
    files.push({ token, name, mimeType, buffer });
    total += buffer.length;
  };

  for (const token of tokens) {
    const parsed = parseWorkspaceToken(token);
    if (token.toLowerCase() === WORKSPACE_MENTION_PREFIX.toLowerCase()) {
      if (workspaces.length === 0) {
        unresolved.push({ token, reason: "no project folders registered" });
        continue;
      }
      const listing = workspaces
        .map((ws) => `- ${ws.name} (${ws.path})`)
        .join("\n");
      const buffer = Buffer.from(
        `Registered project folders:\n${listing}\n`,
        "utf-8",
      );
      if (files.length >= MAX_MENTION_FILES) {
        unresolved.push({
          token,
          reason: `more than ${MAX_MENTION_FILES} files mentioned — name the files you need`,
        });
        continue;
      }
      pushFile(token, "projects.txt", "text/plain", buffer);
      continue;
    }

    if (!parsed.name) {
      unresolved.push({ token, reason: "not a project mention" });
      continue;
    }

    const ws = byName.get(parsed.name.toLowerCase());
    if (!ws) {
      unresolved.push({ token, reason: "no such project folder" });
      continue;
    }

    let root: string;
    try {
      root = liveWorkspaceRoot(ws.path);
    } catch (err) {
      const reason = err instanceof HttpError ? err.message : "folder is not readable";
      unresolved.push({ token, reason });
      continue;
    }

    if (!parsed.relativePath) {
      if (seen.has(ws.id)) continue;
      seen.add(ws.id);
      let tree: string;
      try {
        tree = formatTree(root, ".", 2);
      } catch (err) {
        const reason =
          err instanceof WorkspacePathError ? err.message : "could not list the folder";
        unresolved.push({ token, reason });
        continue;
      }
      if (tree.length > MAX_TREE_CHARS) {
        tree = `${tree.slice(0, MAX_TREE_CHARS)}\n… truncated`;
      }
      const buffer = Buffer.from(
        `Project ${ws.name} at ${root}\n\n${tree}\n`,
        "utf-8",
      );
      if (files.length >= MAX_MENTION_FILES) {
        unresolved.push({
          token,
          reason: `more than ${MAX_MENTION_FILES} files mentioned — name the files you need`,
        });
        continue;
      }
      if (buffer.length > MAX_MENTION_FILE_BYTES) {
        unresolved.push({ token, reason: "project tree exceeds the per-file chat limit" });
        continue;
      }
      if (total + buffer.length > MAX_MENTION_TOTAL_BYTES) {
        unresolved.push({ token, reason: "total mentioned size limit reached" });
        continue;
      }
      pushFile(token, `${ws.name}/tree.txt`, "text/plain", buffer);
      continue;
    }

    const key = `${ws.id}:${parsed.relativePath}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (files.length >= MAX_MENTION_FILES) {
      unresolved.push({
        token,
        reason: `more than ${MAX_MENTION_FILES} files mentioned — name the files you need`,
      });
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = readWorkspaceFile(root, parsed.relativePath);
    } catch (err) {
      const reason =
        err instanceof WorkspacePathError ? err.message : "could not read the file";
      unresolved.push({ token, reason });
      continue;
    }

    if (buffer.length > MAX_MENTION_FILE_BYTES) {
      unresolved.push({
        token,
        reason: `${Math.round(buffer.length / 1024)} KB exceeds the ${MAX_MENTION_FILE_BYTES / 1024} KB per-file limit for chat — mention a smaller file`,
      });
      continue;
    }
    if (total + buffer.length > MAX_MENTION_TOTAL_BYTES) {
      unresolved.push({ token, reason: "total mentioned size limit reached" });
      continue;
    }

    const name = path.posix.basename(parsed.relativePath.replaceAll("\\", "/"));
    pushFile(token, name, mimeTypeOf(name), buffer);
  }

  return { files, unresolved };
}

export async function listMentions(
  userId: string,
  q = "",
  limit = 20,
): Promise<WorkspaceMentionResponse[]> {
  const capped = Math.min(20, Math.max(1, Math.floor(limit)));
  const workspaces = await listWorkspaces(userId);
  const needle = q.trim().replace(/^@/, "");
  const lower = needle.toLowerCase();

  const results: WorkspaceMentionResponse[] = [];

  const prefix = `${WORKSPACE_MENTION_FOLDER}/`.toLowerCase();
  let workspaceFilter: string | undefined;
  let fileQuery = needle;
  if (lower === WORKSPACE_MENTION_FOLDER.toLowerCase()) {
    fileQuery = "";
  } else if (lower.startsWith(prefix)) {
    const rest = needle.slice(WORKSPACE_MENTION_FOLDER.length + 1);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      workspaceFilter = rest.toLowerCase();
      fileQuery = "";
    } else {
      workspaceFilter = rest.slice(0, slash).toLowerCase();
      fileQuery = rest.slice(slash + 1);
    }
  }

  for (const ws of workspaces) {
    if (results.length >= capped) break;
    const nameLower = ws.name.toLowerCase();
    const matchesName =
      !lower ||
      nameLower.includes(lower) ||
      toMentionToken(ws.name).toLowerCase().includes(lower) ||
      (workspaceFilter !== undefined && nameLower.includes(workspaceFilter));

    if (matchesName && !fileQuery) {
      results.push({
        token: toMentionToken(ws.name),
        label: ws.name,
        kind: "folder",
        workspaceId: ws.id,
        relativePath: null,
      });
    }

    const shouldSearchFiles =
      Boolean(fileQuery) ||
      (workspaceFilter !== undefined && nameLower === workspaceFilter);
    if (!shouldSearchFiles) continue;

    let root: string;
    try {
      root = liveWorkspaceRoot(ws.path);
    } catch {
      continue;
    }

    const remaining = capped - results.length;
    if (remaining <= 0) break;
    const search = fileQuery || workspaceFilter || "";
    let files: string[];
    try {
      files = searchWorkspaceFiles(root, search, remaining);
    } catch {
      continue;
    }
    for (const rel of files) {
      if (results.length >= capped) break;
      results.push({
        token: toMentionToken(ws.name, rel),
        label: `${ws.name} / ${rel}`,
        kind: "file",
        workspaceId: ws.id,
        relativePath: rel,
      });
    }
  }

  return results;
}
