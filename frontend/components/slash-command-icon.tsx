import { Layers, Ticket } from "lucide-react";
import { type SlashCommand, isPhaseCommand } from "./slash-commands";

/**
 * A phase and an MCP command do different things — one picks who works, the
 * other changes what is asked — so they should not look identical in the menu.
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
  const Icon = isPhaseCommand(command) ? Layers : Ticket;
  return <Icon size={size} className={className} />;
}
