import type { LLMResult } from "@langchain/core/outputs";
import { allModels, priceFor, type GatewayModel } from "./models";
import { fetchQuota } from "./quota";

/**
 * Token accounting for one `/chat` turn, including the specialists.
 *
 * The obvious approach — sum `usage_metadata` off the messages `invoke` returns
 * — under-reports badly. deepagents' `task` tool hands the subagent a fresh
 * message list and returns only its final text to the parent, so a specialist's
 * completions never appear in the graph state we get back. That is where nearly
 * all of the spend is.
 *
 * The tool does spread the parent's config into the child invoke, though, so a
 * callback handler passed per-request reaches every nested model call. That is
 * what this is: one collector per request, handed to `invoke` as a callback.
 *
 * `warnOnTruncation` in `agents/model.ts` cannot do this job — it is bound when
 * the model is constructed and those instances are cached and shared across
 * requests, so it has no way to tell one caller's tokens from another's.
 */

interface ModelTally {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
}

export interface ModelUsage extends ModelTally {
  id: string;
  /** `null` when neither the catalogue nor observed spend can price it. */
  costUsd: number | null;
  /** True when `costUsd` came from a blended observed rate, not a price list. */
  costEstimated: boolean;
}

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  /** `null` when any contributing model could not be priced at all. */
  costUsd: number | null;
  /** True when any contributing model's cost is a blended estimate. */
  costEstimated: boolean;
  /** One row per model that ran, router and specialists alike. */
  models: ModelUsage[];
}

/** Enough of a ChatGeneration to read usage off it without importing the class. */
interface UsageBearingGeneration {
  message?: {
    usage_metadata?: {
      input_tokens?: number;
      output_tokens?: number;
      input_token_details?: { cache_read?: number };
      output_token_details?: { reasoning?: number };
    };
    response_metadata?: { model_name?: string };
  };
}

function empty(): ModelTally {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
  };
}

