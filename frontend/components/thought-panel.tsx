"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Folder,
  Globe,
  Search,
  Sparkles,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  type ActionRequest,
  type HitlDecision,
  type InterruptPayload,
  type ThoughtStep,
} from "@/lib/chat-stream";
import { isModelTrace, TokenIcon } from "@/components/trace-icon";

type VerbSet = { live: string; done: string; allow: string };

const VERBS: Record<string, VerbSet> = {
  search_docs: {
    live: "Searching docs",
    done: "Searched docs",
    allow: "searching docs",
  },
  get_doc_page: {
    live: "Reading docs",
    done: "Read docs",
    allow: "reading docs",
  },
  search_schema_docs: {
    live: "Searching schema docs",
    done: "Searched schema docs",
    allow: "searching schema docs",
  },
  list_tables: {
    live: "Listing tables",
    done: "Listed tables",
    allow: "listing tables",
  },
  describe_tables: {
    live: "Describing tables",
    done: "Described tables",
    allow: "describing tables",
  },
  inspect_relationships: {
    live: "Inspecting relationships",
    done: "Inspected relationships",
    allow: "inspecting relationships",
  },
  run_sql: {
    live: "Querying schema",
    done: "Queried schema",
    allow: "querying",
  },
  get_present_datetime: {
    live: "Checking the time",
    done: "Checked the time",
    allow: "checking the time",
  },
  web_search: {
    live: "Searching the web",
    done: "Searched the web",
    allow: "searching the web",
  },
  get_jira_ticket: {
    live: "Loading a Jira ticket",
    done: "Loaded a Jira ticket",
    allow: "loading a Jira ticket",
  },
  read_jira_user_story: {
    live: "Reading a user story",
    done: "Read a user story",
    allow: "reading a user story",
  },
  search_jira: {
    live: "Searching Jira",
    done: "Searched Jira",
    allow: "searching Jira",
  },
  sandbox_exec: {
    live: "Running in sandbox",
    done: "Ran in sandbox",
    allow: "running in sandbox",
  },
  build_system_model: {
    live: "Building the system model",
    done: "Built the system model",
    allow: "building the system model",
  },
  query_system_model: {
    live: "Querying the system model",
    done: "Queried the system model",
    allow: "querying the system model",
  },
  simulate_impact: {
    live: "Simulating impact",
    done: "Simulated impact",
    allow: "simulating impact",
  },
  record_decision: {
    live: "Recording a decision",
    done: "Recorded a decision",
    allow: "recording a decision",
  },
  search_decisions: {
    live: "Searching decisions",
    done: "Searched decisions",
    allow: "searching decisions",
  },
  write_files: {
    live: "Writing files",
    done: "Wrote files",
    allow: "writing files",
  },
  workspace_ls: {
    live: "Listing workspace files",
    done: "Listed workspace files",
    allow: "listing workspace files",
  },
  workspace_read: {
    live: "Reading workspace",
    done: "Read workspace",
    allow: "reading workspace",
  },
  workspace_grep: {
    live: "Searching workspace",
    done: "Searched workspace",
    allow: "searching workspace",
  },
  workspace_write: {
    live: "Writing to workspace",
    done: "Wrote to workspace",
    allow: "writing to workspace",
  },
};

