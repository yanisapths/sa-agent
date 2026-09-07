import { config } from "../../config";
import { gatewayHeaders, gatewayUrl } from "../../agents/model";
import { HttpError } from "../httpError";

/**
 * The gateway's model catalogue, which is also its price list.
 *
 * `GET /v1/models` is the only authority on what a virtual key can reach —
 * `config.bifrost.providers` is a diagnostic hint, not an allow-list — and it
 * is the only place per-token pricing exists. Both the model picker and the
 * per-request cost figure read from here, so nothing has to hardcode a price
 * that would silently go stale.
 */

export interface ModelPricing {
  /** USD per token. `null` when the gateway sent something unparseable. */
  promptPerToken: number | null;
  completionPerToken: number | null;
  cacheReadPerToken: number | null;
}

export interface GatewayModel {
  /** The id to send as `model`, e.g. `dashscope/qwen3.7-flash`. */
  id: string;
  /** Human label from the gateway, e.g. "Qwen3.7 Flash". Falls back to the id. */
  name: string;
  contextLength: number | null;
  maxOutputTokens: number | null;
  pricing: ModelPricing;
}

/** What a completion actually consumed. Shaped to match the usage collector. */
export interface PricedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

interface RawModel {
  id?: unknown;
  normalized_name?: unknown;
  context_length?: unknown;
  max_output_tokens?: unknown;
  pricing?: {
    prompt?: unknown;
    completion?: unknown;
    input_cache_read?: unknown;
  };
}

/**
 * Prices arrive as decimal strings ("0.0000002000"). A value we cannot parse
 * becomes `null` so the UI shows "—" instead of a confidently wrong number.
 */
function price(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function count(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toModel(row: RawModel): GatewayModel | null {
  if (typeof row.id !== "string" || !row.id) return null;
  return {
    id: row.id,
    name:
      typeof row.normalized_name === "string" && row.normalized_name
        ? row.normalized_name
        : row.id,
    contextLength: count(row.context_length),
    maxOutputTokens: count(row.max_output_tokens),
    pricing: {
      promptPerToken: price(row.pricing?.prompt),
      completionPerToken: price(row.pricing?.completion),
      cacheReadPerToken: price(row.pricing?.input_cache_read),
    },
  };
}

/**
 * Embedding models sit in the same catalogue as the chat models and would 404
 * or return nonsense if a human picked one out of a chat model dropdown.
 */
function isChatModel(model: GatewayModel): boolean {
  return !/embedding|rerank/i.test(model.id);
}

let cache: { at: number; models: GatewayModel[] } | null = null;

async function load(): Promise<GatewayModel[]> {
  if (!config.bifrost.enabled) {
    throw new HttpError(
      503,
      "BIFROST_BASE_URL is not set, so there is no model catalogue to read.",
    );
  }

  const url = `${gatewayUrl()}/models`;
  const response = await fetch(url, { headers: gatewayHeaders() });
  if (!response.ok) {
    throw new HttpError(
      502,
      `Gateway returned ${response.status} for ${url}: ${(await response.text()).slice(0, 200)}`,
    );
  }

  const body = (await response.json()) as { data?: RawModel[] };
  const models = (body.data ?? [])
    .map(toModel)
    .filter((model): model is GatewayModel => model !== null)
    .sort((a, b) => a.id.localeCompare(b.id));

  cache = { at: Date.now(), models };
  return models;
}

/**
 * Every model the key can reach, including the embedding ones. Cost lookup uses
 * this so a message sent on a model that has since left the chat list still
 * prices correctly.
 */
export async function allModels(): Promise<GatewayModel[]> {
  if (cache && Date.now() - cache.at < config.bifrost.modelsCacheMs) {
    return cache.models;
  }
  return load();
}

/** What the picker offers. */
export async function chatModels(): Promise<GatewayModel[]> {
  return (await allModels()).filter(isChatModel);
}

/**
 * Guards the `model` field on `/chat`. An unknown id would otherwise reach the
 * gateway as a 404 halfway through an agent run, and an embedding id would
 * reach it as a much stranger failure.
 */
export async function isChatModelId(id: string): Promise<boolean> {
  return (await chatModels()).some((model) => model.id === id);
}

/**
 * Cost of one completion, or `null` when the model or any price it needs is
 * unknown. Cache reads are billed at their own lower rate and are already
 * counted inside `inputTokens`, so they are subtracted before pricing the rest.
 */
export async function priceFor(
  modelId: string,
  usage: PricedUsage,
): Promise<number | null> {
  const model = (await allModels()).find((row) => row.id === modelId);
  if (!model) return null;

  const { promptPerToken, completionPerToken, cacheReadPerToken } =
    model.pricing;
  if (promptPerToken === null || completionPerToken === null) return null;

  const cached = Math.min(Math.max(usage.cacheReadTokens, 0), usage.inputTokens);
  const fresh = usage.inputTokens - cached;
  const cachedRate = cacheReadPerToken ?? promptPerToken;

  return (
    fresh * promptPerToken +
    cached * cachedRate +
    usage.outputTokens * completionPerToken
  );
}
