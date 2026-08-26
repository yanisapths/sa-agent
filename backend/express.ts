import cors from "cors";
import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { HumanMessage, type ContentBlock } from "@langchain/core/messages";

import { chatAgent } from "./agents/chat/agent";
import {
  cleanModelOutput,
  errorMessage,
  looksLikeArtifact,
  normalizeArtifact,
  stripThinking,
  tryParseJsonObject,
} from "./helpers";

// ─────────────────────────────────────────────
// App setup
// ─────────────────────────────────────────────

const app = express();
app.disable("x-powered-by");

const origins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
  : ["http://localhost:3000"];

app.use(cors({ origin: origins }));
app.options("*", cors());
app.use(express.json({ limit: "4mb" }));

// ─────────────────────────────────────────────
// Health
// ─────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ─────────────────────────────────────────────
// File upload config
// ─────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
});

// ─────────────────────────────────────────────
// POST /chat
// ─────────────────────────────────────────────

app.post("/chat", upload.array("files"), async (req, res) => {
  try {
    const message: string = req.body.message ?? "";
    const files = (req.files ?? []) as Express.Multer.File[];

    // Build multimodal content
    const content: ContentBlock[] = [];

    for (const file of files) {
      if (file.mimetype.startsWith("image/")) {
        content.push({
          type: "image_url",
          image_url: {
            url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
          },
        } as ContentBlock);
      } else {
        const ext = path.extname(file.originalname).toLowerCase().slice(1);
        content.push({
          type: "text",
          text: `[Attached file: ${file.originalname}]\n\`\`\`${ext}\n${file.buffer.toString("utf-8")}\n\`\`\``,
        } as ContentBlock);
      }
    }

    if (message) {
      content.push({ type: "text", text: message });
    }

    if (content.length === 0) {
      return res
        .status(400)
        .json({ ok: false, error: "Message or file required." });
    }

    // ── Run agent ──
    const result = await chatAgent.invoke(
      { messages: [new HumanMessage({ content })] },
      { configurable: { thread_id: uuidv4() } }
    );

    // ── Extract and clean raw output ──
    const raw = result.finalResponse;
    const stripped = stripThinking(raw);
    const cleaned = cleanModelOutput(stripped);

    console.log("[raw]", raw.slice(0, 300));
    console.log("[cleaned]", cleaned.slice(0, 300));

    // ── Route to structured or plain text ──
    return res.json(buildResponse(cleaned));
  } catch (e) {
    console.error("[chat error]", e);
    return res.status(500).json({ ok: false, error: errorMessage(e) });
  }
});

// ─────────────────────────────────────────────
// Response builder
//
// Returns one of:
//   { ok: true, type: "text",     data: { text: string } }
//   { ok: true, type: "code",     data: { language, filename, title, description, code } }
//   { ok: true, type: "api_spec", data: { method, endpoint, ... } }
//   { ok: true, type: "sql",      data: { dialect, sql, reasoning } }
//   { ok: true, type: "diagram",  data: { diagramType, title, content } }
// ─────────────────────────────────────────────

function buildResponse(cleaned: string): object {
  // Only attempt JSON parse if it genuinely looks like a structured artifact
  if (looksLikeArtifact(cleaned)) {
    const parsed = tryParseJsonObject(cleaned);

    if (
      parsed?.type &&
      ["code", "api_spec", "sql", "diagram"].includes(parsed.type as string)
    ) {
      const data = normalizeArtifact(parsed);
      return { ok: true, type: data.type, data };
    }
  }

  // Everything else: plain conversational text
  return {
    ok: true,
    type: "text",
    data: { type: "text", text: cleaned },
  };
}

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`REST API listening on http://localhost:${port}`);
});
