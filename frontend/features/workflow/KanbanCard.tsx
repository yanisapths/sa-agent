import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  Bot,
  CheckCircle2,
  GitPullRequest,
  LoaderCircle,
  Square,
} from "lucide-react";

import { phaseLabel } from "./columns";
import { type WorkflowCard } from "./types";

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 45_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function CardIcon({ card }: { card: WorkflowCard }) {
  const className = "h-3.5 w-3.5 shrink-0 text-muted";
  if (card.live) {
    return <LoaderCircle className={cn(className, "animate-spin")} />;
  }
  if (card.column === "validating") return <Bot className={className} />;
  if (card.column === "review") return <GitPullRequest className={className} />;
  if (card.column === "ready") return <CheckCircle2 className={className} />;
  return <Square className={className} />;
}

export function KanbanCard({
  card,
  onOpen,
  onShip,
}: {
  card: WorkflowCard;
  onOpen: () => void;
  onShip: () => void;
}) {
  const waiting = !card.live && card.column !== "ready";

  return (
    <article className="rounded-xl border border-border bg-surface p-3.5">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full cursor-pointer flex-col gap-2 text-left"
      >
        <div className="flex items-start gap-2">
          <span className="mt-0.5">
            <CardIcon card={card} />
          </span>
          <h3 className="min-w-0 flex-1 text-sm font-semibold leading-snug text-foreground">
            {card.title}
          </h3>
        </div>
        <p className="font-mono text-[11px] text-muted">
          {phaseLabel(card.phase)}
          {card.filename ? ` · ${card.filename}` : ""}
        </p>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
          <span>
            {card.live
              ? "Working…"
              : waiting
                ? "Waiting for approval"
                : "Ready to ship"}
          </span>
          <span>{formatRelativeTime(card.updatedAt)}</span>
        </div>
      </button>
      {card.column === "ready" && !card.live ? (
        <Button
          type="button"
          size="sm"
          className="mt-3 w-full rounded-lg bg-white text-zinc-950 hover:bg-zinc-200 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
          onClick={onShip}
        >
          Ship
        </Button>
      ) : null}
    </article>
  );
}
