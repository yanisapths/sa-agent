"use client";

import { X } from "lucide-react";
import type { SlashCommand } from "./slash-commands";
import { CommandIcon } from "./slash-command-icon";

export function SlashCommandChip({
  command,
  onRemove,
}: {
  command: SlashCommand;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-foreground/10 px-2.5 py-1 text-xs font-medium text-foreground">
      <CommandIcon command={command} size={12} className="shrink-0" />
      {command.chipLabel}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${command.chipLabel}`}
        className="ml-0.5 cursor-pointer rounded-full p-0.5 text-foreground/70 hover:bg-foreground/10 hover:text-foreground"
      >
        <X size={10} strokeWidth={3} />
      </button>
    </span>
  );
}
