"use client";

import { type ChatUsage } from "@/features/gateway/types";
import { formatDuration, formatTokens, formatUsd } from "./format-usage";

/**
 * What one turn cost, under the answer it paid for.
 *
 * The token counts cover the router and every specialist it delegated to, so
 * they are the real spend rather than the orchestrator's own small share.
 * Reasoning tokens are already inside the output count and are shown as a
 * parenthetical, because they come out of the same `BIFROST_MAX_TOKENS` budget
 * and are the usual reason a reply comes back truncated.
 */
export function UsageBadge({ usage }: { usage: ChatUsage }) {
  const models = usage.models.length > 0 ? usage.models : null;
  const ranOn = models
    ? models.map((model) => model.id).join(", ")
    : usage.model;

  const parts = [
    ranOn,
    usage.phase ? `${usage.phase} phase` : null,
    `${formatTokens(usage.inputTokens)} in`,
    `${formatTokens(usage.outputTokens)} out`,
    usage.reasoningTokens > 0
      ? `${formatTokens(usage.reasoningTokens)} reasoning`
      : null,
    usage.cacheReadTokens > 0
      ? `${formatTokens(usage.cacheReadTokens)} cached`
      : null,
    usage.calls > 1 ? `${usage.calls} calls` : null,
    `${formatUsd(usage.costUsd)}${usage.costEstimated ? "*" : ""}`,
    formatDuration(usage.durationMs),
  ].filter(Boolean);

  return (
    <p
      className="mt-1.5 text-[11px] leading-relaxed text-[#716D65]/80"
      title={
        usage.costEstimated
          ? "Cost is estimated from this key's observed spend — the gateway publishes no price list for this model."
          : undefined
      }
    >
      {parts.join(" · ")}
    </p>
  );
}
