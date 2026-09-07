import { AGENT_API, VAULT_TOKEN } from "@/lib/api";
import {
  type CreateWorkspaceInput,
  type PickFolderResult,
  type Workspace,
  type WorkspaceApiResponse,
  type WorkspaceMention,
} from "./types";

async function workspaceRequest<T>(
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

  const res = await fetch(`${AGENT_API}/v1/workspaces${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  let json: WorkspaceApiResponse<T>;
  try {
    json = (await res.json()) as WorkspaceApiResponse<T>;
  } catch {
    throw new Error(`Workspace request failed (${res.status})`);
  }
  if (!json.ok) {
    throw new Error(json.error || `Workspace request failed (${res.status})`);
  }
  return json.data;
}

export const workspaceService = {
  list: async (): Promise<Workspace[]> => {
    return workspaceRequest<Workspace[]>("/");
  },

  create: async (input: CreateWorkspaceInput): Promise<Workspace> => {
    return workspaceRequest<Workspace>("/", {
      method: "POST",
      body: JSON.stringify({
        name: input.name.trim(),
        path: input.path.trim(),
      }),
    });
  },

  delete: async (workspaceId: string): Promise<{ id: string }> => {
    return workspaceRequest<{ id: string }>(`/${workspaceId}`, {
      method: "DELETE",
    });
  },

  listMentions: async (query = ""): Promise<WorkspaceMention[]> => {
    const params = new URLSearchParams({ limit: "20" });
    if (query.trim()) params.set("q", query.trim());
    return workspaceRequest<WorkspaceMention[]>(`/mentions?${params.toString()}`);
  },

  /** Opens Finder on the backend machine. `path` is null if the human cancelled. */
  pickFolder: async (): Promise<PickFolderResult> => {
    return workspaceRequest<PickFolderResult>("/pick", { method: "POST" });
  },
};
