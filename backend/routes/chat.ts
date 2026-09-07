import path from "node:path";
import { HumanMessage, type ContentBlock } from "@langchain/core/messages";
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { GraphRecursionError } from "@langchain/langgraph";
import { PHASE_OWNERS, agentFor } from "../agents";
import { config } from "../config";
import {
  lastAssistantContent,
  normalizeArtifact,
  stripThinking,
  tryParseJsonObject,
} from "../internal/artifacts";
import { isChatModelId } from "../internal/gateway/models";
import {
  createUsageCollector,
  type UsageCollector,
} from "../internal/gateway/usage";
import { HttpError } from "../internal/httpError";
import { isCsvFile, parkPvtCases } from "../internal/pvtCases";
import {
  extractMentionTokens,
  resolveMentions,
} from "../internal/vault/service";
import { optionalAuth } from "../middleware/requireAuth";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/** One shape for both an upload and a file pulled out of the vault. */
interface ChatFile {
  name: string;
  mimetype: string;
  buffer: Buffer;
}

/**
 * Extensions we can put in a prompt as text. `.pdf`, `.docx`, and `.xlsx` are
 * uploadable to the vault but are containers — decoding them as UTF-8 yields
 * mojibake the model would read as data, so they are named and skipped instead.
 */
const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".csv",
  ".json",
  ".ts",
  ".tsx",
  ".sql",
  ".yaml",
  ".yml",
]);

function toFileBlock(file: ChatFile): ContentBlock {
  if (file.mimetype.startsWith("image/")) {
    return {
      type: "image_url",
      image_url: {
        url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
      },
    } as ContentBlock;
  }

  const ext = path.extname(file.name).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) {
    return {
      type: "text",
      text: `[Attached file: ${file.name} — ${file.mimetype} cannot be read as text. Ask for a CSV, Markdown, or plain-text export.]`,
    } as ContentBlock;
  }

  return {
    type: "text",
    text: `[Attached file: ${file.name}]\n\`\`\`${ext.slice(1)}\n${file.buffer.toString("utf-8")}\n\`\`\``,
  } as ContentBlock;
}

function toContentBlocks(
  message: string,
  files: ChatFile[],
  notes: string[] = [],
): ContentBlock[] {
  const blocks: ContentBlock[] = files.map(toFileBlock);

  for (const note of notes) {
    blocks.push({ type: "text", text: note } as ContentBlock);
  }

  if (message) blocks.push({ type: "text", text: message });
  return blocks;
}

/**
 * `@folder/file.csv` in the message is inert text on its own. Resolve it to
 * bytes so the file reaches the agent the same way an upload does. Needs an
 * identity: without one the tokens stay literal and the agent is told why,
 * rather than guessing at a file it cannot read.
 */
function requestedMentions(body: Record<string, unknown>): string[] {
  const raw = body.mentions;
  if (typeof raw === "string") {
    return raw.trim() ? [raw.trim()] : [];
  }
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string");
  }
  return [];
}

async function vaultMentions(
  message: string,
  explicit: readonly string[],
  userId: string | undefined,
): Promise<{ files: ChatFile[]; notes: string[] }> {
  // An explicit `mentions[]` is authoritative — the client knows which
  // suggestion the human picked. Scanning the text is the fallback for
  // clients that only send the message.
  const tokens = [
    ...new Set([...explicit, ...extractMentionTokens(message)]),
  ];
  if (tokens.length === 0) return { files: [], notes: [] };

  if (!userId) {
    return {
      files: [],
      notes: [
        `[Vault mentions ${tokens.join(", ")} could not be read: this chat request is not signed in. Tell the human to attach the file directly instead.]`,
      ],
    };
  }

  const { files, unresolved } = await resolveMentions(userId, tokens);
  return {
    files: files.map((file) => ({
      name: file.name,
      mimetype: file.mimeType,
      buffer: file.buffer,
    })),
    notes: unresolved.map(
      (item) => `[Vault mention ${item.token} could not be read: ${item.reason}.]`,
    ),
  };
}

/**
 * The model the human picked in the GUI, checked against the gateway's own
 * catalogue. Validating here rather than letting it through means an unknown or
 * embedding-only id fails as a 400 up front, instead of as a 404 from the
 * gateway several supersteps into an agent run the caller has already paid for.
 */
async function requestedModel(
  body: Record<string, unknown>,
): Promise<string | undefined> {
  const raw = body.model;
  if (typeof raw !== "string" || !raw.trim()) return undefined;

  const model = raw.trim();
  if (!(await isChatModelId(model))) {
    throw new HttpError(
      400,
      `Unknown model "${model}". Ask GET /v1/gateway/models what this key can reach.`,
    );
  }
  return model;
}

/**
 * A phase pins the specialist for this turn. Without one the router decides,
 * which is right for an open-ended question and wrong when the human has
 * already said "plan this" — it may re-run discuss instead.
 */
function requestedPhase(body: Record<string, unknown>): string | undefined {
  const raw = body.phase;
  if (typeof raw !== "string" || !raw.trim()) return undefined;

  const phase = raw.trim();
  if (!PHASE_OWNERS.has(phase)) {
    throw new HttpError(
      400,
      `Unknown phase "${phase}". Expected one of: ${[...PHASE_OWNERS].join(", ")}.`,
    );
  }
  return phase;
}

