import cors from "cors";
import "dotenv/config";
import express from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { chatAgent } from "./agents/chat/agent";
import { indexing } from "./agents/rag/indexing";

import { getSupabase } from "./database/supabase";
import {
  errorMessage,
  lastAssistantContent,
  normalizeApiSpec,
  tryParseJsonObject,
} from "./helpers";
import multer from "multer";
import path from "path";
import { HumanMessage, type ContentBlock } from "@langchain/core/messages";

const app = express();
app.disable("x-powered-by");

const origins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
  : ["http://localhost:3000"];

app.use(cors({ origin: origins }));
app.options("*", cors());

app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// -----------------------------
// Supabase Storage REST
// -----------------------------

app.get("/supabase/buckets", async (_req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.storage.listBuckets();
    if (error) return res.status(400).json({ ok: false, error });
    return res.json({ ok: true, buckets: data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: errorMessage(e) });
  }
});

app.get("/supabase/:bucket/files", async (req, res) => {
  try {
    const { bucket } = req.params;
    const prefix = typeof req.query.prefix === "string" ? req.query.prefix : "";
    const limit =
      typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
    const offset =
      typeof req.query.offset === "string" ? Number(req.query.offset) : 0;

    const supabase = getSupabase();
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) return res.status(400).json({ ok: false, error });
    return res.json({ ok: true, files: data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: errorMessage(e) });
  }
});

app.get("/supabase/:bucket/public-url", async (req, res) => {
  try {
    const { bucket } = req.params;
    const path = z.string().min(1).parse(req.query.path);
    const supabase = getSupabase();
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return res.json({ ok: true, publicUrl: data.publicUrl });
  } catch (e) {
    return res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

// -----------------------------
// Chroma Cloud RAG REST
// -----------------------------

app.post("/rag/index", async (req, res) => {
  try {
    const body = z
      .object({
        url: z.string().url(),
      })
      .parse(req.body);

    const result = await indexing({ path: body.url });
    return res.json({ ok: true, indexed: result.splits, url: body.url });
  } catch (e) {
    return res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

// -----------------------------
// Chat (RAG Agent)
// -----------------------------
const upload = multer({
  storage: multer.memoryStorage(), // keep files in memory as Buffer
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
});

app.post("/chat", upload.array("files"), async (req, res) => {
  try {
    const message = req.body.message ?? "";
    const files = (req.files ?? []) as Express.Multer.File[];

    // Build multimodal content array
    const content: ContentBlock[] = [];

    // Process image files into base64 for the LLM
    for (const file of files) {
      const isImage = file.mimetype.startsWith("image/");
      if (isImage) {
        content.push({
          type: "image_url",
          image_url: {
            url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
          },
        } as ContentBlock);
      } else {
        // For non-image files, extract text and inject as context
        const ext = path.extname(file.originalname).toLowerCase();
        const textContent = file.buffer.toString("utf-8");
        content.push({
          type: "text",
          text: `[Attached file: ${file.originalname}]
        \`\`\`${ext.slice(1)}
        ${textContent}
        \`\`\``,
        } as ContentBlock);
      }
    }

    if (message) {
      content.push({
        type: "text",
        text: message,
      });
    }

    if (content.length === 0) {
      return res
        .status(400)
        .json({ ok: false, error: "Message or file required." });
    }

    const stream = await chatAgent.stream(
      {
        messages: [
          new HumanMessage({
            content,
          }),
        ],
      },
      { configurable: { thread_id: uuidv4() }, streamMode: "values" },
    );

    let finalResult: any = null;
    for await (const chunk of stream) {
      finalResult = chunk;

      const messages = chunk.messages ?? [];
      const last = messages[messages.length - 1];
      console.log(last);
      if (last?.type === "ai") {
        const text =
          typeof last.content === "string"
            ? last.content
            : last.content?.map((c: any) => c.text ?? "").join("");

        const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/);
        if (thinkMatch) console.log("thinking:", thinkMatch[1].trim());

        const answer = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        if (answer) console.log("response:", answer);
      }
    }

    const rawContent = lastAssistantContent(finalResult)
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .trim();
    const parsed = tryParseJsonObject(rawContent);

    if (!parsed?.type) {
      return res.json({
        ok: true,
        type: "text",
        data: { type: "text", text: rawContent },
      });
    }

    const data = parsed.type === "api_spec" ? normalizeApiSpec(parsed) : parsed;

    return res.json({ ok: true, type: data.type, data });
  } catch (e) {
    return res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`REST API listening on http://localhost:${port}`);
});
