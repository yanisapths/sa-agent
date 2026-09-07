"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { SlashCommand } from "./slash-commands";
import { CommandIcon } from "./slash-command-icon";

const COLLISION_PADDING = 8;

/** Space between the input and the nearest overflow clip above it. */
function heightAbove(anchor: HTMLElement): number {
  const anchorTop = anchor.getBoundingClientRect().top;
  let clipTop = 0;
  let node: HTMLElement | null = anchor.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (
      overflowY === "auto" ||
      overflowY === "scroll" ||
      overflowY === "hidden"
    ) {
      clipTop = Math.max(clipTop, node.getBoundingClientRect().top);
    }
    node = node.parentElement;
  }
  return Math.max(0, anchorTop - clipTop - COLLISION_PADDING);
}

export function SlashCommandMenu({
  commands,
  onSelect,
  hasMessages,
}: {
  commands: SlashCommand[];
  onSelect: (command: SlashCommand) => void;
  hasMessages?: boolean;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [maxHeight, setMaxHeight] = useState<number>();

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const update = () => {
      const parent = el.offsetParent;
      if (!(parent instanceof HTMLElement)) return;
      setMaxHeight(heightAbove(parent));
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [commands]);

  if (commands.length === 0) return null;

  return (
    <ul
      ref={listRef}
      role="listbox"
      aria-label="Commands"
      style={maxHeight !== undefined ? { maxHeight } : undefined}
      className={cn(
        "absolute left-0 right-0 z-10 mb-2 flex flex-col overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface shadow-[6px_2px_35px_rgba(0,0,0,0.05)]",
        hasMessages ? "bottom-32" : "-bottom-60",
      )}
    >
      {commands.map((command, index) => (
        <li key={command.token} className="shrink-0">
          <button
            type="button"
            role="option"
            aria-selected={index === 0}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(command);
            }}
            className="flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted/10"
          >
            <CommandIcon
              command={command}
              size={14}
              className="mt-0.5 shrink-0 text-muted"
            />
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">
                {command.token}
                <span className="ml-2 font-normal text-muted">
                  {command.label}
                </span>
              </span>
              <span className="text-xs text-muted">{command.description}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