/**
 * Phrased to reinforce the router contract in `agents/prompt.ts` — "task()
 * exactly one specialist" — rather than argue with it, so the only thing left
 * for the router to decide is already decided.
 *
 * The last sentence is doing real work. The router is also told that questions
 * needing no specialist should be answered directly and stopped, and left to
 * itself it sometimes reads a request like this as one of those. An explicit
 * phase has to win over that rule, or the selection silently does nothing.
 */
function phaseDirective(phase: string): string {
  return `[Phase: ${phase}] The human explicitly selected this phase, so the routing decision is already made. task() the \`${phase}\` specialist for this turn and return its artifact. Do not choose a different specialist, and do not answer directly even if you believe you could — an explicit phase overrides the rule about questions that need no specialist.`;
}

/** The `usage` block on a response, successful or not. */
async function usagePayload(
  collector: UsageCollector,
  model: string | undefined,
  phase: string | undefined,
  startedAt: number,
): Promise<Record<string, unknown>> {
  return {
    model: model ?? config.model.orchestrator,
    phase: phase ?? null,
    durationMs: Date.now() - startedAt,
    ...(await collector.totals()),
  };
}

async function chatHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  /**
   * Hoisted out of the try so a failure can still report what it spent. The
   * turns worth costing are exactly the ones that time out or hit the step cap.
   */
  const startedAt = Date.now();
  let collector: UsageCollector | undefined;
  let model: string | undefined;
  let phase: string | undefined;

  try {
    const message: string = req.body.message ?? "";
    const uploads = ((req.files ?? []) as Express.Multer.File[]).map(
      (file) => ({
        name: file.originalname,
        mimetype: file.mimetype,
        buffer: file.buffer,
      }),
    );

    const body = (req.body ?? {}) as Record<string, unknown>;
    model = await requestedModel(body);
    phase = requestedPhase(body);

    const mentioned = await vaultMentions(
      message,
      requestedMentions(body),
      req.userId,
    );
    const incoming = [...uploads, ...mentioned.files];
    const csvs = incoming.filter(isCsvFile);
    const otherFiles = incoming.filter((file) => !isCsvFile(file));
    const parked = await parkPvtCases(csvs);
    const content = toContentBlocks(message, otherFiles, [
      ...mentioned.notes,
      ...parked.notes,
      ...(phase ? [phaseDirective(phase)] : []),
    ]);

    if (content.length === 0) {
      throw new HttpError(400, "Message or file required.");
    }

    // A stable threadId keeps the agent's short-term session memory across turns.
    const threadId: string = req.body.threadId || randomUUID();

    collector = createUsageCollector(model ?? config.model.orchestrator);

    const abort = new AbortController();
    const timer = setTimeout(
      () => abort.abort(),
      config.agent.invokeTimeoutMs,
    );
    /**
     * `req.destroyed` is not the signal it looks like: multer has already
     * consumed the body by this point, so the readable side is destroyed on
     * every request and it reads as "client gone" even when nobody left. Record
     * the disconnect where it actually happens instead.
     */
    let clientGone = false;
    const onClose = () => {
      if (res.writableEnded) return;
      clientGone = true;
      abort.abort();
    };
    req.on("close", onClose);

    let result;
    try {
      result = await agentFor(model).invoke(
        {
          messages: [new HumanMessage({ content })],
          ...(Object.keys(parked.files).length > 0
            ? { files: parked.files }
            : {}),
        },
        {
          configurable: { thread_id: threadId },
          recursionLimit: config.agent.recursionLimit,
          signal: abort.signal,
          /**
           * deepagents' `task` tool spreads this config into the subagent
           * invoke, so the collector sees the specialists' completions too —
           * which is where nearly all of the tokens are spent.
           */
          callbacks: [collector.handler],
        },
      );
    } catch (err) {
      if (abort.signal.aborted || isAbortError(err)) {
        throw new HttpError(
          504,
          clientGone
            ? "Chat cancelled."
            : `Agent timed out after ${config.agent.invokeTimeoutMs}ms.`,
        );
      }
      if (
        err instanceof GraphRecursionError ||
        (err instanceof Error && /recursion limit/i.test(err.message))
      ) {
        throw new HttpError(
          504,
          `Agent stopped after ${config.agent.recursionLimit} steps to prevent a retry loop.`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
      req.off("close", onClose);
    }

    const raw = stripThinking(lastAssistantContent(result));
    const parsed = tryParseJsonObject(raw);
    const data = parsed?.type
      ? normalizeArtifact(parsed)
      : { type: "text", text: raw };

    res.json({
      ok: true,
      threadId,
      type: data.type,
      data,
      usage: await usagePayload(collector, model, phase, startedAt),
    });
  } catch (err) {
    /**
     * A timeout or a step-cap stop has already been paid for, so it carries its
     * usage rather than going to the generic error handler empty. A cancelled
     * request has nowhere to send it — the socket is gone.
     */
    if (err instanceof HttpError && collector && !res.writableEnded) {
      res.status(err.status).json({
        ok: false,
        error: err.message,
        usage: await usagePayload(collector, model, phase, startedAt),
      });
      return;
    }
    next(err);
  }
}

const chat = Router();
chat.post("/", optionalAuth, upload.array("files"), chatHandler);

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String(err.name) : "";
  return name === "AbortError" || name === "TimeoutError";
}

export { chat };
