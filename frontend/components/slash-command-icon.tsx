import { Layers, Minimize2, Ticket } from "lucide-react";
import {
  type SlashCommand,
  isPhaseCommand,
  isStyleCommand,
} from "./slash-commands";

/**
 * A phase, a style, and an MCP command do different things — one picks who
 * works, one changes how it talks, the other changes what is asked — so they
 * should not look identical in the menu.
 *
 * A component rather than a function returning one: React treats a component
 * created during render as a fresh type each pass, which resets its state.
 */
export function CommandIcon({
  command,
  size,
  className,
}: {
  command: SlashCommand;
  size: number;
  className?: string;
}) {
  const Icon = isPhaseCommand(command)
    ? Layers
    : isStyleCommand(command)
      ? Minimize2
      : Ticket;
  return <Icon size={size} className={className} />;
}
