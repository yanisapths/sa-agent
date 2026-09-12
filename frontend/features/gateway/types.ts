/** Shapes returned by the backend's `/v1/gateway/*` routes. */

export interface ModelPricing {
  /** USD per token. `null` when the gateway publishes no price for this model. */
  promptPerToken: number | null;
  completionPerToken: number | null;
  cacheReadPerToken: number | null;
}

export interface GatewayModel {
  /** The id to send as `model`, e.g. `dashscope/qwen3.7-flash`. */
  id: string;
  /** Human label, falling back to the id. */
  name: string;
  contextLength: number | null;
  maxOutputTokens: number | null;
  pricing: ModelPricing;
}

export interface QuotaBudget {
  usedUsd: number;
  limitUsd: number | null;
  /** ISO instant the period rolls over, or `null` when it cannot be derived. */
  resetsAt: string | null;
}

export interface QuotaModelUsage {
  id: string;
  requests: number;
  tokens: number;
  costUsd: number;
}

export interface QuotaProviderUsage {
  provider: string;
  usedUsd: number;
  limitUsd: number | null;
}

export interface GatewayQuota {
  keyName: string;
  isActive: boolean;
  budget: QuotaBudget;
  models: QuotaModelUsage[];
  providers: QuotaProviderUsage[];
}

/** Per-model tokens for one chat turn. */
export interface ModelUsage {
  id: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  costUsd: number | null;
  costEstimated: boolean;
}

/**
 * What one `/chat` turn consumed, router and phase specialists together.
 * `costEstimated` means the figure came from a blended observed rate because
 * the gateway publishes no price list for the model — see the backend's
 * `internal/gateway/usage.ts`.
 */
export interface ChatUsage {
  /** The model the turn was asked to run on. */
  model: string;
  phase: string | null;
  /** Lightweight chat vs the Deep Agent harness. */
  agent?: "plain" | "chat" | "deep";
  durationMs: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  costUsd: number | null;
  costEstimated: boolean;
  models: ModelUsage[];
}
