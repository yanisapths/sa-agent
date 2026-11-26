export type WorkspaceRow = {
  id: string;
  user_id: string;
  name: string;
  path: string;
  /** NULL = the virtual Default product. Absent before products.sql runs. */
  product_id?: string | null;
  created_at: string;
};

export type WorkspaceResponse = {
  id: string;
  name: string;
  path: string;
  mentionToken: string;
  productId: string;
  createdAt: string;
};

export type WorkspaceMentionResponse = {
  token: string;
  label: string;
  kind: "folder" | "file";
  workspaceId: string;
  relativePath: string | null;
};

export type CreateWorkspaceInput = {
  name: string;
  path: string;
  productId?: string;
};

export type ResolvedMention = {
  token: string;
  name: string;
  mimeType: string;
  buffer: Buffer;
};

export type UnresolvedMention = {
  token: string;
  reason: string;
};

export type MentionResolution = {
  files: ResolvedMention[];
  unresolved: UnresolvedMention[];
};
