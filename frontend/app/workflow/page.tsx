import { Workflow } from "@/features/workflow/Workflow";
import { type Metadata } from "next";

export const metadata: Metadata = {
  title: "Workflow",
  description: "Kanban board for the orchestrator phase loop.",
};

export default function WorkflowPage() {
  return <Workflow />;
}
