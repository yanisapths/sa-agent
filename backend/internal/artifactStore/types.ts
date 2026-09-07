export type ArtifactSource = "phase" | "write_files" | "edit";

export type ArtifactFileRow = {
  id: string;
  user_id: string;
  thread_id: string;
  phase: string | null;
  name: string;
  current_version: number;
  created_at: string;
  updated_at: string;
};

export type ArtifactVersionRow = {
  id: string;
  file_id: string;
  version: number;
  size: number;
  mime_type: string;
  storage_path: string;
  source: ArtifactSource;
  created_at: string;
};

export type ArtifactFileResponse = {
  id: string;
  threadId: string;
  phase: string | null;
  name: string;
  currentVersion: number;
  size: number;
  mimeType: string;
  mentionToken: string;
  source: ArtifactSource;
  createdAt: string;
  updatedAt: string;
};

export type ArtifactVersionResponse = {
  id: string;
  version: number;
  size: number;
  mimeType: string;
  source: ArtifactSource;
  createdAt: string;
};

export type ArtifactFileDetailResponse = ArtifactFileResponse & {
  versions: ArtifactVersionResponse[];
};

export type ArtifactContentResponse = {
  id: string;
  name: string;
  version: number;
  mimeType: string;
  isText: boolean;
  text: string | null;
};

export type ArtifactMentionResponse = {
  token: string;
  label: string;
  kind: "folder" | "file";
  fileId: string | null;
  threadId: string | null;
};

export type SaveArtifactInput = {
  threadId: string;
  phase?: string | null;
  name: string;
  mimeType?: string;
  buffer: Buffer;
  source: ArtifactSource;
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

export type ArtifactBytes = {
  name: string;
  mimeType: string;
  buffer: Buffer;
  version: number;
};
