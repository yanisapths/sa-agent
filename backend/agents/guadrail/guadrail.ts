import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import {
  createMiddleware,
  humanInTheLoopMiddleware,
  piiMiddleware,
  type AnyAgentMiddleware,
} from "langchain";

const BLOCKED_INPUT =
  "I cannot process requests containing inappropriate content. Please rephrase your request.";
const BLOCKED_OUTPUT =
  "I cannot provide that response. Please rephrase your request.";

const DEFAULT_BANNED = ["hack", "exploit"] as const;

const SEND_EMAIL_HITL = {
  send_email: {
    allowedDecisions: ["approve", "edit", "reject"] as Array<
      "approve" | "edit" | "reject"
    >,
  },
};

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

/**
 * Layer 1 — deterministic before-agent filter.
 * Blocks the turn before any model or tool work when the first human
 * message contains a banned keyword.
 */
export function contentFilterMiddleware(bannedKeywords: readonly string[]) {
  const keywords = bannedKeywords.map((keyword) => keyword.toLowerCase());

  return createMiddleware({
    name: "ContentFilterMiddleware",
    beforeAgent: {
      hook: (state) => {
        const first = state.messages?.find((message) =>
          HumanMessage.isInstance(message),
        );
        if (!first) return;

        const content = messageText(first.content).toLowerCase();
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
 * Layer 4 — model-based after-agent check.
 * Judges the final AI text once; replaces it when the judge says UNSAFE.
 */
export function safetyGuardrailMiddleware(safetyModel: BaseChatModel) {
  return createMiddleware({
    name: "SafetyGuardrailMiddleware",
    afterAgent: {
      hook: async (state) => {
        const last = state.messages?.at(-1);
        if (!last || !AIMessage.isInstance(last)) return;
        if (last.tool_calls && last.tool_calls.length > 0) return;

        const response = messageText(last.content);
        if (!response.trim()) return;

        const verdict = await safetyModel.invoke([
          {
            role: "user",
            content: `Evaluate if this response is safe and appropriate.
Respond with only 'SAFE' or 'UNSAFE'.

Response: ${response}`,
          },
        ]);

        if (!messageText(verdict.content).includes("UNSAFE")) return;

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
  safetyModel: BaseChatModel;
}

/**
 * Combined stack matching LangChain's layered guardrail example:
 * before-agent filter, PII on input and output, HITL on send_email,
 * then an after-agent safety judge.
 */
export function guardrailMiddleware(
  options: GuardrailMiddlewareOptions,
): AnyAgentMiddleware[] {
  const banned = options.bannedKeywords ?? DEFAULT_BANNED;

  const piiInput = piiMiddleware("email", {
    strategy: "redact",
    applyToInput: true,
    applyToOutput: false,
  });
  piiInput.name = "PIIMiddleware[email-input]";
  const piiOutput = piiMiddleware("email", {
    strategy: "redact",
    applyToInput: false,
    applyToOutput: true,
  });
  piiOutput.name = "PIIMiddleware[email-output]";

  return [
    contentFilterMiddleware(banned),
    piiInput,
    piiOutput,
    humanInTheLoopMiddleware({ interruptOn: SEND_EMAIL_HITL }),
    safetyGuardrailMiddleware(options.safetyModel),
  ];
}

export { BLOCKED_INPUT, BLOCKED_OUTPUT };
