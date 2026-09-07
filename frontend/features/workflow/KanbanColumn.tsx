import { cn } from "@/lib/utils";

import { type WorkflowColumn } from "./columns";
import { KanbanCard } from "./KanbanCard";
import { type WorkflowCard } from "./types";

export function KanbanColumn({
  column,
  cards,
  onOpen,
  onShip,
}: {
  column: WorkflowColumn;
  cards: WorkflowCard[];
  onOpen: () => void;
  onShip: () => void;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 px-1 pb-3">
        <span
          className={cn("h-2 w-2 shrink-0 rounded-full", column.dotClass)}
          aria-hidden
        />
        <h2 className="text-sm font-medium text-foreground">{column.label}</h2>
        <span className="ml-auto text-xs tabular-nums text-muted">
          {cards.length}
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1">
        {cards.map((card) => (
          <KanbanCard
            key={card.threadId}
            card={card}
            onOpen={onOpen}
            onShip={onShip}
          />
        ))}
      </div>
    </section>
  );
}