function clip(value: string, max: number): string {
  const text = value.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function sentenceCase(name: string): string {
  const words = name.replace(/_/g, " ").trim();
  if (!words) return name;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function specialistLabel(args: Record<string, unknown>): string {
  const owner = String(args.subagent_type ?? args.owner ?? "specialist");
  return owner.replace(/^pvt-/, "PVT ").replace(/-/g, " ");
}

function argPhrase(args: Record<string, unknown>): string {
  if (typeof args.query === "string" && args.query.trim()) {
    return `for “${clip(args.query, 48)}”`;
  }
  const path = args.path ?? args.paths ?? args.target ?? args.filename;
  if (typeof path === "string" && path.trim()) return clip(path, 56);
  if (Array.isArray(path) && path.length > 0) {
    return clip(path.map(String).join(", "), 56);
  }
  if (typeof args.sql === "string" && args.sql.trim())
    return clip(args.sql, 72);
  if (typeof args.description === "string" && args.description.trim()) {
    return clip(args.description, 72);
  }
  return "";
}

function verbsFor(name: string, args: Record<string, unknown>): VerbSet {
  if (name === "task") {
    const specialist = specialistLabel(args);
    return {
      live: `Asking ${specialist}`,
      done: `Asked ${specialist}`,
      allow: `asking ${specialist}`,
    };
  }
  return (
    VERBS[name] ?? {
      live: sentenceCase(name),
      done: sentenceCase(name),
      allow: sentenceCase(name).toLowerCase(),
    }
  );
}

function titled(label: string, phrase: string): string {
  return phrase ? `${label} ${phrase}` : label;
}

function evidenceChips(text: string): { href: string; label: string }[] {
  const urls = text.match(/https?:\/\/[^\s)>\]]+/gi) ?? [];
  const seen = new Set<string>();
  const chips: { href: string; label: string }[] = [];
  for (const href of urls) {
    try {
      const host = new URL(href).hostname.replace(/^www\./, "");
      if (!host || seen.has(host)) continue;
      seen.add(host);
      chips.push({ href, label: host });
    } catch {
      continue;
    }
  }
  return chips;
}

function evidenceProse(text: string, chips: { href: string }[]): string {
  let next = text;
  for (const chip of chips) next = next.split(chip.href).join(" ");
  return next.replace(/\s+/g, " ").trim();
}

function StepGlyph({ name, ns }: { name: string; ns: string[] }) {
  const className = "h-3.5 w-3.5 shrink-0 text-muted";
  if (isModelTrace(name, ns)) return <Sparkles className={className} />;
  if (/web_search/.test(name)) return <Globe className={className} />;
  if (/search_/.test(name)) return <Search className={className} />;
  if (/sql|tables|relationships/.test(name))
    return <Database className={className} />;
  if (/workspace|write_files/.test(name))
    return <Folder className={className} />;
  return <Wrench className={className} />;
}

export function ThoughtPanel({
  steps,
  open,
  waiting,
  startedAt,
  endedAt,
}: {
  steps: ThoughtStep[];
  open: boolean;
  waiting: boolean;
  startedAt?: number;
  endedAt?: number;
}) {
  const [expanded, setExpanded] = useState(open);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    setExpanded(open);
  }
  const doneLabel =
    !open && startedAt != null && endedAt != null
      ? `Thought for ${Math.max(1, Math.round((endedAt - startedAt) / 1000))}s`
      : null;

  const visible = steps.filter(
    (step) => !isModelTrace(step.name, step.ns) || Boolean(step.evidence),
  );

  if (steps.length === 0) return null;
  if (visible.length === 0 && !open) return null;

  const active = [...steps]
    .reverse()
    .find(
      (step) =>
        step.status === "running" ||
        step.status === "waiting" ||
        step.status === "queued",
    );
  const live = active
    ? titled(verbsFor(active.name, active.args).live, argPhrase(active.args))
    : "Thinking";
  const header = waiting
    ? "Waiting for your OK"
    : open
      ? `${live}…`
      : (doneLabel ?? "Thought");

  return (
    <div className="w-full text-left">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 py-0.5 text-sm text-muted hover:text-foreground"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <Sparkles className="h-3.5 w-3.5" />
        <span className="truncate font-medium">{header}</span>
      </button>
      {expanded && visible.length > 0 && (
        <ol className="ml-2 mt-2 space-y-2.5 border-l border-border pl-4">
          {visible.map((step) => (
            <ThoughtStepRow key={step.id} step={step} />
          ))}
        </ol>
      )}
    </div>
  );
}

