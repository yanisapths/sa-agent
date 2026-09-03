export type VaultFolderRow = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  created_at: string;
};

export type VaultFileRow = {
  id: string;
  folder_id: string;
  user_id: string;
  name: string;
  size: number;
  mime_type: string;
  storage_path: string;
  description: string;
  created_at: string;
};

export type VaultFileResponse = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  storagePath: string;
  createdAt: string;
};

export type VaultFolderResponse = {
  id: string;
  name: string;
  description: string;
  files: VaultFileResponse[];
};

export type VaultUploadResponse = {
  id: string;
  folderId: string;
  name: string;
  size: number;
  mimeType: string;
  storagePath: string;
  mentionToken: string;
  createdAt: string;
};

export type VaultMentionResponse = {
  token: string;
  label: string;
  kind: "folder" | "file";
  folderId: string;
  fileId: string | null;
};

/** A mention the chat route could turn into real bytes. */
export type ResolvedMention = {
  token: string;
  name: string;
  mimeType: string;
  buffer: Buffer;
};

/** A mention it could not, with the reason to show the human. */
export type UnresolvedMention = {
  token: string;
  reason: string;
};

export type MentionResolution = {
  files: ResolvedMention[];
  unresolved: UnresolvedMention[];
};

export type CreateFolderInput = {
  name: string;
  description: string;
};

export type UploadFileInput = {
  folderId: string;
  description: string;
  file: {
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  };
};
