"use client";

import { cn } from "@/lib/utils";

import { type CapabilityState } from "./capabilities";
import { useProduct } from "./ProductProvider";
import { type CapabilityKey } from "./types";

const LABELS: { key: Exclude<CapabilityKey, "repos">; label: string; name: string }[] = [
  { key: "db", label: "DB", name: "Database" },
  { key: "docs", label: "Docs", name: "Confluence docs" },
  { key: "schemaIndex", label: "Index", name: "Schema index" },
];

function stateText(state: CapabilityState): string {
  if (state === "on") return "✓";
  if (state === "locked") return "locked";
  return "–";
}

function spoken(state: CapabilityState): string {
  if (state === "on") return "connected";
  if (state === "locked") return "locked, unlock to use";
  return "not connected";
}

/**
 * `DB ✓`, `DB –` or `DB locked`: state is in the text, not only the colour.
 * Clicking a chip opens the connections dialog (which also unlocks).
 */
export function CapabilityChips({ compact = false }: { compact?: boolean }) {
  const { active, capabilities, openDialog } = useProduct();
  const repoCount = active?.repos.length ?? 0;

  const chipClass = (state: CapabilityState) =>
    cn(
      "inline-flex cursor-pointer items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] leading-none",
      state === "on" && "border-border text-foreground",
      state === "off" && "border-dashed border-border text-muted",
      state === "locked" && "border-amber-500/60 text-amber-700 dark:text-amber-400",
    );

  return (
    <span className={cn("flex flex-wrap items-center gap-1", compact && "flex-nowrap")}>
      {LABELS.map(({ key, label, name }) => {
        const state = capabilities[key];
        return (
          <button
            key={key}
            type="button"
            className={chipClass(state)}
            aria-label={`${name}: ${spoken(state)}. Manage connections`}
            onClick={(event) => {
              event.stopPropagation();
              openDialog("connections");
            }}
          >
            {label} {stateText(state)}
          </button>
        );
      })}
      <span
        className={chipClass(capabilities.repos)}
        aria-label={`${repoCount} repo${repoCount === 1 ? "" : "s"}`}
      >
        Repos {repoCount}
      </span>
    </span>
  );
}
