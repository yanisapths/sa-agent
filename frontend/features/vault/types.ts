export interface VaultFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  storagePath?: string;
  createdAt?: string;
}

export interface VaultFolder {
  id: string;
  name: string;
  description: string;
  files: VaultFile[];
}

export interface VaultMention {
  token: string;
  label: string;
  kind: "folder" | "file";
  folderId: string;
  fileId: string | null;
}

export interface CreateFolderInput {
  name: string;
  description: string;
}

export interface VaultUploadFile extends VaultFile {
  folderId: string;
  mentionToken: string;
}

type VaultOk<T> = { ok: true; data: T };
type VaultErr = { ok: false; error: string };
export type VaultApiResponse<T> = VaultOk<T> | VaultErr;
