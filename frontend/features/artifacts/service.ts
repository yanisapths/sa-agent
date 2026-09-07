import { AGENT_API, VAULT_TOKEN } from "@/lib/api";
import {
  type ArtifactApiResponse,
  type ArtifactContent,
  type ArtifactFile,
  type ArtifactFileDetail,
  type ArtifactMention,
} from "./types";

async function artifactRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (VAULT_TOKEN) {
    headers.set("Authorization", `Bearer ${VAULT_TOKEN}`);
  }

  const res = await fetch(`${AGENT_API}/v1/artifacts${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  let json: ArtifactApiResponse<T>;
  try {
    json = (await res.json()) as ArtifactApiResponse<T>;
  } catch {
    throw new Error(`Artifacts request failed (${res.status})`);
  }
  if (!json.ok) {
    throw new Error(json.error || `Artifacts request failed (${res.status})`);
  }
  return json.data;
}

async function downloadRequest(
  path: string,
): Promise<Blob> {
  const headers = new Headers();
  if (VAULT_TOKEN) {
    headers.set("Authorization", `Bearer ${VAULT_TOKEN}`);
  }
  const res = await fetch(`${AGENT_API}/v1/artifacts${path}`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      // Keep the status message.
    }
    throw new Error(message);
  }
  return res.blob();
}

export function triggerBlobDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export const artifactService = {
  listFiles: async (threadId = ""): Promise<ArtifactFile[]> => {
    const query = threadId.trim()
      ? `?threadId=${encodeURIComponent(threadId.trim())}`
      : "";
    return artifactRequest<ArtifactFile[]>(`/files${query}`);
  },

  getFile: async (fileId: string): Promise<ArtifactFileDetail> => {
    return artifactRequest<ArtifactFileDetail>(`/files/${fileId}`);
  },

  getContent: async (
    fileId: string,
    version?: number,
  ): Promise<ArtifactContent> => {
    const query = version != null ? `?version=${version}` : "";
    return artifactRequest<ArtifactContent>(`/files/${fileId}/content${query}`);
  },

  downloadFile: async (fileId: string, version?: number): Promise<Blob> => {
    const query = version != null ? `?version=${version}` : "";
    return downloadRequest(`/files/${fileId}/download${query}`);
  },

  editFile: async (fileId: string, content: string): Promise<ArtifactFile> => {
    return artifactRequest<ArtifactFile>(`/files/${fileId}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    });
  },

  copyFile: async (fileId: string, name?: string): Promise<ArtifactFile> => {
    return artifactRequest<ArtifactFile>(`/files/${fileId}/copy`, {
      method: "POST",
      body: JSON.stringify(name ? { name } : {}),
    });
  },

  deleteFile: async (fileId: string): Promise<{ id: string }> => {
    return artifactRequest<{ id: string }>(`/files/${fileId}`, {
      method: "DELETE",
    });
  },

  deleteVersion: async (
    fileId: string,
    version: number,
  ): Promise<{ id: string; currentVersion: number | null }> => {
    return artifactRequest<{ id: string; currentVersion: number | null }>(
      `/files/${fileId}/versions/${version}`,
      { method: "DELETE" },
    );
  },

  listMentions: async (query = ""): Promise<ArtifactMention[]> => {
    const params = new URLSearchParams({ limit: "20" });
    if (query.trim()) params.set("q", query.trim());
    return artifactRequest<ArtifactMention[]>(`/mentions?${params.toString()}`);
  },
};
