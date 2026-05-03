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
app.post("/chat", async (req, res) => {
  try {
    const body = z.object({ message: z.string().min(1) }).parse(req.body);

    const stream = await chatAgent.stream(
      { messages: [{ role: "user", content: body.message }] },
      { configurable: { thread_id: uuidv4() }, streamMode: "values" },
    );

    let finalResult: any = null;
    for await (const chunk of stream) finalResult = chunk;

    const content = lastAssistantContent(finalResult);
    const parsed = tryParseJsonObject(content);

    if (!parsed?.type) {
      return res.json({
        ok: true,
        type: "text",
        data: { type: "text", text: content },
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
