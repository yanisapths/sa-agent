import { WORKFLOW_COLUMNS, type WorkflowColumnId } from "./columns";
import { KanbanColumn } from "./KanbanColumn";
import { type WorkflowCard } from "./types";

export function KanbanBoard({
  cards,
  onOpen,
  onShip,
}: {
  cards: WorkflowCard[];
  onOpen: () => void;
  onShip: () => void;
}) {
  const byColumn = new Map<WorkflowColumnId, WorkflowCard[]>();
  for (const column of WORKFLOW_COLUMNS) {
    byColumn.set(column.id, []);
  }
  for (const card of cards) {
    byColumn.get(card.column)?.push(card);
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-4">
      {WORKFLOW_COLUMNS.map((column, index) => (
        <div
          key={column.id}
          className={
            index === 0
              ? "flex min-h-0 min-w-0 flex-col md:pr-4"
              : "flex min-h-0 min-w-0 flex-col border-border md:border-l md:px-4"
          }
        >
          <KanbanColumn
            column={column}
            cards={byColumn.get(column.id) ?? []}
            onOpen={onOpen}
            onShip={onShip}
          />
        </div>
      ))}
    </div>
  );
}
