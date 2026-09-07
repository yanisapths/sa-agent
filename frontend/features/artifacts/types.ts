export type ArtifactSource = "phase" | "write_files" | "edit";

export interface ArtifactFile {
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
}

export interface ArtifactVersion {
  id: string;
  version: number;
  size: number;
  mimeType: string;
  source: ArtifactSource;
  createdAt: string;
}

export interface ArtifactFileDetail extends ArtifactFile {
  versions: ArtifactVersion[];
}

export interface ArtifactContent {
  id: string;
  name: string;
  version: number;
  mimeType: string;
  isText: boolean;
  text: string | null;
}

export interface ArtifactMention {
  token: string;
  label: string;
  kind: "folder" | "file";
  fileId: string | null;
  threadId: string | null;
}

export interface ChatArtifact {
  id: string;
  name: string;
  currentVersion?: number;
  version?: number;
  mimeType: string;
  mentionToken: string;
}

type ArtifactOk<T> = { ok: true; data: T };
type ArtifactErr = { ok: false; error: string };
export type ArtifactApiResponse<T> = ArtifactOk<T> | ArtifactErr;
