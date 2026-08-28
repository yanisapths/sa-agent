"use client";

import { Ticket } from "lucide-react";
import type { SlashCommand } from "./slash-commands";

export function SlashCommandMenu({
  commands,
  onSelect,
}: {
  commands: SlashCommand[];
  onSelect: (command: SlashCommand) => void;
}) {
  if (commands.length === 0) return null;

  return (
    <ul
      role="listbox"
      aria-label="MCP commands"
      className="absolute bottom-full left-0 right-0 z-10 mb-2 overflow-hidden rounded-xl border border-[#716D65]/15 bg-white shadow-[6px_2px_35px_rgba(0,0,0,0.05)]"
    >
      {commands.map((command, index) => (
        <li key={command.token}>
          <button
            type="button"
            role="option"
            aria-selected={index === 0}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(command);
            }}
            className="flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left text-sm hover:bg-[#716D65]/10"
          >
            <Ticket size={14} className="mt-0.5 shrink-0 text-[#716D65]" />
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">
                {command.token}
                <span className="ml-2 font-normal text-[#716D65]">
                  {command.label}
                </span>
              </span>
              <span className="text-xs text-[#716D65]">
                {command.description}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
