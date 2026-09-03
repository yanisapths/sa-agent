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
import { saAgent } from "../agents";
import {
  lastAssistantContent,
  normalizeArtifact,
  stripThinking,
  tryParseJsonObject,
} from "../internal/artifacts";
import { HttpError } from "../internal/httpError";
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

async function chatHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const message: string = req.body.message ?? "";
    const uploads = ((req.files ?? []) as Express.Multer.File[]).map(
      (file) => ({
        name: file.originalname,
        mimetype: file.mimetype,
        buffer: file.buffer,
      }),
    );

    const mentioned = await vaultMentions(
      message,
      requestedMentions(req.body ?? {}),
      req.userId,
    );
    const content = toContentBlocks(
      message,
      [...uploads, ...mentioned.files],
      mentioned.notes,
    );

    if (content.length === 0) {
      throw new HttpError(400, "Message or file required.");
    }

    // A stable threadId keeps the agent's short-term session memory across turns.
    const threadId: string = req.body.threadId || randomUUID();

    const result = await saAgent.invoke(
      { messages: [new HumanMessage({ content })] },
      { configurable: { thread_id: threadId } },
    );

    const raw = stripThinking(lastAssistantContent(result));
    const parsed = tryParseJsonObject(raw);
    const data = parsed?.type
      ? normalizeArtifact(parsed)
      : { type: "text", text: raw };

    res.json({ ok: true, threadId, type: data.type, data });
  } catch (err) {
    next(err);
  }
}

const chat = Router();
chat.post("/", optionalAuth, upload.array("files"), chatHandler);

export { chat };