function ThoughtStepRow({ step }: { step: ThoughtStep }) {
  const model = isModelTrace(step.name, step.ns);
  const chips = step.evidence ? evidenceChips(step.evidence) : [];
  const prose = step.evidence ? evidenceProse(step.evidence, chips) : "";
  const label = model
    ? clip(prose || "Reasoning", 280)
    : titled(verbsFor(step.name, step.args).done, argPhrase(step.args));

  return (
    <li className="text-sm text-muted">
      {model ? (
        <p className="leading-relaxed">{label}</p>
      ) : (
        <div className="flex items-center gap-2 text-foreground">
          <StepGlyph name={step.name} ns={step.ns} />
          <span className="min-w-0 leading-relaxed">{label}</span>
        </div>
      )}
      {chips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <a
              key={chip.href}
              href={chip.href}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted hover:text-foreground"
            >
              {chip.label}
            </a>
          ))}
        </div>
      )}
      {!model && prose ? <EvidenceNote text={prose} /> : null}
    </li>
  );
}

function EvidenceNote({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const short = clip(text, 220);
  const canExpand = short !== text;
  if (!text) return null;
  return (
    <div className="mt-1">
      <p className="text-[13px] leading-relaxed text-muted">
        {open || !canExpand ? text : short}
      </p>
      {canExpand && (
        <button
          type="button"
          className="mt-0.5 text-[11px] text-muted hover:text-foreground"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function PlanPanel({
  interrupt,
  waiting,
  onDecide,
}: {
  interrupt?: InterruptPayload;
  waiting: boolean;
  onDecide?: (decisions: HitlDecision[]) => void;
}) {
  const [edits, setEdits] = useState<Record<number, string>>({});
  const actions = interrupt?.actionRequests ?? [];
  const editMap = useMemo(() => {
    const next: Record<number, string> = { ...edits };
    actions.forEach((action, index) => {
      if (next[index] == null) {
        next[index] = JSON.stringify(action.args, null, 2);
      }
    });
    return next;
  }, [actions, edits]);

  if (actions.length === 0) return null;

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
    <section
      aria-label="Plan approval"
      className="w-full rounded-2xl border border-border bg-surface p-3 text-left"
    >
      <div className="space-y-3">
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
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => decide("approve")}>
            Allow
          </Button>
          <Button size="sm" variant="outline" onClick={() => decide("reject")}>
            Reject
          </Button>
        </div>
      )}
    </section>
  );
}

function actionTitle(action: ActionRequest): string {
  if (action.description?.trim()) return action.description.trim();
  const allow = verbsFor(action.name, action.args).allow;
  const scope =
    action.scope && action.scope !== action.name ? action.scope : "";
  return scope ? `Allow ${allow} ${clip(scope, 72)}` : `Allow ${allow}`;
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
  const [details, setDetails] = useState(false);
  const canEdit = action.allowedDecisions.includes("edit") && !disabled;
  const scope =
    action.scope && action.scope !== action.name ? action.scope : "";
  return (
    <div>
      <div className="flex items-start gap-2">
        <StepGlyph name={action.name} ns={[]} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug text-foreground">
            {actionTitle(action)}
          </p>
          {(scope || action.costHint) && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted">
              {scope ? <span className="truncate">{scope}</span> : null}
              {action.costHint ? (
                <span className="inline-flex items-center gap-1">
                  <TokenIcon />
                  {action.costHint}
                </span>
              ) : null}
            </p>
          )}
          <button
            type="button"
            className="mt-1 text-[12px] text-muted hover:text-foreground"
            onClick={() => setDetails((value) => !value)}
          >
            {details ? "Hide details" : "Details"}
          </button>
          {details &&
            (canEdit ? (
              <textarea
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="mt-1.5 h-24 w-full resize-y rounded-md border border-border bg-transparent p-2 font-mono text-[11px]"
              />
            ) : (
              <pre className="mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted">
                {JSON.stringify(action.args, null, 2)}
              </pre>
            ))}
        </div>
      </div>
    </div>
  );
}
