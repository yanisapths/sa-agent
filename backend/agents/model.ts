import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { LLMResult } from "@langchain/core/outputs";
import { ChatOpenAI } from "@langchain/openai";
import { config } from "../config";

/**
 * Model ids carry their own routing.
 *
 *   `dashscope/qwen3.7-flash`  → the Bifrost gateway (OpenAI-compatible)
 *   `ollama:qwen3.5:9b`        → that provider directly, via LangChain
 *
 * A slash is the gateway's own `provider/model` shape, so nothing else needs a
 * flag: one phase can stay on a local coder while the rest go through Bifrost.
 */
export function resolveModel(id: string): string | BaseChatModel {
  if (!isGatewayModel(id)) return id;

  if (!config.bifrost.enabled) {
    throw new Error(
      `Model "${id}" is a gateway id but BIFROST_BASE_URL is not set. ` +
        `Set it, or use a direct provider id like "anthropic:claude-haiku-4-5".`,
    );
  }
  if (!config.bifrost.apiKey) {
    throw new Error("BIFROST_BASE_URL is set but BIFROST_API_KEY is missing.");
  }

  const cached = models.get(id);
  if (cached) return cached;

  const model = gatewayModel(id);
  models.set(id, model);
  return model;
}

/** `provider/model` is the gateway shape; `provider:model` is LangChain's. */
export function isGatewayModel(id: string): boolean {
  return id.includes("/");
}

const models = new Map<string, BaseChatModel>();

export function gatewayModel(id: string): ChatOpenAI {
  const { apiKey, authHeader, userAgent, maxTokens } = config.bifrost;

  return new ChatOpenAI({
    model: id,
    maxTokens,
    /**
     * The gateway exposes Chat Completions only. Left to itself the client
     * would switch some model names over to the Responses API and 404.
     */
    useResponsesApi: false,
    /** Unused by the gateway, but the client refuses to start without one. */
    apiKey,
    configuration: {
      baseURL: gatewayUrl(),
      /**
       * Headers go on in `gatewayFetch`, not `defaultHeaders`: LangChain
       * overwrites `User-Agent` there with its own, which is what Cloudflare
       * blocks.
       */
      fetch: gatewayFetch,
    },
    callbacks: [{ handleLLMEnd: warnOnTruncation }],
  });
}

export function gatewayUrl(): string {
  return `${config.bifrost.baseUrl}/v1`;
}

/** Headers the gateway needs on a hand-rolled request, e.g. `GET /v1/models`. */
export function gatewayHeaders(): Record<string, string> {
  return {
    [config.bifrost.authHeader]: config.bifrost.apiKey,
    "User-Agent": config.bifrost.userAgent,
  };
}

/**
 * The last hop before the wire, so nothing downstream can rewrite these.
 * The virtual key goes in its own header, and the User-Agent has to be one
 * Cloudflare does not recognise as an SDK.
 */
function authorize(input: string | URL | Request, init?: RequestInit): Headers {
  const source =
    init?.headers ?? (input instanceof Request ? input.headers : undefined);
  const headers = new Headers(source);
  const { apiKey, authHeader, userAgent } = config.bifrost;

  headers.set(authHeader, apiKey);
  headers.set("User-Agent", userAgent);
  /** The key already travelled in `authHeader`; a bearer token is a wrong second one. */
  if (authHeader.toLowerCase() !== "authorization") {
    headers.delete("Authorization");
  }

  return headers;
}

/**
 * A burst of traffic gets Cloudflare's interstitial instead of the API. It is
 * an HTML page under a 403, so the client would surface it as a hard auth
 * failure; back off and try again before letting it through.
 */
const BOT_CHALLENGE = /just a moment|error code: *1010|cf-browser-verification/i;

const BACKOFF_MS = 750;

async function gatewayFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const authed: RequestInit = { ...init, headers: authorize(input, init) };

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(input, authed);
    if (response.ok) return response;

    const body = await response.text();
    const challenged = response.status === 403 && BOT_CHALLENGE.test(body);

    if (challenged && attempt < config.bifrost.challengeRetries) {
      await sleep(BACKOFF_MS * 2 ** attempt);
      continue;
    }

    console.error(`[bifrost] ${explain(response.status, body, challenged)}`);

    /** The body is already drained, so hand the client an identical copy. */
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
}

/** Every one of these reads as something other than what it is. */
function explain(status: number, body: string, challenged: boolean): string {
  if (challenged) {
    return `Cloudflare bot challenge after ${config.bifrost.challengeRetries} retries. Slow down and retry.`;
  }
  if (/could not auto resolve a provider|unknown provider/i.test(body)) {
    return `Model id needs a provider prefix, e.g. "dashscope/qwen3.7-flash". This gateway routes: ${config.bifrost.providers.join(", ")}.`;
  }
  if (status === 401 || status === 403) {
    return `Gateway rejected the key. Check BIFROST_API_KEY, and that BIFROST_AUTH_HEADER ("${config.bifrost.authHeader}") is the header it wants.`;
  }
  if (status === 404) {
    return `No such endpoint or model. We POST to ${gatewayUrl()}/chat/completions — check BIFROST_BASE_URL, then \`bun run check:bifrost -- --models\`.`;
  }
  if (status === 429) {
    return "Rate limited by the gateway.";
  }
  return `Gateway returned ${status}: ${body.slice(0, 300)}`;
}

/**
 * Reasoning tokens come out of `max_tokens`, so a model can spend the whole
 * budget thinking and return empty content. The agent loop sees a turn that
 * did nothing rather than an error, so say so.
 */
function warnOnTruncation(output: LLMResult): void {
  for (const batch of output.generations) {
    for (const generation of batch) {
      if (generation.generationInfo?.finish_reason !== "length") continue;
      console.error(
        `[bifrost] Reply truncated at max_tokens=${config.bifrost.maxTokens}` +
          `${generation.text ? "" : " with empty content"}. Raise BIFROST_MAX_TOKENS.`,
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
