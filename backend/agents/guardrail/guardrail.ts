import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { currentConnections, secretValues } from "../../internal/product/connections";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import {
  createMiddleware,
  humanInTheLoopMiddleware,
  piiMiddleware,
  type AnyAgentMiddleware,
  type InterruptOnConfig,
} from "langchain";
import { asChatModel } from "../model";

function textArtifact(text: string): string {
  return JSON.stringify({ type: "text", text });
}

const BLOCKED_INPUT = textArtifact(
  "I cannot process requests containing inappropriate content. Please rephrase your request.",
);
const BLOCKED_OUTPUT = textArtifact(
  "I cannot provide that response. Please rephrase your request.",
);

/**
 * Jailbreak / policy phrases only. `hack` and `exploit` stay allowed so
 * architecture questions about auth and security still run.
 */
const DEFAULT_BANNED = [
  "ignore previous instructions",
  "ignore all previous",
  "do anything now",
  "developer mode",
  "bypass safety",
  "jailbreak",
  "you are now dan",
] as const;

const API_KEY_DETECTOR = "sk-[a-zA-Z0-9]{32}";

export type SafetyModel = BaseChatModel | (() => Promise<BaseChatModel>);

export type GuardrailInterruptOn = Record<
  string,
  boolean | InterruptOnConfig
>;

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block === "object" && "text" in block) {
        const text = (block as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("");
}

function latestHuman(messages: unknown[] | undefined) {
  if (!messages?.length) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (HumanMessage.isInstance(message)) return message;
  }
  return undefined;
}

function isUnsafeVerdict(content: unknown): boolean {
  const first = messageText(content).trim().split(/\s+/)[0] ?? "";
  return first.toUpperCase() === "UNSAFE";
}

/**
 * Guardrails are built once per model, so the request's credentials are read
 * from AsyncLocalStorage when the hook runs, never captured at build time.
 */
export function connectionSecretMatches(
  content: string,
  secrets: readonly string[] = secretValues(currentConnections()),
): { text: string; start: number; end: number }[] {
  const matches: { text: string; start: number; end: number }[] = [];
  for (const secret of secrets) {
    let from = 0;
    for (;;) {
      const start = content.indexOf(secret, from);
      if (start === -1) break;
      matches.push({ text: secret, start, end: start + secret.length });
      from = start + secret.length;
    }
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  // A database URL and its password are both secrets; keep the outer span.
  const spans: typeof matches = [];
  for (const match of matches) {
    const last = spans[spans.length - 1];
    if (last && match.start < last.end) {
      if (match.end > last.end) {
        last.end = match.end;
        last.text = content.slice(last.start, last.end);
      }
      continue;
    }
    spans.push({ ...match });
  }
  return spans;
}

function namedPii(
  piiType: string,
  options?: { detector?: string | ((content: string) => { text: string; start: number; end: number }[]) },
): AnyAgentMiddleware {
  const middleware = piiMiddleware(piiType, {
    strategy: "redact",
    detector: options?.detector,
    applyToInput: true,
    applyToOutput: true,
    applyToToolResults: true,
  });
  middleware.name = `PIIMiddleware[${piiType}]`;
  return middleware;
}

/**
 * Layer 1 — deterministic before-agent filter.
 * Blocks the turn before any model or tool work when the latest human
 * message contains a banned phrase.
 */
export function contentFilterMiddleware(bannedKeywords: readonly string[]) {
  const keywords = bannedKeywords.map((keyword) => keyword.toLowerCase());

  return createMiddleware({
    name: "ContentFilterMiddleware",
    beforeAgent: {
      hook: (state) => {
        const latest = latestHuman(state.messages);
        if (!latest) return;

        const content = messageText(latest.content).toLowerCase();
        if (!keywords.some((keyword) => content.includes(keyword))) return;

        return {
          messages: [new AIMessage(BLOCKED_INPUT)],
          jumpTo: "end" as const,
        };
      },
      canJumpTo: ["end"],
    },
  });
}

/**
 * Last layer — model-based after-agent check.
 * Judges the final AI text once; replaces it when the first token is UNSAFE.
 */
export function safetyGuardrailMiddleware(safetyModel: SafetyModel) {
  let pending: Promise<BaseChatModel> | undefined;

  const resolve = (): Promise<BaseChatModel> => {
    if (typeof safetyModel !== "function") return Promise.resolve(safetyModel);
    pending ??= safetyModel();
    return pending;
  };

  return createMiddleware({
    name: "SafetyGuardrailMiddleware",
    afterAgent: {
      hook: async (state) => {
        const last = state.messages?.at(-1);
        if (!last || !AIMessage.isInstance(last)) return;
        if (last.tool_calls && last.tool_calls.length > 0) return;

        const response = messageText(last.content);
        if (!response.trim()) return;
        if (response === BLOCKED_INPUT || response === BLOCKED_OUTPUT) return;

        const model = await resolve();
        const verdict = await model.invoke([
          {
            role: "user",
            content: `Evaluate if this response is safe and appropriate.
Respond with only 'SAFE' or 'UNSAFE'.

Response: ${response}`,
          },
        ]);

        if (!isUnsafeVerdict(verdict.content)) return;

        return {
          messages: [new AIMessage(BLOCKED_OUTPUT)],
          jumpTo: "end" as const,
        };
      },
      canJumpTo: ["end"],
    },
  });
}

export interface GuardrailMiddlewareOptions {
  bannedKeywords?: readonly string[];
  safetyModel: SafetyModel;
  /** Test-only HITL. Live agents keep their own interrupt map. */
  interruptOn?: GuardrailInterruptOn;
}

/**
 * Combined stack: before-agent filter, PII on input/output/tool results,
 * optional HITL, then an after-agent safety judge.
 */
export function guardrailMiddleware(
  options: GuardrailMiddlewareOptions,
): AnyAgentMiddleware[] {
  const banned = options.bannedKeywords ?? DEFAULT_BANNED;

  const layers: AnyAgentMiddleware[] = [
    contentFilterMiddleware(banned),
    namedPii("email"),
    namedPii("credit_card"),
    namedPii("api_key", { detector: API_KEY_DETECTOR }),
    namedPii("connection_secret", { detector: (content) => connectionSecretMatches(content) }),
  ];

  if (options.interruptOn) {
    layers.push(humanInTheLoopMiddleware({ interruptOn: options.interruptOn }));
  }

  layers.push(safetyGuardrailMiddleware(options.safetyModel));
  return layers;
}

/** Live agents: reuse the chat model when it is already constructed. */
export function guardrailsForModel(
  model: string | BaseChatModel,
): AnyAgentMiddleware[] {
  const safetyModel: SafetyModel =
    typeof model === "string" ? () => asChatModel(model) : model;
  return guardrailMiddleware({ safetyModel });
}

export { BLOCKED_INPUT, BLOCKED_OUTPUT, DEFAULT_BANNED };
