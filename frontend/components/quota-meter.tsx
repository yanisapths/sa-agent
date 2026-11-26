"use client";

import { ChevronDown } from "lucide-react";
import { Popover } from "radix-ui";
import { type GatewayQuota } from "@/features/gateway/types";
import { formatResetDate, formatTokens, formatUsd } from "./format-usage";

/** Amber past three quarters, rose once spent — a budget meter should warn. */
function barColor(fraction: number): string {
  if (fraction >= 1) return "bg-rose-500";
  if (fraction >= 0.75) return "bg-amber-500";
  return "bg-light";
}

function Bar({ used, limit }: { used: number; limit: number | null }) {
  const fraction = limit && limit > 0 ? Math.min(used / limit, 1) : 0;

  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted/15">
      <span
        className={`block h-full rounded-full transition-all ${barColor(fraction)}`}
        style={{ width: `${Math.max(fraction * 100, used > 0 ? 1.5 : 0)}%` }}
      />
    </span>
  );
}

type QuotaStatus = "loading" | "ready" | "error";

/**
 * The virtual key's budget for the period, with the per-model and per-provider
 * breakdown behind it.
 *
 * This is gateway-wide rather than per-conversation, which is why it lives in
 * the tab bar: the number does not belong to the chat you happen to have open.
 * Loading and error still render the control so a failed lookup cannot hide it.
 */
export function QuotaMeter({
  quota,
  status = "ready",
  error = null,
}: {
  quota: GatewayQuota | null;
  status?: QuotaStatus;
  error?: string | null;
}) {
  if (status === "loading" && !quota) {
    return (
      <span
        className="inline-flex w-28 flex-col justify-center gap-1 self-center px-2 py-1 text-[11px] text-muted"
        role="status"
      >
        Loading quota…
      </span>
    );
  }

  if (!quota) {
    return (
      <Popover.Root>
        <Popover.Trigger className="inline-flex cursor-pointer items-center gap-2 self-center rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:bg-muted/10">
          <span className="flex w-28 flex-col gap-1">
            <span className="flex items-baseline justify-between gap-2 text-[11px]">
              <span>Quota</span>
              <span>unavailable</span>
            </span>
            <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted/15" />
          </span>
          <ChevronDown size={13} className="shrink-0" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            collisionPadding={8}
            className="z-50 w-72 rounded-xl border border-border bg-surface p-4 text-sm text-foreground shadow-[6px_2px_35px_rgba(0,0,0,0.12)]"
          >
            <p className="font-medium">Could not read the virtual key budget</p>
            <p className="mt-1 text-xs text-muted">
              {error ?? "The Bifrost quota endpoint did not respond. Model spend still appears under each reply."}
            </p>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  const { budget, models, providers, keyName, isActive } = quota;
  const resetsOn = formatResetDate(budget.resetsAt);

  return (
    <Popover.Root>
      <Popover.Trigger className="inline-flex cursor-pointer items-center gap-2 self-center rounded-lg px-2 py-1 text-xs transition-colors hover:bg-muted/10">
        <span className="flex w-28 flex-col gap-1">
          <span className="flex items-baseline justify-between gap-2 text-[11px] text-muted">
            <span>{formatUsd(budget.usedUsd)}</span>
            <span>{budget.limitUsd === null ? "" : formatUsd(budget.limitUsd)}</span>
          </span>
          <Bar used={budget.usedUsd} limit={budget.limitUsd} />
        </span>
        <ChevronDown size={13} className="shrink-0 text-muted" />
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-h-[var(--radix-popover-content-available-height)] w-96 overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface p-4 text-sm text-foreground shadow-[6px_2px_35px_rgba(0,0,0,0.12)]"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium">{keyName || "Virtual key"}</span>
            {!isActive && (
              <span className="text-xs font-medium text-rose-600">inactive</span>
            )}
          </div>

          <div className="mt-2 flex flex-col gap-1.5">
            <span className="flex items-baseline justify-between text-xs text-muted">
              <span>
                {formatUsd(budget.usedUsd)}
                {budget.limitUsd !== null && ` of ${formatUsd(budget.limitUsd)}`}
              </span>
              {resetsOn && <span>resets {resetsOn}</span>}
            </span>
            <Bar used={budget.usedUsd} limit={budget.limitUsd} />
          </div>

          {models.length > 0 && (
            <section className="mt-4">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted">
                By model
              </h3>
              <ul className="mt-1.5 flex flex-col gap-1">
                {models.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-baseline justify-between gap-3 text-xs"
                  >
                    <span className="min-w-0 truncate">{row.id}</span>
                    <span className="shrink-0 tabular-nums text-muted">
                      {row.requests} req · {formatTokens(row.tokens)} tok ·{" "}
                      {formatUsd(row.costUsd)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {providers.length > 0 && (
            <section className="mt-4">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted">
                By provider
              </h3>
              <ul className="mt-1.5 flex flex-col gap-2">
                {providers.map((row) => (
                  <li key={row.provider} className="flex flex-col gap-1">
                    <span className="flex items-baseline justify-between gap-3 text-xs">
                      <span>{row.provider}</span>
                      <span className="shrink-0 tabular-nums text-muted">
                        {formatUsd(row.usedUsd)}
                        {row.limitUsd !== null && ` / ${formatUsd(row.limitUsd)}`}
                      </span>
                    </span>
                    <Bar used={row.usedUsd} limit={row.limitUsd} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
