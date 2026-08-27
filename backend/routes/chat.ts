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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function toContentBlocks(
  message: string,
  files: Express.Multer.File[],
): ContentBlock[] {
  const blocks: ContentBlock[] = files.map((file) => {
    if (file.mimetype.startsWith("image/")) {
      return {
        type: "image_url",
        image_url: {
          url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
        },
      } as ContentBlock;
    }

    const language = path.extname(file.originalname).slice(1);
    return {
      type: "text",
      text: `[Attached file: ${file.originalname}]\n\`\`\`${language}\n${file.buffer.toString("utf-8")}\n\`\`\``,
    } as ContentBlock;
  });

  if (message) blocks.push({ type: "text", text: message });
  return blocks;
}

async function chatHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const message: string = req.body.message ?? "";
    const files = (req.files ?? []) as Express.Multer.File[];
    const content = toContentBlocks(message, files);

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
chat.post("/", upload.array("files"), chatHandler);

export { chat };
