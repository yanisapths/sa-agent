"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  type ActionRequest,
  type HitlDecision,
  type InterruptPayload,
  type ThoughtStep,
} from "@/lib/chat-stream";
import { isModelTrace, TokenIcon, TraceIcon } from "@/components/trace-icon";

const STATUS_LABEL: Record<ThoughtStep["status"], string> = {
  queued: "Queued",
  running: "Running",
  waiting: "Waiting",
  error: "Error",
  retried: "Retried",
  completed: "Done",
};

function statusClass(status: ThoughtStep["status"]): string {
  if (status === "completed") return "text-emerald-600";
  if (status === "error") return "text-red-600";
  if (status === "waiting") return "text-amber-600";
  if (status === "running") return "text-sky-600";
  return "text-muted";
}

function groupLabel(name: string, ns: string[]): string {
  return isModelTrace(name, ns) ? "model_request" : "tools";
}

function leafLabel(name: string, ns: string[]): string {
  if (isModelTrace(name, ns) && /model_request/i.test(name))
    return "ChatOpenAI";
  return name;
}

export function ThoughtPanel({
  steps,
  interrupt,
  open,
  waiting,
  onDecide,
}: {
  steps: ThoughtStep[];
  interrupt?: InterruptPayload;
  open: boolean;
  waiting: boolean;
  onDecide?: (decisions: HitlDecision[]) => void;
}) {
  const [expanded, setExpanded] = useState(open);
  const [prevOpen, setPrevOpen] = useState(open);
  const [edits, setEdits] = useState<Record<number, string>>({});
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setExpanded(true);
  }
  const actions = interrupt?.actionRequests ?? [];
  const evidence = steps.filter((step) => step.evidence);

  const editMap = useMemo(() => {
    const next: Record<number, string> = { ...edits };
    actions.forEach((action, index) => {
      if (next[index] == null) {
        next[index] = JSON.stringify(action.args, null, 2);
      }
    });
    return next;
  }, [actions, edits]);

  if (steps.length === 0 && actions.length === 0) return null;

  const decide = (type: "approve" | "reject") => {
    if (!onDecide) return;
    if (type === "reject") {
      onDecide(
        actions.map(() => ({
          type: "reject",
          message:
            "User rejected this action. Do not retry the same tool call.",
        })),
      );
      return;
    }
    onDecide(
      actions.map((action, index) => {
        if (!action.allowedDecisions.includes("edit")) {
          return { type: "approve" as const };
        }
        try {
          const args = JSON.parse(editMap[index] ?? "{}") as Record<
            string,
            unknown
          >;
          const same = JSON.stringify(args) === JSON.stringify(action.args);
          if (same) return { type: "approve" as const };
          return {
            type: "edit" as const,
            editedAction: { name: action.name, args },
          };
        } catch {
          return { type: "approve" as const };
        }
      }),
    );
  };

  return (
    <div className="w-full rounded-xl border border-border bg-muted/10 text-left">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted hover:text-foreground"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <TraceIcon kind="chain" className="h-4 w-4 rounded" />
        <span className="font-medium">Thought</span>
        <span className="text-muted">
          {waiting
            ? "Waiting for approval"
            : `${steps.filter((s) => s.status === "completed").length}/${Math.max(steps.length, actions.length)} steps`}
        </span>
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          {actions.length > 0 && (
            <section>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Plan
              </h4>
              <div className="space-y-2">
                {actions.map((action, index) => (
                  <ActionCard
                    key={`${action.name}:${index}`}
                    action={action}
                    value={editMap[index] ?? ""}
                    onChange={(value) =>
                      setEdits((prev) => ({ ...prev, [index]: value }))
                    }
                    disabled={!waiting}
                  />
                ))}
              </div>
              {waiting && onDecide && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => decide("approve")}>
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => decide("reject")}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </section>
          )}

          {steps.length > 0 && (
            <section>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Execution
              </h4>
              <ol className="space-y-2">
                {steps.map((step) => {
                  const model = isModelTrace(step.name, step.ns);
                  return (
                    <li key={step.id} className="text-xs">
                      <div className="flex items-center gap-2 text-muted">
                        <TraceIcon kind="chain" />
                        <span>{groupLabel(step.name, step.ns)}</span>
                      </div>
                      <div className="ml-2.5 flex items-center justify-between gap-2 border-l border-border py-1 pl-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <TraceIcon kind={model ? "model" : "tool"} />
                          <span className="truncate font-mono text-foreground">
                            {leafLabel(step.name, step.ns)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "flex shrink-0 items-center gap-1",
                            statusClass(step.status),
                          )}
                        >
                          {step.costHint ? <TokenIcon /> : null}
                          {STATUS_LABEL[step.status]}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {evidence.length > 0 && (
            <section>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Evidence
              </h4>
              <ul className="space-y-2">
                {evidence.map((step) => (
                  <li
                    key={`ev-${step.id}`}
                    className="rounded-lg border border-border bg-background p-2"
                  >
                    <p className="mb-1 flex items-center gap-2 font-mono text-[11px] text-muted">
                      <TraceIcon
                        kind={
                          isModelTrace(step.name, step.ns) ? "model" : "tool"
                        }
                      />
                      {step.name}
                    </p>
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-foreground">
                      {step.evidence}
                    </pre>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function ActionCard({
  action,
  value,
  onChange,
  disabled,
}: {
  action: ActionRequest;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const canEdit = action.allowedDecisions.includes("edit") && !disabled;
  return (
    <div className="rounded-lg border border-border bg-background p-2">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-mono text-xs font-medium">
          <TraceIcon kind={isModelTrace(action.name) ? "model" : "tool"} />
          {action.name}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-muted">
          <TokenIcon />
          {action.costHint}
        </span>
      </div>
      <p className="mb-1 text-[11px] text-muted">
        {action.scope}
        {action.permission === "interrupt" ? " · needs approval" : ""}
      </p>
      {canEdit ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-24 w-full resize-y rounded-md border border-border bg-transparent p-2 font-mono text-[11px]"
        />
      ) : (
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
          {JSON.stringify(action.args, null, 2)}
        </pre>
      )}
    </div>
  );
}
