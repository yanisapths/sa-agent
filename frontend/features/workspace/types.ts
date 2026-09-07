export interface Workspace {
  id: string;
  name: string;
  path: string;
  mentionToken: string;
  createdAt: string;
}

export interface WorkspaceMention {
  token: string;
  label: string;
  kind: "folder" | "file";
  workspaceId: string;
  relativePath: string | null;
}

export interface CreateWorkspaceInput {
  name: string;
  path: string;
}

export interface PickFolderResult {
  path: string | null;
}

type WorkspaceOk<T> = { ok: true; data: T };
type WorkspaceErr = { ok: false; error: string };
export type WorkspaceApiResponse<T> = WorkspaceOk<T> | WorkspaceErr;
