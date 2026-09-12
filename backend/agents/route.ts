export type AgentKind = "plain" | "chat" | "deep";

export interface RouteInput {
  threadId: string;
  message: string;
  phase?: string;
  hasPvtCases?: boolean;
}

/**
 * Last kind this process used for a thread. Survives model switches, not
 * restarts. A greeting after a harness turn drops to the plain LLM; a
 * follow-up that is not small talk stays on the Deep Agent.
 */
const lastKind = new Map<string, AgentKind>();

const CASUAL =
  /^(hi+|hii+|hello|hey|yo|sup|thanks|thank you|thx|ty|ok|okay|cheers|bye|good (morning|afternoon|evening)|how are you|what'?s up|test|testing|ping|pong)[\s.!?,]*$/i;

/**
 * Slash leftovers and natural-language asks for the harness loop. Keep this
 * conservative: a miss goes to the tool chat, not the 6k harness.
 */
const DEEP_INTENT = [
  /\/(sa-)?(discuss|plan|execute|test|review)\b/i,
  /\/pvt-(discuss|plan|execute)\b/i,
  /\bpvt[\s-]*(prep|discuss|plan|execute|script|cases?)\b/i,
  /\bproduction verification tests?\b/i,
  /\b(start|run|begin|do)\s+(the\s+)?(discuss|plan|execute|review|harness|workflow)\b/i,
  /\b(implement|refactor|write (the )?code|code (this|the)|generate (the )?sql scripts)\b/i,
  /\b(write|draft|produce)\s+(a |the )?(spec|plan|discuss(ion)? artifact)\b/i,
  /\b(solution architecture|execute checklist|pvt window)\b/i,
];

export function isCasualMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return CASUAL.test(trimmed);
}

export function wantsDeepAgent(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || isCasualMessage(trimmed)) return false;
  return DEEP_INTENT.some((pattern) => pattern.test(trimmed));
}

export function selectAgentKind(input: RouteInput): AgentKind {
  const kind = classify(input);
  lastKind.set(input.threadId, kind);
  return kind;
}

export function lastAgentKind(threadId: string): AgentKind | undefined {
  return lastKind.get(threadId);
}

/**
 * `plain` is greetings only. Any real question needs tools (docs, schema,
 * web, Jira) — a regex miss used to skip Mintlify and invent an API spec.
 */
function classify(input: RouteInput): AgentKind {
  if (input.phase) return "deep";
  if (input.hasPvtCases) return "deep";
  if (wantsDeepAgent(input.message)) return "deep";
  if (isCasualMessage(input.message)) return "plain";

  const previous = lastKind.get(input.threadId);
  if (previous === "deep") return "deep";

  return "chat";
}
