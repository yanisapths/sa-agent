export type WorkflowColumnId = "building" | "validating" | "review" | "ready";
export type WorkflowTrack = "sa" | "pvt";

export const WORKFLOW_COLUMNS = [
  { id: "building", label: "Building", dotClass: "bg-sky-500" },
  { id: "validating", label: "Validating", dotClass: "bg-amber-400" },
  { id: "review", label: "In review", dotClass: "bg-orange-500" },
  { id: "ready", label: "Ready", dotClass: "bg-emerald-500" },
] as const satisfies readonly {
  id: WorkflowColumnId;
  label: string;
  dotClass: string;
}[];

export type WorkflowColumn = (typeof WORKFLOW_COLUMNS)[number];

const SA_PHASES = new Set(["discuss", "plan", "execute", "test", "review", "ship"]);
const PVT_PHASES = new Set(["pvt-discuss", "pvt-plan", "pvt-execute"]);

export const PHASE_FROM_NAME: Record<string, string> = {
  "discuss.md": "discuss",
  "plan.md": "plan",
  "execute.md": "execute",
  "test.md": "test",
  "review.md": "review",
  "pvt-discuss.md": "pvt-discuss",
  "pvt-plan.md": "pvt-plan",
  "pvt-execute.md": "pvt-execute",
  "pvt-cases.csv": "pvt-discuss",
  "pvt-cases.json": "pvt-discuss",
  "context.md": "discuss",
};

export const PHASE_LABELS: Record<string, string> = {
  discuss: "Discuss",
  plan: "Plan",
  execute: "Execute",
  test: "Test",
  review: "Review",
  ship: "Ship",
  "pvt-discuss": "PVT Discuss",
  "pvt-plan": "PVT Plan",
  "pvt-execute": "PVT Execute",
};

export function phaseOf(file: { phase: string | null; name: string }): string | null {
  if (file.phase && file.phase.trim()) return file.phase.trim();
  return PHASE_FROM_NAME[file.name] ?? null;
}

export function phaseLabel(phase: string | null): string {
  if (!phase) return "Chat";
  return PHASE_LABELS[phase] ?? phase;
}

export function trackOf(phase: string | null): WorkflowTrack | null {
  if (!phase) return null;
  if (PVT_PHASES.has(phase)) return "pvt";
  if (SA_PHASES.has(phase)) return "sa";
  return null;
}

export function columnForPhase(
  phase: string | null,
  live: boolean,
): WorkflowColumnId {
  if (!phase) return "building";
  if (phase === "ship") return "ready";
  if (phase === "review") return live ? "review" : "ready";
  if (phase === "test") return "validating";
  if (phase === "pvt-execute") return live ? "validating" : "ready";
  return "building";
}
