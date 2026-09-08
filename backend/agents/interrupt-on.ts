/**
 * Tools that pause for human review before they run. Read-only grounding
 * tools are omitted so a docs search does not become a click.
 *
 * `task` is the phase specialist — that is the M8 gate.
 */
const DECISIONS: Array<"approve" | "edit" | "reject"> = [
  "approve",
  "edit",
  "reject",
];

export const AGENT_INTERRUPT_ON: Record<
  string,
  boolean | { allowedDecisions: Array<"approve" | "edit" | "reject"> }
> = {
  task: { allowedDecisions: DECISIONS },
  write_files: { allowedDecisions: DECISIONS },
  workspace_write: { allowedDecisions: DECISIONS },
  record_decision: { allowedDecisions: DECISIONS },
  build_system_model: { allowedDecisions: DECISIONS },
  write_file: { allowedDecisions: DECISIONS },
  edit_file: { allowedDecisions: DECISIONS },
};
