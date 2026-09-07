import type { WorkflowColumnId, WorkflowTrack } from "./columns";

export interface WorkflowCard {
  threadId: string;
  title: string;
  phase: string | null;
  column: WorkflowColumnId;
  filename: string | null;
  artifactId: string | null;
  updatedAt: string;
  live: boolean;
  track: WorkflowTrack;
}
