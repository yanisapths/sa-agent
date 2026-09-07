import { config } from "../../config";
import { gatewayHeaders } from "../../agents/model";
import { HttpError } from "../httpError";

/**
 * Bifrost's governance API — what the virtual key is allowed to spend and what
 * it has spent this period.
 *
 * `GET /api/governance/virtual-keys/quota` hangs off the gateway **origin**,
 * not its OpenAI-compatible surface, so this deliberately does not use
 * `gatewayUrl()` (which appends `/v1`). Auth is the same `x-bf-vk` header pair
 * every other gateway call uses.
 *
 * The raw body nests budgets inside budgets. Everything here flattens it to
 * what the UI actually draws, so the shape of the meter does not depend on the
 * gateway's internal ids.
 */

export interface QuotaBudget {
  usedUsd: number;
  limitUsd: number | null;
  /** ISO instant the period rolls over, or `null` if we cannot derive it. */
  resetsAt: string | null;
}

export interface QuotaModelUsage {
  /** `provider/model`, joined to match a `/v1/models` id. */
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

interface RawBudget {
  max_limit?: unknown;
  current_usage?: unknown;
  reset_duration?: unknown;
  last_reset?: unknown;
  per_model_usage?: RawModelUsage[];
}

interface RawModelUsage {
  model?: unknown;
  provider?: unknown;
  total_requests?: unknown;
  total_tokens?: unknown;
  total_cost?: unknown;
}

interface RawProviderConfig {
  provider?: unknown;
  budgets?: RawBudget[];
}

interface RawQuota {
  virtual_key_name?: unknown;
  is_active?: unknown;
  budgets?: RawBudget[];
  provider_configs?: RawProviderConfig[];
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function limit(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * `reset_duration` is a compact period like `1M`, `7d`, `24h`. Anything we do
 * not recognise yields `null` rather than a guessed date — a wrong reset date
 * on a budget meter is worse than no date.
 */
function resetsAt(lastReset: unknown, duration: unknown): string | null {
  if (typeof lastReset !== "string" || typeof duration !== "string") return null;

  const start = new Date(lastReset);
  if (Number.isNaN(start.getTime())) return null;

  const match = duration.trim().match(/^(\d+)\s*([MdhmwY])$/);
  if (!match) return null;

  const amount = Number(match[1]);
  const next = new Date(start);

  switch (match[2]) {
    case "Y":
      next.setUTCFullYear(next.getUTCFullYear() + amount);
      break;
    case "M":
      next.setUTCMonth(next.getUTCMonth() + amount);
      break;
    case "w":
      next.setUTCDate(next.getUTCDate() + amount * 7);
      break;
    case "d":
      next.setUTCDate(next.getUTCDate() + amount);
      break;
    case "h":
      next.setUTCHours(next.getUTCHours() + amount);
      break;
    case "m":
      next.setUTCMinutes(next.getUTCMinutes() + amount);
      break;
    default:
      return null;
  }

  return next.toISOString();
}

function toModelUsage(row: RawModelUsage): QuotaModelUsage | null {
  const model = typeof row.model === "string" ? row.model : "";
  if (!model) return null;
  const provider = typeof row.provider === "string" ? row.provider : "";

  return {
    id: provider ? `${provider}/${model}` : model,
    requests: num(row.total_requests),
    tokens: num(row.total_tokens),
    costUsd: num(row.total_cost),
  };
}

/**
 * The key-level budget is the first entry of the top-level `budgets` array;
 * the per-provider sub-budgets live one level down under `provider_configs`.
 */
function normalize(raw: RawQuota): GatewayQuota {
  const keyBudget = raw.budgets?.[0];

  const models = (keyBudget?.per_model_usage ?? [])
    .map(toModelUsage)
    .filter((row): row is QuotaModelUsage => row !== null)
    .sort((a, b) => b.costUsd - a.costUsd);

  const providers = (raw.provider_configs ?? [])
    .map((entry): QuotaProviderUsage | null => {
      const provider = typeof entry.provider === "string" ? entry.provider : "";
      if (!provider) return null;
      const budget = entry.budgets?.[0];
      return {
        provider,
        usedUsd: num(budget?.current_usage),
        limitUsd: limit(budget?.max_limit),
      };
    })
    .filter((row): row is QuotaProviderUsage => row !== null)
    .sort((a, b) => a.provider.localeCompare(b.provider));

  return {
    keyName:
      typeof raw.virtual_key_name === "string" ? raw.virtual_key_name : "",
    isActive: raw.is_active !== false,
    budget: {
      usedUsd: num(keyBudget?.current_usage),
      limitUsd: limit(keyBudget?.max_limit),
      resetsAt: resetsAt(keyBudget?.last_reset, keyBudget?.reset_duration),
    },
    models,
    providers,
  };
}

/** Origin without the Anthropic surface a Claude Code setup may have appended. */
function adminOrigin(): string {
  return config.bifrost.baseUrl.replace(/\/anthropic\/?$/, "");
}

let cache: { at: number; quota: GatewayQuota } | null = null;

export async function fetchQuota(): Promise<GatewayQuota> {
  if (cache && Date.now() - cache.at < config.bifrost.quotaCacheMs) {
    return cache.quota;
  }

  if (!config.bifrost.enabled) {
    throw new HttpError(
      503,
      "BIFROST_BASE_URL is not set, so there is no virtual key quota to read.",
    );
  }

  const url = `${adminOrigin()}/api/governance/virtual-keys/quota`;
  const response = await fetch(url, { headers: gatewayHeaders() });
  if (!response.ok) {
    throw new HttpError(
      502,
      `Gateway returned ${response.status} for the quota endpoint: ${(await response.text()).slice(0, 200)}`,
    );
  }

  const quota = normalize((await response.json()) as RawQuota);
  cache = { at: Date.now(), quota };
  return quota;
}
