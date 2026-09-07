import path from "node:path";
import { ARTIFACT } from "../../agents/harness";
import { saveArtifact } from "./service";
import type { ArtifactFileResponse } from "./types";

const ARTIFACT_PREFIX = "/artifacts/";

const PHASE_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.values(ARTIFACT).map((virtualPath) => {
    const name = path.posix.basename(virtualPath);
    const stem = name.replace(/\.(md|csv|json)$/i, "");
    return [name, stem];
  }),
);

export interface VirtualArtifactFile {
  name: string;
  content: string;
}

/**
 * Pull `/artifacts/*` out of Deep Agent StateBackend after a turn.
 * Content is stored as line arrays on FileData.
 */
export function filesFromAgentState(
  result: unknown,
  sinceMs?: number,
): VirtualArtifactFile[] {
  const files = (result as { files?: Record<string, unknown> })?.files;
  if (!files || typeof files !== "object") return [];

  const out: VirtualArtifactFile[] = [];
  for (const [virtualPath, data] of Object.entries(files)) {
    if (!virtualPath.startsWith(ARTIFACT_PREFIX)) continue;
    const name = virtualPath.slice(ARTIFACT_PREFIX.length);
    if (!name || name.includes("/")) continue;

    if (
      sinceMs != null &&
      data &&
      typeof data === "object" &&
      "modified_at" in data
    ) {
      const modified = Date.parse(
        String((data as { modified_at: unknown }).modified_at),
      );
      if (Number.isFinite(modified) && modified < sinceMs - 2000) continue;
    }

    let content = "";
    if (typeof data === "string") {
      content = data;
    } else if (data && typeof data === "object" && "content" in data) {
      const raw = (data as { content: unknown }).content;
      content = Array.isArray(raw) ? raw.join("\n") : String(raw ?? "");
    }
    if (!content.trim()) continue;
    out.push({ name, content });
  }
  return out;
}

export async function persistPhaseArtifacts(
  userId: string,
  threadId: string,
  phase: string | undefined,
  result: unknown,
  sinceMs?: number,
): Promise<ArtifactFileResponse[]> {
  const virtual = filesFromAgentState(result, sinceMs);
  if (virtual.length === 0) return [];

  const saved: ArtifactFileResponse[] = [];
  for (const file of virtual) {
    saved.push(
      await saveArtifact(userId, {
        threadId,
        phase: phase ?? PHASE_BY_NAME[file.name] ?? null,
        name: file.name,
        buffer: Buffer.from(file.content, "utf-8"),
        source: "phase",
      }),
    );
  }
  return saved;
}

export function uniqueArtifacts(
  ...lists: ArtifactFileResponse[][]
): ArtifactFileResponse[] {
  const seen = new Set<string>();
  const out: ArtifactFileResponse[] = [];
  for (const list of lists) {
    for (const file of list) {
      const key = `${file.id}:${file.currentVersion}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(file);
    }
  }
  return out;
}
