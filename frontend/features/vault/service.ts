import { AGENT_API, VAULT_TOKEN } from "@/lib/api";
import {
  type CreateFolderInput,
  type VaultApiResponse,
  type VaultFile,
  type VaultFolder,
  type VaultMention,
  type VaultUploadFile,
} from "./types";

async function vaultRequest<T>(
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

  const res = await fetch(`${AGENT_API}/v1/vault${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  let json: VaultApiResponse<T>;
  try {
    json = (await res.json()) as VaultApiResponse<T>;
  } catch {
    throw new Error(`Vault request failed (${res.status})`);
  }
  if (!json.ok) {
    throw new Error(json.error || `Vault request failed (${res.status})`);
  }
  return json.data;
}

export const vaultService = {
  listFolders: async (q = ""): Promise<VaultFolder[]> => {
    const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
    return vaultRequest<VaultFolder[]>(`/folders${query}`);
  },

  createFolder: async (input: CreateFolderInput): Promise<VaultFolder> => {
    return vaultRequest<VaultFolder>("/folders", {
      method: "POST",
      body: JSON.stringify({
        name: input.name.trim(),
        description: input.description.trim(),
      }),
    });
  },

  deleteFolder: async (folderId: string): Promise<{ id: string }> => {
    return vaultRequest<{ id: string }>(`/folders/${folderId}`, {
      method: "DELETE",
    });
  },

  uploadFile: async (folderId: string, file: File): Promise<VaultFile> => {
    const form = new FormData();
    form.append("folderId", folderId);
    form.append("file", file);
    const uploaded = await vaultRequest<VaultUploadFile>("/files", {
      method: "POST",
      body: form,
    });
    return {
      id: uploaded.id,
      name: uploaded.name,
      size: uploaded.size,
      mimeType: uploaded.mimeType,
      storagePath: uploaded.storagePath,
      createdAt: uploaded.createdAt,
    };
  },

  deleteFile: async (fileId: string): Promise<{ id: string }> => {
    return vaultRequest<{ id: string }>(`/files/${fileId}`, {
      method: "DELETE",
    });
  },

  listMentions: async (query = ""): Promise<VaultMention[]> => {
    const params = new URLSearchParams({ limit: "20" });
    if (query.trim()) params.set("q", query.trim());
    return vaultRequest<VaultMention[]>(`/mentions?${params.toString()}`);
  },
};
