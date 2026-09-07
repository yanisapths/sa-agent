"use client";

import { ChevronDown, Check } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { type GatewayModel } from "@/features/gateway/types";

interface ModelPickerProps {
  models: GatewayModel[];
  /** `null` means "whatever the backend is configured to use". */
  model: string | null;
  onModelChange: (model: string | null) => void;
  disabled?: boolean;
}

function shortName(id: string): string {
  const slash = id.indexOf("/");
  return slash === -1 ? id : id.slice(slash + 1);
}

function formatContext(tokens: number | null): string {
  if (tokens === null) return "";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M ctx`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k ctx`;
  return `${tokens} ctx`;
}

/**
 * Prices are per token, which is unreadable at that scale — the industry quotes
 * per million, so convert rather than print a string of zeroes.
 */
function formatPrice(model: GatewayModel): string {
  const { promptPerToken, completionPerToken } = model.pricing;
  if (promptPerToken === null || completionPerToken === null) {
    return "price not published";
  }
  const perMillion = (rate: number) => `$${(rate * 1_000_000).toFixed(2)}`;
  return `${perMillion(promptPerToken)} in / ${perMillion(completionPerToken)} out per 1M`;
}

/**
 * Picks the model for the next turn. The choice applies to the router *and*
 * every phase specialist, so it changes which model does the real work.
 *
 * Hidden when the gateway is unreachable: an empty dropdown offering nothing is
 * worse than the backend default it would be replacing.
 */
export function ModelPicker({
  models,
  model,
  onModelChange,
  disabled,
}: ModelPickerProps) {
  if (models.length === 0) return null;

  const active = models.find((item) => item.id === model);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        disabled={disabled}
        className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-medium text-[#716D65] transition-colors hover:bg-[#716D65]/15 disabled:pointer-events-none disabled:opacity-50"
      >
        {active ? shortName(active.id) : "Default model"}
        <ChevronDown size={13} className="shrink-0" />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        {/*
          The trigger sits at the bottom of the viewport, so Radix flips this
          list upward where it is taller than the room available. Bounding it by
          Radix's own measurement rather than a guessed `vh` is what keeps the
          first row reachable — a fixed max-height clips off the top instead of
          scrolling to it.
        */}
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 flex max-h-[var(--radix-dropdown-menu-content-available-height)] w-80 flex-col overflow-y-auto overscroll-contain rounded-xl border border-[#716D65]/15 bg-white p-1 shadow-[6px_2px_35px_rgba(0,0,0,0.12)]"
        >
          <DropdownMenu.Item
            onSelect={() => onModelChange(null)}
            className="flex shrink-0 cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm outline-none data-[highlighted]:bg-[#716D65]/10"
          >
            <span className="mt-0.5 w-3.5 shrink-0">
              {model === null && <Check size={14} />}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">Default model</span>
              <span className="text-xs text-[#716D65]">
                Whatever the server is configured to use
              </span>
            </span>
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="my-1 h-px shrink-0 bg-[#716D65]/15" />

          {models.map((item) => (
            <DropdownMenu.Item
              key={item.id}
              onSelect={() => onModelChange(item.id)}
              className="flex shrink-0 cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm outline-none data-[highlighted]:bg-[#716D65]/10"
            >
              <span className="mt-0.5 w-3.5 shrink-0">
                {item.id === model && <Check size={14} />}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{item.id}</span>
                <span className="text-xs text-[#716D65]">
                  {[formatContext(item.contextLength), formatPrice(item)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