function whole(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

/**
 * USD per token per model, derived from what this virtual key has already been
 * billed (`total_cost / total_tokens` in the governance response).
 *
 * The gateway publishes a real price list for only some models — not including
 * the default `BIFROST_MODEL` — so without this, cost would read "unknown" on
 * most turns. It blends input and output rates together, which the exact price
 * list does not, so anything using it is labelled an estimate.
 */
async function blendedRates(): Promise<Map<string, number>> {
  const rates = new Map<string, number>();
  try {
    for (const row of (await fetchQuota()).models) {
      if (row.tokens > 0 && row.costUsd > 0) {
        rates.set(row.id, row.costUsd / row.tokens);
      }
    }
  } catch {
    /** No governance data is a missing cost, not a failed chat turn. */
  }
  return rates;
}

/**
 * The gateway answers with a bare model name (`qwen3.7-flash`) even though it
 * is addressed by a prefixed id (`dashscope/qwen3.7-flash`), and every price
 * and usage table is keyed by the prefixed form. Without this, nothing a
 * completion reports can be joined to what it costs.
 *
 * A bare name is resolved against the model the request asked for first, since
 * that is what actually ran, then against the catalogue. Names carried by more
 * than one provider (`deepseek-v4-flash-0731` is under two) stay bare rather
 * than get attributed to a provider we are guessing at.
 */
function canonicalModelId(
  reported: string,
  fallback: string,
  catalogue: readonly GatewayModel[],
): string {
  if (reported.includes("/")) return reported;

  const suffix = `/${reported}`;
  if (fallback.endsWith(suffix)) return fallback;

  const matches = catalogue.filter((model) => model.id.endsWith(suffix));
  if (matches.length === 1) return matches[0].id;

  const provider = fallback.split("/")[0];
  const sameProvider = matches.find((model) => model.id.startsWith(`${provider}/`));
  return sameProvider?.id ?? reported;
}

export interface UsageCollector {
  /** Pass as `callbacks: [collector.handler]` on the invoke config. */
  handler: { handleLLMEnd: (output: LLMResult) => void };
  totals(): Promise<UsageTotals>;
}

/**
 * `fallbackModel` names the model for a completion whose metadata does not,
 * which is the common case for a gateway that omits `model_name`.
 */
export function createUsageCollector(fallbackModel: string): UsageCollector {
  const tallies = new Map<string, ModelTally>();

  function record(output: LLMResult): void {
    /**
     * A chat turn may return several generations; the OpenAI surface reports
     * usage once, on the message, rather than per generation.
     */
    const llmOutput = output.llmOutput as
      | { model_name?: string; tokenUsage?: Record<string, unknown> }
      | undefined;

    for (const batch of output.generations) {
      for (const generation of batch as UsageBearingGeneration[]) {
        const message = generation.message;
        const usage = message?.usage_metadata;

        const id =
          message?.response_metadata?.model_name ||
          llmOutput?.model_name ||
          fallbackModel;

        const tally = tallies.get(id) ?? empty();

        if (usage) {
          tally.inputTokens += whole(usage.input_tokens);
          tally.outputTokens += whole(usage.output_tokens);
          tally.reasoningTokens += whole(usage.output_token_details?.reasoning);
          tally.cacheReadTokens += whole(usage.input_token_details?.cache_read);
        } else if (llmOutput?.tokenUsage) {
          /** Older OpenAI-shaped payloads report only the coarse pair. */
          tally.inputTokens += whole(llmOutput.tokenUsage.promptTokens);
          tally.outputTokens += whole(llmOutput.tokenUsage.completionTokens);
        } else {
          continue;
        }

        tally.calls += 1;
        tallies.set(id, tally);
      }
    }
  }

  return {
    handler: {
      handleLLMEnd(output: LLMResult): void {
        /**
         * Accounting must never be able to fail a chat turn. A shape we did not
         * expect costs us a number, not the user's answer.
         */
        try {
          record(output);
        } catch (error) {
          console.error(
            `[usage] could not read token usage: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    },

    async totals(): Promise<UsageTotals> {
      let catalogue: GatewayModel[] = [];
      try {
        catalogue = await allModels();
      } catch {
        catalogue = [];
      }

      const blended = await blendedRates();

      /**
       * Two reported names can resolve to the same catalogue id, so the tallies
       * are merged after resolution rather than before.
       */
      const merged = new Map<string, ModelTally>();
      for (const [reported, tally] of tallies) {
        const id = canonicalModelId(reported, fallbackModel, catalogue);
        const target = merged.get(id) ?? empty();
        target.calls += tally.calls;
        target.inputTokens += tally.inputTokens;
        target.outputTokens += tally.outputTokens;
        target.reasoningTokens += tally.reasoningTokens;
        target.cacheReadTokens += tally.cacheReadTokens;
        merged.set(id, target);
      }

      const models: ModelUsage[] = [];
      let costUsd: number | null = 0;
      let costEstimated = false;

      for (const [id, tally] of merged) {
        const priced =
          catalogue.length > 0 ? await priceFor(id, tally) : null;

        /**
         * The catalogue prices only some models, and not the default one, so
         * an exact figure is the exception rather than the rule. Fall back to
         * the rate this key has actually been charged, flagged as an estimate.
         */
        const rate = blended.get(id);
        const estimated =
          priced === null && rate !== undefined
            ? (tally.inputTokens + tally.outputTokens) * rate
            : null;

        const cost = priced ?? estimated;
        if (estimated !== null) costEstimated = true;

        models.push({ id, ...tally, costUsd: cost, costEstimated: priced === null });
        if (cost === null) costUsd = null;
        else if (costUsd !== null) costUsd += cost;
      }

      models.sort(
        (a, b) =>
          b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
      );

      const sum = (pick: (row: ModelTally) => number) =>
        models.reduce((total, row) => total + pick(row), 0);

      return {
        calls: sum((row) => row.calls),
        inputTokens: sum((row) => row.inputTokens),
        outputTokens: sum((row) => row.outputTokens),
        reasoningTokens: sum((row) => row.reasoningTokens),
        cacheReadTokens: sum((row) => row.cacheReadTokens),
        costUsd,
        costEstimated,
        models,
      };
    },
  };
}
